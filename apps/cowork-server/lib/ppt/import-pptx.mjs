import {fitNativeTextFrames,fitSourceMathFrames} from '../ppt-native-text-fit.mjs';
import {SOURCE_MATH_SCRIPT} from '../ppt-source-math-python.mjs';
import { titleFromNativeShapes } from '../ppt-editorial-review.mjs';
import { EXPORT_VERIFY_SCRIPT } from './export-verifier-python.mjs';
import { templateLimits, TEMPLATE_SECURITY_SCRIPT } from '../ppt-template-security.mjs';
import { OFFICE_MATH_SCRIPT } from '../ppt-math.mjs';
import { exportManifest } from '../ppt-export-integrity.mjs';
import { THEME_SCRIPT } from '../ppt-theme.mjs';
import { textContract, imageContract, chartContract } from './render-contract.mjs';
import { RENDER_CONTRACT_SCRIPT, NATIVE_CHART_CONTRACT_SCRIPT } from './render-contract-python.mjs';
import { FONT_SCRIPT } from '../ppt-fonts.mjs';
import { spawn } from 'node:child_process';
import { isSourceOwnedNode } from '../ppt-source-artifacts.mjs';
import * as orch from '../orchestrator.mjs';
import { ensureDeckV3, stableId } from './ir.mjs';

const IMPORT_SCRIPT = String.raw`
import base64, io, json, os, sys
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE, MSO_SHAPE
from pptx.enum.dml import MSO_COLOR_TYPE
from pptx.oxml.ns import qn
${THEME_SCRIPT}
${OFFICE_MATH_SCRIPT}
${SOURCE_MATH_SCRIPT}
media_warnings=[]
${NATIVE_CHART_CONTRACT_SCRIPT}
raw=sys.stdin.buffer.read(); ext='pptx'
${TEMPLATE_SECURITY_SCRIPT}
prs=Presentation(io.BytesIO(raw)); slides=[]
target=os.path.join(os.environ.get('PPT_EXTERNAL_DIR','/workspace/external'),'original.pptx'); os.makedirs(os.path.dirname(target), exist_ok=True)
with open(target+'.part','wb') as f: f.write(raw)
os.replace(target+'.part',target)
for slide_index, slide in enumerate(prs.slides):
    shapes=[]
    for z_index, shape in enumerate(slide.shapes):
        item={'shapeId': int(shape.shape_id), 'name': shape.name, 'x': int(shape.left), 'y': int(shape.top), 'width': int(shape.width), 'height': int(shape.height), 'kind':'foreign', 'locked':True, 'zIndex':z_index,'rotation':float(shape.rotation), 'shapeType':str(shape.shape_type)}
        if shape.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE:
            try: item['autoShapeType']=str(shape.auto_shape_type)
            except (AttributeError,TypeError,ValueError): pass
        try:
            if shape.fill.type and shape.fill.fore_color.type == MSO_COLOR_TYPE.RGB:
                item['fill']='#'+str(shape.fill.fore_color.rgb).lower()
        except (AttributeError,TypeError,ValueError): pass
        if shape.has_text_frame and rich_visible_text(shape._element).strip():
            item.update({'kind':'text','locked':False,'text':rich_visible_text(shape._element),'nativeMath':bool(shape._element.findall('.//'+qn('m:oMath'))),'isTitle': bool(slide.shapes.title is shape)})
            frame=shape.text_frame
            item['textFrame']={'wordWrap':frame.word_wrap,'autoSize':str(frame.auto_size) if frame.auto_size is not None else None,
                'margins':[int(frame.margin_left),int(frame.margin_top),int(frame.margin_right),int(frame.margin_bottom)],
                'paragraphs':[{'text':rich_visible_text(paragraph._p),'level':paragraph.level,
                    'lineSpacing':(round(float(paragraph.line_spacing),3) if isinstance(paragraph.line_spacing,float)
                        else round(paragraph.line_spacing.pt / max(1, next((run.font.size.pt for run in paragraph.runs if run.font.size), 18)),3)
                        if paragraph.line_spacing is not None else None),
                    'spaceAfterPt':round(paragraph.space_after.pt,2) if paragraph.space_after is not None else None,
                    'bulletChar':(paragraph._p.pPr.find(qn('a:buChar')).get('char') if paragraph._p.pPr is not None and paragraph._p.pPr.find(qn('a:buChar')) is not None else None),
                    'runs':[{'text':run.text,'fontSizePt':round(run.font.size.pt,2) if run.font.size else None,
                        'fontFamily':run.font.name,'bold':run.font.bold,'italic':run.font.italic} for run in paragraph.runs]}
                    for paragraph in frame.paragraphs]}
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:
                    if run.text.strip():
                        if run.font.name: item['fontFamily']=run.font.name
                        if run.font.size: item['fontSizePt']=round(run.font.size.pt,2)
                        if run.font.bold is not None: item['bold']=bool(run.font.bold)
                        if run.font.italic is not None: item['italic']=bool(run.font.italic)
                        try:
                            for child in run._r.get_or_add_rPr():
                                if child.tag.endswith('}ea') and child.get('typeface'):
                                    family=child.get('typeface'); lowered=family.lower()
                                    if any(marker in lowered for marker in ('cjk','source han','yahei','simhei','simsun','dengxian','jhenghei','mingliu','heiti','songti','hiragino','yu gothic','meiryo')) or any(marker in family for marker in ('等线','微软雅黑','宋体','黑体','苹方','華文','新細明體','微軟正黑體')):
                                        item['eastAsiaFontFamily']=family
                                    break
                        except (AttributeError,TypeError,ValueError): pass
                        try:
                            if run.font.color.type == MSO_COLOR_TYPE.RGB: item['color']='#'+str(run.font.color.rgb).lower()
                        except (AttributeError,TypeError,ValueError): pass
                        break
                if 'fontSizePt' in item: break
        elif shape.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE:
            item.update({'kind':'shape','locked':True})
        elif shape.has_table:
            item.update({'kind':'table','rows':[[rich_visible_text(cell._tc) for cell in row.cells] for row in shape.table.rows],'columnWeights':[int(col.width) for col in shape.table.columns],'rowWeights':[int(row.height) for row in shape.table.rows], 'locked':True})
        elif shape.has_chart:
            chart=shape.chart
            item.update({'kind':'chart','locked':True,'chartContent':{'labels':[str(c.label) for c in chart.plots[0].categories], 'values':list(chart.series[0].values) if chart.series else [],'series':[{'name':series.name,'values':list(series.values)} for series in chart.series], 'nativeChartType':str(chart.chart_type),'chartType':{'PIE':'pie','LINE':'line','LINE_MARKERS':'line','COLUMN_CLUSTERED':'bar','BAR_CLUSTERED':'bar'}.get(str(chart.chart_type).split(' ')[0],'unsupported'),'nativeChartStructureSha256':native_chart_structure_hash(chart),'nativeChartSha256':__import__('hashlib').sha256(chart.part.blob).hexdigest()}})
        elif shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
            image=shape.image
            subtype={'jpg':'jpeg','jpeg':'jpeg','png':'png','gif':'gif','svg':'svg+xml','webp':'webp'}.get(image.ext.lower())
            image_dhash=None; monochrome_panel=False;foreground_color=None;panel_color=None
            try:
                from PIL import Image, ImageStat
                decoded=Image.open(io.BytesIO(image.blob)); decoded.load()
                sample=decoded.convert('L').resize((9,8))
                if image.ext.lower()=='png':
                    rgba=decoded.convert('RGBA'); mask=rgba.getchannel('A').point(lambda a:255 if a>=128 else 0)
                    extrema=ImageStat.Stat(rgba.convert('RGB'),mask).extrema
                    monochrome_panel=bool(mask.getbbox()) and all(hi-lo<=2 for lo,hi in extrema)
                    if monochrome_panel and sum(mask.getdata())/(255*rgba.width*rgba.height)>=.99:panel_color='#'+''.join('%02x'%round(v) for v in ImageStat.Stat(rgba.convert('RGB'),mask).mean)
                    if monochrome_panel and sum(mask.getdata())/(255*rgba.width*rgba.height)<.9:foreground_color='#'+''.join('%02x'%round(v) for v in ImageStat.Stat(rgba.convert('RGB'),mask).mean)
                pixels=list(sample.getdata())
                bits=0
                for row in range(8):
                    for column in range(8): bits=(bits<<1) | int(pixels[row*9+column]>pixels[row*9+column+1])
                image_dhash=format(bits,'016x')
            except Exception: pass
            item.update({'kind':'image','dataUrl':('data:image/'+subtype+';base64,'+base64.b64encode(image.blob).decode()) if subtype else None,
                         'locked':True,'crop':[shape.crop_left,shape.crop_top,shape.crop_right,shape.crop_bottom],
                         'imageSha256':__import__('hashlib').sha256(image.blob).hexdigest(),'imageDhash':image_dhash,'monochromePanel':monochrome_panel,'panelColor':panel_color,'foregroundColor':foreground_color})
        if item['kind']=='image':
            geometry=shape._element.find('.//'+qn('a:prstGeom'))
            if geometry is None:geometry=shape._element.find('.//'+qn('a:custGeom'))
            if geometry is not None:item['maskXml']=geometry.xml
        if item['kind']=='foreign':
            item['xmlHash']=__import__('hashlib').sha256(shape._element.xml.encode()).hexdigest()
            def media_hashes(shapes):
                result=[]
                for nested in shapes:
                    if hasattr(nested,'image'):result.append(__import__('hashlib').sha256(nested.image.blob).hexdigest())
                    if hasattr(nested,'shapes'):result.extend(media_hashes(nested.shapes))
                return result
            item['nestedMediaHashes']=media_hashes(shape.shapes) if hasattr(shape,'shapes') else []
        if shape._element.findall('.//'+qn('m:oMath')):
            from lxml import etree as import_xml
            item['nativeRawText']=source_formula_text(shape._element,'Imported formula')
            item['nativeMathStructures']=[import_xml.tostring(v,encoding='unicode') for v in shape._element.findall('.//'+qn('m:oMath'))]
        shapes.append(item)
    background=None
    try:
        if slide.background.fill.type and slide.background.fill.fore_color.type == MSO_COLOR_TYPE.RGB:
            background='#'+str(slide.background.fill.fore_color.rgb).lower()
    except (AttributeError,TypeError,ValueError): pass
    background,bg_basis=effective_background(slide,int(prs.slide_width),int(prs.slide_height))
    slides.append({'index':slide_index,'shapes':shapes,'background':'#'+background.lower(),'backgroundBasis':bg_basis})
print(json.dumps({'width':int(prs.slide_width),'height':int(prs.slide_height),'slides':slides,'path':target},ensure_ascii=False))
`;

