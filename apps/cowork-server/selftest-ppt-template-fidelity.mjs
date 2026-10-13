import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { _internals as importer, projectFromImportedManifest } from './lib/ppt/import-pptx.mjs';
import { _internals as fidelityInternals, fidelityFromImported, rescheduleTemplateFidelity, bindTemplateFidelity, fitNativeTitleFrames, inspectTemplateFidelity, inspectTemplateSlotDraft, templateOutlinePrompt, templateSlotPrompt } from './lib/ppt-template-fidelity.mjs';
import { buildRenderTree } from './lib/ppt/render-tree.mjs';
import { slideSvg } from './lib/ppt/exporters/preview.mjs';
import { _internals as pdf } from './lib/ppt-pdf.mjs';
import { deckReviewPrompt } from './lib/ppt-quality.mjs';
import { ensureDeckV3, stableId } from './lib/ppt/ir.mjs';
import { exportManifest } from './lib/ppt-export-integrity.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-template-fidelity-'));
process.env.COWORK_STATE_DIR = root;
const python = process.env.PPT_TEST_PYTHON || '/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const fixture = path.join(root, 'template.pptx');
const output = path.join(root, 'generated.pptx');
{
  const node = { id: 'native-title', type: 'text', semanticRole: 'template-title', nativeRef: { shapeId: '1' }, content: { text: '中文标题' }, geometry: { x: 52*12700, y: 77*12700, width: 855*12700, height: 44.65*12700 }, style: { fontSizePt: 37, fontFamily: 'Original Font' } };
  const before = structuredClone(node), slide = { nodes: [node, { id: 'equation', geometry: { x: 52*12700, y: 129*12700, width: 180*12700, height: 22*12700 } }] };
  fitNativeTitleFrames({ templateFidelity: { height: 540*12700 } }, slide);
  assert.equal(node.geometry.height, Math.ceil(37*1.35*12700));
  assert.deepEqual({ ...node.geometry, height: before.geometry.height }, before.geometry);
  assert.deepEqual(node.style, before.style);assert.deepEqual(node.content, before.content);
  assert.ok(node.geometry.y + node.geometry.height < slide.nodes[1].geometry.y);
  const once = structuredClone(node);fitNativeTitleFrames({ templateFidelity: { height: 540*12700 } }, slide);assert.deepEqual(node, once, 'frame adaptation is idempotent');
  const twoLines = { nodes: [{ ...structuredClone(before), content: { text: 'CAPM 起点：定价方程与证券市场线' }, style: { fontSizePt: 34.5 }, nativeTextFrame: { margins: [0,0,0,0] }, geometry: { x: 52*12700, y: 74*12700, width: 495*12700, height: 83.5*12700 } }] };
  fitNativeTitleFrames({ templateFidelity: { height: 540*12700 } }, twoLines);assert.equal(twoLines.nodes[0].geometry.height, Math.ceil(34.5*(1.35+1.25)*12700), 'wrapped CJK title reserves both native lines');assert.equal(twoLines.nodes[0].nativeTextFrame.margins[2], Math.ceil(34.5*.08*12700));
  const blocked = { nodes: [structuredClone(before), { id: 'protected', geometry: { x: before.geometry.x, y: before.geometry.y+before.geometry.height, width: before.geometry.width, height: 20*12700 } }] };
  fitNativeTitleFrames({ templateFidelity: { height: 540*12700 } }, blocked);assert.equal(blocked.nodes[0].templateTitleFrameAdaptation.status, 'blocked');assert.deepEqual(blocked.nodes[0].geometry, before.geometry);
  for (const variant of [{ locked: true }]) { const candidate = { nodes: [{ ...structuredClone(before), ...variant }] };fitNativeTitleFrames({ templateFidelity: { height: 540*12700 } }, candidate);assert.deepEqual(candidate.nodes[0].geometry, before.geometry); }
}
const run = (script, input, extraEnv = {}) => {
  const result = spawnSync(python, ['-c', script], { input, env: { ...process.env, ...extraEnv }, maxBuffer: 30_000_000 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout.toString();
};

const emu = inches => Math.round(inches * 914400);
const syntheticNodes = [
  [1, '演示标题', 0.7, 0.5, 10, 0.6, 32],
  [2, '版本历史', 6.5, 3.1, 5.7, 0.3, 16.5],
  [3, '版本历史保存每次修改，支持恢复先前方案', 6.5, 3.55, 5.7, 0.23, 12.5],
  [4, '撤销', 1.0, 3.1, 1.2, 0.2, 11],
  [5, '历史', 1.0, 3.4, 1.2, 0.15, 8.5],
].map(([shapeId, value, x, y, width, height, fontSizePt]) => ({
  id: `native_${shapeId}`, type: 'text', nativeRef: { shapeId, slideIndex: 0 },
  content: { text: value }, geometry: { x: emu(x), y: emu(y), width: emu(width), height: emu(height) },
  style: { fontSizePt },
}));
const semanticSlots = fidelityInternals.slotsFor({ nodes: syntheticNodes });
const descriptionSlot = semanticSlots.find(slot => slot.shapeId === 3);
assert.equal(descriptionSlot.purpose, 'point-description');
assert.equal(descriptionSlot.pairedWith, 2);
assert.equal(descriptionSlot.groupId, 2);
assert.equal(semanticSlots.find(slot => slot.shapeId === 2).purpose, 'point-heading');
assert.equal(semanticSlots.find(slot => slot.shapeId === 5).purpose, 'label');
const oneLine = { ...syntheticNodes[2], nativeTextFrame: { wordWrap: false, margins: [0, 0, 0, 0],
  paragraphs: [{ text: '短句', runs: [{ text: '短句', fontSizePt: 12.5 }] }] } };
const oneLineSlot = fidelityInternals.slotsFor({ nodes: [syntheticNodes[0], oneLine] }).find(slot => slot.shapeId === 3);
assert.equal(oneLineSlot.maxLines, 1);
assert.ok(oneLineSlot.capacity <= oneLineSlot.lineVisualUnits);
assert.equal(fidelityInternals.slotsFor({ nodes: [syntheticNodes[0],
  { ...syntheticNodes[4], geometry: { ...syntheticNodes[4].geometry, width: emu(3) } }] }).find(slot => slot.shapeId === 5).purpose, 'footnote');
const semanticProject = { templateFidelity: { mode: 'preserve', slides: [{ index: 0, background: '#202020', nodes: syntheticNodes,
  slots: semanticSlots, shapeCount: syntheticNodes.length, imageCount: 0 }] }, deck: { slides: [] } };
const semanticSlide = { id: 'semantic', title: '演示标题', section: '', nodes: [], templateSlotTexts: {
  '2': '版本历史', '3': 'AI 草稿', '4': '撤销', '5': '历史',
} };
assert.ok(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).some(issue => issue.code === 'template_description_too_short'));
semanticSlide.templateSlotTexts['3'] = '版本历史';
assert.ok(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).some(issue => issue.code === 'template_description_repeats_heading'));
semanticSlide.templateSlotTexts['3'] = '版本历史可恢复';
assert.ok(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).some(issue => issue.code === 'template_description_repeats_heading'));
semanticSlide.templateSlotTexts['3'] = '保存每次修改记录，与';
assert.ok(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).some(issue => issue.code === 'template_text_fragment'));
semanticSlide.templateSlotTexts['3'] = '保留每次修改記錄，與';
assert.ok(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).some(issue => issue.code === 'template_text_fragment'));
semanticSlide.templateSlotTexts['3'] = '保存每次修改记录，支持恢复先前方案';
assert.equal(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).length, 0);
semanticSlide.copy = { blocks: [{ type: 'mechanism', heading: '版本历史', body: '保存每次修改记录，支持恢复先前方案' }] };
assert.equal(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).length, 0);
semanticSlide.copy.blocks.push({ type: 'implication', heading: '冲突处理', body: '多设备编辑时使用版本号检测并拒绝覆盖冲突' });
assert.ok(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).some(issue => issue.code === 'template_content_unrendered'));
delete semanticSlide.copy;
semanticSlide.templateSlotTexts['3'] = '保留每次修改記錄，支援恢復先前方案';
assert.equal(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).length, 0);
semanticSlide.templateSlotTexts['3'] = 'Keep a revision history for recovery';
assert.equal(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).length, 0);
semanticSlide.templateSlotTexts['2'] = 'Revision history';
semanticSlide.templateSlotTexts['3'] = 'Revision history helps';
assert.ok(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).some(issue => issue.code === 'template_description_repeats_heading'));
semanticSlide.templateSlotTexts['2'] = '版本历史';
semanticSlide.templateSlotTexts['3'] = 'Keep a revision history for';
assert.ok(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).some(issue => issue.code === 'template_text_fragment'));
semanticSlide.templateSlotTexts['3'] = 'Keep a revision history for.';
assert.ok(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).some(issue => issue.code === 'template_text_fragment'));
semanticSlide.title = 'History and';
assert.ok(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).some(issue => issue.code === 'template_text_fragment'));
semanticSlide.title = '演示标题';
semanticSlide.templateSlotTexts['3'] = '保存每次修改记录，支持恢复先前方案';
semanticProject.templateFidelity.slides[0].slots = [...semanticSlots, { ...semanticSlots.find(slot => slot.shapeId === 4), shapeId: 6 }];
semanticSlide.templateSlotTexts['6'] = '撤销';
assert.ok(inspectTemplateSlotDraft(semanticProject, 0, semanticSlide).some(issue => issue.code === 'template_slot_duplicate'));
semanticProject.templateFidelity.slides[0].slots = semanticSlots;
delete semanticSlide.templateSlotTexts['6'];
semanticProject.deck.slides = [semanticSlide];
bindTemplateFidelity(semanticProject);
assert.equal(inspectTemplateFidelity(semanticProject).length, 0);
semanticSlide.copy = { blocks: [{ type: 'mechanism', heading: '冲突处理', body: '多设备编辑时使用版本号检测并拒绝覆盖冲突' }] };
assert.ok(inspectTemplateFidelity(semanticProject).some(issue => issue.code === 'template_content_unrendered'));
delete semanticSlide.copy;
assert.match(deckReviewPrompt({ ...semanticProject, prompt: '版本管理' }), /保存每次修改记录/);
assert.match(deckReviewPrompt({ ...semanticProject, prompt: '版本管理' }), /groupId/);


