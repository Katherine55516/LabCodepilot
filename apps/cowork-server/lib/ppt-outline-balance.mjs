/** Rebalance complete neighboring source reading units before confirmation. */
import{automaticPages}from'./ppt-density-profile.mjs';import{readingUnits}from'./ppt-semantic-relations.mjs';
const fill=slide=>slide.densityFit?.availableHeight?slide.densityFit.usedHeight/slide.densityFit.availableHeight:1;
const errors=a=>(a.issues||[]).filter(i=>i.severity==='error'||i.code!=='planned_density_overflow').length;
export async function balanceUnderfilledPages(project,assessed,assess,{low=.35,passes=4}={}){
 if(project.confirmedOutline||project.revision>0||Object.values(project.editing?.epochs||{}).some(epoch=>epoch>0)||project.generationPolicy?.content!=='full_source'||!automaticPages(project)||assessed?.rawOutline?.version!==2)return null;
 const inventory=project.source?.semantic?.inventory?.items||[],byId=new Map(inventory.map(i=>[i.id,i])),position=new Map(inventory.map((i,n)=>[i.id,n]));let current=assessed,changed=0;
 for(let pass=0;pass<passes;pass++){
  const raw=current.rawOutline;let accepted=null;
  for(let i=1;i<raw.slides.length-2&&!accepted;i++){
   const a=raw.slides[i],b=raw.slides[i+1],oldMin=Math.min(fill(a),fill(b));
   if(oldMin>=low||[a,b].some(s=>['cover','navigation','closing'].includes(s.role)||s.titleLocked||s.title_locked||s.sourceImageIds?.length||s.sourceArtifactRanges?.length))continue;
   const ids=[...(a.sourceUnitIds||[]),...(b.sourceUnitIds||[])];if(ids.length<3||new Set(ids).size!==ids.length||ids.some(id=>!byId.has(id))||ids.some((id,n)=>n>0&&position.get(id)<position.get(ids[n-1])))continue;
   const items=ids.map(id=>byId.get(id)),sections=new Set(items.map(item=>(item.sectionPath||[]).slice(0,2).filter(Boolean).join('\0')).filter(Boolean));
   // Only the first source preface may join its following introduction; later
   // pages must share a source section, not merely happen to be neighbors.
   if(sections.size>1||items.some(item=>!(item.sectionPath||[]).length)&&i!==1)continue;
   const units=readingUnits(inventory,ids);if(units.length<2)continue;
   const cuts=Array.from({length:units.length-1},(_,n)=>n+1).sort((x,y)=>Math.abs(x-units.length/2)-Math.abs(y-units.length/2)).slice(0,8);let best=null,bestMin=oldMin;
   for(const cut of cuts){
    const left=units.slice(0,cut).flat(),right=units.slice(cut).flat();if(JSON.stringify(left)===JSON.stringify(a.sourceUnitIds))continue;
    const next=[{...a,sourceUnitIds:left},{...b,sourceUnitIds:right}];
    try{const revised=await assess(project,{...raw,slides:[...raw.slides.slice(0,i),...next,...raw.slides.slice(i+2)]});
     if(revised.rawOutline.slides.length!==raw.slides.length||errors(revised)>errors(current)||revised.rawOutline.slides.some(s=>s.densityFit?.predictedOverflow>0))continue;
     const values=revised.rawOutline.slides.slice(i,i+2),min=Math.min(...values.map(fill));if(min>oldMin+.1&&min>bestMin){best=revised;bestMin=min;}
    }catch{/* the same full source/semantic/physical gates reject this cut */}
   }
   if(best)accepted=best;
  }
  if(!accepted)break;current=accepted;changed++;
 }
 return changed?{...current,concisionBalances:changed}:null;
}