const EXPORT_SCRIPT = String.raw`
import base64, copy, hashlib, io, json, os, re, sys
from pptx import Presentation
from pptx.oxml.xmlchemy import OxmlElement
from pptx.oxml.ns import qn
from pptx.util import Pt, Inches
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE_TYPE, MSO_SHAPE

${OFFICE_MATH_SCRIPT}
${EXPORT_VERIFY_SCRIPT}
${FONT_SCRIPT}
${RENDER_CONTRACT_SCRIPT}

data=json.load(sys.stdin); original=data['original']; prs=Presentation(original)
if data.get('title') is not None:prs.core_properties.title=str(data['title'])
os.environ.update(office_font_environment(os.path.join(os.path.dirname(original),'.template-font-runtime'),original))
source_slide_map=data.get('sourceSlideMap')
if source_slide_map is not None:
    source_count=len(prs.slides)
    if not isinstance(source_slide_map,list) or len(source_slide_map)<source_count or any(type(index) is not int or index<0 or index>=source_count for index in source_slide_map):
        raise ValueError('invalid native template slide map')
    if sorted(set(source_slide_map))!=list(range(source_count)):
        raise ValueError('native template slide map must preserve every original slide')
    original_ids=list(prs.slides._sldIdLst)
    occurrence={}
    ordered_ids=[]
    for source_index in source_slide_map:
        used=occurrence.get(source_index,0)
        occurrence[source_index]=used+1
        if used==0:
            ordered_ids.append(original_ids[source_index]); continue
        source=prs.slides[source_index]
        target=prs.slides.add_slide(source.slide_layout)
        target._element.replace(target._element.cSld,copy.deepcopy(source._element.cSld))
        relation_ids={}
        for relation in source.part.rels.values():
            if relation.reltype.endswith('/slideLayout') or relation.reltype.endswith('/notesSlide'): continue
            new_id=target.part.relate_to(relation.target_ref if relation.is_external else relation.target_part,relation.reltype,is_external=relation.is_external)
            relation_ids[relation.rId]=new_id
        for element in target._element.iter():
            for key,value in list(element.attrib.items()):
                if key.startswith('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}') and value in relation_ids:
                    element.set(key,relation_ids[value])
        ordered_ids.append(list(prs.slides._sldIdLst)[-1])
    slide_ids=prs.slides._sldIdLst
    for slide_id in list(slide_ids): slide_ids.remove(slide_id)
    for slide_id in ordered_ids: slide_ids.append(slide_id)
    # python-pptx caches slide objects while the list is mutated. Reload the
    # reordered deck so output indices address the cloned slides correctly.
    reordered=io.BytesIO(); prs.save(reordered); reordered.seek(0); prs=Presentation(reordered)
fonts=data.get('fonts') or {}
required=('title','body','titleEastAsia','bodyEastAsia')
if any(not isinstance(fonts.get(key), str) or not fonts[key].strip() for key in required):
    raise ValueError('template title/body font tokens are required for external PPTX export')
CJK_RE=re.compile(r'[\u2e80-\u9fff\uf900-\ufaff]')
HANT_RE=re.compile(r'[萬與為於後臺國學實體廣應當復雜雙發變這個們體繁臺灣]')

def set_east_asia(run, role='body', family=None):
    if not CJK_RE.search(run.text or ''):
        for part,actual in font_runs(run,run.font.name or fonts['body']):part.font.name=actual
        return
    if HANT_RE.search(run.text or ''):
        east_asia=fonts.get('titleEastAsiaHant' if role == 'title' else 'bodyEastAsiaHant') or family or (fonts['titleEastAsia'] if role == 'title' else fonts['bodyEastAsia'])
    else:
        east_asia=family or (fonts['titleEastAsia'] if role == 'title' else fonts['bodyEastAsia'])
    latin=run.font.name or fonts['title' if role=='title' else 'body']
    for part,actual in font_runs(run,latin,east_asia):
        part.font.name=actual
        rpr=part._r.get_or_add_rPr()
        for child in list(rpr):
            if child.tag == qn('a:ea'): rpr.remove(child)
        ea=OxmlElement('a:ea'); ea.set('typeface', actual); rpr.append(ea); rpr.set('lang',('zh-HK' if HANT_RE.search(part.text or '') else 'zh-CN') if CJK_RE.search(part.text or '') else 'en-US')

def apply_frame_fonts(frame, role='body', family=None):
    for paragraph in frame.paragraphs:
        for run in paragraph.runs: set_east_asia(run, role, family)

def shape_text_frames(slide, shape):
    if shape.has_text_frame:
        yield shape.text_frame, 'title' if slide.shapes.title is shape else 'body'
    if shape.has_table:
        for row in shape.table.rows:
            for cell in row.cells: yield cell.text_frame, 'body'

def add_source_artifact(slide, node):
    g=node['geometry']; c=node.get('content') or {}; style=node.get('style') or {}
    font='Consolas' if c.get('codeBlock') else style.get('fontFamily') or fonts['body']; pt=float(style.get('fontSizePt',18))
    if node['type']=='image':
        from PIL import Image as ArtifactImage
        blob=base64.b64decode(c['dataUrl'].split(',',1)[1]);image=ArtifactImage.open(io.BytesIO(blob));image.load()
        shape=contract_picture(slide,blob,g['x'],g['y'],g['width'],g['height'],node.get('imageLayout') or {'fit':'contain'})
    elif node['type']=='chart':
        from pptx.chart.data import CategoryChartData
        from pptx.enum.chart import XL_CHART_TYPE
        contract=node.get('chartLayout') or {}
        if not contract.get('valid'):raise ValueError('source chart has invalid measured data')
        data=CategoryChartData();data.categories=c['labels']
        for series in c.get('series') or [{'name':'Values','values':c['values']}]:data.add_series(series['name'],series['values'])
        kind={'bar':XL_CHART_TYPE.COLUMN_CLUSTERED,'line':XL_CHART_TYPE.LINE_MARKERS,'pie':XL_CHART_TYPE.PIE}[c['chartType']]
        card=slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,int(g['x']),int(g['y']),int(g['width']),int(g['height']));card.fill.solid();card.fill.fore_color.rgb=RGBColor(255,255,255);card.line.fill.background()
        card.name='AIMate instance:'+str(node['id'])+':0'
        inset=Inches(.14);shape=slide.shapes.add_chart(kind,int(g['x']+inset),int(g['y']+inset),int(g['width']-2*inset),int(g['height']-2*inset),data);chart=shape.chart
        title=c.get('chartTitle') or c.get('unit');chart.has_title=bool(title);chart.has_legend=len(c.get('series') or [])>1 or c['chartType']=='pie'
        if chart.has_title:chart.chart_title.text_frame.text=title;apply_frame_fonts(chart.chart_title.text_frame)
        if c['chartType'] in ('bar','line'):
            chart.value_axis.minimum_scale=contract['minimum'];chart.value_axis.maximum_scale=contract['maximum'];chart.value_axis.crosses_at=0
            chart.value_axis.tick_labels.number_format=contract['numberFormat'];chart.value_axis.tick_labels.number_format_is_linked=False
            chart.category_axis.tick_labels.font.name=fonts['body'];chart.category_axis.tick_labels.font.size=Pt(10)
            chart.value_axis.tick_labels.font.name=fonts['body'];chart.value_axis.tick_labels.font.size=Pt(10)
            for axis,title in zip((chart.category_axis,chart.value_axis),c.get('axisTitles') or []):
                axis.has_title=bool(title)
                if title:axis.axis_title.text_frame.text=title;apply_frame_fonts(axis.axis_title.text_frame)
        if c['chartType']=='bar':
            for series in chart.series:series.invert_if_negative=False
        # Explicit chart script fonts; don't rely on inherited Office defaults.
        chart_text=' '.join(str(v) for v in c['labels']);family=resolve_font(fonts['bodyEastAsiaHant'] if HANT_RE.search(chart_text) else fonts['bodyEastAsia'] if CJK_RE.search(chart_text) else fonts['body'],chart_text)
        tx=OxmlElement('c:txPr');body=OxmlElement('a:bodyPr');tx.append(body);tx.append(OxmlElement('a:lstStyle'));para=OxmlElement('a:p');pr=OxmlElement('a:pPr');rpr=OxmlElement('a:defRPr');rpr.set('sz','1000')
        for tag in ('a:latin','a:ea'):f=OxmlElement(tag);f.set('typeface',family);rpr.append(f)
        pr.append(rpr);para.append(pr);tx.append(para);chart._chartSpace.append(tx)
        shape.name='AIMate instance:'+str(node['id'])+':1'
        return [int(card.shape_id),int(shape.shape_id)]
    elif node['type']=='table':
        rows=c['rows']; shape=slide.shapes.add_table(len(rows),len(rows[0]),int(g['x']),int(g['y']),int(g['width']),int(g['height']))
        weights=c.get('columnWeights') or [1]*len(rows[0]); weight_sum=sum(weights)
        for col,weight in enumerate(weights): shape.table.columns[col].width=int(g['width']*weight/weight_sum)
        row_weights=c.get('rowWeights') or [1]*len(rows); row_sum=sum(row_weights)
        for r,weight in enumerate(row_weights): shape.table.rows[r].height=int(g['height']*weight/row_sum)
        for r,row in enumerate(rows):
            for col,value in enumerate(row):
                cell=shape.table.cell(r,col); cell.text=str(value); cell.margin_top=cell.margin_bottom=Pt(3); cell.margin_left=cell.margin_right=Pt(7.2); cell.text_frame.word_wrap=True; cell.text_frame.auto_size=MSO_AUTO_SIZE.NONE; cell.vertical_anchor=MSO_ANCHOR.TOP; cell.fill.solid(); cell.fill.fore_color.rgb=RGBColor.from_string((style.get('fill','#e7e5f4') if r==0 else '#ffffff').lstrip('#'))
                rich=(c.get('cellRich') or [])[r][col] if c.get('cellRich') else None
                if rich:
                    cell.text_frame.clear()
                    write_rich_text(cell.text_frame.paragraphs[0],rich,pt,style.get('tableHeaderColor' if r==0 else 'color','#242a3b'),font,r==0)
                for p in cell.text_frame.paragraphs:
                    p._p.get_or_add_pPr().set('hangingPunct','0')
                    p.line_spacing=1.18; p.space_before=Pt(0); p.space_after=Pt(0)
                    if not rich:
                        for run in p.runs: run.font.name=fonts['bodyEastAsia'] if CJK_RE.search(run.text) else font; run.font.size=Pt(pt); run.font.bold=(r==0); run.font.color.rgb=RGBColor.from_string(str(style.get('tableHeaderColor' if r==0 else 'color','#242a3b')).lstrip('#')); set_east_asia(run)
    else:
        shape=slide.shapes.add_textbox(int(g['x']),int(g['y']),int(g['width']),int(g['height']))
        shape.fill.solid(); shape.fill.fore_color.rgb=RGBColor.from_string(style.get('fill','#ffffff').lstrip('#'))
        frame=shape.text_frame; frame.word_wrap=True
        if c.get('mathMl'):frame.margin_left=frame.margin_right=frame.margin_top=frame.margin_bottom=0
        values=[] if c.get('mathMl') and write_office_math(frame.paragraphs[0],c,pt,style.get('color','#111111')) else [item['text'] for item in c.get('items',[])] if node['type'] in ('list','timeline') else [paragraph['text'] for paragraph in (node.get('textLayout') or {}).get('paragraphs',[])] if (node.get('textLayout') or {}).get('paragraphs') else str(c.get('text','')).split('\n')
        for i,value in enumerate(values):
            prefix=(('' if re.match(r'^\s*[0-9]+[.)]\s',str(value)) else str(i+1)+'. ') if node['type']=='timeline' else '• ' if node['type']=='list' else '')
            specs=(node.get('textLayout') or {}).get('paragraphs') or []
            expected=specs[i]['text'] if i<len(specs) else prefix+str(value)
            if str(value) and expected.endswith(str(value)):prefix=expected[:-len(str(value))]
            p=frame.paragraphs[0] if i==0 else frame.add_paragraph(); p.text=expected; p.line_spacing=float(style.get('lineHeight',1.18)); p.space_after=Pt(pt*float(style.get('paragraphSpacingEm',.4 if node['type'] in ('list','timeline') else 0)))
            if c.get('richText'):write_rich_text(p,c['richText'],pt,style.get('color','#333333'),font)
            elif c.get('items') and c['items'][i].get('richText'):
                rich=dict(c['items'][i]['richText'])
                rich['plainText']=prefix+rich['plainText'];rich['runs']=[{'kind':'text','text':prefix}]+rich['runs']
                write_rich_text(p,rich,pt,style.get('color','#333333'),font)
            if c.get('codeBlock'):
                p.clear()
                for piece in re.split(r'([\u2e80-\u9fff\uf900-\ufaff]+)',str(value)):
                    if piece:p.add_run().text=piece
            for run in p.runs:
                run.font.name=fonts['bodyEastAsia'] if CJK_RE.search(run.text) else font; run.font.size=Pt(pt); run.font.color.rgb=RGBColor.from_string(str(style.get('color','#333333')).lstrip('#')); set_east_asia(run,family=font if c.get('codeBlock') else None)
    if node['type'] in ('text','list','timeline'):apply_text_contract(shape.text_frame,node.get('textLayout') or {})
    source=node.get('sourceArtifact') or {}
    shape.name='AIMate source:'+str(source.get('sourceUnitId',''))+':'+str(source.get('type',''))+'|AIMate instance:'+str(node.get('id',''))+(':1' if node['type']=='chart' else ':0')
    return [int(card.shape_id),int(shape.shape_id)] if node['type']=='chart' else int(shape.shape_id)

by_slide={int(item['nativeSlideIndex']):item for item in data['slides'] if item.get('nativeSlideIndex') is not None}
role_overrides={}
for slide_index, slide in enumerate(prs.slides):
    update=by_slide.get(slide_index)
    if not update: continue
    by_shape={int(node['nativeShapeId']):node for node in update.get('nodes',[]) if node.get('nativeShapeId') is not None}
    originals={int(shape.shape_id):copy.deepcopy(shape._element) for shape in slide.shapes}
    clone_nodes=[node for node in update.get('nodes',[]) if node.get('cloneFromShapeId') is not None]
    clone_ids=[int(node['nativeShapeId']) for node in clone_nodes]
    if len(set(clone_ids))!=len(clone_ids) or set(clone_ids)&set(originals):
        raise ValueError('duplicate native component instance IDs')
    id_maps={}
    for member in clone_nodes:
        binding=member.get('componentBinding') or {}
        key=(binding.get('componentSpecId'),binding.get('unitIndex'))
        id_maps.setdefault(key,{})[int(member['cloneFromShapeId'])]=int(member['nativeShapeId'])
    for node in clone_nodes:
        origin=int(node['cloneFromShapeId']);target=int(node['nativeShapeId'])
        binding=node.get('componentBinding') or {};id_map=id_maps.get((binding.get('componentSpecId'),binding.get('unitIndex')),{})
        if origin not in originals or node.get('type') not in ('image','shape','text'):
            raise ValueError('unsupported or missing native component member')
        element=copy.deepcopy(originals[origin])
        for child in element.iter():
            if child.tag==qn('p:cNvPr'):
                child.set('id',str(target));child.set('name',(child.get('name') or 'Component')+' instance '+str(target))
            if child.tag in (qn('a:stCxn'),qn('a:endCxn')):
                bound=int(child.get('id','0'))
                if bound in id_map:child.set('id',str(id_map[bound]))
                else:child.getparent().remove(child)
        slide.shapes._spTree.insert_element_before(element,'p:extLst')
    update['cloneShapeIds']=clone_ids
    omitted={int(shape_id) for shape_id in update.get('omitShapeIds',[])}
    if omitted and (omitted & set(by_shape)):
        raise ValueError('omitted template shape is also present in native nodes on slide '+str(slide_index+1))
    for shape in list(slide.shapes):
        if int(shape.shape_id) in omitted:
            slide.shapes._spTree.remove(shape._element)
            continue
        node=by_shape.get(int(shape.shape_id))
        if not node: continue
        geometry=node.get('geometry') or {}
        for key in ('x','y','width','height'):
            if key in geometry: setattr(shape, {'x':'left','y':'top','width':'width','height':'height'}[key], int(geometry[key]))
        if node.get('rotation') is not None:shape.rotation=float(node['rotation'])
        content=node.get('content') or {}
        if node['type']=='chart' and shape.has_chart and content.get('chartType') in ('bar','line') and content.get('values'):
            axis=node.get('chartLayout') or {}
            shape.chart.value_axis.minimum_scale=axis['minimum'];shape.chart.value_axis.maximum_scale=axis['maximum'];shape.chart.value_axis.crosses_at=0
            if content['chartType']=='bar':
                for series in shape.chart.series:series.invert_if_negative=False
        if content.get('mediaReplacement'):
            if shape.shape_type!=MSO_SHAPE_TYPE.PICTURE or source_slide_map is None or source_slide_map[:slide_index].count(source_slide_map[slide_index])<1:
                raise ValueError('native media replacement is only allowed on a copied picture')
            match=re.fullmatch(r'data:image/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})',content.get('dataUrl') or '')
            if not match: raise ValueError('invalid replacement image')
            image_bytes=base64.b64decode(match.group(2),validate=True)
            if hashlib.sha256(image_bytes).hexdigest()!=content.get('imageSha256'):
                raise ValueError('replacement image hash mismatch')
            _,relationship_id=slide.part.get_or_add_image_part(io.BytesIO(image_bytes))
            shape._element.blipFill.blip.rEmbed=relationship_id
        crop=content.get('crop')
        if shape.shape_type==MSO_SHAPE_TYPE.PICTURE and isinstance(crop,list) and len(crop)==4:
            if any(not isinstance(value,(int,float)) or value<0 or value>=1 for value in crop) or crop[0]+crop[2]>=1 or crop[1]+crop[3]>=1:
                raise ValueError('invalid native picture crop on slide '+str(slide_index+1))
            shape.crop_left,shape.crop_top,shape.crop_right,shape.crop_bottom=map(float,crop)
        style=node.get('style') or {}
        if style.get('fill') and node.get('type') in ('shape','text'):
            shape.fill.solid(); shape.fill.fore_color.rgb=RGBColor.from_string(style['fill'].lstrip('#').upper())
        if shape.has_text_frame and node.get('type')=='text' and not (node.get('content',{}).get('nativeMath') and node['content'].get('text')==node['content'].get('nativeOriginalText')):
            content=node.get('content') or {}
            value=str(content.get('text') or '')
            role='title' if node.get('semanticRole') in ('title','template-title') else 'body'
            role_overrides[(slide_index, int(shape.shape_id))]=role
            family=(node.get('style') or {}).get('eastAsiaFontFamily')
            paragraph_items=content.get('paragraphs')
            if value == rich_visible_text(shape._element) and paragraph_items is None:
                # Style-only edits retain the native paragraphs/runs. Moving
                # the whole string into run 1 destroys multi-paragraph fonts,
                # list spacing and formatting even when the text is unchanged.
                pass
            elif content.get('richText'):
                for extra in list(shape.text_frame.paragraphs)[1:]:shape.text_frame._txBody.remove(extra._p)
                write_rich_text(shape.text_frame.paragraphs[0],content['richText'],float(style.get('fontSizePt',18)),style.get('color','#111111'),style.get('fontFamily') or fonts['body'],bool(style.get('fontWeight',400)>=600))
            elif content.get('nativeMath'):
                raise ValueError('native_formula_edit_requires_typed_source: supply the formula source before changing imported math')
            elif paragraph_items is not None:
                source_paragraphs=[paragraph for paragraph in shape.text_frame.paragraphs if paragraph.text.strip()]
                if not isinstance(paragraph_items,list) or len(paragraph_items)!=len(source_paragraphs):
                    raise ValueError('native template paragraph count mismatch on slide '+str(slide_index+1)+' shape '+str(shape.shape_id))
                for paragraph_index,(paragraph,item) in enumerate(zip(source_paragraphs,paragraph_items)):
                    if not isinstance(item,dict) or not str(item.get('body') or '').strip():
                        raise ValueError('native template paragraph is empty on slide '+str(slide_index+1)+' shape '+str(shape.shape_id))
                    label=str(item.get('label') or '').strip(); body=str(item['body']).strip()
                    if item.get('richText'):
                        pt=next((r.font.size.pt for r in paragraph.runs if r.font.size),float(style.get('fontSizePt',18)))
                        rich=dict(item['richText']);specs=(node.get('textLayout') or {}).get('paragraphs',[])
                        if paragraph_index<len(specs):rich['runs']=specs[paragraph_index].get('runs',rich['runs'])
                        write_rich_text(paragraph,rich,pt,style.get('color','#111111'),style.get('fontFamily') or fonts['body'])
                        continue
                    runs=paragraph.runs
                    has_label=bool(len(runs)>1 and runs[0].font.bold and any(run.text.strip() for run in runs[1:]))
                    if has_label:
                        if not label: raise ValueError('native template label is empty')
                        runs[0].text=label
                        runs[1].text=('' if body.startswith(('：',':','（','(')) else '：')+body
                        for run in runs[2:]: run.text=''
                    elif runs:
                        runs[0].text=body if not label else label+'：'+body
                        for run in runs[1:]: run.text=''
                    else: paragraph.text=body if not label else label+'：'+body
            else:
                runs=[run for paragraph in shape.text_frame.paragraphs for run in paragraph.runs]
                if runs:
                    runs[0].text=value
                    for run in runs[1:]: run.text=''
                else: shape.text=value
            apply_text_contract(shape.text_frame,node.get('textLayout') or {})
            if content.get('templateFit'):
                shape.text_frame.auto_size=MSO_AUTO_SIZE.NONE
                if content.get('adaptiveMediaReclaim'):
                    shape.text_frame.word_wrap=True
                for paragraph in shape.text_frame.paragraphs:
                    if isinstance(paragraph.line_spacing,(int,float)) and 0 < paragraph.line_spacing < .95:
                        paragraph.line_spacing=1.0
            # Keep all original per-run typography by default. A user's
            # object-level edit applies to every paragraph/run, including
            # native multi-paragraph list slots, and survives font resolution.
            uniform=(node.get('textLayout') or {}).get('uniformStyle') or {}
            for paragraph in shape.text_frame.paragraphs:
                if style.get('textAlign'):paragraph.alignment={'left':PP_ALIGN.LEFT,'center':PP_ALIGN.CENTER,'right':PP_ALIGN.RIGHT}[style['textAlign']]
                for run in paragraph.runs:
                    if uniform.get('fontFamily'):run.font.name=uniform['fontFamily']
                    if uniform.get('fontSizePt'):run.font.size=Pt(uniform['fontSizePt'])
                    if uniform.get('fontWeight') is not None:run.font.bold=bool(uniform['fontWeight'] >= 600)
                    if uniform.get('fontStyle'):run.font.italic=uniform['fontStyle']=='italic'
                    if style.get('color'):run.font.color.rgb=RGBColor.from_string(style['color'].lstrip('#').upper())
            apply_frame_fonts(shape.text_frame, role, family)
    # Explicit object layering uses the same zIndex as the editor, preserving
    # all native objects and relationships. Equal layers retain source order.
    layers={int(node['nativeShapeId']):node.get('zIndex',0) for node in update.get('nodes',[]) if node.get('nativeShapeId') is not None}
    ordered=sorted(list(slide.shapes),key=lambda shape:layers.get(int(shape.shape_id),0))
    for shape in ordered:
        slide.shapes._spTree.remove(shape._element)
        slide.shapes._spTree.insert_element_before(shape._element,'p:extLst')

# Imported files may already contain Chinese in a run that only declares a
# Latin font. Repair every editable text frame and table cell before publishing.
failures=[]
for slide_index, slide in enumerate(prs.slides):
    for shape in slide.shapes:
        for frame, role in shape_text_frames(slide, shape):
            role=role_overrides.get((slide_index, int(shape.shape_id)), role)
            apply_frame_fonts(frame, role)
            for paragraph in frame.paragraphs:
                for run in paragraph.runs:
                    if '\ufffd' in (run.text or ''): failures.append('slide '+str(slide_index + 1)+' contains Unicode replacement character')
                    if CJK_RE.search(run.text or ''):
                        rpr=run._r.get_or_add_rPr(); ea=rpr.find(qn('a:ea'))
                        if ea is None or not (ea.get('typeface') or '').strip(): failures.append('slide '+str(slide_index + 1)+' has CJK without a:ea')
if failures: raise ValueError('PPTX font integrity validation failed: '+'; '.join(failures[:12]))

for slide_index,slide in enumerate(prs.slides):
    update=by_slide.get(slide_index) or {}
    added_ids=[add_source_artifact(slide,node) for node in update.get('sourceArtifacts',[])]
    update['addedShapeIds']=[i for ids in added_ids for i in (ids if isinstance(ids,list) else [ids])]
for note in (data.get('exportManifest') or {}).get('notes',[]):
    prs.slides[note['index']].notes_slide.notes_text_frame.text=note['text']
target=os.environ.get('PPT_OUTPUT','/workspace/presentation.pptx'); tmp=target+'.part'; prs.save(tmp)
from hashlib import sha256
from pptx.enum.shapes import MSO_SHAPE_TYPE, MSO_SHAPE
before=Presentation(original); after=Presentation(tmp)
expected_map=source_slide_map if source_slide_map is not None else list(range(len(before.slides)))
if len(expected_map)!=len(after.slides): raise ValueError('template slide count changed during export')
for index,source_index in enumerate(expected_map):
    left=before.slides[source_index]; right=after.slides[index]
    omitted={int(shape_id) for shape_id in by_slide.get(index,{}).get('omitShapeIds',[])}
    source_ids={int(shape.shape_id) for shape in left.shapes}
    output_ids={int(shape.shape_id) for shape in right.shapes}
    added=set(by_slide.get(index,{}).get('addedShapeIds',[]))|set(by_slide.get(index,{}).get('cloneShapeIds',[]))
    if not omitted.issubset(source_ids) or output_ids!=source_ids-omitted|added: raise ValueError('undeclared template shape loss on slide '+str(index+1)+': '+json.dumps({'source':sorted(source_ids),'omitted':sorted(omitted),'added':list(added),'output':sorted(output_ids)}))
    requested={int(node['nativeShapeId']):node for node in by_slide.get(index,{}).get('nodes',[]) if node.get('nativeShapeId') is not None}
    source_pictures={int(shape.shape_id):sha256(shape.image.blob).hexdigest() for shape in left.shapes if shape.shape_type==MSO_SHAPE_TYPE.PICTURE}
    output_pictures={int(shape.shape_id):sha256(shape.image.blob).hexdigest() for shape in right.shapes if shape.shape_type==MSO_SHAPE_TYPE.PICTURE}
    cloned_pictures={int(node['nativeShapeId']):source_pictures[int(node['cloneFromShapeId'])] for node in requested.values() if node.get('cloneFromShapeId') is not None and node.get('type')=='image'}
    if output_pictures.keys()!=source_pictures.keys()-omitted|cloned_pictures.keys(): raise ValueError('undeclared template picture loss on slide '+str(index+1))
    for shape_id,expected_hash in cloned_pictures.items():
        if output_pictures.get(shape_id)!=expected_hash:raise ValueError('native component clone changed image bytes')
    for shape_id,source_hash in source_pictures.items():
        if shape_id in omitted: continue
        node=requested.get(shape_id) or {}; content=node.get('content') or {}
        expected=content.get('imageSha256') if content.get('mediaReplacement') else source_hash
        if expected!=output_pictures[shape_id]: raise ValueError('template picture bytes changed outside declared variant on slide '+str(index+1))
    for shape in right.shapes:
        node=requested.get(int(shape.shape_id))
        if not node or not shape.has_text_frame or node.get('type')!='text': continue
        content=node.get('content') or {}
        paragraphs=content.get('paragraphs')
        if paragraphs is None:
            expected_text=str(content.get('text') or '').strip()
            if expected_text!=(rich_visible_text(shape._element) if content.get('nativeMath') or content.get('richText') else shape.text).strip():
                raise ValueError('native template text mismatch on slide '+str(index+1)+' shape '+str(shape.shape_id))
            continue
        written=[paragraph for paragraph in shape.text_frame.paragraphs if rich_visible_text(paragraph._p).strip()]
        if len(written)!=len(paragraphs): raise ValueError('native template paragraph loss on slide '+str(index+1)+' shape '+str(shape.shape_id))
        source_shape=next((item for item in left.shapes if item.shape_id==shape.shape_id),None)
        source_written=[paragraph for paragraph in source_shape.text_frame.paragraphs if paragraph.text.strip()] if source_shape is not None and source_shape.has_text_frame else []
        for paragraph_index,(paragraph,item) in enumerate(zip(written,paragraphs)):
            if str(item.get('body') or '').strip() not in rich_visible_text(paragraph._p): raise ValueError('native template paragraph text mismatch')
            source_runs=source_written[paragraph_index].runs
            source_has_bold_label=bool(len(source_runs)>1 and source_runs[0].font.bold and any(run.text.strip() and not run.font.bold for run in source_runs[1:]))
            if not item.get('richText') and item.get('label') and source_has_bold_label and (requested.get(int(shape.shape_id),{}).get('textLayout') or {}).get('uniformStyle',{}).get('fontWeight') is None and not any(run.font.bold and str(item['label']).strip() in run.text for run in paragraph.runs):
                raise ValueError('native template label styling changed')
        for paragraph_index,(before_paragraph,after_paragraph) in enumerate(zip(source_written,written)):
            if paragraphs[paragraph_index].get('richText'):continue
            for before_run,after_run in zip(before_paragraph.runs,after_paragraph.runs):
                if before_run.font.size is not None and before_run.font.size!=after_run.font.size and not (requested.get(int(shape.shape_id),{}).get('textLayout') or {}).get('uniformStyle',{}).get('fontSizePt'):
                    raise ValueError('native template font size changed on slide '+str(index+1))
        if content.get('templateFit') and shape.text_frame.auto_size!=MSO_AUTO_SIZE.NONE:
            raise ValueError('native template unexpectedly shrinks font on slide '+str(index+1))
os.replace(tmp,target)
verification=verify_export(target,data.get('exportManifest'))
print(json.dumps({'slides':len(prs.slides),'path':target,'bytes':os.path.getsize(target),'preservedOriginal':True,'exportVerification':verification,'fontResolution':list(FONT_RESOLUTIONS.values())}))
`;