// Compound metadata, continuation groups and bound bilingual lists use actual
// visible evidence; a standalone equation still needs the exact expression.
{
  const check=fidelityInternals.contentCoverageIssues;
  const text=(id,value)=>({id,title:'Topic',sourceArtifactNodes:[{}],nodes:[{id:id+'-text',type:'text',semanticRole:'source-explanation',content:{text:value}}]});
  const a=text('a','Risk story Value Momentum Quality Investment Liquidity Size Conditions Markets'),b=text('b','Mispricing');
  const p={outline:[{id:'a',title:'Topic',groupId:'g'},{id:'b',title:'Topic（续 2）',groupId:'g'}],deck:{slides:[a,b]},planning:{slidePlan:[{slideId:'b',requiredDetails:['Value Momentum Quality Investment Liquidity Size Conditions Markets Risk story Mispricing']}]} };
  assert.equal(check(p,b,[],1).length,0);
  p.outline[0].groupId='unrelated';assert.ok(check(p,b,[],1).some(issue=>issue.code==='template_required_detail_missing'));
  const equation=text('eq','x=1');p.deck.slides=[equation];p.outline=[];p.planning.slidePlan=[{slideId:'eq',requiredDetails:['x=2']}];
  assert.ok(check(p,equation,[],0).some(issue=>issue.code==='template_required_detail_missing'));
  p.planning.slidePlan[0].requiredDetails=['模型方程 x=1；变量定义与风险条件'];equation.nodes[0].content.text='模型方程 x=1，变量定义明确，风险条件保留';assert.equal(check(p,equation,[],0).length,0);
  const bilingual=text('list','');bilingual.nodes=[{id:'en',type:'list',sourceArtifact:{sourceUnitId:'en-source'},content:{items:[{text:'Robust across markets'},{text:'Economic mechanism'}]}},{id:'zh',type:'list',sourceArtifact:{sourceUnitId:'zh-source'},content:{items:[{text:'跨市场稳健'},{text:'经济机制'}]}}];
  p.source={semantic:{inventory:{items:[{id:'en-source',items:[{},{}]},{id:'zh-source',items:[{},{}]}]}}};p.planning.slidePlan=[{slideId:'list',requiredDetails:['2条清单完整呈现，保留中英双语']}];
  assert.equal(check(p,bilingual,[],0).length,0);bilingual.nodes.pop();assert.ok(check(p,bilingual,[],0).length);
  const nativeImage={id:'unknown',type:'image',nativeRef:{shapeId:99},geometry:{x:4e6,y:2e6,width:3e6,height:2e6},content:{dataUrl:'original-native-image'}};
  const retained=structuredClone(semanticProject);retained.templateFidelity.width=12192000;retained.templateFidelity.height=6858000;retained.templateFidelity.slides[0].nodes.push(nativeImage);retained.templateFidelity.slides[0].shapeCount++;retained.templateFidelity.slides[0].imageCount++;
  retained.deck.slides=[{...structuredClone(semanticSlide),templateOmissions:[{shapeId:99,reason:'The model requests deletion of an unknown image'}]}];bindTemplateFidelity(retained);
  assert.ok(retained.deck.slides[0].nodes.some(node=>node.id==='unknown'&&node.content.dataUrl==='original-native-image'));
  assert.equal(retained.deck.slides[0].templateOmissions.length,0);assert.equal(retained.deck.slides[0].templateRejectedOmissions.length,1);
}

