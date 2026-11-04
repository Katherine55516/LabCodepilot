/** Shared, bounded template intake policy. Env values are validated, never unlimited. */
function limit(name, fallback, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`invalid ${name}`);
  return value;
}
export function templateLimits() {
  return { userBytes: limit('PPT_TEMPLATE_USER_MAX_BYTES', 16*1024*1024, 64*1024*1024),
    managedBytes: limit('PPT_TEMPLATE_MANAGED_MAX_BYTES', 64*1024*1024, 128*1024*1024),
    uncompressedBytes: limit('PPT_TEMPLATE_MAX_UNCOMPRESSED_BYTES', 128*1024*1024, 512*1024*1024),
    entries: limit('PPT_TEMPLATE_MAX_ZIP_ENTRIES', 5000, 20000), ratio: limit('PPT_TEMPLATE_MAX_COMPRESSION_RATIO', 200, 1000),
    slides: limit('PPT_TEMPLATE_MAX_SLIDES', 100, 100), pixels: limit('PPT_TEMPLATE_MAX_IMAGE_PIXELS', 40_000_000, 100_000_000),
    objects: limit('PPT_TEMPLATE_MAX_OBJECTS', 10000, 50000),
    timeoutMs: limit('PPT_TEMPLATE_PARSE_TIMEOUT', 30000, 120000), memoryBytes: limit('PPT_TEMPLATE_PARSE_MEMORY_BUDGET', 512*1024*1024, 2*1024*1024*1024) };
}
export class TemplateError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}
export function templateError(error) {
  const code = String(error?.message || error).match(/template_(too_large|corrupted|unsupported|unsafe|timeout)/)?.[0] || 'template_corrupted';
  return new TemplateError(code, String(error?.message || error).slice(-300));
}
export const TEMPLATE_SECURITY_SCRIPT = String.raw`
import io, json, os, re, zipfile, posixpath
import xml.etree.ElementTree as ET
from PIL import Image
limits=json.loads(os.environ.get('PPT_TEMPLATE_LIMITS','{}'))
def lim(key, default): return int(limits.get(key,default))
try:
    import resource
    resource.setrlimit(resource.RLIMIT_AS,(lim('memoryBytes',536870912),lim('memoryBytes',536870912)))
except (ImportError,ValueError,OSError): pass
if ext != 'pdf':
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            parts=archive.infolist()
            if len(parts)>lim('entries',5000) or sum(p.file_size for p in parts)>lim('uncompressedBytes',134217728):
                raise ValueError('template_too_large: Office archive expands beyond limit')
            names=set(); objects=0; slide_count=0; safe_chart_workbooks=set(); nested_bytes=0
            # Native charts contain a static XLSX data package, not an OLE
            # executable. Admit only chart-owned workbooks after nested checks.
            for relpart in parts:
                if not re.match(r'^ppt/charts/_rels/chart\d+\.xml\.rels$',relpart.filename):continue
                relblob=archive.read(relpart)
                if re.search(br'<!\s*(DOCTYPE|ENTITY)',relblob,re.I):raise ValueError('template_unsafe: XML entities forbidden')
                for rel in ET.fromstring(relblob):
                    target=posixpath.normpath(posixpath.join('ppt/charts',rel.get('Target','')))
                    if rel.get('TargetMode','').lower()!='external' and rel.get('Type','').endswith('/package') and re.match(r'^ppt/embeddings/[^/]+\.xlsx$',target):safe_chart_workbooks.add(target)
            for part in parts:
                name=part.filename; lower=name.lower()
                if name in names: raise ValueError('template_corrupted: duplicate ZIP entry')
                names.add(name)
                if name.startswith(('/','\\')) or '\\' in name or '..' in name.split('/') or re.match(r'^[A-Za-z]:',name):
                    raise ValueError('template_unsafe: ZIP path traversal')
                if part.flag_bits & 1: raise ValueError('template_unsupported: encrypted archive')
                if part.file_size/max(1,part.compress_size)>lim('ratio',200): raise ValueError('template_unsafe: compression ratio exceeds limit')
                if any(x in lower for x in ('vbaproject','activex','oleobject')) or '/embeddings/' in lower and name not in safe_chart_workbooks: raise ValueError('template_unsafe: macro or embedded executable object')
                if re.match(r'^ppt/slides/slide\d+\.xml$',lower): slide_count+=1
                blob=archive.read(part)
                if name in safe_chart_workbooks:
                    with zipfile.ZipFile(io.BytesIO(blob)) as workbook:
                        members=workbook.infolist();nested_bytes+=sum(p.file_size for p in members)
                        if len(members)>lim('entries',5000) or nested_bytes+sum(p.file_size for p in parts)>lim('uncompressedBytes',134217728):raise ValueError('template_too_large: nested chart workbook expands beyond limit')
                        seen=set()
                        for member in members:
                            n=member.filename;l=n.lower()
                            if n in seen or n.startswith(('/','\\')) or '\\' in n or '..' in n.split('/') or re.match(r'^[A-Za-z]:',n):raise ValueError('template_unsafe: nested workbook path')
                            seen.add(n)
                            if member.flag_bits&1 or member.file_size/max(1,member.compress_size)>lim('ratio',200):raise ValueError('template_unsafe: nested workbook compression/encryption')
                            if not l.endswith(('.xml','.rels')) or any(x in l for x in ('vbaproject','activex','embeddings','externallinks','connections','macrosheet')):raise ValueError('template_unsafe: active chart workbook')
                            data=workbook.read(member)
                            if l.endswith(('.xml','.rels')):
                                if re.search(br'<!\s*(DOCTYPE|ENTITY)',data,re.I):raise ValueError('template_unsafe: nested XML entities')
                                parsed=ET.fromstring(data)
                                if any(e.tag.rsplit('}',1)[-1]=='f' for e in parsed.iter()):raise ValueError('template_unsupported: chart workbook formulas require evaluation policy')
                                if any(e.get('TargetMode','').lower()=='external' for e in parsed):raise ValueError('template_unsafe: linked chart workbook')
                                if l.endswith('.rels'):
                                    for rel in parsed:
                                        target=rel.get('Target','')
                                        resolved=posixpath.normpath(posixpath.join(posixpath.dirname(posixpath.dirname(n)),target))
                                        if '\\' in target or ':' in target or target.startswith('/') or resolved.startswith('../'):raise ValueError('template_unsafe: nested relationship escape')
                                if b'macroEnabled' in data or b'vbaProject' in data:raise ValueError('template_unsafe: macro workbook content type')
                        if 'xl/workbook.xml' not in seen or '[Content_Types].xml' not in seen:raise ValueError('template_unsupported: invalid chart data workbook')
                if lower.endswith(('.xml','.rels','.svg')):
                    if re.search(br'<!\s*(DOCTYPE|ENTITY)',blob,re.I): raise ValueError('template_unsafe: XML entities forbidden')
                    root=ET.fromstring(blob)
                    objects+=sum(1 for e in root.iter() if e.tag.rsplit('}',1)[-1] in ('sp','pic','graphicFrame'))
                    if lower.endswith('.svg'):
                        for element in root.iter():
                            if element.tag.rsplit('}',1)[-1].lower() in ('script','foreignobject'): raise ValueError('template_unsafe: active SVG content')
                            for attr,value in element.attrib.items():
                                if attr.rsplit('}',1)[-1].lower().startswith('on'): raise ValueError('template_unsafe: SVG event handler')
                                if attr.rsplit('}',1)[-1].lower()=='href' and not value.startswith('#'): raise ValueError('template_unsafe: SVG linked resource')
                        css=' '.join(' '.join(element.attrib.values())+' '+(element.text or '') for element in root.iter()).encode('utf8')
                        if re.search(br'@import',css,re.I) or any(not target.strip().strip(b'\x22\x27').strip().startswith(b'#') for target in re.findall(br'url\(([^)]*)\)',css,re.I)):
                            raise ValueError('template_unsafe: SVG external CSS resource')
                    if lower.endswith('.rels'):
                        for rel in root:
                            if rel.get('TargetMode','').lower()=='external':
                                # Inert HTTPS/HTTP hyperlinks do not load external media.
                                # Reject linked assets, files, scripts and OLE relationships.
                                if rel.get('Type','').endswith('/hyperlink') and re.match(r'^https?://[^\s]+$',rel.get('Target',''),re.I): continue
                                raise ValueError('template_unsafe: active external relationship')
                            target=rel.get('Target','')
                            if '\\' in target or ':' in target or target.startswith('/'):
                                raise ValueError('template_unsafe: unsafe relationship target')
                            resolved=posixpath.normpath(posixpath.join(posixpath.dirname(posixpath.dirname(name)),target))
                            if resolved.startswith('../'): raise ValueError('template_unsafe: relationship escapes package')
                if lower.startswith('ppt/media/') and lower.endswith(('.png','.jpg','.jpeg','.gif','.bmp','.tif','.tiff')):
                    with Image.open(io.BytesIO(blob)) as image:
                        if image.width*image.height>lim('pixels',40000000): raise ValueError('template_too_large: image pixel limit')
                        image.verify()
            if slide_count>lim('slides',100) or objects>lim('objects',10000): raise ValueError('template_too_large: slide or object limit')
            if '[Content_Types].xml' not in names or 'ppt/presentation.xml' not in names: raise ValueError('template_unsupported: not a presentation package')
    except (zipfile.BadZipFile,ET.ParseError,KeyError) as error: raise ValueError('template_corrupted: '+str(error))
`;

