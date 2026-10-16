/** Round 7 (B1): one presentation contract for every topic field.
 *
 * Topics — cover title and subtitle, page titles, section labels, eyebrows,
 * the contents page and the closing greeting — use ONE language: the deck
 * language. It is the explicitly requested output language, or else the
 * dominant language of the input by visible width (code, paths, URLs and image
 * data excluded). Body text may keep both source languages (language.body).
 * Planning, writing, template binding and final checks all read this module. */
import { dominantInputLanguage } from './ppt-topic-language.mjs';

const HAN = /\p{Script=Han}/u, LATIN = /[A-Za-z]/u;

/** 'zh' | 'zh-Hant' | 'en' | 'ja' | 'ko' … */
export function deckLanguage(project = {}) {
  if (project.editOutputLanguage) return project.editOutputLanguage === 'zh-HK' ? 'zh-Hant' : project.editOutputLanguage;
  const policy = project.generationPolicy?.language;
  if (policy?.mode === 'output' && policy.locale) return policy.locale === 'zh-HK' ? 'zh-Hant' : policy.locale;
  return dominantInputLanguage(project);
}

/** Writing script of the deck language: 'han' for Chinese/Japanese, else 'latin'. */
export function deckScript(project = {}) {
  return ['zh', 'zh-Hant', 'ja'].includes(deckLanguage(project)) ? 'han' : 'latin';
}

/** The variant of a bilingual topic in the deck language. Returns the input
 * unchanged when it has only one language or no part matches. */
export function deckLanguageVariant(project, values) {
  const list = (Array.isArray(values) ? values : [values]).map(value => String(value || '').trim()).filter(Boolean);
  if (list.length < 2) return list[0] || '';
  const script = deckScript(project);
  const matches = value => script === 'han' ? HAN.test(value) : LATIN.test(value) && !HAN.test(value);
  return list.find(matches) || list[0];
}

/** Human name of the deck language for prompts. */
export function deckLanguageName(project) {
  return ({ zh: '简体中文', 'zh-Hant': '繁體中文', en: 'English', ja: '日本語', ko: '한국어' })[deckLanguage(project)] || 'English';
}

/** The writer/planner rule shared by every prompt that names topics. */
export function topicLanguageRule(project) {
  const name = deckLanguageName(project);
  return `Topic language: cover title, page titles, section labels, eyebrows, contents labels and the closing line use ONLY ${name}. Do not pair a second language in a topic (no "English | 中文"); keep technical names and acronyms as written. Body text follows the body-language policy.`;
}
