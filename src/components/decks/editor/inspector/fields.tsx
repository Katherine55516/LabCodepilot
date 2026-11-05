'use client';

import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
  hint?: string;
  /** Marks an empty value as invalid (the field still accepts it while typing). */
  required?: boolean;
  requiredLabel?: string;
  mono?: boolean;
  rows?: number;
  disabled?: boolean;
}

/** Labelled input or textarea used by every inspector form. */
export function TextField({ label, value, onChange, multiline, maxLength, placeholder, hint, required, requiredLabel, mono, rows, disabled }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const missing = !!required && value.trim() === '';
  const common = {
    id, value, maxLength, placeholder, disabled,
    'aria-invalid': missing || undefined,
    'aria-describedby': hint || missing ? hintId : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">{label}</Label>
      {multiline
        ? <Textarea {...common} rows={rows ?? 3} spellCheck={!mono} className={cn('min-h-0 resize-y text-sm', mono && 'font-mono text-xs')} />
        : <Input {...common} className="h-8 text-sm" />}
      {(hint || missing) && <p id={hintId} className={cn('text-xs', missing ? 'text-destructive' : 'text-muted-foreground')}>{missing ? requiredLabel : hint}</p>}
    </div>
  );
}

/** A titled group inside the inspector. */
export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Small icon-only button with a required accessible label. */
export function IconAction({ label, onClick, disabled, children, destructive }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; destructive?: boolean }) {
  return (
    <Button type="button" variant="ghost" size="icon-xs" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className={cn('shrink-0', destructive && 'text-muted-foreground hover:text-destructive')}>
      {children}
    </Button>
  );
}

/** A segmented single-choice control (radiogroup). */
export function Segmented<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-0.5 rounded-md border p-0.5" role="radiogroup" aria-label={label}>
        {options.map(option => (
          <Button key={option.value} type="button" size="xs" variant={value === option.value ? 'secondary' : 'ghost'} role="radio" aria-checked={value === option.value}
            disabled={disabled} onClick={() => onChange(option.value)} className="flex-1">
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