/** Deck-builder marks ("Made with GAMMA" and the like) never ship (user
 * decision 2026-10-24): a picture on a master, layout or slide is a mark when
 * it links to a deck builder (or a made-with-* campaign), is a known badge
 * image, or is a small corner picture named as a watermark. Shared by the
 * native writer (strips them before saving) and the export verifier (blocks
 * any that remain). Never anything larger than 2 square inches. */
export const BUILDER_MARK_SCRIPT = String.raw`
import hashlib as _bm_hashlib, re as _bm_re
from urllib.parse import urlparse as _bm_urlparse, parse_qs as _bm_parse_qs
_BM_HOSTS={'gamma.app','beautiful.ai','tome.app','pitch.com','canva.com','decktopus.com','slidesgo.com','prezi.com','genspark.ai'}
_BM_HASHES={'591accd6ecdb20315c1ce0017f70029388994ee11bc6fba05a1a53441c6c0240'}
_BM_P='{http://schemas.openxmlformats.org/presentationml/2006/main}'
_BM_A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
_BM_R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
_BM_EMU=914400
def _bm_owners(prs):
    for master in prs.slide_masters:
        yield master
        for layout in master.slide_layouts: yield layout
    for slide in prs.slides: yield slide
def _bm_link(part,pic):
    link=pic.find('.//'+_BM_A+'hlinkClick')
    rid=link.get(_BM_R+'id') if link is not None else None
    rel=part.rels.get(rid) if rid else None
    return rid,(rel.target_ref if rel is not None and rel.is_external else '')
def builder_marks(prs):
    width,height=int(prs.slide_width or 0),int(prs.slide_height or 0);found=[]
    for owner in _bm_owners(prs):
        part=owner.part
        for pic in list(owner._element.iter(_BM_P+'pic')):
            off=pic.find('.//'+_BM_A+'off');ext=pic.find('.//'+_BM_A+'ext')
            x,y=(int(off.get('x',0)),int(off.get('y',0))) if off is not None else (0,0)
            cx,cy=(int(ext.get('cx',0)),int(ext.get('cy',0))) if ext is not None else (0,0)
            if cx*cy>2*_BM_EMU*_BM_EMU: continue
            reasons=[];rid,url=_bm_link(part,pic)
            if url:
                parsed=_bm_urlparse(url);host=(parsed.hostname or '').lower()
                if host.startswith('www.'):host=host[4:]
                campaign=''.join(_bm_parse_qs(parsed.query).get('utm_source',[]))
                if host in _BM_HOSTS or any(host.endswith('.'+name) for name in _BM_HOSTS) or campaign.startswith('made-with'):reasons.append('builder_link')
            blip=pic.find('.//'+_BM_A+'blip');embed=blip.get(_BM_R+'embed') if blip is not None else None
            if embed and embed in part.rels and not part.rels[embed].is_external:
                try:
                    if _bm_hashlib.sha256(part.related_part(embed).blob).hexdigest() in _BM_HASHES:reasons.append('badge_image')
                except Exception:pass
            props=pic.find('.//'+_BM_P+'cNvPr');label=' '.join(filter(None,[props.get('name') if props is not None else '',props.get('descr') if props is not None else '',(pic.find('.//'+_BM_A+'hlinkClick').get('tooltip') if pic.find('.//'+_BM_A+'hlinkClick') is not None else '')]))
            corner=width and height and min(x,width-x-cx)<=0.6*_BM_EMU and min(y,height-y-cy)<=0.6*_BM_EMU
            if cx<=1.6*_BM_EMU and cy<=0.5*_BM_EMU and corner and _bm_re.search(r'made.?with|watermark|gamma',label,_bm_re.I):reasons.append('corner_watermark')
            if reasons:found.append({'owner':owner,'pic':pic,'rid':rid,'embed':embed,'reasons':reasons,'part':str(part.partname)})
        # A badge drawn as text (Fable M6, 2026-11-02): a small corner text
        # shape reading "Made with" and a builder's name.
        for sp in list(owner._element.iter(_BM_P+'sp')):
            text=''.join(t.text or '' for t in sp.iter(_BM_A+'t')).strip()
            if not text or len(text)>40 or not _bm_re.search(r'made\s*with\s*(gamma|canva|beautiful(\.ai)?|tome|pitch|decktopus|slidesgo|prezi|genspark)',text,_bm_re.I):continue
            off=sp.find('.//'+_BM_A+'off');ext=sp.find('.//'+_BM_A+'ext')
            x,y=(int(off.get('x',0)),int(off.get('y',0))) if off is not None else (0,0)
            cx,cy=(int(ext.get('cx',0)),int(ext.get('cy',0))) if ext is not None else (0,0)
            if cx*cy>2*_BM_EMU*_BM_EMU: continue
            found.append({'owner':owner,'pic':sp,'rid':None,'embed':None,'reasons':['builder_text'],'part':str(part.partname)})
    return found
def strip_builder_marks(prs):
    removed=[]
    for mark in builder_marks(prs):
        pic=mark['pic'];pic.getparent().remove(pic);part=mark['owner'].part
        for rid in (mark['rid'],mark['embed']):
            if rid and rid in part.rels:
                try:part.drop_rel(rid)
                except Exception:pass
        removed.append({'part':mark['part'],'reasons':mark['reasons']})
    return removed
`;

