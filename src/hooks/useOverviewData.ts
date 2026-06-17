'use client';

// Lightweight aggregation hook for the RunCockpit card's "This run" section.
// Fetches provider/model groups (for friendly model labels) and the global
// default mode (auto vs pinned). A trimmed version of the spec's full
// useOverviewData — no issue detection / runtime resolution (out of scope).

import { useState, useEffect } from 'react';
import type { ProviderModelGroup } from '@/types';

export interface OverviewData {
  loading: boolean;
  groups: ProviderModelGroup[];
  defaultProviderId?: string;
  /** Global default model id (set → "pinned"; unset → "auto"). */
  globalDefaultModel?: string;
  globalDefaultProvider?: string;
}

export function useOverviewData(): OverviewData {
  const [data, setData] = useState<OverviewData>({ loading: true, groups: [] });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [modelsRes, optionsRes] = await Promise.all([
          fetch('/api/providers/models'),
          fetch('/api/providers/options?providerId=__global__'),
        ]);
        const modelsData = modelsRes.ok ? await modelsRes.json() : null;
        const optionsData = optionsRes.ok ? await optionsRes.json() : null;
        if (cancelled) return;
        setData({
          loading: false,
          groups: modelsData?.groups ?? [],
          defaultProviderId: modelsData?.default_provider_id,
          globalDefaultModel: optionsData?.options?.default_model,
          globalDefaultProvider: optionsData?.options?.default_model_provider,
        });
      } catch {
        if (!cancelled) setData((d) => ({ ...d, loading: false }));
      }
    }

    load();
    const onChanged = () => load();
    window.addEventListener('provider-changed', onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('provider-changed', onChanged);
    };
  }, []);

  return data;
}
