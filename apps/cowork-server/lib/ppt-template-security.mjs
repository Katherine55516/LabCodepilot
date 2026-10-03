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
            names=set(); objects=0; slide_count=0
            for part in parts:
                name=part.filename; lower=name.lower()
                if name in names: raise ValueError('template_corrupted: duplicate ZIP entry')
                names.add(name)
                if name.startswith(('/','\\')) or '\\' in name or '..' in name.split('/') or re.match(r'^[A-Za-z]:',name):
                    raise ValueError('template_unsafe: ZIP path traversal')
                if part.flag_bits & 1: raise ValueError('template_unsupported: encrypted archive')
                if part.file_size/max(1,part.compress_size)>lim('ratio',200): raise ValueError('template_unsafe: compression ratio exceeds limit')
                if any(x in lower for x in ('vbaproject','/embeddings/','activex','oleobject')): raise ValueError('template_unsafe: macro or embedded executable object')
                if re.match(r'^ppt/slides/slide\d+\.xml$',lower): slide_count+=1
                blob=archive.read(part)
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
