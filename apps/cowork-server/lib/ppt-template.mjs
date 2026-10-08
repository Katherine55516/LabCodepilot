import { templateLimits, TemplateError, templateError, TEMPLATE_SECURITY_SCRIPT } from './ppt-template-security.mjs';
/** Versioned template registry. Uploaded decks are analyzed in Cowork; only
 * templates whose colors can be mapped to our deterministic layout are usable. */
import { spawn } from 'node:child_process';
import * as orch from './orchestrator.mjs';
import { THEME_SCRIPT } from './ppt-theme.mjs';

export const BUILT_INS = [
  { id: 'violet', name: 'Violet', category: '商业汇报', description: '深色封面与紫色强调', pages: 10, sampleTitles: ['业务概览', '关键进展', '下一步'], palette: { background: '#171b31', accent: '#967fff', foreground: '#f5f6fc', muted: '#c4c9d8' }, fonts: { title: 'Noto Sans CJK SC', body: 'Noto Sans CJK SC', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC', titleEastAsiaHant: 'Noto Sans CJK TC', bodyEastAsiaHant: 'Noto Sans CJK TC', cjkExplicit: true } },
  { id: 'blue', name: 'Blue', category: '产品发布', description: '深蓝背景与蓝色强调', pages: 10, sampleTitles: ['产品愿景', '核心能力', '发布计划'], palette: { background: '#102b43', accent: '#55ade2', foreground: '#f5f6fc', muted: '#c4c9d8' }, fonts: { title: 'Noto Sans CJK SC', body: 'Noto Sans CJK SC', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC', titleEastAsiaHant: 'Noto Sans CJK TC', bodyEastAsiaHant: 'Noto Sans CJK TC', cjkExplicit: true } },
  { id: 'light', name: 'Light', category: '数据报告', description: '浅色背景与蓝灰色强调', pages: 10, sampleTitles: ['数据摘要', '趋势解读', '结论'], palette: { background: '#f8f9fc', accent: '#404b6b', foreground: '#242a3b', muted: '#505b6f' }, fonts: { title: 'Noto Serif CJK SC', body: 'Noto Sans CJK SC', titleEastAsia: 'Noto Serif CJK SC', bodyEastAsia: 'Noto Sans CJK SC', titleEastAsiaHant: 'Noto Serif CJK TC', bodyEastAsiaHant: 'Noto Sans CJK TC', cjkExplicit: true } },
  { id: 'marketing', name: 'Marketing', category: '营销提案', description: '暖色背景与橙色强调', pages: 10, sampleTitles: ['机会', '策略', '行动'], palette: { background: '#fff7ec', accent: '#dd6c23', foreground: '#33241c', muted: '#705a4b' }, fonts: { title: 'Noto Serif CJK SC', body: 'Noto Sans CJK SC', titleEastAsia: 'Noto Serif CJK SC', bodyEastAsia: 'Noto Sans CJK SC', titleEastAsiaHant: 'Noto Serif CJK TC', bodyEastAsiaHant: 'Noto Sans CJK TC', cjkExplicit: true } },
  { id: 'education', name: 'Education', category: '教育培训', description: '深绿背景与青绿强调', pages: 10, sampleTitles: ['学习目标', '知识要点', '练习'], palette: { background: '#102f2b', accent: '#69d3b0', foreground: '#f4f9f7', muted: '#bcd7cf' }, fonts: { title: 'Noto Serif CJK SC', body: 'Noto Serif CJK SC', titleEastAsia: 'Noto Serif CJK SC', bodyEastAsia: 'Noto Serif CJK SC', titleEastAsiaHant: 'Noto Serif CJK TC', bodyEastAsiaHant: 'Noto Serif CJK TC', cjkExplicit: true } },
].map(item => ({ ...item, kind: 'builtin', compatibility: 'mapped', version: 1, pinned: false, tags: [] }));

export function snapshotTemplate(template) {
  return {
    id: template.id, kind: template.kind, ...(template.sha256 ? {sha256: template.sha256} : {}), ...(template.bytes ? {bytes: template.bytes} : {}),
    name: template.name,
    version: template.version,
    palette: structuredClone(template.palette),
    fonts: structuredClone(template.fonts),
  };
}

export function templateFor(uid, id, store) {
  const template = BUILT_INS.find(item => item.id === id) || [...store.listTemplates(uid), ...store.listTemplates('managed')].find(item => item.id === id);
  if (!template || template.compatibility !== 'mapped') throw new Error('template is unavailable or reference-only');
  return template;
}

export function validateTemplate(name, bytes, managed = false) {
  if (typeof name !== 'string' || name.length > 200 || /[\\/\0]/.test(name)) throw new Error('invalid template name');
  const extension = name.toLowerCase().split('.').at(-1);
  if (!['pptx', 'potx', 'pdf'].includes(extension)) throw new Error('template must be PPTX, POTX or PDF');
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > (managed ? templateLimits().managedBytes : templateLimits().userBytes)) throw new TemplateError('template_too_large', 'template exceeds configured binary limit');
  if (extension === 'pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('invalid PDF');
  if (extension !== 'pdf' && bytes.subarray(0, 2).toString() !== 'PK') throw new Error('invalid Office ZIP');
  return extension;
}

const SCRIPT = String.raw`
import collections, io, json, os, sys, zipfile
import xml.etree.ElementTree as ET
${THEME_SCRIPT}
raw = sys.stdin.buffer.read()
ext = os.environ['PPT_TEMPLATE_EXT']
${TEMPLATE_SECURITY_SCRIPT}
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
        if len(parts) > limits.get('entries', 5000) or sum(p.file_size for p in parts) > limits.get('uncompressedBytes', 134217728): raise ValueError('Office template expands beyond the limit')
        for part in parts:
            path = part.filename.replace('\\', '/')
            if path.startswith('/') or '..' in path.split('/'): raise ValueError('unsafe Office template path')
        ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
        title_font = body_font = title_ea = body_ea = title_hant = body_hant = ''
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
                # Generation supports Simplified Chinese, English and
                # Traditional Chinese. Prefer the template's Hans mapping
                # instead of the first XML entry, which is often Jpan in the
                # Office theme even when the requested content is Chinese.
                for script in ('Hans', 'Hant', 'Jpan', 'Kore'):
                    for font in group.findall('a:font', ns):
                        if font.attrib.get('script') == script and font.attrib.get('typeface'):
                            return font.attrib['typeface'].strip()
                return ''
            def script_font(group, script):
                if group is None: return ''
                for font in group.findall('a:font', ns):
                    if font.attrib.get('script') == script and font.attrib.get('typeface'):
                        return font.attrib['typeface'].strip()
                return ''
            title_font, body_font = family(major, 'latin'), family(minor, 'latin')
            title_ea, body_ea = east_asia(major), east_asia(minor)
            title_hant, body_hant = script_font(major, 'Hant'), script_font(minor, 'Hant')
            cjk_explicit = bool(title_ea and body_ea)
    from pptx import Presentation
    from pptx.enum.dml import MSO_COLOR_TYPE
    deck = Presentation(io.BytesIO(raw))
    result['pages'] = len(deck.slides)
    if not deck.slides: raise ValueError('template contains no slides')
    colors = collections.Counter()
    backgrounds = collections.Counter()
    picture_colors = collections.Counter()
    explicit_title_fonts = collections.Counter()
    explicit_body_fonts = collections.Counter()
    inferred_title_fonts = collections.Counter()
    inferred_body_fonts = collections.Counter()
    explicit_title_east_asia = collections.Counter()
    explicit_body_east_asia = collections.Counter()
    inferred_title_east_asia = collections.Counter()
    inferred_body_east_asia = collections.Counter()
    for index, slide in enumerate(deck.slides):
        if index >= 30: break
        bg,bg_basis=effective_background(slide,int(deck.slide_width),int(deck.slide_height))
        backgrounds[bg]+=1
        result.setdefault('backgroundEvidence',[]).append({'slide':index,'color':'#'+bg.lower(),'basis':bg_basis})
        for shape in slide.shapes:
            if shape.has_text_frame and shape.text.strip() and len(result['sampleTitles']) < 3: result['sampleTitles'].append(shape.text.strip().splitlines()[0][:80])
            if shape.has_text_frame:
                is_title = False
                try: is_title = shape.is_placeholder and int(shape.placeholder_format.type) in (1, 3)
                except (AttributeError, TypeError, ValueError): pass
                bucket = explicit_title_fonts if is_title else explicit_body_fonts
                for paragraph in shape.text_frame.paragraphs:
                    for run in paragraph.runs:
                        if run.font.name:
                            weight = max(1, len(run.text))
                            bucket[run.font.name] += weight
                            # Exported templates often turn title placeholders
                            # into ordinary text boxes. A visibly large run is
                            # still stronger evidence for the title family than
                            # the theme default, which may never appear on a
                            # slide at all.
                            try: is_large = run.font.size is not None and run.font.size.pt >= 20
                            except (AttributeError, TypeError, ValueError): is_large = False
                            (inferred_title_fonts if is_large else inferred_body_fonts)[run.font.name] += weight
                            # A template's theme can name a script font that
                            # the deck never uses. Prefer the actual a:ea run
                            # value when it exists, because PowerPoint will
                            # use that exact value for generated CJK text.
                            east_asia = ''
                            try:
                                rpr = run._r.get_or_add_rPr()
                                for child in rpr:
                                    if child.tag.endswith('}ea'):
                                        east_asia = (child.get('typeface') or '').strip()
                                        break
                            except (AttributeError, TypeError, ValueError): pass
                            # A few authoring tools copy the Latin family into
                            # a:ea. That is not evidence that the font contains
                            # Chinese glyphs: using it for generated CJK text
                            # produces tofu in PowerPoint-compatible renderers.
                            # In that case keep the theme's Hans/Hant mapping.
                            # The template's Latin family is still retained for
                            # Latin runs by the exporter.
                            def supports_cjk(family):
                                lowered = family.lower()
                                markers = ('cjk', 'source han', 'yahei', 'simhei', 'simsun', 'dengxian',
                                           'microsoft jhenghei', 'pmingliu', 'mingliu', 'heiti', 'songti',
                                           'hiragino', 'yu gothic', 'meiryo')
                                native = ('等线', '微软雅黑', '宋体', '黑体', '苹方', '华文', '新細明體', '微軟正黑體')
                                return any(marker in lowered for marker in markers) or any(marker in family for marker in native)
                            if east_asia and supports_cjk(east_asia):
                                if is_title:
                                    explicit_title_east_asia[east_asia] += weight
                                elif not is_large:
                                    explicit_body_east_asia[east_asia] += weight
                                (inferred_title_east_asia if is_large else inferred_body_east_asia)[east_asia] += weight
            try:
                fill = shape.fill
                value=effective_color(shape._element.find('.//a:solidFill',THEME_NS),slide)
                if value: colors[value] += min(1,shape.width*shape.height/(deck.slide_width*deck.slide_height))
            except (AttributeError, TypeError, ValueError): pass
            # Some design exports, including Gamma decks, use raster artwork
            # for a full-slide background or visual panels. There is no
            # slide-background color in that case, so sample the image at a
            # bounded resolution to recover the design tokens. This remains a
            # palette mapping only; geometry and artwork are never claimed as
            # editable template elements.
            try:
                coverage=shape.width*shape.height/(deck.slide_width*deck.slide_height)
                if coverage<.85:continue
                blob = shape.image.blob
                from PIL import Image
                image = Image.open(io.BytesIO(blob)).convert('RGBA')
                image.thumbnail((80, 80))
                for red, green, blue, alpha in image.getdata():
                    if alpha > 200:
                        picture_colors['%02X%02X%02X' % (red // 4 * 4, green // 4 * 4, blue // 4 * 4)] += coverage
            except (AttributeError, OSError, ValueError, ImportError): pass
        try:
            fill = slide.background.fill
            if fill.type and fill.fore_color.type == MSO_COLOR_TYPE.RGB: backgrounds[str(fill.fore_color.rgb)] += 1
        except (AttributeError, TypeError, ValueError): pass
    if not backgrounds and picture_colors:
        # The dominant opaque image color is a reliable fallback for decks
        # whose visible background is artwork rather than a PowerPoint fill.
        backgrounds[picture_colors.most_common(1)[0][0]] += 1
    if backgrounds:
        bg = backgrounds.most_common(1)[0][0]
        accents = [c for c, _ in colors.most_common() if c != bg]
        if not accents:
            _,theme_colors,_=theme_context(deck.slides[0])
            accents=[theme_colors.get('accent1') or ('404B6B' if bg!='404B6B' else '967FFF')]
        if not accents and picture_colors:
            bg_rgb = tuple(int(bg[i:i+2], 16) / 255 for i in (0, 2, 4))
            bg_luminance = sum(v * w for v, w in zip(bg_rgb, (.2126, .7152, .0722)))
            for candidate, _ in picture_colors.most_common():
                rgb = tuple(int(candidate[i:i+2], 16) / 255 for i in (0, 2, 4))
                luminance = sum(v * w for v, w in zip(rgb, (.2126, .7152, .0722)))
                saturation = max(rgb) - min(rgb)
                if saturation >= .12 and luminance >= bg_luminance + .08 and luminance <= .85:
                    accents.append(candidate)
                    break
        if accents:
            accent = accents[0]
            rgb = tuple(int(bg[i:i+2], 16) / 255 for i in (0, 2, 4))
            luminance = sum(v * w for v, w in zip(rgb, (.2126, .7152, .0722)))
            light = luminance > .6
            result['palette'] = {'background': '#'+bg.lower(), 'accent': '#'+accent.lower(), 'foreground': '#242a3b' if light else '#f5f6fc', 'muted': '#505b6f' if light else '#c4c9d8'}
            result['compatibility'] = 'mapped'
            result['reason'] = 'Background and accent colors mapped; source geometry is not reused'
    if explicit_title_fonts: title_font = explicit_title_fonts.most_common(1)[0][0]
    elif inferred_title_fonts: title_font = inferred_title_fonts.most_common(1)[0][0]
    if explicit_body_fonts: body_font = explicit_body_fonts.most_common(1)[0][0]
    elif inferred_body_fonts: body_font = inferred_body_fonts.most_common(1)[0][0]
    if explicit_title_east_asia: title_ea = explicit_title_east_asia.most_common(1)[0][0]
    elif inferred_title_east_asia: title_ea = inferred_title_east_asia.most_common(1)[0][0]
    if explicit_body_east_asia: body_ea = explicit_body_east_asia.most_common(1)[0][0]
    elif inferred_body_east_asia: body_ea = inferred_body_east_asia.most_common(1)[0][0]
    if not title_font: title_font = body_font
    if not body_font: body_font = title_font
    if title_font and body_font:
        # OOXML often stores Chinese font-family aliases used by Windows Office,
        # while macOS and LibreOffice expose the same faces under their native
        # family names. Canonicalize only known aliases so generated CJK text
        # remains in the template's typeface family and can render on the
        # supported desktop preview path.
        def portable_east_asia(family, script='Hans'):
            aliases = {
                '宋体': 'Songti SC', '宋體': 'Songti TC',
                '新細明體': 'Songti TC', '細明體': 'Songti TC',
            }
            value = (family or '').strip()
            if script == 'Hans' and value in ('宋体', '宋體'): return 'Songti SC'
            return aliases.get(value, value)
        def resolved_east_asia(latin, role):
            lowered = latin.lower()
            if any(marker in lowered for marker in ('cjk', 'source han', 'simhei', 'simsun', 'yahei', 'dengxian', 'microsoft jhenghei', 'pmingliu', 'mingliu', 'heiti', 'songti', 'hiragino', 'yu gothic', 'meiryo')) or any(marker in latin for marker in ('等线', '微软雅黑', '宋体', '黑体', '苹方', '华文', '新細明體', '微軟正黑體')):
                return latin
            serif = any(marker in lowered for marker in ('serif', 'times', 'georgia', 'brygada', 'song'))
            return 'Noto Serif CJK SC' if role == 'title' and serif else 'Noto Sans CJK SC'
        cjk_source = 'template' if cjk_explicit else 'fallback'
        title_ea = portable_east_asia(title_ea or resolved_east_asia(title_font, 'title'))
        body_ea = portable_east_asia(body_ea or resolved_east_asia(body_font, 'body'))
        title_hant = portable_east_asia(title_hant or title_ea, 'Hant')
        body_hant = portable_east_asia(body_hant or body_ea, 'Hant')
        result['fonts'] = {'title': title_font, 'body': body_font, 'titleEastAsia': title_ea,
                           'bodyEastAsia': body_ea, 'titleEastAsiaHant': title_hant,
                           'bodyEastAsiaHant': body_hant, 'cjkExplicit': True, 'cjkSource': cjk_source}
    else:
        result['compatibility'] = 'reference'
        result['reason'] = 'No stable title/body font pair could be extracted'
    if result['compatibility'] != 'mapped' and result['palette'] is None: result['reason'] = 'No stable background/accent pair could be extracted'
if result['pages'] > 100: raise ValueError('template exceeds 100 pages')
print(json.dumps(result, ensure_ascii=False))
`;

export function runTemplateParser(command, args, bytes, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new TemplateError('template_timeout', 'template parse timed out')); }, templateLimits().timeoutMs);
    timer.unref();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { out += chunk; if (out.length > 100_000) { child.kill(); reject(new TemplateError('template_too_large', 'analyzer output exceeds limit')); } });
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-2000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(templateError(err));
      try { resolve(JSON.parse(out)); } catch { reject(new TemplateError('template_corrupted', 'template analyzer returned invalid JSON')); }
    });
    child.stdin.on('error', () => {}); child.stdin.end(bytes);
  });
}
export async function analyzeTemplate(uid, id, extension, bytes, io = {}) {
  if(io.runPython)return io.runPython({uid,id},SCRIPT,bytes,{PPT_TEMPLATE_EXT:extension,PPT_TEMPLATE_LIMITS:JSON.stringify(templateLimits())});
  const { name } = await orch.ensureContainer(id, uid, orch.KIND_PPT);
  return runTemplateParser('docker', ['exec', '-i', '-u', String(orch.AGENT_UID), '-e', `PPT_TEMPLATE_EXT=${extension}`, '-e', `PPT_TEMPLATE_LIMITS=${JSON.stringify(templateLimits())}`, name, 'python3', '-c', SCRIPT], bytes);
}
export const _internals = { SCRIPT };
