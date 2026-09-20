'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

export type PptTemplate = { id: string; name: string; category: string; description: string; pages: number; kind: string; compatibility: 'mapped' | 'reference'; pinned: boolean; tags: string[]; sampleTitles?: string[]; palette?: { background: string; accent: string; foreground: string; muted: string } | null; fonts?: { title: string; body: string; titleEastAsia: string; bodyEastAsia: string; cjkExplicit?: boolean } | null };
export type PptModel = { id: string; name: string; configId: string; modelId: string };
export type PptProjectSummary = { id: string; title: string; pages: number; status: string; updatedAt: string; template: string };

const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';
const primary = 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50';
const categories = ['全部', '商业汇报', '产品发布', '营销提案', '教育培训', '数据报告', '我的模板'];
const categoryKeys: Record<string, string> = { 全部: 'all', 商业汇报: 'business', 产品发布: 'product', 营销提案: 'marketing', 教育培训: 'education', 数据报告: 'data', 我的模板: 'mine' };

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

function Preview({ item, slide = 0 }: { item: PptTemplate; slide?: number }) {
  const colors = item.palette || { background: '#171b31', accent: '#967fff', foreground: '#f5f6fc', muted: '#c4c9d8' };
  return <div className="aspect-video rounded-lg border-t-4 p-[7%]" style={{ background: colors.background, borderColor: colors.accent, color: colors.foreground }}>
    <div className="line-clamp-2 text-lg font-semibold">{item.sampleTitles?.[slide % Math.max(1, item.sampleTitles.length)] || item.name}</div>
    <div className="mt-4 h-1 w-2/3 rounded" style={{ background: colors.accent }} />
    <div className="mt-3 h-1 w-1/2 rounded opacity-60" style={{ background: colors.muted }} />
  </div>;
}

