'use client';

import { useTranslation } from '@/hooks/useTranslation';
import { createStrings } from './strings-create';
import { editorStrings } from './strings-editor';
import { commonStrings } from './strings-common';
import { labStrings } from './strings-lab';

/**
 * Decks UI strings live in this module (en + zh) instead of src/i18n/en.ts /
 * zh.ts: several parts of the UI were built in parallel and each owns one
 * dictionary file, so they never edit the same file. zh-HK falls back to zh.
 */
const dictionaries = { en: { ...commonStrings.en, ...createStrings.en, ...editorStrings.en, ...labStrings.en }, zh: { ...commonStrings.zh, ...createStrings.zh, ...editorStrings.zh, ...labStrings.zh } };
export type DecksStringKey = keyof typeof dictionaries.en;

export function useDecksT() {
  const { locale } = useTranslation();
  const dict: Record<string, string> = locale === 'en' ? dictionaries.en : dictionaries.zh;
  return (key: DecksStringKey, params?: Record<string, string | number>) => {
    let text = dict[key] ?? (dictionaries.en as Record<string, string>)[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
    return text;
  };
}
