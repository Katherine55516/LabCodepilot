/* eslint-disable @typescript-eslint/no-explicit-any -- Parsed source fixtures are partial JavaScript objects. */
import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {backMatterBasis,markBackMatterImages,mergeLayoutContinuations,dehyphenateLayout,withSemanticIndex} from '../../../apps/cowork-server/lib/ppt-semantic.mjs';
import {analyzeSourceStructure,planCardDeck,pagesFor,deckLanguageOnly,mathBars} from '../../../apps/cowork-server/lib/ppt-card-outline.mjs';
import {figureTitleAlone} from '../../../apps/cowork-server/lib/ppt-card-figure-layout.mjs';
import {tableCardPointNotes} from '../../../apps/cowork-server/lib/ppt-card-language.mjs';
import {regionArtwork} from '../../../apps/cowork-server/lib/ppt-media-preserving-layout.mjs';

const block=(id:string,type:string,text:string,section:string[],page=1):any=>({id,type,text,sectionPath:section,location:`PDF 第 ${page} 页`,sourceRefs:[String(page)],tokenCount:Math.ceil(text.length/4),position:0});

describe('back matter and PDF layout units',()=>{
 it('recognises bibliography, acknowledgements and appendix headings in any nesting',()=>{
  assert.equal(backMatterBasis(['World Models','References']),'bibliography');
  assert.equal(backMatterBasis(['Paper','Acknowledgements']),'acknowledgements');
  assert.equal(backMatterBasis(['Paper','A. Appendix','A.1 Encoder']),'appendix');
  assert.equal(backMatterBasis(['报告','附录']),'appendix');
  assert.equal(backMatterBasis(['Paper','3. Car Racing Experiment']),null);
  assert.equal(backMatterBasis(['Paper','Appendix of results discussed in the body']),null);
 });
 it('excludes only figures that live in back matter and are not cited by the body',()=>{
  const blocks=[block('b1','paragraph','As Figure 19 shows, memory forms.',['P','7. Discussion'],12),block('h1','heading','A. Appendix',['P','A. Appendix'],13),block('b2','paragraph','Appendix text.',['P','A. Appendix'],14)];
  const images=[{id:'i19',caption:'Figure 19. How information becomes memory.',location:'PDF 第 13 页'},{id:'i22',caption:'Figure 22. Tensor shapes.',location:'PDF 第 13 页'},{id:'i25',caption:'Figure 25. Histogram.',location:'PDF 第 14 页'},{id:'i5',caption:'Figure 5. VAE.',location:'PDF 第 3 页'},{id:'i26',caption:'Figure 26. Requested.',location:'PDF 第 14 页',mustDisplay:true}];
  const marked=markBackMatterImages(images,blocks);
  assert.deepEqual(marked.filter((i:any)=>i.presentation).map((i:any)=>i.id),['i22','i25']);
 });
 it('rebuilds PDF sentences, numbered procedures and hyphenated words across layout breaks',()=>{
  const s=['P','4. VizDoom'];
  const merged=mergeLayoutContinuations([
   block('b1','list','1. Collect rollouts.\n2. Train VAE (V) to encode each frame into',s,7),
   block('b2','paragraph','z, the latent space representation.',s,7),
   block('b3','list','3. Train MDN-RNN (M) to model',s,7),
   block('b4','paragraph','P(z_{t+1} | a_t, z_t).',s,8),
   block('b5','paragraph','A new paragraph with knowl-\nedge of model- based methods.',s,8),
   block('b6','paragraph','Different section text.',['P','5. Iterative'],8),
  ]);
  assert.equal(merged.length,3);
  assert.match(merged[0].text,/^1\. Collect[\s\S]*2\. Train[\s\S]*latent space representation\.\n3\. Train MDN-RNN \(M\) to model P\(z_\{t\+1\}/u);
  assert.equal(merged[0].type,'list');
  assert.equal(merged[1].text,'A new paragraph with knowledge of model-based methods.');
  assert.deepEqual(merged[0].sourceRefs,['7','8']);
 });
 it('does not merge non-PDF sources or complete sentences',()=>{
  const md={...block('m1','paragraph','No terminal punctuation',['P','S'],1),location:''};
  const md2={...block('m2','paragraph','next text',['P','S'],1),location:''};
  assert.equal(mergeLayoutContinuations([md,md2]).length,2);
  assert.equal(mergeLayoutContinuations([block('a','paragraph','Done.',['P','S']),block('b','paragraph','Next starts.',['P','S'])]).length,2);
  assert.equal(dehyphenateLayout('self- driving cars use defi- ciencies'),'self-driving cars use deficiencies');
 });
 it('the card plan folds the Abstract into the next section and leaves out back matter (appendix kept only at full length)',()=>{
  const text='# Paper\n## Abstract\nWe study models.\n## 1. Introduction\nIntro claim one.\n## 2. Method\nMethod detail.\n## 3. Results\nResult detail.\n## 4. Discussion\nDiscussion detail.\n## Acknowledgements\nThanks all.\n## A. Appendix\nExtra detail.\n## References\nSmith 2020.';
  const source=withSemanticIndex({kind:'file',segments:[{id:'1',location:'PDF 第 1 页',text}],images:[]} as any);
  const p:any={source,generationPolicy:{version:2,content:'overview'},planningContract:{},inputUnderstanding:{primaryLanguage:'en'}};
  const structure=analyzeSourceStructure(p);
  const intro=structure.sections.find((s:any)=>s.title==='Introduction');
  assert.ok(intro&&intro.ids.length===2,'abstract units join the introduction');
  assert.ok(!structure.sections.some((s:any)=>/abstract/i.test(s.title)));
  const titles=(preset:string)=>planCardDeck(p,structure,{preset}).logicalCards.map((c:any)=>c.title);
  assert.deepEqual(titles('standard').filter((t:string)=>/Appendix|References|Acknowledg/u.test(t)),[]);
  assert.ok(titles('full').some((t:string)=>/Appendix/u.test(t)));
 });
 it('a length keeps its cards and adds the closing page on top',()=>{
  // 4 sections at standard: 3 cards met the 6-page minimum with padding before; the closing must not take that card.
  // No takeaway page (the user, 2026-10-31): the minimum is met with one more card.
  assert.deepEqual(pagesFor('standard',3),{content:5,dividers:0,takeaway:false,closing:true,total:7});
  assert.equal(pagesFor('standard',10).total,1+10+1+1,'cover, cards, one table of contents, closing');
 });
 it('a monolingual deck closes in its own language only',()=>{
  const en='We train the agent inside its own dream and transfer the policy back. 我们在梦境中训练智能体。';
  assert.equal(deckLanguageOnly(en,'en'),'We train the agent inside its own dream and transfer the policy back.');
  assert.equal(deckLanguageOnly('世界模型压缩了环境。 World models compress the environment.','zh-CN'),'世界模型压缩了环境。');
  assert.equal(deckLanguageOnly('Only English here. Twice.','en'),'Only English here. Twice.');
  assert.equal(deckLanguageOnly('全部是中文。','en'),'全部是中文。','a wholly foreign statement is left for the title check');
 });
 it('a template photo in the content region is artwork on frame pages only',()=>{
  const E=914400,photo={id:'i16',type:'image',nativeRef:{shapeId:16},geometry:{x:7*E,y:3.5*E,width:5*E,height:2.8*E},content:{mediaRole:'template_decoration',dataUrl:'data:image/png;base64,AA=='}};
  const icon={id:'i17',type:'image',nativeRef:{shapeId:17},geometry:{x:1*E,y:3*E,width:.25*E,height:.25*E},content:{mediaRole:'template_icon',dataUrl:'data:image/png;base64,AA=='}};
  const page={nodes:[photo,icon],slots:[]},canvas={x:.7*E,y:1.8*E,width:11.9*E,height:5.2*E};
  const project=(outline:any[]):any=>({planningContract:{version:3},outline,templateFidelity:{width:13.333*E,height:7.5*E,slides:[page,page,page,page]}});
  const p=project([{title:'Cover'},{title:'A card',keyPoints:[{text:'x'}]},{title:'Chapter',cardFrame:'divider'},{title:'Thank you',role:'closing'}]);
  assert.deepEqual(regionArtwork(p,1,canvas).artwork,[],'a content card retires the photo');
  assert.equal(regionArtwork(p,1,canvas).icons.length,1,'icons are unaffected');
  assert.equal(regionArtwork(p,2,canvas).artwork.length,1,'a divider keeps it');
  assert.equal(regionArtwork(p,3,canvas).artwork.length,1,'the closing keeps it');
 });
 it('a lone remaining figure page drops its counter without a dangling separator',()=>{
  assert.equal(figureTitleAlone('A Small Controller Acts on World Model · 1/2'),'A Small Controller Acts on World Model');
  assert.equal(figureTitleAlone('Temperature Controls Dream · Figures 2/2'),'Temperature Controls Dream · Figures');
  assert.equal(figureTitleAlone('世界模型 · 图 1/2'),'世界模型 · 图');
 });
 it('a conditional bar inside a formula never reads as the bilingual separator',()=>{
  const text='建模$P(z_{t+1} | a_{t}, h_{t})$ | Model $P(z | a)$';
  assert.equal(mathBars(text),'建模$P(z_{t+1} \\mid a_{t}, h_{t})$ | Model $P(z \\mid a)$');
  assert.equal(mathBars(text).split(/\s+\|\s+/u).length,2);
  assert.equal(mathBars('No math | 没有公式'),'No math | 没有公式');
 });
 it('points moved off a table card are that page\'s speaker notes',()=>{
  const p:any={outline:[{id:'c'},{id:'t',notePoints:[{text:'Third point',sourceUnitIds:['u3']},{text:'Fourth point',sourceUnitIds:['u4']}]}],deck:{slides:[{id:'c'},{id:'t'}]}};
  assert.deepEqual(tableCardPointNotes(p),[{index:1,sourceUnitIds:['u3','u4'],text:'• Third point\n• Fourth point'}]);
  assert.deepEqual(tableCardPointNotes({outline:[{id:'c'}],deck:{slides:[{id:'c'}]}} as any),[]);
  // The confirmed outline drops notePoints; the card plan keeps them by page id.
  const planned:any={outline:[{id:'c'},{id:'t'}],planningContract:{cardOutline:{raw:{slides:[{id:'c'},{id:'t',notePoints:[{text:'Moved',sourceUnitIds:['u5']}]}]}}},deck:{slides:[{id:'c'},{id:'t'}]}};
  assert.deepEqual(tableCardPointNotes(planned),[{index:1,sourceUnitIds:['u5'],text:'• Moved'}]);
 });
});
