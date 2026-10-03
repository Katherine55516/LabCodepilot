import { templateLimits, TEMPLATE_SECURITY_SCRIPT } from '../ppt-template-security.mjs';
import { spawn } from 'node:child_process';
import * as orch from '../orchestrator.mjs';
import { ensureDeckV3, stableId } from './ir.mjs';

const IMPORT_SCRIPT = String.raw`
import base64, io, json, os, sys
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.enum.dml import MSO_COLOR_TYPE
from pptx.oxml.ns import qn
raw=sys.stdin.buffer.read(); ext='pptx'
${TEMPLATE_SECURITY_SCRIPT}
prs=Presentation(io.BytesIO(raw)); slides=[]
target=os.path.join(os.environ.get('PPT_EXTERNAL_DIR','/workspace/external'),'original.pptx'); os.makedirs(os.path.dirname(target), exist_ok=True)
with open(target+'.part','wb') as f: f.write(raw)
os.replace(target+'.part',target)
for slide_index, slide in enumerate(prs.slides):
    shapes=[]
    for z_index, shape in enumerate(slide.shapes):
        item={'shapeId': int(shape.shape_id), 'name': shape.name, 'x': int(shape.left), 'y': int(shape.top), 'width': int(shape.width), 'height': int(shape.height), 'kind':'foreign', 'locked':True, 'zIndex':z_index, 'shapeType':str(shape.shape_type)}
        if shape.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE:
            try: item['autoShapeType']=str(shape.auto_shape_type)
            except (AttributeError,TypeError,ValueError): pass
        try:
            if shape.fill.type and shape.fill.fore_color.type == MSO_COLOR_TYPE.RGB:
                item['fill']='#'+str(shape.fill.fore_color.rgb).lower()
        except (AttributeError,TypeError,ValueError): pass
        if shape.has_text_frame and shape.text.strip():
            item.update({'kind':'text','locked':False,'text':shape.text,'isTitle': bool(slide.shapes.title is shape)})
            frame=shape.text_frame
            item['textFrame']={'wordWrap':frame.word_wrap,'autoSize':str(frame.auto_size) if frame.auto_size is not None else None,
                'margins':[int(frame.margin_left),int(frame.margin_top),int(frame.margin_right),int(frame.margin_bottom)],
                'paragraphs':[{'text':paragraph.text,'level':paragraph.level,
                    'lineSpacing':(round(float(paragraph.line_spacing),3) if isinstance(paragraph.line_spacing,float)
                        else round(paragraph.line_spacing.pt / max(1, next((run.font.size.pt for run in paragraph.runs if run.font.size), 18)),3)
                        if paragraph.line_spacing is not None else None),
                    'spaceAfterPt':round(paragraph.space_after.pt,2) if paragraph.space_after is not None else None,
                    'bulletChar':(paragraph._p.pPr.find(qn('a:buChar')).get('char') if paragraph._p.pPr is not None and paragraph._p.pPr.find(qn('a:buChar')) is not None else None),
                    'runs':[{'text':run.text,'fontSizePt':round(run.font.size.pt,2) if run.font.size else None,
                        'fontFamily':run.font.name,'bold':run.font.bold} for run in paragraph.runs]}
                    for paragraph in frame.paragraphs]}
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:
                    if run.text.strip():
                        if run.font.name: item['fontFamily']=run.font.name
                        if run.font.size: item['fontSizePt']=round(run.font.size.pt,2)
                        if run.font.bold is not None: item['bold']=bool(run.font.bold)
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
            item.update({'kind':'table','rows':[[cell.text for cell in row.cells] for row in shape.table.rows], 'locked':True})
        elif shape.has_chart:
            item.update({'kind':'chart','locked':True})
        elif shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
            image=shape.image
            subtype={'jpg':'jpeg','jpeg':'jpeg','png':'png','gif':'gif','svg':'svg+xml','webp':'webp'}.get(image.ext.lower())
            image_dhash=None
            try:
                from PIL import Image
                sample=Image.open(io.BytesIO(image.blob)).convert('L').resize((9,8))
                pixels=list(sample.getdata())
                bits=0
                for row in range(8):
                    for column in range(8): bits=(bits<<1) | int(pixels[row*9+column]>pixels[row*9+column+1])
                image_dhash=format(bits,'016x')
            except Exception: pass
            item.update({'kind':'image','dataUrl':('data:image/'+subtype+';base64,'+base64.b64encode(image.blob).decode()) if subtype else None,
                         'locked':True,'crop':[shape.crop_left,shape.crop_top,shape.crop_right,shape.crop_bottom],
                         'imageSha256':__import__('hashlib').sha256(image.blob).hexdigest(),'imageDhash':image_dhash})
        shapes.append(item)
    background=None
    try:
        if slide.background.fill.type and slide.background.fill.fore_color.type == MSO_COLOR_TYPE.RGB:
            background='#'+str(slide.background.fill.fore_color.rgb).lower()
    except (AttributeError,TypeError,ValueError): pass
    slides.append({'index':slide_index,'shapes':shapes,'background':background})
print(json.dumps({'width':int(prs.slide_width),'height':int(prs.slide_height),'slides':slides,'path':target},ensure_ascii=False))
`;

