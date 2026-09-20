/** Versioned template registry. Uploaded decks are analyzed in Cowork; only
 * templates whose colors can be mapped to our deterministic layout are usable. */
import { spawn } from 'node:child_process';
import * as orch from './orchestrator.mjs';

export const BUILT_INS = [
  { id: 'violet', name: 'Violet', category: '商业汇报', description: '深色封面与紫色强调', pages: 10, sampleTitles: ['业务概览', '关键进展', '下一步'], palette: { background: '#171b31', accent: '#967fff', foreground: '#f5f6fc', muted: '#c4c9d8' }, fonts: { title: 'Noto Sans CJK SC', body: 'Noto Sans CJK SC', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC', cjkExplicit: true } },
  { id: 'blue', name: 'Blue', category: '产品发布', description: '深蓝背景与蓝色强调', pages: 10, sampleTitles: ['产品愿景', '核心能力', '发布计划'], palette: { background: '#102b43', accent: '#55ade2', foreground: '#f5f6fc', muted: '#c4c9d8' }, fonts: { title: 'Noto Sans CJK SC', body: 'Noto Sans CJK SC', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC', cjkExplicit: true } },
  { id: 'light', name: 'Light', category: '数据报告', description: '浅色背景与蓝灰色强调', pages: 10, sampleTitles: ['数据摘要', '趋势解读', '结论'], palette: { background: '#f8f9fc', accent: '#404b6b', foreground: '#242a3b', muted: '#505b6f' }, fonts: { title: 'Noto Serif CJK SC', body: 'Noto Sans CJK SC', titleEastAsia: 'Noto Serif CJK SC', bodyEastAsia: 'Noto Sans CJK SC', cjkExplicit: true } },
  { id: 'marketing', name: 'Marketing', category: '营销提案', description: '暖色背景与橙色强调', pages: 10, sampleTitles: ['机会', '策略', '行动'], palette: { background: '#fff7ec', accent: '#dd6c23', foreground: '#33241c', muted: '#705a4b' }, fonts: { title: 'Noto Serif CJK SC', body: 'Noto Sans CJK SC', titleEastAsia: 'Noto Serif CJK SC', bodyEastAsia: 'Noto Sans CJK SC', cjkExplicit: true } },
  { id: 'education', name: 'Education', category: '教育培训', description: '深绿背景与青绿强调', pages: 10, sampleTitles: ['学习目标', '知识要点', '练习'], palette: { background: '#102f2b', accent: '#69d3b0', foreground: '#f4f9f7', muted: '#bcd7cf' }, fonts: { title: 'Noto Serif CJK SC', body: 'Noto Serif CJK SC', titleEastAsia: 'Noto Serif CJK SC', bodyEastAsia: 'Noto Serif CJK SC', cjkExplicit: true } },
].map(item => ({ ...item, kind: 'builtin', compatibility: 'mapped', version: 1, pinned: false, tags: [] }));

export function snapshotTemplate(template) {
  return {
    id: template.id,
    name: template.name,
    version: template.version,
    palette: structuredClone(template.palette),
    fonts: structuredClone(template.fonts),
  };
}

export function templateFor(uid, id, store) {
  const template = BUILT_INS.find(item => item.id === id) || store.listTemplates(uid).find(item => item.id === id);
  if (!template || template.compatibility !== 'mapped') throw new Error('template is unavailable or reference-only');
  return template;
}

export function validateTemplate(name, bytes) {
  if (typeof name !== 'string' || name.length > 200 || /[\\/\0]/.test(name)) throw new Error('invalid template name');
  const extension = name.toLowerCase().split('.').at(-1);
  if (!['pptx', 'potx', 'pdf'].includes(extension)) throw new Error('template must be PPTX, POTX or PDF');
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('template must be 1 byte to 8 MB');
  if (extension === 'pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('invalid PDF');
  if (extension !== 'pdf' && bytes.subarray(0, 2).toString() !== 'PK') throw new Error('invalid Office ZIP');
  return extension;
}

const SCRIPT = String.raw`
import collections, io, json, os, sys, zipfile
import xml.etree.ElementTree as ET
raw = sys.stdin.buffer.read()
ext = os.environ['PPT_TEMPLATE_EXT']
result = {'compatibility': 'reference', 'reason': 'Only reference preview is available', 'pages': 0, 'palette': None, 'fonts': None, 'sampleTitles': []}
if ext == 'pdf':
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(raw))
    if reader.is_encrypted: raise ValueError('encrypted PDF templates are unsupported')
    result['pages'] = len(reader.pages)
    result['sampleTitles'] = [(p.extract_text() or '').splitlines()[0][:80] for p in reader.pages[:3] if (p.extract_text() or '').splitlines()]
    result['reason'] = 'PDF is a visual reference; editable template geometry cannot be inferred'
else:
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        parts = archive.infolist()
        if len(parts) > 1500 or sum(p.file_size for p in parts) > 80 * 1024 * 1024: raise ValueError('Office template expands beyond the limit')
        for part in parts:
            path = part.filename.replace('\\', '/')
            if path.startswith('/') or '..' in path.split('/'): raise ValueError('unsafe Office template path')
        ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
        title_font = body_font = title_ea = body_ea = ''
        cjk_explicit = False
        theme_names = [p.filename for p in parts if p.filename.startswith('ppt/theme/theme') and p.filename.endswith('.xml')]
        if theme_names:
            theme = ET.fromstring(archive.read(theme_names[0]))
            major = theme.find('.//a:fontScheme/a:majorFont', ns)
            minor = theme.find('.//a:fontScheme/a:minorFont', ns)
            def family(group, kind):
                if group is None: return ''
                node = group.find('a:'+kind, ns)
                return (node.attrib.get('typeface') or '').strip() if node is not None else ''
            def east_asia(group):
                if group is None: return ''
                direct = family(group, 'ea')
                if direct: return direct
                for font in group.findall('a:font', ns):
                    if font.attrib.get('script') in ('Hans', 'Hant', 'Jpan', 'Kore') and font.attrib.get('typeface'):
                        return font.attrib['typeface'].strip()
                return ''
            title_font, body_font = family(major, 'latin'), family(minor, 'latin')
            title_ea, body_ea = east_asia(major), east_asia(minor)
            cjk_explicit = bool(title_ea and body_ea)
    from pptx import Presentation
    from pptx.enum.dml import MSO_COLOR_TYPE
    deck = Presentation(io.BytesIO(raw))
    result['pages'] = len(deck.slides)
    if not deck.slides: raise ValueError('template contains no slides')
    colors = collections.Counter()
    backgrounds = collections.Counter()
    explicit_title_fonts = collections.Counter()
    explicit_body_fonts = collections.Counter()
    for index, slide in enumerate(deck.slides):
        if index >= 30: break
        for shape in slide.shapes:
            if shape.has_text_frame and shape.text.strip() and len(result['sampleTitles']) < 3: result['sampleTitles'].append(shape.text.strip().splitlines()[0][:80])
            if shape.has_text_frame:
                is_title = False
                try: is_title = shape.is_placeholder and int(shape.placeholder_format.type) in (1, 3)
                except (AttributeError, TypeError, ValueError): pass
                bucket = explicit_title_fonts if is_title else explicit_body_fonts
                for paragraph in shape.text_frame.paragraphs:
                    for run in paragraph.runs:
                        if run.font.name: bucket[run.font.name] += max(1, len(run.text))
            try:
                fill = shape.fill
                if fill.type and fill.fore_color.type == MSO_COLOR_TYPE.RGB:
                    colors[str(fill.fore_color.rgb)] += 1
            except (AttributeError, TypeError, ValueError): pass
        try:
            fill = slide.background.fill
            if fill.type and fill.fore_color.type == MSO_COLOR_TYPE.RGB: backgrounds[str(fill.fore_color.rgb)] += 1
        except (AttributeError, TypeError, ValueError): pass
    if backgrounds:
        bg = backgrounds.most_common(1)[0][0]
        accents = [c for c, _ in colors.most_common() if c != bg]
        if accents:
            accent = accents[0]
            rgb = tuple(int(bg[i:i+2], 16) / 255 for i in (0, 2, 4))
            luminance = sum(v * w for v, w in zip(rgb, (.2126, .7152, .0722)))
            light = luminance > .6
            result['palette'] = {'background': '#'+bg.lower(), 'accent': '#'+accent.lower(), 'foreground': '#242a3b' if light else '#f5f6fc', 'muted': '#505b6f' if light else '#c4c9d8'}
            result['compatibility'] = 'mapped'
            result['reason'] = 'Background and accent colors mapped; source geometry is not reused'
    if explicit_title_fonts: title_font = explicit_title_fonts.most_common(1)[0][0]
    if explicit_body_fonts: body_font = explicit_body_fonts.most_common(1)[0][0]
    if not title_font: title_font = body_font
    if not body_font: body_font = title_font
    if title_font and body_font:
        result['fonts'] = {'title': title_font, 'body': body_font, 'titleEastAsia': title_ea or title_font,
                           'bodyEastAsia': body_ea or body_font, 'cjkExplicit': cjk_explicit}
    else:
        result['compatibility'] = 'reference'
        result['reason'] = 'No stable title/body font pair could be extracted'
    if result['compatibility'] != 'mapped' and result['palette'] is None: result['reason'] = 'No stable background/accent pair could be extracted'
if result['pages'] > 100: raise ValueError('template exceeds 100 pages')
print(json.dumps(result, ensure_ascii=False))
`;

export async function analyzeTemplate(uid, id, extension, bytes) {
  const { name } = await orch.ensureContainer(id, uid, orch.KIND_PPT);
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', '-u', String(orch.AGENT_UID), '-e', `PPT_TEMPLATE_EXT=${extension}`, name, 'python3', '-c', SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', chunk => { out += chunk; if (out.length > 100_000) child.kill(); });
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`template analysis failed: ${err.slice(-400)}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('template analyzer returned invalid JSON')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}

export const _internals = { SCRIPT };
