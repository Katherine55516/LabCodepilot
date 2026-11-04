'use client';

import {useTranslation} from '@/hooks/useTranslation';
import {pptFailureKind,pptRetryPlan} from '@/lib/ppt-retry';
import type {PptProject} from '../types';

/** One line under a Retry button: where the retry resumes and what it keeps,
 * plus whether retrying alone can fix this failure (E7). */
export function PptRetryHint({project}:{project:PptProject}){
 const {t}=useTranslation();
 if(!['failed','quality_blocked'].includes(project.status))return null;
 const plan=pptRetryPlan(project),kind=pptFailureKind(project);
 return <p data-testid="ppt-retry-hint" data-stage={plan.stage} data-kind={kind} className="text-xs text-muted-foreground">
  {t(`ppt.retryPlan.${plan.stage}`,{kept:plan.kept,total:plan.total})}
  {kind!=='unknown'&&<> {t(`ppt.retryPlan.${kind}`)}</>}
 </p>;
}
