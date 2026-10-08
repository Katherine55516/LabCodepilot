import { visibleNodes } from './ppt-visible-content.mjs';
import crypto from 'node:crypto';
/** Small manifest has no image base64 copies. Verify output after reopening. */
export function exportManifest(project) {
  return {version:1,slides:(project.deck?.slides||[]).map(slide=>({id:slide.id,nodes:visibleNodes(slide)
    .filter(node=>['text','list','timeline','table','chart','image'].includes(node.type))
    .map(node=>({id:node.id,type:node.type,sourceArtifact:node.sourceArtifact,
      content:node.type==='image'?{imageSha256:node.content?.dataUrl
        ?crypto.createHash('sha256').update(Buffer.from(node.content.dataUrl.split(',')[1]||'','base64')).digest('hex')
        :node.content?.imageSha256}:node.content}))}))};
}
export function acceptExportVerification(project, info) {
  if(info?.exportVerification?.status!=='passed')throw new Error('PPTX export was not verified after reopening; publication blocked');
  project.quality={...project.quality,exportable:true,exportVerification:info.exportVerification,
    fontResolution:info.fontResolution||[],visualVerified:false};
}
export const EXPORT_VERIFY_SCRIPT=String.raw`
import hashlib as verify_hash, re as verify_re, unicodedata as verify_unicode
def verify_key(value):return verify_re.sub(r'\s+',' ',verify_unicode.normalize('NFKC',str(value))).strip()
def verify_math_tree(element):
    # Token equality cannot detect fraction/script/matrix relationship damage.
    local=element.tag.split('}')[-1]
    if local in ('rPr','ctrlPr'):return None
    return (local,tuple(sorted(element.attrib.items())),element.text or '',tuple(value for child in element if (value:=verify_math_tree(child)) is not None))
def verify_export(path,manifest):
    from pptx import Presentation as VerifyPresentation
    verified=VerifyPresentation(path);expected=(manifest or {}).get('slides',[]);count=0;errors=[];images_count=0;copy_count=0
    if expected and len(expected)!=len(verified.slides):errors.append('exported slide count differs from IR')
    for index,entry in enumerate(expected):
        if index>=len(verified.slides):break
        slide=verified.slides[index]
        def flatten(shapes):
            for shape in shapes:
                yield shape
                if hasattr(shape,'shapes'):yield from flatten(shape.shapes)
        shapes=list(flatten(slide.shapes))
        pictures=[shape for shape in shapes if hasattr(shape,'image')]
        hashes={verify_hash.sha256(shape.image.blob).hexdigest() for shape in pictures}
        consumed=set()
        page_text='\n'.join(shape.text for shape in shapes if shape.has_text_frame)
        for node in entry.get('nodes',[]):
            source=node.get('sourceArtifact');content=node.get('content') or {}
            if node['type']=='image':
                sha=content.get('imageSha256')
                if sha and sha not in hashes:errors.append('slide '+str(index+1)+' missing image '+node['id'])
                if not sha:errors.append('slide '+str(index+1)+' image has no verifiable asset '+node['id'])
                images_count+=1
                continue
            label='AIMate source:'+str(source.get('sourceUnitId',''))+':'+str(source.get('type','')) if source else node['id']
            matches=[shape for shape in shapes if shape.name==label and shape.shape_id not in consumed] if source else shapes
            if not matches:errors.append('slide '+str(index+1)+' missing object '+label);continue
            if node['type']=='table':
                wanted=content.get('rows',[])
                def same_table(shape):
                    actual=[[cell.text for cell in row.cells] for row in shape.table.rows] if shape.has_table else []
                    return len(actual)==len(wanted) and all(len(row)==len(wanted[r]) and all(verify_key(cell)==verify_key(wanted[r][c]) for c,cell in enumerate(row)) for r,row in enumerate(actual))
                match=next((shape for shape in matches if same_table(shape)),None)
                if match:consumed.add(match.shape_id)
                else:errors.append('slide '+str(index+1)+' table payload changed '+label)
            elif content.get('mathMl'):
                ns={'m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
                wanted=verify_math_tree(office_math(content['mathMl']))
                match=next((shape for shape in matches if any(verify_math_tree(el)==wanted for el in shape._element.findall('.//m:oMath',ns)) and shape._element.findall('.//{http://schemas.microsoft.com/office/drawing/2010/main}m')),None)
                if match:consumed.add(match.shape_id)
                else:errors.append('slide '+str(index+1)+' math payload changed '+label)
            elif node['type']=='chart':
                wanted=[str(value) for value in content.get('labels',[])]
                if not any(shape.has_chart and [str(c.label) for c in shape.chart.plots[0].categories]==wanted and list(shape.chart.series[0].values)==content.get('values',[]) for shape in matches):errors.append('slide '+str(index+1)+' chart payload changed '+label)
            else:
                lines=[content.get('text','')]
                for item in content.get('items',[]):lines.extend([item.get('heading') or item.get('label') or '',item.get('body') or item.get('text') or ''])
                for item in content.get('paragraphs',[]):lines.extend([item.get('label') or '',item.get('body') or ''])
                wanted=[line for value in lines for line in str(value).split('\n') if line.strip()]
                actual='\n'.join(shape.text for shape in matches if shape.has_text_frame) if source else page_text
                if any(verify_key(line) not in verify_key(actual) for line in wanted):errors.append('slide '+str(index+1)+' visible payload changed '+label)
                copy_count+=len(wanted)
            if source:count+=1
    if errors:raise ValueError('PPTX export integrity: '+'; '.join(errors[:12]))
    with open(path,'rb') as f:sha=verify_hash.sha256(f.read()).hexdigest()
    return {'status':'passed' if manifest else 'not_evaluated','basis':'reopened_pptx','sha256':sha,'slides':len(verified.slides),'sourceObjectsChecked':count,'imagesChecked':images_count,'copyEntriesChecked':copy_count}
`;
