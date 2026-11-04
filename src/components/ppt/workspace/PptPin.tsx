export function PptPin({ active = false }: { active?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7"><path d="m15 3 6 6-3 1-3 6-3-3-6 6 6-6-3-3 6-3z"/><path d="m6 18-3 3"/></svg>;
}
