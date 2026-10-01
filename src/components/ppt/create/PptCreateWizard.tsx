'use client';
/* eslint-disable @next/next/no-img-element -- local pasted image previews */

import { useEffect, useMemo, useRef, useState } from 'react';
import { prepareImage, type VisualBlock } from '../PptBlocks';
import { useTranslation } from '@/hooks/useTranslation';
import { TemplateBrowser } from './TemplateBrowser';
import { TemplateSettingsLayout } from './TemplateSettingsLayout';
import type { PptModel, PptTemplate } from '../types';

export type CreateKind = 'prompt' | 'paste' | 'file';
export type CreateEntry = 'new' | 'template' | 'direct';
export type PptCreateDraft = {
  inputKind: CreateKind; title: string; prompt: string; text: string; file: File | null; importMode: 'generate' | 'editable';
  pages: number; compressionApproved: boolean; template: string; modelKey: string; images: Extract<VisualBlock, { type: 'image' }>[];
  pageSource?: 'estimate' | 'user';
  outline?: { id: string; section: string; title: string; focus: string; description: string; children: { id: string; title: string; description: string }[] }[];
  analyzedProjectId?: string;
};

const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';
const primary = 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50';
const chips = ['季度业务复盘', '产品发布会', '客户解决方案提案', '培训课程'];

