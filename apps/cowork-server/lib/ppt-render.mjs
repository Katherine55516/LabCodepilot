import { EXPORT_VERIFY_SCRIPT } from './ppt/export-verifier-python.mjs';
/** Deterministic PPTX export. python-pptx executes INSIDE the project's Cowork
 * container, which already ships it in the bundled office image. The host only
 * passes validated IR and later streams the resulting file from its volume. */
import { spawn } from 'node:child_process';
import * as orch from './orchestrator.mjs';
import { buildRenderTree } from './ppt/render-tree.mjs';
import { OFFICE_MATH_SCRIPT } from './ppt-math.mjs';
import { exportManifest } from './ppt-export-integrity.mjs';
import { RENDER_CONTRACT_SCRIPT } from './ppt/render-contract-python.mjs';
import { RENDER_CONTRACT_VERSION } from './ppt/render-contract.mjs';
import { FONT_SCRIPT } from './ppt-fonts.mjs';

const SCRIPT = String.raw`
import base64, io, json, math, os, re, sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN, MSO_AUTO_SIZE
from pptx.enum.shapes import MSO_SHAPE
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_DATA_LABEL_POSITION
from pptx.parts.image import Image
from PIL import Image as PillowImage
from pptx.oxml.xmlchemy import OxmlElement
from pptx.oxml.ns import qn

${OFFICE_MATH_SCRIPT}
${EXPORT_VERIFY_SCRIPT}
${FONT_SCRIPT}
${RENDER_CONTRACT_SCRIPT}

TITLE_FONT = BODY_FONT = TITLE_EA = BODY_EA = ''
CJK_RE = re.compile(r'[\u2e80-\u9fff\uf900-\ufaff]')
HANT_RE = re.compile(r'[萬與為於後臺國學實體廣應當復雜雙發變這個們體繁臺灣]' )

def language_for_text(text):
    text = text or ''
    if HANT_RE.search(text): return 'zh-HK'
    if CJK_RE.search(text): return 'zh-CN'
    return 'en-US'

def set_east_asia_font(run, east_asia, language):
    rpr = run._r.get_or_add_rPr()
    for child in list(rpr):
        if child.tag == qn('a:ea'):
            rpr.remove(child)
    ea = OxmlElement('a:ea')
    ea.set('typeface', east_asia)
    rpr.append(ea)
    rpr.set('lang', language)

def cjk_run(run, size, color, bold=False, role='body', family=None):
    latin = family or (TITLE_FONT if role == 'title' else BODY_FONT)
    language = language_for_text(run.text)
    east_asia = (TITLE_HANT if role == 'title' else BODY_HANT) if language == 'zh-HK' else (TITLE_EA if role == 'title' else BODY_EA)
    # PowerPoint reads a:ea for CJK text. LibreOffice's PPTX preview also
    # requires the CJK family in a:latin, otherwise it can render a blank
    # run when the template's Latin font has no Han glyphs. The same CJK
    # template family is therefore set in both slots for Chinese runs;
    # English continues to use the template's Latin family.
    for part,actual in font_runs(run,latin,east_asia if language.startswith('zh-') else None):
        part.font.name = actual
        part.font.size = Pt(size)
        part.font.bold = bold
        part.font.color.rgb = color
        part_language=language_for_text(part.text)
        set_east_asia_font(part,actual if part_language.startswith('zh-') else east_asia,part_language)

def cjk_font(paragraph, size, color, bold=False, role='body'):
    for run in list(paragraph.runs): cjk_run(run,size,color,bold,role)

def textbox(slide, x, y, w, h, text, size, color, bold=False, role='body', align=None):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    box.text_frame.word_wrap = True
    paragraph = box.text_frame.paragraphs[0]
    paragraph.text = text
    if align is not None: paragraph.alignment = align
    cjk_font(paragraph, size, color, bold, role)
    return box

def bullets_box(slide, bullets, x, y, w, h, size, color, prefix=True):
    if not bullets: return None
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    frame = box.text_frame
    frame.word_wrap = True
    for index, text in enumerate(bullets):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.text = ('•  ' if prefix else '') + text
        paragraph.space_after = Pt(size * .45)
        cjk_font(paragraph, size, color)
    return box

def numbered_points(slide, bullets, x, y, w, h, size, color, accent):
    if not bullets: return
    each = h / len(bullets)
    for index, text in enumerate(bullets):
        row_y = y + each * index
        textbox(slide, x, row_y + .1, .8, each - .12, str(index + 1).zfill(2), max(18, size), RGBColor(*accent), True, 'title')
        textbox(slide, x + 1.0, row_y + .1, w - 1.0, each - .12, text, size, color, False, 'body')

def visual(slide, block, x, y, w, h, accent, fg):
    kind = block['type']
    if kind == 'image':
        blob = base64.b64decode(block['dataUrl'].split(',', 1)[1])
        PillowImage.open(io.BytesIO(blob)).verify()
        return contract_picture(slide,blob,x,y,w,h,block.get('imageLayout') or {'fit':'contain'})
    if kind == 'chart':
        if block.get('chartLayout') and not block['chartLayout'].get('valid'):raise ValueError('invalid chart data contract')
        data = CategoryChartData()
        data.categories = block['labels']
        for series in block.get('series') or [{'name':block.get('unit') or 'Values','values':block['values']}]:data.add_series(series.get('name') or 'Values',series['values'])
        chart_type = XL_CHART_TYPE.PIE if block['chartType'] == 'pie' else (XL_CHART_TYPE.LINE_MARKERS if block['chartType'] == 'line' else XL_CHART_TYPE.COLUMN_CLUSTERED)
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
        card.fill.solid()
        card.fill.fore_color.rgb = RGBColor(255, 255, 255)
        card.line.color.rgb = RGBColor(222, 227, 235)
        inset = Inches(.14)
        chart_shape = slide.shapes.add_chart(chart_type, x + inset, y + inset, w - 2 * inset, h - 2 * inset, data)
        chart = chart_shape.chart
        chart.has_title = bool(block.get('unit'))
        if chart.has_title:
            title_para = chart.chart_title.text_frame.paragraphs[0]
            title_para.text = block['unit']
            cjk_font(title_para, 12, RGBColor(45, 55, 72), True, 'title')
        chart.has_legend = block['chartType'] == 'pie' or len(block.get('series') or [])>1
        if block['chartType'] in ('bar', 'line'):
            axis=block.get('chartLayout') or {}
            if axis:
                if not axis.get('valid'):raise ValueError('invalid chart data contract')
                chart.value_axis.minimum_scale=float(axis['minimum']);chart.value_axis.maximum_scale=float(axis['maximum'])
                chart.value_axis.crosses_at=0.0
                chart.value_axis.tick_labels.number_format=axis.get('numberFormat','0.##')
                chart.value_axis.tick_labels.number_format_is_linked=False
            if block['chartType'] == 'bar':
                for series in chart.series:series.invert_if_negative=False
                chart.series[0].format.fill.solid()
                chart.series[0].format.fill.fore_color.rgb = RGBColor(*accent)
            else:
                chart.series[0].format.line.color.rgb = RGBColor(*accent)
            chart.category_axis.tick_labels.font.name = BODY_FONT
            chart.category_axis.tick_labels.font.size = Pt(10)
            chart.category_axis.tick_labels.font.color.rgb = RGBColor(65, 75, 92)
            chart.value_axis.tick_labels.font.name = BODY_FONT
            chart.value_axis.tick_labels.font.size = Pt(10)
            chart.value_axis.tick_labels.font.color.rgb = RGBColor(90, 99, 115)
            chart.value_axis.major_gridlines.format.line.color.rgb = RGBColor(222, 227, 235)
            plot = chart.plots[0]
            plot.has_data_labels = True
            plot.data_labels.position = XL_DATA_LABEL_POSITION.OUTSIDE_END
            plot.data_labels.font.name = BODY_FONT
            plot.data_labels.font.size = Pt(10)
            plot.data_labels.font.color.rgb = RGBColor(45, 55, 72)
        else:
            chart.legend.font.name = BODY_FONT
            chart.legend.font.size = Pt(10)
            plot = chart.plots[0]
            plot.has_data_labels = True
            plot.data_labels.show_percentage = True
            plot.data_labels.font.name = BODY_FONT
            plot.data_labels.font.size = Pt(10)
            plot.data_labels.font.color.rgb = RGBColor(45, 55, 72)
        return [card, chart_shape]
    if kind == 'table':
        rows = block['rows']
        table_shape = slide.shapes.add_table(len(rows), len(rows[0]), x, y, w, h)
        table = table_shape.table
        for r, row in enumerate(rows):
            for c, value in enumerate(row):
                cell = table.cell(r, c)
                cell.text = value
                cell.fill.solid()
                cell.fill.fore_color.rgb = RGBColor(*accent) if r == 0 else RGBColor(250, 250, 252)
                for paragraph in cell.text_frame.paragraphs:
                    cjk_font(paragraph, 14 if r == 0 else 13, RGBColor(255, 255, 255) if r == 0 else RGBColor(30, 35, 50), r == 0)
        return table_shape
    shape = slide.shapes.add_shape(MSO_SHAPE.OVAL if block['shape'] == 'ellipse' else MSO_SHAPE.ROUNDED_RECTANGLE,
                                   x + int(w * .12), y + int(h * .12), int(w * .76), int(h * .76))
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor(*bytes.fromhex(block['fill'][1:]))
    shape.line.fill.background()
    para = shape.text_frame.paragraphs[0]
    para.text = block['text']
    para.alignment = PP_ALIGN.CENTER
    cjk_font(para, 18, RGBColor(255, 255, 255), True)
    return shape

data = json.load(sys.stdin)
font_spec = data.get('fonts') or {}
required_fonts = ('title', 'body', 'titleEastAsia', 'bodyEastAsia')
if any(not isinstance(font_spec.get(key), str) or not font_spec[key].strip() for key in required_fonts):
    raise ValueError('template title/body font tokens are required')
TITLE_FONT = font_spec['title']
BODY_FONT = font_spec['body']
TITLE_EA = font_spec['titleEastAsia']
BODY_EA = font_spec['bodyEastAsia']
TITLE_HANT = font_spec.get('titleEastAsiaHant') or TITLE_EA
BODY_HANT = font_spec.get('bodyEastAsiaHant') or BODY_EA
prs = Presentation()
prs.slide_width = 12192000
prs.slide_height = 6858000
themes = {
  'violet': ((23, 27, 49), (150, 127, 255)),
  'blue': ((16, 43, 67), (85, 173, 226)),
  'light': ((248, 249, 252), (64, 75, 107)),
}
background, accent = themes.get(data.get('template'), themes['violet'])
palette = data.get('palette')
if palette:
    def rgb(value): return tuple(bytes.fromhex(value.removeprefix('#')))
    background, accent = rgb(palette['background']), rgb(palette['accent'])
    fg, muted = RGBColor(*rgb(palette['foreground'])), RGBColor(*rgb(palette['muted']))
else:
    light = data.get('template') == 'light'
    fg = RGBColor(36, 42, 59) if light else RGBColor(245, 246, 252)
    muted = RGBColor(80, 91, 111) if light else RGBColor(196, 201, 216)

def title_size(item, minimum=28):
    weight = sum(1 if ord(char) > 127 else .55 for char in item['title'])
    return max(minimum, 36 if weight <= 28 else (30 if weight <= 48 else 28))

def body_size(item, minimum=16):
    weight = sum(sum(1 if ord(char) > 127 else .55 for char in text) for text in item.get('bullets', []))
    return max(minimum, 21 if weight <= 90 else (18 if weight <= 150 else minimum))

def render_blocks(slide, blocks, x, y, w, h):
    if not blocks: return
    each = w / len(blocks)
    for index, block in enumerate(blocks):
        visual(slide, block, Inches(x + index * each), Inches(y), Inches(each - .18), Inches(h), accent, fg)

def scene_color(value, fallback):
    try: return RGBColor(*bytes.fromhex(value.removeprefix('#')))
    except: return fallback

def render_scene_element(slide, element):
    box = element['bounds']; x, y, w, h = box['x'], box['y'], box['width'], box['height']
    kind = element['kind']; content = element.get('content') or {}; item_style = element.get('style') or {}
    color = scene_color(item_style.get('color'), muted)
    size = float(item_style.get('fontSizePt') or 18)
    source=element.get('sourceArtifact') or {}
    source_name='AIMate source:'+str(source.get('sourceUnitId',''))+':'+str(source.get('type',''))
    if kind == 'shape' and element.get('semanticRole') == 'icon-carrier':
        shape=slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,x,y,w,h)
        theme_style=shape._element.find(qn('p:style'))
        if theme_style is not None: shape._element.remove(theme_style)
        shape._element.spPr.append(OxmlElement('a:effectLst'))
        shape.fill.solid();shape.fill.fore_color.rgb=scene_color(item_style.get('fill'),RGBColor(*accent));shape.line.fill.background()
        return
    if kind == 'text':
        if content.get('mathMl') and element.get('mathLayout'):
            mb=element['mathLayout']['bounds'];x,y,w,h=mb['x'],mb['y'],mb['width'],mb['height']
        shape = slide.shapes.add_textbox(x, y, w, h); para = shape.text_frame.paragraphs[0]
        if content.get('mathMl'):shape.text_frame.margin_left=shape.text_frame.margin_right=shape.text_frame.margin_top=shape.text_frame.margin_bottom=0
        if source: shape.name=source_name
        if element.get('sourceArtifact') and item_style.get('fill'): shape.fill.solid(); shape.fill.fore_color.rgb=scene_color(item_style['fill'],RGBColor(255,255,255))
        if not write_office_math(para,content,size,color):
            specs=(element.get('textLayout') or {}).get('paragraphs') or [{'text':str(content.get('text') or '')}]
            for index,spec in enumerate(specs):
                p=shape.text_frame.paragraphs[0] if index==0 else shape.text_frame.add_paragraph();p.text=spec['text']
                if content.get('richText'):
                    write_rich_text(p,content['richText'],size,str(color),item_style.get('fontFamily') or BODY_FONT,bool(item_style.get('fontWeight',400)>=600))
                    continue
                if content.get('codeBlock'):
                    p.clear()
                    for piece in re.split(r'([\u2e80-\u9fff\uf900-\ufaff]+)',spec['text']):
                        if piece:p.add_run().text=piece
                cjk_font(p,size,color,bool(item_style.get('fontWeight',400)>=600),'title' if element.get('semanticRole') in ('title','template-title') else 'body')
                if spec.get('runs'):
                    p.clear()
                    for item in spec['runs']:
                        run=p.add_run();run.text=item['text'];run.font.size=Pt(item['fontSizePt']);run.font.bold=bool(item.get('bold'));run.font.name=resolve_font(item_style.get('fontFamily') or BODY_FONT,run.text);run.font.color.rgb=color
                    for run,item in zip(list(p.runs),spec['runs']):
                        cjk_run(run,item['fontSizePt'],color,bool(item.get('bold')),'title' if element.get('semanticRole') in ('title','template-title') else 'body',item_style.get('fontFamily'))
        para.line_spacing = float(item_style.get('lineHeight') or 1.12)
        para.space_after = Pt(size * float(item_style.get('paragraphSpacingEm') or 0))
        for paragraph in shape.text_frame.paragraphs:
            paragraph.alignment = {'right':PP_ALIGN.RIGHT,'center':PP_ALIGN.CENTER}.get(item_style.get('textAlign'),PP_ALIGN.LEFT)
        if not content.get('richText') and not any(spec.get('runs') for spec in (element.get('textLayout') or {}).get('paragraphs',[])):
            cjk_font(para, size, color, bool(item_style.get('fontWeight', 400) >= 600), 'title' if element.get('semanticRole') in ('title','template-title') else 'body')
        apply_text_contract(shape.text_frame,element.get('textLayout') or {})
        if content.get('codeBlock'):
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:
                    run.font.name=resolve_font('Consolas',run.text);set_east_asia_font(run,run.font.name,language_for_text(run.text))
        shape.rotation = float(element.get('rotation') or 0)
        return
    if kind in ('list', 'timeline', 'metric'):
        items = content.get('items') or []
        point_layout = content.get('pointLayout') if kind == 'list' else None
        if point_layout and point_layout.get('boxes'):
            point_size = float(point_layout.get('fontSizePt') or size)
            for number, item in enumerate(items):
                if number >= len(point_layout['boxes']): break
                bounds = point_layout['boxes'][number]
                px = x + int(w * bounds['x']); py = y + int(h * bounds['y'])
                pw = int(w * bounds['w']); ph = int(h * bounds['h'])
                card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, px, py, pw, ph)
                # No inherited theme effects or centered paragraph defaults:
                # the same top alignment and fixed radius as the React/SVG cards.
                theme_style=card._element.find(qn('p:style'))
                if theme_style is not None: card._element.remove(theme_style)
                card._element.spPr.append(OxmlElement('a:effectLst'))
                card.adjustments[0]=min(.5,Pt(4.5)/max(1,min(pw,ph)))
                card.fill.background(); card.line.color.rgb = color
                card.line.width=Pt(.75)
                rgb_node=card._element.spPr.find(qn('a:ln')).find(qn('a:solidFill')).find(qn('a:srgbClr'))
                alpha=OxmlElement('a:alpha');alpha.set('val','20000');rgb_node.append(alpha)
                frame = card.text_frame; frame.clear(); frame.word_wrap = True
                frame.auto_size=MSO_AUTO_SIZE.NONE;frame.vertical_anchor=MSO_ANCHOR.TOP
                frame.margin_left = Pt(7.92); frame.margin_right = Pt(7.92)
                frame.margin_top = Pt(5.04); frame.margin_bottom = Pt(2.88)
                raw = str(item.get('text') or '')
                parts = raw.split('\n', 1)
                structured = bool(item.get('heading') or item.get('body'))
                heading = str(item.get('heading') or '') if structured else (parts[0] if len(parts) > 1 else '')
                body = str(item.get('body') or '') if structured else (parts[1] if len(parts) > 1 else raw)
                if heading:
                    heading_para = frame.paragraphs[0]; heading_para.text = heading
                    heading_para.space_after = Pt(3); heading_para.line_spacing = 1.18
                    if item.get('headingRich'):write_rich_text(heading_para,item['headingRich'],point_size,str(color),BODY_FONT,True)
                    else:cjk_font(heading_para, point_size, color, True, 'body')
                    body_para = frame.add_paragraph()
                else: body_para = frame.paragraphs[0]
                for paragraph in frame.paragraphs: paragraph.alignment=PP_ALIGN.LEFT;paragraph.space_before=Pt(0)
                body_para.text = body; body_para.line_spacing = 1.18
                body_para.space_after = Pt(0)
                for paragraph in frame.paragraphs:paragraph._p.get_or_add_pPr().set('hangingPunct','0')
                if item.get('bodyRich'):write_rich_text(body_para,item['bodyRich'],point_size,str(color),BODY_FONT)
                else:cjk_font(body_para, point_size, color)
            return
        shape = slide.shapes.add_textbox(x, y, w, h); shape.text_frame.word_wrap = True
        if source: shape.name=source_name
        if element.get('sourceArtifact') and item_style.get('fill'): shape.fill.solid(); shape.fill.fore_color.rgb=scene_color(item_style['fill'],RGBColor(255,255,255))
        for number, item in enumerate(items):
            para = shape.text_frame.paragraphs[0] if number == 0 else shape.text_frame.add_paragraph()
            prefix = (str(number + 1).zfill(2) + '  ') if kind == 'timeline' else ('' if kind == 'metric' and number == 0 else '•  ')
            specs=(element.get('textLayout') or {}).get('paragraphs') or []
            para.text = specs[number]['text'] if number<len(specs) else prefix + str(item.get('text') or '')
            para.line_spacing = float(item_style.get('lineHeight') or 1.12)
            para.space_after = Pt(size * float(item_style.get('paragraphSpacingEm') if item_style.get('paragraphSpacingEm') is not None else .35))
            if item.get('richText'):
                rich=dict(item['richText']);prefix_text=para.text[:-len(item['text'])] if item.get('text') else prefix
                rich['plainText']=prefix_text+rich['plainText'];rich['runs']=[{'kind':'text','text':prefix_text}]+rich['runs']
                write_rich_text(para,rich,size,str(color),item_style.get('fontFamily') or BODY_FONT,kind=='metric' and number==0)
            else:cjk_font(para, size, color, kind == 'metric' and number == 0, 'title' if kind == 'metric' and number == 0 else 'body')
        apply_text_contract(shape.text_frame,element.get('textLayout') or {})
        if content.get('codeBlock'):
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:
                    run.font.name=resolve_font('Consolas',run.text);set_east_asia_font(run,run.font.name,language_for_text(run.text))
        shape.rotation = float(element.get('rotation') or 0)
        return
    if kind in ('image', 'chart', 'table', 'shape'):
        block = dict(content); block['type'] = kind
        block['imageLayout']=element.get('imageLayout');block['chartLayout']=element.get('chartLayout')
        if kind == 'shape':
            block.setdefault('shape', 'rectangle'); block.setdefault('fill', item_style.get('fill') or '#64748b'); block.setdefault('text', '')
        rendered = visual(slide, block, x, y, w, h, accent, fg)
        if source and rendered is not None:
            for named in rendered if isinstance(rendered,list) else [rendered]:named.name=source_name
        if kind == 'table':
            table=rendered.table
            weights=content.get('columnWeights') or [1]*len(table.columns)
            for column,weight in zip(table.columns,weights): column.width=int(w*weight/sum(weights))
            weights=content.get('rowWeights') or [1]*len(table.rows)
            for row,weight in zip(table.rows,weights): row.height=int(h*weight/sum(weights))
            for r,row in enumerate(table.rows):
                for col,cell in enumerate(row.cells):
                    cell.margin_top=cell.margin_bottom=Pt(3);cell.margin_left=cell.margin_right=Pt(7.2);cell.text_frame.word_wrap=True;cell.text_frame.auto_size=MSO_AUTO_SIZE.NONE;cell.vertical_anchor=MSO_ANCHOR.TOP
                    cell.fill.fore_color.rgb=scene_color(item_style.get('fill'),RGBColor(*accent)) if r==0 else RGBColor(255,255,255)
                    if content.get('cellRich'):cell.text_frame.clear()
                    for paragraph in cell.text_frame.paragraphs:
                        paragraph.line_spacing=1.18; paragraph.space_before=Pt(0); paragraph.space_after=Pt(0)
                        if content.get('cellRich'):
                            write_rich_text(paragraph,content['cellRich'][r][col],size,str(scene_color(item_style.get('tableHeaderColor'),color) if r==0 else color),item_style.get('fontFamily') or BODY_FONT,r==0)
                        else:cjk_font(paragraph,size,scene_color(item_style.get('tableHeaderColor'),color) if r==0 else color,r==0)
        for shape in rendered if isinstance(rendered, list) else [rendered]:
            if shape is not None: shape.rotation = float(element.get('rotation') or 0)
        return
    placeholder = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    placeholder.fill.background(); placeholder.line.color.rgb = muted

for idx, item in enumerate(data['slides']):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = RGBColor(*background)
    band = slide.shapes.add_shape(1, 0, 0, prs.slide_width, Inches(.13))
    band.fill.solid()
    band.fill.fore_color.rgb = RGBColor(*accent)
    band.line.fill.background()
    scene_slides = (data.get('renderTree') or {}).get('slides') or []
    if idx < len(scene_slides):
        for element in scene_slides[idx].get('elements', []):
            if element.get('nodeId') is None and element.get('kind') == 'shape' and element.get('semanticRole') != 'icon-carrier': continue
            prior_ids={shape.shape_id for shape in slide.shapes}
            render_scene_element(slide, element)
            created=[shape for shape in slide.shapes if shape.shape_id not in prior_ids]
            for part,shape in enumerate(created):
                prefix=shape.name+'|' if shape.name.startswith('AIMate source:') else ''
                shape.name=prefix+'AIMate instance:'+str(element['id'])+':'+str(part)
        continue
    bullets = item.get('bullets', [])
    blocks = item.get('blocks', [])
    layout = item.get('layoutId')
    if not layout:
        if len(blocks) == 2: layout = 'comparison'
        elif any(block.get('type') == 'chart' for block in blocks): layout = 'chart'
        elif any(block.get('type') == 'table' for block in blocks): layout = 'table'
        elif any(block.get('type') == 'image' for block in blocks): layout = 'image-text'
        else: layout = 'summary'
    if layout == 'cover':
        textbox(slide, 1.1, 2.25, 11.1, 1.55, item['title'], max(38, title_size(item, 38)), fg, True, 'title', PP_ALIGN.CENTER)
        if bullets: bullets_box(slide, bullets[:1], 1.35, 4.05, 10.6, .85, 20, muted, False)
    else:
        minimum_title = 32 if layout == 'conclusion' else 28
        textbox(slide, .86, .72, 11.55, 1.18, item['title'], title_size(item, minimum_title), fg, True, 'title')
        if layout in ('summary', 'conclusion'):
            numbered_points(slide, bullets, 1.0, 2.15, 11.25, 4.4, body_size(item, 18 if layout == 'conclusion' else 17), muted, accent)
        elif layout == 'big-number':
            primary = bullets[0] if bullets else item['title']
            card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.0), Inches(2.15), Inches(11.25), Inches(2.15))
            card.fill.solid(); card.fill.fore_color.rgb = RGBColor(*accent); card.line.fill.background()
            paragraph = card.text_frame.paragraphs[0]; paragraph.text = primary; paragraph.alignment = PP_ALIGN.CENTER
            cjk_font(paragraph, 30, RGBColor(255,255,255), True, 'title')
            bullets_box(slide, bullets[1:], 1.0, 4.62, 11.25, 1.75, body_size({'bullets': bullets[1:]}, 20), muted)
            if blocks: render_blocks(slide, blocks[:1], 8.6, 2.35, 3.2, 1.75)
        elif layout == 'comparison':
            if blocks:
                render_blocks(slide, blocks[:2], 1.0, 2.12, 11.23, 3.65)
                bullets_box(slide, bullets, 1.0, 5.95, 11.23, .65, 16, muted)
            else:
                midpoint = max(1, math.ceil(len(bullets) / 2))
                bullets_box(slide, bullets[:midpoint], 1.0, 2.12, 5.35, 4.45, body_size(item, 17), muted)
                bullets_box(slide, bullets[midpoint:], 6.88, 2.12, 5.35, 4.45, body_size(item, 17), muted)
        elif layout == 'image-text':
            render_blocks(slide, blocks[:1], 1.0, 2.12, 5.45, 4.45)
            bullets_box(slide, bullets, 6.82, 2.12, 5.4, 4.45, body_size(item, 17), muted)
        elif layout == 'timeline':
            entries = bullets[:5]
            if entries:
                each = 11.25 / len(entries)
                for number, text in enumerate(entries):
                    box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.0 + each * number), Inches(2.55), Inches(each - .18), Inches(2.8))
                    box.fill.solid(); box.fill.fore_color.rgb = RGBColor(*accent); box.line.fill.background()
                    paragraph = box.text_frame.paragraphs[0]; paragraph.text = text; paragraph.alignment = PP_ALIGN.CENTER
                    cjk_font(paragraph, 16, RGBColor(255,255,255), True)
            if blocks: render_blocks(slide, blocks[:1], 1.0, 5.55, 11.25, .8)
        else:
            render_blocks(slide, blocks, 1.0, 2.02, 11.25, 3.62)
            bullets_box(slide, bullets, 1.0, 5.85, 11.25, .86, body_size(item, 16), muted)
    footer = slide.shapes.add_textbox(Inches(11.9), Inches(7.03), Inches(.52), Inches(.28))
    fp = footer.text_frame.paragraphs[0]
    fp.text = str(idx + 1)
    fp.alignment = PP_ALIGN.RIGHT
    cjk_font(fp, 11, muted)
target = os.environ.get('PPT_OUTPUT', '/workspace/presentation.pptx')
temp = target + '.part'
for note in (data.get('exportManifest') or {}).get('notes',[]):
    prs.slides[note['index']].notes_slide.notes_text_frame.text=note['text']
prs.save(temp)
# python-pptx can emit signed chart axis IDs even though OOXML declares axId as
# an unsigned integer. PowerPoint tolerates them, but strict readers reject the
# package. Normalize only chart axis IDs while preserving the editable charts.
normalized = temp + '.normalized'
with ZipFile(temp, 'r') as source, ZipFile(normalized, 'w', ZIP_DEFLATED) as target_zip:
    for info in source.infolist():
        blob = source.read(info.filename)
        if info.filename.startswith('ppt/charts/chart') and info.filename.endswith('.xml'):
            chart_xml = blob.decode('utf-8')
            chart_xml = re.sub(r'(<c:(?:axId|crossAx) val=")-(\d+)(")', r'\1\2\3', chart_xml)
            chart_xml = re.sub(r'(<a:latin typeface="[^"]+"/>)(?!\s*<a:ea\b)', lambda match: match.group(1) + '<a:ea typeface="'+escape(BODY_EA, {'"': '&quot;'})+'"/>', chart_xml)
            chart_text=' '.join(ET.fromstring(chart_xml).itertext())
            chart_font=resolve_font(BODY_EA if CJK_RE.search(chart_text) else BODY_FONT,chart_text)
            chart_xml=re.sub(r'<a:(?:latin|ea) typeface="[^"]+"/>','',chart_xml)
            latin_node = '<a:latin typeface="'+escape(chart_font, {'"': '&quot;'})+'"/>'
            east_asia_node = '<a:ea typeface="'+escape(chart_font, {'"': '&quot;'})+'"/>'
            chart_xml = re.sub(r'<a:(defRPr|endParaRPr)([^>]*)/>', lambda match: '<a:'+match.group(1)+match.group(2)+'>'+latin_node+east_asia_node+'</a:'+match.group(1)+'>', chart_xml)
            chart_xml = re.sub(r'<a:(defRPr|endParaRPr)([^>]*)>(.*?)</a:\1>',
                               lambda match: match.group(0) if '<a:latin ' in match.group(3) else '<a:'+match.group(1)+match.group(2)+'>'+match.group(3)+latin_node+east_asia_node+'</a:'+match.group(1)+'>',
                               chart_xml, flags=re.S)
            ns_chart={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
            # Preserve prefixes used by Office chart parsers.
            from lxml import etree as chart_etree
            chart_lxml=chart_etree.fromstring(chart_xml.encode('utf-8'))
            for run in chart_lxml.findall('.//a:r',ns_chart):
                rpr=run.find('a:rPr',ns_chart)
                if rpr is None:rpr=chart_etree.Element('{'+ns_chart['a']+'}rPr');run.insert(0,rpr)
                for tag in ('latin','ea'):
                    element=chart_etree.SubElement(rpr,'{'+ns_chart['a']+'}'+tag);element.set('typeface',chart_font)
            blob = chart_etree.tostring(chart_lxml)
        target_zip.writestr(info, blob)

def validate_font_integrity(package_path):
    ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
    failures = []
    with ZipFile(package_path, 'r') as archive:
        for name in archive.namelist():
            if not name.endswith('.xml') or not (name.startswith('ppt/slides/') or name.startswith('ppt/charts/')):
                continue
            raw_xml = archive.read(name)
            if b'\xef\xbf\xbd' in raw_xml:
                failures.append(name + ': contains Unicode replacement character')
            root = ET.fromstring(raw_xml)
            for tag in ('r', 'fld'):
                for run in root.findall('.//a:' + tag, ns):
                    text = ''.join((node.text or '') for node in run.findall('.//a:t', ns))
                    if not CJK_RE.search(text):
                        continue
                    rpr = run.find('a:rPr', ns)
                    ea = rpr.find('a:ea', ns) if rpr is not None else None
                    if ea is None or not (ea.attrib.get('typeface') or '').strip():
                        failures.append(name + ': CJK run is missing a:ea')
    if failures:
        raise ValueError('PPTX font integrity validation failed: ' + '; '.join(failures[:12]))

validate_font_integrity(normalized)
os.replace(normalized, temp)
os.replace(temp, target)
verification=verify_export(target,data.get('exportManifest'))
print(json.dumps({'slides': len(prs.slides), 'path': target, 'bytes': os.path.getsize(target),'exportVerification':verification,'fontResolution':list(FONT_RESOLUTIONS.values())}))
`;

export async function renderPptx(project, io = {}) {
  const tree=project.renderTree?.renderContractVersion===RENDER_CONTRACT_VERSION?project.renderTree:buildRenderTree(project);
  const payload=JSON.stringify({ slides: project.deck.slides, renderTree: tree, exportManifest:exportManifest(project,tree), template: project.template, palette: project.templateSpec?.palette, fonts: project.templateSpec?.fonts });
  if(io.runPython)return io.runPython(project,SCRIPT,payload);
  const { name } = await orch.ensureContainer(project.id, project.uid, orch.KIND_PPT);
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', '-u', String(orch.AGENT_UID), '-e', `PPT_OUTPUT=${project.renderOutput || '/workspace/presentation.pptx'}`, name, 'python3', '-c', SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { out = (out + c).slice(-10000); });
    child.stderr.on('data', (c) => { err = (err + c).slice(-10000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`PPTX render failed (${code}): ${err.slice(-500)}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('PPTX renderer returned invalid result')); }
    });
    child.stdin.on('error', () => { /* child exit is handled above */ });
    child.stdin.end(payload);
  });
}

export const _internals = { SCRIPT };
