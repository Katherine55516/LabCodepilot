'use client';

import { useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useDecksT } from '../../i18n';
import {
  CHART_LIMITS, addChartLabel, addChartSeries, chartDraft, chartFromDraft, invalidCells, removeChartLabel, removeChartSeries,
  sameChartData, setAt, type ChartBlock, type ChartDraft,
} from './block-edit';
import { IconAction, Section, Segmented, TextField } from './fields';

const CHART_TYPES: ChartBlock['chartType'][] = ['bar', 'line', 'pie'];

/**
 * Chart type, unit, labels, series names and values. Values are edited as
 * text and only reach the card once every cell is a number, so a half-typed
 * value never renders (or exports) as NaN.
 */
export function ChartEditor({ block, onChange, disabled }: { block: ChartBlock; onChange: (next: ChartBlock) => void; disabled?: boolean }) {
  const t = useDecksT();
  const [draft, setDraft] = useState<ChartDraft>(() => chartDraft(block));
  const [seen, setSeen] = useState(block);
  // Adopt outside changes (AI edits, restores); our own commits already match the draft.
  if (seen !== block) {
    setSeen(block);
    if (!sameChartData(draft, block)) setDraft(chartDraft(block));
  }
  const invalid = invalidCells(draft);
  const anyInvalid = invalid.some(row => row.some(Boolean));
  const pie = block.chartType === 'pie';

  const update = (next: ChartDraft) => {
    setDraft(next);
    const data = chartFromDraft(next);
    if (data) onChange({ ...block, ...data });
  };
  const setValue = (s: number, i: number, value: string) =>
    update({ ...draft, series: draft.series.map((series, j) => (j === s ? { ...series, values: setAt(series.values, i, value) } : series)) });

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label={t('decks.editor.inspector.chartType')}
        value={block.chartType}
        disabled={disabled}
        options={CHART_TYPES.map(type => ({ value: type, label: t(`decks.editor.inspector.chart.${type}`) }))}
        onChange={chartType => onChange({ ...block, chartType })}
      />
      <TextField label={t('decks.editor.inspector.unit')} value={block.unit ?? ''} maxLength={20} placeholder={t('decks.editor.inspector.unitPlaceholder')} disabled={disabled}
        onChange={unit => { const next: ChartBlock = { ...block, unit }; if (!unit) delete next.unit; onChange(next); }} />
      <Section title={t('decks.editor.inspector.chartData')}>
        <div className="overflow-x-auto rounded-md border">
          <table className="border-separate border-spacing-1 text-left">
            <thead>
              <tr>
                <th scope="col" className="px-1 align-bottom text-xs font-normal text-muted-foreground">{t('decks.editor.inspector.chartLabel')}</th>
                {draft.series.map((series, s) => (
                  <th key={s} scope="col" className={cn('align-bottom font-normal', pie && s > 0 && 'opacity-50')}>
                    <div className="flex items-center gap-0.5">
                      <Input value={series.name} disabled={disabled} maxLength={80} aria-label={t('decks.editor.inspector.seriesName', { n: s + 1 })}
                        onChange={e => update({ ...draft, series: setAt(draft.series, s, { ...series, name: e.target.value }) })} className="h-8 min-w-24 text-sm font-medium" />
                      <IconAction label={t('decks.editor.inspector.removeSeries', { n: s + 1 })} disabled={disabled || draft.series.length <= 1}
                        onClick={() => update(removeChartSeries(draft, s))} destructive><Trash size={12} /></IconAction>
                    </div>
                  </th>
                ))}
                <th aria-hidden />
              </tr>
            </thead>
            <tbody>
              {draft.labels.map((label, i) => (
                <tr key={i}>
                  <td>
                    <Input value={label} disabled={disabled} maxLength={80} aria-label={t('decks.editor.inspector.chartLabelN', { n: i + 1 })}
                      onChange={e => update({ ...draft, labels: setAt(draft.labels, i, e.target.value) })} className="h-8 min-w-24 text-sm" />
                  </td>
                  {draft.series.map((series, s) => (
                    <td key={s} className={cn(pie && s > 0 && 'opacity-50')}>
                      <Input value={series.values[i] ?? ''} disabled={disabled} inputMode="decimal" aria-invalid={invalid[s]?.[i] || undefined}
                        aria-label={t('decks.editor.inspector.value', { series: series.name || t('decks.editor.inspector.seriesName', { n: s + 1 }), label: label || t('decks.editor.inspector.chartLabelN', { n: i + 1 }) })}
                        onChange={e => setValue(s, i, e.target.value)} className="h-8 w-24 text-right text-sm tabular-nums" />
                    </td>
                  ))}
                  <td>
                    <IconAction label={t('decks.editor.inspector.removeLabel', { n: i + 1 })} disabled={disabled || draft.labels.length <= CHART_LIMITS.minLabels}
                      onClick={() => update(removeChartLabel(draft, i))} destructive><Trash size={12} /></IconAction>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {anyInvalid && <p role="alert" className="text-xs text-destructive">{t('decks.editor.inspector.invalidNumber')}</p>}
        {pie && draft.series.length > 1 && <p className="text-xs text-muted-foreground">{t('decks.editor.inspector.pieNote')}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={disabled || draft.labels.length >= CHART_LIMITS.maxLabels}
            onClick={() => update(addChartLabel(draft, t('decks.editor.inspector.chartLabelN', { n: draft.labels.length + 1 })))}>
            <Plus size={14} />{t('decks.editor.inspector.addLabel')}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={disabled || pie || draft.series.length >= CHART_LIMITS.maxSeries}
            onClick={() => update(addChartSeries(draft, t('decks.editor.inspector.seriesDefault', { n: draft.series.length + 1 })))}>
            <Plus size={14} />{t('decks.editor.inspector.addSeries')}
          </Button>
        </div>
      </Section>
    </div>
  );
}
