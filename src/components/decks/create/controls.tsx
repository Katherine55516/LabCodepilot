'use client';

import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** A labelled form row with an optional hint under the control. */
export function Field({ label, htmlFor, hint, children, className }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {htmlFor ? <Label htmlFor={htmlFor}>{label}</Label> : <span className="text-sm font-medium leading-none">{label}</span>}
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export interface SegmentedOption<T extends string> { value: T; label: ReactNode; description?: string }

/** Radio-style segmented control; arrow keys move the selection. */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel, disabled, className }: {
  options: SegmentedOption<T>[]; value: T; onChange: (value: T) => void; ariaLabel: string; disabled?: boolean; className?: string;
}) {
  const move = (container: HTMLElement, delta: number) => {
    const index = options.findIndex(option => option.value === value);
    const nextIndex = (index + delta + options.length) % options.length;
    const next = options[nextIndex];
    if (!next) return;
    onChange(next.value);
    container.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn('flex flex-wrap gap-1 rounded-lg bg-muted p-[3px]', disabled && 'opacity-50', className)}
      onKeyDown={event => {
        if (disabled) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(event.currentTarget, 1); }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(event.currentTarget, -1); }
      }}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            title={option.description}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex-1 rounded-md px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-colors outline-none',
              'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed',
              selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
