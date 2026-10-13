import type {PptGenerationPolicy} from '@/components/ppt/types';
import {defaultGenerationPolicy,explicitLanguageRequest} from '../../apps/cowork-server/lib/ppt-generation-policy.mjs';
export const unifiedGenerationPolicy=(request='')=>defaultGenerationPolicy(request) as PptGenerationPolicy;
export {explicitLanguageRequest};