function runPython(project, script, input, max = Math.min(templateLimits().managedBytes * 2, templateLimits().memoryBytes / 4)) {
  return orch.ensureContainer(project.id, project.uid, orch.KIND_PPT).then(({ name }) => new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', '-u', String(orch.AGENT_UID), '-e', `PPT_TEMPLATE_LIMITS=${JSON.stringify(templateLimits())}`, '-e', `PPT_OUTPUT=${project.renderOutput || '/workspace/presentation.pptx'}`, name, 'python3', '-c', script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('template_timeout: PPTX operation timed out')); }, script === IMPORT_SCRIPT ? templateLimits().timeoutMs : 120000); timer.unref();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { out += chunk; if (out.length > max) child.kill(); });
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-3000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code) reject(new Error(`PPTX fidelity operation failed: ${err.slice(-500)}`)); else { try { resolve(JSON.parse(out)); } catch { reject(new Error('PPTX fidelity operation returned invalid JSON')); } } });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  }));
}

export function projectFromImportedManifest(project, manifest, hash) {
  const slides = manifest.slides.map(item => {
    const slideId = stableId('slide', hash, item.index);
    const title=titleFromNativeShapes(item.shapes,manifest.width,manifest.height);
    return {
      id: slideId, title:title?.text||`Slide ${item.index+1}`, titleExtraction:title, nativeSlideIndex: item.index, nativeBackground: item.background, layoutId: 'summary', layoutRef: 'summary', role: item.index === 0 ? 'cover' : 'content',
      nodes: item.shapes.map(shape => ({
        id: stableId('node', hash, item.index, shape.shapeId), type: shape.kind,
        semanticRole: shape.shapeId===title?.shapeId ? 'title' : shape.kind === 'text' ? 'native-text' : 'visual',
        slotId: 'absolute', styleRef: 'native', locked: shape.locked, zIndex: shape.zIndex, rotation:shape.rotation||0,
        style: { ...(shape.fill ? { fill: shape.fill } : {}), ...(shape.color ? { color: shape.color } : {}),
          ...(shape.fontFamily ? { fontFamily: shape.fontFamily } : {}), ...(shape.eastAsiaFontFamily ? { eastAsiaFontFamily: shape.eastAsiaFontFamily } : {}), ...(shape.fontSizePt ? { fontSizePt: shape.fontSizePt } : {}),
          ...(shape.bold !== undefined ? { fontWeight: shape.bold ? 700 : 400, fontStyle: shape.italic ? 'italic' : 'normal' } : {}) },
        geometry: { x: shape.x, y: shape.y, width: shape.width, height: shape.height },
        nativeRef: { contractVersion:2, slideIndex: item.index, shapeId: shape.shapeId, name: shape.name,
          shapeType: shape.shapeType, autoShapeType: shape.autoShapeType, xmlHash:shape.xmlHash, nestedMediaHashes:shape.nestedMediaHashes },
        content: shape.kind === 'text' ? { text: shape.text,...(shape.nativeMath?{nativeMath:true,nativeMathStructures:shape.nativeMathStructures,nativeOriginalText:shape.text,rawText:shape.nativeRawText}:{}) } : shape.kind === 'image' ? { dataUrl: shape.dataUrl, crop: shape.crop, imageSha256: shape.imageSha256, imageDhash: shape.imageDhash, monochromePanel:shape.monochromePanel, panelColor:shape.panelColor,foregroundColor:shape.foregroundColor, nativeMaskXml:shape.maskXml } : shape.kind === 'table' ? { rows: shape.rows,...(shape.nativeMathStructures?{nativeMath:true,nativeMathStructures:shape.nativeMathStructures}:{}),columnWeights:shape.columnWeights,rowWeights:shape.rowWeights } : shape.kind === 'chart' ? shape.chartContent : { label: shape.name, shape: 'rect' },
        ...(shape.textFrame ? { nativeTextFrame: {...shape.textFrame,originalHeight:shape.height} } : {}),
      })),
    };
  });
  project.deck = ensureDeckV3({ schemaVersion: 3, deckId: stableId('deck', hash), slides });
  for(const slide of project.deck.slides)for(const node of slide.nodes||[])if(node.nativeRef&&node.type==='text')node.nativeStyleBaseline=structuredClone(node.style||{});
  project.importedInputScope = project.deck.slides.map(slide => ({ id: slide.id, nodes: slide.nodes.filter(node => ['text', 'table', 'chart'].includes(node.type)).map(node => ({ type: node.type, content: node.content })) }));
  project.outline = project.deck.slides.map((slide, index) => ({ id: slide.id, title: slide.title || `Slide ${index + 1}`, focus: '', refs: [] }));
  project.pages = slides.length;
  project.externalPptx = { nativeContractVersion:2, mode: 'preserve', sha256: hash, originalPath: manifest.path, width: manifest.width, height: manifest.height, importedAt: new Date().toISOString() };
  return project;
}

