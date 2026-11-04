import {buildRenderTree} from './render-tree.mjs';
import {applyRenderContract,prepareNativeTextElement,RENDER_CONTRACT_VERSION} from './render-contract.mjs';
import {digest} from './edit-context.mjs';
import { ensureProjectV3 } from './ir.mjs';

export function migrateProject(project) {
  if (!project) return { project, changed: false };
  // V3 snapshots already carry canonical object IDs. Refresh creation context
  // at mutation boundaries, not by cloning every media string on every read.
  if (project.schemaVersion === 3 && project.creationContext?.schemaVersion === 1 &&
      Number.isInteger(project.revision) && (!project.deck || project.deck.schemaVersion === 3 &&
      project.deck.slides.every(slide => Array.isArray(slide.nodeOrder) && Array.isArray(slide.nodes))))
    {
      const stale=project.deck && project.renderTree?.renderContractVersion!==RENDER_CONTRACT_VERSION;
      const stalePreview=Object.values(project.runtime?.slides || {}).some(state=>state.preview?.elements?.some(element=>element.kind==='text'&&element.textLayout?.version!==RENDER_CONTRACT_VERSION));
      if(!stale && !stalePreview)return {project,changed:false};
      const refreshed={...project,...(stale?{renderTree:buildRenderTree(project),...(project.publishedArtifactPath?{renderUpgradePending:true}:{})}:{})};
      if(stalePreview)refreshed.runtime={...project.runtime,slides:Object.fromEntries(Object.entries(project.runtime.slides).map(([id,state])=>{
        if(!state.preview)return [id,state];
        const preview={...state.preview,elements:state.preview.elements.map(element=>applyRenderContract(prepareNativeTextElement({...element},state.preview.size?.height || 6858000)))};
        const renderHash=digest(preview);
        return [id,{...state,preview,renderHash,...(state.renderHash!==renderHash?{accepted:false}:{})}];
      }))};
      return {project:refreshed,changed:true};
    }
  const before = JSON.stringify(project);
  const migrated = ensureProjectV3(project);
  return { project: migrated, changed: before !== JSON.stringify(migrated) };
}
