import { cn } from "@/lib/utils";

/**
 * MultiplierBadge — the model cost multiplier chip shown after a model name in
 * every model picker (办公 / 研发 composer, 定时任务 form).
 *
 * Exists as a shared component so the three pickers cannot drift apart: the
 * multiplier is a spend signal, and the same model must read identically
 * wherever the user meets it.
 *
 * Pure presentation, per the patterns/ contract — it takes an already
 * formatted label and renders nothing for null. Call sites pass
 * `formatMultiplier(value)`; that helper owns both the format and the
 * "unknown stays unknown" rule (a default like 1.0x would state a cost the
 * backend never sent). See src/lib/model-multiplier.ts.
 *
 * Colours come from the --status-success token family (same as the success
 * toast, see src/components/ui/toast.tsx) — except the dark-mode text, which
 * has to override the token: --status-success-foreground sits at L≈38 against
 * the L≈26 dropdown surface, about 1.7:1, unreadable at 10px. emerald-400
 * lands near 5:1 and matches how the rest of the app writes success text in
 * dark mode. Fixing the token itself would move every other consumer (toast,
 * status cards, CLI settings) whose backgrounds differ, so the override stays
 * local.
 */
export function MultiplierBadge({
  label,
  className,
}: {
  /** Pre-formatted label (e.g. "1.4x"); null renders nothing. */
  label: string | null;
  className?: string;
}) {
  if (!label) return null;

  return (
    <span
      className={cn(
        "shrink-0 rounded border px-1 py-0 text-[10px] font-medium tabular-nums",
        "border-status-success-border bg-status-success-muted",
        "text-status-success-foreground dark:text-emerald-400", // lint-allow-raw-color
        className,
      )}
    >
      {label}
    </span>
  );
}
