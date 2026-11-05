import type { DeckTheme } from './types';

/**
 * Built-in Decks themes. Original designs (not copied from Gamma): a theme is
 * styling only (report 05 §1); structure comes from the content. Fonts are
 * system stacks so decks render offline and export without font embedding.
 */
const SANS = 'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
const SERIF = 'Georgia, "Songti SC", "Noto Serif CJK SC", "Times New Roman", serif';
const MONO_HEAD = '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';

export const DECK_THEMES: DeckTheme[] = [
  { id: 'aurora', name: 'Aurora', dark: true, accentStyle: 'aurora', radius: 18,
    colorKeywords: ['violet', 'indigo', 'teal'], toneKeywords: ['modern', 'bold', 'tech'],
    colors: { background: '#0f1024', surface: '#191b3a', text: '#f3f2ff', muted: '#a9a7d6', accent: '#8b7bff', accent2: '#35d0c8', border: '#2c2f5c' },
    fonts: { heading: SANS, body: SANS } },
  { id: 'paper', name: 'Paper', dark: false, accentStyle: 'paper', radius: 6,
    colorKeywords: ['cream', 'ink', 'terracotta'], toneKeywords: ['editorial', 'academic', 'calm'],
    colors: { background: '#f7f3ea', surface: '#fffdf8', text: '#2a2620', muted: '#7a7163', accent: '#b5523b', accent2: '#3f6f6a', border: '#e3dccd' },
    fonts: { heading: SERIF, body: SERIF } },
  { id: 'slate', name: 'Slate', dark: false, accentStyle: 'grid', radius: 10,
    colorKeywords: ['grey', 'navy', 'blue'], toneKeywords: ['corporate', 'professional', 'clear'],
    colors: { background: '#f4f6f9', surface: '#ffffff', text: '#18212f', muted: '#5b6779', accent: '#2457c5', accent2: '#0f9d8a', border: '#d9dee7' },
    fonts: { heading: SANS, body: SANS } },
  { id: 'ember', name: 'Ember', dark: true, accentStyle: 'orbs', radius: 16,
    colorKeywords: ['charcoal', 'orange', 'amber'], toneKeywords: ['energetic', 'warm', 'pitch'],
    colors: { background: '#17120f', surface: '#231b16', text: '#fff4ec', muted: '#c7a995', accent: '#ff7a3d', accent2: '#ffc24b', border: '#3a2c23' },
    fonts: { heading: SANS, body: SANS } },
  { id: 'lagoon', name: 'Lagoon', dark: false, accentStyle: 'waves', radius: 14,
    colorKeywords: ['aqua', 'sea', 'sand'], toneKeywords: ['fresh', 'friendly', 'education'],
    colors: { background: '#effaf9', surface: '#ffffff', text: '#123232', muted: '#4f7171', accent: '#0f8f8a', accent2: '#f0a24a', border: '#cfe9e6' },
    fonts: { heading: SANS, body: SANS } },
  { id: 'mono', name: 'Mono', dark: false, accentStyle: 'stripes', radius: 0,
    colorKeywords: ['black', 'white', 'red'], toneKeywords: ['minimal', 'technical', 'stark'],
    colors: { background: '#ffffff', surface: '#f5f5f5', text: '#0b0b0b', muted: '#5f5f5f', accent: '#e0262d', accent2: '#0b0b0b', border: '#dcdcdc' },
    fonts: { heading: MONO_HEAD, body: SANS } },
  { id: 'blossom', name: 'Blossom', dark: false, accentStyle: 'orbs', radius: 20,
    colorKeywords: ['pink', 'plum', 'peach'], toneKeywords: ['playful', 'creative', 'social'],
    colors: { background: '#fff5f7', surface: '#ffffff', text: '#3a1830', muted: '#8a5d78', accent: '#d6457f', accent2: '#ff9b71', border: '#f3d6e0' },
    fonts: { heading: SERIF, body: SANS } },
  { id: 'forest', name: 'Forest', dark: true, accentStyle: 'waves', radius: 12,
    colorKeywords: ['green', 'moss', 'gold'], toneKeywords: ['natural', 'grounded', 'report'],
    colors: { background: '#0f1a14', surface: '#16261d', text: '#eef6ef', muted: '#9fbaa6', accent: '#5cc98a', accent2: '#e2c35b', border: '#244033' },
    fonts: { heading: SERIF, body: SANS } },
];

export const DEFAULT_THEME_ID = 'slate';

export function getTheme(id: string | undefined): DeckTheme {
  return DECK_THEMES.find(theme => theme.id === id) || DECK_THEMES.find(theme => theme.id === DEFAULT_THEME_ID)!;
}
