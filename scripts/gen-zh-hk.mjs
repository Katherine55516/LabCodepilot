// Generate src/i18n/zh-HK.ts from src/i18n/zh.ts via OpenCC (Simplified -> Hong Kong Traditional).
// OpenCC maps Han characters only; ASCII keys, {placeholders}, English words and
// punctuation pass through untouched, so the file structure stays identical to zh.ts.
//
// Re-run after zh.ts changes:  node scripts/gen-zh-hk.mjs
import * as mod from 'opencc-js';
import { readFileSync, writeFileSync } from 'node:fs';

const OpenCC = mod.default ?? mod;
const conv = OpenCC.Converter({ from: 'cn', to: 'hk' });

const SRC = 'src/i18n/zh.ts';
const OUT = 'src/i18n/zh-HK.ts';

const src = readFileSync(SRC, 'utf8');
const OVERRIDES = JSON.parse(readFileSync('src/i18n/zh-hk-overrides.json', 'utf8'));

let out = conv(src);

// Apply Hong Kong term overrides. OpenCC emits 陆词繁写 for some IT terms
// (默認 / 賬 / 緩存 …); map them to idiomatic HK usage. These Han words only
// ever appear inside Chinese values — never in ASCII keys or {placeholders} —
// so whole-word replacement over the converted text is safe. The same table is
// reused at runtime by toHK() so dictionary and on-the-fly conversion agree.
for (const [from, to] of Object.entries(OVERRIDES)) {
  out = out.split(from).join(to);
}

// Rename the binding + default export (zh -> zhHK). Both lines are pure ASCII,
// so OpenCC left them unchanged and these replacements match exactly.
out = out.replace(
  'const zh: Record<TranslationKey, string> = {',
  'const zhHK: Record<TranslationKey, string> = {',
);
out = out.replace(/export default zh;\s*$/, 'export default zhHK;\n');

const banner = [
  '/**',
  ' * 繁體中文（香港）翻譯。',
  ' * 由 src/i18n/zh.ts 經 OpenCC（簡體 → 香港繁體，s2hk）自動轉換生成。',
  ' * 重新生成：node scripts/gen-zh-hk.mjs',
  ' *',
  ' * 常見 IT 術語已由 src/i18n/zh-hk-overrides.json 覆蓋校正為香港用詞',
  ' *（預設/帳號/快取/貼上/登入/上載 等）；如需新增校正請編輯該覆蓋表後重新生成。',
  ' * 與 zh.ts 保持相同 key 結構（Record<TranslationKey, string>，型別強制對齊）。',
  ' */',
  '',
].join('\n');

out = banner + out;

writeFileSync(OUT, out, 'utf8');

// Sanity: count translated entries (lines starting with a quoted key).
const keyCount = (out.match(/^\s*'[^']+':/gm) || []).length;
console.log(`Generated ${OUT} (${keyCount} keys)`);
