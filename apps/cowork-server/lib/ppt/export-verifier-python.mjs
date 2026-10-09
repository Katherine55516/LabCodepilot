import { NATIVE_CHART_CONTRACT_SCRIPT } from './render-contract-python.mjs';
import { OFFICE_FONT_ENV_SCRIPT } from '../ppt-fonts.mjs';
export const EXPORT_VERIFY_SCRIPT=String.raw`
import hashlib as verify_hash, re as verify_re, unicodedata as verify_unicode
${OFFICE_FONT_ENV_SCRIPT}
${NATIVE_CHART_CONTRACT_SCRIPT}
def verify_key(value):return verify_re.sub(r'\s+','',verify_unicode.normalize('NFKC',str(value))).strip()
def verify_math_tree(element):
    local=element.tag.split('}')[-1]
    if local in ('rPr','ctrlPr'):return None
    return (local,tuple(sorted(element.attrib.items())),element.text or '',tuple(value for child in element if (value:=verify_math_tree(child)) is not None))
def verify_export(path,manifest):
    from pptx import Presentation as VerifyPresentation
    import os, math
    if not manifest:return {'status':'not_evaluated','basis':'no_manifest'}
    if manifest.get('version')!=2 or not manifest.get('manifestHash'):raise ValueError('PPTX export requires current instance manifest v2')
    verified=VerifyPresentation(path);expected=manifest['slides'];errors=[];count=0;images_count=0;copy_count=0;visible_copy=[];source_ids=set();chart_visuals=[];sign_checks=0
    if len(expected)!=len(verified.slides):errors.append('exported slide count differs from IR')
    def flatten(shapes):
        for shape in shapes:
            yield shape
            if hasattr(shape,'shapes'):yield from flatten(shape.shapes)
    def frame(shape,g,label):
        if not g:return
        actual=[int(shape.left),int(shape.top),int(shape.width),int(shape.height)]
        wanted=[int(g[k]) for k in ('x','y','width','height')]
        if any(abs(a-b)>2540 for a,b in zip(actual,wanted)):errors.append('frame changed '+label)
    def payload_text(content):
        if content.get('paragraphs') is not None:return [v for p in content['paragraphs'] for v in (p.get('label',''),p.get('body','')) if v]
        if content.get('items') is not None:return [v for p in content['items'] for v in (p.get('text') or p.get('body') or '',p.get('heading') or '') if v]
        return [content.get('text','')]
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
                    if not obj.has_text_frame or verify_key(part['text'])!=verify_key(obj.text):errors.append('list point changed '+part['id'])
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
                    from pptx.oxml.ns import qn
                    geometry=shape._element.find('.//'+qn('a:prstGeom'))
                    if geometry is None:geometry=shape._element.find('.//'+qn('a:custGeom'))
                    if geometry is None or geometry.xml!=content['nativeMaskXml']:errors.append('native image mask changed '+label)
                images_count+=1
            elif kind=='table':
                wanted=content.get('rows',[]);actual=[[cell.text for cell in row.cells] for row in shape.table.rows] if shape.has_table else []
                if len(actual)!=len(wanted) or any(len(row)!=len(wanted[r]) or any(verify_key(cell)!=verify_key(wanted[r][c]) for c,cell in enumerate(row)) for r,row in enumerate(actual)):errors.append('table payload changed '+label)
                if shape.has_table:
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
                wanted=payload_text(content);actual=shape.text if shape.has_text_frame else ''
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
        render_errors=[]
        with pdfplumber.open(pdf) as document:
            if len(document.pages)!=len(expected):render_errors.append('rendered page count differs')
            for i,page in enumerate(document.pages):
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
                    wanted=Counter(verify_key(value));available=Counter(verify_key(inside))
                    if any(available[ch]<amount for ch,amount in wanted.items()):render_errors.append('page '+str(i+1)+' loses or overflows rendered instance '+instance['id']);break
            for check in chart_visuals:
                page=document.pages[check['slide']];g=check['geometry'];left,top,right,bottom=g['x']/12700,g['y']/12700,(g['x']+g['width'])/12700,(g['y']+g['height'])/12700
                values=[v for v in check['values'] if v!=0]
                bars=[r for r in page.rects if r.get('fill') and r['x0']>=left-1 and r['x1']<=right+1 and r['top']>=top-1 and r['bottom']<=bottom+1 and (right-left)/(len(values)*8)<r['width']<(right-left)*.7 and r['height']>1 and r.get('non_stroking_color') not in ((1,1,1),(1.0,1.0,1.0))]
                bars.sort(key=lambda r:r['x0'])
                if len(bars)!=len(values):render_errors.append('signed chart geometry not evaluated '+check['id']);continue
                zero=sum(r['bottom'] for r,v in zip(bars,values) if v>0)/sum(v>0 for v in values)
                if any(abs((r['top'] if v<0 else r['bottom'])-zero)>1 or v<0 and r['bottom']<=zero or v>0 and r['top']>=zero for r,v in zip(bars,values)):render_errors.append('wrong rendered chart sign '+check['id'])
                else:sign_checks+=1
        if render_errors:raise ValueError('PPTX rendered visibility: '+'; '.join(render_errors[:8]))
        with open(pdf,'rb') as f:pdf_hash=verify_hash.sha256(f.read()).hexdigest()
        pdf_artifact=path+'.verified.pdf';shutil.copyfile(pdf,pdf_artifact+'.part');os.replace(pdf_artifact+'.part',pdf_artifact)
        engine=subprocess.run(['soffice','--version'],capture_output=True,text=True,env=environment).stdout.strip()
    return {'status':'passed','basis':'reopened_pptx','version':2,'manifestHash':manifest['manifestHash'],'renderHash':manifest['renderHash'],'revision':manifest['revision'],'sha256':sha,'slides':len(verified.slides),'sourceObjectsChecked':len(source_ids),'imagesChecked':images_count,'copyEntriesChecked':copy_count,'renderedVisibility':{'status':'passed','basis':'actual_pptx_pdf_glyphs','engine':engine,'mixedSignColumnChartsChecked':sign_checks,'pdfSha256':pdf_hash,'pdfPath':pdf_artifact,'scope':'page/instance bounds and glyph retention; complex occlusion/ink not certified'}}
`;
