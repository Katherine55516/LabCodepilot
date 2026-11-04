'use client';

import { useCallback, useRef, useState } from 'react';
import { Terminal, NotePencil, Brain, GlobeSimple, Lightning, Folder, File } from '@/components/ui/icon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { PopoverItem, PopoverMode } from '@/types';
import {
  CommandList,
  CommandListSearch,
  CommandListItems,
  CommandListItem,
  CommandListGroup,
  CommandListFooter,
  CommandListFooterAction,
} from '@/components/patterns';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export type { PopoverItem, PopoverMode } from '@/types';

interface SlashCommandPopoverProps {
  popoverMode: PopoverMode;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  filteredItems: PopoverItem[];
  aiSuggestions: PopoverItem[];
  aiSearchLoading: boolean;
  selectedIndex: number;
  popoverFilter: string;
  inputValue: string;
  triggerPos: number | null;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  allDisplayedItems: PopoverItem[];
  onInsertItem: (item: PopoverItem) => void;
  onSetSelectedIndex: (index: number) => void;
  onSetPopoverFilter: (filter: string) => void;
  onSetInputValue: (value: string) => void;
  onClosePopover: () => void;
  onFocusTextarea: () => void;
}

/**
 * 描述文字:仅当被 truncate 截断(scrollWidth > clientWidth)时,hover 才弹出
 * 完整文字的 tooltip;短文字已完整展示则不触发。鼠标移开自动消失。
 * 复用全局 TooltipProvider(AppShell,delayDuration=300)。
 */
