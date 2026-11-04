'use client';
import { useId } from 'react';

/** The AI mark on the generate button: two sparkles in a light-to-lavender
 * gradient, a lighter shade of the button's own purple (colors are the
 * --ppt-ai-* tokens in ppt-prototype.css, so light and dark themes match). */
export function AiSparkleIcon({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  return <svg className={className} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`ppt-ai-${id}`} x1="2" y1="2" x2="18" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0" style={{ stopColor: 'var(--ppt-ai-start)' }}/>
        <stop offset=".55" style={{ stopColor: 'var(--ppt-ai-mid)' }}/>
        <stop offset="1" style={{ stopColor: 'var(--ppt-ai-end)' }}/>
      </linearGradient>
    </defs>
    <g fill={`url(#ppt-ai-${id})`}>
      <path d="M9 3.5C9.6 7.6 11.4 9.4 15.5 10C11.4 10.6 9.6 12.4 9 16.5C8.4 12.4 6.6 10.6 2.5 10C6.6 9.4 8.4 7.6 9 3.5Z"/>
      <path d="M15.5 1.5C15.75 3.2 16.3 3.75 18 4C16.3 4.25 15.75 4.8 15.5 6.5C15.25 4.8 14.7 4.25 13 4C14.7 3.75 15.25 3.2 15.5 1.5Z"/>
      <circle cx="16" cy="15.5" r="1.15"/>
    </g>
  </svg>;
}