const EXPORT_SCRIPT = String.raw`
import base64, copy, hashlib, io, json, os, re, sys
from pptx import Presentation
from pptx.oxml.xmlchemy import OxmlElement
from pptx.oxml.ns import qn
from pptx.util import Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_AUTO_SIZE
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE_TYPE

data=json.load(sys.stdin); original=data['original']; prs=Presentation(original)
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
    if not CJK_RE.search(run.text or ''): return
    if HANT_RE.search(run.text or ''):
        east_asia=fonts.get('titleEastAsiaHant' if role == 'title' else 'bodyEastAsiaHant') or family or (fonts['titleEastAsia'] if role == 'title' else fonts['bodyEastAsia'])
    else:
        east_asia=family or (fonts['titleEastAsia'] if role == 'title' else fonts['bodyEastAsia'])
    rpr=run._r.get_or_add_rPr()
    for child in list(rpr):
        if child.tag == qn('a:ea'): rpr.remove(child)
    ea=OxmlElement('a:ea'); ea.set('typeface', east_asia); rpr.append(ea); rpr.set('lang','zh-CN')

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
    font=style.get('fontFamily') or fonts['body']; pt=float(style.get('fontSizePt',18))
    if node['type']=='table':
        rows=c['rows']; shape=slide.shapes.add_table(len(rows),len(rows[0]),int(g['x']),int(g['y']),int(g['width']),int(g['height']))
        weights=c.get('columnWeights') or [1]*len(rows[0]); weight_sum=sum(weights)
        for col,weight in enumerate(weights): shape.table.columns[col].width=int(g['width']*weight/weight_sum)
        row_weights=c.get('rowWeights') or [1]*len(rows); row_sum=sum(row_weights)
        for r,weight in enumerate(row_weights): shape.table.rows[r].height=int(g['height']*weight/row_sum)
        for r,row in enumerate(rows):
            for col,value in enumerate(row):
                cell=shape.table.cell(r,col); cell.text=str(value); cell.margin_top=cell.margin_bottom=Pt(3); cell.fill.solid(); cell.fill.fore_color.rgb=RGBColor.from_string((style.get('fill','#e7e5f4') if r==0 else '#ffffff').lstrip('#'))
                for p in cell.text_frame.paragraphs:
                    for run in p.runs: run.font.name=fonts['bodyEastAsia'] if CJK_RE.search(run.text) else font; run.font.size=Pt(pt); run.font.bold=(r==0); run.font.color.rgb=RGBColor(36,42,59); set_east_asia(run)
    else:
        shape=slide.shapes.add_textbox(int(g['x']),int(g['y']),int(g['width']),int(g['height']))
        shape.fill.solid(); shape.fill.fore_color.rgb=RGBColor.from_string(style.get('fill','#ffffff').lstrip('#'))
        frame=shape.text_frame; frame.word_wrap=True
        values=[item['text'] for item in c.get('items',[])] if node['type'] in ('list','timeline') else str(c.get('text','')).split('\n')
        for i,value in enumerate(values):
            p=frame.paragraphs[0] if i==0 else frame.add_paragraph(); p.text=(str(i+1)+'. ' if node['type']=='timeline' else '• ' if node['type']=='list' else '')+str(value); p.space_after=Pt(4)
            for run in p.runs:
                run.font.name=fonts['bodyEastAsia'] if CJK_RE.search(run.text) else font; run.font.size=Pt(pt); run.font.color.rgb=RGBColor.from_string(str(style.get('color','#333333')).lstrip('#')); set_east_asia(run)
    source=node.get('sourceArtifact') or {}
    shape.name='AIMate source:'+str(source.get('sourceUnitId',''))+':'+str(source.get('type',''))
    return int(shape.shape_id)

by_slide={int(item['nativeSlideIndex']):item for item in data['slides'] if item.get('nativeSlideIndex') is not None}
role_overrides={}
for slide_index, slide in enumerate(prs.slides):
    update=by_slide.get(slide_index)
    if not update: continue
    by_shape={int(node['nativeShapeId']):node for node in update.get('nodes',[]) if node.get('nativeShapeId') is not None}
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
        content=node.get('content') or {}
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
            if any(not isinstance(value,(int,float)) or value<0 or value>.4 for value in crop) or crop[0]+crop[2]>=.8 or crop[1]+crop[3]>=.8:
                raise ValueError('invalid native picture crop on slide '+str(slide_index+1))
            shape.crop_left,shape.crop_top,shape.crop_right,shape.crop_bottom=map(float,crop)
        style=node.get('style') or {}
        if style.get('fill') and node.get('type') in ('shape','text'):
            shape.fill.solid(); shape.fill.fore_color.rgb=RGBColor.from_string(style['fill'].lstrip('#').upper())
        if shape.has_text_frame and node.get('type')=='text':
            content=node.get('content') or {}
            value=str(content.get('text') or '')
            role='title' if node.get('semanticRole') in ('title','template-title') else 'body'
            role_overrides[(slide_index, int(shape.shape_id))]=role
            family=(node.get('style') or {}).get('eastAsiaFontFamily')
            paragraph_items=content.get('paragraphs')
            if paragraph_items is not None:
                source_paragraphs=[paragraph for paragraph in shape.text_frame.paragraphs if paragraph.text.strip()]
                if not isinstance(paragraph_items,list) or len(paragraph_items)!=len(source_paragraphs):
                    raise ValueError('native template paragraph count mismatch on slide '+str(slide_index+1)+' shape '+str(shape.shape_id))
                for paragraph,item in zip(source_paragraphs,paragraph_items):
                    if not isinstance(item,dict) or not str(item.get('body') or '').strip():
                        raise ValueError('native template paragraph is empty on slide '+str(slide_index+1)+' shape '+str(shape.shape_id))
                    label=str(item.get('label') or '').strip(); body=str(item['body']).strip()
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
            if content.get('templateFit'):
                shape.text_frame.auto_size=MSO_AUTO_SIZE.NONE
                if content.get('adaptiveMediaReclaim'):
                    shape.text_frame.word_wrap=True
                for paragraph in shape.text_frame.paragraphs:
                    if isinstance(paragraph.line_spacing,(int,float)) and 0 < paragraph.line_spacing < .95:
                        paragraph.line_spacing=1.0
            for run in shape.text_frame.paragraphs[0].runs[:1]:
                if style.get('fontFamily'): run.font.name=style['fontFamily']
                if style.get('fontSizePt'): run.font.size=Pt(style['fontSizePt'])
                if style.get('fontWeight'): run.font.bold=bool(style['fontWeight'] >= 600)
                if style.get('color'): run.font.color.rgb=RGBColor.from_string(style['color'].lstrip('#').upper())
            apply_frame_fonts(shape.text_frame, role, family)

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
    update['addedShapeIds']=[add_source_artifact(slide,node) for node in update.get('sourceArtifacts',[])]
target=os.environ.get('PPT_OUTPUT','/workspace/presentation.pptx'); tmp=target+'.part'; prs.save(tmp)
from hashlib import sha256
from pptx.enum.shapes import MSO_SHAPE_TYPE
before=Presentation(original); after=Presentation(tmp)
expected_map=source_slide_map if source_slide_map is not None else list(range(len(before.slides)))
if len(expected_map)!=len(after.slides): raise ValueError('template slide count changed during export')
for index,source_index in enumerate(expected_map):
    left=before.slides[source_index]; right=after.slides[index]
    omitted={int(shape_id) for shape_id in by_slide.get(index,{}).get('omitShapeIds',[])}
    source_ids={int(shape.shape_id) for shape in left.shapes}
    output_ids={int(shape.shape_id) for shape in right.shapes}
    added=set(by_slide.get(index,{}).get('addedShapeIds',[]))
    if not omitted.issubset(source_ids) or output_ids!=source_ids-omitted|added: raise ValueError('undeclared template shape loss on slide '+str(index+1))
    requested={int(node['nativeShapeId']):node for node in by_slide.get(index,{}).get('nodes',[]) if node.get('nativeShapeId') is not None}
    source_pictures={int(shape.shape_id):sha256(shape.image.blob).hexdigest() for shape in left.shapes if shape.shape_type==MSO_SHAPE_TYPE.PICTURE}
    output_pictures={int(shape.shape_id):sha256(shape.image.blob).hexdigest() for shape in right.shapes if shape.shape_type==MSO_SHAPE_TYPE.PICTURE}
    if output_pictures.keys()!=source_pictures.keys()-omitted: raise ValueError('undeclared template picture loss on slide '+str(index+1))
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
            if expected_text!=shape.text.strip():
                raise ValueError('native template text mismatch on slide '+str(index+1)+' shape '+str(shape.shape_id))
            continue
        written=[paragraph for paragraph in shape.text_frame.paragraphs if paragraph.text.strip()]
        if len(written)!=len(paragraphs): raise ValueError('native template paragraph loss on slide '+str(index+1)+' shape '+str(shape.shape_id))
        source_shape=next((item for item in left.shapes if item.shape_id==shape.shape_id),None)
        source_written=[paragraph for paragraph in source_shape.text_frame.paragraphs if paragraph.text.strip()] if source_shape is not None and source_shape.has_text_frame else []
        for paragraph_index,(paragraph,item) in enumerate(zip(written,paragraphs)):
            if str(item.get('body') or '').strip() not in paragraph.text: raise ValueError('native template paragraph text mismatch')
            source_runs=source_written[paragraph_index].runs
            source_has_bold_label=bool(len(source_runs)>1 and source_runs[0].font.bold and any(run.text.strip() and not run.font.bold for run in source_runs[1:]))
            if item.get('label') and source_has_bold_label and not any(run.font.bold and str(item['label']).strip() in run.text for run in paragraph.runs):
                raise ValueError('native template label styling changed')
        for before_paragraph,after_paragraph in zip(source_written,written):
            for before_run,after_run in zip(before_paragraph.runs,after_paragraph.runs):
                if before_run.font.size is not None and before_run.font.size!=after_run.font.size:
                    raise ValueError('native template font size changed on slide '+str(index+1))
        if content.get('templateFit') and shape.text_frame.auto_size!=MSO_AUTO_SIZE.NONE:
            raise ValueError('native template unexpectedly shrinks font on slide '+str(index+1))
os.replace(tmp,target)
print(json.dumps({'slides':len(prs.slides),'path':target,'bytes':os.path.getsize(target),'preservedOriginal':True}))
`;

