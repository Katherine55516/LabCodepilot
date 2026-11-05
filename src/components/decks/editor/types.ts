import type { DeckResponse, MediaItem } from '@/lib/decks/types';

/** What a server action hands back to merge into the live DeckResponse. */
export type ActionResult = void | (Partial<Pick<DeckResponse, 'deck' | 'job' | 'proposals'>> & { media?: MediaItem });

/**
 * Runs a server action after flushing pending saves (so the server sees the
 * canvas), tracks it under `key` for spinners and reports errors in the
 * editor banner. Resolves true on success.
 */
export type RunAction = (key: string, fn: () => Promise<ActionResult>) => Promise<boolean>;

export type PanelTab = 'layout' | 'card' | 'ai';
export type AiScopeKind = 'deck' | 'card' | 'block';
