'use client';

import { useParams } from 'next/navigation';
import { PresentView } from '@/components/decks/editor/PresentView';

/** Fullscreen present mode for a deck. */
export default function DeckPresentPage() {
  const { id } = useParams<{ id: string }>();
  return <PresentView deckId={id} />;
}
