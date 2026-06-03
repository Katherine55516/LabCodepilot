import { useState, useEffect, useCallback, useMemo } from 'react';
import { isMultimodalDescription } from '@/lib/model-multimodal';

/**
 * useManagedMultimodal — single source of truth for "which managed models are
 * multimodal".
 *
 * The managed-account backend pushes a `description` per model, persisted in
 * the provider row's `notes` column. A model is multimodal when that text
 * contains「多模态」(see src/lib/model-multimodal.ts). This hook fetches the
 * managed providers once, exposes the enriched list (for the model picker
 * label) plus a guard helper (for the composer upload block), and refreshes on
 * the `provider-changed` event like the other provider consumers.
 *
 * Only `source==='managed'` rows are considered — local / BYOK providers have
 * no guaranteed description, so they are intentionally absent from the map and
 * the guard treats them as "unknown → allow" (see isManagedNonMultimodal).
 */

export interface ManagedMultimodalEntry {
  id: string;
  name: string;
  sort_order: number;
  notes: string;
  isMultimodal: boolean;
}

// Subset of /api/providers rows we read here.
interface ProviderRow {
  id: string;
  name: string;
  source?: string;
  sort_order?: number;
  notes?: string;
}

export interface UseManagedMultimodalReturn {
  /** Managed providers enriched with their multimodal flag, sort_order asc. */
  managed: ManagedMultimodalEntry[];
  /** Quick lookup: providerId → isMultimodal (managed rows only). */
  isMultimodalProvider: (providerId: string) => boolean;
  /**
   * True ONLY when the provider is a known managed row that is NOT multimodal.
   * Unknown providers (local / BYOK / not yet loaded) return false so media
   * uploads are never blocked for them — we only guard models we can prove are
   * non-multimodal.
   */
  isManagedNonMultimodal: (providerId: string) => boolean;
}

export function useManagedMultimodal(): UseManagedMultimodalReturn {
  const [managed, setManaged] = useState<ManagedMultimodalEntry[]>([]);

  const load = useCallback(() => {
    let cancelled = false;
    fetch('/api/providers')
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((data) => {
        if (cancelled) return;
        const all: ProviderRow[] = data?.providers ?? [];
        const rows = all
          .filter((p) => p.source === 'managed')
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((p) => ({
            id: p.id,
            name: p.name,
            sort_order: p.sort_order ?? 0,
            notes: p.notes ?? '',
            isMultimodal: isMultimodalDescription(p.notes),
          }));
        setManaged(rows);
      })
      .catch(() => {
        if (!cancelled) setManaged([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const cancel = load();
    const handler = () => load();
    window.addEventListener('provider-changed', handler);
    return () => {
      cancel?.();
      window.removeEventListener('provider-changed', handler);
    };
  }, [load]);

  const byId = useMemo(() => {
    const m = new Map<string, ManagedMultimodalEntry>();
    for (const e of managed) m.set(e.id, e);
    return m;
  }, [managed]);

  const isMultimodalProvider = useCallback(
    (providerId: string) => byId.get(providerId)?.isMultimodal ?? false,
    [byId],
  );

  const isManagedNonMultimodal = useCallback(
    (providerId: string) => {
      const entry = byId.get(providerId);
      return entry ? !entry.isMultimodal : false;
    },
    [byId],
  );

  return { managed, isMultimodalProvider, isManagedNonMultimodal };
}
