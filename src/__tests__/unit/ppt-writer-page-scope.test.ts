/* eslint-disable @typescript-eslint/no-explicit-any -- projects, outlines and prompts are loose JSON. */
// Real case (qwen3.8-max, 2026-10-22): the two-stage reranking page owned only
// its own source, but its writer saw the root-cause page's "62% of GPU time"
// (retrieved by keyword overlap, and in the whole input sent to short decks)
// and wrote it on the page; the page-scoped claim review then blocked publish.
// (Card pages are not written by the writer; this scope applies to the pages
// that still are. The outline summary audit was removed with option D.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.COWORK_STATE_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-writer-scope-'));
const lib = (name: string) => import(process.cwd() + '/apps/cowork-server/lib/' + name + '.mjs');
const SOURCE = '# 向量检索服务性能优化复盘（2026 年第三季度）\n\n## 根因分析\n\n召回与重排耦合：重排模型对 Top-200 候选全部打分，占用了 62% 的 GPU 时间。\n\n## 第三步：两阶段重排\n\n先用轻量交叉编码器把 Top-200 缩减到 Top-40，再由大模型重排 Top-40。轻量模型在 CPU 上运行。\n\n## 结果\n\nP99 延迟从 640 ms 降到 210 ms。\n';

async function deck(owned: boolean) {
  const { normalizePaste } = await lib('ppt-source');
  const { _internals: api } = await lib('ppt-api');
  const planning = await lib('ppt-planning');
  const source = normalizePaste(SOURCE);
  const [causes, rerank, results] = source.semantic.inventory.items;
  const raw = { slides: [
    { title: '复盘', focus: '范围', refs: [] },
    { title: '性能退化根因', focus: '根因', sourceUnitIds: [causes.id], chunkRefs: causes.chunkRefs },
    // The plan's message mentions GPU and Top-200, so keyword retrieval also finds the root-cause chunk.
    { title: '两阶段重排', focus: '解耦重排以降低 GPU 消耗：Top-200 先经 CPU 粗筛', sourceUnitIds: [rerank.id], chunkRefs: rerank.chunkRefs },
    { title: '优化结果', focus: '结果', sourceUnitIds: [results.id], chunkRefs: results.chunkRefs },
  ] };
  const outline = api.normalizeOutline(raw, 4, source);
  const project: any = { pages: 4, source, prompt: SOURCE, title: '复盘', outline, generationPolicy: { version: 2, detail: 'standard', content: 'overview', selection: 'editorial', archive: 'none', language: { mode: 'source', body: 'both' }, knowledge: 'source_only' } };
  project.planning = planning.buildPlanning(project, raw, outline);
  if (owned) for (const slide of outline.slice(1)) { const contract = project.planning.slidePlan.find((c: any) => c.slideId === slide.id); contract.pageContract = { ...(contract.pageContract || {}), sourceScope: 'owned' }; }
  return { api, planning, project, outline, causes, rerank };
}

test('an owned-scope writer sees only the sources its claim review accepts', async () => {
  const { api, project, outline, rerank } = await deck(true);
  const prompt = api.contentPrompt(project, outline[2], 2);
  assert.ok(prompt.includes('先用轻量交叉编码器把 Top-200 缩减到 Top-40'), 'its own source is present');
  assert.ok(!prompt.includes('62%'), 'no fact from the root-cause page, neither retrieved nor in the whole input');
  assert.ok(!/^INPUT_FRAMEWORK=/m.test(prompt), 'the whole input is not sent; its identity hash is');
  assert.match(prompt, /<immutable_input_identity>/);
  for (const tag of ['task', 'intent_is_not_source_authority', 'page_owned_source_content', 'source_packet']) assert.match(prompt, new RegExp('<' + tag + '>'), tag + ' is kept in the page view');
  const packet = JSON.parse(prompt.match(/<source_packet>([\s\S]*?)<\/source_packet>/)![1]);
  assert.deepEqual(packet.chunks.map((c: any) => c.id), rerank.chunkRefs);
  assert.ok(packet.evidence.every((e: any) => !String(e.text).includes('62%')));
});

test('other contracts keep today\'s writer context', async () => {
  const { api, project, outline } = await deck(false);
  const prompt = api.contentPrompt(project, outline[2], 2);
  assert.match(prompt, /^INPUT_FRAMEWORK=/m, 'a short deck still sends its whole input');
  assert.ok(prompt.includes('62%'));
});

test('scoping keeps only chunks and evidence of permitted source units', async () => {
  const { planning, project, outline, causes, rerank } = await deck(true);
  const contract = project.planning.slidePlan.find((c: any) => c.slideId === outline[2].id);
  const retrieval = planning.retrieveSlideSources(project, outline[2], contract);
  assert.ok(retrieval.chunks.some((c: any) => causes.chunkRefs.includes(c.id)), 'keyword retrieval finds the neighbouring chunk');
  const scoped = planning.scopeRetrievalToSources(project, retrieval, [rerank.id]);
  assert.deepEqual(scoped.chunkIds, rerank.chunkRefs);
  assert.ok(scoped.evidenceAtoms.every((a: any) => a.sourceUnitId === rerank.id));
  assert.ok(scoped.requiredEvidenceIds.every((id: string) => scoped.evidenceAtoms.some((a: any) => a.id === id)));
  assert.deepEqual(scoped.segments, []);
  assert.equal(planning.scopeRetrievalToSources(project, retrieval, []), retrieval, 'nothing to scope to: unchanged');
});