export function PptM3({ mode, projects, models, baseProjectId, onUseTemplate, onCreated }: {
  mode: 'templates' | 'update'; projects: PptProjectSummary[]; models: PptModel[]; baseProjectId?: string | null;
  onUseTemplate: (id: string, item: PptTemplate) => void; onCreated: (project: PptProjectSummary) => void;
}) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<PptTemplate[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [preview, setPreview] = useState<PptTemplate | null>(null);
  const [previewPage, setPreviewPage] = useState(0);
  const [upload, setUpload] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1);
  const [baseId, setBaseId] = useState(baseProjectId || '');
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [progressKind, setProgressKind] = useState<'prompt' | 'paste' | 'file'>('prompt');
  const [progressText, setProgressText] = useState('');
  const [progressFile, setProgressFile] = useState<File | null>(null);
  const [templateId, setTemplateId] = useState('violet');
  const [modelKey, setModelKey] = useState('');
  const [pages, setPages] = useState(10);
  const updateAttempt = useRef<{ payload: string; requestId: string } | null>(null);

  useEffect(() => { setBaseId(baseProjectId || ''); }, [baseProjectId]);
  useEffect(() => { if (models[0] && !modelKey) setModelKey(models[0].id); }, [models, modelKey]);
  async function refresh() {
    try { const result = await call<{ templates: PptTemplate[] }>('templates'); setTemplates(result.templates); }
    catch (cause) { setError((cause as Error).message); }
  }
  useEffect(() => { void refresh(); }, []);
  const visible = useMemo(() => templates.filter(item => (category === '全部' || item.category === category) &&
    `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [templates, query, category]);
  async function task(work: () => Promise<void>) { setBusy(true); setError(''); try { await work(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  async function uploadTemplate() {
    if (!upload) return;
    await task(async () => { await call('templates', 'POST', { fileName: upload.name, fileBase64: await toBase64(upload) }); setUpload(null); await refresh(); });
  }
  async function editTemplate(item: PptTemplate, action: 'pin' | 'delete') {
    await task(async () => {
      if (action === 'pin') await call(`templates/${item.id}`, 'PATCH', { pinned: !item.pinned });
      else { if (!window.confirm(t('ppt.m3.deleteTemplateConfirm'))) return; await call(`templates/${item.id}`, 'DELETE'); }
      await refresh();
    });
  }
  async function createUpdate() {
    const model = models.find(item => item.id === modelKey);
    if (!model) { setError(t('ppt.chooseModel')); return; }
    await task(async () => {
      const body: Record<string, unknown> = { template: templateId, pages, configId: model.configId, model: model.modelId,
        progressKind, progressText: progressKind === 'file' ? undefined : progressText };
      if (baseFile) { body.baseFileName = baseFile.name; body.baseFileBase64 = await toBase64(baseFile); }
      else body.baseProjectId = baseId;
      if (progressFile && progressKind === 'file') { body.progressFileName = progressFile.name; body.progressFileBase64 = await toBase64(progressFile); }
      const payload = JSON.stringify(body);
      if (updateAttempt.current?.payload !== payload) updateAttempt.current = { payload, requestId: crypto.randomUUID() };
      body.requestId = updateAttempt.current.requestId;
      const result = await call<{ project: PptProjectSummary }>('updates', 'POST', body);
      onCreated(result.project);
    });
  }
  const progressReady = progressKind === 'file' ? Boolean(progressFile) : Boolean(progressText.trim());
  const chosen = templates.find(item => item.id === templateId);

  return <section className="space-y-5">
    {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    {mode === 'templates' ? <>
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">{t('ppt.m3.templateCenter')}</h2><p className="text-sm text-muted-foreground">{t('ppt.m3.templateHelp')}</p></div>
        <div className="flex flex-wrap items-center gap-2"><input aria-label={t('ppt.m3.uploadTemplate')} type="file" accept=".pptx,.potx,.pdf" onChange={event => setUpload(event.target.files?.[0] || null)} /><button className={primary} disabled={!upload || busy} onClick={() => void uploadTemplate()}>{t('ppt.m3.uploadTemplate')}</button></div></div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><input className={field} aria-label={t('ppt.m3.searchTemplate')} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('ppt.m3.searchTemplate')} />
        <select className={field} aria-label={t('ppt.m3.category')} value={category} onChange={event => setCategory(event.target.value)}>{categories.map(item => <option key={item} value={item}>{t(`ppt.m3.category.${categoryKeys[item]}` as TranslationKey)}</option>)}</select></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map(item => <article key={item.id} className="space-y-3 rounded-xl border border-border bg-card p-4"><Preview item={item} /><div className="flex items-start justify-between gap-2"><div><h3 className="font-medium">{item.name}</h3><p className="text-xs text-muted-foreground">{item.category} · {item.pages} {t('ppt.pages')}</p></div>{item.pinned && <span>📌</span>}</div><p className="min-h-10 text-sm text-muted-foreground">{item.description}</p><p className="text-xs">{item.compatibility === 'mapped' ? t('ppt.m3.mapped') : t('ppt.m3.referenceOnly')}</p>{item.tags?.length > 0 && <p className="text-xs text-muted-foreground">{item.tags.join(' · ')}</p>}
        <div className="flex flex-wrap gap-2"><button className={button} onClick={() => { setPreview(item); setPreviewPage(0); }}>{t('ppt.m3.preview')}</button><button className={primary} disabled={item.compatibility !== 'mapped'} onClick={() => onUseTemplate(item.id, item)}>{t('ppt.m3.useTemplate')}</button><button className={button} onClick={() => void editTemplate(item, 'pin')}>{item.pinned ? t('ppt.unpin') : t('ppt.pin')}</button>{item.kind === 'uploaded' && <button className={button} onClick={() => void editTemplate(item, 'delete')}>{t('ppt.delete')}</button>}</div></article>)}</div>
    </> : <>
      <div><h2 className="text-lg font-semibold">{t('ppt.m3.update')}</h2><p className="text-sm text-muted-foreground">{t('ppt.m3.step')} {step}/3</p></div>
      {step === 1 && <div className="mx-auto max-w-3xl space-y-5 rounded-xl border border-border bg-card p-5"><h3 className="font-medium">{t('ppt.m3.baseAndProgress')}</h3><label className="block space-y-1 text-sm"><span>{t('ppt.m3.baseProject')}</span><select className={field} value={baseFile ? '' : baseId} onChange={event => { setBaseId(event.target.value); setBaseFile(null); }}><option value="">{t('ppt.m3.selectBase')}</option>{projects.filter(item => item.status === 'completed').map(item => <option key={item.id} value={item.id}>{item.title} · {item.pages} {t('ppt.pages')}</option>)}</select></label>
        <label className="block space-y-1 text-sm"><span>{t('ppt.m3.baseUpload')}</span><input type="file" accept=".pptx,.pdf,.docx,.xlsx" onChange={event => { const file = event.target.files?.[0] || null; setBaseFile(file); if (file) setBaseId(''); }} />{baseFile && <span className="block text-muted-foreground">{baseFile.name}</span>}</label>
        <div className="flex flex-wrap gap-2">{(['prompt', 'paste', 'file'] as const).map(kind => <button key={kind} className={progressKind === kind ? primary : button} onClick={() => setProgressKind(kind)}>{t(`ppt.input.${kind}`)}</button>)}</div>
        {progressKind === 'file' ? <input aria-label={t('ppt.m3.progressFile')} type="file" accept=".pptx,.pdf,.docx,.xlsx,.md,.markdown,.html,.htm" onChange={event => setProgressFile(event.target.files?.[0] || null)} /> : <textarea aria-label={t('ppt.m3.latestProgress')} className={`${field} min-h-40`} value={progressText} onChange={event => setProgressText(event.target.value)} maxLength={progressKind === 'paste' ? 80000 : 12000} placeholder={t('ppt.m3.progressHint')} />}
        <div className="flex justify-end"><button className={primary} disabled={(!baseId && !baseFile) || !progressReady} onClick={() => { setPages(Math.min(30, Math.max(6, (projects.find(item => item.id === baseId)?.pages || 8) + 2))); setStep(2); }}>{t('ppt.m3.next')}</button></div></div>}
      {step === 2 && <div className="space-y-4"><h3 className="font-medium">{t('ppt.m3.selectTemplate')}</h3><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{templates.filter(item => item.compatibility === 'mapped').map(item => <button key={item.id} className={`rounded-xl border p-3 text-left ${templateId === item.id ? 'border-primary' : 'border-border'}`} onClick={() => setTemplateId(item.id)}><Preview item={item} /><span className="mt-2 block font-medium">{item.name}</span></button>)}</div><div className="flex justify-between"><button className={button} onClick={() => setStep(1)}>{t('ppt.m3.previous')}</button><button className={primary} disabled={!chosen} onClick={() => setStep(3)}>{t('ppt.m3.next')}</button></div></div>}
      {step === 3 && <div className="grid gap-5 lg:grid-cols-2"><div className="space-y-4 rounded-xl border border-border bg-card p-5"><h3 className="font-medium">{t('ppt.m3.reviewUpdate')}</h3><p className="text-sm">{t('ppt.m3.baseProject')}: {baseFile?.name || projects.find(item => item.id === baseId)?.title}</p><p className="text-sm">{t('ppt.m3.latestProgress')}: {progressKind === 'file' ? progressFile?.name : progressText.slice(0, 250)}</p><label className="block space-y-1 text-sm"><span>{t('ppt.pages')}</span><input className={field} type="number" min={6} max={30} value={pages} onChange={event => setPages(Number(event.target.value))} /></label><label className="block space-y-1 text-sm"><span>{t('ppt.model')}</span><select className={field} value={modelKey} onChange={event => setModelKey(event.target.value)}>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="flex gap-2"><button className={button} onClick={() => setStep(2)}>{t('ppt.m3.previous')}</button><button className={primary} disabled={busy || !modelKey || pages < 6 || pages > 30} onClick={() => void createUpdate()}>{t('ppt.m3.createOutline')}</button></div></div>{chosen && <div className="space-y-3 rounded-xl border border-border bg-card p-5"><h3 className="font-medium">{chosen.name}</h3><Preview item={chosen} /><p className="text-sm text-muted-foreground">{chosen.description}</p></div>}</div>}
    </>}
    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-3xl space-y-4 rounded-xl bg-background p-5"><div className="flex justify-between"><div><h3 className="font-medium">{preview.name}</h3><p className="text-sm text-muted-foreground">{preview.category} · {preview.pages} {t('ppt.pages')}</p></div><button className={button} onClick={() => setPreview(null)}>{t('ppt.close')}</button></div><Preview item={preview} slide={previewPage} /><p className="text-sm text-muted-foreground">{preview.compatibility === 'mapped' ? t('ppt.m3.mapped') : t('ppt.m3.referenceOnly')}</p><div className="flex justify-center gap-3"><button className={button} disabled={previewPage === 0} onClick={() => setPreviewPage(page => page - 1)}>←</button><span className="self-center text-sm">{previewPage + 1}/{Math.max(1, preview.sampleTitles?.length || preview.pages)}</span><button className={button} disabled={previewPage >= Math.max(1, preview.sampleTitles?.length || preview.pages) - 1} onClick={() => setPreviewPage(page => page + 1)}>→</button></div></div></div>}
  </section>;
}
