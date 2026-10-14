import type {PptGenerationPolicy} from '@/components/ppt/types';
import {defaultGenerationPolicy,explicitLanguageRequest as detectExplicitLanguageRequest} from '../../apps/cowork-server/lib/ppt-generation-policy.mjs';
export const unifiedGenerationPolicy=(request='')=>defaultGenerationPolicy(request) as PptGenerationPolicy;
export const explicitLanguageRequest=(request='')=>detectExplicitLanguageRequest(request) as 'zh'|'en'|'zh-HK'|undefined;
