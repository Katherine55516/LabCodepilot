import MarkdownIt from 'markdown-it';
import { equationContent, mathMarkupKey, mathFallbackRuns } from './ppt-math.mjs';
export const DISPLAY_TRANSFORM_VERSION=6;
const markdown=new MarkdownIt({html:false,linkify:false,typographer:false}),cache=new Map();
const escaped=(text,at)=>{let n=0;while(at>0&&text[--at]==='\\')n++;return n%2===1;};
function mathSpanAt(s,at){
  const pair=s.startsWith('$$',at)&&!escaped(s,at)?['$$','$$',true]:s.startsWith('\\(',at)&&!escaped(s,at)?['\\(','\\)',false]:
    s.startsWith('\\[',at)&&!escaped(s,at)?['\\[','\\]',true]:s[at]==='$'&&!escaped(s,at)?['$','$',false]:null;
  if(!pair)return null;
  const [open,close,display]=pair,start=at+open.length;
  if(open==='$'&&/\s/u.test(s[start]||''))return null;
  let end=s.indexOf(close,start);while(end>=0&&escaped(s,end))end=s.indexOf(close,end+close.length);
  if(end<0)return null;
  const tex=s.slice(start,end);
  if(!tex.trim()||open==='$'&&(/\n/u.test(tex)||/\s/u.test(tex.at(-1))||/\d/u.test(s[end+1]||'')))return null;
  return {tex,source:s.slice(at,end+close.length),display,start:at,end:end+close.length};
}
// CommonMark flanking fails when a delimiter touches fullwidth punctuation
// next to Han text: **Novy-Marx（2013）**主张. The extension applies when the
// span or its immediate neighbours are CJK (Han or CJK/fullwidth punctuation).
const CJK=/[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;
const cjkContext=(s,open,close,body)=>CJK.test(body)||CJK.test(s[open-1]||'')||CJK.test(s[close]||'');
// CJK punctuation-adjacent strong emphasis is an explicit extension to
// CommonMark. Skip complete code/math spans when finding its closing delimiter;
// the Markdown parser still owns their typed payloads and the raw source stays intact.
markdown.inline.ruler.before('emphasis','ppt_cjk_strong',(state,silent)=>{
  const at=state.pos,s=state.src;
  // ***X*Y** opens strong with a nested italic first; four stars are not emphasis.
  if(!s.startsWith('**',at)||s.startsWith('**',at+2)||escaped(s,at))return false;
  let end=-1,nestedSingle=false;
  for(let i=at+2;i<s.length&&s[i]!=='\n';){
    const math=mathSpanAt(s,i);if(math){i=math.end;continue;}
    if(s[i]==='`'&&!escaped(s,i)){
      let length=1;while(s[i+length]==='`')length++;
      const delimiter='`'.repeat(length);let close=s.indexOf(delimiter,i+length);
      while(close>=0&&(s[close-1]==='`'||s[close+length]==='`'))close=s.indexOf(delimiter,close+length);
      if(close>=0){i=close+length;continue;}i+=length;continue;
    }
    if(s[i]==='\\'){i+=2;continue;}
    if(s.startsWith('**',i)){end=i+(nestedSingle&&s[i+2]==='*'?1:0);break;}
    if(s[i]==='*')nestedSingle=!nestedSingle;i++;
  }
  if(end<0)return false;
  const body=s.slice(at+2,end);
  if(!cjkContext(s,at,end+2,body)||/\n/u.test(body)||!body.trim()||/^\s|\s$/u.test(body))return false;
  if(!silent){
    state.push('strong_open','strong',1);
    const children=[];state.md.inline.parse(body,state.md,state.env,children);
    for(const child of children){child.level+=state.level;if(child.meta?.start!==undefined){child.meta.start+=at+2;child.meta.end+=at+2;}state.tokens.push(child);}
    state.push('strong_close','strong',-1);
  }
  state.pos=end+2;return true;
});
// Typed CJK italic supports punctuation-adjacent nested emphasis, never code/math.
markdown.inline.ruler.before('emphasis','ppt_cjk_emphasis',(state,silent)=>{
 const at=state.pos,s=state.src;if(s[at]!=='*'||s[at+1]==='*'||escaped(s,at))return false;
 let end=-1;for(let i=at+1;i<s.length&&s[i]!=='\n';){const math=mathSpanAt(s,i);if(math){i=math.end;continue;}if(s[i]==='\\'){i+=2;continue;}if(s[i]==='`'){let length=1;while(s[i+length]==='`')length++;const close=s.indexOf('`'.repeat(length),i+length);if(close>=0){i=close+length;continue;}}
  if(s[i]==='*'){end=i;break;}i++;}
 if(end<0)return false;const body=s.slice(at+1,end);if(!cjkContext(s,at,end+1,body)||!body.trim()||/^\s|\s$/u.test(body))return false;
 if(!silent){state.push('em_open','em',1);const children=[];state.md.inline.parse(body,state.md,state.env,children);for(const child of children){child.level+=state.level;if(child.meta?.start!==undefined){child.meta.start+=at+1;child.meta.end+=at+1;}state.tokens.push(child);}state.push('em_close','em',-1);}state.pos=end+1;return true;
});
/** Math precedes Markdown escapes/emphasis; currency and escaped dollars are text. */
markdown.inline.ruler.before('escape','ppt_math',(state,silent)=>{
  const math=mathSpanAt(state.src,state.pos);if(!math)return false;
  if(!silent){const t=state.push('ppt_math','',0);t.content=math.tex;t.meta={source:math.source,display:math.display,start:math.start,end:math.end};}
  state.pos=math.end;return true;
});
const tags=new Set(['math','semantics','mrow','mstyle','mpadded','menclose','mi','mn','mo','mtext','mspace','mfrac',
  'msub','msup','msubsup','msqrt','mroot','munder','mover','munderover','mtable','mtr','mtd','mfenced','annotation','annotation-xml']);
const ARITY={msub:2,msup:2,msubsup:3,mfrac:2,mroot:2,munder:2,mover:2,munderover:3};
/** Same structural rules as the Office math exporter: element names and
 * script/fraction arity (KaTeX's invisible U+2061 is not an argument). */
export function mathArityValid(xml){
  const stack=[{name:'root',children:[],text:''}];
  for(const token of String(xml).match(/<[^>]+>|[^<]+/gu)||[]){
    if(token.startsWith('</')){
      const node=stack.pop();if(!node||!stack.length)return true;
      const args=node.children.filter(child=>!(child.name==='mo'&&child.text.trim()==='\u2061')).length;
      if(ARITY[node.name]!==undefined&&args!==ARITY[node.name])return false;
      continue;
    }
    if(token.startsWith('<')){
      const name=token.match(/^<([\w:-]+)/u)?.[1]?.split(':').at(-1);if(!name)continue;
      const node={name,children:[],text:''};stack.at(-1).children.push(node);if(!token.endsWith('/>'))stack.push(node);continue;
    }
    stack.at(-1).text+=token;
  }
  return true;
}
function mathDiagnostic(math){
  if(!math.mathMl)return 'math_parse_unsupported';
  if([...math.mathMl.matchAll(/<([a-zA-Z][\w:-]*)\b/gu)].some(m=>!tags.has(m[1].split(':').at(-1))))return 'math_export_unsupported';
  return mathArityValid(math.mathMl)?null:'math_export_unsupported';
}
/** Raw source never changes. Plain text is a search/capacity projection;
 * typed runs carry the actual emphasis, code, links and mathematical structure. */
export function sourceRichText(value,{code=false}={}){
  const source=String(value??'');
  if(code)return {version:DISPLAY_TRANSFORM_VERSION,source,plainText:source,runs:[{kind:'text',text:source,code:true}],diagnostics:[]};
  if(cache.has(source))return structuredClone(cache.get(source));
  const runs=[],diagnostics=[],stack={bold:0,italic:0,strike:0};
  const append=(text,extra={})=>{
    if(!text)return;
    const spec={kind:'text',text,...(stack.bold?{bold:true}:{}),...(stack.italic?{italic:true}:{}),...(stack.strike?{strike:true}:{}),...extra};
    const previous=runs.at(-1);
    if(previous?.kind==='text'&&JSON.stringify({...previous,text:''})===JSON.stringify({...spec,text:''}))previous.text+=text;
    else runs.push(spec);
  };
  let href;
  const tokens=[];
  // Use the block parser so headings, lists and fenced code have semantic
  // boundaries. A code fence is data: dollars and underscores stay literal.
  let listDepth=0,ordered=0,first=true;
  const sourceLines=source.split('\n');
  for(const block of markdown.parse(source,{})){
    if(['bullet_list_open','ordered_list_open'].includes(block.type)){listDepth++;ordered=block.type==='ordered_list_open'?Number(block.attrGet('start')||1):0;}
    else if(['bullet_list_close','ordered_list_close'].includes(block.type))listDepth--;
    else if(block.type==='inline'||block.type==='fence'||block.type==='code_block'){
      if(!first)tokens.push({type:'softbreak'});first=false;
      if(listDepth){
        // Markdown renders 1, 5, 7 as 1, 2, 3. Source stage labels and
        // enumerated identifiers are facts, so keep the literal marker.
        const marker=ordered&&sourceLines[block.map?.[0]]?.match(/^\s*(\d+[.)])\s+/u)?.[1];
        tokens.push({type:'text',content:ordered?`${marker||ordered+'.'} `:'• '});
        if(ordered)ordered++;
      }
      if(block.type==='inline')tokens.push(...block.children||[]);
      else tokens.push({type:'code_inline',content:block.content.replace(/\n$/u,'')});
    }
  }
  for(const t of tokens){
    if(t.type==='strong_open')stack.bold++;else if(t.type==='strong_close')stack.bold--;
    else if(t.type==='em_open')stack.italic++;else if(t.type==='em_close')stack.italic--;
    else if(t.type==='s_open')stack.strike++;else if(t.type==='s_close')stack.strike--;
    else if(t.type==='link_open')href=t.attrGet('href');else if(t.type==='link_close')href=undefined;
    else if(t.type==='ppt_math'){
      const math=equationContent(t.content,{displayMode:t.meta.display}),issue=mathDiagnostic(math);
      if(issue)diagnostics.push({code:issue,start:t.meta.start,end:t.meta.end,source:t.meta.source});
      const fallbackRuns=math.mathMl?mathFallbackRuns(math.mathMl):[];
      runs.push({kind:'math',text:fallbackRuns.length?fallbackRuns.map(r=>r.text).join(''):t.meta.source,fallbackRuns,source:t.meta.source,tex:t.content,mathMl:math.mathMl,
        mathKey:math.mathMl?mathMarkupKey(math.mathMl):undefined,display:t.meta.display,status:issue?'unsupported':'native_math',...(stack.bold?{bold:true}:{})});
    }else if(t.type==='code_inline')append(t.content,{code:true});
    else if(t.type==='softbreak'||t.type==='hardbreak')append('\n');
    else if(t.type==='image')append(t.content);
    else if(t.type==='text')append(t.content,href?{href}:{});
  }
  for(const run of runs)if(run.kind==='text'&&!run.code&&(/\\(?:alpha|beta|gamma|lambda|sigma|epsilon|frac|sqrt|mathbb|mathbf|neq|top|begin|end)(?![A-Za-z])/u.test(run.text)||/[A-Za-z0-9][_^]\{[^}]+\}/u.test(run.text)||/[\u0370-\u03ff][_^](?:[A-Za-z0-9]|\{)/u.test(run.text)))
    diagnostics.push({code:'math_delimiter_missing',source:run.text});
  const result={version:DISPLAY_TRANSFORM_VERSION,source,plainText:runs.map(r=>r.text).join(''),runs,diagnostics};
  if(source.length<50000){if(cache.size>=512)cache.delete(cache.keys().next().value);cache.set(source,result);}
  return structuredClone(result);
}
export const sourceDisplayText=value=>sourceRichText(value).plainText.trim();
export function richTextContent(value,extra={}){
  const richText=sourceRichText(value,{code:Boolean(extra.codeBlock)});
  return {...extra,text:richText.plainText,rawText:String(value??''),richText,displayTransformVersion:DISPLAY_TRANSFORM_VERSION};
}
/** Recompute after actual edits. Imported native runs have a separate contract
 * and are not reparsed; source-owned generated content keeps its typed payload. */
