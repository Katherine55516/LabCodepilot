import { respond } from '@/lib/decks/http';
import { DECK_THEMES } from '@/lib/decks/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() { return respond(() => ({ themes: DECK_THEMES })); }
