import {it} from 'node:test';import assert from 'node:assert/strict';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {PptTextToolbar,effectiveTextStyle,editableTextIds} from '../../components/ppt/editor/PptTextToolbar';import {I18nContext} from '../../components/layout/I18nProvider';import {translate,type TranslationKey} from '../../i18n';import type {PptRenderElement} from '../../components/ppt/types';
const card=(token:number,measured:number,lineHeight?:number)=>({id:'c',nodeId:'c',kind:'list',style:{fontSizePt:token,lineHeight:1.4},content:{items:[],pointLayout:{fontSizePt:measured,lineHeight,boxes:[],columns:1,overflow:false}}} as unknown as PptRenderElement);
const render=(elements:PptRenderElement[])=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:{locale:'en',setLocale:()=>{},t:(key:TranslationKey,params?:Record<string,string|number>)=>translate('en',key,params)}},createElement(PptTextToolbar,{elements,onApply:async()=>{},onSelectText:()=>{}})));
it('the card toolbar shows measured font and line height rather than unused template tokens',()=>{
 assert.deepEqual(effectiveTextStyle(card(20,14)),{fontSizePt:14,lineHeight:1.18});
 const html=render([card(20,14,1.55)]);assert.match(html,/aria-label="Font size"[^>]*value="14"/);assert.match(html,/aria-label="Line height"[^>]*value="1.55"/);assert.match(html,/aria-label="Font size"[^>]*step="any"/);assert.match(html,/aria-label="Line height"[^>]*step="any"/);
});
it('mixed values compare what cards actually render',()=>{
 const same=render([card(20,14),card(18,14)]);assert.match(same,/aria-label="Font size"[^>]*value="14"/);
 const mixed=render([card(20,14),card(20,15)]);assert.match(mixed,/aria-label="Font size"[^>]*value=""/);
});
it('ordinary text retains its own style in the toolbar',()=>{const e={kind:'text',style:{fontSizePt:22.5,lineHeight:1.6}} as PptRenderElement;assert.deepEqual(effectiveTextStyle(e),e.style);});

it('body selection excludes locked counters, headings and navigation, and deduplicates editable nodes',()=>{
 const e=(nodeId:string,semanticRole:string,locked=false)=>({nodeId,kind:'text',semanticRole,locked} as PptRenderElement);
 const elements=[e('body','source-explanation'),e('body','source-explanation'),e('counter','page-number',true),e('old-counter','page-number'),e('heading','template-title'),e('nav','eyebrow'),e('locked','body',true)];
 assert.deepEqual(editableTextIds(elements,'body'),['body']);assert.deepEqual(editableTextIds(elements,'title'),['heading']);assert.ok(!editableTextIds(elements,'all').includes('counter'));
});
