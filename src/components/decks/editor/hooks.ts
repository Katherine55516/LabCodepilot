'use client';

import { useSyncExternalStore } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';

function subscribeMedia(callback: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

/** True below the md breakpoint; false during SSR. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMedia, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
}

const noopSubscribe = () => () => {};

/** True once running in the browser (for portals into document.body). */
export function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function subscribeResize(callback: () => void) {
  window.addEventListener('resize', callback);
  return () => window.removeEventListener('resize', callback);
}

/** Viewport size as "w×h" so the snapshot is a stable primitive. */
export function useViewport(): { width: number; height: number } {
  const value = useSyncExternalStore(subscribeResize, () => `${window.innerWidth}x${window.innerHeight}`, () => '1280x720');
  const [width, height] = value.split('x').map(Number);
  return { width, height };
}

/** True when the key event comes from a text field or contenteditable. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Starts a browser download for a Blob or URL. */
export function downloadFile(source: Blob | string, filename: string) {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (typeof source !== 'string') setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const safeFilename = (title: string) => (title.trim() || 'deck').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
