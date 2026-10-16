import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { ThemeFamilyProvider } from "@/components/layout/ThemeFamilyProvider";
import { I18nProvider } from "@/components/layout/I18nProvider";
import { RouteShell } from "@/components/layout/RouteShell";
import { getAllThemeFamilies, getThemeFamilyMetas } from "@/lib/theme/loader";
import { renderThemeFamilyCSS } from "@/lib/theme/render-css";
import { getSetting } from "@/lib/db";

const geistSans = localFont({
  src: "../assets/fonts/GeistVF.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: "../assets/fonts/GeistMonoVF.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-geist-mono",
});

// Code-oriented monospace font used by CodeMirror (file edit/preview surface)
// and any future code-display contexts. JetBrains Mono is purpose-built for
// programming: tight glyph alignment, ligatures (`<=` / `=>` / `!=` / `->`
// render as compound glyphs), and a clearly distinguishable 0/O/1/l/I set.
const jetbrainsMono = localFont({
  src: "../assets/fonts/JetBrainsMonoVF.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "AIMate",
  description: "A multi-model AI agent desktop client",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const families = getAllThemeFamilies();
  const familiesMeta = getThemeFamilyMetas();
  const themeFamilyCSS = renderThemeFamilyCSS(families);
  const validIds = families.map((f) => f.id);

  // Read theme preferences from DB (persisted across sessions).
  // Wrapped in try-catch because during `next build`, multiple worker processes
  // prerender pages concurrently through this layout, all hitting getDb().
  // SQLite cannot handle parallel writes from separate processes ("database is locked").
  let dbThemeMode: string | undefined;
  let dbThemeFamily: string | undefined;
  try {
    dbThemeMode = getSetting('theme_mode') || undefined;
    dbThemeFamily = getSetting('theme_family') || undefined;
  } catch {
    // Build-time or DB unavailable — fall back to localStorage-only theme
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Anti-FOUC: set data-theme-family from localStorage → DB fallback, validate against known IDs */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var v=${JSON.stringify(validIds)};var db=${JSON.stringify(dbThemeFamily || null)};var f=localStorage.getItem('codepilot_theme_family')||db||'default';if(v.indexOf(f)<0)f='default';document.documentElement.setAttribute('data-theme-family',f);if(!localStorage.getItem('codepilot_theme_family')&&f!=='default'){localStorage.setItem('codepilot_theme_family',f)}}catch(e){}})();` }} />
        {/* Sync DB theme mode to next-themes localStorage if not yet set */}
        {dbThemeMode && (
          <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(!localStorage.getItem('theme')){localStorage.setItem('theme',${JSON.stringify(dbThemeMode)})}}catch(e){}})();` }} />
        )}
        <style id="theme-family-vars" dangerouslySetInnerHTML={{ __html: themeFamilyCSS }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <ThemeProvider>
          <ThemeFamilyProvider families={familiesMeta}>
            <I18nProvider>
              <RouteShell>{children}</RouteShell>
            </I18nProvider>
          </ThemeFamilyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
