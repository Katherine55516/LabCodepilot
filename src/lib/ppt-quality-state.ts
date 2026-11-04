export function pptModelReviewState(quality:{reviewState?:string;modelReview?:{evaluation?:string}|null}|null|undefined){
 const state=quality?.reviewState;
 if(state==='running'||state==='pending')return 'running';
 if(state==='failed')return 'failed';
 if(!quality?.modelReview||quality.modelReview.evaluation==='not_evaluated')return 'notRun';
 if(state==='stale')return 'stale';
 return 'completed';
}