export async function importEditablePptx(project, bytes, hash, io = {}) {
  const manifest = await (io.runPython || runPython)(project, IMPORT_SCRIPT, bytes);
  return projectFromImportedManifest(project, manifest, hash);
}

export async function renderImportedPptx(project, io = {}) {
  for(const slide of project.deck.slides){fitSourceMathFrames(slide,project);fitNativeTextFrames(project,slide);}
  const slides = project.deck.slides.filter(slide => Number.isInteger(slide.nativeSlideIndex)).map(slide => ({
    nativeSlideIndex: slide.nativeSlideIndex,
    omitShapeIds: [...(slide.templateOmissions || []).map(item => item.shapeId),...(slide.nodes||[]).filter(n=>n.hidden||Number(n.style?.opacity??1)<=0).map(n=>n.nativeRef?.shapeId).filter(id=>id!==undefined)],
    sourceArtifacts: (slide.nodes || []).filter(isSourceOwnedNode).map(node=>({...node,textLayout:textContract({...node,kind:node.type}),imageLayout:node.type==='image'?imageContract(node.content):undefined,chartLayout:node.type==='chart'?chartContract(node.content):undefined})),
    nodes: slide.nodes.filter(node => node.nativeRef).map(node => ({ type: node.type, semanticRole: node.semanticRole,
      nativeShapeId: node.nativeRef.shapeId,componentBinding:node.templateComponentBinding,
      ...(node.nativeRef.cloneFromShapeId!==undefined?{cloneFromShapeId:node.nativeRef.cloneFromShapeId}:{}),
      // The original PPTX already owns unchanged image bytes. Sending the same
      // base64 payload for every copy makes long-deck export unnecessarily huge.
      content: node.type === 'image' && !node.content?.mediaReplacement
        ? Object.fromEntries(Object.entries(node.content || {}).filter(([key]) => key !== 'dataUrl')) : node.content,
      geometry: node.geometry, style: node.style, rotation: node.rotation, zIndex: node.zIndex, chartLayout:node.type==='chart'?chartContract(node.content):undefined, textLayout: textContract({...node,kind:node.type}) })),
  }));
  return (io.runPython || runPython)(project, EXPORT_SCRIPT, JSON.stringify({ original: project.externalPptx.originalPath, title:project.title, slides,
    sourceSlideMap: project.templateSlideMap, fonts: project.templateSpec?.fonts,exportManifest:exportManifest(project) }));
}

export const _internals = { IMPORT_SCRIPT, EXPORT_SCRIPT };
