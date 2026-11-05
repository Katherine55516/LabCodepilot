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

export interface RadioCardOption<T extends string> { value: T; label: ReactNode; description?: ReactNode; icon?: ReactNode }

/**
 * Radio cards: native radio inputs (arrow keys and screen readers work as
 * usual) styled as selectable cards with a title and an explanation.
 */
export function RadioCards<T extends string>({ name, legend, options, value, onChange, className, columns = 1 }: {
  name: string; legend: ReactNode; options: RadioCardOption<T>[]; value: T; onChange: (value: T) => void; className?: string; columns?: 1 | 2 | 3;
}) {
  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <legend className="mb-1.5 text-sm font-medium leading-none">{legend}</legend>
      <div className={cn('grid gap-2', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3')}>
        {options.map(option => {
          const id = `${name}-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/70 p-3 transition-colors',
                'hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5',
                'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={option.value === value}
                onChange={() => onChange(option.value)}
                aria-labelledby={`${id}-label`}
                aria-describedby={option.description ? `${id}-hint` : undefined}
                className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
              />
              {option.icon && <span aria-hidden className="mt-0.5 shrink-0 text-muted-foreground">{option.icon}</span>}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span id={`${id}-label`} className="text-sm font-medium">{option.label}</span>
                {option.description && <span id={`${id}-hint`} className="text-xs text-muted-foreground">{option.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
