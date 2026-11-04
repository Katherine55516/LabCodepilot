/** Card title rules (the user, 2026-11-01, suggestions A and C): a title that
 * only labels its section (a source heading, a heading with a word or two in
 * front, or a bare join of headings) goes back for a rewrite; a deck subject
 * that leads most card titles ("I-JEPA ...") is dropped where the rest still
 * reads as a title. A leaf module: the outline writer and the final title
 * pass call it; cover, dividers, contents, takeaway and closing are theirs to
 * skip. */
const HAN=/\p{Script=Han}/u;
const PAIR=/\s+[|｜]\s+/u;
/** The half of a paired title the deck reads first: the Han half of a Chinese
 * deck, else the first. */
export function primaryTitle(title,lang='en'){
 const halves=String(title||'').split(PAIR).map(half=>half.trim()).filter(Boolean);
 if(halves.length<2)return String(title||'').trim();
 return String(lang).startsWith('zh')?halves.find(half=>HAN.test(half))||halves[0]:halves.find(half=>!HAN.test(half))||halves[0];
}
// "3.2", "第二章", "§4", "Chapter 3", "(a)", "IV." in front of a heading.
const SECTION_NUMBER=/^(?:(?:chapter|section|part)\s+\w+[.:)]?\s*|第[\d一二三四五六七八九十百]+[章节部分篇]\s*|§\s*\d+(?:\.\d+)*\s*|\(?[\da-z]{1,3}\)\s*|\d+(?:\.\d+)*[.、)]?\s+|[ivxlc]+\.\s+)/iu;
const key=text=>String(text||'').normalize('NFKC').trim().replace(SECTION_NUMBER,'').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
const words=text=>String(text||'').trim().split(/\s+/u).filter(Boolean);

/** Whether a part of a title is a heading, or a heading behind at most two
 * leading words ("I-JEPA Method" under "Method"). */
// A generic word after a heading adds nothing ("渲染导出与质量门禁机制", "Loss Mechanism").
const GENERIC_TAIL=/(?:\s+(?:mechanism|mechanisms|overview|details|summary|introduction|basics|setup|section|part)|机制|概述|概览|说明|流程|方法|原理|细节|要点|总结|介绍|内容|部分|设计|简介|概況|說明)$/iu;
function headingLike(part,keys){
 const k=key(part);if(!k)return false;
 if(keys.has(k))return true;
 const bare=String(part).replace(GENERIC_TAIL,'');
 if(bare!==String(part)&&bare.trim()&&headingLike(bare,keys))return true;
 const tokens=words(String(part).replace(/[:：]\s*/gu,' '));
 for(let drop=1;drop<=2&&drop<tokens.length;drop++)if(keys.has(key(tokens.slice(drop).join(' '))))return true;
 return false;
}
/** A title without its figure-page or continuation marker ("· Figures 2/3",
 * "· 图", "· 2/4"). */
export const unmarkedTitle=title=>String(title||'').replace(/\s*·\s*(?:(?:Figures?|图|圖)(?:\s*\d+\s*\/\s*\d+)?|\d+\s*\/\s*\d+)\s*$/iu,'').trim();
// A bare join: " and ", " & ", " · ", ",", "，", "与", "和", "及", "、".
const JOINS=/(\s+(?:and|&|·)\s+|\s*[,，]\s*(?:and\s+)?|[与和及、])/iu;
/** A title that only labels its section (suggestion A). Without source
 * headings nothing is a label: "交互与执行分离于事实源" states a point. */
export function labelLikeTitle(title,headings=[],lang='en'){
 if(listTitle(title,lang))return true;
 const keys=new Set((headings||[]).map(key).filter(Boolean));
 if(!keys.size)return false;
 // A figure page's or a continuation's marker is not part of the title ("Method · Figures").
 const primary=unmarkedTitle(primaryTitle(title,lang));
 if(headingLike(primary,keys))return true;
 // Two or more heading-like groups between joins; a heading may hold a join
 // itself ("试点方案与职责与推进" joins "试点方案" and "职责与推进").
 const pieces=primary.split(JOINS),n=Math.ceil(pieces.length/2);
 const group=(i,j)=>pieces.slice(2*i,2*j-1).join('');
 const memo=new Map(),joins=i=>{if(i===n)return true;if(memo.has(i))return memo.get(i);let ok=false;for(let j=i+1;j<=n&&!ok;j++)if(!(i===0&&j===n)&&headingLike(group(i,j),keys))ok=joins(j);memo.set(i,ok);return ok;};
 return n>=2&&joins(0);
}