function runPython(project, script, input, max = Math.min(templateLimits().managedBytes * 2, templateLimits().memoryBytes / 4)) {
  return orch.ensureContainer(project.id, project.uid, orch.KIND_PPT).then(({ name }) => new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', '-u', String(orch.AGENT_UID), '-e', `PPT_TEMPLATE_LIMITS=${JSON.stringify(templateLimits())}`, '-e', `PPT_OUTPUT=${project.renderOutput || '/workspace/presentation.pptx'}`, name, 'python3', '-c', script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('template_timeout: PPTX operation timed out')); }, script === IMPORT_SCRIPT ? templateLimits().timeoutMs : 120000); timer.unref();
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
    return {
      id: slideId, nativeSlideIndex: item.index, nativeBackground: item.background, layoutId: 'summary', layoutRef: 'summary', role: item.index === 0 ? 'cover' : 'content',
      nodes: item.shapes.map(shape => ({
        id: stableId('node', hash, item.index, shape.shapeId), type: shape.kind,
        semanticRole: shape.isTitle ? 'title' : shape.kind === 'text' ? 'native-text' : 'visual',
        slotId: 'absolute', styleRef: 'native', locked: shape.locked, zIndex: shape.zIndex,
        style: { ...(shape.fill ? { fill: shape.fill } : {}), ...(shape.color ? { color: shape.color } : {}),
          ...(shape.fontFamily ? { fontFamily: shape.fontFamily } : {}), ...(shape.eastAsiaFontFamily ? { eastAsiaFontFamily: shape.eastAsiaFontFamily } : {}), ...(shape.fontSizePt ? { fontSizePt: shape.fontSizePt } : {}),
          ...(shape.bold !== undefined ? { fontWeight: shape.bold ? 700 : 400 } : {}) },
        geometry: { x: shape.x, y: shape.y, width: shape.width, height: shape.height },
        nativeRef: { slideIndex: item.index, shapeId: shape.shapeId, name: shape.name,
          shapeType: shape.shapeType, autoShapeType: shape.autoShapeType },
        content: shape.kind === 'text' ? { text: shape.text } : shape.kind === 'image' ? { dataUrl: shape.dataUrl, crop: shape.crop, imageSha256: shape.imageSha256, imageDhash: shape.imageDhash } : shape.kind === 'table' ? { rows: shape.rows } : { label: shape.name, shape: 'rect' },
        ...(shape.textFrame ? { nativeTextFrame: shape.textFrame } : {}),
      })),
    };
  });
  project.deck = ensureDeckV3({ schemaVersion: 3, deckId: stableId('deck', hash), slides });
  project.outline = project.deck.slides.map((slide, index) => ({ id: slide.id, title: slide.title || `Slide ${index + 1}`, focus: '', refs: [] }));
  project.pages = slides.length;
  project.externalPptx = { mode: 'preserve', sha256: hash, originalPath: manifest.path, width: manifest.width, height: manifest.height, importedAt: new Date().toISOString() };
  return project;
}

