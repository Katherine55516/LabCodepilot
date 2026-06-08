'use client';

/**
 * Runtime Simplified → Hong Kong Traditional conversion for strings that live
 * OUTSIDE the i18n dictionary — inline `isZh ? '简体' : 'English'` literals and
 * data-field zh values from catalogs / presets / GSD descriptions. The dictionary
 * (zh-HK.ts) is pre-converted at build time by scripts/gen-zh-hk.mjs; this mirrors
 * that for everything else, so a zh-HK user never sees Simplified or an English
 * fallback in the components that bypass the dictionary.
 *
 * Shares the same term-override table (zh-hk-overrides.json) as the generator, so
 * the on-the-fly wording matches the dictionary exactly.
 */

import * as OpenCCNS from 'opencc-js';
import overrides from './zh-hk-overrides.json';

type ConvertFn = (text: string) => string;
type OpenCCModule = { Converter: (opts: { from: string; to: string }) => ConvertFn };

let converter: ConvertFn | null = null;
const cache = new Map<string, string>();
const OVERRIDES = overrides as Record<string, string>;

function getConverter(): ConvertFn {
  if (!converter) {
    const mod = (OpenCCNS as unknown as { default?: OpenCCModule }).default
      ?? (OpenCCNS as unknown as OpenCCModule);
    converter = mod.Converter({ from: 'cn', to: 'hk' });
  }
  return converter;
}

/**
 * Convert a Simplified-Chinese string to Hong Kong Traditional, applying the
 * shared term overrides. Memoised — each distinct input is converted once.
 */
export function toHK(simplified: string): string {
  if (!simplified) return simplified;
  const cached = cache.get(simplified);
  if (cached !== undefined) return cached;
  let out = getConverter()(simplified);
  for (const [from, to] of Object.entries(OVERRIDES)) {
    out = out.split(from).join(to);
  }
  cache.set(simplified, out);
  return out;
}

/**
 * Pick the right copy for the current locale from a Simplified-Chinese + English
 * pair. en → English; zh → Simplified (unchanged); zh-HK → runtime Traditional.
 *
 * This is the single replacement for every `isZh ? zh : en` site that bypasses
 * the i18n dictionary. The en and zh branches return their input verbatim, so
 * Simplified/English rendering is byte-for-byte unchanged; only zh-HK is new.
 *
 * `locale` is typed as string (not Locale) so it accepts both the Locale from
 * useTranslation() and the plain-string `locale` props/opts some components use
 * (CliToolCard, useCliToolsFetch). Any non-en/non-zh-HK value falls back to zh.
 */
export function localize(locale: string, zh: string, en: string): string {
  if (locale === 'en') return en;
  if (locale === 'zh-HK') return toHK(zh);
  return zh;
}

/**
 * Array variant of localize for string[] fields (e.g. use-cases, guide-steps).
 * en → enArr; zh → zhArr (unchanged); zh-HK → each zh item converted to Traditional.
 */
export function localizeArr(locale: string, zh: string[], en: string[]): string[] {
  if (locale === 'en') return en;
  if (locale === 'zh-HK') return zh.map(toHK);
  return zh;
}
