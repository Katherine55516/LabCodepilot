import {PPTX_IR_VERSION} from '../lib/ppt-native-shape-ids.mjs';
/** Offline operator-only ingestion. Shares validation, Template IR and renderer
 * with user uploads. Never expose this namespace through an upload route. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as store from '../lib/ppt-store.mjs';
import { validateTemplate, analyzeTemplate } from '../lib/ppt-template.mjs';
import { importEditablePptx } from '../lib/ppt/import-pptx.mjs';
import * as orch from '../lib/orchestrator.mjs';
import { buildSlideRenderTree } from '../lib/ppt/render-tree.mjs';
import { slideSvg } from '../lib/ppt/exporters/preview.mjs';
export async function registerManagedTemplate(file, options = {}, deps = { analyzeTemplate, importEditablePptx, removeContainer: orch.removeContainer }) {
  const bytes = fs.readFileSync(file), fileName = path.basename(file);
  const extension = validateTemplate(fileName, bytes, true), sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const existing = store.listTemplates('managed').find(item => item.sha256 === sha256);
  if (existing) return { template: existing, cacheHit: true };
  const id = store.newId();
  try {
    const analysis = await deps.analyzeTemplate('managed', id, extension, bytes);
    if (analysis.compatibility !== 'mapped' || !['pptx','potx'].includes(extension)) throw new Error('template_unsupported: managed template must have editable slots and mapped theme');
    const imported = await deps.importEditablePptx({ uid: 'managed', id }, bytes, sha256);
    const template = { ...analysis, id, name: options.name || fileName.replace(/\.[^.]+$/,''), kind: 'managed', version: 1, category: options.category || '内置模板',
      extension, fileName, sha256, bytes: bytes.length, irVersion: PPTX_IR_VERSION, createdAt: new Date().toISOString() };
    store.writeTemplate('managed', id, bytes);
    store.writeTemplateIR('managed', id, { schemaVersion: 1, parserVersion: PPTX_IR_VERSION, sha256, imported });
    store.writeTemplateCover('managed', id, slideSvg(buildSlideRenderTree({...imported,templateSpec:template}, imported.deck.slides[0].id)));
    template.coverVersion = 'svg-preview-1';
    store.saveTemplates('managed', [...store.listTemplates('managed'), template]);
    return { template, cacheHit: false };
  } finally { await deps.removeContainer(id, { keepVolume: false }).catch(() => {}); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (!process.argv[2]) throw new Error('Usage: node register-ppt-template.mjs FILE [NAME]');
  console.log(JSON.stringify(await registerManagedTemplate(process.argv[2], { name: process.argv[3] })));
}
