import {promptSchema} from './ppt-prompt-schema.mjs';
import { digest } from './ppt/edit-context.mjs';
import { sourceRichText } from './ppt-rich-text.mjs';

/** A repair may edit only a diagnosed writer-owned string/span. Source IDs,
 * table cells, chart data, layout, fonts and other strings are read-only. */
export function writerLocalRepairScope(value, error, {allOwnedSourceBound=false}={}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = String(error?.message || error), targets = [];
  const add = (path, text, kind, start = 0, end = text.length) => targets.push({ path, kind, start, end, before: text.slice(start, end) });
  if (/block id|duplicate block/iu.test(message)) {
    const seen = new Set();
    for (const [i, block] of (Array.isArray(value.blocks) ? value.blocks : []).entries()) {
      if (typeof block.id === 'string' && (!/^[A-Za-z0-9_-]{1,40}$/.test(block.id) || seen.has(block.id))) add(['blocks', i, 'id'], block.id, 'identifier');
      seen.add(block.id);
    }
  } else if (/rendered_title_capacity/iu.test(message)) {
    const key=typeof value.title==='string'?'title':typeof value.headline==='string'?'headline':null;
    if(key){add([key],value[key],'title');for(const [id,text]of Object.entries(value.slotTexts||{}))if(text===value[key])add(['slotTexts',id],text,'title');}
  } else if (/source_artifact_capacity/iu.test(message) && /"sourceFits":true/u.test(message)) {
    for (const [i, item] of (Array.isArray(value.sourceCommentary) ? value.sourceCommentary : []).entries()) {
      if (typeof item === 'string') add(['sourceCommentary', i], item, 'commentary');
      else if (typeof item?.text === 'string') add(['sourceCommentary', i, 'text'], item.text, 'commentary');
    }
  } else if (/writer_math_invalid|visible_source_markup/iu.test(message)) {
    const visit = (object, path = []) => {
      if (!object || typeof object !== 'object' || object.type === 'code') return;
      for (const [key, entry] of Object.entries(object)) {
        if (['sourceArtifacts', 'sourceEvidenceIds', 'rows', 'values', 'data', 'code'].includes(key)) continue;
        const next = [...path, Array.isArray(object) ? Number(key) : key];
        if (typeof entry === 'string' && (['title','text','body','heading','caption','subtitle','takeaway'].includes(key) || path.some(p => ['sourceCommentary','slotTexts','bullets'].includes(p)))) {
          for (const issue of sourceRichText(entry).diagnostics) {
            const start = entry.indexOf(issue.source);
            if (start >= 0 && entry.indexOf(issue.source, start + 1) < 0) add(next, entry, 'math', start, start + issue.source.length);
          }
        } else if (typeof entry === 'object') visit(entry, next);
      }
    };
    visit(value);
  }
  return targets.length ? { version: 1, baseHash: digest(value), targets, titleMayOmitBoundNumbers:/rendered_title_capacity/u.test(message)&&((value.sourceArtifacts||[]).length>0||(value.sourceEvidenceIds||[]).length>0), optionalCommentaryCanOmit:/source_artifact_capacity/u.test(message)&&/"sourceFits":true/u.test(message)&&(/"singleParagraphCjkCharacters":0/u.test(message)||allOwnedSourceBound)&&Array.isArray(value.sourceArtifacts)&&value.sourceArtifacts.length>0 } : null;
}

