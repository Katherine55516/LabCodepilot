// Card deck frame pages and language (the user, 2026-10-31, after comparing
// with Gamma): the closing says only its thanks; 繁體中文 is a card language;
// a formula rebuilt from approximate PDF math flags its page; a table the deck
// leaves out is named on the closing page's notes.
import assert from 'node:assert/strict';
import {ensureOutlineClosing,closingFramingTexts} from './lib/ppt-closing-page.mjs';
import {LANGUAGE_CHOICES,languagePolicy,languageChoice,defaultLanguageChoice,chineseChoice,optionalTableNotes} from './lib/ppt-card-language.mjs';
import {pageFlaggable} from './lib/ppt-gate-tiers.mjs';

const cards=(locale,extra={})=>({planningContract:{version:3},generationPolicy:{language:{mode:'output',locale}},...extra});
const raw={slides:[{id:'c',title:'Cover'},{id:'a',title:'Card',keyPoints:[{text:'x',sourceUnitIds:['u']}],sourceUnitIds:['u']}]};

// The closing: title only, in the deck's language.
for(const [locale,title] of [['zh','感谢观看'],['zh-HK','感謝觀看'],['en','Thanks for watching!']]){
 const closing=ensureOutlineClosing(cards(locale),structuredClone(raw)).slides.at(-1);
 assert.deepEqual([closing.role,closing.title,closing.keyPoints],['closing',title,[]],`${locale}: the closing says only its thanks`);
 assert.deepEqual(closingFramingTexts(cards(locale)),[title],'no invitation line is framing text either');
}
// A deck outside the card flow keeps its invitation.
assert.deepEqual(closingFramingTexts({generationPolicy:{language:{mode:'output',locale:'zh'}}}),['感谢观看','欢迎提问与交流']);

// 繁體中文: the existing zh-HK output locale under a generic label.
assert.ok(LANGUAGE_CHOICES.includes('zh-Hant'));
assert.deepEqual(languagePolicy('zh-Hant'),{mode:'output',locale:'zh-HK'});
assert.equal(languageChoice({generationPolicy:{language:languagePolicy('zh-Hant')}}),'zh-Hant','the choice round-trips');
assert.equal(languageChoice({generationPolicy:{language:{mode:'output',locale:'zh'}}}),'zh');
assert.equal(defaultLanguageChoice({primaryLanguage:'zh-HK'}),'zh-Hant','a traditional source defaults to 繁體中文');
assert.ok(chineseChoice('zh-Hant')&&chineseChoice('zh')&&!chineseChoice('en'));
assert.throws(()=>languagePolicy('ja'),/Traditional Chinese/u);

// A formula that differs from approximate PDF math text flags its page; any other still blocks.
const formula={code:'visible_formula_unverified',severity:'error',slideId:'s'};
assert.equal(pageFlaggable({...formula,approximateSource:true}),true);
assert.equal(pageFlaggable(formula),false,'a formula from an exact source still blocks the deck');
assert.equal(pageFlaggable({...formula,sentBack:true}),true,'a card formula unmatched after its send-back flags its page (Fable Q1)');
// A number flags its page on a card deck in every case (Fable F4, 2026-11-01).
assert.equal(pageFlaggable({code:'visible_numeric_fidelity',severity:'error',slideId:'s',approximateSource:true}),true,'numbers flag their page');
assert.equal(pageFlaggable({code:'user_title_fidelity',severity:'error',slideId:'s',approximateSource:true}),false,'only formulas and numbers');

// A table the outline left out is named on the closing page's notes.
const p={...cards('zh'),source:{semantic:{inventory:{items:[{id:'t9',type:'TableBlock',sectionPath:['11 前端接口与配置','11.2 主要业务 API']}]}}},
 planningContract:{version:3,cardOutline:{raw:{optionalTables:['t9']}}},deck:{slides:[{id:'c'},{id:'end'}]}};
assert.deepEqual(optionalTableNotes(p),[{index:1,sourceUnitIds:[],text:'未在幻灯片中展示的表格：主要业务 API'}]);
assert.match(optionalTableNotes({...p,generationPolicy:{language:{mode:'output',locale:'zh-HK'}}})[0].text,/^未在投影片中展示的表格：/u);
console.log('PASS contents, closing and 繁體中文: thanks only, zh-Hant choice, approximate PDF formulas flag, omitted tables in the notes');
