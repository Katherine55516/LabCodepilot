'use client';

import {
  ChartBar, Code, Columns, GridFour, ListBullets, ListNumbers, Image as ImageIcon, Info, Minus, Plus, Quotes,
  SquaresFour, Table, TextAa, TextH, Path, Footprints, type Icon,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { BlockType } from '@/lib/decks/types';
import { useDecksT, type DecksStringKey } from '../i18n';
import { BLOCK_GROUPS } from './block-defaults';

export const BLOCK_ICONS: Record<BlockType, Icon> = {
  heading: TextH, paragraph: TextAa, bullets: ListBullets, numbered: ListNumbers, image: ImageIcon, table: Table,
  chart: ChartBar, callout: Info, quote: Quotes, code: Code, timeline: Path, steps: Footprints, metrics: SquaresFour,
  grid: GridFour, columns: Columns, divider: Minus, templateDiagram: GridFour,
};

export function InsertBlockMenu({ onInsert, disabled }: { onInsert: (type: BlockType) => void; disabled?: boolean }) {
  const t = useDecksT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Plus size={16} />{t('decks.editor.insertBlock')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-56 overflow-y-auto">
        {BLOCK_GROUPS.map((group, gi) => (
          <DropdownMenuGroup key={group.group}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t(`decks.editor.blockGroup.${group.group}` as DecksStringKey)}</DropdownMenuLabel>
            {group.types.map(type => {
              const IconComponent = BLOCK_ICONS[type];
              return (
                <DropdownMenuItem key={type} onSelect={() => onInsert(type)}>
                  <IconComponent size={16} />{t(`decks.editor.block.${type}` as DecksStringKey)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
