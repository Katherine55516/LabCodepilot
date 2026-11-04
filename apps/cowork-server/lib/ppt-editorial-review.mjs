/** Deterministic editorial blockers complement physical bounds and source ledger.
 * A model critic cannot waive observed duplicates or mismatched table fragments. */
import { visibleNodes, nodeContentText } from './ppt-visible-content.mjs';
import { sourceDisplayText, sourceRichText } from './ppt-source-text.mjs';
import { sourceSentences } from './ppt-source-boundaries.mjs';
import {ensureRichContent} from './ppt-rich-text.mjs';
const key=text=>sourceDisplayText(text).normalize('NFKC').replace(/\s+/gu,'').toLowerCase();
const shingles=text=>new Set(Array.from({length:Math.max(0,text.length-7)},(_,i)=>text.slice(i,i+8)));
export function inspectEditorial(project,slides=project.deck?.slides||[]){
  const issues=[],seen=new Map(),items=project.source?.semantic?.inventory?.items||[];
  const add=(code,slide,message,nodeIds=[])=>issues.push({code,severity:'error',repairable:true,slideId:slide.id,nodeIds,message});
  for(const slide of slides){
    const here=new Map(),paragraphs=[],sentences=[];
    for(const original of visibleNodes(slide)){
      const node=original.nativeRef?original:{...original,content:ensureRichContent(original.content)};
      if(node.content?.mathStatus&&node.content.mathStatus!=='native_math')add('math_parse_unsupported',slide,'Block formula could not be parsed; raw source fallback is not an export pass.',[node.id]);
      const rich=[node.content?.richText,...(node.content?.cellRich||[]).flat(),...(node.content?.items||[]).map(i=>i.richText)].filter(Boolean);
      if(!rich.length&&node.type==='text'&&!node.nativeRef&&!node.content?.mathMl&&!node.content?.codeBlock)rich.push(sourceRichText(node.content?.rawText??node.content?.text));
      for(const value of rich)for(const diagnostic of value.diagnostics||[])add(diagnostic.code,slide,'Mathematical notation has no verified display/export representation. Preserve source and repair the typed formula before publication.',[node.id]);
      if(['title','section','page-number','template-title'].includes(node.semanticRole)||node.content?.codeBlock)continue;
      const text=nodeContentText(node),normalized=key(text);
      if (!node.sourceArtifact && node.semanticRole === 'source-explanation' && /\b(?:c_\d{3,}|b_\d{4,}|source-quote-[a-f0-9]{8,})\b/u.test(text)
          && !String(project.source?.text || '').includes(text.trim()))
        add('writer_process_metadata',slide,'Internal source IDs are visible in generated explanation. State the supported relationship directly; keep provenance IDs in source metadata and notes.',[node.id]);
      if(node.semanticRole==='source-explanation'&&/^(?:this slide (?:explains|presents|will)|(?:the )?source (?:establishes|explains|defines|describes)|本页(?:将|会|旨在)|来源(?:已经|说明|建立))/iu.test(text.trim()))
        add('writer_process_metadata',slide,'Visible copy describes the authoring process rather than the actual source-supported relationship. State the concrete relationship/condition directly.',[node.id]);
      if (!node.sourceArtifact && /(?:本页(?:来源|解释第|按|采用|第\s*\d+\s*节)|this slide(?:'s)? source|source provenance|视觉字符预算)/iu.test(text) && !String(project.source?.text || '').includes(text.trim()))
        add('writer_process_metadata',slide,'Writer process metadata is visible product copy. Express the source-supported subject directly; provenance belongs in the report.',[node.id]);
      for(const sentence of sourceSentences(text)){
        const k=key(sentence).replace(/[\p{P}\p{S}]/gu,'');
        const minimum=/[\u3400-\u9fff]/u.test(k)?28:80;if(k.length<minimum)continue;
        for(const previous of sentences)if(previous.nodeId!==node.id&&(k.includes(previous.key)||previous.key.includes(k)))
          issues.push({code:'editorial_repeated_explanation',severity:'warning',repairable:true,slideId:slide.id,nodeIds:[previous.nodeId,node.id],message:'A substantial complete explanation is repeated in another visible component. Preserve new qualifiers or examples; review the shared passage instead of repeating source facts as commentary.'});
        sentences.push({key:k,nodeId:node.id});
      }
      if(/\*\*|\$[^$\n]+\$|\\(?:frac|tfrac|mathbf|mathrm|mathbb|sqrt|overline|underline|begin|end|widehat|ldots|gamma)\b/u.test(rich.length?rich.flatMap(r=>r.runs||[]).filter(r=>r.kind!=='math'&&!r.code).map(r=>r.text||'').join(''):text)&&!node.content?.mathMl)
        add('visible_source_markup',slide,'Unrendered source markup remains in visible text; retain raw provenance and render supported notation, or report the unsupported formula.',[node.id]);
      if(node.type==='text' && /^\s*\|.+\|/mu.test(text))add('raw_table_as_prose',slide,'A source table is rendered as pipe-delimited prose; use its complete editable table object.',[node.id]);
      // Compare complete paragraphs, not short labels or translation pairs.
      for(const paragraph of text.split(/\n\s*\n/u)){
        const k=key(paragraph);if(k.length<80)continue;
        if(here.has(k))add('editorial_duplicate_paragraph',slide,'The same complete paragraph appears more than once on this page.',[here.get(k),node.id]);else here.set(k,node.id);
        const prior=seen.get(k);
        if(prior&&prior.slideId!==slide.id&&!['recap','application','translation'].includes(node.repeatPurpose||node.content?.repeatPurpose||slide.repeatPurpose))add('editorial_duplicate_primary',slide,`The same primary paragraph already appears on ${prior.slideId}; declare a purposeful recap or keep one owner.`,[node.id]);
        else if(!prior)seen.set(k,{slideId:slide.id,nodeId:node.id});
        for(const previous of paragraphs){
          if(previous.nodeId===node.id||previous.key===k)continue;
          const a=shingles(previous.key),b=shingles(k),overlap=[...a].filter(x=>b.has(x)).length/Math.max(1,Math.min(a.size,b.size));
          if(overlap>=.85)issues.push({code:'editorial_near_duplicate',severity:'warning',repairable:true,slideId:slide.id,nodeIds:[previous.nodeId,node.id],message:'These paragraphs substantially overlap. Keep any distinct conditions or conclusions and review the shared explanation; lexical overlap is not permission to delete evidence.'});
        }
        paragraphs.push({key:k,nodeId:node.id});
      }
      if(node.type==='timeline' && (node.content.items||[]).some(x=>/^\s*(?:[A-Za-z0-9]+\)|\))/u.test(x.text||'')))add('workflow_sentence_fragment',slide,'Workflow steps contain a closing-parenthesis fragment; preserve the original sentence and classify the relation before splitting arrows.',[node.id]);
      if(node.type!=='table'||!node.sourceArtifact)continue;
      const item=items.find(item=>item.id===node.sourceArtifact.sourceUnitId);if(!item?.rows)continue;
      const all=item.rows.slice(1).map(row=>sourceDisplayText(row[0]).trim()),actual=node.content.rows?.slice(1).map(row=>key(row[0]))||[],title=key(slide.title);
      // A row label that is also a word of the table's own section heading names
      // the subject (e.g. "Story Planner" for a row "story"), not a category.
      const subject=key((item.sectionPath||[]).at(-1)||'');
      const wrong=all.filter(label=>key(label).length>=3 && title.includes(key(label)) && !actual.includes(key(label)) && !subject.includes(key(label)));
      if(wrong.length)add('fragment_title_mismatch',slide,`Title names categories absent from its displayed table fragment: ${wrong.join(', ')}.`,[node.id]);
      const start=node.sourceArtifact.rowStart??1,end=node.sourceArtifact.rowEnd??item.rows.length;
      const scoped=visibleNodes(slide).some(n=>n.content?.fragmentScope?.sourceUnitId===item.id&&n.content.fragmentScope.rowStart===start&&n.content.fragmentScope.rowEnd===end);
      if((start!==1||end!==item.rows.length)&&!scoped&&!slide.titleLocked&&!actual.some(label=>label.length>=3&&title.includes(label))&&!title.includes(`${start}–${end-1}`))
        issues.push({code:'fragment_title_scope_unverified',severity:'warning',repairable:true,slideId:slide.id,nodeIds:[node.id],message:'The table is a partial source range, but its title does not identify displayed row labels or the row range. Translate with a verified row-label map or use a source-derived fragment title.'});
    }
    if(!normalizedTitle(slide.title))add('missing_semantic_title',slide,'Slide has no semantic title.');
  }
  return issues;
}
const normalizedTitle=text=>String(text||'').trim();
export function titleFromNativeShapes(shapes,width,height){
  const numeric=s=>/^[\d\s.,+%−\-]+$/u.test(String(s.text||'').trim());
  const candidates=shapes.filter(s=>s.kind==='text'&&String(s.text||'').trim()&&(s.isTitle||s.y<height*.75)&&s.fontSizePt>=16&&String(s.text).length<=180&&!numeric(s))
    .map(s=>({shape:s,score:(s.isTitle?1000:0)+Math.min(80,s.fontSizePt||0)+(s.bold?10:0)-s.y/height*25-(String(s.text).length>100?10:0)})).sort((a,b)=>b.score-a.score);
  const chosen=candidates[0];return chosen?{text:chosen.shape.text,shapeId:chosen.shape.shapeId,confidence:chosen.shape.isTitle?'placeholder':'geometry+typography',candidates:candidates.map(x=>({shapeId:x.shape.shapeId,score:x.score}))}:null;
}
