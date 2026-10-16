'use client';
import {TemplateFixedObjects} from './TemplateFixedObjects';
import {PptFailureDialog} from '../workspace/PptFailureDialog';
/* eslint-disable @next/next/no-img-element -- local pasted image previews */

import {unifiedGenerationPolicy,explicitLanguageRequest} from '@/lib/ppt-generation-defaults';
import {PptSelectField} from '../PptSelect';
import { useEffect, useMemo, useRef, useState } from 'react';
import { prepareImage, type VisualBlock } from '../PptBlocks';
import { useTranslation } from '@/hooks/useTranslation';
import { pptFailureMessage } from '@/lib/ppt-error';
import { PptOutlineDiagnostic } from '../PptOutlineDiagnostic';
import { PptOutlineConcision } from '../workspace/PptOutlineConcision';
import { PptOutlineCorrections } from '../workspace/PptOutlineCorrections';
import { TemplateBrowser } from './TemplateBrowser';
import type { PptExecutionPolicy, PptModel, PptTemplate, PptGenerationPolicy, PptPlanningAssumption, PptProject } from '../types';

export type CreateKind = 'prompt' | 'paste' | 'file';
export type CreateEntry = 'new' | 'template' | 'direct';
export type PptCreateDraft = {
  executionPolicy?:PptExecutionPolicy; inputKind: CreateKind; title: string; prompt: string; text: string; file: File | null; importMode: 'generate' | 'editable';
  pages: number; compressionApproved: boolean; template: string; modelKey: string; images: Extract<VisualBlock, { type: 'image' }>[];
  pageSource?: 'estimate' | 'user'; generationPolicy?: PptGenerationPolicy;
  outline?: { id: string; section: string; title: string; focus: string; description: string; children: { id: string; title: string; description: string }[] }[];
  templateContentMode?: 'design_only' | 'keep_fixed';templateFixedObjectIds?:string[];
  analyzedProjectId?: string; resumeAnalysis?: boolean;
};

const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';
const primary = 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50';
const chips = ['季度业务复盘', '产品发布会', '客户解决方案提案', '培训课程'];

