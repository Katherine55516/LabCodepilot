'use client';
/* eslint-disable @next/next/no-img-element -- local pasted image previews */

import { useEffect, useMemo, useRef, useState } from 'react';
import { prepareImage, type VisualBlock } from '../PptBlocks';
import { useTranslation } from '@/hooks/useTranslation';
import { TemplateBrowser } from './TemplateBrowser';
import type { PptModel, PptTemplate, PptGenerationPolicy } from '../types';

export type CreateKind = 'prompt' | 'paste' | 'file';
export type CreateEntry = 'new' | 'template' | 'direct';
export type PptCreateDraft = {
  inputKind: CreateKind; title: string; prompt: string; text: string; file: File | null; importMode: 'generate' | 'editable';
  pages: number; compressionApproved: boolean; template: string; modelKey: string; images: Extract<VisualBlock, { type: 'image' }>[];
  pageSource?: 'estimate' | 'user'; generationPolicy?: PptGenerationPolicy;
  outline?: { id: string; section: string; title: string; focus: string; description: string; children: { id: string; title: string; description: string }[] }[];
  analyzedProjectId?: string;
};

const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';
const primary = 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50';
const chips = ['季度业务复盘', '产品发布会', '客户解决方案提案', '培训课程'];

export type PageEstimate = { recommended: number; min: number; max: number; reason: string; requested?: number };
function clampPages(value: number) { return Math.max(3, Math.min(100, Math.round(value))); }
export function estimate(kind: CreateKind, prompt: string, text: string, file: File | null): PageEstimate {
  const pagePattern = /(?:^|[^第\d])(\d{1,3})\s*(?:页|slides?)(?!\w)/i;
  const explicit = prompt.match(pagePattern) || (kind === 'paste' ? text.match(pagePattern) : null);
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

export function PptCreateWizard({ models, templates, initialKind, modelKey, lockedTemplate, busy, onCancel, onBackToChooser, onBackToModel, onAnalyze, onEstimate, onSubmit }: {
  models: PptModel[]; templates: PptTemplate[]; initialKind?: CreateKind; entry: CreateEntry; modelKey: string;
  onModelKeyChange: (key: string) => void; lockedTemplate?: PptTemplate | null; busy: boolean;
  onCancel: () => void; onBackToChooser: () => void; onBackToModel: () => void;
  onAnalyze: (draft: PptCreateDraft) => Promise<{ id: string; outline: Outline; pages: number; recommendation?: PageEstimate }>;
  onEstimate: (draft: PptCreateDraft, signal: AbortSignal) => Promise<PageEstimate>;
  onSubmit: (draft: PptCreateDraft) => Promise<void>;
}) {
  const { t } = useTranslation();
  const mounted = useRef(true); const analysisAttempt = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; analysisAttempt.current++; }; }, []);
  const [kind] = useState<CreateKind>(initialKind || 'prompt');
  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState(''); const [prompt, setPrompt] = useState(''); const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null); const [importMode, setImportMode] = useState<'generate' | 'editable'>('generate');
  const [supplementMode, setSupplementMode] = useState<'prompt' | 'paste'>('prompt');
  const [policy, setPolicy] = useState<PptGenerationPolicy>({ version: 1, detail: 'balanced', language: { mode: 'source' }, knowledge: kind === 'prompt' ? 'source_plus_explanation' : 'source_only' });
  const [template, setTemplate] = useState(lockedTemplate?.id || '');
  const resolvedTemplate = lockedTemplate?.id || template;
  const selectedTemplate = templates.find(item => item.id === resolvedTemplate);
  const [pages, setPages] = useState(12); const [pagesTouched, setPagesTouched] = useState(false);
  const [compressionApproved, setCompressionApproved] = useState(false);
  const [images, setImages] = useState<Extract<VisualBlock, { type: 'image' }>[]>([]);
  const [localOutline, setLocalOutline] = useState<Outline>([]); const [outlineTouched, setOutlineTouched] = useState(false);
  const [analyzedProjectId, setAnalyzedProjectId] = useState<string | null>(null);
  const [analyzedPages, setAnalyzedPages] = useState<number | null>(null);
  const [analyzedTemplate, setAnalyzedTemplate] = useState<string | null>(null);
  const [serverEstimate, setServerEstimate] = useState<PageEstimate | null>(null);
  const [liveEstimate, setLiveEstimate] = useState<PageEstimate | null>(null);
  const [estimating, setEstimating] = useState(false); const [estimateError, setEstimateError] = useState('');
  const [analyzing, setAnalyzing] = useState(false); const [analysisError, setAnalysisError] = useState('');
  const [outlineReady, setOutlineReady] = useState(false);
  const fileIdentity = useRef<{ file: File | null; version: number }>({ file: null, version: 0 });
  if (fileIdentity.current.file !== file) fileIdentity.current = { file, version: fileIdentity.current.version + 1 };
  const sourceSignature = [fileIdentity.current.version, title, prompt, text, modelKey, importMode, supplementMode, JSON.stringify(policy), resolvedTemplate, selectedTemplate?.version, ...images.map(image => image.id)].join('\u0000');
  const lastSourceSignature = useRef(sourceSignature);
  useEffect(() => {
    if (lastSourceSignature.current === sourceSignature) return;
    lastSourceSignature.current = sourceSignature; analysisAttempt.current++; setAnalyzing(false);
    setAnalyzedProjectId(null); setAnalyzedTemplate(null); setAnalyzedPages(null); setLocalOutline([]);
    setServerEstimate(null); setOutlineReady(false); setOutlineTouched(false); setAnalysisError('');
  }, [sourceSignature]);
  const estimateSignature = [kind, prompt, text, fileIdentity.current.version, JSON.stringify(policy), resolvedTemplate, selectedTemplate?.version].join('\u0000');
  const hasInput = kind === 'prompt' ? Boolean(prompt.trim()) : kind === 'paste' ? Boolean(text.trim()) : Boolean(file);
  const localEstimate = useMemo(() => estimate(kind, prompt, text, file), [kind, prompt, text, file]);
  const suggested = serverEstimate || liveEstimate || localEstimate;
  const templatePages = clampPages(selectedTemplate?.pages || 12);
  const resolvedEstimate = serverEstimate || liveEstimate || (estimateError ? localEstimate : null);
  const effectivePages = pagesTouched ? pages : !hasInput ? templatePages : (analyzedPages ?? resolvedEstimate?.requested ?? resolvedEstimate?.recommended ?? templatePages);
  const currentModel = models.find(item => item.id === modelKey);
  const editableImport = kind === 'file' && file?.name.toLowerCase().endsWith('.pptx') && importMode === 'editable';
  const preservedPageCount = selectedTemplate?.kind === 'uploaded' && selectedTemplate.extension === 'pptx' ? selectedTemplate.pages : null;
  const maxPreservedPages = preservedPageCount === null ? null : selectedTemplate?.capabilities?.maxPages ?? (preservedPageCount < 4 ? preservedPageCount : preservedPageCount < 8 ? preservedPageCount * 3 - 4 : 100);
  const templatePageMismatch = !editableImport && preservedPageCount !== null && effectivePages > (maxPreservedPages || 0);
  const compressionRisk = !editableImport && kind !== 'prompt' && hasInput && effectivePages < suggested.min;
  function draft(): PptCreateDraft {
    return { inputKind: kind, title, prompt: kind === 'file' && supplementMode === 'paste' ? text : prompt, text, file, importMode,
      pages: effectivePages, pageSource: pagesTouched || suggested.requested ? 'user' : 'estimate', generationPolicy: policy,
      compressionApproved, template: resolvedTemplate, modelKey, images, analyzedProjectId: analyzedProjectId || undefined };
  }
  useEffect(() => {
    setEstimateError('');
    if (!hasInput || editableImport) { setLiveEstimate(null); setEstimating(false); return; }
    setEstimating(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void onEstimate(draft(), controller.signal).then(value => {
        if (!controller.signal.aborted) setLiveEstimate(value);
      }).catch(error => { if (!controller.signal.aborted) setEstimateError(String(error.message)); })
        .finally(() => { if (!controller.signal.aborted) setEstimating(false); });
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
    // Estimate follows input, policy and template; manual selection stays authoritative.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateSignature, hasInput, editableImport]);
  function editOutline(items: Outline) {
    if (items.length !== localOutline.length) { setPagesTouched(true); setPages(items.length); }
    setLocalOutline(items); setOutlineTouched(true);
  }
  async function addImages(files: File[]) {
    const accepted = files.filter(item => ['image/png', 'image/jpeg'].includes(item.type)).slice(0, 4 - images.length);
    const prepared = await Promise.all(accepted.map(async item => ({ id: crypto.randomUUID().replaceAll('-', '').slice(0, 32), type: 'image' as const, dataUrl: await prepareImage(item), caption: item.name.replace(/\.(png|jpe?g)$/i, '').slice(0, 100) })));
    if (mounted.current) setImages(current => [...current, ...prepared].slice(0, 4));
  }
  async function analyze() {
    if (!modelKey || !hasInput || editableImport) return false;
    const token = ++analysisAttempt.current; const signature = sourceSignature;
    setAnalyzing(true); setAnalysisError(''); setOutlineReady(false);
    try {
      // Asking for a syllabus does not make a provisional estimate a manual value.
      const result = await onAnalyze({ ...draft(), pageSource: outlineTouched ? 'user' : draft().pageSource, outline: outlineTouched ? localOutline : undefined });
      if (!mounted.current || analysisAttempt.current !== token || lastSourceSignature.current !== signature) return false;
      setAnalyzedProjectId(result.id); setAnalyzedTemplate(resolvedTemplate); setAnalyzedPages(result.pages); setLocalOutline(result.outline);
      setServerEstimate(result.recommendation || null); setOutlineTouched(false); setOutlineReady(true); return result;
    } catch (error) { if (mounted.current && analysisAttempt.current === token) setAnalysisError((error as Error).message); return false; }
    finally { if (mounted.current && analysisAttempt.current === token) setAnalyzing(false); }
  }
  const needsReplan = analyzedProjectId && (analyzedPages !== effectivePages || analyzedTemplate !== resolvedTemplate);
  async function submit() {
    if (!hasInput || !currentModel || analyzing || busy || estimating) return;
    if (!editableImport && selectedTemplate?.compatibility !== 'mapped') { setAnalysisError(t('ppt.edit.templateMissing')); return; }
    if (templatePageMismatch || (compressionRisk && !compressionApproved)) return;
    if (!editableImport && (!analyzedProjectId || needsReplan)) {
      const result = await analyze();
      if (kind === 'prompt' && result) try { await onSubmit({ ...draft(), pages: result.pages, analyzedProjectId: result.id, outline: result.outline }); }
      catch (error) { if (mounted.current) setAnalysisError((error as Error).message); }
      return;
    }
    if (!editableImport && localOutline.length < 3) { setAnalysisError(t('ppt.outline')); return; }
    try { await onSubmit({ ...draft(), outline: analyzedProjectId ? localOutline : undefined }); }
    catch (error) { if (mounted.current) setAnalysisError((error as Error).message); }
  }
  const titleForKind = kind === 'prompt' ? '从 Prompt 开始' : kind === 'paste' ? '粘贴文本' : '导入文件';
  return <section className="ppt-prototype ppt-create-stage fixed inset-0 z-50 flex min-h-0 flex-col bg-background text-foreground" data-testid="ppt-create-wizard">
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2"><button className={button} aria-label="返回" disabled={analyzing || busy} onClick={() => step === 2 ? setStep(1) : onBackToModel()}>←</button><strong>新建 PPT / {titleForKind}</strong><button className="ml-auto rounded-full border border-border px-3 py-1 text-xs" disabled={analyzing || busy} onClick={onBackToModel}>LLM · {currentModel?.name || '未选择'}</button></header>
    <div className="ppt-create-body min-h-0 flex-1 overflow-y-auto p-4 md:p-8" key={step}><div className="ppt-create-wrap mx-auto max-w-6xl space-y-5">
      {analysisError && <p role="alert" className="rounded border border-destructive/40 p-3 text-sm text-destructive">{analysisError}</p>}
      <ol className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">{[t('ppt.create.templateStep'), t('ppt.create.inputStep'), t('ppt.create.generateStep')].map((label, index) => <li key={label} className={step === index + 1 ? 'font-semibold text-primary' : ''}>{index + 1}. {label}</li>)}</ol>
      <h1 className="text-2xl font-semibold">{step === 1 ? t('ppt.create.templateStep') : t('ppt.create.inputStep')}</h1>
      {step === 1 ? <TemplateBrowser templates={templates} selectedId={resolvedTemplate} onSelect={setTemplate} locked={Boolean(lockedTemplate)}/> : <div className="ppt-create-split grid items-start gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-5"><section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <label className="block space-y-1 text-sm">PPT 标题（可选）<input className={field} value={title} onChange={event => setTitle(event.target.value)} maxLength={160}/></label>
          {kind === 'prompt' && <><label className="block space-y-1 text-sm">输入 Prompt<textarea aria-label="输入 Prompt" className={`${field} min-h-56`} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="告诉 AI 主题、受众、目标和重点内容…" maxLength={12000}/></label><p className="text-xs text-muted-foreground">{t('ppt.create.inlineGuide')}</p><details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t('ppt.create.example')}</summary><p className="mt-2">面向管理层生成 Q4 产品增长复盘，说明增长来源、主要风险、下季度行动，控制在 12 页以内。</p></details><div className="flex flex-wrap gap-2">{chips.map(chip => <button key={chip} className={button} onClick={() => setPrompt(`${chip}，请整理成结构清晰的演示文稿。`)}>{chip}</button>)}</div></>}
          {kind === 'paste' && <><label className="block space-y-1 text-sm">粘贴文本<textarea aria-label="粘贴文本" className={`${field} min-h-72`} value={text} onChange={event => setText(event.target.value)} onPaste={event => { const files = [...event.clipboardData.items].filter(item => item.kind === 'file' && ['image/png', 'image/jpeg'].includes(item.type)).map(item => item.getAsFile()).filter((item): item is File => Boolean(item)); void addImages(files); }} maxLength={80000}/></label>{images.length > 0 && <div className="grid grid-cols-4 gap-2">{images.map(image => <img key={image.id} src={image.dataUrl} alt={image.caption || '粘贴图片'} className="aspect-video w-full rounded border border-border object-cover"/>)}</div>}</>}
          {kind === 'file' && <FileSource file={file} setFile={setFile} importMode={importMode} setImportMode={setImportMode} direct={false} supplementMode={supplementMode} setSupplementMode={setSupplementMode} prompt={prompt} setPrompt={setPrompt} text={text} setText={setText}/>}
          {!editableImport && kind !== 'prompt' && <button className={primary} disabled={!hasInput || estimating || analyzing || busy || templatePageMismatch} onClick={() => void analyze()}>{analyzing ? 'AI 正在生成大纲…' : outlineReady ? '重新生成 Syllabus' : '生成 Syllabus'}</button>}
        </section>
        {outlineReady && !editableImport && kind !== 'prompt' && <section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">Syllabus（大纲）</h3>{needsReplan && <p className="mt-2 text-xs text-primary">页数或模板已变化，请重新规划后确认。</p>}<OutlineEditor items={localOutline} onChange={editOutline} onReorganize={() => void analyze()} busy={analyzing || busy}/></section>}
        </div>
        <aside className="min-w-0 space-y-4"><ModelSummary model={currentModel}/><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">模板 · {selectedTemplate?.name}</h3><button className="mt-2 text-xs text-primary" disabled={analyzing || busy} onClick={() => setStep(1)}>{t('ppt.create.changeTemplate')}</button></section>
        {!editableImport && <><section className="rounded-xl border border-border bg-card p-5" aria-busy={estimating}><h3 className="font-medium">{t('ppt.create.pages')}</h3><div className="mt-4 flex flex-wrap items-center gap-3"><button className={button} aria-label="减少页数" disabled={analyzing || busy || effectivePages <= 3} onClick={() => { setPagesTouched(true); setPages(effectivePages - 1); setCompressionApproved(false); }}>−</button><b data-testid="ppt-page-count">{effectivePages} 页</b><button className={button} aria-label="增加页数" disabled={analyzing || busy || effectivePages >= 100} onClick={() => { setPagesTouched(true); setPages(effectivePages + 1); setCompressionApproved(false); }}>＋</button><button className="text-xs text-primary" disabled={estimating || analyzing || busy} onClick={() => { setPagesTouched(false); setAnalyzedPages(null); setCompressionApproved(false); }}>{t('ppt.create.useEstimate')}</button></div>
          <p className="mt-3 text-xs text-muted-foreground" role="status">{!hasInput ? t('ppt.create.templateBaseline') : estimating ? t('ppt.create.estimating') : `建议 ${suggested.requested || suggested.recommended} 页（${suggested.min}–${suggested.max}）· ${suggested.reason}`}</p>
          {estimateError && <p className="mt-2 text-xs text-destructive">{t('ppt.create.estimateFallback')} {estimateError}</p>}
          {pagesTouched && <p className="mt-2 text-xs text-primary">{t('ppt.create.manualPages')}</p>}
          {preservedPageCount !== null && <p className={`mt-2 text-xs ${templatePageMismatch ? 'text-destructive' : 'text-muted-foreground'}`}>原生模板 {preservedPageCount} 页，最多支持 {maxPreservedPages} 页。{templatePageMismatch && '请减少页数或更换模板。'}</p>}
          {compressionRisk && <label className="mt-4 flex gap-2 rounded border border-destructive/40 p-3 text-xs"><input type="checkbox" checked={compressionApproved} onChange={event => setCompressionApproved(event.target.checked)}/><span>低于保真建议范围，确认按 {effectivePages} 页压缩低优先级细节。</span></label>}
        </section><section className="space-y-4 rounded-xl border border-border bg-card p-5"><h3 className="font-medium">{t('ppt.create.policy')}</h3><label className="block space-y-2 text-sm">{t('ppt.create.detail')}<select aria-label={t('ppt.create.detail')} className={field} value={policy.detail} onChange={event => setPolicy(current => ({ ...current, detail: event.target.value as PptGenerationPolicy['detail'] }))}><option value="balanced">{t('ppt.create.standard')}</option><option value="detailed">{t('ppt.create.detailed')}</option></select></label><p className="text-xs text-muted-foreground">{t('ppt.create.sourceLanguage')}</p><label className="block space-y-2 text-sm">{t('ppt.create.knowledge')}<select className={field} value={policy.knowledge} onChange={event => setPolicy(current => ({ ...current, knowledge: event.target.value as PptGenerationPolicy['knowledge'] }))}><option value="source_only">{t('ppt.create.sourceOnly')}</option><option value="source_plus_explanation">{t('ppt.create.sourcePlus')}</option></select></label><p className="text-xs text-muted-foreground">{t('ppt.create.fixedPage')}</p></section></>}
        </aside>
      </div>}
    </div></div>
    <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border px-4 py-3"><button className={button} disabled={analyzing || busy} onClick={onCancel}>{t('ppt.cancel')}</button><button className={button} disabled={analyzing || busy} onClick={() => step === 2 ? setStep(1) : onBackToChooser()}>{step === 2 ? '← 返回模板' : '← 返回创建方式'}</button><span className="ml-auto"/>{step === 1 ? <button className={primary} disabled={selectedTemplate?.compatibility !== 'mapped'} onClick={() => setStep(2)}>{t('ppt.create.inputNext')}</button> : <button className={primary} disabled={!hasInput || busy || analyzing || estimating || templatePageMismatch || (compressionRisk && !compressionApproved) || !modelKey} onClick={() => void submit()}>{analyzing ? 'AI 正在生成大纲…' : editableImport ? '打开并编辑 PPTX' : kind === 'prompt' ? '开始生成' : !outlineReady || needsReplan ? '生成 Syllabus 并确认' : '确认 Syllabus 并开始生成'}</button>}</footer>
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