const numbers = text => [...new Set(String(text).match(/[-+]?\d+(?:[.,]\d+)*(?:%|％)?/gu) || [])].sort();
const mathBody = text => String(text).replace(/\$|\\[()[\]]|\s/gu, '');
const invalidDelta=message=>Object.assign(Error(message),{code:message==='writer_local_repair_stale'?'stale_edit':'schema_invalid'});
export function applyWriterLocalDelta(value, scope, delta) {
  if (digest(value) !== scope?.baseHash) throw invalidDelta('writer_local_repair_stale');
  if (!delta || Object.keys(delta).some(k => k !== 'edits') || !Array.isArray(delta.edits) || delta.edits.length > scope.targets.length) throw invalidDelta('writer_local_repair_schema');
  const result = structuredClone(value), used = new Set(), edits = [];
  for (const edit of delta.edits) {
    if (!edit || Object.keys(edit).some(k => !['path','start','end','before','after'].includes(k))) throw invalidDelta('writer_local_repair_schema');
    const key = JSON.stringify([edit.path, edit.start, edit.end]);
    const target = scope.targets.find(t => JSON.stringify(t.path) === JSON.stringify(edit.path) && t.start === edit.start && t.end === edit.end && t.before === edit.before);
    if (!target || used.has(key) || typeof edit.after !== 'string' || edit.after.length > 5000) throw invalidDelta('writer_local_repair_outside_scope');
    used.add(key);
    if (target.kind === 'identifier' && !/^[A-Za-z0-9_-]{1,40}$/.test(edit.after)) throw invalidDelta('writer_local_repair_invalid_id');
    if (target.kind !== 'identifier' && !(target.kind==='commentary'&&scope.optionalCommentaryCanOmit&&edit.after===''||target.kind==='title'&&scope.titleMayOmitBoundNumbers&&numbers(edit.after).every(n=>numbers(edit.before).includes(n))) && JSON.stringify(numbers(edit.before)) !== JSON.stringify(numbers(edit.after))) throw invalidDelta('writer_local_repair_numeric_change');
    // A syntax-only formula repair cannot silently change variables/operators.
    if (target.kind === 'math' && mathBody(edit.before) !== mathBody(edit.after)) throw invalidDelta('writer_local_repair_formula_change');
    let parent = result;
    for (const part of edit.path.slice(0, -1)) {
      if (['__proto__','constructor','prototype'].includes(String(part)) || !Object.hasOwn(parent, part)) throw invalidDelta('writer_local_repair_path');
      parent = parent[part];
    }
    const leaf = edit.path.at(-1), current = parent[leaf];
    if (typeof current !== 'string' || current.slice(edit.start, edit.end) !== edit.before) throw invalidDelta('writer_local_repair_stale');
    parent[leaf] = current.slice(0, edit.start) + edit.after + current.slice(edit.end);
    if (target.kind === 'math' && sourceRichText(parent[leaf]).diagnostics.length) throw invalidDelta('writer_local_repair_math_unresolved');
    edits.push({ path: edit.path, start: edit.start, end: edit.end, kind: target.kind });
  }
  return { value: result, audit: { baseHash: scope.baseHash, afterHash: digest(result), edits, unchangedOutsideTargets: true } };
}

export function writerDeltaResponseSchema(prompt){
 return promptSchema(prompt,'Writer Delta Schema=');
}
export function writerLocalRepairPrompt(context, value, scope, error) {
  // The page schema is read-only data, not the response contract for a delta.
  context=context.replace(/返回唯一 JSON：[^\n]+。只输出 JSON/g,'').replace(/返回相同 schema。/gu,'');
  let capacityInstruction='';
  if(scope.targets?.some(target=>target.kind==='title'))capacityInstruction=' The title exceeds its actual unchanged-font frame. Shorten ONLY the allowed title strings to one complete short topic or claim; do not return the rejected long title, alter the font, or edit any body/source string. Required numbers and conditions already owned by the body stay intact there.';
  if(scope.targets.some(target=>target.kind==='commentary')){
    const match=String(error.message).match(/"singleParagraphCjkCharacters":(\d+)/u);
    const budget=match?Math.floor(Number(match[1])*.85):null;
    capacityInstruction=` The rejected commentary is too tall. SHORTEN it; do not expand or return an unchanged string. Merge its relationships into one concise paragraph${budget!==null?`, targeting at most ${budget} CJK-equivalent characters in TOTAL across all commentary entries including punctuation, numbers and formula text`:''}. Additional entries consume padding. Preserve existing numbers and conditions inside the allowed string scope; do not add details from adjacent pages. Source artifacts remain visible and immutable, so do not restate their contents. ${scope.optionalCommentaryCanOmit?'The frozen sources already bind all owned facts, or consume the complete measured page. You may set an allowed commentary string to the empty string, including duplicated numerical explanation; all source selections and source facts remain immutable and the normal coverage/semantic gate still checks them. Do not delete other strings.':''} A CJK-equivalent budget is guidance: the unchanged normal fit gate still decides acceptance.`;
  }
  const schema={type:'object',additionalProperties:false,required:['edits'],properties:{edits:{type:'array',minItems:0,maxItems:scope.targets.length,items:{type:'object',additionalProperties:false,required:['path','start','end','before','after'],properties:{path:{type:'array',minItems:1,items:{anyOf:[{type:'string'},{type:'integer'}]}},start:{type:'integer',minimum:0},end:{type:'integer',minimum:0},before:{type:'string'},after:{type:'string',maxLength:5000}}}}}};
  return `${context}\n<writer_local_repair>Repair ONLY the listed writer-owned strings/spans. Return JSON {"edits":[{"path":["existing",0,"field"],"start":0,"end":1,"before":"exact substring","after":"replacement"}]}. Keep all other strings, source selections, cells, IDs, fonts, layout and page count unchanged. Formula repairs only fix delimiters; never change variables/operators or invent a macro interpretation. Commentary may remove duplicate explanation but must preserve necessary facts, numbers, units, negation and conditions.${capacityInstruction} The original source and normal capacity/coverage gates remain authoritative. If this scope cannot resolve the error, return an empty edits array; do not rewrite the page.</writer_local_repair>\n<diagnosis>${JSON.stringify(String(error.message))}</diagnosis>\n<allowed_targets>${JSON.stringify(scope)}</allowed_targets>\n<read_only_draft>${JSON.stringify(value)}</read_only_draft>\nWriter Delta Schema=${JSON.stringify(schema)}`;
}
