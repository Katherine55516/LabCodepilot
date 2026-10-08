/** Deterministic source extraction inside the project's Cowork container.
 * No model participates in file decoding. Original bytes stay in the volume;
 * the bounded, location-tagged text is persisted in the project IR. */
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import * as orch from './orchestrator.mjs';
import { withSemanticIndex } from './ppt-semantic.mjs';
import { normalizeSourceImages } from './ppt-blocks.mjs';
import { OFFICE_FONT_ENV_SCRIPT } from './ppt-fonts.mjs';

export const EXTENSIONS = new Set(['md', 'markdown', 'html', 'htm', 'csv', 'docx', 'pdf', 'xlsx', 'pptx']);
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_PASTE_CHARS = 80_000;

export function validateFile(name, bytes) {
  if (typeof name !== 'string' || name.length > 200 || /[\\/\0]/.test(name)) throw new Error('invalid source file name');
  const ext = name.toLowerCase().split('.').at(-1);
  if (!EXTENSIONS.has(ext)) throw new Error('unsupported format; convert .doc/.xls to .docx/.xlsx');
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_FILE_BYTES) throw new Error('source file must be 1 byte to 8 MB');
  if (ext === 'pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('invalid PDF signature');
  if (['docx', 'xlsx', 'pptx'].includes(ext) && bytes.subarray(0, 2).toString() !== 'PK') throw new Error('invalid Office ZIP signature');
  if (['md', 'markdown', 'html', 'htm', 'csv'].includes(ext)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('text source must be UTF-8'); }
    if (bytes.includes(0)) throw new Error('text source contains binary data');
  }
  return ext;
}

export function normalizePaste(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_PASTE_CHARS) throw new Error('pasted text must be 1 to 80000 characters');
  const images=[],mediaWarnings=[];
  const prose=text.replace(/!\[([^\]]*)\]\(([^)]+)\)/gu,(_all,caption,reference)=>{
    try{
      const image=normalizeSourceImages([{id:'inline-image-'+(images.length+1),dataUrl:reference,caption,required:true}])[0];
      const bytes=Buffer.from(reference.split(',')[1],'base64');
      if(reference.startsWith('data:image/png')&&bytes.length>=24){image.width=bytes.readUInt32BE(16);image.height=bytes.readUInt32BE(20);}
      images.push(image);
    }catch{mediaWarnings.push({code:'source_media_unresolved',required:true,location:'Pasted Markdown image',message:'Referenced source image requires a valid embedded PNG/JPEG or an attached source file: '+caption});}
    return '\n';
  });
  const blocks = prose.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const segments = [];
  let line = 1; let truncated = false;
  let pending = '';
  let pendingStart = null;
  let pendingEnd = null;
  const flush = () => {
    if (!pending) return;
    segments.push({ id: String(segments.length + 1), location: `段落 ${pendingStart.paragraph}${pendingEnd.paragraph !== pendingStart.paragraph ? `–${pendingEnd.paragraph}` : ''} / 行 ${pendingStart.line}${pendingEnd.line !== pendingStart.line ? `–${pendingEnd.line}` : ''}`, text: pending });
    pending = ''; pendingStart = null; pendingEnd = null;
  };
  for (const [blockIndex, block] of blocks.entries()) {
    const blockStartLine = line;
    const blockEndLine = line + block.split('\n').length - 1;
    let remaining = block;
    while (remaining) {
      let end = Math.min(3000, remaining.length);
      if (end < remaining.length) {
        const lineBreak = remaining.lastIndexOf('\n', end);
        const sentenceBreak = Math.max(...['。', '！', '？', '.', ';', '；'].map(mark => remaining.lastIndexOf(mark, end)));
        const wordBreak = remaining.lastIndexOf(' ', end);
        const natural = [lineBreak, sentenceBreak, wordBreak].find(position => position >= 1500);
        if (natural !== undefined) end = natural + 1;
      }
      const value = remaining.slice(0, end).trim();
      if (value) {
        if (pending && pending.length + value.length + 2 > 3000) flush();
        if (!pending) pendingStart = { paragraph: blockIndex + 1, line: blockStartLine };
        pending = pending ? `${pending}\n\n${value}` : value;
        pendingEnd = { paragraph: blockIndex + 1, line: blockEndLine };
      }
      remaining = remaining.slice(end).trimStart();
    }
    line += block.split('\n').length + 1;
  }
  flush();
  const represented = segments.map(s => s.text).join('\n\n');
  return withSemanticIndex({ kind: 'paste', sha256:crypto.createHash('sha256').update(text).digest('hex'), name: '粘贴文本', text: represented, segments, truncated,images,mediaWarnings });
}

