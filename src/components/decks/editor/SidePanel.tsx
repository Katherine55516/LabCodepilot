'use client';

import { Layout, NotePencil, Sparkle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useDecksT } from '../i18n';
import type { PanelTab } from './types';

interface SidePanelProps {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  content: Record<PanelTab, React.ReactNode>;
  mobile: boolean;
  /** Mobile only: whether the bottom sheet is open. */
  sheetOpen: boolean;
  onSheetOpen: (open: boolean) => void;
}

const TABS: { id: PanelTab; icon: React.ReactNode }[] = [
  { id: 'layout', icon: <Layout size={16} /> },
  { id: 'card', icon: <NotePencil size={16} /> },
  { id: 'ai', icon: <Sparkle size={16} /> },
];

/** Right-hand panel on desktop; a tab bar + bottom sheet on phones. */
export function SidePanel({ tab, onTab, content, mobile, sheetOpen, onSheetOpen }: SidePanelProps) {
  const t = useDecksT();
  const label = (id: PanelTab) => t(id === 'layout' ? 'decks.editor.tab.layout' : id === 'card' ? 'decks.editor.tab.card' : 'decks.editor.tab.ai');

  if (mobile) {
    return (
      <>
        <nav className="grid shrink-0 grid-cols-3 border-t bg-background p-1" aria-label={t('decks.editor.panel')}>
          {TABS.map(item => (
            <Button key={item.id} variant="ghost" size="sm" className={cn(tab === item.id && sheetOpen && 'bg-accent')}
              onClick={() => { onTab(item.id); onSheetOpen(true); }}>
              {item.icon}{label(item.id)}
            </Button>
          ))}
        </nav>
        <Sheet open={sheetOpen} onOpenChange={onSheetOpen}>
          <SheetContent side="bottom" className="max-h-[78vh] gap-2 rounded-t-xl">
            <SheetHeader className="pb-0">
              <SheetTitle>{label(tab)}</SheetTitle>
              <SheetDescription className="sr-only">{t('decks.editor.panel')}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 overflow-y-auto px-4 pb-6">{content[tab]}</div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l bg-background" aria-label={t('decks.editor.panel')}>
      <Tabs value={tab} onValueChange={v => onTab(v as PanelTab)} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="border-b px-3 py-2">
          <TabsList className="w-full">
            {TABS.map(item => <TabsTrigger key={item.id} value={item.id}>{item.icon}{label(item.id)}</TabsTrigger>)}
          </TabsList>
        </div>
        {/* forceMount keeps the AI draft and job tracking alive across tab switches. */}
        {TABS.map(item => (
          <TabsContent key={item.id} value={item.id} forceMount className="min-h-0 overflow-y-auto p-4 data-[state=inactive]:hidden">{content[item.id]}</TabsContent>
        ))}
      </Tabs>
    </aside>
  );
}