export type PageEstimate = { recommended: number; min: number; max: number; reason: string; requested?: number; reasonBase?: string; assumptions?: PptPlanningAssumption[]; warnings?: { code: string; message?: string }[] };
function clampPages(value: number) { return Math.max(3, Math.min(100, Math.round(value))); }
export function estimate(kind: CreateKind, prompt: string, text: string, file: File | null): PageEstimate {
  const pagePattern = /(?:^|[^第\d])(\d{1,3})\s*(?:页|slides?)(?!\w)/i;
  const explicit = kind==='prompt' && prompt.length>300 ? null : prompt.match(pagePattern);
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

function ModelSummary({ model,policy }: { model?: PptModel;policy?:PptExecutionPolicy }) {
  const {t}=useTranslation();
  return <section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">{t('ppt.execution.qualityTitle')}</h3><p className="mt-1 text-xs text-muted-foreground">{t('ppt.quality.sameContract')}</p><div className="mt-4 rounded-lg bg-muted p-3 text-sm"><strong>{policy?t(`ppt.quality.${policy.qualityLevel==='legacy_single_model'?'balanced':policy.qualityLevel}`):model?.name || '未选择'}</strong></div></section>;
}

export function PptCreateWizard({ models, templates, initialKind, modelKey, lockedTemplate, busy, onCancel, onBackToChooser, onBackToModel, onAnalyze, onEstimate, onSubmit, formingOutline, executionPolicy }: {
  executionPolicy?:PptExecutionPolicy; formingOutline?:PptProject|null;
  models: PptModel[]; templates: PptTemplate[]; initialKind?: CreateKind; entry: CreateEntry; modelKey: string;
  onModelKeyChange: (key: string) => void; lockedTemplate?: PptTemplate | null; busy: boolean;
  onCancel: () => void; onBackToChooser: () => void; onBackToModel: () => void;
  onAnalyze: (draft: PptCreateDraft) => Promise<{ id: string; outline: Outline; pages: number; recommendation?: PageEstimate; project?: PptProject }>;
  onEstimate: (draft: PptCreateDraft, signal: AbortSignal) => Promise<PageEstimate>;
  onSubmit: (draft: PptCreateDraft) => Promise<void>;
}) {
  const { t, locale } = useTranslation();
  const mounted = useRef(true); const analysisAttempt = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; analysisAttempt.current++; }; }, []);
  const [kind] = useState<CreateKind>(initialKind || 'prompt');
  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState(''); const [prompt, setPrompt] = useState(''); const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null); const [importMode, setImportMode] = useState<'generate' | 'editable'>('generate');
  const [supplementMode, setSupplementMode] = useState<'prompt' | 'paste'>('prompt');
  const [policy, setPolicy] = useState<PptGenerationPolicy>(unifiedGenerationPolicy());
  const [templateFixedObjectIds,setTemplateFixedObjectIds]=useState<string[]>([]);
  const [templateContentMode, setTemplateContentMode] = useState<'design_only' | 'keep_fixed'>('design_only');
  const [template, setTemplate] = useState(lockedTemplate?.id || '');
  const resolvedTemplate = lockedTemplate?.id || template;
  const selectedTemplate = templates.find(item => item.id === resolvedTemplate);
  const [pages, setPages] = useState(12); const [pagesTouched, setPagesTouched] = useState(false);
  const [pageInput, setPageInput] = useState<string | null>(null);
  const [compressionApproved, setCompressionApproved] = useState(false);
  const [languageTouched,setLanguageTouched]=useState(false);
  useEffect(()=>{if(languageTouched)return;const locale=explicitLanguageRequest(prompt);const language:PptGenerationPolicy['language']=locale?{mode:'output',locale}:{mode:'source',body:'primary'};setPolicy(current=>JSON.stringify(current.language)===JSON.stringify(language)?current:{...current,language});},[prompt,languageTouched]);
  const [images, setImages] = useState<Extract<VisualBlock, { type: 'image' }>[]>([]);
  const [localOutline, setLocalOutline] = useState<Outline>([]); const [outlineTouched, setOutlineTouched] = useState(false);
  const [analyzedProjectId, setAnalyzedProjectId] = useState<string | null>(null);
  const [analyzedProject, setAnalyzedProject] = useState<PptProject | null>(null);
  const [analyzedPages, setAnalyzedPages] = useState<number | null>(null);
  const [analyzedTemplate, setAnalyzedTemplate] = useState<string | null>(null);
  const [serverEstimate, setServerEstimate] = useState<PageEstimate | null>(null);
  const [liveEstimate, setLiveEstimate] = useState<PageEstimate | null>(null);
  const [estimating, setEstimating] = useState(false); const [estimateError, setEstimateError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [failedCandidate,setFailedCandidate]=useState<PptProject|null>(null); const [analysisError, setAnalysisError] = useState('');
  const [failureOpen,setFailureOpen]=useState(false);
  const [outlineReady, setOutlineReady] = useState(false);
  const fileIdentity = useRef<{ file: File | null; version: number }>({ file: null, version: 0 });
  if (fileIdentity.current.file !== file) fileIdentity.current = { file, version: fileIdentity.current.version + 1 };
  const sourceSignature = [fileIdentity.current.version, title, prompt, text, modelKey, importMode, supplementMode, JSON.stringify(policy), JSON.stringify(templateFixedObjectIds), templateContentMode, resolvedTemplate, selectedTemplate?.version, ...images.map(image => image.id)].join('\u0000');
  const lastSourceSignature = useRef(sourceSignature);
  useEffect(() => {
    if (lastSourceSignature.current === sourceSignature) return;
    lastSourceSignature.current = sourceSignature; analysisAttempt.current++; setAnalyzing(false);
    setAnalyzedProjectId(null); setAnalyzedTemplate(null); setAnalyzedPages(null); setLocalOutline([]);
    setServerEstimate(null); setOutlineReady(false); setOutlineTouched(false); setAnalysisError(''); setFailedCandidate(null); setFailureOpen(false);
  }, [sourceSignature]);
  const estimateSignature = [kind, prompt, text, fileIdentity.current.version, JSON.stringify(policy), templateContentMode, resolvedTemplate, selectedTemplate?.version].join('\u0000');
  const hasInput = kind === 'prompt' ? Boolean(prompt.trim() || images.length) : kind === 'paste' ? Boolean(text.trim() || images.length) : Boolean(file);
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
      executionPolicy, pages: effectivePages, pageSource: pagesTouched || suggested.requested ? 'user' : 'estimate', generationPolicy: !languageTouched&&explicitLanguageRequest(prompt)?{...policy,language:{mode:'output',locale:explicitLanguageRequest(prompt)!}}:policy,
      compressionApproved, templateContentMode,templateFixedObjectIds, template: resolvedTemplate, modelKey, images, resumeAnalysis: Boolean(!analyzedProjectId && failedCandidate), analyzedProjectId: analyzedProjectId || failedCandidate?.id || undefined };
  }
  useEffect(() => {
    setLiveEstimate(null);
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
  function choosePages(value: number) {
    if (!Number.isFinite(value)) return;
    // Manual edits invalidate an in-flight syllabus, not the source or the
    // last useful preview. Late responses must never restore the old count.
    analysisAttempt.current++;
    setAnalyzing(false); setAnalysisError(''); setFailedCandidate(null);
    setPagesTouched(true); setPages(clampPages(value)); setPageInput(null);
    setCompressionApproved(false);
  }
  function restoreEstimate() {
    analysisAttempt.current++; setAnalyzing(false); setAnalysisError('');
    setPageInput(null); setPagesTouched(false); setAnalyzedPages(null);
    setCompressionApproved(false);
  }
  function commitPageInput() {
    if (pageInput?.trim()) choosePages(Number(pageInput));
    else setPageInput(null);
  }
  async function addImages(files: File[]) {
    const supported=files.filter(item=>['image/png','image/jpeg'].includes(item.type));
    if(supported.length!==files.length||supported.length>16-images.length)setAnalysisError(t('ppt.create.imageLimitExplanation'));
    const accepted = supported.slice(0, 16 - images.length);
    try { const prepared = await Promise.all(accepted.map(async item => ({ id: crypto.randomUUID().replaceAll('-', '').slice(0, 32), type: 'image' as const, dataUrl: await prepareImage(item), fileName: item.name, caption: item.name.replace(/\.(png|jpe?g)$/i, '').slice(0, 100) })));
    if (mounted.current) setImages(current => {const unique=new Map(current.map(image=>[image.dataUrl,image]));for(const image of prepared)if(!unique.has(image.dataUrl))unique.set(image.dataUrl,image);return [...unique.values()].slice(0,16);});
    } catch (error) { if (mounted.current) setAnalysisError((error as Error).message); }
  }
  async function analyze() {
    if (!modelKey || !hasInput || editableImport) return false;
    const token = ++analysisAttempt.current; const signature = sourceSignature; const previousCandidate=failedCandidate;
    setAnalyzing(true);setFailedCandidate(null); setAnalysisError(''); setOutlineReady(false);
    try {
      // Asking for a syllabus does not make a provisional estimate a manual value.
      const result = await onAnalyze({ ...draft(), outline: outlineTouched ? localOutline : undefined });
      if (!mounted.current || analysisAttempt.current !== token || lastSourceSignature.current !== signature) return false;
      setAnalyzedProjectId(result.id); setAnalyzedProject(result.project || null); setAnalyzedTemplate(resolvedTemplate); setAnalyzedPages(result.pages); setLocalOutline(result.outline);
      setServerEstimate(result.recommendation || null); setOutlineTouched(false); setOutlineReady(true); return result;
    } catch (error) { if (mounted.current && analysisAttempt.current === token) {setAnalysisError((error as Error).message);setFailedCandidate((error as Error & {project?:PptProject}).project||previousCandidate);setFailureOpen(false);} return false; }
    finally { if (mounted.current && analysisAttempt.current === token) setAnalyzing(false); }
  }
  const needsReplan = analyzedProjectId && (analyzedPages !== effectivePages || analyzedTemplate !== resolvedTemplate);
  async function submit() {
    if (!hasInput || !currentModel || analyzing || busy || estimating) return;
    if (!editableImport && selectedTemplate?.compatibility !== 'mapped') { setAnalysisError(t('ppt.edit.templateMissing')); return; }
    if (templatePageMismatch || (compressionRisk && !compressionApproved)) return;
    if (!editableImport && (!analyzedProjectId || needsReplan)) {
      const result = await analyze();
      // Every entry stops at the actual validated outline. Only the explicit
      // confirmation button enters the editor and starts its frozen writer plan.
      void result;return;
    }
    if (!editableImport && localOutline.length < 3) { setAnalysisError(t('ppt.outline')); return; }
    try { await onSubmit({ ...draft(), outline: analyzedProjectId ? localOutline : undefined }); }
    catch (error) { if (mounted.current) setAnalysisError((error as Error).message); }
  }
  const titleForKind = kind === 'prompt' ? '从 Prompt 开始' : kind === 'paste' ? '粘贴文本' : '导入文件';
  return <section className="ppt-prototype ppt-create-stage fixed inset-0 z-50 flex min-h-0 flex-col bg-background text-foreground" data-testid="ppt-create-wizard">
    {failureOpen&&analysisError&&<PptFailureDialog message={analysisError} onClose={()=>setFailureOpen(false)}/>}
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2"><button className={button} aria-label="返回" disabled={analyzing || busy} onClick={() => step === 2 ? setStep(1) : onBackToModel()}>←</button><strong>新建 PPT / {titleForKind}</strong><button className="ml-auto rounded-full border border-border px-3 py-1 text-xs" disabled={analyzing || busy} onClick={onBackToModel}>{t('ppt.execution.qualityTitle')} · {executionPolicy?t(`ppt.quality.${executionPolicy.qualityLevel==='legacy_single_model'?'balanced':executionPolicy.qualityLevel}`):currentModel?.name || '未选择'}</button></header>
    <div className="ppt-create-body min-h-0 flex-1 overflow-y-auto p-4 md:p-8" key={step}><div className="ppt-create-wrap mx-auto max-w-6xl space-y-5">
    {analyzing&&formingOutline?.candidateOutline&&<section data-testid="ppt-outline-forming" className="rounded border border-border p-3"><p className="text-sm font-medium">{formingOutline.outlineProgress?.total?t('ppt.outline.forming').replace('{done}',String(formingOutline.outlineProgress.done)).replace('{total}',String(formingOutline.outlineProgress.total)):t('ppt.outline.streaming').replace('{count}',String(formingOutline.candidateOutline.syllabus.length))}</p><ol className="mt-2 grid gap-2 text-sm md:grid-cols-2">{formingOutline.candidateOutline.syllabus.map((item,i)=><li key={item.id||i}><b>{i+1}. {item.title}</b><p className="text-xs text-muted-foreground">{item.message}</p></li>)}</ol></section>}
    {failedCandidate&&<PptOutlineDiagnostic project={failedCandidate}/>}

      {analysisError && <div role="alert" className="rounded border border-destructive/40 p-3 text-sm text-destructive"><p>{pptFailureMessage(analysisError, locale)}</p><button className="mt-2 text-xs underline" onClick={()=>setFailureOpen(true)}>{t('ppt.failure.details')}</button></div>}
      <ol className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">{[t('ppt.create.templateStep'), t('ppt.create.inputStep'), t('ppt.create.generateStep')].map((label, index) => <li key={label} className={step === index + 1 ? 'font-semibold text-primary' : ''}>{index + 1}. {label}</li>)}</ol>
      <h1 className="text-2xl font-semibold">{step === 1 ? t('ppt.create.templateStep') : t('ppt.create.inputStep')}</h1>
      {step === 1 ? <TemplateBrowser templates={templates} selectedId={resolvedTemplate} onSelect={value=>{setTemplate(value);setTemplateFixedObjectIds([]);}} locked={Boolean(lockedTemplate)}/> : <div className="ppt-create-split grid items-start gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-5"><section className="space-y-4 rounded-xl border border-border bg-card p-5" onPaste={event => { const files = [...event.clipboardData.items].filter(item => item.kind === "file").map(item => item.getAsFile()).filter((item): item is File => Boolean(item)); void addImages(files); }} onDragOver={event => { if ([...event.dataTransfer.items].some(item => item.type.startsWith("image/"))) event.preventDefault(); }} onDrop={event => { const files = [...event.dataTransfer.files].filter(item => item.type.startsWith("image/")); if (files.length) { event.preventDefault(); void addImages(files); } }}>
          <label className="block space-y-1 text-sm">PPT 标题（可选）<input className={field} value={title} onChange={event => setTitle(event.target.value)} maxLength={160}/></label>
          {kind === 'prompt' && <><label className="block space-y-1 text-sm">输入 Prompt<textarea aria-label="输入 Prompt" className={`${field} min-h-56`} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="告诉 AI 主题、受众、目标和重点内容…" maxLength={80000}/></label><p className="text-xs text-muted-foreground">{t('ppt.create.inlineGuide')}</p><details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t('ppt.create.example')}</summary><p className="mt-2">面向管理层生成 Q4 产品增长复盘，说明增长来源、主要风险、下季度行动，控制在 12 页以内。</p></details><div className="flex flex-wrap gap-2">{chips.map(chip => <button key={chip} className={button} onClick={() => setPrompt(`${chip}，请整理成结构清晰的演示文稿。`)}>{chip}</button>)}</div></>}
          {kind === 'paste' && <><label className="block space-y-1 text-sm">粘贴文本<textarea aria-label="粘贴文本" className={`${field} min-h-72`} value={text} onChange={event => setText(event.target.value)} maxLength={80000}/></label></>}
          {kind === 'file' && <FileSource file={file} setFile={setFile} importMode={importMode} setImportMode={setImportMode} direct={false} supplementMode={supplementMode} setSupplementMode={setSupplementMode} prompt={prompt} setPrompt={setPrompt} text={text} setText={setText}/>}
          {!editableImport && <div className="space-y-2" data-testid="ppt-input-images"><label className={`${button} inline-block cursor-pointer`}>{t('ppt.create.addImages')}<input type="file" className="sr-only" aria-label={t('ppt.create.addImages')} accept="image/png,image/jpeg,.png,.jpg,.jpeg" multiple disabled={images.length >= 16 || analyzing || busy} onChange={event => { void addImages([...event.target.files || []]); event.target.value = ''; }}/></label><p className="text-xs text-muted-foreground">{t('ppt.create.imageInputHint')}</p>{images.length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{images.map(image => <figure key={image.id} className="relative rounded border border-border p-2"><img src={image.dataUrl} alt={image.caption} className="aspect-video w-full object-contain"/><figcaption className="truncate text-xs">{image.caption}</figcaption><button aria-label={`${t('ppt.delete')} ${image.caption}`} className="absolute right-0 top-0 rounded bg-background px-2" disabled={analyzing || busy} onClick={() => setImages(current => current.filter(item => item.id !== image.id))}>×</button></figure>)}</div>}</div>}
        </section>
        {outlineReady && !editableImport && <section className="rounded-xl border border-border bg-card p-5" data-testid="ppt-outline-review"><h3 className="font-medium">Syllabus（大纲）</h3>{needsReplan && <p className="mt-2 text-xs text-primary">页数或模板已变化，请重新规划后确认。</p>}{(suggested.assumptions?.length ?? 0) > 0 && <p className="mt-2 text-xs text-muted-foreground">{t('ppt.create.assumptionsHint')}</p>}{analyzedProject && <div className="mt-3 space-y-3"><PptOutlineConcision project={analyzedProject}/><PptOutlineCorrections project={analyzedProject}/></div>}<OutlineEditor items={localOutline} onChange={editOutline} onReorganize={() => void analyze()} busy={analyzing || busy}/></section>}
        {analyzedProject&&<section className="space-y-3 rounded-xl border border-border p-4" data-testid="ppt-source-assets"><h3 className="font-semibold">{t('ppt.create.sourceAssets')}</h3><p className="text-xs text-muted-foreground">{t('ppt.create.sourceAssetsHint')}</p><div className="grid gap-3 sm:grid-cols-3">{analyzedProject.sourceAssets?.map(asset=><article key={asset.id} className="min-w-0 rounded border border-border p-2"><img className="h-28 w-full object-contain" alt={asset.caption} src={`/api/ppt/projects/${analyzedProject.id}/source-assets?assetId=${encodeURIComponent(asset.id)}`}/><p className="break-words text-xs">{asset.caption}</p><p className="text-xs text-muted-foreground">{asset.slideIds.map(id=>analyzedProject.outline.findIndex(slide=>slide.id===id)+1).join(', ')||t('ppt.create.assetUnassigned')}</p></article>)}</div>{analyzedProject.sourceMediaWarnings?.map((warning,i)=><p key={i} role="status" className="text-xs text-destructive">{warning.location}: {warning.message}</p>)}</section>}
        </div>
        <aside className="min-w-0 space-y-4"><ModelSummary model={currentModel} policy={executionPolicy}/><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">模板 · {selectedTemplate?.name}</h3><button className="mt-2 text-xs text-primary" disabled={analyzing || busy} onClick={() => setStep(1)}>{t('ppt.create.changeTemplate')}</button>{['uploaded','managed'].includes(selectedTemplate?.kind || '') && <div className="mt-3 block space-y-2 text-xs"><span>{t('ppt.create.templateContent')}</span><PptSelectField aria-label={t('ppt.create.templateContent')} className={field} value={templateContentMode} onValueChange={value => setTemplateContentMode(value as 'design_only' | 'keep_fixed')}><option value="design_only">{t('ppt.create.designOnly')}</option><option value="keep_fixed">{t('ppt.create.keepFixed')}</option></PptSelectField><span className="block text-muted-foreground">{t('ppt.create.templateContentHint')}</span>{templateContentMode==='keep_fixed'&&<TemplateFixedObjects key={resolvedTemplate} templateId={resolvedTemplate} value={templateFixedObjectIds} onChange={setTemplateFixedObjectIds}/>}</div>}</section>
        {!editableImport && <><section className="rounded-xl border border-border bg-card p-5" aria-busy={estimating}><h3 className="font-medium">{t('ppt.create.pages')}</h3><div className="mt-4 flex flex-wrap items-center gap-3"><button className={button} aria-label="减少页数" disabled={busy || effectivePages <= 3} onClick={() => choosePages(effectivePages - 1)}>−</button><label className="flex items-center gap-2 text-sm"><input aria-label={t('ppt.create.pageCount')} data-testid="ppt-page-count" className={`${field} w-20 text-center font-semibold`} type="number" min={3} max={100} step={1} disabled={busy} value={pageInput ?? effectivePages} onChange={event => { const value = event.target.value; setPageInput(value); if (value && Number.isInteger(Number(value)) && Number(value) >= 3 && Number(value) <= 100) { choosePages(Number(value)); setPageInput(value); } }} onBlur={commitPageInput} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitPageInput(); } }}/><span>{t('ppt.create.pageUnit')}</span></label><button className={button} aria-label="增加页数" disabled={busy || effectivePages >= 100} onClick={() => choosePages(effectivePages + 1)}>＋</button><button className="text-xs text-primary" disabled={estimating || busy} onClick={restoreEstimate}>{t('ppt.create.useEstimate')}</button></div>
          <p className="mt-3 text-xs text-muted-foreground" role="status">{!hasInput ? t('ppt.create.templateBaseline') : estimating ? t('ppt.create.estimating') : `${suggested.requested ? `用户指定 ${suggested.requested} 页；` : ''}建议 ${suggested.recommended} 页（${suggested.min}–${suggested.max}）· ${suggested.assumptions?.length ? suggested.reasonBase || suggested.reason : suggested.reason}`}</p>
          {hasInput && !estimating && (suggested.assumptions?.length ?? 0) > 0 && <PlanningAssumptions assumptions={suggested.assumptions || []} codeChoice={policy.code?.presentation || 'auto'} disabled={analyzing || busy}
            onCodeChoice={value => setPolicy(current => { const next = { ...current }; if (value === 'auto') delete next.code; else next.code = { presentation: value }; return next; })}/>}
          {estimateError && <p className="mt-2 text-xs text-destructive">{t('ppt.create.estimateFallback')} {estimateError}</p>}
          {pagesTouched && <p className="mt-2 text-xs text-primary">{t('ppt.create.manualPages')}</p>}
          {preservedPageCount !== null && <p className={`mt-2 text-xs ${templatePageMismatch ? 'text-destructive' : 'text-muted-foreground'}`}>原生模板 {preservedPageCount} 页，最多支持 {maxPreservedPages} 页。{templatePageMismatch && '请减少页数或更换模板。'}</p>}
          {!editableImport&&<p className="mt-4 text-xs text-muted-foreground" data-testid="ppt-confirm-outline">{t('ppt.create.explicitConfirmation')}</p>}
          {compressionRisk && <label className="mt-4 flex gap-2 rounded border border-destructive/40 p-3 text-xs"><input type="checkbox" checked={compressionApproved} onChange={event => setCompressionApproved(event.target.checked)}/><span>低于保真建议范围，确认按 {effectivePages} 页压缩低优先级细节。</span></label>}
        </section><section className="space-y-4 rounded-xl border border-border bg-card p-5" onPaste={event => { const files = [...event.clipboardData.items].filter(item => item.kind === "file").map(item => item.getAsFile()).filter((item): item is File => Boolean(item)); void addImages(files); }} onDragOver={event => { if ([...event.dataTransfer.items].some(item => item.type.startsWith("image/"))) event.preventDefault(); }} onDrop={event => { const files = [...event.dataTransfer.files].filter(item => item.type.startsWith("image/")); if (files.length) { event.preventDefault(); void addImages(files); } }}><h3 className="font-medium">{t('ppt.create.policy')}</h3><label className="block space-y-2 text-sm">{t('ppt.create.detail')}<PptSelectField aria-label={t('ppt.create.detail')} className={field} value={policy.detail} onValueChange={value=>setPolicy(current => ({ ...current, detail: value as PptGenerationPolicy['detail'] }))}><option value="balanced">{t('ppt.create.standard')}</option><option value="detailed">{t('ppt.create.detailed')}</option></PptSelectField></label><label className="block space-y-2 text-sm">{t('ppt.create.language')}<PptSelectField aria-label={t('ppt.create.language')} className={field} value={policy.language.mode==='source'?(policy.language.body==='both'?'source-both':'source'):policy.language.locale} onValueChange={value=>{setLanguageTouched(true);setPolicy(current=>({...current,language:value==='source'?{mode:'source',body:'primary'}:value==='source-both'?{mode:'source',body:'both'}:{mode:'output',locale:value as 'zh'|'en'|'zh-HK'}}));}}><option value="source">{t('ppt.create.sourceLanguage')}</option><option value="source-both">{t('ppt.create.sourceLanguageBoth')}</option><option value="zh">简体中文</option><option value="en">English</option><option value="zh-HK">繁體中文（香港）</option></PptSelectField></label>{policy.language.mode==='output'&&<p className="text-xs text-muted-foreground">{t('ppt.create.languageScope')}</p>}<label className="block space-y-2 text-sm">{t('ppt.create.contentContract')}<PptSelectField aria-label={t('ppt.create.contentContract')} className={field} value={policy.content||'full_source'} onValueChange={value=>setPolicy(current=>({...current,content:value as PptGenerationPolicy['content'],details:'slides'}))}><option value="full_source">{t('ppt.create.fullSource')}</option><option value="course">{t('ppt.create.course')}</option><option value="overview">{t('ppt.create.overview')}</option></PptSelectField></label>{policy.content!=='full_source'&&<label className="block space-y-2 text-sm">{t('ppt.create.detailsDestination')}<PptSelectField aria-label={t('ppt.create.detailsDestination')} className={field} value={policy.details||'slides'} onValueChange={value=>setPolicy(p=>({...p,details:value as 'slides'|'notes'}))}><option value="slides">{t('ppt.create.detailsSlides')}</option><option value="notes">{t('ppt.create.detailsNotes')}</option></PptSelectField></label>}<label className="block space-y-2 text-sm">{t('ppt.create.knowledge')}<PptSelectField className={field} value={policy.knowledge} onValueChange={value=>setPolicy(current => ({ ...current, knowledge: value as PptGenerationPolicy['knowledge'] }))}><option value="source_only">{t('ppt.create.sourceOnly')}</option><option value="source_plus_explanation">{t('ppt.create.sourcePlus')}</option></PptSelectField></label><p className="text-xs text-muted-foreground">{t('ppt.create.fixedPage')}</p></section></>}
        </aside>
      </div>}
    </div></div>
    <footer data-testid="ppt-create-actions" className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border px-4 py-3"><button className={button} disabled={busy} onClick={onCancel}>{analyzing?t('ppt.create.background'):t('ppt.cancel')}</button><button className={button} disabled={analyzing || busy} onClick={() => step === 2 ? setStep(1) : onBackToChooser()}>{step === 2 ? '← 返回模板' : '← 返回创建方式'}</button><span className="ml-auto"/>{step === 1 ? <button className={primary} disabled={selectedTemplate?.compatibility !== 'mapped'} onClick={() => setStep(2)}>{t('ppt.create.inputNext')}</button> : <button className={primary} disabled={!hasInput || busy || analyzing || estimating || templatePageMismatch || (compressionRisk && !compressionApproved) || !modelKey} onClick={() => void submit()}>{analyzing ? 'AI 正在生成大纲…' : editableImport ? '打开并编辑 PPTX' : !outlineReady || needsReplan ? '读取输入并生成大纲' : '确认大纲并生成页面'}</button>}</footer>
  </section>;
}

