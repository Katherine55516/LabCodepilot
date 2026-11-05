'use client';

import { useParams } from 'next/navigation';
import { PrintView } from '@/components/decks/editor/PrintView';

/** Print layout ("Save as PDF") for a deck: one card per page. */
export default function DeckPrintPage() {
  const { id } = useParams<{ id: string }>();
  return <PrintView deckId={id} />;
}
