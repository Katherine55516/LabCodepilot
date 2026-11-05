'use client';

import { useState } from 'react';
import { decksApi } from '@/lib/decks/client';
import type { MediaItem } from '@/lib/decks/types';
import { useDecksT } from '../i18n';

/** Mirrors the server's upload rules (src/lib/decks/media.ts) so bad files fail fast with a clear message. */
export const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
const ALLOWED = UPLOAD_ACCEPT.split(',');
const MAX_BYTES = 10 * 1024 * 1024;

/** Uploads one image to the deck's media store, with loading and error state for the form that asked. */
export function useMediaUpload(deckId: string, onUploaded?: (media: MediaItem) => void) {
  const t = useDecksT();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File): Promise<MediaItem | null> => {
    setError(null);
    if (file.type && !ALLOWED.includes(file.type)) { setError(t('decks.editor.upload.badType')); return null; }
    if (file.size > MAX_BYTES) { setError(t('decks.editor.upload.tooLarge')); return null; }
    setUploading(true);
    try {
      const { media } = await decksApi.uploadMedia(deckId, file);
      onUploaded?.(media);
      return media;
    } catch (e) {
      setError(t('decks.editor.upload.failed', { message: e instanceof Error ? e.message : String(e) }));
      return null;
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading, error, clearError: () => setError(null) };
}
