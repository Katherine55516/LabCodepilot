/**
 * Resolve the effective model and provider for a session.
 *
 * Priority:
 * 1. Session's stored model — if non-empty AND not a stale env alias
 * 2. Global default model — only if it belongs to the session's provider
 * 3. First available model within the session's provider
 * 4. Global default model + provider (when session has neither)
 * 5. localStorage last-used model — if not a stale env alias
 * 6. First real managed model, else empty (never the bare 'sonnet' alias)
 *
 * A "stale env alias" is a bare sonnet/opus/haiku that was persisted before the
 * deployment went managed-only: it isn't in the managed catalog, so it's dropped
 * and re-resolved. In env mode (no managed provider) the aliases stay valid.
 *
 * The session's provider_id is never overwritten by a different provider's global default.
 */

type ModelGroup = { provider_id: string; models: Array<{ value: string }> };

// Bare env-provider aliases. In managed deployments these don't exist in the
// downloaded provider catalog, so a session pinned to one is treated as stale.
const ENV_ALIASES = new Set(['sonnet', 'opus', 'haiku']);

interface ResolveContext {
  globalModel: string;
  globalProvider: string;
  groups: ModelGroup[];
  lsModel: string;
  lsProvider: string;
}

/**
 * A bare env alias (sonnet/opus/haiku) is "stale" when managed providers exist
 * but the alias isn't among the named provider's models — i.e. it was persisted
 * before the deployment went managed-only and now points at a phantom model.
 * In env mode (no managed provider at all) aliases are legitimate, never stale.
 */
function isStaleEnvAlias(model: string, providerId: string, groups: ModelGroup[]): boolean {
  if (!ENV_ALIASES.has(model)) return false;
  const hasManaged = groups.some(g => g.provider_id && g.provider_id !== 'env');
  if (!hasManaged) return false;
  const group = providerId ? groups.find(g => g.provider_id === providerId) : undefined;
  const validInGroup = group?.models.some(m => m.value === model) ?? false;
  return !validInGroup;
}

/**
 * Pure resolution logic — no I/O, fully testable.
 */
export function resolveSessionModelPure(
  sessionModel: string,
  sessionProviderId: string,
  ctx: ResolveContext,
): { model: string; providerId: string } {
  const { globalModel, globalProvider, groups, lsModel, lsProvider } = ctx;

  // Session already has a model — use it as-is, unless it's a stale env alias
  // persisted before the provider went managed-only (re-resolve those).
  if (sessionModel && !isStaleEnvAlias(sessionModel, sessionProviderId, groups)) {
    return { model: sessionModel, providerId: sessionProviderId };
  }

  // Case 1: Session has a provider — resolve model within that provider
  if (sessionProviderId) {
    const sessionGroup = groups.find(g => g.provider_id === sessionProviderId);

    // Use global default only if it belongs to this session's provider
    if (globalModel && globalProvider === sessionProviderId) {
      const valid = sessionGroup?.models.some(m => m.value === globalModel);
      if (valid) {
        return { model: globalModel, providerId: sessionProviderId };
      }
    }

    // Fall back to first available model in this provider
    if (sessionGroup?.models?.length) {
      return { model: sessionGroup.models[0].value, providerId: sessionProviderId };
    }
  }

  // Case 2: Session has no provider — use global default as-is
  if (globalModel) {
    return { model: globalModel, providerId: globalProvider || '' };
  }

  // Case 3: No global default — localStorage last-used (unless it's a stale env
  // alias too), then the first real managed model, then empty. We never fall
  // back to the bare 'sonnet' alias in managed deployments: it isn't a real
  // model and would surface a phantom. Empty lets useProviderModels apply its
  // own env default.
  if (lsModel && !isStaleEnvAlias(lsModel, lsProvider, groups)) {
    return { model: lsModel, providerId: lsProvider || '' };
  }
  const firstManaged = groups.find(g => g.provider_id && g.provider_id !== 'env');
  if (firstManaged?.models?.length) {
    return { model: firstManaged.models[0].value, providerId: firstManaged.provider_id };
  }
  return { model: '', providerId: '' };
}

/**
 * Fetch-based wrapper for use in components. Gathers context then delegates to pure function.
 */
export async function resolveSessionModel(
  sessionModel: string,
  sessionProviderId: string,
): Promise<{ model: string; providerId: string }> {
  // Non-alias model — trust it and skip the validation fetches. Bare env
  // aliases (sonnet/opus/haiku) and empty models fall through to fetch the
  // managed catalog so resolveSessionModelPure can drop stale phantoms.
  if (sessionModel && !ENV_ALIASES.has(sessionModel)) {
    return { model: sessionModel, providerId: sessionProviderId };
  }

  let globalModel = '';
  let globalProvider = '';
  let groups: ModelGroup[] = [];

  try {
    const [globalRes, modelsRes] = await Promise.all([
      fetch('/api/providers/options?providerId=__global__').catch(() => null),
      fetch('/api/providers/models').catch(() => null),
    ]);

    if (globalRes && 'ok' in globalRes && globalRes.ok) {
      const globalData = await globalRes.json().catch(() => null);
      globalModel = globalData?.options?.default_model || '';
      globalProvider = globalData?.options?.default_model_provider || '';
    }
    if (modelsRes && 'ok' in modelsRes && modelsRes.ok) {
      const data = await modelsRes.json().catch(() => null);
      groups = (data?.groups as ModelGroup[]) || [];
    }
  } catch { /* best effort */ }

  const lsModel = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-model') : null;
  const lsProvider = typeof window !== 'undefined' ? localStorage.getItem('codepilot:last-provider-id') : null;

  return resolveSessionModelPure(sessionModel, sessionProviderId, {
    globalModel,
    globalProvider,
    groups,
    lsModel: lsModel || '',
    lsProvider: lsProvider || '',
  });
}
