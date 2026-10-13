'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { PptModel, PptProject, PptSlide, PptTemplate } from './types';
import { TemplateBrowser } from './create/TemplateBrowser';
import { TemplateSettingsLayout } from './create/TemplateSettingsLayout';
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

function Preview({ item, slide = 0, coverTitle }: { item: PptTemplate; slide?: number; coverTitle?: string }) {
  const colors = item.palette || { background: '#171b31', accent: '#967fff', foreground: '#f5f6fc', muted: '#c4c9d8' };
  return <div className="aspect-video rounded-lg border-t-4 p-[7%]" style={{ background: colors.background, borderColor: colors.accent, color: colors.foreground }}>
    <div className="line-clamp-2 text-lg font-semibold">{slide === 0 && coverTitle ? coverTitle : item.sampleTitles?.[slide % Math.max(1, item.sampleTitles.length)] || item.name}</div>
    <div className="mt-4 h-1 w-2/3 rounded" style={{ background: colors.accent }} />
    <div className="mt-3 h-1 w-1/2 rounded opacity-60" style={{ background: colors.muted }} />
  </div>;
}

export function PptM3({ mode, projects, models, modelKey = '', baseProjectId, onUseTemplate, onCreated, onBack, onBackToLlm }: {
  mode: 'templates' | 'update'; projects: PptProjectSummary[]; models: PptModel[]; baseProjectId?: string | null;
  modelKey?: string; onUseTemplate: (id: string, item: PptTemplate) => void; onCreated: (project: PptProjectSummary) => void; onBack?: () => void; onBackToLlm?: () => void;
}) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<PptTemplate[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [preview, setPreview] = useState<PptTemplate | null>(null);
  const [previewPage, setPreviewPage] = useState(0);
  const [upload, setUpload] = useState<File | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PptTemplate | null>(null);
  const [step, setStep] = useState(1);
  const [baseId, setBaseId] = useState(baseProjectId || '');
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [progressKind, setProgressKind] = useState<'prompt' | 'paste' | 'file'>('prompt');
  const [progressText, setProgressText] = useState('');
  const [progressFile, setProgressFile] = useState<File | null>(null);
  const [templateId, setTemplateId] = useState('violet');
  const [pages, setPages] = useState(10);
  const [pagesTouched, setPagesTouched] = useState(false);
  const [updateTitle, setUpdateTitle] = useState('');
  const [updateOutline, setUpdateOutline] = useState<PptSlide[]>([]);
  const [preparedUpdate, setPreparedUpdate] = useState<{ id: string; sourceKey: string; pages: number; template: string } | null>(null);
  const updateGeneration = useRef(0);
  const updateSource = JSON.stringify({ baseId, baseFile: baseFile && [baseFile.name, baseFile.size, baseFile.lastModified], progressKind, progressText, progressFile: progressFile && [progressFile.name, progressFile.size, progressFile.lastModified], updateTitle, modelKey });
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
  async function prepareUpdate(targetStep = 3, estimateFirst = false) {
    const model = models.find(item => item.id === modelKey);
    if (!model) { setError(t('ppt.chooseModel')); return; }
    await task(async () => {
      const attempt = ++updateGeneration.current;
      const fileHashes = await Promise.all([baseFile, progressKind === 'file' ? progressFile : null].map(async file => file ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(value => value.toString(16).padStart(2, '0')).join('') : null));
      const sourceKey = JSON.stringify([updateSource, ...fileHashes]);
      if (updateGeneration.current !== attempt || latestUpdateSource.current !== updateSource) return;
      let projectId = preparedUpdate?.sourceKey === sourceKey ? preparedUpdate.id : '';
      if (projectId && (preparedUpdate?.pages !== pages || preparedUpdate?.template !== templateId)) {
        await call(`projects/${projectId}/outline`, 'POST', { pages, template: templateId });
      }
      if (!projectId) {
      const body: Record<string, unknown> = { template: templateId, pages: estimateFirst && !pagesTouched ? undefined : pages, title: updateTitle.trim() || undefined, configId: model.configId, model: model.modelId,
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
      let current = (await call<{ project: PptProject }>(`projects/${projectId}`)).project;
      if (updateGeneration.current !== attempt || latestUpdateSource.current !== updateSource) return;
      const deadline = Date.now() + 300_000;
      while (current.status === 'ingesting' || current.status === 'outlining') {
        if (Date.now() >= deadline) throw new Error('大纲生成超时，请到任务中心查看进度');
        await new Promise(resolve => setTimeout(resolve, 1000));
        current = (await call<{ project: PptProject }>(`projects/${projectId}`)).project;
        if (updateGeneration.current !== attempt || latestUpdateSource.current !== updateSource) return;
      }
      if (current.status !== 'outline_ready') throw new Error(current.error || '大纲生成失败');
      if (updateGeneration.current !== attempt || latestUpdateSource.current !== updateSource) return;
      if (estimateFirst && !pagesTouched) setPages(current.pages);
      setUpdateOutline(current.outline);
      setPreparedUpdate({ id: projectId, sourceKey, pages: current.pages, template: templateId });
      setPreviewPage(0); setStep(targetStep);
    });
  }
  async function createUpdate() {
    if (!preparedUpdate || !updateOutline.length) { setError('请先生成并确认大纲'); return; }
    await task(async () => {
      await call(`projects/${preparedUpdate.id}/outline`, 'PATCH', { slides: updateOutline, finalPageCount: updateOutline.length, template: templateId });
      const generated = await call<{ project: PptProjectSummary }>(`projects/${preparedUpdate.id}/generate`, 'POST');
      onCreated(generated.project);
    });
  }
  const progressReady = progressKind === 'file' ? Boolean(progressFile) : Boolean(progressText.trim());
  const chosen = templates.find(item => item.id === templateId);
  const chosenModel = models.find(item => item.id === modelKey);

  return <section className={mode === 'update' ? 'ppt-prototype ppt-update-stage fixed inset-0 z-[60] flex flex-col overflow-hidden bg-background text-foreground' : 'ppt-workspace-content space-y-5'}>
    {mode === 'update' && <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4"><button className="grid h-9 w-9 place-items-center rounded-lg border border-border" aria-label="返回工作区" onClick={onBack}>←</button><span className="grid h-8 w-8 place-items-center rounded-lg bg-primary font-semibold text-primary-foreground">A</span><strong className="text-sm">基于上一版更新</strong><span className="rounded-full border border-border px-3 py-1 text-xs">LLM · {chosenModel?.name || '未选择'}</span><div className="ml-auto"><span className="rounded-full border border-border px-3 py-1 text-xs">创建新版本</span></div></header>}
    {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    {mode === 'templates' ? <>
      <div className="sticky top-0 z-20 space-y-4 bg-background/95 pb-4 backdrop-blur"><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-wider text-primary">Workspace / PPT Workspace</div><h1 className="mt-2 text-2xl font-semibold">模板中心</h1><p className="mt-1 text-sm text-muted-foreground">从经过整理的结构开始，快速生成适合汇报、提案和培训的 PPT。</p></div>
        <div className="flex flex-wrap items-center gap-2"><button className={primary} disabled={busy} onClick={() => setUploadOpen(true)}>↥ 上传模板</button></div></div>
      <div className="ppt-template-search flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"><label className="relative min-w-56 flex-1"><span className="absolute left-3 top-2.5 text-muted-foreground">⌕</span><input className={`${field} pl-8`} aria-label="搜索模板" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索模板" /></label><span className="text-xs text-muted-foreground">{visible.length} 个模板</span></div><div className="ppt-template-chips flex flex-wrap gap-2">{categories.map(item => <button key={item} className={`rounded-full border px-3 py-1.5 text-sm ${category === item ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`} onClick={() => setCategory(item)}>{t(`ppt.m3.category.${categoryKeys[item]}` as TranslationKey)}</button>)}</div></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{visible.map(item => <article key={item.id} className="ppt-template-card overflow-hidden rounded-xl border border-border bg-card"><button className="block w-full text-left" onClick={() => { setPreview(item); setPreviewPage(0); }}><div className="relative"><Preview item={item} /><small className="absolute left-3 top-3 rounded bg-black/25 px-2 py-1 text-white">{productCategory(item)} · {item.pages} 页</small></div></button><div className="space-y-3 p-4"><div className="flex items-start gap-2"><h3 className="min-w-0 flex-1 truncate font-medium">{item.name}</h3><button className="px-1" title={item.pinned ? '取消置顶' : '置顶'} onClick={() => void editTemplate(item, 'pin')}>{item.pinned ? '📌' : '♧'}</button>{item.kind === 'uploaded' && <button className="px-1 text-destructive" title="删除模板" onClick={() => void editTemplate(item, 'delete')}>×</button>}</div><p className="min-h-10 text-sm text-muted-foreground">{item.description}</p><div className="flex gap-2"><button className={button} onClick={() => { setPreview(item); setPreviewPage(0); }}>预览</button><button className={primary} disabled={item.compatibility !== 'mapped'} onClick={() => { setPreview(item); setPreviewPage(0); }}>使用此模板</button></div></div></article>)}</div>
    </> : <><div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="mx-auto max-w-6xl space-y-5"><div className="flex items-center justify-center gap-2 text-xs">{['选择上一版与最新进展', '选择模板、模型与页数', '确认大纲与模板'].map((label, index) => <div key={label} className="flex items-center gap-2">{index > 0 && <i className="h-px w-10 bg-border"/>}<span className={`grid h-6 w-6 place-items-center rounded-full ${step >= index + 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{index + 1}</span><span className={step === index + 1 ? 'font-medium' : 'text-muted-foreground'}>{label}</span></div>)}</div>
      {step === 1 && <><div><div className="text-xs font-semibold uppercase tracking-wider text-primary">PPT Workspace / Version Update · Step 1</div><h1 className="mt-2 text-2xl font-semibold">基于上一版更新</h1><p className="mt-1 text-sm text-muted-foreground">先确定上一版来源，再补充本次最新进展。最新进展支持 Prompt、粘贴文本或上传文件。</p></div><div className="grid gap-5 lg:grid-cols-2"><div className="space-y-4"><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">从 Workspace 选择上一版</h3><p className="mt-1 text-xs text-muted-foreground">选择当前 PPT Workspace 中已经存在的演示文稿作为基准版本。</p><div className="mt-4 space-y-2">{projects.filter(item => item.status === 'completed').map(item => <button key={item.id} className={`flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm ${baseId === item.id && !baseFile ? 'border-primary bg-primary/5' : 'border-border'}`} onClick={() => { setBaseId(item.id); setBaseFile(null); }}><span>▣ {item.title}</span><span className="text-xs text-muted-foreground">{item.pages} 页 · {new Date(item.updatedAt).toLocaleDateString()}</span></button>)}</div></section><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">上传上一版</h3><p className="mt-1 text-xs text-muted-foreground">也可以从本地上传上一版文件，上传后将替代 Workspace 中的选择。</p><label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-border p-6 text-center text-sm">↥<strong className="mt-2 block">{baseFile ? `✓ ${baseFile.name}` : '本地上传上一版'}</strong><span className="mt-1 block text-xs text-muted-foreground">支持 .pptx / .pdf / .docx / .xlsx / .csv</span><span className={`${button} mt-3 inline-block`}>{baseFile ? '重新选择' : '选择文件'}</span><input className="sr-only" type="file" accept=".pptx,.pdf,.docx,.xlsx,.csv" onChange={event => { const file = event.target.files?.[0] || null; setBaseFile(file); if (file) setBaseId(''); }}/></label></section></div><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">最新进展</h3><p className="mt-1 text-xs text-muted-foreground">选择一种方式提供本次版本需要新增、替换或强化的信息。</p><div className="mt-4 flex gap-2">{([['prompt','Prompt'],['paste','粘贴文本'],['file','上传文件']] as const).map(([kind, label]) => <button key={kind} className={progressKind === kind ? primary : button} onClick={() => setProgressKind(kind)}>{label}</button>)}</div>{progressKind === 'file' ? <label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-border p-8 text-center text-sm">↥<strong className="mt-2 block">{progressFile ? `✓ ${progressFile.name}` : '上传最新进展文件'}</strong><span className="mt-1 block text-xs text-muted-foreground">支持 .pptx / .pdf / Word (.docx) / Excel (.xlsx) / .csv / .md / .html</span><input className="sr-only" type="file" accept=".pptx,.pdf,.docx,.xlsx,.csv,.md,.markdown,.html,.htm" onChange={event => setProgressFile(event.target.files?.[0] || null)}/></label> : <label className="mt-4 block space-y-2 text-sm">{progressKind === 'prompt' ? 'Prompt' : '粘贴文本'}<textarea className={`${field} min-h-52`} value={progressText} onChange={event => setProgressText(event.target.value)} maxLength={progressKind === 'paste' ? 80000 : 80000} placeholder={progressKind === 'prompt' ? '例如：把 Q3 数据更新为 10 月最新口径，补充新客户进展，并重写结论与下一步…' : '粘贴最新会议纪要、经营进展或研究结论…'}/></label>}<p className="mt-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">下一步会根据“上一版 + 最新进展”选择适合的新模板。</p></section></div></>}
      {step === 2 && <><div><div className="text-xs font-semibold uppercase tracking-wider text-primary">PPT Workspace / Version Update · Step 2</div><h1 className="mt-2 text-2xl font-semibold">选择模板与页数</h1><p className="mt-1 text-sm text-muted-foreground">解析模型已在进入版本更新前确认；现在只需选择模板并确认 Agent 估算页数。</p></div><TemplateSettingsLayout main={<TemplateBrowser templates={templates} selectedId={templateId} onSelect={setTemplateId}/>} sidebar={<><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">当前解析模型</h3><p className="mt-1 text-xs text-muted-foreground">该模型会沿用到最新进展理解、大纲生成和页面生成。</p><div className="mt-4 rounded-lg bg-muted p-3 text-sm"><strong>{chosenModel?.name || '未选择'}</strong></div></section><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">页数设置</h3><p className="mt-1 text-xs text-muted-foreground">Agent 已结合上一版与最新进展给出建议页数。</p><div className="mt-4 flex items-center justify-between rounded-lg bg-muted p-3"><div><strong>{t(pagesTouched ? 'ppt.edit.confirmedPages' : 'ppt.edit.estimatedPages')}</strong><small className="block text-muted-foreground">可在生成前手动调整</small></div><div className="flex items-center gap-3"><button className={button} disabled={busy || pages <= 6} onClick={() => { setPagesTouched(true); setPages(value => value - 1); }}>−</button><b>{pages} 页</b><button className={button} disabled={busy || pages >= 100} onClick={() => { setPagesTouched(true); setPages(value => value + 1); }}>＋</button></div></div></section><section className="rounded-xl border border-border bg-card p-5"><label className="block space-y-2 text-sm">PPT 标题（可选）<input className={field} value={updateTitle} onChange={event => setUpdateTitle(event.target.value)} maxLength={160} placeholder="留空则使用上一版标题 · 更新版" /></label><p className="mt-2 text-xs text-muted-foreground">填写后将用于新版本文件名与封面标题。</p></section><section className="rounded-xl border border-border bg-card p-5 text-sm"><h3 className="font-semibold">当前输入</h3><p className="mt-3">上一版：<b>{baseFile?.name || projects.find(item => item.id === baseId)?.title}</b></p><p className="mt-2">当前模板：<b>{chosen?.name}</b></p></section></>}/></>}
      {step === 3 && <><div><div className="text-xs font-semibold uppercase tracking-wider text-primary">PPT Workspace / Version Update · Step 3</div><h1 className="mt-2 text-2xl font-semibold">确认大纲与模板</h1><p className="mt-1 text-sm text-muted-foreground">左侧是模型实际生成的大纲，可编辑后确认；右侧可翻页预览所选模板。</p></div><div className="grid gap-5 lg:grid-cols-2"><section className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">更新版大纲</h3><p className="mt-1 text-xs text-muted-foreground">由已选模型根据上一版与最新进展生成。标题、描述和子章节均可编辑。</p>
        <div className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto">{updateOutline.map((slide, index) => <div key={slide.id} className="rounded-lg border border-border p-3">
          <div className="flex items-start gap-2"><span className="pt-2 text-xs text-muted-foreground">{index + 1}.</span><div className="min-w-0 flex-1 space-y-2">
            <input className={field} aria-label={`更新章节名称 ${index + 1}`} value={slide.section || ''} onChange={event => setUpdateOutline(items => items.map((item, at) => at === index ? { ...item, section: event.target.value } : item))}/>
            <input className={field} aria-label={`更新大纲标题 ${index + 1}`} value={slide.title} onChange={event => setUpdateOutline(items => items.map((item, at) => at === index ? { ...item, title: event.target.value, focus: event.target.value } : item))}/>
            <textarea className={field} aria-label={`更新大纲描述 ${index + 1}`} value={slide.description || ''} onChange={event => setUpdateOutline(items => items.map((item, at) => at === index ? { ...item, description: event.target.value } : item))}/>
            {(slide.children || []).map((child, childIndex) => <div key={child.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input className={field} aria-label={`更新子章节标题 ${index + 1}-${childIndex + 1}`} value={child.title} onChange={event => setUpdateOutline(items => items.map((item, at) => at === index ? { ...item, children: (item.children || []).map((row, childAt) => childAt === childIndex ? { ...row, title: event.target.value } : row) } : item))}/><input className={field} aria-label={`更新子章节描述 ${index + 1}-${childIndex + 1}`} value={child.description} onChange={event => setUpdateOutline(items => items.map((item, at) => at === index ? { ...item, children: (item.children || []).map((row, childAt) => childAt === childIndex ? { ...row, description: event.target.value } : row) } : item))}/><button className={button} aria-label="删除子章节" onClick={() => setUpdateOutline(items => items.map((item, at) => at === index ? { ...item, children: (item.children || []).filter((_, childAt) => childAt !== childIndex) } : item))}>×</button></div>)}
            <button className="text-xs text-primary" onClick={() => setUpdateOutline(items => items.map((item, at) => at === index ? { ...item, children: [...(item.children || []), { id: crypto.randomUUID().replaceAll('-', ''), title: '新子章节', description: '' }] } : item))}>＋ 添加子章节</button>
          </div><div className="grid gap-1"><button className={button} aria-label="上移章节" disabled={index === 0} onClick={() => setUpdateOutline(items => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>↑</button><button className={button} aria-label="下移章节" disabled={index === updateOutline.length - 1} onClick={() => setUpdateOutline(items => { const next = [...items]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>↓</button><button className={button} aria-label="删除章节" disabled={updateOutline.length <= 6} onClick={() => { setUpdateOutline(items => items.filter((_, at) => at !== index)); setPagesTouched(true); setPages(value => value - 1); }}>×</button></div></div>
        </div>)}<button className={`${button} mt-3`} disabled={updateOutline.length >= 100} onClick={() => { setUpdateOutline(items => [...items, { id: crypto.randomUUID().replaceAll('-', ''), section: `章节 ${items.length + 1}`, title: '新章节', focus: '新章节', description: '', children: [] }]); setPagesTouched(true); setPages(value => value + 1); }}>＋ 添加章节</button></div></section>{chosen && <section className="rounded-xl border border-border bg-card p-5"><div className="flex items-center justify-between"><div><h3 className="font-semibold">模板预览 · {chosen.name}</h3><p className="mt-1 text-xs text-muted-foreground">检查模板节奏与大纲映射。</p></div><span className="rounded-full border border-border px-2 py-1 text-xs">{productCategory(chosen)}</span></div><div className="mt-5"><Preview item={chosen} slide={previewPage} coverTitle={updateTitle.trim() || `${baseFile?.name.replace(/\.[^.]+$/, '') || projects.find(item => item.id === baseId)?.title || '上一版'} · 更新版`}/></div><div className="mt-4 flex items-center justify-center gap-3"><button className={button} disabled={previewPage === 0} onClick={() => setPreviewPage(value => value - 1)}>← 上一页</button><span className="text-xs">{previewPage + 1} / {Math.max(1, chosen.sampleTitles?.length || chosen.pages)}</span><button className={button} disabled={previewPage >= Math.max(1, chosen.sampleTitles?.length || chosen.pages) - 1} onClick={() => setPreviewPage(value => value + 1)}>下一页 →</button></div></section>}</div></>}
    </div></div><footer className="flex h-16 shrink-0 items-center gap-2 border-t border-border px-4"><span className="text-xs text-muted-foreground">个人工作区 · 新版本后台生成</span><div className="ml-auto"/>{step === 1 ? <><button className={button} onClick={onBackToLlm || onBack}>← 返回上一步</button><button className={primary} disabled={busy || (!baseId && !baseFile) || !progressReady || !modelKey} onClick={() => void prepareUpdate(2, true)}>下一步：选择模板与页数 →</button></> : step === 2 ? <><button className={button} onClick={() => { updateGeneration.current++; setStep(1); }}>← 返回上一步</button><button className={primary} disabled={busy || !chosen || !modelKey || pages < 6 || pages > (chosen?.capabilities?.maxPages ?? 100)} onClick={() => void prepareUpdate()}>{busy ? '正在解析并生成大纲…' : '下一步：确认大纲 →'}</button></> : <><button className={button} onClick={() => setStep(2)}>← 返回上一步</button><button className={primary} disabled={busy || !modelKey || pages < 6 || pages > 100} onClick={() => void createUpdate()}>确认大纲并生成页面</button></>}</footer></>}
    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-3xl overflow-hidden rounded-xl bg-background"><header className="flex justify-between border-b border-border p-5"><div><h2 className="font-semibold">{preview.name}</h2><p className="text-sm text-muted-foreground">{productCategory(preview)} · {preview.pages} 页</p></div><button className="grid h-8 w-8 place-items-center rounded-lg border border-border" aria-label="关闭" onClick={() => setPreview(null)}>×</button></header><div className="grid gap-5 p-5 md:grid-cols-[1.1fr_.9fr]"><div><Preview item={preview} slide={previewPage} /><div className="mt-3 flex items-center justify-center gap-3"><button className={button} disabled={previewPage === 0} onClick={() => setPreviewPage(page => page - 1)}>←</button><span className="text-sm">{previewPage + 1}/{Math.max(1, preview.sampleTitles?.length || preview.pages)}</span><button className={button} disabled={previewPage >= Math.max(1, preview.sampleTitles?.length || preview.pages) - 1} onClick={() => setPreviewPage(page => page + 1)}>→</button></div></div><div><div className="text-xs font-semibold uppercase tracking-wider text-primary">模板说明</div><h3 className="mt-2 text-lg font-semibold">{preview.name}</h3><p className="mt-2 text-sm text-muted-foreground">{preview.description}</p><div className="mt-4 flex flex-wrap gap-2">{preview.tags?.map(tag => <span key={tag} className="rounded bg-muted px-2 py-1 text-xs">{tag}</span>)}</div></div></div><footer className="flex justify-end gap-2 border-t border-border p-4"><button className={button} onClick={() => setPreview(null)}>返回模板中心</button><button className={primary} disabled={preview.compatibility !== 'mapped'} onClick={() => { onUseTemplate(preview.id, preview); setPreview(null); }}>选择 LLM 并继续</button></footer></div></div>}
    {uploadOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-lg overflow-hidden rounded-xl bg-background"><header className="flex justify-between border-b border-border p-5"><div><h2 className="font-semibold">上传模板</h2><p className="mt-1 text-sm text-muted-foreground">选择本地文件，或将文件拖放到下方区域</p></div><button className="grid h-8 w-8 place-items-center rounded-lg border border-border" aria-label="关闭" onClick={() => { setUploadOpen(false); setUpload(null); }}>×</button></header><div className="p-5"><div className="rounded-xl border border-dashed border-border p-8 text-center" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); setUpload(event.dataTransfer.files[0] || null); }}><strong>↥ 拖放模板文件到这里</strong><small className="mt-2 block text-muted-foreground">支持 .pptx、.pdf 或 .potx</small><label className={`${button} mt-4 inline-block`}>选择本地文件<input className="sr-only" type="file" accept=".pptx,.potx,.pdf" onChange={event => setUpload(event.target.files?.[0] || null)}/></label></div><p className="mt-3 text-sm text-muted-foreground">{upload ? <>已选择：<strong>{upload.name}</strong></> : '尚未选择文件'}</p></div><footer className="flex justify-end gap-2 border-t border-border p-4"><button className={button} onClick={() => { setUploadOpen(false); setUpload(null); }}>取消</button><button className={primary} disabled={!upload || busy} onClick={() => void uploadTemplate()}>上传模板</button></footer></div></div>}
    {deleteTarget && <PptConfirmDialog title={t('ppt.delete')} message={t('ppt.m3.deleteTemplateConfirm')} dangerous onClose={() => setDeleteTarget(null)} onConfirm={() => void editTemplate(deleteTarget, 'delete')} />}
  </section>;
}
