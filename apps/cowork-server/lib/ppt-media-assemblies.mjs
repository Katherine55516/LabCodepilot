import {stableId} from './ppt/ir.mjs';
const sameBox=(a,b)=>a&&b&&['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<=Math.max(127,a[k]*.001));
const inside=(a,b)=>b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width+127&&b.y+b.height<=a.y+a.height+127;
/** Coincident monochrome transparent layers are one native illustration, not
 * independent photos. Include contained graphic details, never surrounding
 * text. Ordinary separate circles and neighboring photos remain independent. */
export function templateMediaAssemblies(slide,size={}){
 const nodes=slide.nodes||[],area=(size.width||1)*(size.height||1),groups=[],used=new Set();
 for(const node of nodes){
  if(used.has(node.id)||node.type!=='image'||!node.geometry||!node.content?.monochromePanel||node.geometry.width*node.geometry.height>area*.6)continue;
  const peers=nodes.filter(other=>other.type==='image'&&other.content?.monochromePanel&&sameBox(node.geometry,other.geometry));
  if(peers.length<2||new Set(peers.map(n=>n.content.imageSha256)).size<2)continue;
  const members=nodes.filter(other=>['image','shape'].includes(other.type)&&other.geometry&&inside(node.geometry,other.geometry));
  members.forEach(n=>used.add(n.id));groups.push({id:stableId('assembly',...peers.map(n=>String(n.nativeRef?.shapeId||n.id)).sort()),geometry:{...node.geometry},members,basis:'coincident_distinct_monochrome_layers_with_contained_graphic_details'});
 }
 return groups;
}

/** Detect the same affine transform for every kept part. An omitted part or
 * independently positioned part is an explicit integrity failure. */
export function inspectMediaAssemblies(project){
 const issues=[];
 for(const [index,slide] of (project.deck?.slides||[]).entries()){
  const spec=project.templateFidelity?.slides?.[index];if(!spec)continue;
  for(const group of templateMediaAssemblies(spec,project.templateFidelity)){
   const omitted=new Set((slide.templateOmissions||[]).map(o=>String(o.shapeId)));
   const parts=group.members.map(base=>({base,live:slide.nodes?.find(n=>n.nativeRef?.shapeId===base.nativeRef.shapeId&&!n.hidden&&!omitted.has(String(base.nativeRef.shapeId)))}));
   const kept=parts.filter(p=>p.live);if(!kept.length)continue;
   const affine=({base,live})=>{const a=base.geometry,b=live.geometry;return [b.width/a.width,b.height/a.height,b.x-a.x*b.width/a.width,b.y-a.y*b.height/a.height];};
   const first=affine(kept[0]);
   if(kept.length!==parts.length||kept.some(p=>affine(p).some((v,k)=>Math.abs(v-first[k])>(k<2?.005:1270))))issues.push({code:'template_media_assembly_split',severity:'error',repairable:true,slideId:slide.id,nodeIds:kept.map(p=>p.live.id),message:'A composite template illustration has missing or independently transformed parts; retain one common transform or retire the complete optional assembly.'});
  }
 }
 return issues;
}
