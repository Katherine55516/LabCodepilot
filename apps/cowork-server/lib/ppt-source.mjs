/** Deterministic source extraction inside the project's Cowork container.
 * No model participates in file decoding. Original bytes stay in the volume;
 * the bounded, location-tagged text is persisted in the project IR. */
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import * as orch from './orchestrator.mjs';
import { withSemanticIndex } from './ppt-semantic.mjs';

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
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
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
  return withSemanticIndex({ kind: 'paste', name: '粘贴文本', text: represented, segments, truncated });
}

const SCRIPT = String.raw`
import csv, hashlib, html, io, json, os, re, sys, zipfile
from html.parser import HTMLParser

name = os.environ['PPT_SOURCE_NAME']
ext = name.rsplit('.', 1)[-1].lower()
raw = sys.stdin.buffer.read()
segments = []
truncated = False

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
    for n, block in enumerate(re.split(r'\n\s*\n', content), 1): add('段落 %s' % n, block)
elif ext in ('html', 'htm'):
    class Reader(HTMLParser):
        def __init__(self): super().__init__(); self.skip = 0; self.parts = []
        def handle_starttag(self, tag, attrs):
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
    reader = Reader(); reader.feed(raw.decode('utf-8-sig'))
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
        for r, row in enumerate(table.rows, 1): add('表 %s 行 %s' % (t, r), ' | '.join(c.text for c in row.cells))
elif ext == 'pdf':
    import pdfplumber
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        if len(pdf.pages) > 100: raise ValueError('PDF has more than 100 pages')
        for n, page in enumerate(pdf.pages, 1): add('PDF 第 %s 页' % n, page.extract_text() or '')
elif ext == 'xlsx':
    from openpyxl import load_workbook
    from openpyxl.utils import get_column_letter
    workbook = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    for sheet in workbook.worksheets[:20]:
        for n, row in enumerate(sheet.iter_rows(max_row=1000, max_col=100, values_only=True), 1):
            cells = ['%s%s=%s' % (get_column_letter(c), n, value) for c, value in enumerate(row, 1) if value is not None]
            if cells: add('工作表 %s 行 %s' % (sheet.title, n), ' | '.join(cells))
elif ext == 'pptx':
    from pptx import Presentation
    deck = Presentation(io.BytesIO(raw))
    for n, slide in enumerate(deck.slides, 1):
        if n > 100: truncated = True; break
        content = []
        for shape in slide.shapes:
            if shape.has_text_frame: content.append(shape.text)
            if shape.has_table:
                for row in shape.table.rows: content.append(' | '.join(c.text for c in row.cells))
        add('幻灯片 %s' % n, '\n'.join(content))

if not segments: raise ValueError('no extractable text; scanned or encrypted files need OCR or conversion')
text = '\n\n'.join(s['text'] for s in segments)
if len(text) > 120000: text = text[:120000]; truncated = True
folder = os.environ.get('PPT_SOURCE_DIR', '/workspace/sources')
os.makedirs(folder, exist_ok=True)
target = os.path.join(folder, hashlib.sha256(raw).hexdigest() + '.' + ext)
if not os.path.exists(target):
    tmp = target + '.part'
    with open(tmp, 'wb') as f: f.write(raw)
    os.replace(tmp, target)
print(json.dumps({'kind': 'file', 'name': name, 'extension': ext, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'segments': segments, 'text': text, 'truncated': truncated}, ensure_ascii=False))
`;

export async function extractFile(project, name, bytes) {
  validateFile(name, bytes);
  const { name: container } = await orch.ensureContainer(project.id, project.uid, orch.KIND_PPT);
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', '-u', String(orch.AGENT_UID), '-e', `PPT_SOURCE_NAME=${name}`, container, 'python3', '-c', SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let error = '';
    child.stdout.on('data', c => { output += c; if (output.length > 500_000) child.kill(); });
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