/** A title that is a bare list (Fable, 2026-11-01): its main clause is 4 or
 * more noun items joined by 、/,/and/与/和/及, or 3 or more after an "X:"
 * prefix, with no predicate. A predicate shows as a long item (a list that is
 * the subject of a statement: "Vision, Memory, and a Linear Controller Form
 * the Agent") or, in Chinese, as a predicate word ("交互与执行分离于事实源"). */
const LIST_SPLIT=/\s*[、,，;；]\s*(?:and\s+|与|和|及)?|\s+(?:and|&)\s+|[与和及]/iu;
const HAN_PREDICATE=/[于是使让将把被]|提供|决定|保证|避免|导致|形成|构成|负责|完成|保留|区分|分离|依赖|包含|采用|实现|需要|能够|可以|应该|成为|带来|减少|提高|降低/u;
const EN_PREDICATE=/\b(?:is|are|was|were|be|has|have|can|could|does|do|will|may|must|should|need|needs|form|forms|make|makes|keep|keeps|use|uses)\b/iu;
export function listTitle(title,lang='en'){
 const primary=unmarkedTitle(primaryTitle(title,lang));
 const colon=primary.match(/^[^:：]{1,40}[:：]\s*(.+)$/u),clause=(colon?colon[1]:primary).trim();
 const items=clause.split(LIST_SPLIT).map(item=>item.trim()).filter(Boolean);
 if(items.length<(colon?3:4))return false;
 const han=HAN.test(clause);
 if(han)return !HAN_PREDICATE.test(clause.replace(/[、,，]/gu,''))&&items.every(item=>[...item].length<=8);
 return !EN_PREDICATE.test(clause)&&items.every(item=>words(item).length<=3);
}
// A name-like Latin token: an uppercase letter after the first character, a digit or a hyphen ("I-JEPA", "GPT-4", "MCP").
const NAME=/^(?=.*(?:^.+\p{Lu}|\d|-))[\p{L}\d][\p{L}\d.+-]*$/u;
const SEPARATED=/^(.+?)(?:\s*[:：]\s*|\s+)/u;
/** The leading words of a title that could be a deck subject, longest first. */
function leads(title,lang){
 const primary=primaryTitle(title,lang),out=[];
 const tokens=words(primary.replace(/['’]s\b/u,''));
 const names=[];for(const token of tokens.slice(0,2)){const bare=token.replace(/[:：]$/u,'');if(!NAME.test(bare))break;names.push(bare);if(bare!==token)break;}
 for(let n=names.length;n>=1;n--)out.push(names.slice(0,n).join(' '));
 // A Han subject counts only when a space or a colon sets it apart.
 if(String(lang).startsWith('zh')){const head=primary.match(SEPARATED)?.[1];if(head&&HAN.test(head)&&[...head].length<=8&&!out.includes(head))out.push(head);}
 return out;
}
/** The subject that leads at least 3 titles and 40% of them (suggestion C); ''
 * when there is none. */
export function deckSubject(titles=[],lang='en'){
 const list=(titles||[]).map(String).filter(Boolean);if(list.length<3)return '';
 const counts=new Map();
 for(const title of list)for(const lead of new Set(leads(title,lang)))counts.set(lead,(counts.get(lead)||0)+1);
 const shared=[...counts].filter(([,n])=>n>=3&&n>=.4*list.length).sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length);
 return shared[0]?.[0]||'';
}

const COMPARES=/\b(?:vs\.?|versus|compared|comparison)\b|对比|相比|比较|對比|比較/iu;
// A remainder that starts or ends on a function word is a fragment.
const DANGLING_START=/^(?:and|or|of|on|in|for|to|with|by|from|at|as|via|into|than|the|a|an)\b/iu;
const DANGLING_END=/\b(?:and|or|of|on|in|for|to|with|by|from|at|as|via|into|than|the|a|an)$/iu;
// The subject as the sentence's subject: its verb follows ("I-JEPA Learns ...").
const VERB=/^(?:is|are|was|were|has|have|had|can|could|does|did|will|may|must|should|\p{L}+(?<!s)s|\p{L}+ed)$/iu;
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
function dropFromHalf(half,subject){
 const han=HAN.test(half);
 const match=half.match(new RegExp(`^${escape(subject)}(\\s*[:：]\\s*|['’]s\\s+|\\s*的\\s*|\\s+)`,'u'));
 if(!match)return half;
 const rest=half.slice(match[0].length).trim(),separator=match[1].trim();
 // A Han rest that opens on a place word ("中的角色分工") hangs on the subject.
 if(han&&HAN.test(rest)){if([...rest.replace(/[\s\p{P}]/gu,'')].length<4||/^[中里内上下之的]/u.test(rest))return half;return rest;}
 const list=words(rest);
 if(list.length<2||DANGLING_START.test(rest)||DANGLING_END.test(rest))return half;
 if(!separator&&VERB.test(list[0].split('-').at(-1)))return half;
 return rest.charAt(0).toLocaleUpperCase()+rest.slice(1);
}
/** A title without its leading deck subject (suggestion C), or unchanged when
 * the rest is short, a fragment, or compares the subject with something. */
export function dropDeckSubject(title,subject,lang='en'){
 const text=String(title||'');
 if(!subject||COMPARES.test(text))return text;
 return text.split(/(\s+[|｜]\s+)/u).map((half,k)=>k%2?half:dropFromHalf(half,subject)).join('');
}

// "表格列出…", "本页展示…", "This table lists…", "Figure 5 shows…".
const FORMAT=/^(?:(?:表格|本表|下表|该表|此表|图表|图示|本图|该图|此图|本页|該表|此頁|本頁)\s*(?:列出|展示|显示|顯示|说明|說明|给出|給出|呈现|呈現|对比|對比)|(?:this|the|a)\s+(?:table|figure|chart|diagram|slide|page)\s+(?:lists?|shows?|presents?|displays?|compares?|summari[sz]es?)\b|(?:figure|fig\.|table)\s*\d+[a-z]?\s+(?:shows?|lists?|presents?|displays?|compares?)\b)/iu;
/** A title that names the page's format instead of its point (2026-11-01:
 * B's "表格列出代理转发路径、含义与源码行" on the docx deck, "Figure 5 shows
 * the flow diagram of a VAE" on World Models). */
export function formatTitle(title,lang='en'){
 return FORMAT.test(unmarkedTitle(primaryTitle(title,lang)));
}

/* The deck title standard (Fable, 2026-11-02, N5): an English title of 3-9
 * words with a verb, a Chinese one of 8-20 characters with a predicate, no
 * bare single-letter symbol. Abbreviations and one form per chapter are deck
 * checks (deckTitleIssues in ppt-card-retitle.mjs). */
// Han characters count one each, a Latin word or a number counts one.
const titleUnits=text=>(String(text).match(/\p{Script=Han}/gu)||[]).length+(String(text).match(/[A-Za-z0-9][A-Za-z0-9.+\-]*/gu)||[]).length;
// Markers that make a Chinese title a statement on their own.
const ZH_PREDICATE=/[是为让使把将被能可会需要须应必均都也才就不无未已并则即仍只再更越了着过]|优于|高于|低于|多于|少于|取决|依赖|依靠|基于|用于|来自|属于|成为|变为|决定|确保|保证|导致|带来/u;
// Nouns that carry such a marker character ("用户", "功能", "需求").
const ZH_NOUNS=/用户|应用|作用|费用|能力|性能|功能|智能|可视|可靠|需求|要点|要求|主要|重要|不同|过程|为止|无论/gu;
const ZH_VERBS=/支持|实现|提供|通过|采用|负责|形成|构成|包含|覆盖|完成|达到|超过|取代|替代|统一|驱动|生成|输出|转化|转换|提取|保持|保留|避免|解决|加速|简化|缩短|扩展|分离|关联|领取|执行|指定|转发|约束|阻断|重建|承载|分析|检查|提升|降低|减少|增加|改善|优化|预测|学习|训练|控制|匹配|对齐|分配|调度|校验|验证|发布|导出|渲染|合并|拆分|拒绝|允许|限制|隔离|记录|追踪|显示|证明|表明|揭示|发现|区分|连接|接入|调用|返回|触发|处理|管理|维护|衔接|回退|删除|同步|存储|读取|写入|计算|估计|衡量|影响|帮助|编码|解码|压缩|聚合|编排|规划|评估|选择|识别|定位|修复|部署|迁移|复用|共享|集成|组合|构建|创建|定义|描述|解释|扩充|填充|放置|呈现|保障|落地|推进|抽取|拼接|过滤|排序|缓存|加载|切换|升级|告警|拦截/u;
// A title ending on one of these heads is a label even when a verb modifies it ("渲染导出质量门禁").
const ZH_LABEL_HEAD=/(?:门禁|证据|分支|含义|流程|机制|方案|策略|体系|架构|模块|框架|概述|原理|规则|公式|一致性|要点|总结|简介|介绍|说明|细节|设计|思路|清单|示例|案例|结构|步骤|方法|逻辑|指标|对比|关系|概念|定义|算法|配置|接口|速查)$/u;
function zhPredicate(text){
 const bare=String(text).replace(ZH_NOUNS,'');
 if(ZH_PREDICATE.test(bare))return true;
 const verb=bare.match(ZH_VERBS);if(!verb)return false;
 // "来源表示的逐层转化": a verb only after the last 的 is a noun phrase's head.
 const of=bare.lastIndexOf('的');if(of>=0&&!ZH_VERBS.test(bare.slice(0,of)))return false;
 // A verb that opens the title and a label head that ends it are a label
 // ("渲染导出质量门禁"); a verb after its subject is a predicate even before a
 // noun ("代理转发调用业务接口").
 return verb.index>=2||!ZH_LABEL_HEAD.test(bare.replace(/[\s\p{P}]+$/u,''));
}
// Base forms of verbs a title may use; any inflection matches (verbBase).
export const VERB_BASES=new Set('find yield use aid help show drive enable improve reduce require make keep let give take beat outperform learn predict match avoid cut add turn become stay need get put set run win fail support provide allow build create produce combine separate split replace raise lower boost speed simplify depend rely connect guide shape define explain solve handle choose select remove limit protect prevent ensure lead follow start stop check test measure compare differ change grow shrink save lose gain hold move pass block stabilize accelerate unify extend capture encode decode compress generate train transfer survive fit refine scale visualize probe outrank exceed matter work act read write store route plan sample dream control map align fuse mask collapse converge emerge rise fall drop double halve cost cooperate interact operate evolve iterate deploy remain prove reveal demonstrate suggest indicate imply outlast trade balance cover track flag link split merge serve recover restore retain reach'.split(' '));
export function verbBase(word){
 const w=String(word||'').toLowerCase();
 return [w,w.replace(/s$/u,''),w.replace(/es$/u,''),w.replace(/ies$/u,'y'),w.replace(/ed$/u,''),w.replace(/d$/u,''),w.replace(/ied$/u,'y'),w.replace(/ing$/u,''),w.replace(/ing$/u,'e'),w.replace(/(.)\1(?:ed|ing)$/u,'$1')].find(form=>VERB_BASES.has(form))||'';
}
const EN_VERBS=new Set(['is','are','was','were','be','been','being','can','could','will','would','should','must','may','might','does','do','did','has','have','had','lets','let','makes','keeps','needs','uses','helps','turns','becomes','stays','drives','cuts','adds','beats','outperforms','fails','wins','runs','sets','puts','gets','takes','gives','shows','finds','learns','predicts','reduces','improves','enables','requires','replaces','matches','avoids','yields']);
const EN_IMPERATIVE=new Set(['use','train','keep','run','add','build','choose','start','define','combine','avoid','measure','split','separate','put','let','treat','prefer','replace','check','make','give','move','stop','plan','test','ship','start']);
// Plural nouns that read as verbs by their ending.
const EN_PLURAL=/^(?:effects|scores|models|methods|features|metrics|benefits|risks|details|findings|settings|components|parameters|requirements|experiments|procedures|techniques|insights|challenges|tradeoffs|trade-offs|applications|implications|limitations|contributions|considerations|options|steps|rules|tools|layers|tests|tasks|goals|gains|results|pages|cards|tables|figures|slides|points|sources|items|users|agents|views|systems|templates|decks|titles|errors|issues|losses|costs|rates|values|weights|inputs|outputs|stages|phases|levels|types|modes|roles|files|terms|words|notes|ideas|images|frames)$/iu;
// A word after a determiner is a noun ("In This Work", 3222 mood-board p4).
const EN_NOT_VERB_BEFORE=new Set(['the','a','an','of','and','or','for','with','on','in','to','by','its','their','our','your','his','her','my','this','that','these','those','each','every','some','any','no','from','at','as','into','over','under','vs','versus']);
/** Whether a title word is a verb where it stands: be/have/a modal or a listed
 * form, or a lexicon verb not after a determiner; never an -ing form or a
 * plural noun ("Results"). */
/** A discourse opener that names nothing ("In this work, …"): a title starts after it. */
export const TITLE_OPENER=/^(?:in|on|at|for)\s+(?:this|our|the\s+present|the\s+following)\s+(?:work|paper|study|article|figure|section|setup|experiment|chapter)\s*,\s*/iu;
export function titleVerbWord(word,previous=''){
 const w=String(word||'').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'').toLowerCase();
 if(!w||/ing$/u.test(w)||EN_PLURAL.test(w))return false;
 return EN_VERBS.has(w)||Boolean(verbBase(w))&&!EN_NOT_VERB_BEFORE.has(String(previous||'').replace(/[^\p{L}]+/gu,'').toLowerCase());
}
function enVerb(text){
 const list=String(text).split(/\s+/u).map(word=>word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'')).filter(Boolean);
 if(list.length&&EN_IMPERATIVE.has(list[0].toLowerCase()))return true;
 return list.some((word,k)=>{
  const w=word.toLowerCase();if(EN_VERBS.has(w))return true;
  // A lexicon verb after its subject ("JEPAs Predict Embeddings"), not a noun after a determiner ("the Use of").
  if(k>=1&&verbBase(w)&&!/ing$/u.test(w)&&!EN_NOT_VERB_BEFORE.has(list[k-1].toLowerCase()))return true;
  if(k<1||k===list.length-1||w.length<4||!/[a-z]s$/u.test(w)||/(?:ss|us|is|ics|ous)$/u.test(w)||EN_PLURAL.test(w))return false;
  return !EN_NOT_VERB_BEFORE.has(list[k-1].toLowerCase())&&!['of','and','or'].includes(list[k+1].toLowerCase());
 });
}
// A bare one-letter symbol ("W", "z"); not the article "a", "A" or "I", nor the Chinese "B 端"/"C 端".
const BARE_LETTER=/(?:^|[^\p{L}\p{N}_-])(?![aAI](?:$|[^\p{L}\p{N}]))([A-Za-z])(?=$|[^\p{L}\p{N}_-])(?!\s*端)/u;
/** The reasons a content-page title misses the standard; [] when it meets it. */
export function titleStandardIssues(title,lang='en'){
 const text=unmarkedTitle(primaryTitle(title,lang)),issues=[];if(!text)return ['empty'];
 const han=HAN.test(text);
 if(han){const n=titleUnits(text);if(n<8)issues.push('short');else if(n>20)issues.push('long');if(!zhPredicate(text))issues.push('no_predicate');}
 else{const n=words(text).length;if(n<3)issues.push('short');else if(n>9)issues.push('long');if(!enVerb(text))issues.push('no_verb');}
 if(BARE_LETTER.test(text))issues.push('bare_symbol');
 return issues;
}
// Abbreviations everyone reads without a definition.
const KNOWN_ABBREVIATIONS=new Set(['AI','API','APIS','PPT','PDF','URL','UI','UX','ID','IDS','CPU','GPU','LLM','LLMS','JSON','HTTP','HTTPS','SQL','CSV','HTML','CSS','SDK','IT','HR','CEO','CTO','KPI','KPIS','ROI','FAQ','PC','OS','IP','USB','RAM','2D','3D','Q1','Q2','Q3','Q4','OK','PPTX','DOCX','XLSX','MD','CLI','IDE','APP','B2B','B2C','SaaS','SAAS','ML','NLP','CV','RL','QA']);
/** The abbreviations of a title ("MCP", "I-JEPA", "CMA-ES"): two or more capitals. */
export function titleAbbreviations(title,lang='en'){
 return [...new Set((unmarkedTitle(primaryTitle(title,lang)).match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/gu)||[]))].filter(token=>!/[a-z]/u.test(token)&&(token.match(/[A-Z]/gu)||[]).length>=2).filter(abbr=>!KNOWN_ABBREVIATIONS.has(abbr.toUpperCase())&&!/^\d/u.test(abbr));
}
/** Whether a text defines an abbreviation: "Model Context Protocol (MCP)" or "MCP (Model Context Protocol)". */
export function definesAbbreviation(text,abbr){
 const a=escape(abbr);
 return new RegExp(`[(（]\\s*${a}\\s*[)）]|(?<![\\p{L}\\p{N}])${a}\\s*[(（][^)）]{3,}[)）]|(?<![\\p{L}\\p{N}])${a}\\s*(?:stands for|means|refers to|即|指|是指|全称)`,'u').test(String(text||''));
}
/** A title's form: a question, a "label: rest" line, or a statement. */
export function titleForm(title,lang='en'){
 const text=unmarkedTitle(primaryTitle(title,lang));
 return /[?？]\s*$/u.test(text)?'question':/[:：]/u.test(text)?'colon':'statement';
}
