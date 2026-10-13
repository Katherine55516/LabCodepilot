/** Confirming an unchanged automatic estimate freezes N without inventing a
 * manual page request. Changed counts/templates remain explicit decisions.
 * @param {any} project
 * @param {{nextPages:number,pageSource?:string,template?:string}} input
 */
export function confirmedPageDecision(project, { nextPages, pageSource = undefined, template = undefined }, now = new Date().toISOString()) {
  const prior = project.pageDecision;
  const estimated = pageSource === 'estimate' && prior?.mode === 'auto' &&
    nextPages === project.pages && (template === undefined || template === project.template);
  return estimated
    ? { ...prior, finalPageCount: nextPages, confirmedAt: now }
    : { finalPageCount: nextPages, source: 'user', mode: 'explicit', includesCover: true, confirmedAt: now };
}
/** An explicit user action releases only the page budget; existing source,
 * font floors and accepted/manual objects remain protected by the executor. */
export function automaticPageDecision(project,baseRevision,now=new Date().toISOString()){
 if(baseRevision!==project.revision)throw Object.assign(Error('presentation changed; reload before changing page policy'),{statusCode:409});
 if(!['completed','quality_blocked'].includes(project.status)||project.externalPptx||project.update)throw Object.assign(Error('page policy is not editable in this state'),{statusCode:409});
 const initial=Number(project.planning?.pageRecommendation?.recommended||project.pageDecision?.initialPageCount||project.pages);
 return {finalPageCount:project.pages,source:'estimate',mode:'auto',initialPageCount:initial,includesCover:true,confirmedAt:now,fitValidated:true,userReleasedBudgetAt:now};
}
