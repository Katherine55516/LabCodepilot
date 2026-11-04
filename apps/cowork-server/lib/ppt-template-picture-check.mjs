/** Template pictures read by the vision reader when OCR is unavailable (Fable,
 * 2026-10-25; 3143 g5b/g5c: the Portfolio cover's "COMPANY NAME" pill was a
 * picture classified as an icon and reached the deck). Each picture above
 * icon size is checked once, by image hash, for drawn text and people:
 *  - drawn text: old template content, retired;
 *  - no text and no people, on a picture retired only for being a foreground
 *    picture: decoration, kept (its layout no longer leaves a hole, so it
 *    counts as reusable for the layout cap).
 * Without a vision reader nothing changes. */
const MIN_AREA=.005,BATCH=4;// modelCall takes at most four images per call
const checked=content=>content?.ocr?.status==='ok';
function candidates(tf){
  const area=Math.max(1,Number(tf.width||0)*Number(tf.height||0)),seen=new Map();
  for(const slide of tf.sourceCatalog||[])for(const node of slide.nodes||[]){
    const g=node.geometry||{};
    if(node.type!=='image'||node.content?.mustPreserve||typeof node.content?.dataUrl!=='string'||!node.content.imageSha256||checked(node.content))continue;
    if(g.width*g.height/area<MIN_AREA||seen.has(node.content.imageSha256))continue;
    seen.set(node.content.imageSha256,node.content.dataUrl);
  }
  return seen;
}
export async function checkTemplatePictures(project,call){
  const tf=project.templateFidelity;
  if(!project.executionPolicy?.roleRoutes?.vision_reader||tf?.mode!=='preserve'||!Array.isArray(tf.sourceCatalog))return null;
  const results={...(tf.pictureChecks||{})},pending=[...candidates(tf)].filter(([hash])=>!results[hash]);
  for(let start=0;start<pending.length;start+=BATCH){
    const batch=pending.slice(start,start+BATCH),images=batch.map(([hash,dataUrl],k)=>({id:'picture-'+k,dataUrl}));
    const reply=await call(project,`For each attached template picture (ids ${images.map(image=>image.id).join(', ')}), say whether it shows any readable text, letters, numbers, logos or watermarks, and whether it shows people or faces. Return JSON {"pictures":[{"id":string,"text":boolean,"people":boolean}]}.`,
      {nodeKey:'vision:template-pictures:'+start,images,maxOutputTokens:512,jsonSchema:{type:'object',additionalProperties:false,required:['pictures'],properties:{pictures:{type:'array',items:{type:'object',additionalProperties:false,required:['id','text','people'],properties:{id:{type:'string'},text:{type:'boolean'},people:{type:'boolean'}}}}}}});
    for(const [k,[hash]] of batch.entries()){const answer=(reply?.pictures||[]).find(item=>item.id==='picture-'+k);if(answer)results[hash]={text:answer.text===true,people:answer.people===true};}
  }
  project.templateFidelity={...tf,pictureChecks:results,sourceCatalog:applyPictureChecks(tf.sourceCatalog,results)};
  return results;
}
export function applyPictureChecks(catalog,results){
  return (catalog||[]).map(slide=>({...slide,nodes:(slide.nodes||[]).map(node=>{
    const check=node.type==='image'?results[node.content?.imageSha256]:null;if(!check)return node;
    if(check.text)return {...node,content:{...node.content,visionText:true,mediaRole:'old_template_content',templateSample:true,retiredDecorationBasis:'vision reader: drawn text'}};
    const foregroundOnly=node.content?.mediaRole==='old_template_content'&&!node.content?.retiredDecorationBasis&&!node.content?.mustPreserve;
    if(foregroundOnly&&!check.people)return {...node,content:{...node.content,visionText:false,mediaRole:'template_decoration',templateSample:false,keptBasis:'vision reader: no text or people'}};
    return {...node,content:{...node.content,visionText:false}};
  })}));
}
