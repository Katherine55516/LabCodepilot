import fs from 'fs';
import os from 'os';
import path from 'path';
import { getCurrentUserUid, getDb } from '../db';
import { newId } from './blocks';
import type {
  Card, CardStage, Deck, DeckJob, DeckSummary, DeckVersion, EditProposal, JobKind, JobProgress, JobStatus, MediaItem, MediaOrigin,
  QueuedInstruction,
} from './types';

/**
 * Persistence for Decks. A deck is stored as one JSON document (like a Gamma
 * "file"); every saved change bumps `version` and snapshots the previous state
 * into deck_versions so any version can be restored (report 06: grouped
 * accept/restore). Decks are scoped to the signed-in account when there is
 * one; local dev (no login) uses the '' account.
 */

const KEEP_VERSIONS = 50;
const now = () => new Date().toISOString();
const uid = () => getCurrentUserUid() || '';

export class DeckConflictError extends Error {
  constructor(public currentVersion: number) { super(`The deck changed (now version ${currentVersion}); reload before saving.`); }
}

interface DeckRow { id: string; uid: string; title: string; status: string; doc: string; version: number; created_at: string; updated_at: string }

function hydrate(row: DeckRow): Deck {
  const doc = JSON.parse(row.doc) as Deck;
  return { ...doc, id: row.id, title: row.title, status: row.status as Deck['status'], version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function insertDeck(deck: Omit<Deck, 'id' | 'version' | 'createdAt' | 'updatedAt'> & { id?: string }): Deck {
  const id = deck.id || newId('deck');
  const at = now();
  const full: Deck = { ...deck, id, version: 1, createdAt: at, updatedAt: at };
  getDb().prepare('INSERT INTO decks (id, uid, title, status, doc, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .run(id, uid(), full.title, full.status, JSON.stringify(full), at, at);
  return full;
}

export function getDeck(id: string): Deck | null {
  const row = getDb().prepare('SELECT * FROM decks WHERE id = ? AND uid = ? AND deleted_at IS NULL').get(id, uid()) as DeckRow | undefined;
  return row ? hydrate(row) : null;
}

export function listDecks(): DeckSummary[] {
  const rows = getDb().prepare('SELECT * FROM decks WHERE uid = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500').all(uid()) as DeckRow[];
  return rows.map(hydrate).map(deck => ({
    id: deck.id, title: deck.title, status: deck.status, themeId: deck.settings.themeId, dimensions: deck.settings.dimensions,
    cardCount: deck.cards.length || deck.outline.length, firstCard: deck.cards[0], createdAt: deck.createdAt, updatedAt: deck.updatedAt,
  }));
}

/**
 * Applies `mutate` to the latest deck inside one transaction. With
 * `baseVersion`, a stale base throws DeckConflictError. `reason` records a
 * restorable version snapshot of the state *before* the change.
 */
export function updateDeck(id: string, mutate: (deck: Deck) => Deck | void, opts: { baseVersion?: number; reason?: string } = {}): Deck {
  const db = getDb();
  return db.transaction(() => {
    const current = getDeck(id);
    if (!current) throw new Error('Deck not found');
    if (opts.baseVersion !== undefined && opts.baseVersion !== current.version) throw new DeckConflictError(current.version);
    const draft = structuredClone(current);
    const next = mutate(draft) || draft;
    const at = now();
    const version = current.version + 1;
    const saved: Deck = { ...next, id, version, createdAt: current.createdAt, updatedAt: at };
    if (opts.reason) {
      db.prepare('INSERT OR REPLACE INTO deck_versions (deck_id, version, reason, doc, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, current.version, opts.reason, JSON.stringify(current), at);
      db.prepare('DELETE FROM deck_versions WHERE deck_id = ? AND version <= ?').run(id, current.version - KEEP_VERSIONS);
    }
    db.prepare('UPDATE decks SET title = ?, status = ?, doc = ?, version = ?, updated_at = ? WHERE id = ?')
      .run(saved.title, saved.status, JSON.stringify(saved), version, at, id);
    return saved;
  })();
}

/** Card-level patch used by the builder: merges one card without a version snapshot. */
export function patchCard(deckId: string, cardId: string, patch: Partial<Card>): Deck {
  return updateDeck(deckId, deck => {
    deck.cards = deck.cards.map(card => (card.id === cardId ? { ...card, ...patch } : card));
  });
}

export function softDeleteDeck(id: string): boolean {
  const result = getDb().prepare('UPDATE decks SET deleted_at = ? WHERE id = ? AND uid = ? AND deleted_at IS NULL').run(now(), id, uid());
  return result.changes > 0;
}

export function listVersions(deckId: string): DeckVersion[] {
  return (getDb().prepare('SELECT version, reason, created_at FROM deck_versions WHERE deck_id = ? ORDER BY version DESC').all(deckId) as { version: number; reason: string; created_at: string }[])
    .map(row => ({ version: row.version, reason: row.reason, createdAt: row.created_at }));
}

export function getVersionDoc(deckId: string, version: number): Deck | null {
  const row = getDb().prepare('SELECT doc FROM deck_versions WHERE deck_id = ? AND version = ?').get(deckId, version) as { doc: string } | undefined;
  return row ? JSON.parse(row.doc) as Deck : null;
}

// ── Jobs ──────────────────────────────────────────────────────────────────

interface JobRow { id: string; deck_id: string; kind: string; status: string; progress: string; payload: string; queued: string; error: string | null; created_at: string; updated_at: string }

export function emptyProgress(total = 0): JobProgress {
  const stages = { queued: total, writing: 0, imaging: 0, checking: 0, polishing: 0, done: 0, failed: 0 } as Record<CardStage, number>;
  return { stages, done: 0, total, percent: 0 };
}

function hydrateJob(row: JobRow): DeckJob & { payload: Record<string, unknown> } {
  return {
    id: row.id, deckId: row.deck_id, kind: row.kind as JobKind, status: row.status as JobStatus,
    progress: JSON.parse(row.progress), payload: JSON.parse(row.payload), queuedInstructions: JSON.parse(row.queued) as QueuedInstruction[],
    ...(row.error ? { error: row.error } : {}), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function insertJob(deckId: string, kind: JobKind, payload: Record<string, unknown> = {}, total = 0): DeckJob {
  const id = newId('job');
  const at = now();
  getDb().prepare('INSERT INTO deck_jobs (id, deck_id, kind, status, progress, payload, queued, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, deckId, kind, 'pending', JSON.stringify(emptyProgress(total)), JSON.stringify(payload), '[]', at, at);
  return getJob(id)!;
}

export function getJob(id: string) {
  const row = getDb().prepare('SELECT * FROM deck_jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ? hydrateJob(row) : null;
}

/** The newest job of the deck, optionally only active ones. */
export function latestJob(deckId: string, activeOnly = false) {
  const row = getDb().prepare(`SELECT * FROM deck_jobs WHERE deck_id = ? ${activeOnly ? "AND status IN ('pending','running')" : ''} ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(deckId) as JobRow | undefined;
  return row ? hydrateJob(row) : null;
}

export function updateJob(id: string, patch: { status?: JobStatus; progress?: JobProgress; error?: string | null; queued?: QueuedInstruction[] }) {
  const job = getJob(id);
  if (!job) return;
  // percent never decreases within one job (report 02 §2).
  const progress = patch.progress ? { ...patch.progress, percent: Math.max(job.progress.percent, patch.progress.percent) } : job.progress;
  getDb().prepare('UPDATE deck_jobs SET status = ?, progress = ?, error = ?, queued = ?, updated_at = ? WHERE id = ?')
    .run(patch.status ?? job.status, JSON.stringify(progress), patch.error === undefined ? job.error ?? null : patch.error, JSON.stringify(patch.queued ?? job.queuedInstructions), now(), id);
}

/** On startup, jobs left running by a previous process are marked failed. */
export function failInterruptedJobs(): number {
  return getDb().prepare("UPDATE deck_jobs SET status = 'failed', error = 'Interrupted: the app restarted while this job ran.', updated_at = ? WHERE status IN ('pending','running')").run(now()).changes;
}

// ── Media ─────────────────────────────────────────────────────────────────

export function mediaDir(): string {
  const dir = path.join(process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot'), 'decks-media');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

export function insertMedia(deckId: string, bytes: Buffer, mime: string, origin: MediaOrigin, meta: Partial<Pick<MediaItem, 'width' | 'height' | 'sourceUrl' | 'prompt'>> = {}): MediaItem {
  const id = newId('med');
  const file = path.join(mediaDir(), `${id}.${EXT[mime] || 'bin'}`);
  fs.writeFileSync(file, bytes);
  const at = now();
  getDb().prepare('INSERT INTO deck_media (id, deck_id, mime, origin, path, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, deckId, mime, origin, file, JSON.stringify(meta), at);
  return { id, deckId, mime, origin, ...meta, createdAt: at };
}

interface MediaRow { id: string; deck_id: string; mime: string; origin: string; path: string; meta: string; created_at: string }
const hydrateMedia = (row: MediaRow): MediaItem => ({ id: row.id, deckId: row.deck_id, mime: row.mime, origin: row.origin as MediaOrigin, ...JSON.parse(row.meta), createdAt: row.created_at });

export function listMedia(deckId: string): MediaItem[] {
  return (getDb().prepare('SELECT * FROM deck_media WHERE deck_id = ? ORDER BY created_at').all(deckId) as MediaRow[]).map(hydrateMedia);
}

/** Media bytes for serving and export; only for decks this account can read. */
export function readMedia(mediaId: string): { item: MediaItem; data: Buffer } | null {
  const row = getDb().prepare('SELECT * FROM deck_media WHERE id = ?').get(mediaId) as MediaRow | undefined;
  if (!row || !getDeck(row.deck_id)) return null;
  try { return { item: hydrateMedia(row), data: fs.readFileSync(row.path) }; } catch { return null; }
}

// ── Proposals ─────────────────────────────────────────────────────────────

export function insertProposal(proposal: Omit<EditProposal, 'id' | 'createdAt' | 'status'>): EditProposal {
  const full: EditProposal = { ...proposal, id: newId('prop'), status: 'proposed', createdAt: now() };
  getDb().prepare('INSERT INTO deck_proposals (id, deck_id, status, doc, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(full.id, full.deckId, full.status, JSON.stringify(full), full.createdAt);
  return full;
}

export function getProposal(id: string): EditProposal | null {
  const row = getDb().prepare('SELECT doc, status FROM deck_proposals WHERE id = ?').get(id) as { doc: string; status: string } | undefined;
  return row ? { ...JSON.parse(row.doc), status: row.status } as EditProposal : null;
}

export function listProposals(deckId: string, onlyOpen = true): EditProposal[] {
  return (getDb().prepare(`SELECT doc, status FROM deck_proposals WHERE deck_id = ? ${onlyOpen ? "AND status = 'proposed'" : ''} ORDER BY created_at DESC LIMIT 20`).all(deckId) as { doc: string; status: string }[])
    .map(row => ({ ...JSON.parse(row.doc), status: row.status }) as EditProposal);
}

export function setProposalStatus(id: string, status: EditProposal['status']) {
  getDb().prepare('UPDATE deck_proposals SET status = ? WHERE id = ?').run(status, id);
}
