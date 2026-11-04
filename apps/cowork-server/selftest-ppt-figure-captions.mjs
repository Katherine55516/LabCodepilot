// Figure captions in the deck's language (the hand deck, Fable 2026-11-02):
// a foreign source caption shows as a short caption plus "（图 N）", else "图 N";
// the full caption is in the notes; a same-language caption shows whole.
import assert from 'node:assert/strict';
import {displayCaption,figureNumber,acceptCaption,captionNotes,shownImage,foreignToDeck} from './lib/ppt-figure-captions.mjs';
import {retitleTask,acceptFigureCaptions} from './lib/ppt-card-retitle.mjs';

const image={id:'f10',caption:'Figure 10. Despite losing details during this lossy compression process, latent vector z captures the essence of each image frame.'};
const zh={generationPolicy:{language:{mode:'output',locale:'zh-CN'}},inputUnderstanding:{primaryLanguage:'en'},planningContract:{},source:{images:[image]}};
const en={...zh,generationPolicy:{language:{mode:'output',locale:'en'}}};
assert.equal(figureNumber(image.caption),'10');
assert.equal(displayCaption(en,image),image.caption,'a caption in the deck\'s language shows whole');
assert.equal(displayCaption(zh,image),'图 10','no short caption yet: the figure number only');
const withShort={...zh,planningContract:{figureCaptions:{f10:'隐向量保留每帧画面的本质'}}};
assert.equal(displayCaption(withShort,image),'隐向量保留每帧画面的本质（图 10）');
assert.equal(shownImage(withShort,image).caption,'隐向量保留每帧画面的本质（图 10）');
assert.equal(shownImage(en,image),image,'unchanged in English');

assert.equal(acceptCaption(zh,image,'隐向量保留每帧画面的本质（图 10）'),'隐向量保留每帧画面的本质','a number the model added is code\'s to add');
assert.equal(acceptCaption(zh,image,'Latent vector keeps the essence'),'','not in the deck\'s language');
assert.equal(acceptCaption(zh,image,'这是一个非常非常长的图注说明它超过了二十个汉字的限制'),'','too long');
assert.equal(acceptCaption(zh,image,'模型得分为 906'),'','a number the caption does not give');

// The retitle call asks for the captions; its reply is checked.
const raw={slides:[{id:'c',title:'世界模型',cardFrame:'cover'},{id:'a',title:'隐向量压缩并捕捉图像本质',figurePage:true,sourceImageIds:['f10'],logicalCardId:'k'}]};
const task=retitleTask(zh,raw,[{indexes:[1],figure:true,captions:[image.caption]}]);
assert.ok(task.schema.required.includes('captions')&&task.figures.length===1,'the call asks for one caption');
assert.match(task.prompt,/short caption/u);
assert.deepEqual(acceptFigureCaptions(zh,raw,{captions:[{figure:'f10',caption:'隐向量保留每帧画面的本质'},{figure:'nope',caption:'x'}]}),{f10:'隐向量保留每帧画面的本质'});
assert.ok(!retitleTask(en,raw,[{indexes:[1],figure:true,captions:[image.caption]}]).schema.required.includes('captions'),'an English deck needs none');

// The full source caption is in the notes of the page that shows the figure.
const deck={...withShort,deck:{slides:[{id:'c',nodes:[]},{id:'a',nodes:[{type:'image',content:{sourceImageId:'f10'}}]}]}};
assert.deepEqual(captionNotes(deck),[{index:1,sourceUnitIds:['f10'],text:image.caption}]);
assert.deepEqual(captionNotes({...deck,generationPolicy:en.generationPolicy}),[],'no note for a same-language caption');
// A Chinese deck's title with no Chinese is foreign unless it is acronyms and code names (3197 85a2621c "Method · 1/2").
for(const [text,foreign] of [['Method · 1/2',true],['Related Work',true],['I-JEPA',false],['ViT-H/14',false],['CMA-ES',false],['I-JEPA 捕获局部特征',false]])assert.equal(foreignToDeck(zh,text),foreign,text);
assert.equal(foreignToDeck(en,'Method'),false,'an English deck');
console.log('PASS figure captions: short deck-language captions with the source number, the full caption in the notes, same-language captions unchanged');