function OverflowTooltip({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setOpen(false);
          return;
        }
        // 仅在文字确实被截断时才允许弹出(+1 容错亚像素差)。
        const el = ref.current;
        setOpen(!!el && el.scrollWidth > el.clientWidth + 1);
      }}
    >
      <TooltipTrigger asChild>
        <span ref={ref} className={className}>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-sm break-words">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export function SlashCommandPopover({
  popoverMode,
  popoverRef,
  filteredItems,
  aiSuggestions,
  aiSearchLoading,
  selectedIndex,
  popoverFilter,
  inputValue,
  triggerPos,
  searchInputRef,
  allDisplayedItems,
  onInsertItem,
  onSetSelectedIndex,
  onSetPopoverFilter,
  onSetInputValue,
  onClosePopover,
  onFocusTextarea,
}: SlashCommandPopoverProps) {
  const { t } = useTranslation();

  const builtInItems = filteredItems.filter(item => item.builtIn);
  const slashCommandItems = filteredItems.filter(item => !item.builtIn && item.kind !== 'agent_skill');
  const agentSkillItems = filteredItems.filter(item => !item.builtIn && item.kind === 'agent_skill');
  let globalIdx = 0;

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onSetSelectedIndex((selectedIndex + 1) % allDisplayedItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onSetSelectedIndex((selectedIndex - 1 + allDisplayedItems.length) % allDisplayedItems.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (allDisplayedItems[selectedIndex]) {
        onInsertItem(allDisplayedItems[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClosePopover();
      onFocusTextarea();
    }
  }, [selectedIndex, allDisplayedItems, onSetSelectedIndex, onInsertItem, onClosePopover, onFocusTextarea]);

  const handleFilterChange = useCallback((val: string) => {
    onSetPopoverFilter(val);
    onSetSelectedIndex(0);
    // Sync textarea: replace the filter portion after /
    if (triggerPos !== null) {
      const before = inputValue.slice(0, triggerPos + 1);
      onSetInputValue(before + val);
    }
  }, [triggerPos, inputValue, onSetPopoverFilter, onSetSelectedIndex, onSetInputValue]);

  const renderItem = (item: PopoverItem, idx: number) => (
    <CommandListItem
      key={`${idx}-${item.value}`}
      active={idx === selectedIndex}
      itemRef={idx === selectedIndex ? (el) => { el?.scrollIntoView({ block: 'nearest' }); } : undefined}
      onClick={() => onInsertItem(item)}
      onMouseEnter={() => onSetSelectedIndex(idx)}
    >
      {popoverMode === 'file' ? (
        item.nodeType === 'directory'
          ? <Folder size={16} className="shrink-0 text-muted-foreground" />
          : <File size={16} className="shrink-0 text-muted-foreground" />
      ) : item.builtIn && item.icon ? (
        (() => { const ItemIcon = item.icon; return <ItemIcon size={16} className="shrink-0 text-muted-foreground" />; })()
      ) : item.kind === 'agent_skill' ? (
        <Brain size={16} className="shrink-0 text-muted-foreground" />
      ) : item.kind === 'slash_command' ? (
        <NotePencil size={16} className="shrink-0 text-muted-foreground" />
      ) : !item.builtIn ? (
        <GlobeSimple size={16} className="shrink-0 text-muted-foreground" />
      ) : (
        <Terminal size={16} className="shrink-0 text-muted-foreground" />
      )}
      <span className="font-mono text-xs shrink-0">{item.display || item.label}</span>
      {(item.descriptionKey || item.description) && (
        // Description fills the remaining row width (flex-1 min-w-0) and only
        // ellipsizes at the row edge — no fixed 200px cap. When it overflows,
        // hovering reveals the full text in a tooltip (short, fully-shown
        // descriptions don't trigger it). Localization fallback chain: built-in
        // descriptionKey (already localized) → raw English frontmatter for
        // external/plugin commands.
        <OverflowTooltip
          text={(item.descriptionKey ? t(item.descriptionKey) : item.description) ?? ''}
          className="text-xs text-muted-foreground truncate flex-1 min-w-0"
        />
      )}
      {!item.builtIn && item.installedSource && (
        <span className="text-xs text-muted-foreground shrink-0 ml-auto">
          {item.installedSource === 'claude' ? 'Personal' : 'Agents'}
        </span>
      )}
    </CommandListItem>
  );

  if (!popoverMode || popoverMode === 'cli') return null;
  if (allDisplayedItems.length === 0 && !aiSearchLoading) return null;

  return (
    <div ref={popoverRef}>
      <CommandList className="w-full max-w-2xl">
        <CommandListSearch
          inputRef={searchInputRef}
          placeholder={popoverMode === 'file'
            ? t('composer.searchFiles' as TranslationKey)
            : undefined}
          value={popoverFilter}
          onChange={handleFilterChange}
          onKeyDown={handleSearchKeyDown}
        />
        <CommandListItems className="max-h-48">
          {popoverMode === 'file' ? (
            <CommandListGroup label={t('globalSearch.files' as TranslationKey)}>
              {filteredItems.map((item, i) => renderItem(item, i))}
            </CommandListGroup>
          ) : (
            <>
              {builtInItems.length > 0 && (
                <CommandListGroup label="Commands">
                  {builtInItems.map((item) => {
                    const idx = globalIdx++;
                    return renderItem(item, idx);
                  })}
                </CommandListGroup>
              )}
              {slashCommandItems.length > 0 && (
                <CommandListGroup label="Slash Commands">
                  {slashCommandItems.map((item) => {
                    const idx = globalIdx++;
                    return renderItem(item, idx);
                  })}
                </CommandListGroup>
              )}
              {agentSkillItems.length > 0 && (
                <CommandListGroup label="Agent Skills">
                  {agentSkillItems.map((item) => {
                    const idx = globalIdx++;
                    return renderItem(item, idx);
                  })}
                </CommandListGroup>
              )}
              {/* AI Suggested section */}
              {(aiSuggestions.length > 0 || aiSearchLoading) && (
                <CommandListGroup>
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Brain size={14} />
                    {t('messageInput.aiSuggested')}
                    {aiSearchLoading && (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    )}
                  </div>
                  {aiSuggestions.map((item) => {
                    const idx = globalIdx++;
                    return renderItem(item, idx);
                  })}
                </CommandListGroup>
              )}
            </>
          )}
        </CommandListItems>
        {/* Footer: manage skills (skill mode only) */}
        {popoverMode === 'skill' && (
          <CommandListFooter>
            <CommandListFooterAction onClick={() => { onClosePopover(); window.location.href = '/skills'; }}>
              <Lightning size={14} />
              {t('composer.manageSkills' as TranslationKey)}
            </CommandListFooterAction>
          </CommandListFooter>
        )}
      </CommandList>
    </div>
  );
}
