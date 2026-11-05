'use client';

import { ArrowDown, ArrowUp, Copy, Sliders, Sparkle, Trash, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import type { Block } from '@/lib/decks/types';
import { useDecksT, type DecksStringKey } from '../i18n';
import { blockSnippet } from './card-ops';
import { BLOCK_ICONS } from './InsertBlockMenu';
import { isInspectable } from './inspector/BlockInspector';

export type BlockAction = 'up' | 'down' | 'duplicate' | 'delete' | 'askAi' | 'inspect' | 'deselect';

interface BlockToolbarProps {
  block: Block;
  onAction: (action: BlockAction) => void;
  onChange: (next: Block) => void;
}

/** Toolbar for the selected block: label, heading level, edit in the Block tab, move, duplicate, delete, ask AI. */
export function BlockToolbar({ block, onAction, onChange }: BlockToolbarProps) {
  const t = useDecksT();
  const IconComponent = BLOCK_ICONS[block.type];
  const snippet = blockSnippet(block, 24);
  const icon = (action: BlockAction, label: string, node: React.ReactNode, destructive = false) => (
    <Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={() => onAction(action)} className={destructive ? 'text-destructive hover:text-destructive' : undefined}>
      {node}
    </Button>
  );
  return (
    <div role="toolbar" aria-label={t('decks.editor.blockToolbar')} className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-lg border bg-popover px-1.5 py-1 shadow-sm">
      <span className="flex min-w-0 items-center gap-1.5 px-1.5 text-xs text-muted-foreground">
        <IconComponent size={14} className="shrink-0" />
        <span className="font-medium text-foreground">{t(`decks.editor.block.${block.type}` as DecksStringKey)}</span>
        {snippet && <span className="hidden max-w-[16ch] truncate sm:inline">· {snippet}</span>}
      </span>
      {block.type === 'heading' && (
        <div className="mx-1 flex items-center rounded-md border p-0.5" role="group" aria-label={t('decks.editor.headingLevel')}>
          {([1, 2, 3] as const).map(level => (
            <Button key={level} size="xs" variant={block.level === level ? 'secondary' : 'ghost'} aria-pressed={block.level === level}
              onClick={() => onChange({ ...block, level })} className="h-5 px-1.5">H{level}</Button>
          ))}
        </div>
      )}
      {isInspectable(block) && icon('inspect', t('decks.editor.inspector.open'), <Sliders size={16} />)}
      {icon('up', t('decks.editor.moveUp'), <ArrowUp size={16} />)}
      {icon('down', t('decks.editor.moveDown'), <ArrowDown size={16} />)}
      {icon('duplicate', t('decks.editor.duplicate'), <Copy size={16} />)}
      {icon('delete', t('decks.editor.deleteBlock'), <Trash size={16} />, true)}
      <Button variant="ghost" size="sm" onClick={() => onAction('askAi')} className="text-primary" aria-label={t('decks.editor.askAiBlock')}>
        <Sparkle size={16} /><span className="hidden sm:inline">{t('decks.editor.askAiBlock')}</span>
      </Button>
      {icon('deselect', t('decks.editor.deselect'), <X size={14} />)}
    </div>
  );
}