try {
  run(`from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from PIL import Image
import io, os
p=Presentation(); p.slide_width=Inches(12); p.slide_height=Inches(6.75)
image=Image.new('RGB',(32,32),'#aa7744'); buffer=io.BytesIO(); image.save(buffer,format='PNG'); buffer.seek(0)
for index in range(3):
 s=p.slides.add_slide(p.slide_layouts[6]); title=s.shapes.add_textbox(Inches(.8),Inches(.5),Inches(9),Inches(.7)); title.text='旧标题'
 title.text_frame.paragraphs[0].runs[0].font.size=Pt(32)
 box=s.shapes.add_shape(1,Inches(.8),Inches(2),Inches(3),Inches(2)); box.fill.solid(); box.fill.fore_color.rgb=RGBColor(30,40,50)
 body=s.shapes.add_textbox(Inches(4),Inches(2),Inches(6),Inches(1)); body.text='旧正文'
 s.shapes.add_picture(buffer,Inches(8),Inches(4),width=Inches(2)); buffer.seek(0)
p.save(os.environ['PPT_OUTPUT'])`, '', { PPT_OUTPUT: fixture });
  const bytes = fs.readFileSync(fixture); const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const manifest = JSON.parse(run(importer.IMPORT_SCRIPT, bytes, { PPT_EXTERNAL_DIR: root }));
  const imported = projectFromImportedManifest({ id: 'fixture', uid: 'test', title: 'Fixture' }, manifest, hash);
  const coupledProfile = fidelityInternals.profileSourceSlide(imported.deck.slides[0], imported.externalPptx);
  assert.deepEqual(coupledProfile.safeGeometryModes, [], 'native image and text composites must keep their relative geometry');
  const reduced = fidelityFromImported({ pages: 2 }, imported, hash);
  assert.equal(reduced.slideMap.length, 2);
  assert.equal(reduced.slideMap[0], 0);
  assert.equal(reduced.slideMap.at(-1), 2);
  assert.equal(reduced.sourceCatalog.length, 3);
  assert.ok(reduced.sourceCatalog[0].nodes.some(node => node.type === 'image' && node.content.dataUrl), 'catalog retains immutable image bytes for remapping');
  assert.ok(reduced.sourceCatalog[1].nodes.some(node => node.type === 'image' && node.content.dataUrl), 'omitted source images remain available for remapping');
  const rescheduledReduced = { pages: 2, outline: [], templateFidelity: reduced };
  rescheduledReduced.pages = 3;
  rescheduledReduced.outline = Array.from({ length: 3 }, (_, index) => ({ role: 'evidence', title: `页 ${index + 1}` }));
  rescheduleTemplateFidelity(rescheduledReduced);
  assert.deepEqual(rescheduledReduced.templateFidelity.slideMap, [0, 1, 2]);
  assert.ok(rescheduledReduced.templateFidelity.slides.every(slide => slide.nodes.some(node => node.type === 'image' && node.content.dataUrl)), 'remapped previews retain original image bytes');
  const project = { id: 'fixture', uid: 'test', pages: 3,
    templateSpec: { fonts: { title: 'Arial', body: 'Arial', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC',
      titleEastAsiaHant: 'Noto Sans CJK TC', bodyEastAsiaHant: 'Noto Sans CJK TC' } },
    templateFidelity: fidelityFromImported({ pages: 3 }, imported, hash), deck: { slides: [] } };
  assert.equal(project.templateFidelity.slides.reduce((count, slide) => count + slide.imageCount, 0), 3);
  assert.match(templateOutlinePrompt(project), /模板保真约束/);
  assert.match(templateSlotPrompt(project, 0), /slotTexts/);
  assert.match(templateSlotPrompt(project, 0), /groupId/);
  project.deck.slides = project.templateFidelity.slides.map((source, index) => ({
    id: `generated_${index}`, title: `新标题${index + 1}`, section: '内容', bullets: ['新版正文'], nodes: [],
    templateSlotTexts: Object.fromEntries(source.slots.filter(slot => slot.role === 'content').map(slot => [String(slot.shapeId), '新版正文'])),
  }));
  assert.equal(inspectTemplateSlotDraft(project, 0, project.deck.slides[0]).length, 0);
  assert.ok(inspectTemplateSlotDraft(project, 0, { ...project.deck.slides[0], templateSlotTexts: {} }).some(issue => issue.code === 'template_slot_unfilled'));
  bindTemplateFidelity(project);
  const nativeTitle = project.deck.slides[0].nodes.find(node => node.semanticRole === 'template-title');
  const alias = { id: stableId('node', project.deck.slides[0].id, 'title'), type: 'text', semanticRole: 'title', content: { text: nativeTitle.content.text } };
  project.deck.slides[0].nodes.unshift(alias);
  bindTemplateFidelity(project);
  project.deck = ensureDeckV3(ensureDeckV3(project.deck));
  assert.ok(!project.deck.slides[0].nodes.some(node => node.id === alias.id), 'exact migration alias is removed and not recreated');
  assert.deepEqual(project.deck.slides[0].nodes.find(node => node.id === nativeTitle.id), nativeTitle, 'native title geometry and styling are unchanged');
  exportManifest(project);
  for (const mutation of [{ locked: true }, { content: { text: 'Different real title' } }, { id: 'user_title' }]) {
    const candidate = structuredClone(project);
    candidate.deck.slides[0].nodes.unshift({ ...alias, ...mutation });
    candidate.deck = ensureDeckV3(candidate.deck);
    assert.ok(candidate.deck.slides[0].nodes.some(node => node.id === (mutation.id || alias.id)), 'real or locked title must remain');
    assert.throws(() => exportManifest(candidate), /no exported render mapping/, 'unmapped real content still blocks export');
  }
  assert.equal(inspectTemplateFidelity(project).length, 0);
  assert.equal(project.deck.slides[0].nodes.filter(node => node.nativeRef).length, 4);
  const tree = buildRenderTree(project);
  assert.equal(tree.slides[0].elements.length, 4);
  assert.match(slideSvg(tree.slides[0]), /<image /);
  const slides = project.deck.slides.map(slide => ({ nativeSlideIndex: slide.templateSlideIndex,
    nodes: slide.nodes.filter(node => node.nativeRef).map(node => ({ type: node.type, semanticRole: node.semanticRole,
      nativeShapeId: node.nativeRef.shapeId, content: node.content, geometry: node.geometry, style: node.style })) }));
  const exported = JSON.parse(run(importer.EXPORT_SCRIPT,
    JSON.stringify({ original: fixture, slides, fonts: project.templateSpec.fonts }), { PPT_OUTPUT: output }));
  assert.equal(exported.slides, 3);
  assert.equal(exported.preservedOriginal, true);
  run(`from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
import hashlib, os
a=Presentation(os.environ['PPT_INPUT']); b=Presentation(os.environ['PPT_OUTPUT'])
assert len(a.slides)==len(b.slides)==3
for left,right in zip(a.slides,b.slides):
 assert len(left.shapes)==len(right.shapes)==4
 assert [hashlib.sha256(s.image.blob).hexdigest() for s in left.shapes if s.shape_type==MSO_SHAPE_TYPE.PICTURE] == [hashlib.sha256(s.image.blob).hexdigest() for s in right.shapes if s.shape_type==MSO_SHAPE_TYPE.PICTURE]
 text=' '.join(shape.text for shape in right.shapes if shape.has_text_frame)
 assert '新标题' in text and '新版正文' in text
 assert '旧标题' not in text and '旧正文' not in text`, '', { PPT_INPUT: fixture, PPT_OUTPUT: output });
  const traditional = path.join(root, 'traditional.pptx');
  slides[1].nodes.find(node => node.type === 'text' && node.semanticRole !== 'template-title').content.text = '繁體內容';
  run(importer.EXPORT_SCRIPT, JSON.stringify({ original: fixture, slides, fonts: project.templateSpec.fonts }), { PPT_OUTPUT: traditional });
  run(`from pptx import Presentation
from pptx.oxml.ns import qn
import os
p=Presentation(os.environ['PPT_INPUT'])
run=next(r for shape in p.slides[1].shapes if shape.has_text_frame for paragraph in shape.text_frame.paragraphs for r in paragraph.runs if '繁體內容' in r.text)
assert run._r.get_or_add_rPr().find(qn('a:ea')).get('typeface')==run.font.name
assert run.font.name`, '', { PPT_INPUT: traditional });
  if (spawnSync('sh', ['-c', 'command -v soffice'], { stdio: 'ignore' }).status === 0) {
    const pdfFile = path.join(root, 'generated.pdf');
    assert.equal(JSON.parse(run(pdf.PRESERVED_SCRIPT, '', { PPT_SOURCE: output, PPT_OUTPUT: pdfFile })).nativeTemplate, true);
    run(`from pypdf import PdfReader
import os
assert len(PdfReader(os.environ['PPT_INPUT']).pages)==3`, '', { PPT_INPUT: pdfFile });
  }
  project.deck.slides[0].nodes.find(node => node.semanticRole === 'template-text').content.text = '';
  assert.ok(inspectTemplateFidelity(project).some(issue => issue.code === 'template_slot_unfilled'));
  const [{ saveProject }, { applyCommand }] = await Promise.all([import('./lib/ppt/repository.mjs'), import('./lib/ppt/command-service.mjs')]);
  project.deck.slides[0].nodes.find(node => node.semanticRole === 'template-text').content.text = '新版正文';
  project.id = 'a'.repeat(32); project.uid = 'fidelity-test'; project.template = 'uploaded'; project.status = 'completed'; project.stage = 'completed';
  project.revision = 1; project.createdAt = new Date().toISOString(); project.updatedAt = project.createdAt;
  project.outline = project.deck.slides.map(slide => ({ id: slide.id, title: slide.title, focus: '' }));
  project.templateSpec.palette = { background: '#ffffff', foreground: '#111111', muted: '#555555', accent: '#aa7744' };
  saveProject(project);
  const title = project.deck.slides[0].nodes.find(node => node.semanticRole === 'template-title');
  const changed = await applyCommand(project.uid, project.id, { type: 'node.setContent', baseRevision: 1,
    payload: { slideId: project.deck.slides[0].id, nodeId: title.id, content: { text: '编辑后标题' } } });
  assert.equal(changed.project.deck.slides[0].title, '编辑后标题');
  assert.equal(changed.project.deck.slides[0].nodes.find(node => node.id === title.id).content.text, '编辑后标题');
  const service=await import('./lib/ppt/command-service.mjs');
  const removed=await applyCommand(project.uid,project.id,{type:'node.delete',baseRevision:changed.project.revision,payload:{slideId:project.deck.slides[0].id,nodeId:title.id}});
  assert.ok(removed.project.deck.slides[0].templateOmissions.some(item=>item.shapeId===title.nativeRef.shapeId&&item.approvalBasis==='user_editor_delete'));
  const restored=await service.undo(project.uid,project.id);
  assert.deepEqual(restored.project.deck.slides[0].nodes.find(node=>node.id===title.id).nativeRef,JSON.parse(JSON.stringify(title.nativeRef)));
  assert.deepEqual(restored.project.deck.slides[0].nodes.find(node=>node.id===title.id).nativeTextFrame,JSON.parse(JSON.stringify(title.nativeTextFrame)));
  const copied=await applyCommand(project.uid,project.id,{type:'node.duplicate',baseRevision:restored.project.revision,payload:{slideId:project.deck.slides[0].id,nodeId:title.id}});
  const clone=copied.project.deck.slides[0].nodes.find(node=>node.nativeRef?.cloneFromShapeId===title.nativeRef.shapeId);
  assert.ok(clone);assert.notEqual(clone.nativeRef.shapeId,title.nativeRef.shapeId);assert.equal(clone.templateComponentBinding.origin,'user');
  const uncopy=await service.undo(project.uid,project.id);assert.ok(!uncopy.project.deck.slides[0].nodes.some(node=>node.id===clone.id));
  const redoCopy=await service.redo(project.uid,project.id);assert.ok(redoCopy.project.deck.slides[0].nodes.some(node=>node.nativeRef?.cloneFromShapeId===title.nativeRef.shapeId));
  const back=await service.undo(project.uid,project.id);
  const picture=back.project.deck.slides[0].nodes.find(node=>node.type==='image');
  const unlocked=await applyCommand(project.uid,project.id,{type:'node.setLocked',baseRevision:back.project.revision,payload:{slideId:project.deck.slides[0].id,nodeId:picture.id,locked:false}});
  assert.equal(unlocked.project.deck.slides[0].nodes.find(node=>node.id===picture.id).locked,false);
  await service.undo(project.uid,project.id);
  const [{ handlePpt }, templateStore] = await Promise.all([import('./lib/ppt-api.mjs'), import('./lib/ppt-store.mjs')]);
  const templateId = 'b'.repeat(32); const templateUid = 'fidelity-api';
  templateStore.writeTemplate(templateUid, templateId, bytes);
  templateStore.saveTemplates(templateUid, [{ id: templateId, name: 'Native fixture', kind: 'uploaded', extension: 'pptx',
    compatibility: 'mapped', pages: 3, version: 1, palette: project.templateSpec.palette, fonts: project.templateSpec.fonts,
    sha256: hash, category: '我的模板', description: '', sampleTitles: [], tags: [], pinned: false }]);
  const api = async (pageCount, selectedTemplate = templateId) => {
    const requestBody = { prompt: '验证模板保真', template: selectedTemplate, configId: 'test', ...(pageCount === undefined ? {} : { pages: pageCount }) };
    const request = Readable.from([Buffer.from(JSON.stringify(requestBody))]);
    request.method = 'POST'; let response;
    await handlePpt(request, new URL('http://test/ppt/projects'), { uid: templateUid,
      send: (status, body) => { response = { status, body }; return true; }, res: {}, activity: () => {},
      deps: { prepareTemplateFidelity: async (newProject, original) => {
        assert.equal(original.compare(bytes), 0);
        return fidelityFromImported(newProject, imported, hash);
      }, modelCall: async newProject => ({ slides: Array.from({ length: newProject.pages }, (_, index) => ({ title: `第${index + 1}页`, focus: '验证内容' })) }) },
    });
    return response;
  };
  assert.equal((await api(2)).status, 400, 'the UI/API minimum is three pages');
  assert.equal((await api(4)).status, 400, 'one interior page cannot be reused without adjacent repetition');
  assert.equal((await api(5)).status, 400, 'a three-page template cannot expand safely');
  const created = await api(3);
  assert.equal(created.status, 201);
  assert.equal(templateStore.get(templateUid, created.body.project.id).templateFidelity.slides.length, 3);
  const estimated = await api(undefined, 'violet');
  assert.equal(estimated.status, 201);
  assert.ok(estimated.body.project.pages >= 7, 'a sparse prompt is planned before page estimation instead of defaulting to the template length');
  assert.equal(estimated.body.project.contentPlan.semanticUnits.length >= 7, true);
  assert.equal(estimated.body.project.pageDecision.source, 'estimate');
  const listFixture = path.join(root, 'list-template.pptx');
  const listOutput = path.join(root, 'list-output.pptx');
  run(`from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.oxml.xmlchemy import OxmlElement
import os
p=Presentation()
for index in range(2):
 s=p.slides.add_slide(p.slide_layouts[6])
 title=s.shapes.add_textbox(Inches(.7),Inches(.5),Inches(9),Inches(.7)); title.text='模板标题'; title.text_frame.paragraphs[0].runs[0].font.size=Pt(30)
 box=s.shapes.add_textbox(Inches(1),Inches(2),Inches(7),Inches(1.5)); box.text_frame.word_wrap=True
 for number in range(2):
  paragraph=box.text_frame.paragraphs[0] if number==0 else box.text_frame.add_paragraph()
  bullet=OxmlElement('a:buChar'); bullet.set('char','•'); paragraph._p.get_or_add_pPr().append(bullet)
  label=paragraph.add_run(); label.text='旧标签'; label.font.bold=True; label.font.size=Pt(14)
  body=paragraph.add_run(); body.text='：旧说明'; body.font.bold=False; body.font.size=Pt(14)
p.save(os.environ['PPT_OUTPUT'])`, '', { PPT_OUTPUT: listFixture });
  const listBytes = fs.readFileSync(listFixture);
  const listManifest = JSON.parse(run(importer.IMPORT_SCRIPT, listBytes, { PPT_EXTERNAL_DIR: path.join(root, 'list-external') }));
  const listImported = projectFromImportedManifest({ id: 'list', uid: 'test', title: 'List' }, listManifest, 'list-hash');
  const listProject = { id: 'list', pages: 2, templateSpec: project.templateSpec,
    templateFidelity: fidelityFromImported({ pages: 2 }, listImported, 'list-hash'), deck: { slides: [] } };
  const listSlot = listProject.templateFidelity.slides[0].slots.find(slot => slot.purpose === 'list');
  assert.equal(listSlot.paragraphCount, 2);
  assert.equal(listSlot.paragraphs[0].hasLabelRun, true);
  listProject.deck.slides = listProject.templateFidelity.slides.map((source, index) => ({ id: `list_slide_${index}`, title: '新标题', nodes: [],
    templateSlotTexts: { [String(listSlot.shapeId)]: [{ label: '来源', body: '记录文档位置' }, { label: '引用', body: '支持逐页复核' }] } }));
  assert.deepEqual(inspectTemplateSlotDraft(listProject, 0, listProject.deck.slides[0]), []);
  listProject.deck.slides[0].templateSlotTexts[String(listSlot.shapeId)] = [{ label: '来源', body: '记录文档位置' }];
  assert.ok(inspectTemplateSlotDraft(listProject, 0, listProject.deck.slides[0]).some(issue => issue.code === 'template_point_count'));
  listProject.deck.slides[0].templateSlotTexts[String(listSlot.shapeId)] = [{ label: '来源', body: '记录文档位置' }, { label: '引用', body: '支持逐页复核' }];
  for (const values of [
    [{ label: '來源', body: '記錄文件位置' }, { label: '引用', body: '支援逐頁複核' }],
    [{ label: 'Source', body: 'Track origin' }, { label: 'Review', body: 'Check each page' }],
  ]) {
    listProject.deck.slides[0].templateSlotTexts[String(listSlot.shapeId)] = values;
    assert.deepEqual(inspectTemplateSlotDraft(listProject, 0, listProject.deck.slides[0]), []);
  }
  listProject.deck.slides[0].templateSlotTexts[String(listSlot.shapeId)] = [{ label: '来源', body: '记录文档位置' }, { label: '引用', body: '支持逐页复核' }];
  bindTemplateFidelity(listProject);
  assert.equal(inspectTemplateFidelity(listProject).length, 0);
  const listElement = buildRenderTree(listProject).slides[0].elements.find(item => item.content?.paragraphs);
  assert.match(slideSvg(buildRenderTree(listProject).slides[0]), /<strong[^>]*>(?:<span[^>]*>)?来源(?:<\/span>)?<\/strong>/);
  assert.equal(listElement.nativeTextFrame.paragraphs.length, 2);
  const { _internals: commandInternals } = await import('./lib/ppt/command-service.mjs');
  const listNode = listProject.deck.slides[0].nodes.find(node => node.content?.paragraphs);
  const editedList = commandInternals.applyToDeck(listProject.deck, { type: 'node.setContent',
    payload: { slideId: listProject.deck.slides[0].id, nodeId: listNode.id,
      content: { text: '来源：可查看文档位置\n引用：支持逐页核对' } } }, listProject);
  assert.deepEqual(editedList.deck.slides[0].nodes.find(node => node.id === listNode.id).content.paragraphs.map(({label,body})=>({label,body})),
    [{ label: '来源', body: '可查看文档位置' }, { label: '引用', body: '支持逐页核对' }]);
  assert.throws(() => commandInternals.applyToDeck(listProject.deck, { type: 'node.setContent',
    payload: { slideId: listProject.deck.slides[0].id, nodeId: listNode.id, content: { text: '仅一条' } } }, listProject),
  error => error.statusCode === 409);
  const listSlides = listProject.deck.slides.map(slide => ({ nativeSlideIndex: slide.templateSlideIndex,
    nodes: slide.nodes.filter(node => node.nativeRef).map(node => ({ type: node.type, semanticRole: node.semanticRole,
      nativeShapeId: node.nativeRef.shapeId, content: node.content, geometry: node.geometry, style: node.style })) }));
  run(importer.EXPORT_SCRIPT, JSON.stringify({ original: listFixture, slides: listSlides, fonts: project.templateSpec.fonts }), { PPT_OUTPUT: listOutput });
  run(`from pptx import Presentation
import os
p=Presentation(os.environ['PPT_INPUT']); shape=next(shape for shape in p.slides[0].shapes if '来源' in shape.text)
assert len([paragraph for paragraph in shape.text_frame.paragraphs if paragraph.text.strip()])==2
assert shape.text_frame.auto_size==0
assert [paragraph.runs[0].font.size.pt for paragraph in shape.text_frame.paragraphs]==[14,14]
assert all(paragraph.runs[0].font.bold and paragraph.runs[1].font.bold==False for paragraph in shape.text_frame.paragraphs)
assert all(paragraph._p.pPr is not None for paragraph in shape.text_frame.paragraphs)`, '', { PPT_INPUT: listOutput });
  console.log('PPT template fidelity, native pictures/components, text slots, render tree and export: OK');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
