'use client';
import { useEffect, useRef } from 'react';

/** Server-side calls keep keys out of the browser. Requests finish even when view changes. */
export function usePptDesktopModelWorker(enabled: boolean, onError: (message: string) => void) {
  const errorRef = useRef(onError);
  useEffect(() => { errorRef.current = onError; }, [onError]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let reported = false;let epoch=0;const active=new Set<string>();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch('/api/ppt/model-jobs', { cache: 'no-store' });
        if (!response.ok) { if (!stopped) timer = setTimeout(poll, 10000); return; }
        const data = await response.json();
        if (!stopped && Array.isArray(data.jobs)) for(const {id} of data.jobs as {id:string}[]){
          if(active.size>=3)break;if(active.has(id))continue;active.add(id);const requestEpoch=epoch;
          void (async()=>{
          const result = await fetch('/api/ppt/model-jobs/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
          if (!stopped && requestEpoch===epoch && !result.ok && result.status !== 409 && !reported) { reported = true; const body = await result.json(); errorRef.current(body.error || 'Local model request failed'); }
          })().catch(()=>{}).finally(()=>active.delete(id));
        }
      } catch { /* Keep intermittent transport failures out of the user conversation. */ }
      if (!stopped) timer = setTimeout(poll, 1000);
    }
    const reset=()=>{epoch++;reported=false;};window.addEventListener('provider-changed',reset);const off=window.electronAPI?.auth?.onChange(reset);
    void poll();
    return () => { stopped = true;epoch++; clearTimeout(timer);off?.();window.removeEventListener('provider-changed',reset); };
  }, [enabled]);
}
