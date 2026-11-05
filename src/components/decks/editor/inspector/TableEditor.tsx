'use client';

import { Plus, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDecksT } from '../../i18n';
import {
  TABLE_LIMITS, addTableColumn, addTableRow, removeTableColumn, removeTableRow, setTableCell, setTableHeader, type TableBlock,
} from './block-edit';
import { IconAction, Section } from './fields';

const cellClass = 'h-8 min-w-28 text-sm';

/** Header and cells as a grid of inputs; add/remove rows and columns (report 06 §4: native, editable tables). */
export function TableEditor({ block, onChange, disabled }: { block: TableBlock; onChange: (next: TableBlock) => void; disabled?: boolean }) {
  const t = useDecksT();
  const cols = block.header.length;
  return (
    <Section title={t('decks.editor.block.table')}>
      <div className="overflow-x-auto rounded-md border">
        <table className="border-separate border-spacing-1 text-left">
          <thead>
            <tr>
              {block.header.map((cell, c) => (
                <th key={c} scope="col" className="align-bottom font-normal">
                  <div className="flex items-center justify-end">
                    <IconAction label={t('decks.editor.inspector.removeColumn', { n: c + 1 })} disabled={disabled || cols <= 1} onClick={() => onChange(removeTableColumn(block, c))} destructive>
                      <Trash size={12} />
                    </IconAction>
                  </div>
                  <Input value={cell} disabled={disabled} maxLength={800} aria-label={t('decks.editor.inspector.headerCell', { n: c + 1 })}
                    onChange={e => onChange(setTableHeader(block, c, e.target.value))} className={`${cellClass} font-semibold`} />
                </th>
              ))}
              <th aria-hidden />
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>
                    <Input value={cell} disabled={disabled} maxLength={800} aria-label={t('decks.editor.inspector.cell', { r: r + 1, c: c + 1 })}
                      onChange={e => onChange(setTableCell(block, r, c, e.target.value))} className={cellClass} />
                  </td>
                ))}
                <td>
                  <IconAction label={t('decks.editor.inspector.removeRow', { n: r + 1 })} disabled={disabled || block.rows.length <= 1} onClick={() => onChange(removeTableRow(block, r))} destructive>
                    <Trash size={12} />
                  </IconAction>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled || block.rows.length >= TABLE_LIMITS.rows} onClick={() => onChange(addTableRow(block))}>
          <Plus size={14} />{t('decks.editor.inspector.addRow')}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || cols >= TABLE_LIMITS.cols}
          onClick={() => onChange(addTableColumn(block, t('decks.editor.default.column', { n: cols + 1 })))}>
          <Plus size={14} />{t('decks.editor.inspector.addColumn')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('decks.editor.inspector.tableLimits', { rows: TABLE_LIMITS.rows, cols: TABLE_LIMITS.cols })}</p>
    </Section>
  );
}
