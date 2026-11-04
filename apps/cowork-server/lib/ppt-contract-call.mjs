/** One model step with an explicit output contract.
 *
 * Providers that accept `response_format` do not always enforce it (the
 * DeepSeek OpenAI-compatible gateway returned `{equivalent,notes}` for a
 * required `{version,equivalent,missing*,reason}` schema, and its own
 * `{readerQuestions,logicalGroups,pageEstimate}` for the input-understanding
 * schema, while telemetry still said "schema"). Therefore:
 *   - the transport marks a provider/model whose reply misses required
 *     top-level fields as schema-unreliable, and from then on embeds a compact
 *     copy of the schema in the prompt itself (`schemaPromptBlock`);
 *   - every contract step normalizes harmless shape drift (JSON text, field
 *     aliases, empty arrays), validates locally, then retries with the exact
 *     validation error, the missing/unexpected top-level fields and a shape
 *     example;
 *   - finally it either degrades (non-critical steps return `degrade(error)`)
 *     or throws with `origin:'model_contract'` and the step name.
 * Normalization only repairs format; it never invents a verdict or a fact. */
// A correction shows every listed problem and the whole rejected reply of a
// multi-card answer (Fable 2026-10-25: 600/4000 characters cut both short).
export const CORRECTION_ERROR_CHARS = 2000, REJECTED_RESPONSE_CHARS = 12000;
export function parseModelValue(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim().replace(/^```(?:json)?\s*/iu, '').replace(/```$/u, '').trim();
  try { return JSON.parse(text); } catch { return value; }
}

// Process-local: a provider/model that ignored a schema once is assumed to
// keep ignoring it. Keys are `${configId}:${model}`.
const unreliableSchemas = new Map();
export function schemaReliabilityKey(project) { return `${project?.configId || ''}:${project?.model || ''}`; }
export function markSchemaUnreliable(key, detail = {}) {
  if (!key || unreliableSchemas.has(key)) return false;
  unreliableSchemas.set(key, { at: new Date().toISOString(), ...detail });
  return true;
}
export function schemaUnreliable(key) { return unreliableSchemas.has(key); }
export function resetSchemaReliability() { unreliableSchemas.clear(); }

/** Required top-level fields the value is missing, and fields it should not have. */
export function topLevelShape(schema, value) {
  if (!schema || typeof schema !== 'object' || !value || typeof value !== 'object' || Array.isArray(value)) return { missing: [], unexpected: [] };
  const required = Array.isArray(schema.required) ? schema.required : [];
  const allowed = schema.properties ? Object.keys(schema.properties) : null;
  return { missing: required.filter(key => !(key in value)||value[key]===undefined), unexpected: allowed && schema.additionalProperties === false ? Object.keys(value).filter(key => !allowed.includes(key)) : [] };
}

/** A prompt-sized schema: long enums (e.g. every source unit ID) become a
 * description, so the embedded copy stays small and readable. */
export function compactSchema(schema) {
  if (Array.isArray(schema)) return schema.map(compactSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'enum' && Array.isArray(value) && value.length > 16) { out.description = `one of the ${value.length} supplied IDs`; continue; }
    out[key] = compactSchema(value);
  }
  return out;
}

export function schemaPromptBlock(schema) {
  const required = Array.isArray(schema?.required) ? schema.required : [];
  return `\n<required_json_schema>${JSON.stringify(compactSchema(schema))}</required_json_schema>\nReturn exactly ONE JSON object that validates against <required_json_schema>${required.length ? `, with exactly these top-level fields: ${required.join(', ')}` : ''}. Do not rename fields, wrap the object, add commentary or mirror the input packet's structure.`;
}

/** Names the planning step where a contract or gate failure happened, so the
 * failure record says which batch, window or repair pass broke, not only
 * "outline". A transport failure keeps its own modelStage; an earlier, more
 * specific tag is kept. Returns the error. */
export function tagContractStage(error, stage) {
  if (stage && error && typeof error === 'object' && !error.contractStage && !error.modelStage) error.contractStage = String(stage).slice(0, 100);
  return error;
}

export function contractError(stage, error) {
  return Object.assign(error instanceof Error ? error : new Error(String(error)), { origin: 'model_contract', contractStage: String(stage).slice(0, 100) });
}

// A reply that came back cut off, empty or unparsable is the model missing
// the output contract, not a transport failure: it gets the same bounded
// retry and, for a non-critical step, the same degrade path.
const MODEL_OUTPUT_FAILURES = new Set(['truncated_output', 'empty_visible_output', 'invalid_json']);
export async function callWithContract({ call, prompt, stage, schema, normalize = value => value, validate, repairs = 1, degrade = null, onRepair = null, example = null }) {
  let raw, error;
  for (let attempt = 0; attempt <= repairs; attempt++) {
    let correction = '';
    if (attempt) {
      const shape = topLevelShape(schema, parseModelValue(raw));
      const truncated = error?.code === 'truncated_output';
      correction = `\n<contract_validation_error>${JSON.stringify({ error: String(error?.message || error).slice(0, CORRECTION_ERROR_CHARS), ...(shape.missing.length ? { missingTopLevelFields: shape.missing } : {}), ...(shape.unexpected.length ? { unexpectedTopLevelFields: shape.unexpected.slice(0, 20) } : {}) })}</contract_validation_error>`
        + (raw !== undefined ? `\n<rejected_response>${String(JSON.stringify(raw)).slice(0, REJECTED_RESPONSE_CHARS)}</rejected_response>` : '')
        + (truncated ? '\nThe previous reply was cut off by the output limit. Answer much more concisely: only the required fields, short strings, no repetition.' : '')
        + (example ? `\n<required_shape_example>${JSON.stringify(example)}</required_shape_example> The example shows field names and types only; take every value from the actual input.` : '')
        + `\nReturn the SAME task's complete answer using EXACTLY the required JSON fields and types. Correct the reported contract problem; do not change correct judgements.`;
    }
    // Transport, cancellation and budget errors from `call` propagate as-is.
    try { raw = await call(prompt + correction, attempt ? `${stage}:contract` : stage, schema); }
    catch (failure) {
      if (!MODEL_OUTPUT_FAILURES.has(failure?.code)) throw failure;
      raw = undefined; error = failure; onRepair?.(failure, attempt); continue;
    }
    try { return { value: validate(normalize(parseModelValue(raw))), degraded: false, attempts: attempt + 1 }; }
    catch (failure) { error = failure; onRepair?.(failure, attempt); }
  }
  const failed = contractError(stage, error);
  if (degrade) return { value: await degrade(failed), degraded: true, error: failed, attempts: repairs + 1 };
  throw failed;
}