const SCRIPT = String.raw`
import base64, csv, hashlib, html, io, json, os, re, sys, zipfile
from html.parser import HTMLParser
${OFFICE_FONT_ENV_SCRIPT}

def raster_source_svg(blob):
    import tempfile,subprocess,xml.etree.ElementTree as svg_ET
    if len(blob)>2*1024*1024 or b'<!DOCTYPE' in blob.upper() or b'<!ENTITY' in blob.upper():raise ValueError('unsafe or oversized source SVG')
    svg=svg_ET.fromstring(blob)
    if svg.tag.rsplit('}',1)[-1]!='svg':raise ValueError('source asset is not SVG')
    if sum(1 for _ in svg.iter())>5000:raise ValueError('source SVG complexity limit exceeded')
    for dimension in ('width','height'):
        extent=re.match(r'^[\d.]+',svg.get(dimension,''))
        if extent and float(extent.group())>8192:raise ValueError('source SVG dimension limit exceeded')
    def external_style(value):
        return bool(re.search(r'@import',value,re.I)) or any(not target.strip().strip('"\x27').startswith('#') for target in re.findall(r'url\(([^)]+)\)',value,re.I))
    for element in svg.iter():
        if element.tag.rsplit('}',1)[-1] in ('script','foreignObject','animate','set'):raise ValueError('active SVG content is unsupported')
        for attr,value in element.attrib.items():
            if attr.rsplit('}',1)[-1].lower().startswith('on'):raise ValueError('SVG event handlers are unsupported')
            if attr.rsplit('}',1)[-1] in ('href','base') and not value.startswith(('#','data:image/png;base64,','data:image/jpeg;base64,')):raise ValueError('external SVG resources are unsupported')
            if external_style(value):raise ValueError('external SVG style resources are unsupported')
        if element.tag.rsplit('}',1)[-1]=='style' and external_style(element.text or ''):raise ValueError('external SVG stylesheet is unsupported')
    with tempfile.TemporaryDirectory(prefix='ppt-source-svg-') as folder:
        source=os.path.join(folder,'asset.svg');open(source,'wb').write(blob)
        profile=os.path.join(folder,'profile');result=subprocess.run(['soffice','-env:UserInstallation=file://'+profile,'--headless','--convert-to','png:draw_png_Export','--outdir',folder,source],capture_output=True,text=True,timeout=30,env=office_font_environment(profile))
        target=os.path.join(folder,'asset.png')
        if result.returncode or not os.path.isfile(target):raise ValueError('SVG raster conversion failed')
        if os.path.getsize(target)>16*1024*1024:raise ValueError('SVG raster exceeds source image budget')
        return open(target,'rb').read()

name = os.environ['PPT_SOURCE_NAME']
ext = name.rsplit('.', 1)[-1].lower()
raw = sys.stdin.buffer.read()
segments = []
images=[];media_warnings=[];image_bytes=0
truncated = False
def source_image(blob,location,caption='',source_refs=None):
    global image_bytes
    sha=hashlib.sha256(blob).hexdigest()
    existing=next((image for image in images if image['imageSha256']==sha or image.get('originalImageSha256')==sha),None)
    if existing:
        if caption and caption not in existing['caption'].split('\n'):existing['caption']='\n'.join(filter(None,[existing['caption'],caption]))
        existing['sourceRefs']=list(dict.fromkeys(existing['sourceRefs']+(source_refs or [])))
        return
    try:
        from PIL import Image as SourceImage
        if blob.lstrip().startswith(b'<') and b'svg' in blob[:512].lower():blob=raster_source_svg(blob)
        image=SourceImage.open(io.BytesIO(blob));image.load()
        if image.format not in ('PNG','JPEG'):
            target=io.BytesIO();image.convert('RGBA').save(target,format='PNG');blob=target.getvalue()
        if len(images)>=64 or image_bytes+len(blob)>16*1024*1024:raise ValueError('source image budget exceeded')
        image_bytes+=len(blob)
        images.append({'id':'source_image_'+sha[:24],'type':'image','required':True,'role':'source_content','location':location,
            'caption':caption,'sourceRefs':source_refs or [],'originalImageSha256':sha,'imageSha256':hashlib.sha256(blob).hexdigest(),'width':image.width,'height':image.height,
            'dataUrl':'data:image/'+('jpeg' if blob[:2]==b'\xff\xd8' else 'png')+';base64,'+base64.b64encode(blob).decode()})
    except Exception as error:media_warnings.append({'code':'source_media_decode','required':True,'location':location,'message':str(error)})

def add(location, value):
    global truncated
    value = re.sub(r'[ \t]+', ' ', str(value or '')).strip()
    if not value: return
    part = 0
    while value:
        if len(segments) >= 1500:
            truncated = True
            return
        cut = min(3000, len(value))
        if cut < len(value):
            line_break = value.rfind('\n', 0, cut)
            sentence_break = max(value.rfind(mark, 0, cut) for mark in ('。', '！', '？', '.', ';', '；'))
            word_break = value.rfind(' ', 0, cut)
            candidate = next((position for position in (line_break, sentence_break, word_break) if position >= 1500), None)
            if candidate is not None: cut = candidate + 1
        piece = value[:cut].strip()
        if piece:
            segments.append({'id': str(len(segments) + 1), 'location': location + (' / 片段 %s' % (part + 1) if part else ''), 'text': piece})
        value = value[cut:].lstrip()
        part += 1

if ext in ('docx', 'xlsx', 'pptx'):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members = archive.infolist()
        if len(members) > 1500 or sum(i.file_size for i in members) > 80 * 1024 * 1024:
            raise ValueError('Office archive is too large after decompression')
        for i in members:
            p = i.filename.replace('\\', '/')
            if p.startswith('/') or '..' in p.split('/'):
                raise ValueError('Office archive contains an unsafe path')

if ext in ('md', 'markdown'):
    content = raw.decode('utf-8-sig')
    for match in re.finditer(r'!\[([^\]]*)\]\(([^)]+)\)',content):
        caption,reference=match.groups()
        if re.fullmatch(r'data:image/(?:png|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+=*',reference):source_image(base64.b64decode(reference.split(',',1)[1]),'Markdown embedded image',caption)
        else:media_warnings.append({'code':'source_media_unresolved','required':True,'location':'Markdown image','message':'Referenced source image requires an attached/embedded asset: '+caption})
    content=re.sub(r'!\[[^\]]*\]\([^)]+\)','\n',content)
    for n, block in enumerate(re.split(r'\n\s*\n', content), 1): add('段落 %s' % n, block)
elif ext in ('html', 'htm'):
    html_content=raw.decode('utf-8-sig')
    for match in re.finditer(r'<svg\b[\s\S]*?</svg\s*>',html_content,re.I):source_image(match.group().encode('utf8'),'HTML inline SVG')
    html_content=re.sub(r'<svg\b[\s\S]*?</svg\s*>','',html_content,flags=re.I)
    class Reader(HTMLParser):
        def __init__(self): super().__init__(); self.skip = 0; self.parts = []
        def handle_starttag(self, tag, attrs):
            if tag=='img' and not self.skip:
                attributes=dict(attrs);reference=attributes.get('src','');caption=attributes.get('alt','')
                if re.fullmatch(r'data:image/(?:png|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+=*',reference):source_image(base64.b64decode(reference.split(',',1)[1]),'HTML embedded image',caption)
                else:media_warnings.append({'code':'source_media_unresolved','required':True,'location':'HTML image','message':'Referenced source image requires an embedded asset: '+caption})
                return
            if tag in ('script', 'style', 'noscript', 'svg'):
                self.skip += 1
                return
            if self.skip: return
            if re.fullmatch(r'h[1-6]', tag):
                self.parts.extend(('\n', '#'*int(tag[1]) + ' '))
            elif tag == 'li': self.parts.extend(('\n', '- '))
            elif tag == 'pre': self.parts.append('\n' + chr(96)*3 + '\n')
            elif tag in ('p', 'div', 'tr', 'br', 'dt', 'dd'): self.parts.append('\n')
            elif tag in ('td', 'th'): self.parts.append(' | ')
        def handle_endtag(self, tag):
            if tag in ('script', 'style', 'noscript', 'svg') and self.skip:
                self.skip -= 1
                return
            if self.skip: return
            if re.fullmatch(r'h[1-6]', tag) or tag in ('p', 'li', 'tr', 'dt', 'dd'): self.parts.append('\n')
            elif tag == 'pre': self.parts.append('\n' + chr(96)*3 + '\n')
        def handle_data(self, data):
            if not self.skip:
                previous = self.parts[-1] if self.parts else ''
                if previous and data and not previous[-1].isspace() and not data[0].isspace(): self.parts.append(' ')
                self.parts.append(data)
    reader = Reader(); reader.feed(html_content)
    for n, block in enumerate(''.join(reader.parts).splitlines(), 1): add('HTML 行 %s' % n, html.unescape(block))
elif ext == 'csv':
    rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
    if not rows: raise ValueError('CSV contains no rows')
    header = [str(value).strip() or ('列%s' % (index + 1)) for index, value in enumerate(rows[0])]
    add('CSV 表头', ' | '.join(header))
    for n, row in enumerate(rows[1:], 2):
        values = ['%s=%s' % (header[index], value.strip()) for index, value in enumerate(row[:len(header)]) if value.strip()]
        if values: add('CSV 行 %s' % n, ' | '.join(values))
elif ext == 'docx':
    from docx import Document
    doc = Document(io.BytesIO(raw))
    for n, p in enumerate(doc.paragraphs, 1):
        style = str(p.style.name if p.style is not None else '')
        match = re.match(r'Heading\s*([1-6])|标题\s*([1-6])', style, re.I)
        heading = '#'*int(match.group(1) or match.group(2)) + ' ' if match else ''
        bullet = '- ' if re.search(r'list bullet|项目符号', style, re.I) else ''
        add('段落 %s' % n, heading + bullet + p.text)
    for t, table in enumerate(doc.tables, 1):
        rows=[[cell.text.replace('|','\\|').replace('\n',' ') for cell in row.cells] for row in table.rows]
        if rows:add('DOCX 表 %s' % t,'\n'.join(['| '+' | '.join(rows[0])+' |','| '+' | '.join(['---']*len(rows[0]))+' |']+['| '+' | '.join(row)+' |' for row in rows[1:]]))
    for rel in doc.part.rels.values():
        if rel.reltype.endswith('/image') and not rel.is_external:source_image(rel.target_part.blob,'DOCX embedded image')
elif ext == 'pdf':
    import pdfplumber
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        if len(pdf.pages) > 100: raise ValueError('PDF has more than 100 pages')
        for n, page in enumerate(pdf.pages, 1): add('PDF 第 %s 页' % n, page.extract_text() or '')
    from pypdf import PdfReader
    for n,page in enumerate(PdfReader(io.BytesIO(raw)).pages,1):
        try:
            for image in page.images:source_image(image.data,'PDF 第 %s 页' % n,image.name)
        except Exception as error:media_warnings.append({'code':'source_media_decode','required':True,'location':'PDF 第 %s 页' % n,'message':str(error)})
elif ext == 'xlsx':
    from openpyxl import load_workbook
    from openpyxl.utils import get_column_letter
    workbook = load_workbook(io.BytesIO(raw), read_only=False, data_only=True)
    for sheet in workbook.worksheets[:20]:
        for number,image in enumerate(sheet._images,1):source_image(image._data(),'工作表 %s 图片 %s'%(sheet.title,number))
        for n, row in enumerate(sheet.iter_rows(max_row=1000, max_col=100, values_only=True), 1):
            cells = ['%s%s=%s' % (get_column_letter(c), n, value) for c, value in enumerate(row, 1) if value is not None]
            if cells: add('工作表 %s 行 %s' % (sheet.title, n), ' | '.join(cells))
elif ext == 'pptx':
    from pptx import Presentation
    deck = Presentation(io.BytesIO(raw))
    def source_math(element):
        local=element.tag.rsplit('}',1)[-1];children=list(element)
        role=lambda name:next((child for child in children if child.tag.rsplit('}',1)[-1]==name),None)
        value=lambda child:source_math(child) if child is not None else ''
        if local in ('rPr','ctrlPr','fPr','sSubPr','sSupPr','sSubSupPr','mPr','radPr','accPr','oMathParaPr'):return ''
        if local=='t':return element.text or ''
        if local=='f':return r'\frac{'+value(role('num'))+'}{'+value(role('den'))+'}'
        if local in ('sSub','sSup','sSubSup'):return '{'+value(role('e'))+'}'+('_{'+value(role('sub'))+'}' if local!='sSup' else '')+('^{'+value(role('sup'))+'}' if local!='sSub' else '')
        if local=='rad':return r'\sqrt'+('['+value(role('deg'))+']' if value(role('deg')) else '')+'{'+value(role('e'))+'}'
        if local=='m':return r'\begin{matrix}'+r'\\'.join('&'.join(source_math(cell) for cell in row if cell.tag.rsplit('}',1)[-1]=='e') for row in children if row.tag.rsplit('}',1)[-1]=='mr')+r'\end{matrix}'
        if local in ('limLow','limUpp'):return '{'+value(role('e'))+'}'+('_{' if local=='limLow' else '^{')+value(role('lim'))+'}'
        if local=='acc':
            char=element.find('.//{http://schemas.openxmlformats.org/officeDocument/2006/math}chr');accent=char.get('{http://schemas.openxmlformats.org/officeDocument/2006/math}val') if char is not None else None
            command={'¯':r'\overline','‾':r'\overline','^':r'\hat','ˆ':r'\hat','~':r'\tilde','˜':r'\tilde','→':r'\vec'}.get(accent)
            if not command:raise ValueError('unsupported source equation accent')
            return command+'{'+value(role('e'))+'}'
        if local in ('oMath','oMathPara','r','e','num','den','sub','sup','deg','lim'):return ''.join(source_math(child) for child in children)
        raise ValueError('unsupported source equation structure: '+local)
    for n, slide in enumerate(deck.slides, 1):
        if n > 100: truncated = True; break
        content = []
        def source_shapes(shapes):
            for shape in shapes:
                yield shape
                if hasattr(shape,'shapes'):yield from source_shapes(shape.shapes)
        for shape in source_shapes(slide.shapes):
            if shape.has_text_frame: content.append(shape.text)
            for equation in shape._element.findall('.//{http://schemas.openxmlformats.org/officeDocument/2006/math}oMath'):
                try:content.append('$$'+source_math(equation)+'$$')
                except ValueError as error:media_warnings.append({'code':'source_math_decode','required':True,'location':'幻灯片 %s'%n,'message':str(error)})
            if shape.has_table:
                rows=[[cell.text.replace('|','\\|').replace('\n',' ') for cell in row.cells] for row in shape.table.rows]
                if rows:content.append('\n'.join(['| '+' | '.join(rows[0])+' |','| '+' | '.join(['---']*len(rows[0]))+' |']+['| '+' | '.join(row)+' |' for row in rows[1:]]))
        add('幻灯片 %s' % n, '\n'.join(content))
        for shape in source_shapes(slide.shapes):
            if hasattr(shape,'image'):source_image(shape.image.blob,'幻灯片 %s / %s'%(n,shape.name),shape.name,[str(len(segments))])

if not segments and not images: raise ValueError('no extractable text; scanned or encrypted files need OCR or conversion')
text = '\n\n'.join(s['text'] for s in segments)
if len(text) > 120000: text = text[:120000]; truncated = True
folder = os.environ.get('PPT_SOURCE_DIR', '/workspace/sources')
os.makedirs(folder, exist_ok=True)
target = os.path.join(folder, hashlib.sha256(raw).hexdigest() + '.' + ext)
if not os.path.exists(target):
    tmp = target + '.part'
    with open(tmp, 'wb') as f: f.write(raw)
    os.replace(tmp, target)
print(json.dumps({'kind': 'file', 'name': name, 'extension': ext, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'segments': segments, 'text': text, 'truncated': truncated,'images':images,'mediaWarnings':media_warnings}, ensure_ascii=False))
`;

export async function extractFile(project, name, bytes, io = {}) {
  validateFile(name, bytes);
  if(io.runPython)return withSemanticIndex(await io.runPython(project,SCRIPT,bytes,{PPT_SOURCE_NAME:name}));
  const { name: container } = await orch.ensureContainer(project.id, project.uid, orch.KIND_PPT);
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', '-u', String(orch.AGENT_UID), '-e', `PPT_SOURCE_NAME=${name}`, container, 'python3', '-c', SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let error = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', c => { output += c; if (output.length > 24*1024*1024) child.kill(); });
    child.stderr.on('data', c => { error = (error + c).slice(-3000); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`source extraction failed: ${error.slice(-450)}`));
      try { resolve(withSemanticIndex(JSON.parse(output))); } catch { reject(new Error('source extractor returned invalid JSON')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}

export function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
export const _internals = { SCRIPT };
