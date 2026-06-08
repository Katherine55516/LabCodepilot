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
let out = conv(src);

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
  ' * OpenCC 提供繁體字形轉換與部分香港詞彙；個別 IT 術語（如 內存/視頻/',
  ' * 選單 等）如需更貼合香港本地用詞，可在本檔手動校訂，但下次重新生成會被覆蓋。',
  ' * 與 zh.ts 保持相同 key 結構（Record<TranslationKey, string>，型別強制對齊）。',
  ' */',
  '',
].join('\n');

out = banner + out;

writeFileSync(OUT, out, 'utf8');

// Sanity: count translated entries (lines starting with a quoted key).
const keyCount = (out.match(/^\s*'[^']+':/gm) || []).length;
console.log(`Generated ${OUT} (${keyCount} keys)`);
