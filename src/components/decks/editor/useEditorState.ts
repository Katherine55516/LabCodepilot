'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyCard } from '@/lib/decks/blocks';
import type { Block, BlockType, Card, Deck, DeckResponse, HeaderFooter } from '@/lib/decks/types';
import { useDecksT } from '../i18n';
import { defaultBlock } from './block-defaults';
import type { BlockAction } from './BlockToolbar';
import {
  cloneCard, duplicateBlock, findBlock, insertBlock, moveItem, moveItemTo, removeBlock, replaceBlock, shiftBlock, topLevelId,
} from './card-ops';
import type { CardAction } from './Filmstrip';
import type { AiScopeKind } from './types';
import { useDeckSaver, type DeckPatch } from './useDeckSaver';

/** The locally edited copy of the deck; re-synced from the server when it changes and nothing is unsaved. */
interface Draft { syncKey: string; version: number; title: string; themeId: string; headerFooter: HeaderFooter; cards: Card[] }

const syncKeyOf = (deck: Deck) => `${deck.version}:${deck.updatedAt}`;
const draftOf = (deck: Deck): Draft => ({
  syncKey: syncKeyOf(deck), version: deck.version, title: deck.title, themeId: deck.settings.themeId, headerFooter: deck.headerFooter ?? {}, cards: deck.cards,
});

export function useEditorState(deckId: string, data: DeckResponse, setData: (d: DeckResponse) => void) {
  const t = useDecksT();
  const deck = data.deck;
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);
  const onSaved = useCallback((saved: Deck) => {
    const next = { ...dataRef.current, deck: saved };
    dataRef.current = next;
    setData(next);
  }, [setData]);
  const saver = useDeckSaver(deckId, deck.version, onSaved);

  const [draft, setDraft] = useState<Draft>(() => draftOf(deck));
  // Adopt server changes (saves, AI edits, restores, accent images) unless local edits are unsaved.
  // A live snapshot older than what we already show (it can arrive after our own save) is ignored.
  if (draft.syncKey !== syncKeyOf(deck) && deck.version >= draft.version && !saver.dirty) setDraft(draftOf(deck));

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [scopeKind, setScopeKind] = useState<AiScopeKind>('card');

  const cards = draft.cards;
  const cardIndex = Math.max(0, cards.findIndex(c => c.id === selectedCardId));
  const card: Card | undefined = cards[cardIndex];
  const selectedBlock = card && selectedBlockId ? findBlock(card.blocks, selectedBlockId) : undefined;

  const commit = (patch: Partial<Draft>, save: DeckPatch, immediate = false) => {
    setDraft(d => ({ ...d, ...patch }));
    saver.queue(save, immediate);
  };
  const setCards = (next: Card[]) => commit({ cards: next }, { cards: next });
  const updateCard = (id: string, fn: (c: Card) => Card) => setCards(cards.map(c => (c.id === id ? fn(c) : c)));
  const updateBlocks = (fn: (blocks: Block[]) => Block[]) => { if (card) updateCard(card.id, c => ({ ...c, blocks: fn(c.blocks) })); };

  const selectCard = (id: string | null) => { setSelectedCardId(id); setSelectedBlockId(null); setScopeKind(k => (k === 'block' ? 'card' : k)); };
  const selectBlock = (id: string | null) => {
    setSelectedBlockId(id);
    setScopeKind(k => (id ? (k === 'deck' ? k : 'block') : k === 'block' ? 'card' : k));
  };
  const goToCard = (delta: number) => { const next = cards[cardIndex + delta]; if (next) selectCard(next.id); };

  const addCard = () => {
    const created = emptyCard([defaultBlock('heading', t)]);
    setCards([...cards.slice(0, cardIndex + 1), created, ...cards.slice(cardIndex + 1)]);
    selectCard(created.id);
  };

  const cardAction = (id: string, action: CardAction) => {
    const index = cards.findIndex(c => c.id === id);
    if (index < 0) return;
    if (action === 'up' || action === 'down') setCards(moveItem(cards, index, action === 'up' ? -1 : 1));
    else if (action === 'toggleHidden') updateCard(id, c => ({ ...c, hidden: !c.hidden }));
    else if (action === 'duplicate') {
      const copy = cloneCard(cards[index]);
      setCards([...cards.slice(0, index + 1), copy, ...cards.slice(index + 1)]);
      selectCard(copy.id);
    } else {
      const next = cards.filter(c => c.id !== id);
      setCards(next);
      if (id === card?.id) selectCard(next[Math.min(index, next.length - 1)]?.id ?? null);
    }
  };
  const moveCard = (from: number, to: number) => setCards(moveItemTo(cards, from, to));

  const changeBlock = (id: string, next: Block) => updateBlocks(blocks => replaceBlock(blocks, id, next));

  const insert = (type: BlockType) => {
    if (!card) return;
    const block = defaultBlock(type, t);
    // Columns cannot nest, so they go after the top-level block holding the selection.
    const after = selectedBlockId && type === 'columns' ? topLevelId(card.blocks, selectedBlockId) : selectedBlockId;
    updateBlocks(blocks => insertBlock(blocks, block, after));
    selectBlock(block.id);
  };

  /** Replaces the selected card in one immediate save (suggested layouts), so History has one version for it. */
  const applyCard = (next: Card) => {
    const updated = cards.map(c => (c.id === next.id ? next : c));
    commit({ cards: updated }, { cards: updated }, true);
    if (selectedBlockId && !findBlock(next.blocks, selectedBlockId)) selectBlock(null);
  };

  /** Block toolbar actions other than "ask AI" and "edit", which the editor routes to the side panel. */
  const blockAction = (action: Exclude<BlockAction, 'askAi' | 'inspect'>) => {
    if (!card || !selectedBlock) return;
    const id = selectedBlock.id;
    if (action === 'up' || action === 'down') updateBlocks(blocks => shiftBlock(blocks, id, action === 'up' ? -1 : 1));
    else if (action === 'duplicate') {
      const result = duplicateBlock(card.blocks, id);
      updateBlocks(() => result.blocks);
      if (result.newId) setSelectedBlockId(result.newId);
    } else if (action === 'delete') {
      updateBlocks(blocks => removeBlock(blocks, id));
      selectBlock(null);
    } else selectBlock(null);
  };

  return {
    deck, saver, draft, cards, card, cardIndex, selectedBlock, scopeKind, setScopeKind,
    selectCard, selectBlock, goToCard, addCard, cardAction, moveCard, changeBlock, insert, blockAction, applyCard,
    setLayout: (layout: Card['layout']) => card && updateCard(card.id, c => ({ ...c, layout })),
    setCardFields: (patch: Partial<Pick<Card, 'notes' | 'hidden'>>) => card && updateCard(card.id, c => ({ ...c, ...patch })),
    setTitle: (title: string) => commit({ title }, { title }),
    setTheme: (themeId: string) => commit({ themeId }, { settings: { themeId } }, true),
    setHeaderFooter: (headerFooter: HeaderFooter) => commit({ headerFooter }, { headerFooter }, true),
    /** Conflict recovery: drop local edits and show the server copy (refresh brings anything newer). */
    discardLocal: () => { saver.reset(); setDraft(draftOf(dataRef.current.deck)); },
    dataRef,
  };
}
