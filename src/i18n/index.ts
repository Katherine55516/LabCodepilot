import en, { type TranslationKey } from './en';
import zh from './zh';
import zhHK from './zh-HK';

export type { TranslationKey };

export type Locale = 'en' | 'zh' | 'zh-HK';

export const SUPPORTED_LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'zh-HK', label: '繁體中文（香港）' },
];

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  en,
  zh,
  'zh-HK': zhHK,
};

/**
 * Translate a key with optional parameter interpolation.
 * Fallback chain: target locale → English → raw key.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const dict = dictionaries[locale] ?? en;
  let text = dict[key] ?? en[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return text;
}
