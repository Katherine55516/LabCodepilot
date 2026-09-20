/** Deterministic source extraction inside the project's Cowork container.
 * No model participates in file decoding. Original bytes stay in the volume;
 * the bounded, location-tagged text is persisted in the project IR. */
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import * as orch from './orchestrator.mjs';

export const EXTENSIONS = new Set(['md', 'markdown', 'html', 'htm', 'docx', 'pdf', 'xlsx', 'pptx']);
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_PASTE_CHARS = 80_000;

export function validateFile(name, bytes) {
  if (typeof name !== 'string' || name.length > 200 || /[\\/\0]/.test(name)) throw new Error('invalid source file name');
  const ext = name.toLowerCase().split('.').at(-1);
  if (!EXTENSIONS.has(ext)) throw new Error('unsupported format; convert .doc/.xls to .docx/.xlsx');
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_FILE_BYTES) throw new Error('source file must be 1 byte to 8 MB');
  if (ext === 'pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('invalid PDF signature');
  if (['docx', 'xlsx', 'pptx'].includes(ext) && bytes.subarray(0, 2).toString() !== 'PK') throw new Error('invalid Office ZIP signature');
  if (['md', 'markdown', 'html', 'htm'].includes(ext)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('text source must be UTF-8'); }
    if (bytes.includes(0)) throw new Error('text source contains binary data');
  }
  return ext;
}

export function normalizePaste(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_PASTE_CHARS) throw new Error('pasted text must be 1 to 80000 characters');
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const segments = [];
  let line = 1;
  for (const block of blocks) {
    segments.push({ id: String(segments.length + 1), location: `段落 ${segments.length + 1} / 行 ${line}`, text: block.slice(0, 3000) });
    line += block.split('\n').length + 1;
    if (segments.length >= 300) break;
  }
  return { kind: 'paste', name: '粘贴文本', text: segments.map(s => s.text).join('\n\n'), segments, truncated: segments.length < blocks.length || segments.some(s => s.text.length >= 3000) };
}

const SCRIPT = String.raw`
import hashlib, html, io, json, os, re, sys, zipfile
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
    if len(segments) >= 500:
        truncated = True
        return
    if len(value) > 3000:
        truncated = True
        value = value[:3000]
    segments.append({'id': str(len(segments) + 1), 'location': location, 'text': value})

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
            if tag in ('script', 'style', 'noscript'): self.skip += 1
            elif not self.skip and tag in ('p', 'div', 'h1', 'h2', 'h3', 'li', 'tr', 'br'): self.parts.append('\n')
        def handle_endtag(self, tag):
            if tag in ('script', 'style', 'noscript') and self.skip: self.skip -= 1
        def handle_data(self, data):
            if not self.skip: self.parts.append(data)
    reader = Reader(); reader.feed(raw.decode('utf-8-sig'))
    for n, block in enumerate(''.join(reader.parts).splitlines(), 1): add('HTML 行 %s' % n, html.unescape(block))
elif ext == 'docx':
    from docx import Document
    doc = Document(io.BytesIO(raw))
    for n, p in enumerate(doc.paragraphs, 1): add('段落 %s' % n, p.text)
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
if len(text) > 80000: text = text[:80000]; truncated = True
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
      try { resolve(JSON.parse(output)); } catch { reject(new Error('source extractor returned invalid JSON')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}

export function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
export const _internals = { SCRIPT };
