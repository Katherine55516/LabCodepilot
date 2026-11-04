import {withNativeFontCss} from '../ppt-native-fonts.mjs';
import {PPTX_IR_VERSION} from '../ppt-native-shape-ids.mjs';
import { importEditablePptx } from './import-pptx.mjs';
import { ensureProjectV3 } from './ir.mjs';
import { buildSlideRenderTree } from './render-tree.mjs';
import { slideSvg } from './exporters/preview.mjs';
import { digest, editError } from './edit-context.mjs';
import * as store from '../ppt-store.mjs';

const previews = new Map();
const pending = new Map();
export async function templatePreview(uid, template, page, deps) {
  if (!Number.isInteger(page) || page < 0 || page >= template.pages) throw editError('invalid template page', 400);
  if (page === 0 && template.kind === 'managed') {
    const cover = store.readTemplateCover('managed', template.id);
    if (cover) return cover;
  }
  const key = `${uid}:${template.id}:${template.sha256 || digest(template)}`;
  let project = previews.get(key);
  if (!project) {
    if (!pending.has(key)) pending.set(key, (async () => {
      const base = { uid, id: template.id, status: 'completed', revision: 0, template: template.id, templateSpec: template, outline: [] };
      if (['uploaded','managed'].includes(template.kind) && ['pptx','potx'].includes(template.extension)) {
        const owner = template.kind === 'managed' ? 'managed' : uid;
        const cached = store.readTemplateIR(owner, template.id, template.sha256);
        if (cached?.parserVersion===PPTX_IR_VERSION) return { ...cached.imported, templateSpec: template };
        try { return await importEditablePptx(base, store.readTemplate(owner, template.id), template.sha256); }
        finally { await deps.removeContainer(template.id, { keepVolume: false }).catch(() => {}); }
      }
      return ensureProjectV3({ ...base, deck: { slides: Array.from({ length: template.pages }, (_, index) => ({
        id: `sample_${index}`, title: template.sampleTitles?.[index % Math.max(1, template.sampleTitles.length)] || template.name,
        layoutId: index === 0 ? 'cover' : index === template.pages - 1 ? 'conclusion' : index % 2 ? 'summary' : 'comparison',
        bullets: index === 0 ? [] : template.sampleTitles || [],
      })) } });
    })());
    try { project = await pending.get(key); previews.set(key, project); if (previews.size > 12) previews.delete(previews.keys().next().value); }
    finally { pending.delete(key); }
  }
  const fontProject={...project,uid,template:template.id,templateFidelity:{...project.templateFidelity,sha256:template.sha256}};
  const svg=slideSvg(buildSlideRenderTree(project, project.deck.slides[page].id));
  return ['uploaded','managed'].includes(template.kind)?withNativeFontCss(fontProject,svg):svg;
}