type PageEstimate = { recommended: number; min: number; max: number; reason: string; requested?: number };
function clampPages(value: number) { return Math.max(3, Math.min(100, Math.round(value))); }
export function estimate(kind: CreateKind, prompt: string, text: string, file: File | null): PageEstimate {
  const explicit = prompt.match(/(?:^|[^第\d])(\d{1,3})\s*(?:页|slides?)/i);
  const requested = explicit ? clampPages(Number(explicit[1])) : undefined;
  const source = kind === 'paste' ? text : prompt;
  if (kind === 'prompt' && source.trim().length < 300 && !/^\s*#{1,4}\s+/m.test(source)) {
    const intent = /培训|培訓|课程|課程|教学|教學|tutorial|course|training/i.test(source) ? 'learning'
      : /计划|計劃|路线图|路線圖|发布|發佈|roadmap|launch|product plan/i.test(source) ? 'planning'
        : /比较|比較|对比|對比|评估方案|評估方案|compare|versus/i.test(source) ? 'comparison'
          : /架构|架構|平台|平臺|系统|系統|agent|architecture|platform|runtime/i.test(source) ? 'technical' : 'overview';
    const roles: Record<string, string[]> = {
      learning: ['definition', 'mechanism', 'application', 'evaluation', 'constraint', 'implementation'],
      planning: ['problem', 'definition', 'application', 'evaluation', 'constraint', 'implementation', 'decision'],
      comparison: ['problem', 'definition', 'mechanism', 'application', 'evaluation', 'constraint', 'decision'],
      technical: ['problem', 'definition', 'mechanism', 'architecture', 'application', 'evaluation', 'constraint', 'implementation'],
      overview: ['problem', 'definition', 'mechanism', 'application', 'evaluation', 'constraint', 'implementation'],
    };
    const selected = new Set(roles[intent]);
    if (/决策|決策|管理层|管理層|汇报|匯報|report|decision|executive/i.test(source)) selected.add('decision');
    const cost = [...selected].reduce((sum, role) => sum + (['architecture', 'mechanism'].includes(role) ? .72
      : ['implementation', 'evaluation'].includes(role) ? .55 : .42), 0);
    const recommended = clampPages(Math.ceil(cost / .68) + 2);
    const spread = Math.max(2, Math.ceil(recommended * .18));
    const reason = `已按 ${selected.size} 个待论证语义单元预规划；具体事实与效果仍需来源支持。`;
    return { recommended, min: clampPages(recommended - spread), max: clampPages(recommended + spread),
      reason: requested ? `${reason} 已识别输入中写明的 ${requested} 页并作为初始选择。` : reason, requested };
  }
  const topics = Math.max(1, (source.match(/^#{1,4}\s+.+$/gm) || []).length, (source.match(/^\s*(?:[-*]|\d+[.、)])\s+/gm) || []).length / 3);
  const detailSignals = (source.match(/architecture|workflow|pipeline|implementation|runtime|constraint|example|架构|流程|实现|运行时|约束|示例/gi) || []).length;
  const fileWeight = kind === 'file' && file ? Math.min(16, Math.ceil(file.size / 180_000)) : 0;
  const recommended = clampPages(kind === 'prompt'
    ? 6 + Math.ceil(prompt.length / 1200) + Math.min(4, detailSignals)
    : 4 + Math.ceil(Math.max(source.length / 1800, topics * .7, fileWeight)) + Math.min(5, Math.ceil(detailSignals / 3)));
  const spread = Math.max(2, Math.ceil(recommended * .18));
  const reason = kind === 'file' ? '根据文件体量与补充要求预估；解析后仍会按最终页数规划。' : '根据内容体量、主题数量和细节信号预估。';
  return { recommended, min: clampPages(recommended - spread), max: clampPages(recommended + spread), reason: requested ? `${reason} 已识别输入中写明的 ${requested} 页并作为初始选择。` : reason, requested };
}

type Outline = NonNullable<PptCreateDraft['outline']>;

function ModelSummary({ model }: { model?: PptModel }) {
  return <section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">当前解析模型</h3><p className="mt-1 text-xs text-muted-foreground">该模型会沿用到内容理解、大纲生成和页面生成。</p><div className="mt-4 rounded-lg bg-muted p-3 text-sm"><strong>{model?.name || '未选择'}</strong></div></section>;
}

export function PptCreateWizard({ models, templates, initialKind, entry, modelKey, onModelKeyChange, lockedTemplate, busy, onCancel, onBackToChooser, onAnalyze, onSubmit }: {
  models: PptModel[]; templates: PptTemplate[]; initialKind?: CreateKind; entry: CreateEntry; modelKey: string;
  onModelKeyChange: (key: string) => void; lockedTemplate?: PptTemplate | null; busy: boolean;
  onCancel: () => void; onBackToChooser: () => void; onAnalyze: (draft: PptCreateDraft) => Promise<{ id: string; outline: Outline; pages: number; recommendation?: PageEstimate }>;
  onSubmit: (draft: PptCreateDraft) => Promise<void>;
}) {
  const { t } = useTranslation();
  const mounted = useRef(true); const analysisAttempt = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; analysisAttempt.current++; }; }, []);
  function previousStep() { analysisAttempt.current++; setAnalyzing(false); setStep((step - 1) as 1 | 2 | 3); }
  const direct = entry === 'direct';
  const [kind] = useState<CreateKind>(direct ? 'file' : initialKind || 'prompt');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [title, setTitle] = useState(''); const [prompt, setPrompt] = useState(''); const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null); const [importMode, setImportMode] = useState<'generate' | 'editable'>('generate');
  const [supplementMode, setSupplementMode] = useState<'prompt' | 'paste'>('prompt'); const [outlineReady, setOutlineReady] = useState(false);
  const initialEstimate = estimate(kind, '', '', null);
  const [localOutline, setLocalOutline] = useState<Outline>([]); const [outlineTouched, setOutlineTouched] = useState(false);
  const [pages, setPages] = useState(initialEstimate.recommended); const [pagesTouched, setPagesTouched] = useState(false);
  const [compressionApproved, setCompressionApproved] = useState(false);
  const templateInitialized = useRef(Boolean(lockedTemplate || templates.some(item => item.compatibility === 'mapped')));
  const [template, setTemplate] = useState(lockedTemplate?.id || templates.find(item => item.compatibility === 'mapped')?.id || 'violet');
  useEffect(() => { if (!templateInitialized.current) { const first = templates.find(item => item.compatibility === 'mapped'); if (first) { setTemplate(first.id); templateInitialized.current = true; } } }, [templates]);
  const [images, setImages] = useState<Extract<VisualBlock, { type: 'image' }>[]>([]);
  const fileIdentity = useRef<{ file: File | null; version: number }>({ file: null, version: 0 });
  if (fileIdentity.current.file !== file) fileIdentity.current = { file, version: fileIdentity.current.version + 1 };
  const sourceSignature = [fileIdentity.current.version, title, prompt, text, file?.name, file?.size, file?.lastModified, modelKey, ...images.map(image => image.id)].join('\u0000');
  const lastSourceSignature = useRef(sourceSignature);
  const [analyzedProjectId, setAnalyzedProjectId] = useState<string | null>(null);
  const [analyzedTemplate, setAnalyzedTemplate] = useState<string | null>(null);
  const [analyzedPages, setAnalyzedPages] = useState<number | null>(null);
  const [serverEstimate, setServerEstimate] = useState<PageEstimate | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  useEffect(() => {
    if (lastSourceSignature.current === sourceSignature) return;
    lastSourceSignature.current = sourceSignature;
    setAnalyzedProjectId(null); setAnalyzedTemplate(null); setAnalyzedPages(null); setLocalOutline([]);
    setServerEstimate(null);
    setOutlineReady(false); setOutlineTouched(false);
  }, [sourceSignature]);
  const localEstimate = useMemo(() => estimate(kind, prompt, text, file), [kind, prompt, text, file]);
  const suggested = serverEstimate || localEstimate;
  const selectedTemplate = templates.find(item => item.id === (lockedTemplate?.id || template));
  const preservedPageCount = selectedTemplate?.kind === 'uploaded' && selectedTemplate.extension === 'pptx' ? selectedTemplate.pages : null;
  const effectivePages = pagesTouched ? pages : (analyzedPages ?? suggested.requested ?? suggested.recommended);
  const maxPreservedPages = preservedPageCount === null ? null : selectedTemplate?.capabilities?.maxPages ?? (preservedPageCount < 4 ? preservedPageCount : preservedPageCount < 8 ? preservedPageCount * 3 - 4 : 100);
  const templatePageMismatch = preservedPageCount !== null && effectivePages > (maxPreservedPages || 0);
  const editableImport = kind === 'file' && file?.name.toLowerCase().endsWith('.pptx') && importMode === 'editable';
  const currentModel = models.find(item => item.id === modelKey);
  const resolvedTemplate = lockedTemplate?.id || template;
  const templateAvailable = selectedTemplate?.compatibility === 'mapped';
  const reviewStep = direct ? 3 : 2;
  const sourceReady = kind === 'prompt' ? Boolean(prompt.trim()) : kind === 'paste' ? Boolean(text.trim()) && outlineReady : Boolean(file);
  const compressionRisk = !editableImport && kind !== 'prompt' && effectivePages < suggested.min;
  const previewOutline = localOutline;
  function editOutline(items: Outline) {
    if (items.length !== localOutline.length) {
      // Keep analyzedPages as the last LLM-planned count. A manual add/delete
      // changes the hard page budget and must trigger another planning pass.
      setPagesTouched(true); setPages(items.length);
    }
    setLocalOutline(items); setOutlineTouched(true);
  }

  async function addImages(files: File[]) {
    const accepted = files.filter(item => ['image/png', 'image/jpeg'].includes(item.type)).slice(0, 4 - images.length);
    const prepared = await Promise.all(accepted.map(async item => ({ id: crypto.randomUUID().replaceAll('-', '').slice(0, 32), type: 'image' as const, dataUrl: await prepareImage(item), caption: item.name.replace(/\.(png|jpe?g)$/i, '').slice(0, 100) })));
    setImages(current => [...current, ...prepared].slice(0, 4));
  }
  function draft(): PptCreateDraft {
    return { inputKind: kind, title, prompt: kind === 'file' && supplementMode === 'paste' ? text : prompt, text, file, importMode,
      pages: effectivePages, pageSource: pagesTouched || suggested.requested ? 'user' : 'estimate',
      compressionApproved, template: resolvedTemplate, modelKey, images, analyzedProjectId: analyzedProjectId || undefined };
  }
  async function analyze() {
    if (!modelKey || (kind === 'paste' && !text.trim()) || (kind === 'file' && !file)) return false;
    const attempt = ++analysisAttempt.current;
    setAnalyzing(true); setAnalysisError(''); setOutlineReady(false);
    try {
      const signature = sourceSignature;
      const result = await onAnalyze({ ...draft(), outline: outlineTouched ? localOutline : undefined });
      if (!mounted.current || analysisAttempt.current !== attempt) return false;
      if (lastSourceSignature.current !== signature) throw new Error('输入内容已更改，请重新读取');
      setAnalyzedProjectId(result.id); setAnalyzedTemplate(resolvedTemplate); setAnalyzedPages(result.pages); setLocalOutline(result.outline);
      setServerEstimate(result.recommendation || null);
      setOutlineTouched(false); setOutlineReady(true);
      return true;
    } catch (error) { if (mounted.current && analysisAttempt.current === attempt) setAnalysisError((error as Error).message); return false; }
    finally { if (mounted.current && analysisAttempt.current === attempt) setAnalyzing(false); }
  }
  async function readPaste() { await analyze(); }
  async function parseFile() { if (editableImport) { setStep(3); return; } if (await analyze()) setStep(3); }
  async function next() {
    if (!sourceReady) return;
    if (direct) { setStep(2); return; }
    if ((kind === 'file' || kind === 'prompt') && !editableImport && !await analyze()) return;
    setStep(2);
  }
  async function submit() {
    if (!editableImport && !templateAvailable) { setAnalysisError(t('ppt.edit.templateMissing')); return; }
    if (!editableImport && analyzedProjectId && localOutline.length < 3) { setAnalysisError(t('ppt.outline')); return; }
    if (templatePageMismatch) return;
    if (analyzedProjectId && (analyzedPages !== effectivePages || analyzedTemplate !== resolvedTemplate)) { await analyze(); return; }
    await onSubmit({ ...draft(), outline: analyzedProjectId ? localOutline : undefined });
  }
  const titleForKind = kind === 'prompt' ? '从 Prompt 开始' : kind === 'paste' ? '粘贴文本' : '导入文件';
  const steps = direct ? ['上传文件', '选择 LLM 与补充内容', '确认大纲与模板'] : [kind === 'prompt' ? '输入 Prompt' : kind === 'paste' ? '粘贴文本' : '导入文件与补充内容', '确认模板与页数', '开始生成'];

  return <section className="ppt-prototype ppt-create-stage fixed inset-0 z-50 flex flex-col bg-background text-foreground" data-testid="ppt-create-wizard">
    <header className="flex h-16 items-center gap-3 border-b border-border px-4"><button className="grid h-9 w-9 place-items-center rounded-lg border border-border" aria-label="返回" onClick={() => step > 1 ? previousStep() : direct ? onCancel() : onBackToChooser()}>←</button><span className="grid h-8 w-8 place-items-center rounded-lg bg-primary font-semibold text-primary-foreground">A</span><strong>新建 PPT / {titleForKind}</strong><span className="ml-auto rounded-full border border-border px-3 py-1 text-xs">LLM · {currentModel?.name || '未选择'}</span></header>
    <div className="ppt-create-body flex-1 overflow-y-auto p-4 md:p-8"><div className="ppt-create-wrap mx-auto max-w-6xl space-y-5">{analysisError && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{analysisError}</div>}<div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">{steps.map((label, index) => <div key={label} className="flex items-center gap-2">{index > 0 && <i className="h-px w-7 bg-border"/>}<span className={step === index + 1 ? 'font-medium text-foreground' : ''}><b className={`mr-1 inline-grid h-6 w-6 place-items-center rounded-full ${step >= index + 1 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{step > index + 1 ? '✓' : index + 1}</b>{label}</span></div>)}</div>
      {step === 1 && <><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">新建 PPT · Step 1</p><h1 className="mt-2 text-2xl font-semibold">{titleForKind}</h1><p className="mt-2 text-sm text-muted-foreground">{kind === 'prompt' ? '当前 LLM 已确认。输入主题、目标和重点内容，下一步选择模板与页数。' : kind === 'paste' ? '当前 LLM 已确认。粘贴文本后由 Agent 读取并生成可编辑大纲。' : direct ? '先上传源文件；文件不会在这一步解析。' : '当前 LLM 已确认。上传源文件，可选补充生成要求，然后解析并生成可编辑大纲。'}</p></div>
        {kind === 'prompt' && <div className="ppt-create-split grid gap-5 lg:grid-cols-2"><section className="space-y-5 rounded-xl border border-border bg-card p-5"><label className="block space-y-1 text-sm">PPT 标题（可选）<input className={field} value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：Q4 产品增长复盘" maxLength={160}/></label><label className="block space-y-1 text-sm">输入 Prompt<textarea aria-label="输入 Prompt" className={`${field} min-h-56`} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="告诉 AI 这份 PPT 要讲清楚什么、给谁看，以及希望他们记住什么…" maxLength={12000}/></label><div className="flex flex-wrap gap-2">{chips.map(chip => <button key={chip} className={button} onClick={() => setPrompt(`${chip}，请帮我整理成一份结构清晰的演示文稿。`)}>{chip}</button>)}</div></section><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">推荐写法</h3><p className="mt-2 text-sm text-muted-foreground">把对象、目标、内容重点和页数写进 Prompt，生成结构会更稳定。</p><div className="mt-4 rounded-lg border border-border bg-background p-3 text-xs"><strong>示例</strong><p className="mt-2 text-muted-foreground">面向管理层生成一份 Q4 产品增长复盘，重点说明增长来源、主要风险、下一季度行动计划，控制在 12 页以内。</p></div></section></div>}
        {kind !== 'prompt' && !direct && <label className="block max-w-xl space-y-1 text-sm">PPT 标题（可选）<input className={field} value={title} onChange={event => setTitle(event.target.value)} placeholder="未填写时由 Agent 生成精炼标题" maxLength={160}/><small className="text-muted-foreground">填写后将锁定为封面标题；Agent 只可为排版换行，不会改写。</small></label>}
        {kind === 'paste' && <div className="ppt-create-split grid gap-5 lg:grid-cols-2"><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">Syllabus（大纲）</h3><p className="mt-1 text-sm text-muted-foreground">AI 读取完成后会生成章节、子章节与内容摘要；所有字段都可编辑。</p>{outlineReady ? <OutlineEditor items={previewOutline} onChange={editOutline} onReorganize={() => void analyze()} busy={analyzing || busy}/> : <p className="mt-4 rounded-lg bg-muted p-4 text-sm text-muted-foreground">粘贴文本后，点击「AI 读取文本并生成大纲」。</p>}</section><section className="rounded-xl border border-border bg-card p-5"><label className="block space-y-1 text-sm">粘贴文本<textarea aria-label="粘贴文本" className={`${field} min-h-72`} value={text} onChange={event => { setText(event.target.value); setOutlineReady(false); setOutlineTouched(false); }} onPaste={event => { const files = [...event.clipboardData.items].filter(item => item.kind === 'file' && ['image/png', 'image/jpeg'].includes(item.type)).map(item => item.getAsFile()).filter((item): item is File => Boolean(item)); void addImages(files); }} placeholder="粘贴笔记、报告或大纲…" maxLength={80000}/></label>{images.length > 0 && <div className="mt-3 grid grid-cols-4 gap-2">{images.map(image => <img key={image.id} src={image.dataUrl} alt={image.caption || '粘贴图片'} className="aspect-video w-full rounded border border-border object-cover"/>)}</div>}<div className="mt-4 flex justify-end"><button className={primary} disabled={!text.trim() || analyzing || busy} onClick={() => void readPaste()}>{analyzing ? 'AI 正在读取文本…' : outlineReady ? '重新读取文本' : 'AI 读取文本并生成大纲'}</button></div></section></div>}
        {kind === 'file' && <FileSource file={file} setFile={value => { setFile(value); setOutlineTouched(false); }} importMode={importMode} setImportMode={setImportMode} direct={direct} supplementMode={supplementMode} setSupplementMode={setSupplementMode} prompt={prompt} setPrompt={setPrompt} text={text} setText={setText}/>}
      </>}
      {step === 2 && direct && <><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">导入 PPT · Step 2</p><h1 className="mt-2 text-2xl font-semibold">选择 LLM 与补充内容</h1><p className="mt-2 text-sm text-muted-foreground">文件会在确认 LLM 后解析；补充内容可选，用于说明重点、受众或最新信息。</p></div><div className="ppt-create-split grid gap-5 lg:grid-cols-2"><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">解析模型 <span className="text-destructive">*</span></h3><p className="mt-1 text-xs text-muted-foreground">模型用于读取文件、生成大纲和后续页面内容。</p><label className="mt-4 block space-y-1 text-sm">LLM（必填）<select className={field} aria-label="导入解析 LLM" value={modelKey} onChange={event => onModelKeyChange(event.target.value)}><option value="">请选择 LLM</option>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label></section><div className="space-y-4"><label className="block space-y-1 text-sm">PPT 标题（可选）<input className={field} value={title} onChange={event => setTitle(event.target.value)} placeholder="未填写时使用文件名" maxLength={160}/></label><Supplement mode={supplementMode} setMode={setSupplementMode} prompt={prompt} setPrompt={setPrompt} text={text} setText={setText}/></div></div></>}
        {step === reviewStep && <><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">{direct ? '导入 PPT · Step 3' : '新建 PPT · Step 2'}</p><h1 className="mt-2 text-2xl font-semibold">确认大纲与模板</h1><p className="mt-2 text-sm text-muted-foreground">模型已锁定。检查大纲，选择模板和最终页数后开始生成。</p></div><TemplateSettingsLayout main={<TemplateBrowser templates={templates} selectedId={resolvedTemplate} onSelect={setTemplate} locked={Boolean(lockedTemplate)}/>} sidebar={<><ModelSummary model={currentModel}/><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">最终页数</h3><p className="mt-1 text-xs text-muted-foreground">Agent 建议 {suggested.recommended} 页（合理范围 {suggested.min}–{suggested.max} 页）。{suggested.reason}</p><div className="mt-4 flex flex-wrap items-center gap-3"><button className={button} disabled={effectivePages <= 3} onClick={() => { setPagesTouched(true); setPages(effectivePages - 1); setCompressionApproved(false); }}>−</button><b>{effectivePages} 页</b><button className={button} disabled={effectivePages >= 100} onClick={() => { setPagesTouched(true); setPages(effectivePages + 1); setCompressionApproved(false); }}>＋</button><button className="text-xs text-primary" onClick={() => { setPagesTouched(true); setPages(suggested.recommended); setCompressionApproved(false); }}>使用建议 {suggested.recommended} 页</button></div><p className="mt-3 text-xs text-muted-foreground">你确认的页数包含封面，并将作为 Story Planner 和最终输出的硬参数。</p>{preservedPageCount !== null && <p className={`mt-2 text-xs ${templatePageMismatch ? 'text-destructive' : 'text-muted-foreground'}`}>所选模板含 {preservedPageCount} 张原生页面；页数由你手动调整，其次采用 Agent 建议。输出少于模板页数时会选择适配页面；输出较多时才进行受控版式复用。此模板最多支持 {maxPreservedPages} 页。{templatePageMismatch && `当前模板无法安全扩展到 ${effectivePages} 页，请将页数降至 ${maxPreservedPages} 页以内或选择更适合的模板。`}</p>}{compressionRisk && <label className="mt-4 flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs"><input type="checkbox" checked={compressionApproved} onChange={event => setCompressionApproved(event.target.checked)}/><span>当前页数低于保真建议范围，可能无法完整保留来源深度。我确认继续按 {effectivePages} 页生成并允许压缩低优先级细节。</span></label>}</section></>} outline={<>{outlineReady && !editableImport && <section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">AI 生成大纲</h3>{analyzedPages !== effectivePages && <p className="mt-2 text-xs text-primary">页数已调整。点击下方按钮按最终页数重新生成大纲，确认后再开始生成。</p>}<OutlineEditor items={previewOutline} onChange={editOutline} onReorganize={() => void analyze()} busy={analyzing || busy}/></section>}</>}/></>}
    </div></div>
    <footer className="flex min-h-16 flex-wrap items-center gap-3 border-t border-border px-4 py-3"><span className="text-xs text-muted-foreground">个人工作区 · 页面式创建流程</span><span className="ml-auto"/>{step === 1 ? <button className={button} onClick={direct ? onCancel : onBackToChooser}>← 返回{direct ? '工作区' : '创建方式'}</button> : <button className={button} onClick={() => previousStep()}>← 返回上一步</button>}{step === 1 ? <button className={primary} disabled={!sourceReady || busy || analyzing} onClick={() => void (editableImport && !direct ? submit() : next())}>{editableImport && !direct ? '打开并编辑 PPTX' : kind === 'paste' && !outlineReady ? '先生成大纲' : kind === 'file' && direct ? '下一步：选择 LLM →' : kind === 'file' ? '解析文件并生成大纲 →' : '下一步：选择模板与页数 →'}</button> : step === 2 && direct ? <button className={primary} disabled={!modelKey || analyzing || busy} onClick={() => void parseFile()}>{editableImport ? '下一步：确认模板 →' : '解析文件并生成大纲 →'}</button> : <button className={primary} disabled={busy || analyzing || (!editableImport && !templateAvailable) || templatePageMismatch || (!editableImport && !modelKey) || (compressionRisk && !compressionApproved)} onClick={() => void submit()}>{analyzing ? 'AI 正在生成大纲…' : editableImport ? '打开并编辑 PPTX' : analyzedProjectId && (analyzedPages !== effectivePages || analyzedTemplate !== resolvedTemplate) ? '按最终页数与模板重新生成大纲' : '开始生成'}</button>}</footer>
  </section>;
}

function OutlineEditor({ items, onChange, onReorganize, busy = false }: { items: Outline; onChange: (items: Outline) => void; onReorganize?: () => void; busy?: boolean }) {
  function update(index: number, patch: Partial<Outline[number]>) { onChange(items.map((item, at) => at === index ? { ...item, ...patch } : item)); }
  function move(index: number, offset: number) {
    const at = index + offset;
    if (at < 0 || at >= items.length) return;
    const next = [...items]; [next[index], next[at]] = [next[at], next[index]]; onChange(next);
  }
  return <div className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto" aria-label="可编辑大纲">
    {items.map((item, index) => <div key={item.id} className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-2"><span className="pt-2 text-xs text-muted-foreground">{index + 1}.</span><div className="min-w-0 flex-1 space-y-2">
        <input aria-label={`章节名称 ${index + 1}`} className={field} value={item.section} onChange={event => update(index, { section: event.target.value })}/>
        <input aria-label={`大纲标题 ${index + 1}`} className={field} value={item.title} onChange={event => update(index, { title: event.target.value, focus: event.target.value })}/>
        <textarea aria-label={`大纲描述 ${index + 1}`} className={field} value={item.description} onChange={event => update(index, { description: event.target.value })}/>
        {(item.children || []).map((child, childIndex) => <div key={child.id} className="grid gap-2 rounded-lg bg-muted/50 p-2 sm:grid-cols-[1fr_1fr_auto]">
          <input aria-label={`子章节标题 ${index + 1}-${childIndex + 1}`} className={field} value={child.title} onChange={event => update(index, { children: item.children.map((row, at) => at === childIndex ? { ...row, title: event.target.value } : row) })}/>
          <input aria-label={`子章节描述 ${index + 1}-${childIndex + 1}`} className={field} value={child.description} onChange={event => update(index, { children: item.children.map((row, at) => at === childIndex ? { ...row, description: event.target.value } : row) })}/>
          <button className={button} aria-label={`删除子章节 ${index + 1}-${childIndex + 1}`} onClick={() => update(index, { children: item.children.filter((_, at) => at !== childIndex) })}>×</button>
        </div>)}
        <button className="text-xs text-primary" disabled={(item.children || []).length >= 12} onClick={() => update(index, { children: [...(item.children || []), { id: crypto.randomUUID().replaceAll('-', ''), title: '', description: '' }] })}>＋ 添加子章节</button>
      </div><div className="grid gap-1"><button className={button} aria-label={`上移章节 ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button className={button} aria-label={`下移章节 ${index + 1}`} disabled={index === items.length - 1} onClick={() => move(index, 1)}>↓</button><button className={button} aria-label={`删除章节 ${index + 1}`} disabled={items.length <= 3} onClick={() => onChange(items.filter((_, at) => at !== index))}>×</button></div></div>
    </div>)}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={items.length >= 100} onClick={() => onChange([...items, { id: crypto.randomUUID().replaceAll('-', ''), section: `章节 ${items.length + 1}`, title: '新章节', focus: '新章节', description: '', children: [] }])}>＋ 添加章节</button>{onReorganize && <button className={button} disabled={busy} onClick={onReorganize}>↻ AI 重新组织</button>}</div>
  </div>;
}

function FileSource({ file, setFile, importMode, setImportMode, direct, supplementMode, setSupplementMode, prompt, setPrompt, text, setText }: { file: File | null; setFile: (file: File | null) => void; importMode: 'generate' | 'editable'; setImportMode: (mode: 'generate' | 'editable') => void; direct: boolean; supplementMode: 'prompt' | 'paste'; setSupplementMode: (mode: 'prompt' | 'paste') => void; prompt: string; setPrompt: (value: string) => void; text: string; setText: (value: string) => void }) {
  return <div className="ppt-create-split grid gap-5 lg:grid-cols-2"><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">选择源文件</h3><p className="mt-1 text-sm text-muted-foreground">支持演示文稿、PDF、Word、Excel（.xlsx）、CSV、Markdown 与 HTML。</p><div className="mt-5 flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border p-5 text-center" onDragOver={event => event.preventDefault()} onDrop={event => setFile(event.dataTransfer.files[0] || null)}><span className="text-3xl text-primary">↥</span><strong className="mt-3">{file?.name ? `✓ ${file.name}` : '拖放文件到这里，或点击选择文件'}</strong><small className="mt-1 text-muted-foreground">支持 .pptx、.pdf、.docx、.xlsx、.csv、.md、.html</small><label className={`${button} mt-4`}>{file ? '重新选择文件' : '选择文件'}<input className="sr-only" type="file" accept=".md,.markdown,.html,.htm,.docx,.pdf,.xlsx,.csv,.pptx" onChange={event => setFile(event.target.files?.[0] || null)}/></label>{file?.name.toLowerCase().endsWith('.pptx') && <select aria-label="PPTX 导入方式" className={`${field} mt-4`} value={importMode} onChange={event => setImportMode(event.target.value as 'generate' | 'editable')}><option value="generate">读取内容并生成新演示文稿</option><option value="editable">保守编辑原始 PPTX</option></select>}</div></section>{direct ? <section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">下一步选择 LLM</h3><p className="mt-2 text-sm text-muted-foreground">先上传文件；下一步选择解析模型并按需补充 Prompt 或文本。文件在模型确认前不会解析。</p></section> : <Supplement mode={supplementMode} setMode={setSupplementMode} prompt={prompt} setPrompt={setPrompt} text={text} setText={setText}/>}</div>;
}

function Supplement({ mode, setMode, prompt, setPrompt, text, setText }: { mode: 'prompt' | 'paste'; setMode: (mode: 'prompt' | 'paste') => void; prompt: string; setPrompt: (value: string) => void; text: string; setText: (value: string) => void }) {
  return <section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">补充内容（可选）</h3><p className="mt-1 text-sm text-muted-foreground">说明重点、受众、最新信息或希望保留的内容。</p><div className="mt-4 flex gap-2"><button className={mode === 'prompt' ? primary : button} onClick={() => setMode('prompt')}>Prompt</button><button className={mode === 'paste' ? primary : button} onClick={() => setMode('paste')}>粘贴文本</button></div><label className="mt-4 block space-y-1 text-sm">{mode === 'prompt' ? '输入 Prompt' : '粘贴补充文本'}<textarea className={`${field} min-h-48`} value={mode === 'prompt' ? prompt : text} onChange={event => mode === 'prompt' ? setPrompt(event.target.value) : setText(event.target.value)} placeholder={mode === 'prompt' ? '例如：面向管理层，重点保留文件中的核心数据与结论。' : '粘贴会议纪要、补充数据或最新进展…'}/></label></section>;
}
