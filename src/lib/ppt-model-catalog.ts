import type {PptModel,PptExecutionPolicy} from '@/components/ppt/types';

/** Explicit evaluation metadata from provider_models.capabilities_json.ppt.
 * Unknown models remain usable by explicit choice, never advertised as evaluated. */
export type PptModelCapabilities={vision?:boolean;structuredOutput?:boolean;streaming?:boolean;contextTokens?:number;maxOutputTokens?:number;thinkingControl?:boolean;ppt?:{roles?:string[];evaluatedAt?:string;benchmarkVersion?:string;qualityScore?:number;latencyMs?:number;health?:'healthy'|'degraded'|'unavailable';verifiedProtocol?:string;priceSource?:string;priceUpdatedAt?:string;inputPerMillion?:number;outputPerMillion?:number}};
export function isPptModelEvaluated(model:PptModel){const ppt=model.capabilities?.ppt;return Boolean(ppt?.roles?.length&&ppt.evaluatedAt&&ppt.benchmarkVersion&&ppt.verifiedProtocol&&['healthy','degraded'].includes(ppt.health||'')&&Number.isFinite(ppt.qualityScore)&&Number.isFinite(ppt.latencyMs));}
export function choosePptRoleModel(models:PptModel[],role:string,level:string,defaultId:string):PptModel|undefined {
  const evaluated=models.filter(model=>isPptModelEvaluated(model)&&model.capabilities?.ppt?.roles?.includes(role));
  evaluated.sort((a,b)=>{
    const x=a.capabilities!.ppt!,y=b.capabilities!.ppt!;
    if(x.health!==y.health)return x.health==='healthy'?-1:1;
    return level==='fast'?(x.latencyMs??Infinity)-(y.latencyMs??Infinity)||(y.qualityScore??0)-(x.qualityScore??0):(y.qualityScore??0)-(x.qualityScore??0)||(x.latencyMs??Infinity)-(y.latencyMs??Infinity);
  });
  if(evaluated[0])return evaluated[0];
  return models.find(model=>model.id===defaultId&&model.capabilities?.ppt?.health!=='unavailable')||models.find(model=>model.capabilities?.ppt?.health!=='unavailable');
}
export function pptRoleRef(model:PptModel){return {configId:model.configId,model:model.modelId,...(model.capabilities?.thinkingControl===true?{thinkingControl:true}:{}),...(model.capabilities?.vision===true?{vision:true}:{}),...(model.capabilities?.contextTokens?{contextTokens:model.capabilities.contextTokens}:{}),...(model.capabilities?.maxOutputTokens?{maxOutputTokens:model.capabilities.maxOutputTokens}:{})};}

export const pptTextRoles=['source_organizer','planner','writer_fast','writer_standard','writer_reasoning','critic'] as const;
/** Re-evaluate automatic choices after a quality/catalog change. Explicit user
 * choices (including older policies without selection metadata) remain fixed. */
export function bindPptExecutionPolicy(policy:PptExecutionPolicy,models:PptModel[],defaultKey:string):PptExecutionPolicy {
 const roleRoutes={...policy.roleRoutes};
 for(const role of pptTextRoles){
  if(roleRoutes[role]&&roleRoutes[role].selection!=='automatic')continue;
  const selected=choosePptRoleModel(models,role,policy.qualityLevel,defaultKey);
  if(selected){const complex=['planner','critic'].includes(role)?choosePptRoleModel(models,role,'rigorous',defaultKey):undefined;roleRoutes[role]={primary:pptRoleRef(selected),...(complex?{complexPrimary:pptRoleRef(complex)}:{}),selection:'automatic',fallbacks:[]};}
  else delete roleRoutes[role];
 }
 return {...policy,roleRoutes};
}