export async function importEditablePptx(project, bytes, hash) {
  const manifest = await runPython(project, IMPORT_SCRIPT, bytes);
  return projectFromImportedManifest(project, manifest, hash);
}

export async function renderImportedPptx(project) {
  const slides = project.deck.slides.filter(slide => Number.isInteger(slide.nativeSlideIndex)).map(slide => ({
    nativeSlideIndex: slide.nativeSlideIndex,
    omitShapeIds: (slide.templateOmissions || []).map(item => item.shapeId),
    sourceArtifacts: (slide.nodes || []).filter(node => node.sourceArtifact),
    nodes: slide.nodes.filter(node => node.nativeRef).map(node => ({ type: node.type, semanticRole: node.semanticRole,
      nativeShapeId: node.nativeRef.shapeId,
      // The original PPTX already owns unchanged image bytes. Sending the same
      // base64 payload for every copy makes long-deck export unnecessarily huge.
      content: node.type === 'image' && !node.content?.mediaReplacement
        ? Object.fromEntries(Object.entries(node.content || {}).filter(([key]) => key !== 'dataUrl')) : node.content,
      geometry: node.geometry, style: node.style })),
  }));
  return runPython(project, EXPORT_SCRIPT, JSON.stringify({ original: project.externalPptx.originalPath, slides,
    sourceSlideMap: project.templateSlideMap, fonts: project.templateSpec?.fonts }));
}

export const _internals = { IMPORT_SCRIPT, EXPORT_SCRIPT };
