'use client';

import { templatePreviewPageCount } from './template-pages';
import {PptPin} from './workspace/PptPin';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {unifiedGenerationPolicy} from '@/lib/ppt-generation-defaults';
import type { TranslationKey } from '@/i18n';
import type { PptExecutionPolicy, PptModel, PptProject, PptTemplate } from './types';
import { PptCardOutline } from './create/PptCardOutline';
import { PptConfirmDialog } from './workspace/PptConfirmDialog';

export type PptProjectSummary = Pick<PptProject, 'id' | 'title' | 'pages' | 'status' | 'updatedAt' | 'template'>;

const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';
const primary = 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50';
const categories = ['全部', '集团总部', '综合金融', '通用模板', '我的模板'];
const categoryKeys: Record<string, string> = { 全部: 'all', 集团总部: 'group', 综合金融: 'finance', 通用模板: 'general', 我的模板: 'mine' };
function productCategory(item: PptTemplate) {
  if (item.kind === 'uploaded' || item.category === '我的模板') return '我的模板';
  if (item.id === 'violet' || item.category === '商业汇报') return '集团总部';
  if (item.id === 'blue' || item.category === '产品发布' || item.category === '数据报告') return '综合金融';
  return '通用模板';
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/ppt/${path}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
async function toBase64(file: File): Promise<string> {
  if (file.size > 8 * 1024 * 1024) throw new Error('File exceeds 8 MB');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File read failed'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

function Preview({ item, slide = 0,onOpen }: { item: PptTemplate; slide?: number; coverTitle?: string;onOpen?:()=>void }) {
  const [failedUrl,setFailedUrl]=useState('');
  const previewUrl=`/api/ppt/templates/${item.id}/preview?slide=${slide}`;
  if(failedUrl!==previewUrl){const image=<img alt={item.name} className="aspect-video w-full object-contain" src={previewUrl} onError={()=>setFailedUrl(previewUrl)}/>;return onOpen?<button className="block w-full text-left" aria-label={item.name} onClick={onOpen}>{image}</button>:image;}
  return <div className="grid aspect-video place-items-center rounded-lg border border-border p-4"><p role="alert">预览加载失败</p><button className={button} onClick={()=>setFailedUrl('')}>重新加载预览</button>{onOpen&&<button className={button} onClick={onOpen}>{item.name}</button>}</div>;
}

/** The template's pages as a thumbnail strip (Fable plan T35): one lazy image
 * per page under a skeleton until it loads, a retry for a page that fails; the
 * shown page is the selected tab. A row on phones, a rail beside the page on
 * wider screens. */
function PreviewThumbs({ item, page, onPage }: { item: PptTemplate; page: number; onPage: (page: number) => void }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Record<number, 'ok' | 'failed'>>({});
  const [attempts, setAttempts] = useState<Record<number, number>>({});
  const shown = useRef<HTMLButtonElement | null>(null);
  // The shown page stays in view when it changes and when the strip turns from rail to row.
  useEffect(() => { const reveal = () => shown.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); reveal(); window.addEventListener('resize', reveal); return () => window.removeEventListener('resize', reveal); }, [page]);
  return <div role="tablist" aria-label={t('ppt.m3.pages')} data-testid="ppt-template-thumbs" className="flex gap-2 overflow-x-auto pb-1 md:max-h-[26rem] md:flex-col md:overflow-x-hidden md:overflow-y-auto md:pb-0 md:pr-1">
    {Array.from({ length: templatePreviewPageCount(item) }, (_, index) => {
      const state = loaded[index], label = t('ppt.m3.pageN', { n: index + 1 });
      return <div key={index} className="relative shrink-0">
        <button ref={index === page ? shown : undefined} type="button" role="tab" aria-selected={index === page} aria-current={index === page ? 'page' : undefined} aria-label={label} tabIndex={index === page ? 0 : -1}
          className={`relative block h-16 w-[114px] overflow-hidden rounded-md border-2 bg-muted ${index === page ? 'border-primary' : 'border-transparent hover:border-border'}`} onClick={() => onPage(index)}>
          {state !== 'failed' && <img alt="" loading="lazy" className="h-full w-full object-contain" src={`/api/ppt/templates/${item.id}/preview?slide=${index}${attempts[index] ? `&retry=${attempts[index]}` : ''}`}
            onLoad={() => setLoaded(value => ({ ...value, [index]: 'ok' }))} onError={() => setLoaded(value => ({ ...value, [index]: 'failed' }))}/>}
          {!state && <span aria-hidden className="absolute inset-0 animate-pulse bg-muted"/>}
          <span className="absolute bottom-0.5 right-1 rounded bg-black/50 px-1 text-[10px] text-white">{index + 1}</span>
        </button>
        {state === 'failed' && <button type="button" className="absolute inset-x-1 top-1/2 -translate-y-1/2 rounded border border-border bg-background px-1 py-0.5 text-[11px]" aria-label={`${t('ppt.m3.thumbRetry')} · ${label}`}
          onClick={() => { setLoaded(value => { const next = { ...value }; delete next[index]; return next; }); setAttempts(value => ({ ...value, [index]: (value[index] || 0) + 1 })); }}>{t('ppt.m3.thumbRetry')}</button>}
      </div>;
    })}
  </div>;
}

export function PptM3({ mode, projects, models, modelKey = '', executionPolicy, baseProjectId, onUseTemplate, onCreated, onBack, onBackToLlm }: {
  mode: 'templates' | 'update'; projects: PptProjectSummary[]; models: PptModel[]; baseProjectId?: string | null;
  executionPolicy?:PptExecutionPolicy; modelKey?: string; onUseTemplate: (id: string, item: PptTemplate) => void; onCreated: (project: PptProjectSummary) => void; onBack?: () => void; onBackToLlm?: () => void;
}) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<PptTemplate[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [preview, setPreview] = useState<PptTemplate | null>(null);
  const [previewPage, setPreviewPage] = useState(0);
  // The preview dialog takes focus so ←/→ turn its pages (Fable plan T35).
  const previewDialog = useRef<HTMLDivElement | null>(null);
  const [upload, setUpload] = useState<File | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PptTemplate | null>(null);
  const [step, setStep] = useState(1);
  const [leaveOpen,setLeaveOpen]=useState(false);
  const [baseId, setBaseId] = useState(baseProjectId || '');
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [progressKind, setProgressKind] = useState<'prompt' | 'paste' | 'file'>('prompt');
  const [progressText, setProgressText] = useState('');
  const [progressFile, setProgressFile] = useState<File | null>(null);
  const [generationPolicy]=useState(unifiedGenerationPolicy);
  const [updateTitle, setUpdateTitle] = useState('');
  // The read update project: step 2 is the card outline (settings, cards,
  // required source warnings) of the create wizard (Fable plan T8).
  const [updateProject, setUpdateProject] = useState<PptProject | null>(null);
  const [preparedUpdate, setPreparedUpdate] = useState<{ id: string; sourceKey: string; title:string } | null>(null);
  const updateGeneration = useRef(0);
  const updateSource = JSON.stringify({ baseId, baseFile: baseFile && [baseFile.name, baseFile.size, baseFile.lastModified], progressKind, progressText, progressFile: progressFile && [progressFile.name, progressFile.size, progressFile.lastModified], modelKey });
  const latestUpdateSource = useRef(updateSource); latestUpdateSource.current = updateSource;
  useEffect(() => () => { updateGeneration.current++; }, []);
  const updateAttempt = useRef<{ payload: string; requestId: string } | null>(null);

  useEffect(() => { updateGeneration.current++; }, [baseFile, progressFile, baseId, progressKind, progressText, updateTitle, modelKey]);
  useEffect(() => { setBaseId(baseProjectId || ''); }, [baseProjectId]);
  async function refresh() {
    try { const result = await call<{ templates: PptTemplate[] }>('templates'); setTemplates(result.templates); }
    catch (cause) { setError((cause as Error).message); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (preview) previewDialog.current?.focus(); }, [preview]);
  const visible = useMemo(() => templates.filter(item => (category === '全部' || productCategory(item) === category) &&
    `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [templates, query, category]);
  async function task(work: () => Promise<void>) { setBusy(true); setError(''); try { await work(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  async function uploadTemplate() {
    if (!upload) return;
    await task(async () => { const response = await fetch(`/api/ppt/templates?fileName=${encodeURIComponent(upload.name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: upload }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Template upload failed'); setUpload(null); setUploadOpen(false); await refresh(); });
  }
  async function editTemplate(item: PptTemplate, action: 'pin' | 'delete') {
    if (action === 'delete' && deleteTarget?.id !== item.id) { setDeleteTarget(item); return; }
    await task(async () => {
      if (action === 'pin') await call(`templates/${item.id}`, 'PATCH', { pinned: !item.pinned });
      else { await call(`templates/${item.id}`, 'DELETE'); setDeleteTarget(null); }
      await refresh();
    });
  }
  async function readUpdate() {
    const model = models.find(item => item.id === modelKey);
    if (!model) { setError(t('ppt.chooseModel')); return; }
    await task(async () => {
      const attempt = ++updateGeneration.current;
      const fileHashes = await Promise.all([baseFile, progressKind === 'file' ? progressFile : null].map(async file => file ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(value => value.toString(16).padStart(2, '0')).join('') : null));
      const sourceKey = JSON.stringify([updateSource, ...fileHashes]);
      if (updateGeneration.current !== attempt || latestUpdateSource.current !== updateSource) return;
      let projectId = preparedUpdate?.sourceKey === sourceKey ? preparedUpdate.id : '';
      if(projectId&&preparedUpdate?.title!==updateTitle.trim())await call(`projects/${projectId}`,'PATCH',{title:updateTitle.trim()||`${baseFile?.name.replace(/\.[^.]+$/,'')||projects.find(item=>item.id===baseId)?.title||'上一版'} · 更新版`});
      if (!projectId) {
      // An update is a card deck (S11): the input is read first; the card outline writes it with the chosen settings.
      const body: Record<string, unknown> = { executionPolicy, generationPolicy, readOnlyInput:true, title: updateTitle.trim() || undefined, configId: model.configId, model: model.modelId,
        progressKind, progressText: progressKind === 'file' ? undefined : progressText };
      if (baseFile) { body.baseFileName = baseFile.name; body.baseFileBase64 = await toBase64(baseFile); }
      else body.baseProjectId = baseId;
      if (progressFile && progressKind === 'file') { body.progressFileName = progressFile.name; body.progressFileBase64 = await toBase64(progressFile); }
      const payload = JSON.stringify(body);
      if (updateAttempt.current?.payload !== payload) updateAttempt.current = { payload, requestId: crypto.randomUUID() };
      body.requestId = updateAttempt.current.requestId;
      const result = await call<{ project: PptProjectSummary }>('updates', 'POST', body);
      projectId = result.project.id;
      }
      let current = (await call<{ project: PptProject }>(`projects/${projectId}?view=live`)).project;
      const deadline = Date.now() + 300_000;
      while (current.status === 'ingesting') {
        if (Date.now() >= deadline) throw new Error('输入读取超时，请到任务中心查看进度');
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (updateGeneration.current !== attempt || latestUpdateSource.current !== updateSource) return;
        current = (await call<{ project: PptProject }>(`projects/${projectId}?view=live`)).project;
      }
      if (updateGeneration.current !== attempt || latestUpdateSource.current !== updateSource) return;
      if (!['input_ready','outlining','outline_ready'].includes(current.status) || !current.planningContract) throw new Error(current.error || '输入读取失败');
      setPreparedUpdate({ id: projectId, sourceKey, title:updateTitle.trim() });
      setUpdateProject(current); setStep(2);
    });
  }
  async function createUpdate(project: PptProject) {
    await task(async () => {
      await call(`projects/${project.id}/outline`, 'PATCH', { slides: project.outline, executionPolicy, finalPageCount: project.outline.length, pageSource:'user', template: project.template, generationPolicy: project.generationPolicy });
      const generated = await call<{ project: PptProjectSummary }>(`projects/${project.id}/generate`, 'POST');
      onCreated(generated.project);
    });
  }
  const progressReady = progressKind === 'file' ? Boolean(progressFile) : Boolean(progressText.trim());
  if (mode === 'update' && step === 2 && updateProject) return <>
    {error && <div role="alert" className="fixed inset-x-4 top-4 z-[70] rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    <PptCardOutline templates={templates} initial={updateProject} busy={busy} onClose={() => { updateGeneration.current++; setStep(1); }} onGenerate={project => void createUpdate(project)}/>
  </>;

  return <section className={mode === 'update' ? 'ppt-prototype ppt-update-stage fixed inset-0 z-[60] flex flex-col overflow-hidden bg-background text-foreground' : 'ppt-workspace-content space-y-5'}>
    {mode === 'update' && <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4"><button className="grid h-9 w-9 place-items-center rounded-lg border border-border" aria-label={t('ppt.edit.previous')} onClick={()=>step>1?setStep(step-1):(onBackToLlm||onBack)?.()}>←</button><button className={button} aria-label={t('ppt.home')} title={t('ppt.home')} onClick={()=>baseFile||progressText.trim()||progressFile||preparedUpdate?setLeaveOpen(true):onBack?.()}>⌂</button><span className="grid h-8 w-8 place-items-center rounded-lg bg-primary font-semibold text-primary-foreground">A</span><strong className="text-sm">基于上一版更新</strong><span className="rounded-full border border-border px-3 py-1 text-xs">LLM · {models.find(item=>item.id===modelKey)?.name||'—'}</span><div className="ml-auto hidden sm:block"><span className="whitespace-nowrap rounded-full border border-border px-3 py-1 text-xs">创建新版本</span></div></header>}
    {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    {mode === 'templates' ? <>
      <div className="sticky top-0 z-20 space-y-4 bg-background/95 pb-4 backdrop-blur"><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-wider text-primary">Workspace / PPT Workspace</div><h1 className="mt-2 text-2xl font-semibold">模板中心</h1><p className="mt-1 text-sm text-muted-foreground">从经过整理的结构开始，快速生成适合汇报、提案和培训的 PPT。</p></div>
        <div className="flex flex-wrap items-center gap-2"><button className={primary} disabled={busy} onClick={() => setUploadOpen(true)}>↥ 上传模板</button></div></div>
      <div className="ppt-template-search flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"><label className="relative min-w-56 flex-1"><span className="absolute left-3 top-2.5 text-muted-foreground">⌕</span><input className={`${field} pl-8`} aria-label="搜索模板" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索模板" /></label><span className="text-xs text-muted-foreground">{visible.length} 个模板</span></div><div className="ppt-template-chips flex flex-wrap gap-2">{categories.map(item => <button key={item} className={`rounded-full border px-3 py-1.5 text-sm ${category === item ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`} onClick={() => setCategory(item)}>{t(`ppt.m3.category.${categoryKeys[item]}` as TranslationKey)}</button>)}</div></div>
      <div className="ppt-template-grid">{visible.map(item => <article key={item.id} className="ppt-template-card overflow-hidden rounded-xl border border-border bg-card"><div className="relative"><Preview item={item} onOpen={()=>{setPreview(item);setPreviewPage(0);}} /><small className="absolute left-3 top-3 rounded bg-black/25 px-2 py-1 text-white">{productCategory(item)} · {item.pages} 页</small></div><div className="space-y-3 p-4"><div className="flex items-start gap-2"><h3 className="min-w-0 flex-1 truncate font-medium">{item.name}</h3><button className="px-1" title={item.pinned ? '取消置顶' : '置顶'} onClick={() => void editTemplate(item, 'pin')}><PptPin active={item.pinned}/></button>{item.kind === 'uploaded' && <button className="px-1 text-destructive" title="删除模板" onClick={() => void editTemplate(item, 'delete')}>×</button>}</div><p className="min-h-10 text-sm text-muted-foreground">{item.description}</p><p className="text-xs text-muted-foreground">{item.compatibility==='mapped'?t('ppt.template.ready'):t('ppt.template.referenceOnly')} · {item.capabilities?.relayout?t('ppt.template.relayout'):t('ppt.template.native')}</p>{item.compatibility!=='mapped'&&item.kind==='uploaded'&&<button className={button} onClick={()=>void call(`templates/${item.id}`,'PATCH',{reparse:true}).then(()=>refresh()).catch(error=>setError(error.message))}>{t('ppt.template.reparse')}</button>}<div className="flex gap-2"><button className={button} onClick={() => { setPreview(item); setPreviewPage(0); }}>预览</button><button className={primary} disabled={item.compatibility !== 'mapped'} title={item.compatibility!=='mapped'?t('ppt.edit.templateMissing'):undefined} onClick={() => onUseTemplate(item.id,item)}>使用此模板</button></div></div></article>)}</div>
    </> : <><div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="mx-auto max-w-6xl space-y-5"><div className="flex items-center justify-center gap-2 text-xs">{['选择上一版与最新进展', '设置并确认卡片大纲'].map((label, index) => <div key={label} className="flex items-center gap-2">{index > 0 && <i className="h-px w-10 bg-border"/>}<span className={`grid h-6 w-6 place-items-center rounded-full ${step >= index + 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{index + 1}</span><span className={step === index + 1 ? 'font-medium' : 'text-muted-foreground'}>{label}</span></div>)}</div>
      {step === 1 && <><div><div className="text-xs font-semibold uppercase tracking-wider text-primary">PPT Workspace / Version Update · Step 1</div><h1 className="mt-2 text-2xl font-semibold">基于上一版更新</h1><p className="mt-1 text-sm text-muted-foreground">先确定上一版来源，再补充本次最新进展。最新进展支持 Prompt、粘贴文本或上传文件。</p></div><div className="grid gap-5 lg:grid-cols-2"><div className="space-y-4"><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">从 Workspace 选择上一版</h3><p className="mt-1 text-xs text-muted-foreground">选择当前 PPT Workspace 中已经存在的演示文稿作为基准版本。</p><div className="mt-4 space-y-2">{projects.filter(item => item.status === 'completed').map(item => <button key={item.id} className={`flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm ${baseId === item.id && !baseFile ? 'border-primary bg-primary/5' : 'border-border'}`} onClick={() => { setBaseId(item.id); setBaseFile(null); }}><span>▣ {item.title}</span><span className="text-xs text-muted-foreground">{item.pages} 页 · {new Date(item.updatedAt).toLocaleDateString()}</span></button>)}</div></section><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">上传上一版</h3><p className="mt-1 text-xs text-muted-foreground">也可以从本地上传上一版文件，上传后将替代 Workspace 中的选择。</p><label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-border p-6 text-center text-sm">↥<strong className="mt-2 block">{baseFile ? `✓ ${baseFile.name}` : '本地上传上一版'}</strong><span className="mt-1 block text-xs text-muted-foreground">支持 .pptx / .pdf / .docx / .xlsx / .csv</span><span className={`${button} mt-3 inline-block`}>{baseFile ? '重新选择' : '选择文件'}</span><input className="sr-only" type="file" accept=".pptx,.pdf,.docx,.xlsx,.csv" onChange={event => { const file = event.target.files?.[0] || null; setBaseFile(file); if (file) setBaseId(''); }}/></label></section></div><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">最新进展</h3><p className="mt-1 text-xs text-muted-foreground">选择一种方式提供本次版本需要新增、替换或强化的信息。</p><div className="mt-4 flex gap-2">{([['prompt','Prompt'],['paste','粘贴文本'],['file','上传文件']] as const).map(([kind, label]) => <button key={kind} className={progressKind === kind ? primary : button} onClick={() => setProgressKind(kind)}>{label}</button>)}</div>{progressKind === 'file' ? <label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-border p-8 text-center text-sm">↥<strong className="mt-2 block">{progressFile ? `✓ ${progressFile.name}` : '上传最新进展文件'}</strong><span className="mt-1 block text-xs text-muted-foreground">支持 .pptx / .pdf / Word (.docx) / Excel (.xlsx) / .csv / .md / .html</span><input className="sr-only" type="file" accept=".pptx,.pdf,.docx,.xlsx,.csv,.md,.markdown,.html,.htm" onChange={event => setProgressFile(event.target.files?.[0] || null)}/></label> : <label className="mt-4 block space-y-2 text-sm">{progressKind === 'prompt' ? 'Prompt' : '粘贴文本'}<textarea className={`${field} min-h-52`} value={progressText} onChange={event => setProgressText(event.target.value)} maxLength={progressKind === 'paste' ? 80000 : 80000} placeholder={progressKind === 'prompt' ? '例如：把 Q3 数据更新为 10 月最新口径，补充新客户进展，并重写结论与下一步…' : '粘贴最新会议纪要、经营进展或研究结论…'}/></label>}<label className="mt-4 block space-y-2 text-sm">PPT 标题（可选）<input className={field} value={updateTitle} onChange={event => setUpdateTitle(event.target.value)} maxLength={160} placeholder="留空则使用上一版标题 · 更新版" /></label><p className="mt-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">下一步在卡片大纲中选择模板、长度、详细程度与语言，再生成新版本。</p></section></div></>}
    </div></div><footer className="flex h-16 shrink-0 items-center gap-2 border-t border-border px-4"><span className="text-xs text-muted-foreground">个人工作区 · 新版本后台生成</span><div className="ml-auto"/><button className={button} onClick={onBackToLlm || onBack}>← 返回上一步</button><button className={primary} disabled={busy || (!baseId && !baseFile) || !progressReady || !modelKey} onClick={() => void readUpdate()}>{busy?t('ppt.create.readingInput'):t('ppt.create.readEstimate')}</button></footer></>}
    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={preview.name} data-testid="ppt-template-preview"
      onKeyDown={event => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return; const last = templatePreviewPageCount(preview) - 1;
        if (event.key === 'ArrowRight' && previewPage < last) { event.preventDefault(); setPreviewPage(previewPage + 1); }
        else if (event.key === 'ArrowLeft' && previewPage > 0) { event.preventDefault(); setPreviewPage(previewPage - 1); }
        else if (event.key === 'Escape') setPreview(null); }}><div ref={previewDialog} tabIndex={-1} className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-background outline-none"><header className="flex justify-between border-b border-border p-5"><div><h2 className="font-semibold">{preview.name}</h2><p className="text-sm text-muted-foreground">{productCategory(preview)} · {preview.pages} 页</p></div><button className="grid h-8 w-8 place-items-center rounded-lg border border-border" aria-label="关闭" onClick={() => setPreview(null)}>×</button></header><div className="grid min-h-0 gap-5 overflow-y-auto p-5 md:grid-cols-[auto_1.3fr_.7fr]"><div className="order-2 min-w-0 md:order-1"><PreviewThumbs item={preview} page={previewPage} onPage={setPreviewPage}/></div><div className="order-1 min-w-0 md:order-2"><Preview item={preview} slide={previewPage} /><div className="mt-3 flex items-center justify-center gap-3"><button className={button} disabled={previewPage === 0} onClick={() => setPreviewPage(page => page - 1)}>←</button><span className="text-sm">{previewPage + 1}/{templatePreviewPageCount(preview)}</span><button className={button} disabled={previewPage >= templatePreviewPageCount(preview) - 1} onClick={() => setPreviewPage(page => page + 1)}>→</button></div></div><div className="order-3"><div className="text-xs font-semibold uppercase tracking-wider text-primary">模板说明</div><h3 className="mt-2 text-lg font-semibold">{preview.name}</h3><p className="mt-2 text-sm text-muted-foreground">{preview.description}</p><div className="mt-4 flex flex-wrap gap-2">{preview.tags?.map(tag => <span key={tag} className="rounded bg-muted px-2 py-1 text-xs">{tag}</span>)}</div></div></div><footer className="flex justify-end gap-2 border-t border-border p-4"><button className={button} onClick={() => setPreview(null)}>返回模板中心</button><button className={primary} disabled={preview.compatibility !== 'mapped'} onClick={() => { onUseTemplate(preview.id, preview); setPreview(null); }}>{t('ppt.chooseModel')}</button></footer></div></div>}
    {uploadOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-lg overflow-hidden rounded-xl bg-background"><header className="flex justify-between border-b border-border p-5"><div><h2 className="font-semibold">上传模板</h2><p className="mt-1 text-sm text-muted-foreground">选择本地文件，或将文件拖放到下方区域</p></div><button className="grid h-8 w-8 place-items-center rounded-lg border border-border" aria-label="关闭" onClick={() => { setUploadOpen(false); setUpload(null); }}>×</button></header><div className="p-5"><div className="rounded-xl border border-dashed border-border p-8 text-center" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); setUpload(event.dataTransfer.files[0] || null); }}><strong>↥ 拖放模板文件到这里</strong><small className="mt-2 block text-muted-foreground">支持 .pptx、.pdf 或 .potx</small><label className={`${button} mt-4 inline-block`}>选择本地文件<input className="sr-only" type="file" accept=".pptx,.potx,.pdf" onChange={event => setUpload(event.target.files?.[0] || null)}/></label></div><p className="mt-3 text-sm text-muted-foreground">{upload ? <>已选择：<strong>{upload.name}</strong></> : '尚未选择文件'}</p></div><footer className="flex justify-end gap-2 border-t border-border p-4"><button className={button} onClick={() => { setUploadOpen(false); setUpload(null); }}>取消</button><button className={primary} disabled={!upload || busy} onClick={() => void uploadTemplate()}>上传模板</button></footer></div></div>}
    {leaveOpen&&<PptConfirmDialog title={t('ppt.create.leaveTitle')} message={preparedUpdate?t('ppt.create.leaveSaved'):t('ppt.create.leaveUnsaved')} confirmLabel={t('ppt.create.leave')} onClose={()=>setLeaveOpen(false)} onConfirm={()=>onBack?.()}/>}
    {deleteTarget && <PptConfirmDialog title={t('ppt.delete')} message={t('ppt.m3.deleteTemplateConfirm')} dangerous onClose={() => setDeleteTarget(null)} onConfirm={() => void editTemplate(deleteTarget, 'delete')} />}
  </section>;
}
