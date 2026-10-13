/** Page topics follow the dominant prose language, independently of bilingual
 * evidence in the body. Count approximate displayed width rather than bytes. */
export function dominantInputLanguage(project = {}) {
  const source = project.source || {};
  const prose = source.segments?.length ? source.segments.filter(segment => segment.kind !== 'code').map(segment => segment.text || '').join('\n') : source.text;
  const sample = String(prose || source.images?.map(image => image.caption || '').join('\n') || project.prompt || '')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    .replace(/data:[^\s"')]+|https?:\/\/[^\s)]+|(?:\/[\w.-]+){2,}/g, '')
    .replace(/[\p{L}\p{N}_.-]+\.(?:png|jpe?g|pdf|docx|xlsx|html?)\b/giu, '')
    .replace(/<[^>]*>/g, '').replace(/!?\[[^\]]*\]\([^)]*\.(?:png|jpe?g)[^)]*\)/gi, '');
  const widths = { zh: 0, ja: 0, ko: 0, en: 0 };
  let first;
  for (const line of sample.split('\n')) {
    const kana = (line.match(/\p{Script=Hiragana}|\p{Script=Katakana}/gu) || []).length;
    const japanese = kana >= Math.max(2, (line.match(/\p{Script=Han}/gu) || []).length * .12);
    for (const char of line) {
      const language = /\p{Script=Han}/u.test(char) ? (japanese ? 'ja' : 'zh')
        : /\p{Script=Hiragana}|\p{Script=Katakana}/u.test(char) ? 'ja'
        : /\p{Script=Hangul}/u.test(char) ? 'ko' : /\p{Script=Latin}/u.test(char) ? 'en' : null;
      if (!language) continue;
      first ||= language;
      widths[language] += language === 'en' ? .58 : 1;
    }
  }
  return first ? Object.keys(widths).sort((a, b) => widths[b] - widths[a] || (a === first ? -1 : b === first ? 1 : 0))[0] : 'en';
}

/** Select a supplied parallel translation; never invent a translation or
 * delete an acronym that is part of a topic. Locked user titles bypass this. */
export function stripContinuationSuffix(value) {
  return String(value || '').trim()
    .replace(/\s*[（(]\s*(?:续(?:页|写)?|continued?|cont\.?)\s*\d*\s*[）)]\s*$/iu, '')
    .replace(/\s*(?:[|｜·–—-]\s*)?(?<![持连延陆后存赓接])续(?:页|写)?\s*\d*\s*$/u, '')
    .replace(/\s+(?:[|｜·–—-]\s*)?(?:continued?|cont\.?)\s*\d*\s*$/iu, '').trim();
}

export function normalizeTopicTitle(value, language) {
  const title = language ? stripContinuationSuffix(value) : String(value || '').trim();
  if (!language || !/\p{Script=Han}/u.test(title) || !/[A-Za-z]/.test(title)) return title;
  let parts = title.split(/\s*[|｜·]\s*|\s+[—–/]\s+|\n/).filter(Boolean);
  if (parts.length === 1) {
    const parallel = title.match(/^([A-Za-z][A-Za-z\d ,:&()'-]*[a-z][A-Za-z\d ,:&()'-]*)\s+((?:[A-Z\d]+\s*)?[\p{Script=Han}].*)$/u);
    if (parallel && (parallel[1].trim().split(/\s+/).length > 1 || /^(?:overview|introduction|summary|conclusion|mechanism|conditions|limitations)$/i.test(parallel[1].trim()))) parts = parallel.slice(1);
  }
  const han = parts.filter(part => /\p{Script=Han}/u.test(part));
  const latin = parts.filter(part => !/\p{Script=Han}/u.test(part) && /[A-Za-z]/.test(part));
  if (!han.length || !latin.length) return title;
  if (language === 'en' || ['de', 'fr', 'es'].includes(language)) return latin.join(' · ');
  if (language === 'zh' || language === 'zh-Hant') {
    const acronyms = latin.filter(part => /^[A-Z\d_\s+-]+$/.test(part));
    return [...acronyms, ...han].join(' ');
  }
  return title;
}

export function closingTopic(language) {
  return ({ zh: '感谢观看', 'zh-Hant': '感謝觀看', ja: 'ご清聴ありがとうございました', ko: '시청해 주셔서 감사합니다',
    de: 'Vielen Dank!', fr: 'Merci de votre attention !', es: '¡Gracias por su atención!' })[language] || 'Thanks for watching!';
}
