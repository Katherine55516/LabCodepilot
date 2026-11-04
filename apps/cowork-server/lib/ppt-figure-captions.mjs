/** Figure captions in the deck's language (the hand deck, Fable 2026-11-02:
 * "名称（图 N）" under each figure). A source caption already in the deck's
 * language is shown whole, as before. Otherwise the final retitle call writes
 * a short caption (at most 20 Chinese characters or 10 English words, words
 * of the caption or its page only); code appends the source's figure number;
 * without one, only "图 N" / "Figure N" is shown. The full source caption is
 * always in the speaker notes (captionNotes). A leaf module: the figure
 * layouts, the object ledger, the retitle pass and the notes use it. */
import {topicLanguageMismatch} from './ppt-topic-title-validation.mjs';

/** The deck's language: its output locale, else the source's. */
export const deckCaptionLanguage=p=>{const language=p?.generationPolicy?.language||{};const value=language.mode==='output'?String(language.locale||'en'):String(p?.inputUnderstanding?.primaryLanguage||'en');return value.startsWith('zh')?(/Hant|TW|HK/iu.test(value)?'zh-Hant':'zh'):'en';};
/** Whether a source caption needs a caption in the deck's language. */
export const foreignCaption=(p,image)=>Boolean(String(image?.caption||'').trim())&&topicLanguageMismatch(String(image.caption).trim(),deckCaptionLanguage(p));
/** The source's own figure number ("Figure 10.", "图 3"), or ''. */
export const figureNumber=caption=>String(caption||'').match(/^\s*(?:fig(?:ure)?\.?|图|圖)\s*([\dA-Z]+(?:\.\d+)?)/iu)?.[1]||'';
/** The caption a figure shows. */
export function displayCaption(p,image){
 const caption=String(image?.caption||'').trim();if(!caption||!foreignCaption(p,image))return caption;
 const zh=deckCaptionLanguage(p).startsWith('zh'),number=figureNumber(caption),short=String(p?.planningContract?.figureCaptions?.[image.id]||'').trim();
 if(short)return short+(number?(zh?`（图 ${number}）`:` (Figure ${number})`):'');
 return number?(zh?`图 ${number}`:`Figure ${number}`):'';
}
/** A source image as a figure shows it: its caption in the deck's language. */
export const shownImage=(p,image)=>image&&foreignCaption(p,image)?{...image,caption:displayCaption(p,image)}:image;
/** A short caption the model wrote: in the deck's language, within its length,
 * no new words (each word of 4+ letters, or each Han run, must occur in the
 * source caption or the page's own text), no number the caption lacks. */
export function acceptCaption(p,image,text,pageText=''){
 const value=String(text||'').replace(/\s+/gu,' ').replace(/[（(]\s*(?:图|圖|Figure)\s*[\dA-Z.]+\s*[)）]\s*$/iu,'').trim(),language=deckCaptionLanguage(p);
 if(!value||topicLanguageMismatch(value,language))return '';
 if(language.startsWith('zh')?[...value].length>20:value.split(/\s+/u).length>10)return '';
 const numbers=value.match(/\d+(?:[.,]\d+)?/gu)||[],source=String(image?.caption||'')+' '+pageText;
 if(numbers.some(number=>!source.includes(number)))return '';
 return value;
}
/** Speaker notes with each foreign-language figure caption in full. */
export function captionNotes(p){
 const images=new Map((p?.source?.images||[]).map(image=>[image.id,image]));
 return (p?.deck?.slides||[]).flatMap((slide,index)=>{
  const ids=[...new Set((slide.nodes||[]).map(node=>node.content?.sourceImageId).filter(Boolean))].filter(id=>foreignCaption(p,images.get(id)));
  return ids.length?[{index,sourceUnitIds:ids,text:ids.map(id=>String(images.get(id).caption).trim()).join('\n')}]:[];
 });
}
/** A text not in the deck's language, stricter than topicLanguageMismatch for
 * Chinese decks: a text with no Chinese character is foreign unless each word
 * is an acronym or a code name (I-JEPA, VAE, CMA-ES, ViT-H/14); a single
 * common word such as "Method" is foreign (3197 85a2621c: "Method · 1/2"). */
export function foreignToDeck(p,text){
 const value=String(text||'').replace(/\s*·\s*\d+\/\d+\s*$/u,'').replace(/[（(](?:续|cont\.)[)）]\s*$/iu,'').trim(),language=deckCaptionLanguage(p);
 if(!value)return false;
 if(topicLanguageMismatch(value,language))return true;
 if(!language.startsWith('zh')||/\p{Script=Han}/u.test(value))return false;
 const words=value.match(/[A-Za-z][A-Za-z0-9_+./-]*/gu)||[];
 return words.some(word=>/[a-z]{3,}/u.test(word)&&!/[A-Z].*[A-Z]|\d|[-_/]/u.test(word));
}