export function ensureRichContent(content={}){
  if(content.mathMl||content.codeBlock)return content;
  if(Array.isArray(content.rows)){
    const valid=content.cellRich?.length===content.rows.length&&content.cellRich.every((row,r)=>row.length===content.rows[r].length&&row.every((cell,c)=>cell.version===DISPLAY_TRANSFORM_VERSION&&cell.plainText===String(content.rows[r][c])));
    if(valid)return content;
    const raw=content.rows.map((row,r)=>row.map((cell,c)=>{const previous=content.cellRich?.[r]?.[c];return previous?previous.plainText===String(cell)?previous.source:cell:content.rawRows?.[r]?.[c]??cell;})),cellRich=raw.map(row=>row.map(cell=>sourceRichText(cell)));
    return {...content,rows:cellRich.map(row=>row.map(cell=>cell.plainText)),rawRows:raw,cellRich,displayTransformVersion:DISPLAY_TRANSFORM_VERSION};
  }
  if(content.paragraphs){
    const paragraphs=content.paragraphs.map(item=>{
      const label=String(item.rawLabel??item.label??''),body=String(item.rawBody??item.body??'');
      const raw=[label?`**${label}**`:'',body].filter(Boolean).join('：');
      const richText=sourceRichText(raw);
      return {...item,label:sourceDisplayText(label),body:sourceDisplayText(body),rawLabel:label,rawBody:body,richText};
    });
    return {...content,paragraphs,text:paragraphs.map(p=>p.richText.plainText).join('\n'),displayTransformVersion:DISPLAY_TRANSFORM_VERSION};
  }
  if(typeof content.text==='string'){
    if(content.richText?.plainText===content.text&&content.richText.version===DISPLAY_TRANSFORM_VERSION)return content;
    return {...content,...richTextContent(content.richText?.plainText===content.text?content.richText.source:content.richText?content.text:content.rawText??content.text)};
  }
  if(content.items)return {...content,items:content.items.map(item=>{
    if(typeof item.text!=='string')return item;
    const raw=item.richText?.plainText===item.text?item.richText.source:item.text;
    const parts=raw.split('\n'),structured=Boolean(item.heading||item.body);
    const heading=structured?item.heading||'':parts.length>1?parts.shift():'';
    const body=structured?item.body||'':parts.join('\n');
    return {...item,...richTextContent(raw),heading:sourceDisplayText(heading),body:sourceDisplayText(body),headingRich:sourceRichText(item.headingRich?.plainText===heading?item.headingRich.source:heading),bodyRich:sourceRichText(item.bodyRich?.plainText===body?item.bodyRich.source:body)};
  })};
  return content;
}