/** Disclosed planning decisions (Gamma's "calls to check"): the code choice is
 * reversible here; changing it re-estimates and requires a new Syllabus. */
function PlanningAssumptions({ assumptions, codeChoice, onCodeChoice, disabled }: { assumptions: PptPlanningAssumption[]; codeChoice: 'auto' | 'keep' | 'omit'; onCodeChoice: (value: 'auto' | 'keep' | 'omit') => void; disabled: boolean }) {
  const { t } = useTranslation();
  return <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3" data-testid="ppt-planning-assumptions">
    <h4 className="text-xs font-semibold">{t('ppt.create.assumptions')}</h4>
    <ul className="mt-2 space-y-2 text-xs text-muted-foreground">{assumptions.map(item => <li key={`${item.topic}-${item.decision}`}>
      <p>{item.reason}</p>
      {item.topic === 'code' && <label className="mt-1 flex flex-wrap items-center gap-2 text-foreground">{t('ppt.create.codeChoice')}<PptSelectField aria-label={t('ppt.create.codeChoice')} className="rounded border border-border bg-background px-2 py-1 text-xs" value={codeChoice} disabled={disabled} onValueChange={value=>onCodeChoice(value as 'auto' | 'keep' | 'omit')}>
        <option value="auto">{t('ppt.create.codeAuto')}</option><option value="keep">{t('ppt.create.codeKeep')}</option><option value="omit">{t('ppt.create.codeOmit')}</option></PptSelectField></label>}
    </li>)}</ul>
  </div>;
}

