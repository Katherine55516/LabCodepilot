// Card title rules (the user, 2026-11-01, suggestions A and C): label-like
// titles are found; a deck subject leading most titles is dropped where the
// rest still reads as a title.
import assert from 'node:assert/strict';
import {primaryTitle,labelLikeTitle,deckSubject,dropDeckSubject,unmarkedTitle,formatTitle,listTitle} from './lib/ppt-card-title-rules.mjs';

// The half a deck reads first.
assert.equal(primaryTitle('Method Overview | 方法概览','en'),'Method Overview');
assert.equal(primaryTitle('Method Overview | 方法概览','zh'),'方法概览');
assert.equal(primaryTitle('方法概览','en'),'方法概览');

// A: a heading, a heading behind one or two words, or a join of headings.
const headings=['3.1 Method','Experiments','Related Work','背景与目标','试点方案','职责与推进','2. Results'];
assert.equal(labelLikeTitle('Method',headings,'en'),true,'equals a heading without its number');
assert.equal(labelLikeTitle('method.',headings,'en'),true,'case and punctuation aside');
assert.equal(labelLikeTitle('I-JEPA Method',headings,'en'),true,'a heading behind one word');
assert.equal(labelLikeTitle('I-JEPA: Experiments',headings,'en'),true,'a heading behind a colon');
assert.equal(labelLikeTitle('The Proposed I-JEPA Method',headings,'en'),false,'three leading words are a title');
assert.equal(labelLikeTitle('Method and Experiments',headings,'en'),true,'a bare join of headings');
assert.equal(labelLikeTitle('Method & Results',headings,'en'),true);
assert.equal(labelLikeTitle('Predicting in Representation Space Avoids Pixel Detail',headings,'en'),false,'a statement passes');
assert.equal(labelLikeTitle('Method and Its Limits',headings,'en'),false,'a join with a part that is no heading passes');
assert.equal(labelLikeTitle('背景与目标',headings,'zh'),true);
assert.equal(labelLikeTitle('试点方案与职责与推进',headings,'zh'),true,'a join of Chinese headings');
assert.equal(labelLikeTitle('试点方案和职责与推进',headings,'zh'),true);
assert.equal(labelLikeTitle('交互与执行分离于事实源',headings,'zh'),false,'a Chinese statement with 与 passes');
assert.equal(labelLikeTitle('交互与执行分离于事实源',[],'zh'),false,'without headings nothing is a label');
assert.equal(labelLikeTitle('Results | 结果',headings,'en'),true,'the primary half is judged');
assert.equal(labelLikeTitle('结果说明了什么 | Results',headings,'zh'),false,'a Chinese deck judges the Han half');

// C: the subject that leads at least 3 titles and 40% of them.
const jepa=['I-JEPA Predicts Representations of Masked Blocks','I-JEPA Architecture Overview','I-JEPA: Multi-block Masking Strategy','Context Encoder Sees Only Visible Patches','I-JEPA Converges in Fewer Epochs','Linear Probing on ImageNet-1K'];
assert.equal(deckSubject(jepa,'en'),'I-JEPA');
assert.equal(deckSubject(jepa.slice(0,2),'en'),'','fewer than three titles');
assert.equal(deckSubject(['I-JEPA Architecture','Encoder Details','Masking Strategy','Training Setup','Probe Results','Scaling Behaviour','Ablations'],'en'),'','one title is no subject');
assert.equal(deckSubject(['World Models Learn Fast','World Models in Dreams','World Models Scale'],'en'),'','ordinary words are no name');
assert.equal(deckSubject(['MCP 为 AI 应用提供接口','MCP 中的角色分工','MCP 的执行顺序','排错要区分失败类型'],'zh'),'MCP','a Latin name in a Chinese deck');
assert.equal(deckSubject(['知识库：试点范围','知识库：分工维护','知识库：评估标准','复核质量后再扩展'],'zh'),'知识库','a Han subject set apart by a colon');
assert.equal(deckSubject(['知识库试点范围','知识库分工维护','知识库评估标准'],'zh'),'','a Han subject must be set apart');

