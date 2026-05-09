"use client";

import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { LanguageDescription } from "@codemirror/language";
import { languages as cmLanguages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { indentWithTab } from "@codemirror/commands";
import { useTheme } from "next-themes";

/*
 * MarkdownEditor — Phase 4 replacement for the raw <textarea> in
 * SkillEditor (and the future standalone .md editor surface).
 *
 * Design points (POC 0.4 §[设计]):
 * - Compartment-based theme swap so light↔dark does not rebuild the
 *   EditorView (no flash, no cursor loss).
 * - Value prop is controlled — external writes flow in via a diff
 *   dispatch, internal edits flow out via updateListener.
 * - Mod-s is intercepted for onSave; Tab inserts two spaces via
 *   indentWithTab to match the legacy textarea's behavior.
 * - CodeMirror owns its own virtualization (O(viewport) render), so 10-
 *   万-character files stay responsive without any app-side work.
 *
 * Style isolation from Tailwind v4 preflight is handled in globals.css
 * via `@layer base { .cm-editor, .cm-editor * { all: revert-layer; } }`
 * (POC 0.4 path C). Do not wrap this component in Shadow DOM —
 * token inheritance would break and focus behavior gets weird.
 */
export interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
  /** Optional filename shown via data-attribute (used for testing hooks). */
  filename?: string;
  /** Aria label for a11y; also shown as placeholder hint. */
  placeholder?: string;
  className?: string;
  /**
   * CodeMirror language identifier (e.g. 'typescript', 'python', 'json').
   * Defaults to 'markdown' for backward compat with existing callers
   * (SkillEditor and the original Markdown-only preview path). Markdown is
   * bundled statically as the initial grammar; any other value triggers a
   * dynamic load from @codemirror/language-data via langCompartment swap —
   * no view rebuild, no cursor loss. Unknown languages fall back to plain
   * text (still editable, just without syntax highlighting).
   */
  language?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  filename,
  placeholder,
  className,
  language = "markdown",
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Compartments are stable across renders — store on ref init so we don't
  // create new ones on every render (which would cause reconfigure loops).
  const themeCompartment = useRef(new Compartment()).current;
  const langCompartment = useRef(new Compartment()).current;
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  // Tracks the most recently requested language so a slow desc.load() can't
  // overwrite a newer language reconfigure (race when user fast-switches files).
  const langSeqRef = useRef(0);
  const { resolvedTheme } = useTheme();

  // Refs track the latest callbacks so CodeMirror's long-lived listener
  // never captures a stale closure. Without this, fast typing after
  // onChange identity changes would dispatch into the old handler.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Initialize EditorView once per mount. State changes flow through
  // dispatches in the other effects below.
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;

    const baseTheme = EditorView.theme({
      "&": { height: "100%", fontSize: "13px" },
      ".cm-scroller": {
        // Prefer JetBrains Mono (programming-optimized), fall back to Geist
        // Mono (already loaded by next/font), then to platform monospace.
        // NOTE: --font-mono (Tailwind v4 @theme token) is not readable as a
        // CSS var on body — that's why this surface previously rendered in
        // Consolas/Courier on Windows. Using --font-jetbrains-mono and
        // --font-geist-mono directly (next/font injects them on body) works.
        fontFamily:
          "var(--font-jetbrains-mono), var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      },
      ".cm-content": { padding: "12px" },
      "&.cm-focused": { outline: "none" },
    });

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
      indentWithTab,
    ]);

    const initialTheme = resolvedTheme === "dark" ? oneDark : [];

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        // Markdown ships statically as the initial grammar (still the most
        // common case). Other languages get swapped in via the langCompartment
        // effect below, on demand from @codemirror/language-data.
        langCompartment.of(markdown()),
        baseTheme,
        themeCompartment.of(initialTheme),
        saveKeymap,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });

    viewRef.current = new EditorView({ state, parent: hostRef.current });
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // Intentional single-run — subsequent prop changes propagate via
    // dedicated effects (value / theme).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes — replace doc contents via dispatch.
  // Skips when the incoming value already matches what CodeMirror has,
  // so typing doesn't cause a self-echo loop.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur !== value) {
      view.dispatch({
        changes: { from: 0, to: cur.length, insert: value },
      });
    }
  }, [value]);

  // Theme compartment swap — no EditorView rebuild, no cursor loss.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.reconfigure(
        resolvedTheme === "dark" ? oneDark : [],
      ),
    });
  }, [resolvedTheme, themeCompartment]);

  // Language compartment swap — dynamically loads grammar via language-data.
  // Same compartment pattern as the theme: no EditorView rebuild, no cursor
  // loss. Markdown stays statically bundled (see init above) for the common
  // case; everything else flows through here.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const seq = ++langSeqRef.current;

    // Markdown is already the initial grammar — short-circuit to avoid
    // bouncing through language-data's resolver for the common case.
    if (language === "markdown" || language === "md" || language === "mdx") {
      view.dispatch({ effects: langCompartment.reconfigure(markdown()) });
      return;
    }

    // matchLanguageName(fuzzy=true) does case-insensitive name + alias match,
    // so values like 'typescript', 'TypeScript', 'ts' all resolve correctly.
    const desc = LanguageDescription.matchLanguageName(cmLanguages, language, true);
    if (!desc) {
      // Unknown language → plain text. Still editable, just no syntax highlight.
      view.dispatch({ effects: langCompartment.reconfigure([]) });
      return;
    }

    desc.load().then((support) => {
      // Bail if a newer language request superseded us, or the view unmounted.
      if (langSeqRef.current !== seq) return;
      if (!viewRef.current) return;
      viewRef.current.dispatch({ effects: langCompartment.reconfigure(support) });
    }).catch(() => {
      if (langSeqRef.current !== seq) return;
      if (!viewRef.current) return;
      // Loading failed (network blip, missing module). Fall back to plain text
      // so the editor stays usable.
      viewRef.current.dispatch({ effects: langCompartment.reconfigure([]) });
    });
  }, [language, langCompartment]);

  return (
    <div
      ref={hostRef}
      className={className ?? "h-full w-full overflow-hidden"}
      data-filename={filename}
      aria-label={placeholder}
    />
  );
}