function OutlineEditor({ items, onChange, onReorganize, busy = false }: { items: Outline; onChange: (items: Outline) => void; onReorganize?: () => void; busy?: boolean }) {
  const { t } = useTranslation();
  function update(index: number, patch: Partial<Outline[number]>) { onChange(items.map((item, at) => at === index ? { ...item, ...patch } : item)); }
  function move(index: number, offset: number) {
    const at = index + offset;
    if (at < 0 || at >= items.length) return;
    const next = [...items]; [next[index], next[at]] = [next[at], next[index]]; onChange(next);
  }
  return <div className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto" aria-label="可编辑大纲">
    {items.map((item, index) => <div key={item.id} className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-2"><span className="pt-2 text-xs text-muted-foreground">{index + 1}.</span><div className="min-w-0 flex-1 space-y-2">
        <input aria-label={`大纲标题 ${index + 1}`} className={field} value={item.title} onChange={event => update(index, { title: event.target.value, })}/>
        <p className="line-clamp-2 text-sm text-muted-foreground">{item.focus}</p>
        <details className="space-y-2"><summary className="cursor-pointer text-xs text-primary">{t('ppt.outlineDetails')}</summary>
        <input aria-label={`章节名称 ${index + 1}`} className={field} value={item.section} onChange={event => update(index, { section: event.target.value })}/>
        <textarea aria-label={`大纲主张 ${index + 1}`} className={field} value={item.focus} onChange={event => update(index, { focus: event.target.value })}/>
        {item.description && item.description !== item.focus && <textarea aria-label={`大纲描述 ${index + 1}`} className={field} value={item.description} onChange={event => update(index, { description: event.target.value })}/>}
        {(item.children || []).map((child, childIndex) => <div key={child.id} className="grid gap-2 rounded-lg bg-muted/50 p-2 sm:grid-cols-[1fr_1fr_auto]">
          <input aria-label={`子章节标题 ${index + 1}-${childIndex + 1}`} className={field} value={child.title} onChange={event => update(index, { children: item.children.map((row, at) => at === childIndex ? { ...row, title: event.target.value } : row) })}/>
          <input aria-label={`子章节描述 ${index + 1}-${childIndex + 1}`} className={field} value={child.description} onChange={event => update(index, { children: item.children.map((row, at) => at === childIndex ? { ...row, description: event.target.value } : row) })}/>
          <button className={button} aria-label={`删除子章节 ${index + 1}-${childIndex + 1}`} onClick={() => update(index, { children: item.children.filter((_, at) => at !== childIndex) })}>×</button>
        </div>)}
        <button className="text-xs text-primary" disabled={(item.children || []).length >= 12} onClick={() => update(index, { children: [...(item.children || []), { id: crypto.randomUUID().replaceAll('-', ''), title: '', description: '' }] })}>＋ 添加子章节</button>
        </details>
      </div><div className="grid gap-1"><button className={button} aria-label={`上移章节 ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button className={button} aria-label={`下移章节 ${index + 1}`} disabled={index === items.length - 1} onClick={() => move(index, 1)}>↓</button><button className={button} aria-label={`删除章节 ${index + 1}`} disabled={items.length <= 3} onClick={() => onChange(items.filter((_, at) => at !== index))}>×</button></div></div>
    </div>)}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={items.length >= 100} onClick={() => onChange([...items, { id: crypto.randomUUID().replaceAll('-', ''), section: `章节 ${items.length + 1}`, title: '新章节', focus: '新章节', description: '', children: [] }])}>＋ 添加章节</button>{onReorganize && <button className={button} disabled={busy} onClick={onReorganize}>↻ AI 重新组织</button>}</div>
  </div>;
}

function FileSource({ file, setFile, importMode, setImportMode, direct, supplementMode, setSupplementMode, prompt, setPrompt, text, setText }: { file: File | null; setFile: (file: File | null) => void; importMode: 'generate' | 'editable'; setImportMode: (mode: 'generate' | 'editable') => void; direct: boolean; supplementMode: 'prompt' | 'paste'; setSupplementMode: (mode: 'prompt' | 'paste') => void; prompt: string; setPrompt: (value: string) => void; text: string; setText: (value: string) => void }) {
  return <div className="ppt-create-split grid gap-5 lg:grid-cols-2"><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">选择源文件</h3><p className="mt-1 text-sm text-muted-foreground">支持演示文稿、PDF、Word、Excel（.xlsx）、CSV、Markdown 与 HTML。</p><div className="mt-5 flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border p-5 text-center" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); setFile(event.dataTransfer.files[0] || null); }}><span className="text-3xl text-primary">↥</span><strong className="mt-3">{file?.name ? `✓ ${file.name}` : '拖放文件到这里，或点击选择文件'}</strong><small className="mt-1 text-muted-foreground">支持 .pptx、.pdf、.docx、.xlsx、.csv、.md、.txt、.html、.png、.jpg</small><label className={`${button} mt-4`}>{file ? '重新选择文件' : '选择文件'}<input className="sr-only" type="file" accept=".md,.markdown,.txt,.html,.htm,.docx,.pdf,.xlsx,.csv,.pptx,.png,.jpg,.jpeg" onChange={event => setFile(event.target.files?.[0] || null)}/></label>{file?.name.toLowerCase().endsWith('.pptx') && <PptSelectField aria-label="PPTX 导入方式" className={`${field} mt-4`} value={importMode} onValueChange={value=>setImportMode(value as 'generate' | 'editable')}><option value="generate">读取内容并生成新演示文稿</option><option value="editable">保守编辑原始 PPTX</option></PptSelectField>}</div></section>{direct ? <section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">下一步选择质量等级</h3><p className="mt-2 text-sm text-muted-foreground">先选择文件；下一步选择质量等级，并按需补充 Prompt 或文本。确认内容后才开始解析。</p></section> : <Supplement mode={supplementMode} setMode={setSupplementMode} prompt={prompt} setPrompt={setPrompt} text={text} setText={setText}/>}</div>;
}

function Supplement({ mode, setMode, prompt, setPrompt, text, setText }: { mode: 'prompt' | 'paste'; setMode: (mode: 'prompt' | 'paste') => void; prompt: string; setPrompt: (value: string) => void; text: string; setText: (value: string) => void }) {
  return <section className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">补充内容（可选）</h3><p className="mt-1 text-sm text-muted-foreground">说明重点、受众、最新信息或希望保留的内容。</p><div className="mt-4 flex gap-2"><button className={mode === 'prompt' ? primary : button} onClick={() => setMode('prompt')}>Prompt</button><button className={mode === 'paste' ? primary : button} onClick={() => setMode('paste')}>粘贴文本</button></div><label className="mt-4 block space-y-1 text-sm">{mode === 'prompt' ? '输入 Prompt' : '粘贴补充文本'}<textarea className={`${field} min-h-48`} value={mode === 'prompt' ? prompt : text} onChange={event => mode === 'prompt' ? setPrompt(event.target.value) : setText(event.target.value)} placeholder={mode === 'prompt' ? '例如：面向管理层，重点保留文件中的核心数据与结论。' : '粘贴会议纪要、补充数据或最新进展…'}/></label></section>;
}
