'use client';

import { createContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { type Locale, type TranslationKey, translate } from '@/i18n';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  // Dynamic locale. Initial 'zh' is a first-paint default; loadLocale() below
  // immediately reconciles it with the persisted choice or the system language.
  // Switched at runtime via the language picker in Settings → General.
  const [locale, setLocaleState] = useState<Locale>('zh');

  // Load persisted locale on mount; auto-detect system language if never set
  useEffect(() => {
    async function loadLocale() {
      try {
        const res = await fetch('/api/settings/app');
        if (res.ok) {
          const data = await res.json();
          const saved = data.settings?.locale;
          if (saved === 'en' || saved === 'zh' || saved === 'zh-HK') {
            setLocaleState(saved);
            return;
          }
        }
      } catch { /* ignore */ }

      // No persisted locale — detect system language
      // Works across: Electron (Chromium OS locale), browser, SSR (skipped)
      if (typeof navigator !== 'undefined') {
        const candidates = [
          ...(navigator.languages || []),  // user's preferred language list
          navigator.language,               // primary browser/OS language
        ].filter(Boolean);
        // Traditional-Chinese regions (HK / Macau / Taiwan) or explicit Hant
        // script → zh-HK; any other zh-* → Simplified; otherwise leave default.
        const isHant = candidates.some(lang => /^zh-(hk|mo|tw|hant)/i.test(lang));
        const isZh = candidates.some(lang => lang.toLowerCase().startsWith('zh'));
        const detected: Locale | null = isHant ? 'zh-HK' : isZh ? 'zh' : null;
        if (detected) {
          setLocaleState(detected);
          fetch('/api/settings/app', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: { locale: detected } }),
          }).catch(() => {});
        }
      }
    }
    loadLocale();
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    fetch('/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { locale: newLocale } }),
    }).catch(() => {});
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}
