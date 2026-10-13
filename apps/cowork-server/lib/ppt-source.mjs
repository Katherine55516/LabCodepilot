import {DOCUMENT_EXTRACTION_SCRIPT} from './ppt-document-extraction-python.mjs';
import {SOURCE_MATH_SCRIPT} from './ppt-source-math-python.mjs';
/** Deterministic source extraction inside the project's Cowork container.
 * No model participates in file decoding. Original bytes stay in the volume;
 * the bounded, location-tagged text is persisted in the project IR. */
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import * as orch from './orchestrator.mjs';
import { withSemanticIndex } from './ppt-semantic.mjs';
import { normalizeSourceImages } from './ppt-blocks.mjs';
import { OFFICE_FONT_ENV_SCRIPT } from './ppt-fonts.mjs';

export const EXTENSIONS = new Set(['md', 'markdown', 'txt', 'text', 'html', 'htm', 'csv', 'docx', 'pdf', 'xlsx', 'pptx']);
const PLAIN_TEXT = new Set(['txt', 'text']);
// Plain-text files from Windows/zh-CN/zh-HK editors are often UTF-16 (BOM),
// GB18030 or Big5; the extractor picks the decoding and records a warning.
function decodablePlainText(bytes) {
  if (bytes.length >= 2 && ((bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xFE && bytes[1] === 0xFF))) return 'utf-16';
  for (const encoding of ['utf-8', 'gb18030', 'big5']) {
    try { new TextDecoder(encoding, { fatal: true }).decode(bytes); return encoding; } catch { /* next candidate */ }
  }
  return null;
}
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_PASTE_CHARS = 80_000;

