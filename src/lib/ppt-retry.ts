import type {PptProject} from '@/components/ppt/types';

/** What Retry will do (E7 of the full review): the stage it resumes from, how
 * many finished pages it keeps, and whether the failure is one a retry can
 * fix or one that needs a change first. Mirrors the server retry route:
 * ingest → re-read, outline → re-plan, generation → resume pages, and a
 * quality-blocked deck re-runs the review on unchanged pages. */
export type PptRetryStage='ingest'|'read'|'outline'|'generation'|'review';
export type PptFailureKind='recoverable'|'needs_change'|'unknown';

const NEEDS_CHANGE=/capacity_invalid|coverage_invalid|source_artifact_capacity|planned_density_overflow|outline_confirmation_capacity|template[^\n]*capacity|input_budget|template_slot_overflow|ppt_auth|PPT model failure: auth|execution_attempt_limit|attempt limit reached|execution_budget|token budget reached/u;
const RECOVERABLE=/timeout|rate_limit|\b429\b|network|transport|model_unavailable|fetch failed|truncated_output|empty_visible_output|invalid_json|quota|insufficient|balance|cancelled|\b5\d\d\b/iu;

export function pptFailureKind(project:Pick<PptProject,'error'|'failure'|'status'|'qualityBlockReason'>):PptFailureKind{
 if(project.status==='quality_blocked')return project.qualityBlockReason==='export'?'unknown':'needs_change';
 const text=`${project.failure?.code||''} ${project.error||''}`;
 if(NEEDS_CHANGE.test(text))return 'needs_change';
 if(RECOVERABLE.test(text))return 'recoverable';
 return 'unknown';
}

export function pptRetryPlan(project:Pick<PptProject,'status'|'stage'|'outline'|'pages'|'nodes'|'progress'|'failure'>):{stage:PptRetryStage;kept:number;total:number}{
 // Task summaries intentionally carry only the cover outline; their progress
 // total is the full deck count, not that one-item title projection.
 const total=project.progress?.total||project.outline?.length||project.pages||0;
 if(project.status==='quality_blocked')return {stage:'review',kept:total,total};
 // v2 reads the input with the model inside the outline stage.
 const stage:PptRetryStage=project.stage==='ingest'?'ingest':project.stage==='outline'?(project.failure?.modelStage?.startsWith('input:')?'read':'outline'):'generation';
 if(stage!=='generation')return {stage,kept:0,total};
 const done=project.nodes?Object.entries(project.nodes).filter(([key,node])=>key!=='source'&&node.status==='done'&&node.slide).length:0;
 return {stage,kept:Math.min(total,Math.max(done,project.progress?.contentReady||0)),total};
}
