import { NATIVE_CHART_CONTRACT_SCRIPT } from './render-contract-python.mjs';
import { OFFICE_FONT_ENV_SCRIPT } from '../ppt-fonts.mjs';
export const EXPORT_VERIFY_SCRIPT=String.raw`
import hashlib as verify_hash, re as verify_re, unicodedata as verify_unicode, io
${OFFICE_FONT_ENV_SCRIPT}
${NATIVE_CHART_CONTRACT_SCRIPT}
def verify_key(value):return verify_re.sub(r'\s+','',verify_unicode.normalize('NFKC',str(value))).strip()
# U+2061..U+2064 are invisible mathematical operators. Keep them in XML
# integrity checks, but do not require ink in a rendered PDF.
def verify_ink_key(value):return verify_re.sub(r'[\u2061-\u2064]','',verify_key(value))
def verify_payload_text(content):
    if content.get('paragraphs') is not None:return [v for p in content['paragraphs'] for v in (p.get('label',''),p.get('body','')) if v]
    if content.get('items') is not None:
        result=[]
        for item in content['items']:
            value=item.get('text') or item.get('body') or ''
            heading=item.get('heading') or ''
            if value:result.append(value)
            # Canonical rich list items retain heading/body as aliases of the
            # complete text. Count that exact heading once, while a distinct
            # heading still requires its own visible ink.
            if heading and not verify_key(value).startswith(verify_key(heading)):result.append(heading)
        return result
    return [content.get('text','')]
def verify_math_tree(element):
    local=element.tag.split('}')[-1]
    if local in ('rPr','ctrlPr'):return None
    return (local,tuple(sorted(element.attrib.items())),element.text or '',tuple(value for child in element if (value:=verify_math_tree(child)) is not None))
def verify_rich_payload(element,rich,size,default_bold=False):
    if rich.get('diagnostics'):return False
    if rich_visible_text(element)!=rich.get('plainText',''):return False
    ns={'m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
    expected_math=[verify_math_tree(office_math(run['mathMl'])) for run in rich.get('runs',[]) if run.get('kind')=='math']
    actual_math=[verify_math_tree(node) for node in element.findall('.//m:oMath',ns)]
    if actual_math!=expected_math:return False
    def formatted(node):
        name=node.tag.rsplit('}',1)[-1]
        if name=='AlternateContent':
            fallback=node.find('{'+RICH_MC+'}Fallback')
            return formatted(fallback) if fallback is not None else []
        if name=='r':
            pr=node.find('{http://schemas.openxmlformats.org/drawingml/2006/main}rPr')
            if pr is None:return []
            return [(rich_visible_text(node),int(pr.get('baseline','0')),round(float(pr.get('sz',str(size*100)))/100,2),pr.get('b','0')=='1',pr.get('i','0')=='1')]
        return [value for child in node for value in formatted(child)]
    def merge(rows):
        result=[]
        for row in rows:
            row=(row[0].replace('\n',''),*row[1:])
            if not row[0]:continue
            if result and result[-1][1:]==row[1:]:result[-1]=(result[-1][0]+row[0],*row[1:])
            else:result.append(row)
        return result
    expected=[]
    for run in rich.get('runs',[]):
        segments=run.get('fallbackRuns',[]) if run.get('kind')=='math' else [run]
        for spec in segments:expected.append((spec.get('text',''),int(spec.get('baseline',0)),round(float(run.get('fontSizePt',size))*float(spec.get('scale',1)),2),bool(spec.get('bold') or run.get('bold',default_bold)),bool(spec.get('italic') or run.get('italic',False))))
    return merge(formatted(element))==merge(expected)
def verify_export(path,manifest):
    from pptx import Presentation as VerifyPresentation
    import os, math
    if not manifest:return {'status':'not_evaluated','basis':'no_manifest'}
    if manifest.get('version')!=2 or not manifest.get('manifestHash'):raise ValueError('PPTX export requires current instance manifest v2')
    verified=VerifyPresentation(path);expected=manifest['slides'];errors=[];count=0;images_count=0;copy_count=0;visible_copy=[];source_ids=set();chart_visuals=[];sign_checks=0
    if len(expected)!=len(verified.slides):errors.append('exported slide count differs from IR')
    for note in manifest.get('notes',[]):
        if note['index']>=len(verified.slides) or verified.slides[note['index']].notes_slide.notes_text_frame.text!=note['text']:errors.append('source speaker notes changed')
    def flatten(shapes):
        for shape in shapes:
            yield shape
            if hasattr(shape,'shapes'):yield from flatten(shape.shapes)
    def frame(shape,g,label):
        if not g:return
        actual=[int(shape.left),int(shape.top),int(shape.width),int(shape.height)]
        wanted=[int(g[k]) for k in ('x','y','width','height')]
        if any(abs(a-b)>2540 for a,b in zip(actual,wanted)):errors.append('frame changed '+label)
    for index,entry in enumerate(expected):
        if index>=len(verified.slides):break
        size=entry.get('size') or {};width=int(verified.slide_width);height=int(verified.slide_height)
        if size and (abs(width-size['width'])>2540 or abs(height-size['height'])>2540):errors.append('slide size changed')
        slide=verified.slides[index];shapes=list(flatten(slide.shapes));consumed=set();page_expected=[]
        for node in entry.get('nodes',[]):
            label=node['id'];content=node.get('content') or {};native=node.get('nativeRef');kind=node['type']
            if native:matches=[s for s in shapes if s.shape_id==native['shapeId']]
            else:
                marker='AIMate instance:'+label+':'
                matches=[s for s in shapes if marker in s.name and verify_re.search(verify_re.escape(marker)+r'\d+$',s.name)]
                matches.sort(key=lambda s:int(s.name.rsplit(':',1)[1]))
            if not matches:errors.append('missing instance '+label);continue
            if any(s.shape_id in consumed for s in matches):errors.append('reused output instance '+label);continue
            consumed.update(s.shape_id for s in matches)
            parts=node.get('parts') or []
            expected_count=len(parts) if parts else 2 if kind=='chart' and not native else 1
            if len(matches)!=expected_count:errors.append('instance multiplicity changed '+label);continue
            shape=matches[-1] if kind=='chart' and not native else matches[0]
            if content.get('nativeMathStructures'):
                wanted_math=[verify_math_tree(math_ET.fromstring(v)) for v in content['nativeMathStructures']]
                actual_math=[verify_math_tree(v) for v in shape._element.findall('.//'+qn('m:oMath'))]
                if wanted_math!=actual_math:errors.append('native mathematical structure changed '+label)
            if native and native.get('shapeType') and str(shape.shape_type)!=native['shapeType']:errors.append('native shape kind changed '+label)
            if native and native.get('autoShapeType'):
                if not hasattr(shape,'auto_shape_type') or str(shape.auto_shape_type)!=native['autoShapeType']:errors.append('native auto-shape/mask changed '+label)
            if native and native.get('xmlHash'):
                if verify_hash.sha256(shape._element.xml.encode()).hexdigest()!=native['xmlHash']:errors.append('opaque native structure changed '+label)
                def nested_media(shapes):
                    result=[]
                    for child in shapes:
                        if hasattr(child,'image'):result.append(verify_hash.sha256(child.image.blob).hexdigest())
                        if hasattr(child,'shapes'):result.extend(nested_media(child.shapes))
                    return result
                if nested_media(shape.shapes if hasattr(shape,'shapes') else [])!=native.get('nestedMediaHashes',[]):errors.append('group media changed '+label)
            g=dict(node.get('geometry') or {})
            if parts:
                for part,obj in zip(parts,matches):
                    frame(obj,part.get('geometry'),part['id'])
                    if not obj.has_text_frame or verify_key(part['text'])!=verify_key(rich_visible_text(obj._element) if part.get('richText') else obj.text):errors.append('list point changed '+part['id'])
                    if part.get('richText') and not verify_rich_payload(obj._element,part['richText'],part['fontSizePt']):errors.append('rich list point changed '+part['id'])
                    page_expected.append({'text':part['text'],'geometry':part['geometry'],'id':part['id']});copy_count+=1
            else:
                if kind=='chart' and not native:
                    frame(matches[0],g,label+':container');g={**g,'x':g['x']+128016,'y':g['y']+128016,'width':g['width']-256032,'height':g['height']-256032}
                if kind=='image' and not native and hasattr(shape,'image'):
                    iw,ih=shape.image.size;contract=node.get('imageLayout') or {};fit=contract.get('fit','contain')
                    if fit=='contain':
                        ratio=min(g['width']/iw,g['height']/ih);dw,dh=int(iw*ratio),int(ih*ratio)
                        g={**g,'x':int(g['x']+(g['width']-dw)/2),'y':int(g['y']+(g['height']-dh)/2),'width':dw,'height':dh}
                frame(shape,g,label)
            if abs(float(shape.rotation)-float(node.get('rotation',0)))>.05:errors.append('rotation changed '+label)
            if g and kind not in ('foreign','shape') and (g['x']<0 or g['y']<0 or g['x']+g['width']>width+2540 or g['y']+g['height']>height+2540):errors.append('required instance is outside page '+label)
            if kind=='image':
                sha=content.get('imageSha256')
                if not hasattr(shape,'image') or not sha or verify_hash.sha256(shape.image.blob).hexdigest()!=sha:errors.append('image asset changed '+label)
                else:
                    crop=list((node.get('imageLayout') or {}).get('crop',content.get('crop') or [0,0,0,0]));fit=(node.get('imageLayout') or {}).get('fit')
                    if not native and fit=='cover':
                        iw,ih=shape.image.size;original=node['geometry'];aspect=original['width']/original['height']
                        if iw/ih>aspect:amount=(1-aspect/(iw/ih))/2;crop=[amount,0,amount,0]
                        else:amount=(1-(iw/ih)/aspect)/2;crop=[0,amount,0,amount]
                    actual=[shape.crop_left,shape.crop_top,shape.crop_right,shape.crop_bottom]
                    if any(abs(a-b)>.00002 for a,b in zip(actual,crop)):errors.append('image crop changed '+label)
                if content.get('nativeMaskXml'):
                    geometry=shape._element.find('.//'+qn('a:prstGeom'))
                    if geometry is None:geometry=shape._element.find('.//'+qn('a:custGeom'))
                    if geometry is None or geometry.xml!=content['nativeMaskXml']:errors.append('native image mask changed '+label)
                images_count+=1
            elif kind=='table':
                wanted=content.get('rows',[]);actual=[[rich_visible_text(cell._tc) if content.get('cellRich') or content.get('nativeMath') else cell.text for cell in row.cells] for row in shape.table.rows] if shape.has_table else []
                if len(actual)!=len(wanted) or any(len(row)!=len(wanted[r]) or any(verify_key(cell)!=verify_key(wanted[r][c]) for c,cell in enumerate(row)) for r,row in enumerate(actual)):errors.append('table payload changed '+label)
                if shape.has_table:
                    if content.get('cellRich'):
                        for r,row in enumerate(shape.table.rows):
                            for c,cell in enumerate(row.cells):
                                if not verify_rich_payload(cell._tc,content['cellRich'][r][c],(node.get('style') or {}).get('fontSizePt',18),r==0):errors.append('rich table cell structure/style changed '+label+':'+str(r)+':'+str(c))
                    for axis,length,grid in [('columnWeights',g.get('width',0),shape.table.columns),('rowWeights',g.get('height',0),shape.table.rows)]:
                        weights=content.get(axis) or [1]*len(grid)
                        if len(weights)!=len(grid) or any(abs((cell.width if axis=='columnWeights' else cell.height)-int(length*weight/sum(weights)))>2540 for cell,weight in zip(grid,weights)):errors.append('table grid dimensions changed '+label)
                page_expected.append({'text':''.join(str(cell) for row in wanted for cell in row),'geometry':g,'rotation':node.get('rotation',0),'id':label})
            elif content.get('mathMl'):
                ns={'m':'http://schemas.openxmlformats.org/officeDocument/2006/math'};wanted=verify_math_tree(office_math(content['mathMl']))
                if not any(verify_math_tree(el)==wanted for el in shape._element.findall('.//m:oMath',ns)):errors.append('math structure changed '+label)
            elif kind=='chart':
                if content.get('chartType')=='unsupported':errors.append('native chart type requires supported normalization before new publication '+label)
                if not shape.has_chart:errors.append('chart instance changed '+label)
                elif content.get('nativeChartStructureSha256') and native_chart_structure_hash(shape.chart)!=content['nativeChartStructureSha256']:errors.append('native chart structure/data changed '+label)
                elif content.get('values') is not None:
                    if [str(c.label) for c in shape.chart.plots[0].categories]!=[str(v) for v in content.get('labels',[])]:errors.append('chart labels changed '+label)
                    series=content.get('series') or [{'values':content['values']}]
                    if len(shape.chart.series)!=len(series) or any(list(s.values)!=spec['values'] for s,spec in zip(shape.chart.series,series)):errors.append('chart series changed '+label)
                    axis=node.get('chartLayout') or {}
                    if axis and content.get('chartType') in ('bar','line',None):
                        if abs(shape.chart.value_axis.minimum_scale-axis['minimum'])>.000001 or abs(shape.chart.value_axis.maximum_scale-axis['maximum'])>.000001 or shape.chart.value_axis.crosses_at!=0:errors.append('chart axis changed '+label)
                    if content.get('unit') and (not shape.chart.has_title or shape.chart.chart_title.text_frame.text!=content['unit']):errors.append('chart unit changed '+label)
                    if content.get('chartType')=='bar':
                        if any(series.invert_if_negative is not False for series in shape.chart.series):errors.append('negative chart rendering flag changed '+label)
                        values=content['values']
                        if len(series)==1 and any(v<0 for v in values) and any(v>0 for v in values) and (not native or content.get('nativeChartType','').startswith('COLUMN_CLUSTERED')):chart_visuals.append({'slide':index,'id':label,'geometry':g,'values':values})

            elif not parts and kind!='foreign':
                wanted=verify_payload_text(content);actual=rich_visible_text(shape._element) if content.get('richText') or content.get('nativeMath') or content.get('paragraphs') or any(i.get('richText') for i in content.get('items',[])) else shape.text if shape.has_text_frame else ''
                for index_item,item in enumerate(content.get('items',[])):
                    if item.get('richText'):
                        rich=dict(item['richText']);specs=(node.get('textLayout') or {}).get('paragraphs',[]);prefix=specs[index_item]['text'][:-len(item['text'])] if item.get('text') and index_item<len(specs) else ''
                        rich['plainText']=prefix+rich['plainText'];rich['runs']=[{'kind':'text','text':prefix}]+rich['runs']
                        if index_item>=len(shape.text_frame.paragraphs) or not verify_rich_payload(shape.text_frame.paragraphs[index_item]._p,rich,(node.get('style') or {}).get('fontSizePt',18)):errors.append('rich list item changed '+label)
                for paragraph_index,item in enumerate(content.get('paragraphs',[])):
                    spec=(node.get('textLayout') or {}).get('paragraphs',[])
                    pt=spec[paragraph_index]['runs'][0]['fontSizePt'] if paragraph_index<len(spec) and spec[paragraph_index].get('runs') else (node.get('style') or {}).get('fontSizePt',18)
                    if item.get('richText'):
                        rich=dict(item['richText'])
                        if paragraph_index<len(spec):rich['runs']=spec[paragraph_index].get('runs',rich['runs'])
                        if paragraph_index>=len(shape.text_frame.paragraphs) or not verify_rich_payload(shape.text_frame.paragraphs[paragraph_index]._p,rich,pt):errors.append('rich native paragraph changed '+label)
                if content.get('richText') and not verify_rich_payload(shape._element,content['richText'],(node.get('style') or {}).get('fontSizePt',18),(node.get('style') or {}).get('fontWeight',400)>=600):errors.append('rich text structure/style changed '+label)
                # Source-owned text follows the template colour contract; a run
                # repainted to another colour (e.g. forced black) is a change.
                wanted_color=str((node.get('style') or {}).get('color') or '').lower().lstrip('#')
                if wanted_color and (node.get('sourceArtifact') or node.get('semanticRole')=='source-explanation') and shape.has_text_frame and not content.get('codeBlock'):
                    painted={fill.get('val','').lower() for fill in shape._element.iter(qn('a:srgbClr')) if fill.getparent() is not None and fill.getparent().tag==qn('a:solidFill') and fill.getparent().getparent() is not None and fill.getparent().getparent().tag==qn('a:rPr')}
                    if painted and painted!={wanted_color}:errors.append('source text colour changed '+label)
                if content.get('codeBlock'):
                    if actual.replace('\v','\n')!=content.get('text',''):errors.append('code whitespace changed '+label)
                elif node.get('textLayout') and verify_key(''.join(p['text'] for p in node['textLayout'].get('paragraphs',[])))!=verify_key(actual):errors.append('text paragraph/order changed '+label)
                elif any(verify_key(v) not in verify_key(actual) for v in wanted if v):errors.append('text payload changed '+label)
                page_expected.append({'text':''.join(str(v) for v in wanted if str(v).strip()),'geometry':g,'rotation':node.get('rotation',0),'id':label});copy_count+=len(wanted)
                contract=node.get('textLayout') or {}
                if contract and shape.has_text_frame:
                    f=shape.text_frame
                    if f.word_wrap!=contract.get('wrap',True) or str(f.auto_size).startswith('SHAPE_TO_FIT_TEXT'):errors.append('wrap/autofit changed '+label)
                    actual_m=[f.margin_left/12700,f.margin_top/12700,f.margin_right/12700,f.margin_bottom/12700]
                    if any(abs(a-b)>.05 for a,b in zip(actual_m,contract.get('margins',[]))):errors.append('text margins changed '+label)
                    specs=contract.get('paragraphs',[])
                    if kind=='text' and not content.get('mathMl'):
                        if len(f.paragraphs)!=len(specs):errors.append('paragraph count changed '+label)
                        for paragraph,spec in zip(f.paragraphs,specs):
                            if contract.get('hangingPunctuation') is False and (paragraph._p.pPr is None or paragraph._p.pPr.get('hangingPunct')!='0'):errors.append('hanging punctuation contract changed '+label)
                            if spec.get('marginLeftPt') is not None and (paragraph._p.pPr is None or abs(int(paragraph._p.pPr.get('marL') or 0)-round(float(spec['marginLeftPt'])*12700))>127 or abs(int(paragraph._p.pPr.get('indent') or 0)-round(float(spec['indentPt'])*12700))>127):errors.append('code hanging indent changed '+label)
                            spacing=paragraph.line_spacing
                            if spacing is not None and (not isinstance(spacing,float) or abs(spacing-spec.get('lineHeight',1.18))>.01):errors.append('paragraph spacing changed '+label)
                            after=paragraph.space_after
                            if after is not None and abs(after.pt-spec.get('spaceAfterPt',0))>.05:errors.append('paragraph after-spacing changed '+label)
                            runs=spec.get('runs') or []
                            if runs and len(paragraph.runs)==len(runs):
                                pairs=zip(paragraph.runs,runs)
                            elif not runs:pairs=((run,{'fontSizePt':(node.get('style') or {}).get('fontSizePt')}) for run in paragraph.runs)
                            else:pairs=[]
                            for run,wanted_run in pairs:
                                actual_font=run.font.size or paragraph.font.size;expected_font=wanted_run.get('fontSizePt')
                                if expected_font and actual_font and abs(actual_font.pt-expected_font)>.05:errors.append('font size changed '+label)

            if node.get('sourceArtifact'):source_ids.add(node['sourceArtifact']['sourceUnitId'])
        visible_copy.append(page_expected)
    if errors:raise ValueError('PPTX export integrity: '+'; '.join(errors[:12]))
    with open(path,'rb') as f:sha=verify_hash.sha256(f.read()).hexdigest()
    # Convert the actual candidate, never a second reconstruction from IR.
    import tempfile,subprocess,shutil,pdfplumber
    with tempfile.TemporaryDirectory(prefix='ppt-visible-') as temporary:
        profile=os.path.join(temporary,'profile');environment=office_font_environment(profile)
        converted=subprocess.run(['soffice','-env:UserInstallation=file://'+profile,'--headless','--convert-to','pdf:impress_pdf_Export','--outdir',temporary,path],capture_output=True,text=True,timeout=120,env=environment)
        pdf=os.path.join(temporary,os.path.splitext(os.path.basename(path))[0]+'.pdf')
        if converted.returncode or not os.path.isfile(pdf):raise ValueError('exported visibility conversion failed: '+(converted.stderr or converted.stdout)[-300:])
        render_errors=[];soft_occlusions=[];occlusion_checks=0;visibility_failures=[]
        def layer_boxes(index):
            # Top-level shapes in z-order (group children use group coordinates and are skipped).
            if index>=len(verified.slides):return []
            boxes=[]
            for z,shape in enumerate(verified.slides[index].shapes):
                try:
                    if shape.left is None or shape.top is None:continue
                    box=(shape.left/12700,shape.top/12700,(shape.left+shape.width)/12700,(shape.top+shape.height)/12700)
                    xml=shape._element.xml;head=xml.split('<p:txBody')[0]
                    text=bool(getattr(shape,'has_text_frame',False) and shape.text_frame.text.strip())
                    picture=shape.shape_type==13
                    opaque=(picture or '<a:solidFill>' in head or '<a:blipFill' in head) and '<a:alpha ' not in xml and 'alphaModFix' not in xml
                    layer={'z':z,'box':box,'text':text,'opaque':opaque and not text,'id':shape.shape_id}
                    if picture:
                        try:
                            from PIL import Image
                            mask=Image.open(io.BytesIO(shape.image.blob)).convert('RGBA').getchannel('A')
                            # Account for source crop; transparent pixels do not
                            # occlude native glyphs in overlapping picture frames.
                            w,h=mask.size;mask=mask.crop((int(shape.crop_left*w),int(shape.crop_top*h),int((1-shape.crop_right)*w),int((1-shape.crop_bottom)*h)))
                            layer['alphaMask']=mask
                        except Exception:pass
                    boxes.append(layer)
                except Exception:continue
            return boxes
        def area(b):return max(0,b[2]-b[0])*max(0,b[3]-b[1])
        def intersect(a,b):return (max(a[0],b[0]),max(a[1],b[1]),min(a[2],b[2]),min(a[3],b[3]))
        with pdfplumber.open(pdf) as document:
            if len(document.pages)!=len(expected):render_errors.append('rendered page count differs')
            for i,page in enumerate(document.pages):
                layers=layer_boxes(i)
                if any(c['text'].strip() and (c['x0']<-.5 or c['x1']>page.width+.5 or c['top']<-.5 or c['bottom']>page.height+.5) for c in page.chars):render_errors.append('page '+str(i+1)+' has out-of-page glyphs')
                actual=verify_key(''.join(c['text'] for c in page.chars))
                if '\ufffd' in actual:render_errors.append('page '+str(i+1)+' has replacement glyphs')
                from collections import Counter
                for instance in visible_copy[i] if i<len(visible_copy) else []:
                    value=instance['text'];g=instance['geometry'];left,top,right,bottom=g['x']/12700,g['y']/12700,(g['x']+g['width'])/12700,(g['y']+g['height'])/12700
                    angle=math.radians(instance.get('rotation',0));cx=(left+right)/2;cy=(top+bottom)/2
                    if angle:
                        corners=[(cx+(x-cx)*math.cos(angle)-(y-cy)*math.sin(angle),cy+(x-cx)*math.sin(angle)+(y-cy)*math.cos(angle)) for x,y in [(left,top),(right,top),(right,bottom),(left,bottom)]]
                        left=min(x for x,y in corners);right=max(x for x,y in corners);top=min(y for x,y in corners);bottom=max(y for x,y in corners)
                    inside=''.join(c['text'] for c in page.chars if c['x0']>=left-1 and c['x1']<=right+1 and c['top']>=top-1 and c['bottom']<=bottom+1)
                    wanted=Counter(verify_ink_key(value));available=Counter(verify_ink_key(inside))
                    if any(available[ch]<amount for ch,amount in wanted.items()):
                        render_errors.append('page '+str(i+1)+' loses or overflows rendered instance '+instance['id'])
                        near=[c for c in page.chars if c['x0']>=left-2 and c['top']>=top-20 and c['bottom']<=bottom+45 and c['x0']<=min(page.width,right+100)]
                        visibility_failures.append({'page':i+1,'instance':instance['id'],'expectedBounds':[left,top,right,bottom],'missingGlyphCounts':{ch:amount-available[ch] for ch,amount in wanted.items() if amount>available[ch]},'nearbyGlyphs':[{'text':c['text'],'box':[c['x0'],c['top'],c['x1'],c['bottom']]} for c in near[:200]]})
                        break
                    # Glyphs that exist in the PDF can still be hidden by a later
                    # opaque picture/filled shape (PowerPoint z-order).
                    glyphs=[c for c in page.chars if c['text'].strip() and c['x0']>=left-1 and c['x1']<=right+1 and c['top']>=top-1 and c['bottom']<=bottom+1]
                    own=[l for l in layers if l['text'] and all(abs(a-b)<=2.5 for a,b in zip(l['box'],(g['x']/12700,g['y']/12700,(g['x']+g['width'])/12700,(g['y']+g['height'])/12700)))]
                    if glyphs and own and not instance.get('rotation'):
                        occlusion_checks+=1;ink=(min(c['x0'] for c in glyphs),min(c['top'] for c in glyphs),max(c['x1'] for c in glyphs),max(c['bottom'] for c in glyphs))
                        for layer in [l for l in layers if l['opaque'] and l['z']>own[0]['z']]:
                            overlap=intersect(ink,layer['box']);share=area(overlap)/max(1e-6,area(ink))
                            if share and layer.get('alphaMask') is not None:
                                from PIL import ImageStat
                                mask=layer['alphaMask'];w,h=mask.size;b=layer['box'];bw,bh=b[2]-b[0],b[3]-b[1]
                                crop=mask.crop((max(0,int((overlap[0]-b[0])*w/bw)),max(0,int((overlap[1]-b[1])*h/bh)),min(w,math.ceil((overlap[2]-b[0])*w/bw)),min(h,math.ceil((overlap[3]-b[1])*h/bh))))
                                share*=ImageStat.Stat(crop).mean[0]/255 if crop.width and crop.height else 0
                            if share>=.5:render_errors.append('page '+str(i+1)+' text instance '+instance['id']+' is covered by later object '+str(layer['id']));break
                            if share>=.15:soft_occlusions.append({'page':i+1,'instance':instance['id'],'coveredBy':layer['id'],'share':round(share,2)})
            for check in chart_visuals:
                page=document.pages[check['slide']];g=check['geometry'];left,top,right,bottom=g['x']/12700,g['y']/12700,(g['x']+g['width'])/12700,(g['y']+g['height'])/12700
                values=[v for v in check['values'] if v!=0]
                bars=[r for r in page.rects if r.get('fill') and r['x0']>=left-1 and r['x1']<=right+1 and r['top']>=top-1 and r['bottom']<=bottom+1 and (right-left)/(len(values)*8)<r['width']<(right-left)*.7 and r['height']>1 and r.get('non_stroking_color') not in ((1,1,1),(1.0,1.0,1.0))]
                bars.sort(key=lambda r:r['x0'])
                if len(bars)!=len(values):render_errors.append('signed chart geometry not evaluated '+check['id']);continue
                zero=sum(r['bottom'] for r,v in zip(bars,values) if v>0)/sum(v>0 for v in values)
                if any(abs((r['top'] if v<0 else r['bottom'])-zero)>1 or v<0 and r['bottom']<=zero or v>0 and r['top']>=zero for r,v in zip(bars,values)):render_errors.append('wrong rendered chart sign '+check['id'])
                else:sign_checks+=1
            # Page images of the actual export: evidence for visual review,
            # bound to this manifest; not a visual pass by themselves.
            import io as verify_io
            pages_dir=path+'.verified-pages';dpi=int(os.environ.get('PPT_VISUAL_DPI','48'));page_evidence=[]
            if not render_errors:
                os.makedirs(pages_dir,exist_ok=True)
                for i,page in enumerate(document.pages):
                    buffer=verify_io.BytesIO();page.to_image(resolution=dpi).original.save(buffer,'PNG');data=buffer.getvalue()
                    target=os.path.join(pages_dir,'page-%03d.png'%(i+1))
                    with open(target,'wb') as f:f.write(data)
                    page_evidence.append({'page':i+1,'sha256':verify_hash.sha256(data).hexdigest(),'path':target})
        if render_errors:
            # Failure evidence is explicitly separate from verified artifacts;
            # retaining it helps repair real clipping without weakening gates.
            shutil.copyfile(pdf,path+'.failed-visibility.pdf')
            with open(path+'.failed-visibility.json','w',encoding='utf-8') as f:json.dump({'status':'failed','manifestHash':manifest.get('manifestHash'),'errors':render_errors,'instances':visibility_failures},f,ensure_ascii=False,indent=2)
            raise ValueError('PPTX rendered visibility: '+'; '.join(render_errors[:8]))
        with open(pdf,'rb') as f:pdf_hash=verify_hash.sha256(f.read()).hexdigest()
        pdf_artifact=path+'.verified.pdf';shutil.copyfile(pdf,pdf_artifact+'.part');os.replace(pdf_artifact+'.part',pdf_artifact)
        engine=subprocess.run(['soffice','--version'],capture_output=True,text=True,env=environment).stdout.strip()
    return {'status':'passed','basis':'reopened_pptx','version':2,'manifestHash':manifest['manifestHash'],'renderHash':manifest['renderHash'],'revision':manifest['revision'],'sha256':sha,'slides':len(verified.slides),'sourceObjectsChecked':len(source_ids),'imagesChecked':images_count,'copyEntriesChecked':copy_count,'renderedVisibility':{'status':'passed','basis':'actual_pptx_pdf_glyphs','engine':engine,'mixedSignColumnChartsChecked':sign_checks,'pdfSha256':pdf_hash,'pdfPath':pdf_artifact,'scope':'page/instance bounds and glyph retention; complex occlusion/ink not certified'},
      'visualEvidence':{'status':'rendered','engine':engine,'dpi':dpi,'pages':page_evidence,'occlusionChecks':occlusion_checks,'softOcclusions':soft_occlusions[:40],
        'scope':'top-level z-order occlusion of text by opaque pictures/filled shapes; page images await visual review'}}
`;
