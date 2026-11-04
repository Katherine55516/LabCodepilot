'use client';

// Lightweight hook for the RunCockpit card's "This run" section: fetches the
// provider/model groups so the card can show the friendly provider display
// name. Refetches on the `provider-changed` event.

import { useState, useEffect } from 'react';
import type { ProviderModelGroup } from '@/types';

export interface OverviewData {
  loading: boolean;
  groups: ProviderModelGroup[];
}

export function useOverviewData(): OverviewData {
  const [data, setData] = useState<OverviewData>({ loading: true, groups: [] });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/providers/models');
        const modelsData = res.ok ? await res.json() : null;
        if (cancelled) return;
        setData({ loading: false, groups: modelsData?.groups ?? [] });
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
