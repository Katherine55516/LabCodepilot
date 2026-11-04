import {ensureDeckV3} from './ppt/ir.mjs';
/** Explicit copy conversion: preserve source text, tables/charts/images and notes.
 * Native shapes/foreign objects require manual handling and never vanish silently. */
export function componentCopyDeck(project){
 const supported=new Set(['text','list','table','chart','image','timeline','metric','shape','formula']);
 const unsupported=project.deck.slides.flatMap(slide=>(slide.nodes||[]).filter(node=>!supported.has(node.type)).map(node=>({slideId:slide.id,nodeId:node.id,type:node.type})));
 if(unsupported.length)throw Object.assign(new Error('Component conversion needs manual handling of unsupported objects: '+unsupported.map(item=>`${item.slideId}/${item.type}`).join(', ')),{status:409});
 return ensureDeckV3({version:3,slides:project.deck.slides.map(slide=>{
   const nodes=slide.nodes||[],titleNode=nodes.find(node=>['title','template-title'].includes(node.semanticRole));
   const title=titleNode?.content?.text||slide.title;
   const bullets=nodes.filter(node=>node!==titleNode&&!node.hidden&&node.type==='text').map(node=>String(node.content?.text||'')).filter(Boolean);
   for(const node of nodes.filter(node=>node.type==='list'))for(const item of node.content?.items||[])bullets.push(item.text||[item.heading,item.body].filter(Boolean).join(': '));
   const blocks=nodes.filter(node=>!node.hidden&&!['text','list'].includes(node.type)).map(node=>({...structuredClone(node.content),type:node.type,id:node.id}));
   return {id:slide.id,title,bullets,blocks,layoutId:blocks.length===1&&blocks[0].type==='table'?'table':blocks.length?'image-text':'summary',notes:slide.notes,sourceRefs:slide.sourceRefs,sourceUnitIds:slide.sourceUnitIds,titleLocked:slide.titleLocked};
 })});
}
