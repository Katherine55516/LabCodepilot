/** PDF export from the same validated slide IR in the project Cowork container. */
import { spawn } from 'node:child_process';
import * as orch from './orchestrator.mjs';
import { buildRenderTree } from './ppt/render-tree.mjs';

const SCRIPT = String.raw`
import base64, io, json, os, textwrap, sys
import matplotlib
matplotlib.use('Agg')
from matplotlib.figure import Figure
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.font_manager import FontProperties, findfont
from matplotlib.patches import Rectangle
from matplotlib.patches import Ellipse
from matplotlib.image import imread

data = json.load(sys.stdin)
palettes = {'violet': ('#171b31', '#967fff', '#f5f6fc', '#c4c9d8'),
            'blue': ('#102b43', '#55ade2', '#f5f6fc', '#c4c9d8'),
            'light': ('#f8f9fc', '#404b6b', '#242a3b', '#505b6f')}
bg, accent, fg, muted = palettes.get(data.get('template'), palettes['violet'])
if data.get('palette'):
    bg, accent, fg, muted = (data['palette'][key] for key in ('background', 'accent', 'foreground', 'muted'))
fonts = data.get('fonts') or {}
def exact_font(name):
    if not name: raise ValueError('template font token is missing')
    try: path = findfont(FontProperties(family=name), fallback_to_default=False)
    except Exception as error: raise ValueError('template font unavailable for PDF export: '+name) from error
    return FontProperties(fname=path)
title_font = exact_font(fonts.get('title'))
font = exact_font(fonts.get('body'))
target = os.environ.get('PPT_OUTPUT', '/workspace/presentation.pdf')
tmp = target + '.part.' + str(os.getpid())
scene = data.get('renderTree') or {}
scene_width = float((scene.get('size') or {}).get('width') or 12191695)
scene_height = float((scene.get('size') or {}).get('height') or 6858000)

def scene_box(element):
    box = element['bounds']; x = box['x'] / scene_width; w = box['width'] / scene_width
    h = box['height'] / scene_height; y = 1 - (box['y'] + box['height']) / scene_height
    return x, y, w, h

def render_scene_element(fig, element):
    x, y, width, height = scene_box(element); kind = element['kind']; content = element.get('content') or {}; style = element.get('style') or {}
    color = style.get('color') or muted; size = float(style.get('fontSizePt') or 18)
    if kind in ('text', 'list', 'timeline', 'metric'):
        if kind == 'text': lines = [str(content.get('text') or '')]
        else:
            lines = []
            for number, item in enumerate(content.get('items') or []):
                prefix = (str(number + 1).zfill(2) + '  ') if kind == 'timeline' else ('' if kind == 'metric' and number == 0 else '•  ')
                lines.append(prefix + str(item.get('text') or ''))
        line_height = min(.06, height / max(1, len(lines)))
        for number, line in enumerate(lines):
            fig.text(x, y + height - number * line_height, line, color=color, size=size,
                     fontproperties=title_font if element.get('semanticRole') == 'title' or (kind == 'metric' and number == 0) else font,
                     weight='bold' if style.get('fontWeight', 400) >= 600 or (kind == 'metric' and number == 0) else 'normal', va='top',
                     ha='right' if style.get('textAlign') == 'right' else 'left')
        return
    if kind == 'image' and content.get('dataUrl'):
        picture = imread(io.BytesIO(base64.b64decode(content['dataUrl'].split(',', 1)[1])))
        image_ax = fig.add_axes([x, y, width, height]); image_ax.axis('off'); image_ax.imshow(picture); image_ax.set_aspect('auto'); return
    if kind == 'chart':
        chart_ax = fig.add_axes([x, y, width, height], facecolor='white')
        if content.get('chartType') == 'pie': chart_ax.pie(content.get('values') or [], labels=content.get('labels') or [], textprops={'fontsize': 8, 'fontproperties': font})
        else: chart_ax.bar(content.get('labels') or [], content.get('values') or [], color=accent)
        chart_ax.set_title(content.get('unit', ''), fontsize=9, fontproperties=font); return
    if kind == 'table' and content.get('rows'):
        table_ax = fig.add_axes([x, y, width, height]); table_ax.axis('off'); rows = content['rows']
        table = table_ax.table(cellText=rows[1:], colLabels=rows[0], loc='center', cellLoc='center'); table.auto_set_font_size(False); table.set_fontsize(9)
        for key, cell in table.get_celld().items(): cell.get_text().set_fontproperties(font)
        return
    fig.patches.append(Rectangle((x, y), width, height, color=style.get('fill') or '#64748b', transform=fig.transFigure, alpha=1 if kind == 'shape' else .15))

with PdfPages(tmp) as pdf:
    for index, slide in enumerate(data['slides']):
        fig = Figure(figsize=(13.333, 7.5), facecolor=bg)
        ax = fig.add_axes([0, 0, 1, 1]); ax.axis('off')
        ax.add_patch(Rectangle((0, .982), 1, .018, color=accent, transform=ax.transAxes))
        scene_slides = scene.get('slides') or []
        if index < len(scene_slides):
            for element in scene_slides[index].get('elements', []):
                if element.get('nodeId') is None and element.get('kind') == 'shape': continue
                render_scene_element(fig, element)
            pdf.savefig(fig, facecolor=fig.get_facecolor()); continue
        title = slide['title']
        layout = slide.get('layoutId') or 'summary'
        size = max(38 if layout == 'cover' else (32 if layout == 'conclusion' else 28), 36 if len(title) <= 28 else 30)
        fig.text(.5 if layout == 'cover' else .065, .68 if layout == 'cover' else .84, title, color=fg, size=size, fontproperties=title_font, va='top', ha='center' if layout == 'cover' else 'left')
        bullets = slide.get('bullets', [])
        blocks = slide.get('blocks', [])
        visual_first = layout in ('chart', 'table')
        if bullets:
            lines = []
            for bullet in bullets:
                chunks = textwrap.wrap(bullet, width=52, break_long_words=True, break_on_hyphens=False) or ['']
                lines.append('•  ' + chunks[0])
                lines.extend('    ' + c for c in chunks[1:])
            size = 16 if blocks else (22 if len(lines) <= 7 else (18 if len(lines) <= 10 else 15))
            y = .20 if visual_first else (.52 if layout == 'image-text' else (.50 if layout == 'cover' else (.72 if blocks else .68)))
            step = min(.045 if visual_first else (.055 if blocks else .095), (.13 if visual_first else (.22 if blocks else .56)) / max(1, len(lines)))
            for line in lines:
                fig.text(.075, y, line, color=muted, size=size, fontproperties=font, va='top')
                y -= step
        if blocks:
            top = .70 if visual_first else (.72 if layout == 'image-text' else (.48 if bullets else .70))
            height = .43 if visual_first else (.39 if bullets else .56)
            width = .82 / len(blocks)
            for n, block in enumerate(blocks):
                x = .08 + n * width
                kind = block['type']
                if kind == 'image':
                    picture = imread(io.BytesIO(base64.b64decode(block['dataUrl'].split(',', 1)[1])))
                    image_ax = fig.add_axes([x, top - height, width - .02, height]); image_ax.axis('off')
                    image_ax.imshow(picture); image_ax.set_aspect('auto')
                elif kind == 'chart':
                    chart_ax = fig.add_axes([x + .02, top - height + .04, width - .07, height - .07], facecolor='white')
                    if block['chartType'] == 'pie':
                        chart_ax.pie(block['values'], labels=block['labels'], textprops={'fontsize': 8, 'fontproperties': font})
                    else:
                        chart_ax.bar(block['labels'], block['values'], color=accent)
                        chart_ax.tick_params(labelsize=8)
                    chart_ax.set_title(block.get('unit', ''), fontsize=9, fontproperties=font)
                elif kind == 'table':
                    table_ax = fig.add_axes([x, top - height, width - .02, height]); table_ax.axis('off')
                    table = table_ax.table(cellText=block['rows'][1:], colLabels=block['rows'][0], loc='center', cellLoc='center')
                    table.auto_set_font_size(False); table.set_fontsize(9); table.scale(1, 1.6)
                    for key, cell in table.get_celld().items():
                        if key[0] == 0:
                            cell.set_facecolor(accent)
                            cell.get_text().set_color('white')
                        cell.get_text().set_fontproperties(font)
                else:
                    center_x, center_y = x + width / 2, top - height / 2
                    patch = Ellipse((center_x, center_y), width * .65, height * .72, color=block['fill'], transform=fig.transFigure) if block['shape'] == 'ellipse' else Rectangle((x + width * .17, top - height * .85), width * .66, height * .7, color=block['fill'], transform=fig.transFigure)
                    fig.patches.append(patch)
                    fig.text(center_x, center_y, block['text'], color='white', ha='center', va='center', size=14, fontproperties=font)
        fig.text(.93, .055, str(index + 1), color=muted, size=11, ha='right', fontproperties=font)
        pdf.savefig(fig, facecolor=fig.get_facecolor())
os.replace(tmp, target)
print(json.dumps({'slides': len(data['slides']), 'bytes': os.path.getsize(target)}))
`;

export async function renderPdf(project) {
  const { name } = await orch.ensureContainer(project.id, project.uid, orch.KIND_PPT);
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', '-u', String(orch.AGENT_UID), name, 'python3', '-c', SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let error = '';
    child.stdout.on('data', c => { output = (output + c).slice(-10000); });
    child.stderr.on('data', c => { error = (error + c).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`PDF render failed (${code}): ${error.slice(-500)}`));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('PDF renderer returned invalid result')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ slides: project.deck.slides, renderTree: project.renderTree || buildRenderTree(project), template: project.template, palette: project.templateSpec?.palette, fonts: project.templateSpec?.fonts }));
  });
}

export const _internals = { SCRIPT };