export function validateFile(name, bytes) {
  if (typeof name !== 'string' || name.length > 200 || /[\\/\0]/.test(name)) throw new Error('invalid source file name');
  const ext = name.toLowerCase().split('.').at(-1);
  if (!EXTENSIONS.has(ext)) throw new Error('unsupported format; convert .doc/.xls to .docx/.xlsx');
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_FILE_BYTES) throw new Error('source file must be 1 byte to 8 MB');
  if (ext === 'pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('invalid PDF signature');
  if (['docx', 'xlsx', 'pptx'].includes(ext) && bytes.subarray(0, 2).toString() !== 'PK') throw new Error('invalid Office ZIP signature');
  if (PLAIN_TEXT.has(ext)) {
    const encoding = decodablePlainText(bytes);
    if (!encoding) throw new Error('text source must be UTF-8, UTF-16 (with BOM), GB18030 or Big5');
    if (encoding !== 'utf-16' && bytes.includes(0)) throw new Error('text source contains binary data');
  } else if (['md', 'markdown', 'html', 'htm', 'csv'].includes(ext)) {
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
  // Fences are atomic source objects; blank lines and indentation inside them
  // must not pass through paragraph trimming or ordinary chunk splitting.
  if (/^\s*(?:`{3,}|~{3,})/m.test(prose)) {
    const segments = []; let pending = [], code = null;
    const flush = () => { if (pending.join('\n').trim()) segments.push({ location:'Markdown block', text:pending.join('\n') }); pending=[]; };
    for (const line of prose.replace(/\r\n?/g,'\n').split('\n')) {
      const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (code) {
        if (fence && fence[1][0]===code.mark[0] && fence[1].length>=code.mark.length && !fence[2].trim()) {
          segments.push({location:'Fenced code',kind:'code',language:code.language,text:code.lines.join('\n')}); code=null;
        } else code.lines.push(line);
      } else if (fence) { flush(); code={mark:fence[1],language:fence[2].trim(),lines:[]}; }
      else pending.push(line);
    }
    if (code) segments.push({location:'Unclosed fenced code',kind:'code',language:code.language,text:code.lines.join('\n')});
    flush(); segments.forEach((segment,index)=>segment.id=String(index+1));
    return withSemanticIndex({kind:'paste',sha256:crypto.createHash('sha256').update(text).digest('hex'),name:'粘贴文本',text:prose,segments,truncated:false,images,mediaWarnings});
  }
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

${SOURCE_MATH_SCRIPT}

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

def add(location, value, **extra):
    global truncated
    value = str(value or '').replace('\r\n','\n').replace('\r','\n')
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
        piece = value[:cut]
        if piece:
            segments.append({'id': str(len(segments) + 1), 'location': location + (' / 片段 %s' % (part + 1) if part else ''), 'text': piece, **extra})
        value = value[cut:]
        part += 1

# Frequent Han characters in both scripts; used only to choose between legacy
# GB18030 and Big5 decodings of a non-UTF-8 plain-text file.
COMMON_HAN=set('的一是在不了有和人这這中大为為上个個国國我以要他时時来來用们們生到作地于於出就分对對成会會可主发發年动動同工也能下过過子说說产產种種面而方后後多定行学學法所民得经經十三之进進着著等部度家电電力里裡如水化高自二理起小物现現实實加量都两兩体體制机機当當使点點从從业業本去把性好应應开開它合还還因由其些然前外天政四日那社义義事平形相全表间間样樣与與关關各重新线線内內数數正心反你明看原又么麼利比或但质質气氣第向道命此变變条條只没沒结結解问問意建月公无無系军軍很情者最立代想已通并並提直题題党黨程展五果料象员員革位入常文总總次品式活设設及管特件长長求老头頭基资資边邊流路级級少图圖山统統接知较較将將组組见見计計别別她手角期根论論运運农農指几幾九区區强強放决決西被干幹做必战戰先回则則任取据據处處世车車')
def decode_plain_text(blob):
    if blob[:2] in (b'\xff\xfe',b'\xfe\xff'):return blob.decode('utf-16')
    try:return blob.decode('utf-8-sig')
    except UnicodeDecodeError:pass
    candidates=[]
    for encoding in ('gb18030','big5hkscs'):
        try:decoded=blob.decode(encoding)
        except UnicodeDecodeError:continue
        candidates.append((sum(1 for c in decoded if c in COMMON_HAN),encoding,decoded))
    if not candidates:raise ValueError('text source must be UTF-8, UTF-16 (with BOM), GB18030 or Big5')
    _,encoding,decoded=max(candidates)
    media_warnings.append({'code':'source_text_encoding','required':False,'location':'Text','message':'Plain text decoded as %s; check CJK characters before publishing.'%encoding})
    return decoded

PLAIN_ENDING=re.compile(r'[.,;:!?。，；：！？、…]$')
def plain_text_markdown(content):
    """Recover headings/bullets from plain text without inventing structure.
    Files already written in Markdown are passed through unchanged."""
    lines=content.replace('\r\n','\n').replace('\r','\n').split('\n')
    if any(re.match(r'^#{1,6}\s+\S',line) for line in lines):return content
    def blank(index):return index<0 or index>=len(lines) or not lines[index].strip()
    def next_text(index):
        index+=1
        while index<len(lines) and not lines[index].strip():index+=1
        return lines[index].strip() if index<len(lines) else ''
    levels={}
    for index,line in enumerate(lines):
        text=line.strip();following=lines[index+1].strip() if index+1<len(lines) else ''
        if not text or len(text)>100:continue
        if re.fullmatch(r'={3,}',following):levels[index]=1;continue
        if re.fullmatch(r'-{3,}',following) and blank(index-1):levels[index]=2;continue
        if not (blank(index-1) and blank(index+1)) or PLAIN_ENDING.search(text):continue
        if re.match(r'^第[一二三四五六七八九十百零〇\d]+[章篇部卷]',text) or re.match(r'^(?:chapter|part)\s+[\divxlc]+\b',text,re.I):levels[index]=1
        elif re.match(r'^第[一二三四五六七八九十百零〇\d]+[节節]',text) or re.match(r'^section\s+\d',text,re.I):levels[index]=2
        elif re.match(r'^[一二三四五六七八九十]+、\S',text):levels[index]=1
        elif re.match(r'^[（(][一二三四五六七八九十]+[）)]\s*\S',text):levels[index]=2
        elif re.match(r'^\d+(?:\.\d+){1,3}\s+\S',text):levels[index]=text.split()[0].count('.')+1
        elif re.match(r'^\d+[.、]?\s+\S',text) and not re.match(r'^\d+[.、)]?\s',next_text(index)):levels[index]=1
        elif re.fullmatch(r'[A-Z][A-Z0-9&\'’ -]{2,59}',text) and ' ' in text:levels[index]=1
    first=next((index for index,line in enumerate(lines) if line.strip()),None)
    if first is not None and first not in levels and blank(first+1) and len(lines[first].strip())<=100 and not PLAIN_ENDING.search(lines[first].strip()):
        levels={index:min(6,level+1) for index,level in levels.items()};levels[first]=1
    output=[]
    for index,line in enumerate(lines):
        text=line.strip()
        if index-1 in levels and re.fullmatch(r'[=-]{3,}',text):continue
        if index in levels:output.append('#'*levels[index]+' '+text);continue
        output.append(re.sub(r'^(\s*)[•·●▪◦‣–]\s+',r'\1- ',line))
    return '\n'.join(output)

def add_table(location, rows):
    if not rows:return
    width=max(len(row) for row in rows)
    matrix=[[str(cell) if cell is not None else '' for cell in row]+['']*(width-len(row)) for row in rows]
    text='\n'.join('| '+' | '.join(cell.replace('\\','\\\\').replace('|','\\|').replace('\n','<br>') for cell in row)+' |' for row in matrix)
    segments.append({'id':str(len(segments)+1),'location':location,'kind':'table','rows':matrix,'text':text})

def add_markdown(location, content):
    pending=[];code=None
    def prose(lines):add(location,'\n'.join(lines))
    for line in content.replace('\r\n','\n').replace('\r','\n').split('\n'):
        match=re.match(r'^\s*('+chr(96)+r'{3,}|~{3,})(.*)$',line)
        if code is not None:
            if match and match.group(1)[0]==code['mark'][0] and len(match.group(1))>=len(code['mark']) and not match.group(2).strip():
                segments.append({'id':str(len(segments)+1),'location':location+' code','kind':'code','language':code['language'],'text':'\n'.join(code['lines'])});code=None
            else:code['lines'].append(line)
        elif match:
            prose(pending);pending=[];code={'mark':match.group(1),'language':match.group(2).strip(),'lines':[]}
        else:pending.append(line)
    if code is not None:segments.append({'id':str(len(segments)+1),'location':location+' unclosed code','kind':'code','language':code['language'],'text':'\n'.join(code['lines'])})
    prose(pending)

if ext in ('docx', 'xlsx', 'pptx'):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members = archive.infolist()
        if len(members) > 1500 or sum(i.file_size for i in members) > 80 * 1024 * 1024:
            raise ValueError('Office archive is too large after decompression')
        for i in members:
            p = i.filename.replace('\\', '/')
            if p.startswith('/') or '..' in p.split('/'):
                raise ValueError('Office archive contains an unsafe path')

${DOCUMENT_EXTRACTION_SCRIPT}

if ext in ('md', 'markdown', 'txt', 'text'):
    content = raw.decode('utf-8-sig') if ext in ('md','markdown') else plain_text_markdown(decode_plain_text(raw))
    # YAML front matter is metadata, not slide prose; its title is the document
    # title when the body has no level-1 heading.
    front=re.match(r'^---[ \t]*\n((?:[^\n]*\n){1,60}?)---[ \t]*\n',content)
    if front and all(re.match(r'^(?:[\w-]+\s*:.*|\s+.*|\s*-.*|)$',line) for line in front.group(1).split('\n')):
        content=content[front.end():]
        title=re.search(r'^title\s*:\s*["\']?(.+?)["\']?\s*$',front.group(1),re.M)
        if title and not re.search(r'^#\s+\S',content,re.M):content='# '+title.group(1)+'\n\n'+content
    for match in re.finditer(r'!\[([^\]]*)\]\(([^)]+)\)',content):
        caption,reference=match.groups()
        if re.fullmatch(r'data:image/(?:png|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+=*',reference):source_image(base64.b64decode(reference.split(',',1)[1]),'Markdown embedded image',caption)
        else:media_warnings.append({'code':'source_media_unresolved','required':True,'location':'Markdown image','message':'Referenced source image requires an attached/embedded asset: '+caption})
    content=re.sub(r'!\[[^\]]*\]\([^)]+\)','\n',content)
    add_markdown('Markdown' if ext in ('md','markdown') else 'Text',content)
elif ext in ('html', 'htm'):
    html_content=raw.decode('utf-8-sig')
    for match in re.finditer(r'<svg\b[\s\S]*?</svg\s*>',html_content,re.I):source_image(match.group().encode('utf8'),'HTML inline SVG')
    html_content=re.sub(r'<svg\b[\s\S]*?</svg\s*>','',html_content,flags=re.I)
    SUPERSCRIPT=str.maketrans('0123456789+-−=()','⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁼⁽⁾');SUBSCRIPT=str.maketrans('0123456789+-−=()','₀₁₂₃₄₅₆₇₈₉₊₋₋₌₍₎')
    INLINE={'strong':'**','b':'**','em':'*','i':'*','code':chr(96)}
    class Reader(HTMLParser):
        def __init__(self):
            super().__init__();self.skip=0;self.parts=[];self.rows=None;self.row=None;self.cell=None;self.pre=False;self.lists=[];self.inline=[]
        def target(self):return self.cell if self.cell is not None else self.parts
        def flush(self):
            add_markdown('HTML',''.join(self.parts));self.parts=[]
        def handle_starttag(self,tag,attrs):
            attributes=dict(attrs)
            if tag in ('script','style','noscript','svg','title','nav','template','form'):self.skip+=1;return
            if self.skip:return
            if tag=='img':
                reference=attributes.get('src','');caption=attributes.get('alt','')
                if re.fullmatch(r'data:image/(?:png|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+=*',reference):source_image(base64.b64decode(reference.split(',',1)[1]),'HTML embedded image',caption)
                else:media_warnings.append({'code':'source_media_unresolved','required':True,'location':'HTML image','message':'Referenced source image requires an embedded asset: '+caption})
                return
            if tag in INLINE and not self.pre or tag in ('sup','sub'):
                # Inline markers are emitted only around a non-blank, trimmed
                # span; '** x **' would otherwise leak literal asterisks.
                self.inline.append((tag,len(self.target())));return
            if tag=='table':self.flush();self.rows=[];return
            if self.rows is not None:
                if tag=='tr':self.row=[]
                elif tag in ('td','th'):
                    self.cell=[]
                    if attributes.get('rowspan','1')!='1' or attributes.get('colspan','1')!='1':media_warnings.append({'code':'source_table_span','required':True,'location':'HTML table','message':'Merged-cell relationships require explicit review; original file retained.'})
                elif tag=='br' and self.cell is not None:self.cell.append('\n')
                return
            if tag=='pre':self.pre=True;self.parts.append('\n'+chr(96)*3+'\n');return
            if self.pre:
                if tag=='code' and self.parts and re.search(r'language-([\w+-]+)',attributes.get('class','')):
                    language=re.search(r'language-([\w+-]+)',attributes.get('class','')).group(1);self.parts[-1]=self.parts[-1].rstrip('\n')+language+'\n'
                return
            if tag in ('ol','ul'):
                start=attributes.get('start','1')
                self.lists.append(int(start) if tag=='ol' and start.lstrip('-').isdigit() else None);return
            if re.fullmatch(r'h[1-6]',tag):self.parts.extend(('\n','#'*int(tag[1])+' '))
            elif tag=='li':
                indent='  '*max(0,len(self.lists)-1)
                if self.lists and self.lists[-1] is not None:
                    self.parts.extend(('\n',indent+'%s. '%self.lists[-1]));self.lists[-1]+=1
                else:self.parts.extend(('\n',indent+'- '))
            elif tag in ('p','div','br','dt','dd'):self.parts.append('\n')
        def handle_endtag(self,tag):
            if tag in ('script','style','noscript','svg','title','nav','template','form') and self.skip:self.skip-=1;return
            if self.skip:return
            if self.inline and self.inline[-1][0]==tag:
                _,start=self.inline.pop();target=self.target();span=''.join(target[start:])
                if tag=='sup':target[start:]=[span.translate(SUPERSCRIPT) if re.fullmatch(r'[0-9+\-−=()]+',span) else span]
                elif tag=='sub':target[start:]=[span.translate(SUBSCRIPT) if re.fullmatch(r'[0-9+\-−=()]+',span) else span]
                elif span and span==span.strip() and INLINE[tag] not in span and '\n' not in span:target[start:]=[INLINE[tag]+span+INLINE[tag]]
                return
            if self.rows is not None:
                if tag in ('td','th') and self.cell is not None:
                    if self.row is None:self.row=[]
                    self.row.append(''.join(self.cell));self.cell=None
                elif tag=='tr' and self.row is not None:self.rows.append(self.row);self.row=None
                elif tag=='table':add_table('HTML table',self.rows);self.rows=None
                return
            if tag=='pre':self.pre=False;self.parts.append('\n'+chr(96)*3+'\n');return
            if tag in ('ol','ul') and self.lists:self.lists.pop();return
            if not self.pre and (re.fullmatch(r'h[1-6]',tag) or tag in ('p','li','dt','dd')):self.parts.append('\n')
        def handle_data(self,data):
            if self.skip:return
            if self.cell is not None:self.cell.append(data)
            elif self.rows is None:self.parts.append(data)
    reader=Reader()
    # The document <title> names the deck only when the body has no <h1>.
    page_title=re.search(r'<title[^>]*>([\s\S]*?)</title\s*>',html_content,re.I)
    if page_title and html.unescape(page_title.group(1)).strip() and not re.search(r'<h1\b',html_content,re.I):reader.parts.append('# '+re.sub(r'\s+',' ',html.unescape(page_title.group(1))).strip()+'\n')
    reader.feed(html_content);reader.flush()
elif ext == 'csv':
    rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
    if not rows: raise ValueError('CSV contains no rows')
    add_table('CSV 表格',rows)
elif ext == 'docx':
    from docx import Document
    from docx.table import Table as DocxTable
    W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    doc = Document(io.BytesIO(raw))
    import copy,xml.etree.ElementTree as source_ET
    notes={}
    with zipfile.ZipFile(io.BytesIO(raw)) as source_zip:
        for part,tag in [('word/footnotes.xml','footnote'),('word/endnotes.xml','endnote')]:
            if part in source_zip.namelist():
                for note in source_ET.fromstring(source_zip.read(part)).findall(W+tag):
                    if int(note.get(W+'id','-1'))>=0:notes[(tag,note.get(W+'id'))]=note
    emitted_notes=set()
    def docx_extras(child,location):
        for index,box in enumerate(child.iter(W+'txbxContent'),1):
            add(location+' / 文本框 '+str(index),source_formula_text(box,location+' textbox'),sourceContainer='textbox')
        for kind in ('footnote','endnote'):
            for ref in child.iter(W+kind+'Reference'):
                key=(kind,ref.get(W+'id'))
                if key in notes and key not in emitted_notes:
                    emitted_notes.add(key);add(location+' / '+kind+' '+str(key[1]),source_formula_text(notes[key],location+' '+kind),sourceContainer=kind,referenceId=key[1])
    def without_textboxes(child):
        retained=copy.deepcopy(child)
        for box in list(retained.iter(W+'txbxContent')):box.getparent().remove(box)
        return retained
    # Body order matters: a table belongs between the paragraphs that introduce
    # and discuss it. List numbers come from numbering.xml, not from style names.
    numbering={}
    try:
        root=doc.part.numbering_part.element
        def level_format(level):
            fmt=level.find(W+'numFmt');start=level.find(W+'start')
            return (fmt.get(W+'val') if fmt is not None else 'decimal',int(start.get(W+'val')) if start is not None else 1)
        abstract={item.get(W+'abstractNumId'):{level.get(W+'ilvl'):level_format(level) for level in item.findall(W+'lvl')} for item in root.findall(W+'abstractNum')}
        for item in root.findall(W+'num'):
            reference=item.find(W+'abstractNumId')
            if reference is not None:numbering[item.get(W+'numId')]=abstract.get(reference.get(W+'val'),{})
    except Exception:numbering={}
    counters={};style_counters={};paragraph_number=0;table_number=0
    def style_name(element):
        style=element.find(W+'pPr/'+W+'pStyle')
        if style is None:return ''
        try:return str(doc.styles.get_by_id(style.get(W+'val'),1).name or '')
        except Exception:return style.get(W+'val') or ''
    for child in doc.element.body.iterchildren():
        if child.tag==W+'p':
            paragraph_number+=1;style=style_name(child)
            match = re.match(r'Heading\s*([1-6])|标题\s*([1-6])|標題\s*([1-6])', style, re.I)
            heading = '#'*int(match.group(1) or match.group(2) or match.group(3)) + ' ' if match else '# ' if re.fullmatch(r'Title|标题|標題',style.strip(),re.I) else ''
            prefix='';number=child.find(W+'pPr/'+W+'numPr')
            if heading:pass
            elif number is not None and number.find(W+'numId') is not None and number.find(W+'numId').get(W+'val')!='0':
                identifier=number.find(W+'numId').get(W+'val');level=number.find(W+'ilvl');level=level.get(W+'val') if level is not None else '0'
                fmt,start=numbering.get(identifier,{}).get(level,('decimal',1));depth=int(level)
                if fmt in ('bullet','none'):prefix='  '*depth+'- '
                else:
                    counters[(identifier,level)]=counters.get((identifier,level),start-1)+1
                    for key in [key for key in counters if key[0]==identifier and int(key[1])>depth]:del counters[key]
                    prefix='  '*depth+'%s. '%counters[(identifier,level)]
            elif re.search(r'list bullet|项目符号|項目符號', style, re.I):prefix='- '
            elif re.search(r'list number|编号|編號', style, re.I):
                style_counters[style]=style_counters.get(style,0)+1;prefix='%s. '%style_counters[style]
            if not re.search(r'list number|编号|編號', style, re.I) and ''.join(t.text or '' for t in child.iter(W+'t')).strip():style_counters.clear()
            add('段落 %s' % paragraph_number, heading + prefix + source_formula_text(without_textboxes(child),'段落 %s'%paragraph_number))
            docx_extras(child,'段落 %s'%paragraph_number)
        elif child.tag==W+'tbl':
            table_number+=1;table=DocxTable(child,doc);rows=[];previous=[];merged=False
            for row in table.rows:
                cells=[];seen=[];current=[]
                for column,cell in enumerate(row.cells):
                    # python-docx repeats a merged cell's <w:tc> for every grid
                    # column/row it spans; compare retained elements by identity.
                    element=cell._tc;current.append(element)
                    if any(element is other for other in seen) or (column<len(previous) and previous[column] is element):cells.append('');merged=True;continue
                    seen.append(element);cells.append(source_formula_text(element,'source table').replace('|','\\|').replace('\n',' '))
                rows.append(cells);previous=current
            if merged:media_warnings.append({'code':'source_table_span','required':False,'location':'DOCX 表 %s'%table_number,'message':'Merged cells are kept once (other spanned positions are blank); review header/row relationships.'})
            docx_extras(child,'DOCX 表 %s'%table_number)
            if rows:add('DOCX 表 %s' % table_number,'\n'.join(['| '+' | '.join(rows[0])+' |','| '+' | '.join(['---']*len(rows[0]))+' |']+['| '+' | '.join(row)+' |' for row in rows[1:]]))
    for rel in doc.part.rels.values():
        if rel.reltype.endswith('/image') and not rel.is_external:source_image(rel.target_part.blob,'DOCX embedded image')
elif ext == 'pdf':
    import pdfplumber
    from collections import Counter
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        if len(pdf.pages) > 100: raise ValueError('PDF has more than 100 pages')
        pages=[]
        for page in pdf.pages:
            tables=page.find_tables()
            text_page=page.filter(lambda obj:not any(t.bbox[0]<=obj.get('x0',-1)<=t.bbox[2] and t.bbox[1]<=obj.get('top',-1)<=t.bbox[3] for t in tables)) if tables else page
            lines=None;reading=None
            if hasattr(text_page,'extract_text_lines'):
                try:lines,reading=pdf_reading_lines(text_page)
                except Exception as error:media_warnings.append({'code':'source_pdf_reading_order','required':True,'location':'PDF 第 %s 页'%(len(pages)+1),'message':str(error)})
            if lines is None:lines=[{'text':value,'size':0,'readingBand':0,'top':index*12} for index,value in enumerate((text_page.extract_text() or '').split('\n'))]
            if reading:media_warnings.append({'code':'source_pdf_reading_order','required':reading['status']=='ambiguous','location':'PDF 第 %s 页'%(len(pages)+1),'message':reading['status'],'geometry':reading})
            pages.append((page,tables,lines))
        # PDF has no heading markup: infer at most three heading sizes that are
        # clearly larger than the dominant body size, on short unpunctuated lines.
        weights=Counter()
        for _,_,lines in pages:
            for line in lines:
                if line['size']:weights[line['size']]+=len(line['text'])
        body=weights.most_common(1)[0][0] if weights else 0
        def heading_like(value):
            value=value.strip();return 0<len(value)<=120 and not re.search(r'[.,;:。，；：、]$',value) and re.search(r'[A-Za-z\u3400-\u9fff]',value)
        sizes=sorted({line['size'] for _,_,lines in pages for line in lines if body and line['size']>=body*1.18 and heading_like(line['text'])},reverse=True)[:3]
        # Running headers/footers and page numbers repeat at page edges.
        def edge_key(value):return re.sub(r'\d+','#',value.strip())
        edges=Counter(key for _,_,lines in pages for key in {edge_key(line['text']) for line in lines[:2]+lines[-2:] if line['text'].strip()})
        repeated={key for key,count in edges.items() if len(pages)>=3 and count>=max(3,0.6*len(pages))}
        page_number=re.compile(r'^(?:page\s*)?#(?:\s*(?:/|of)\s*#)?$|^第\s*#\s*[页頁]$|^[-–—]\s*#\s*[-–—]$',re.I)
        for n,(page,tables,lines) in enumerate(pages,1):
            location='PDF 第 %s 页'%n;output=[];ordered=[]
            if not any(line['text'].strip() for line in lines):scanned_page_ocr(raw,n-1,location)
            for index,line in enumerate(lines):
                value=line['text'];key=edge_key(value)
                if (index<2 or index>=len(lines)-2) and (key in repeated or page_number.match(key.strip())):continue
                level=sizes.index(line['size'])+1 if line['size'] in sizes and heading_like(value) else 0
                if level and output and output[-1].startswith('#'*level+' ') and not output[-1].startswith('#'*(level+1)):output[-1]+=' '+value.strip();continue
                rendered=('#'*level+' '+value.strip()) if level else value
                output.append(rendered);ordered.append((line.get('readingBand',0),line.get('top',index*12),rendered))
            text='\n'.join(output)
            # With real headings, a section continues across page breaks.
            # Native tables are interleaved with their introducing text below.
            for ti,table in enumerate(tables,1):
                rows=[[str(cell or '').replace('|','\\|').replace('\n',' ') for cell in row] for row in table.extract()]
                if rows:
                    before=[line for line in lines if line.get('top',0)<=table.bbox[1] and line.get('x0',0)<=table.bbox[0]+10]
                    band=before[-1].get('readingBand',0) if before else 0
                    ordered.append((band,table.bbox[1],'\n'.join(['| '+' | '.join(rows[0])+' |','| '+' | '.join(['---']*len(rows[0]))+' |']+['| '+' | '.join(row)+' |' for row in rows[1:]])))
            add(location,'\n'.join(block[2] for block in sorted(ordered,key=lambda block:(block[0],block[1]))),**({'continuesSection':True} if sizes else {}))
            # PDF glyphs do not encode Office/TeX mathematical structure. Detect
            # ambiguous formulas rather than inventing indices from plain text.
            if re.search(r'(?:[α-ωΑ-Ω]|[∑∫√²³⁰¹⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉])',text) or '(cid:' in text or '\ufffd' in text:
                media_warnings.append({'code':'source_pdf_math_requires_confirmation','required':True,'location':location,'message':'PDF contains mathematical or undecodable glyphs without an authoritative formula tree. Supply TeX/Office source or confirm a formula reconstruction before publication.'})

    from pypdf import PdfReader
    for n,page in enumerate(PdfReader(io.BytesIO(raw)).pages,1):
        try:
            for image in page.images:source_image(image.data,'PDF 第 %s 页' % n,image.name)
        except Exception as error:media_warnings.append({'code':'source_media_decode','required':True,'location':'PDF 第 %s 页' % n,'message':str(error)})
elif ext == 'xlsx':
    from openpyxl import load_workbook
    import datetime
    workbook = load_workbook(io.BytesIO(raw), read_only=False, data_only=True)
    formulas = load_workbook(io.BytesIO(raw), read_only=False, data_only=False)
    # Show what Excel shows: cached results in their number format. A formula
    # without a cached result cannot be evaluated here and is reported.
    def xlsx_text(cell,formula):
        value=cell.value
        if value is None:
            source=formula.value if formula is not None else None
            if isinstance(source,str) and source.startswith('='):uncached.append(cell.coordinate);return source
            return ''
        if isinstance(value,bool):return 'TRUE' if value else 'FALSE'
        if isinstance(value,datetime.datetime):return value.date().isoformat() if value.time()==datetime.time(0) else value.isoformat(sep=' ',timespec='minutes')
        if isinstance(value,(datetime.date,datetime.time)):return value.isoformat()
        if isinstance(value,(int,float)):
            pattern=str(cell.number_format or 'General').split(';')[0]
            decimals=lambda found:len(found.group(1) or '')
            found=re.fullmatch(r'0(?:\.(0+))?%',pattern)
            if found:return ('%.'+str(decimals(found))+'f%%')%(value*100)
            found=re.fullmatch(r'[^0#]*#,##0(?:\.(0+))?[^0#]*',pattern)
            if found:
                # Literal text only: drop padding (_x), fill (*x) and [$€-409] locale codes.
                literal=lambda part:re.sub(r'_.|\*.|["\\]','',re.sub(r'\[\$([^\]-]*)[^\]]*\]',r'\1',part))
                return literal(pattern.split('#,##0')[0]).lstrip()+format(value,',.%df'%decimals(found))+literal(re.split(r'#,##0(?:\.0+)?',pattern)[-1]).rstrip()
            found=re.fullmatch(r'0(?:\.(0+))?',pattern)
            if found:return ('%.'+str(decimals(found))+'f')%value
            return str(value) if isinstance(value,int) else ('%.15g'%value)
        return str(value)
    for sheet in workbook.worksheets[:20]:
        uncached=[];formula_sheet=formulas[sheet.title]
        for number,image in enumerate(sheet._images,1):source_image(image._data(),'工作表 %s 图片 %s'%(sheet.title,number))
        for number,chart in enumerate(formula_sheet._charts,1):
            try:xlsx_chart_source(chart,sheet,formula_sheet,'工作表 %s 图表 %s'%(sheet.title,number))
            except Exception as error:media_warnings.append({'code':'source_xlsx_chart_requires_confirmation','required':True,'location':'工作表 %s 图表 %s'%(sheet.title,number),'message':str(error)})
        rows_limit=min(1000,sheet.max_row);columns_limit=min(100,sheet.max_column)
        if sheet.max_row>1000 or sheet.max_column>100:truncated=True
        matrix=[[xlsx_text(sheet.cell(r,c),formula_sheet.cell(r,c)) for c in range(1,columns_limit+1)] for r in range(1,rows_limit+1)]
        matrix=[row for row in matrix if any(value.strip() for value in row)]
        keep=[c for c in range(columns_limit) if any(row[c].strip() for row in matrix)]
        matrix=[[row[c] for c in keep] for row in matrix]
        label=sheet.title+('（隐藏）' if sheet.sheet_state!='visible' else '')
        if not matrix:continue
        add('工作表 '+label+' 标题','# '+sheet.title)
        add_table('工作表 '+label,matrix)
        if uncached:media_warnings.append({'code':'source_xlsx_formula_uncached','required':True,'location':'工作表 '+label,'message':'Formula cells have no saved result (%s); recalculate and save the workbook in Excel/LibreOffice so values, not formulas, are presented.'%', '.join(uncached[:8])})
        if sheet.merged_cells.ranges:media_warnings.append({'code':'source_table_span','required':False,'location':'工作表 '+label,'message':'Merged ranges %s keep their value in the top-left cell only; review header relationships.'%', '.join(str(r) for r in list(sheet.merged_cells.ranges)[:6])})
        if sheet.sheet_state!='visible':media_warnings.append({'code':'source_hidden_sheet','required':False,'location':'工作表 '+label,'message':'Hidden worksheet included; remove it from the workbook if it should not be presented.'})
elif ext == 'pptx':
    from pptx import Presentation
    deck = Presentation(io.BytesIO(raw))
    for n, slide in enumerate(deck.slides, 1):
        if n > 100: truncated = True; break
        content = []
        def source_shapes(shapes):
            for shape in shapes:
                yield shape
                if hasattr(shape,'shapes'):yield from source_shapes(shape.shapes)
        # The title placeholder names the slide's section for the syllabus.
        title=slide.shapes.title
        title_text=' '.join(title.text_frame.text.split()) if title is not None and title.has_text_frame else ''
        if title_text:content.append('# '+title_text)
        for shape in source_shapes(slide.shapes):
            if title_text and shape.shape_id==title.shape_id:continue
            if shape.has_text_frame: content.append(source_formula_text(shape._element,'幻灯片 %s'%n))
            if shape.has_table:
                rows=[[source_formula_text(cell._tc,'source table').replace('|','\\|').replace('\n',' ') for cell in row.cells] for row in shape.table.rows]
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
