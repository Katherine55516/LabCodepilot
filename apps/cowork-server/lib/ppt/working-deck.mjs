import {ensureDeckV3} from './ir.mjs';

/** Read projection for a partially written deck. Only validated current-epoch
 * object snapshots become editable; pending pages remain empty placeholders.
 * Reading this projection never publishes or saves a generated page. */
export function withVerifiedWorkingDeck(project) {
  if(!project||project.deck||!['generating','paused','failed'].includes(project.status)||project.status==='failed'&&project.stage!=='generation')return project;
  const verified=id=>{
    const state=project.runtime?.slides?.[id];
    return project.nodes?.[id]?.status==='done'&&state?.phase==='render_ready'&&state.preview&&state.canonicalSlide&&Number(state.epoch||0)===Number(project.editing?.epochs?.[id]||0)&&!state.quality?.issues?.some(i=>i.severity==='error')?state.canonicalSlide:null;
  };
  if(!project.outline?.some(s=>verified(s.id)))return project;
  return {...project,deck:ensureDeckV3({deckId:'deck_'+project.id,slides:project.outline.map(s=>verified(s.id)||{id:s.id,title:s.title,nodes:[],bullets:[],layoutId:s.role==='cover'?'cover':'summary'})}),
    renderTree:{schemaVersion:3,units:'emu',deckId:'deck_'+project.id,size:project.renderTree?.size||{width:project.templateFidelity?.width||12192000,height:project.templateFidelity?.height||6858000},slides:project.outline.map((s,index)=>verified(s.id)?project.runtime.slides[s.id].preview:{id:s.id,slideId:s.id,index,elements:[]})}};
}