// C: dropping the subject where the rest stands as a title.
assert.equal(dropDeckSubject('I-JEPA Architecture Overview','I-JEPA','en'),'Architecture Overview');
assert.equal(dropDeckSubject('I-JEPA: Multi-block Masking Strategy','I-JEPA','en'),'Multi-block Masking Strategy');
assert.equal(dropDeckSubject("I-JEPA's Predictor Is a Narrow ViT",'I-JEPA','en'),'Predictor Is a Narrow ViT');
assert.equal(dropDeckSubject('I-JEPA Predicts Representations of Masked Blocks','I-JEPA','en'),'I-JEPA Predicts Representations of Masked Blocks','the subject of its verb stays');
assert.equal(dropDeckSubject('I-JEPA Converges in Fewer Epochs','I-JEPA','en'),'I-JEPA Converges in Fewer Epochs');
assert.equal(dropDeckSubject('I-JEPA Overview','I-JEPA','en'),'I-JEPA Overview','one word left is too short');
assert.equal(dropDeckSubject('I-JEPA Fine-tunes Near MAE Using 5.3 Times Less Epochs','I-JEPA','en'),'I-JEPA Fine-tunes Near MAE Using 5.3 Times Less Epochs','a hyphenated verb keeps its subject (JEPA on Blue)');
assert.equal(dropDeckSubject('I-JEPA Predictor and Loss for Target Block Representations','I-JEPA','en'),'Predictor and Loss for Target Block Representations');
assert.equal(dropDeckSubject('I-JEPA vs MAE on Linear Probing','I-JEPA','en'),'I-JEPA vs MAE on Linear Probing','a comparison keeps its subject');
assert.equal(dropDeckSubject('I-JEPA: and Its Limits','I-JEPA','en'),'I-JEPA: and Its Limits','a fragment stays');
assert.equal(dropDeckSubject('Context Encoder Sees Only Visible Patches','I-JEPA','en'),'Context Encoder Sees Only Visible Patches','a title without the subject is unchanged');
assert.equal(dropDeckSubject('MCP 中的角色分工','MCP','zh'),'MCP 中的角色分工','a rest that opens on a place word stays');
assert.equal(dropDeckSubject('MCP 为 AI 应用提供共同接口','MCP','zh'),'为 AI 应用提供共同接口');
assert.equal(dropDeckSubject('MCP 的执行顺序','MCP','zh'),'执行顺序','"的" after the subject goes too');
assert.equal(dropDeckSubject('MCP 与 REST 对比','MCP','zh'),'MCP 与 REST 对比','a Chinese comparison keeps its subject');
assert.equal(dropDeckSubject('MCP 中的角色','MCP','zh'),'MCP 中的角色','under four Han characters left');
assert.equal(dropDeckSubject('知识库：评估标准与扩展节奏','知识库','zh'),'评估标准与扩展节奏');
assert.equal(dropDeckSubject('I-JEPA Architecture Overview | I-JEPA 架构概览','I-JEPA','en'),'Architecture Overview | 架构概览','both halves of a paired title');
assert.equal(dropDeckSubject('Architecture','','en'),'Architecture','no subject, no change');
// Markers are not part of the title; a format title names the page, not its point (Blue round on 6302be0e).
assert.equal(unmarkedTitle('Method · Figures'),'Method');
assert.equal(unmarkedTitle('I-JEPA Converges Faster · Figures 2/3'),'I-JEPA Converges Faster');
assert.equal(unmarkedTitle('表格列出代理转发路径 · 1/4'),'表格列出代理转发路径');
assert.equal(unmarkedTitle('背景与目标 · 图'),'背景与目标');
assert.equal(labelLikeTitle('Method · Figures',headings,'en'),true,'a figure page titled by its section');
assert.equal(labelLikeTitle('E. RCDM Visualizations · Figures',['E. RCDM Visualizations'],'en'),true,'an appendix letter is a section number');
assert.equal(labelLikeTitle('I-JEPA Converges Faster · Figures',headings,'en'),false);
assert.equal(formatTitle('表格列出代理转发路径、含义与源码行 · 1/4','zh'),true);
assert.equal(formatTitle('表格列出各页面分支由代码或写手执行的方式','zh'),true);
assert.equal(formatTitle('本页展示四层容量证据','zh'),true);
assert.equal(formatTitle('Figure 5 shows the flow diagram of a VAE','en'),true);
assert.equal(formatTitle('This table lists the proxy routes','en'),true);
assert.equal(formatTitle('代理按处理器转发请求并校验身份与容量','zh'),false);
assert.equal(formatTitle('Tables Belong in the Appendix When Uncited','en'),false);
// Bare lists are labels (Fable, 2026-11-01); a list that is a statement's subject is not.
assert.equal(listTitle('渲染导出与质量门禁的机制、阻断、审查、绑定、诊断与支持对象','zh'),true);
assert.equal(listTitle('模型执行协议：错误恢复、结构化输出、任务桥、队列与支路','zh'),true);
assert.equal(listTitle('卡片数量、共享测量、槽位容量、语言识别与合并成本','zh'),true);
assert.equal(listTitle('I-JEPA Method: Encoders, Targets, Context, Prediction and Loss','en'),true);
assert.equal(labelLikeTitle('I-JEPA Method: Encoders, Targets, Context, Prediction and Loss',[],'en'),true,'a list is a label without headings too');
assert.equal(listTitle('交互与执行分离于事实源','zh'),false);
assert.equal(listTitle('Vision, Memory, and a Linear Controller Form the Agent','en'),false);
assert.equal(listTitle('I-JEPA Converges Faster and Scales with Data and Size','en'),false);
assert.equal(listTitle('Encoders, Targets and Loss','en'),false,'three items without a prefix');
assert.equal(listTitle('Setup: Encoders, Targets and Loss','en'),true,'three items after a prefix');
assert.equal(listTitle('代码负责结构与检查，模型在约束下写卡','zh'),false);
assert.equal(listTitle('支持团队、产品团队和运营同事分工维护知识库','zh'),false,'a Chinese list as a subject');
// A heading with a generic word after it is a label (CodePilot PDF and JEPA on Blue, main c9a5f6e8).
assert.equal(labelLikeTitle('渲染导出与质量门禁机制',['8. 渲染、导出与质量门禁'],'zh'),true);
assert.equal(labelLikeTitle('Method Overview',headings,'en'),true);
assert.equal(labelLikeTitle('I-JEPA Predictor Mechanism',['Predictor'],'en'),true,'a leading word and a generic tail');
assert.equal(labelLikeTitle('渲染导出在质量门禁前完成',['8. 渲染、导出与质量门禁'],'zh'),false,'a statement about the section passes');
// Two headings joined by a comma are a label too (Fable D6, 2026-11-01).
assert.equal(labelLikeTitle('Method, Experiments',headings,'en'),true);
assert.equal(labelLikeTitle('试点方案，职责与推进',headings,'zh'),true);
assert.equal(labelLikeTitle('Method, Then Experiments Confirm It',headings,'en'),false);
console.log('PASS card title rules: label-like titles, the deck subject, and dropping it where the rest stands; markers, format titles and bare lists');
