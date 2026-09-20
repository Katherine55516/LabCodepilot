'use client';
/* eslint-disable @next/next/no-img-element -- pasted images are locally resized data URLs in the presentation IR */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { PptM3, type PptTemplate } from './PptM3';
import { BlockEditor, BlockPreview, prepareImage, type VisualBlock } from './PptBlocks';
import { PptGenerationMonitor } from './generation/PptGenerationMonitor';
import { StructuredPptEditor } from './editor/StructuredPptEditor';
import type { PptRenderTree, StructuredProjectView } from './types';

type LayoutId = 'cover' | 'summary' | 'big-number' | 'comparison' | 'chart' | 'table' | 'image-text' | 'timeline' | 'conclusion';
type Slide = { id: string; title: string; focus?: string; section?: string; refs?: string[]; bullets?: string[]; blocks?: VisualBlock[]; layoutId?: LayoutId; layout?: 'text-first' | 'visual-first'; sourceRefs?: string[]; baseSlideId?: string | null; change?: 'keep' | 'rewrite' | 'add' };
type PasteImage = Extract<VisualBlock, { type: 'image' }>;
type Source = { kind: 'paste' | 'file' | 'update'; name: string; text: string; segments: { id: string; origin?: string; location: string; text: string }[]; images?: PasteImage[]; truncated?: boolean; extension?: string; bytes?: number };
type ModelFinding = { slideIds: string[]; detail: string; bulletIndexes?: number[] };
type QualityReport = { status: 'passed' | 'passed_with_warnings' | 'blocked'; deterministic: { issues: { code: string; severity: string; message: string; slideId?: string | null }[]; hardErrors: number }; modelReview: { missing: ModelFinding[]; repeated: ModelFinding[]; conflicts: ModelFinding[]; unsupported: ModelFinding[] }; repairs: { code: string; slideId?: string; action: string }[] };
type Project = { id: string; title: string; prompt: string; pages: number; template: string; templateSpec?: { id: string; name: string; version: number; palette?: PptTemplate['palette']; fonts?: PptTemplate['fonts'] }; update?: { baseSnapshot: { title: string; deck?: { slides: Slide[] } | null } }; version?: { rootId: string; parentId: string | null; number: number }; diff?: { kept: number; rewritten: number; added: number; removed: { id: string; title: string }[] }; status: 'ingesting' | 'outlining' | 'outline_ready' | 'generating' | 'quality_blocked' | 'completed' | 'failed' | 'cancelled'; stage: string; error: string; outline: Slide[]; deck: { slides: Slide[]; deckId?: string; schemaVersion?: number } | null; nodes?: Record<string, { status: string }>; quality?: QualityReport; revision: number; draftRevision?: number; publishedRevision?: number; currentRunId?: string; renderTree?: PptRenderTree; sourceRevision?: number; source?: Source | null; inputKind?: string; favorite?: boolean; pinned?: boolean; folderId?: string | null; tags?: string[]; deletedAt?: string | null; createdAt: string; updatedAt: string };
type Folder = { id: string; name: string; count: number; pinned: boolean };
type Model = { id: string; name: string; configId: string; modelId: string };
type Dialog = { type: 'renameProject' | 'renameFolder' | 'createFolder' | 'move'; id?: string; value: string };
type Tab = 'recent' | 'all' | 'favorites' | 'trash';

async function api<T>(resource: 'projects' | 'folders' | 'templates' | 'updates', path = '', method = 'GET', payload?: unknown): Promise<T> {
  const response = await fetch(`/api/ppt/${resource}${path}`, { method, headers: payload === undefined ? undefined : { 'content-type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), cache: 'no-store' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status });
  }
  return response.json();
}
const input = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';
const primary = 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50';
const themes: Record<string, string> = { violet: 'bg-[#171b31] text-[#f5f6fc] border-t-[#967fff]', blue: 'bg-[#102b43] text-[#f5f6fc] border-t-[#55ade2]', light: 'bg-[#f8f9fc] text-[#242a3b] border-t-[#404b6b]' };
const layoutIds: LayoutId[] = ['cover', 'summary', 'big-number', 'comparison', 'chart', 'table', 'image-text', 'timeline', 'conclusion'];

function SlidePreview({ slide, template, palette, fonts, large = false }: { slide: Slide; template: string; palette?: PptTemplate['palette']; fonts?: PptTemplate['fonts']; large?: boolean }) {
  const layoutId = slide.layoutId || ((slide.blocks || []).length ? 'image-text' : 'summary');
  const titleStyle = { fontFamily: fonts?.titleEastAsia || fonts?.title };
  const bodyStyle = { fontFamily: fonts?.bodyEastAsia || fonts?.body };
  const bulletList = <ul className={`${large ? 'text-lg' : 'text-xs md:text-sm'} space-y-1 opacity-80`} style={bodyStyle}>{(slide.bullets || []).slice(0, 6).map((bullet, j) => <li key={j} className="line-clamp-2">• {bullet}</li>)}</ul>;
  const blocks = <BlockPreview blocks={slide.blocks || []} compact={!large} />;
  const body = layoutId === 'comparison'
    ? <div className="mt-4 grid grid-cols-2 gap-3">{(slide.bullets || []).slice(0, 6).map((bullet, j) => <div key={j} className="rounded border border-current/20 p-2 text-xs opacity-80" style={bodyStyle}>{bullet}</div>)}</div>
    : ['summary', 'conclusion'].includes(layoutId)
      ? <div className={`${large ? 'mt-8 gap-6' : 'mt-4 gap-2'} grid`}>{(slide.bullets || []).slice(0, 5).map((bullet, j) => <div key={j} className="grid grid-cols-[2rem_1fr] items-center gap-2" style={bodyStyle}><b className={palette ? '' : 'text-primary'} style={palette ? { color: palette.accent } : undefined}>{String(j + 1).padStart(2, '0')}</b><span className={`${large ? 'text-lg' : 'text-xs'} opacity-80`}>{bullet}</span></div>)}</div>
    : layoutId === 'timeline'
      ? <div className="mt-5 grid grid-cols-3 gap-2 border-t border-current/30 pt-3">{(slide.bullets || []).slice(0, 6).map((bullet, j) => <div key={j} className="text-xs opacity-80" style={bodyStyle}><b>{j + 1}</b><br />{bullet}</div>)}</div>
      : layoutId === 'big-number'
        ? <div className="mt-6 rounded-lg border border-current/20 p-4 text-center" style={bodyStyle}><strong className={`${large ? 'text-5xl' : 'text-3xl'} block`}>{slide.bullets?.[0] || '—'}</strong><span className="text-xs opacity-70">{slide.bullets?.[1]}</span></div>
        : layoutId === 'image-text'
          ? <div className="mt-4 grid grid-cols-2 gap-4"><div>{bulletList}</div><div>{blocks}</div></div>
          : ['chart', 'table'].includes(layoutId)
            ? <><div className="mt-3">{blocks}</div><div className="mt-2">{bulletList}</div></>
            : <div className={large ? 'mt-8' : 'mt-3'}>{bulletList}{blocks}</div>;
  return <div data-layout={layoutId} className={`aspect-video overflow-hidden rounded-lg border-t-4 p-[7%] ${palette ? '' : themes[template] || themes.violet} ${layoutId === 'cover' ? 'flex flex-col justify-center text-center' : ''}`}
    style={palette ? { background: palette.background, borderColor: palette.accent, color: palette.foreground } : undefined}>
    <h4 className={`${large ? 'text-2xl md:text-4xl' : 'text-lg md:text-xl'} line-clamp-2 font-bold`} style={titleStyle}>{slide.title}</h4>
    {layoutId !== 'cover' && body}
    {layoutId === 'cover' && slide.bullets?.[0] && <p className="mt-4 opacity-75" style={bodyStyle}>{slide.bullets[0]}</p>}
  </div>;
}

export function PptWorkspace() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [trashed, setTrashed] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [view, setView] = useState<'list' | 'create' | 'detail' | 'templates' | 'update'>('list');
  const [m3BaseId, setM3BaseId] = useState<string | null>(null);
  const [templateOptions, setTemplateOptions] = useState<PptTemplate[]>([]);
  const [versions, setVersions] = useState<{ id: string; title: string; number: number; status: string }[]>([]);
  const [previewPage, setPreviewPage] = useState(0);
  const [tab, setTab] = useState<Tab>('recent');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'updated' | 'created' | 'name'>('updated');
  const [statusFilter, setStatusFilter] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [checked, setChecked] = useState<string[]>([]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [modelKey, setModelKey] = useState('');
  const [inputKind, setInputKind] = useState<'prompt' | 'paste' | 'file'>('prompt');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [pasteImages, setPasteImages] = useState<PasteImage[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<'generate' | 'editable'>('generate');
  const [sourceDraft, setSourceDraft] = useState('');
  const [pages, setPages] = useState(10);
  const [template, setTemplate] = useState('violet');
  const [outline, setOutline] = useState<Slide[]>([]);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [dirty, setDirty] = useState(false);
  const [presentation, setPresentation] = useState<number | null>(null);
  const [editorSearch, setEditorSearch] = useState('');
  const [aiDraft, setAiDraft] = useState('');
  const [aiSlideId, setAiSlideId] = useState<string | null>(null);
  const undoHistory = useRef<Slide[][]>([]);
  const redoHistory = useRef<Slide[][]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [active, trash, folderResult] = await Promise.all([
        api<{ projects: Project[] }>('projects'), api<{ projects: Project[] }>('projects', '?trash=1'), api<{ folders: Folder[] }>('folders'),
      ]);
      setProjects(active.projects); setTrashed(trash.projects); setFolders(folderResult.folders);
      setChecked(prev => prev.filter(id => [...active.projects, ...trash.projects].some(project => project.id === id)));
      setError('');
    } catch (e) {
      if ((e as Error & { status?: number }).status === 401) { setProjects([]); setTrashed([]); setSelected(null); }
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const onFocus = () => { void refresh(); }; window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus); }, [refresh]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setView('list'); setTab('all'); setFolderId(null); setTimeout(() => searchRef.current?.focus(), 0); }
      if (presentation !== null) {
        if (event.key === 'Escape') setPresentation(null);
        if (event.key === 'ArrowRight') setPresentation(n => n === null ? null : Math.min(n + 1, slides.length - 1));
        if (event.key === 'ArrowLeft') setPresentation(n => n === null ? null : Math.max(n - 1, 0));
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [presentation, slides.length]);
  useEffect(() => { if (!dirty) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [dirty]);
  useEffect(() => {
    Promise.all([fetch('/api/providers').then(r => r.json()), fetch('/api/providers/models').then(r => r.json())]).then(([p, m]) => {
      const managed = new Map<string, { name: string }>((p.providers || []).filter((x: { source?: string }) => x.source === 'managed').map((x: { id: string; name: string }) => [x.id, x]));
      const rows: Model[] = (m.groups || []).flatMap((group: { provider_id: string; models?: { value: string; label?: string }[] }) => {
        const provider = managed.get(group.provider_id); if (!provider) return [];
        return (group.models || []).filter(model => model.value).map(model => ({ id: `${group.provider_id}::${model.value}`, name: `${provider.name} · ${model.label || model.value}`, configId: group.provider_id.replace(/^managed-/, ''), modelId: model.value }));
      });
      setModels(rows); if (rows[0]) setModelKey(rows[0].id);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    api<{ templates: PptTemplate[] }>('templates').then(result => setTemplateOptions(result.templates)).catch(() => {});
  }, []);
  const acceptStructuredProject = useCallback((value: StructuredProjectView) => {
    const project = value as Project; setSelected(project);
    if (project.status === 'outline_ready') { setOutline(project.outline.map(slide => ({ ...slide }))); setSourceDraft(project.source?.text || ''); }
    if (['completed', 'quality_blocked'].includes(project.status)) setSlides(structuredClone(project.deck?.slides || []));
    setProjects(current => current.map(item => item.id === project.id ? project : item));
  }, []);

  const visible = useMemo(() => {
    let rows = tab === 'trash' ? [...trashed] : [...projects];
    if (tab === 'favorites') rows = rows.filter(project => project.favorite);
    if (folderId && tab !== 'trash') rows = rows.filter(project => project.folderId === folderId);
    if (statusFilter && tab !== 'trash') rows = rows.filter(project => project.status === statusFilter);
    const q = query.trim().toLocaleLowerCase();
    if (q) rows = rows.filter(project => `${project.title} ${(project.tags || []).join(' ')}`.toLocaleLowerCase().includes(q));
    const comparator = sort === 'name' ? (a: Project, b: Project) => a.title.localeCompare(b.title) : sort === 'created' ? (a: Project, b: Project) => b.createdAt.localeCompare(a.createdAt) : (a: Project, b: Project) => b.updatedAt.localeCompare(a.updatedAt);
    rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || comparator(a, b));
    if (tab === 'recent') rows = rows.slice(0, 12);
    return rows;
  }, [projects, trashed, tab, folderId, statusFilter, query, sort]);

  async function openProject(project: Project) {
    if (dirty && !window.confirm(t('ppt.unsaved'))) return;
    try {
      const result = await api<{ project: Project }>('projects', `/${project.id}`);
      const fresh = result.project;
      setSelected(fresh); setTitle(fresh.title); setOutline(fresh.outline.map(s => ({ ...s })));
      setSlides(structuredClone(fresh.deck?.slides || [])); undoHistory.current = []; redoHistory.current = []; setEditorSearch(''); setAiSlideId(null);
      setSourceDraft(fresh.source?.text || ''); setDirty(false); setError(''); setView('detail');
      setPreviewPage(0);
      api<{ versions: { id: string; title: string; number: number; status: string }[] }>('projects', `/${fresh.id}/versions`)
        .then(result => setVersions(result.versions)).catch(() => setVersions([]));
    } catch (e) { setError((e as Error).message); }
  }
  function back() { if (dirty && !window.confirm(t('ppt.unsaved'))) return; setDirty(false); setView('list'); setSelected(null); void refresh(); }
  function changeSlides(next: Slide[]) {
    undoHistory.current = [...undoHistory.current.slice(-19), structuredClone(slides)];
    redoHistory.current = [];
    setSlides(next); setDirty(true);
  }
  function undo() { const previous = undoHistory.current.pop(); if (!previous) return; redoHistory.current.push(structuredClone(slides)); setSlides(previous); setDirty(true); }
  function redo() { const next = redoHistory.current.pop(); if (!next) return; undoHistory.current.push(structuredClone(slides)); setSlides(next); setDirty(true); }
  async function run(task: () => Promise<void>) { setBusy(true); setError(''); try { await task(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function addPasteImages(files: File[]) {
    const remaining = 4 - pasteImages.length;
    if (remaining <= 0) { setError(t('ppt.pasteImageLimit')); return; }
    const accepted = files.filter(file => file.type === 'image/png' || file.type === 'image/jpeg').slice(0, remaining);
    if (!accepted.length) return;
    await run(async () => {
      const prepared = await Promise.all(accepted.map(async (file): Promise<PasteImage> => ({
        id: crypto.randomUUID().replaceAll('-', '').slice(0, 32), type: 'image', dataUrl: await prepareImage(file), caption: file.name.replace(/\.(png|jpe?g)$/i, '').slice(0, 100),
      })));
      setPasteImages(current => [...current, ...prepared].slice(0, 4));
    });
  }
  async function addClipboardImages(data: DataTransfer) {
    const direct = [...data.items].filter(item => item.kind === 'file' && ['image/png', 'image/jpeg'].includes(item.type)).map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (direct.length) return addPasteImages(direct);
    const html = data.getData('text/html');
    if (!html) return;
    const urls = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img')]
      .map(image => image.getAttribute('src') || '').filter(url => /^data:image\/(png|jpeg);base64,/i.test(url)).slice(0, 4);
    if (!urls.length) return;
    const files = await Promise.all(urls.map(async (url, index) => new File([await (await fetch(url)).blob()], `pasted-image-${index + 1}.${url.startsWith('data:image/png') ? 'png' : 'jpg'}`, { type: url.startsWith('data:image/png') ? 'image/png' : 'image/jpeg' })));
    await addPasteImages(files);
  }
  async function create() {
    const editablePptx = inputKind === 'file' && file?.name.toLowerCase().endsWith('.pptx') && importMode === 'editable';
    const model = models.find(row => row.id === modelKey);
    if (!model && !editablePptx) return;
    await run(async () => {
      let fileBase64: string | undefined;
      if (inputKind === 'file' && file) {
        if (file.size > 8 * 1024 * 1024) throw new Error(t('ppt.fileTooLarge'));
        fileBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('file read failed')); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.readAsDataURL(file); });
      }
      const { project } = await api<{ project: Project }>('projects', '', 'POST', {
        inputKind, title: title.trim() || undefined, prompt: prompt.trim() || undefined,
        text: inputKind === 'paste' ? sourceText : undefined, fileName: inputKind === 'file' ? file?.name : undefined,
        images: inputKind === 'paste' ? pasteImages : undefined, fileBase64, importMode: inputKind === 'file' && file?.name.toLowerCase().endsWith('.pptx') ? importMode : undefined,
        pages, template, configId: model?.configId || 'pptx-import', model: model?.modelId || '',
      });
      setProjects(prev => [project, ...prev]); await openProject(project);
    });
  }
  async function mutate(path: string, method: string, payload?: unknown) {
    if (!selected) return false;
    let success = false;
    await run(async () => {
      const { project } = await api<{ project: Project }>('projects', `/${selected.id}${path}`, method, payload);
      setSelected(project); setProjects(prev => prev.map(row => row.id === project.id ? project : row));
      if (['completed', 'quality_blocked'].includes(project.status)) { setSlides(structuredClone(project.deck?.slides || [])); setDirty(false); }
      if (path === '/source') { setOutline([]); setSourceDraft(project.source?.text || ''); }
      success = true;
    });
    return success;
  }
  async function saveSlides() {
    if (!selected?.deck) return;
    await run(async () => {
      const changed = await api<{ project: Project }>('projects', `/${selected.id}/commands`, 'POST', {
        id: crypto.randomUUID().replaceAll('-', ''), type: 'deck.replace', baseRevision: selected.revision,
        payload: { deck: { ...selected.deck, slides } },
      });
      const published = await api<{ project: Project }>('projects', `/${selected.id}/publish`, 'POST');
      acceptStructuredProject(published.project || changed.project); setDirty(false); undoHistory.current = []; redoHistory.current = [];
    });
  }
  async function rewriteSlide(slideId: string, instruction: string, blockId?: string) {
    if (!selected) return;
    const previous = structuredClone(slides);
    if (await mutate('/rewrite', 'POST', { slideId, blockId, instruction, revision: selected.revision })) {
      undoHistory.current = [...undoHistory.current.slice(-19), previous];
      redoHistory.current = [];
      setAiDraft(''); setAiSlideId(null);
    }
  }
  async function action(project: Project, kind: string, payload?: unknown) {
    setMenuId(null);
    await run(async () => {
      if (kind === 'permanent') { if (!window.confirm(t('ppt.permanentConfirm'))) return; await api('projects', `/${project.id}/permanent`, 'DELETE'); }
      else if (kind === 'metadata') await api('projects', `/${project.id}`, 'PATCH', payload);
      else await api('projects', `/${project.id}/${kind}`, 'POST');
      await refresh();
    });
  }
  async function bulk(kind: string, targetFolder?: string | null) {
    if (!checked.length) return;
    if (kind === 'trash' && !window.confirm(t('ppt.deleteConfirm'))) return;
    if (kind === 'permanent' && !window.confirm(t('ppt.permanentConfirm'))) return;
    await run(async () => { await api('projects', '/bulk', 'POST', { action: kind, ids: checked, folderId: targetFolder }); setChecked([]); setDialog(null); await refresh(); });
  }
  async function submitDialog() {
    if (!dialog) return;
    await run(async () => {
      if (dialog.type === 'createFolder') await api('folders', '', 'POST', { name: dialog.value });
      if (dialog.type === 'renameFolder') await api('folders', `/${dialog.id}`, 'PATCH', { name: dialog.value });
      if (dialog.type === 'renameProject') await api('projects', `/${dialog.id}`, 'PATCH', { title: dialog.value });
      if (dialog.type === 'move') {
        if (checked.length) await api('projects', '/bulk', 'POST', { action: 'move', ids: checked, folderId: dialog.value || null });
        else if (dialog.id) await api('projects', `/${dialog.id}`, 'PATCH', { folderId: dialog.value || null });
        setChecked([]);
      }
      setDialog(null); await refresh();
    });
  }
  const sourceDirty = selected?.inputKind === 'paste' && sourceDraft !== (selected.source?.text || '');
  const hasIncompleteImage = slides.some(slide => slide.blocks?.some(block => block.type === 'image' && !block.dataUrl));

  return <main className="h-full overflow-y-auto bg-background p-6 text-foreground md:p-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">{t('ppt.title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('ppt.subtitle')}</p></div>
        <div className="flex flex-wrap gap-2">
          {view === 'list' ? <>
            <button className={button} onClick={() => setView('templates')}>{t('ppt.m3.templateCenter')}</button>
            <button className={button} onClick={() => { setM3BaseId(null); setView('update'); }}>{t('ppt.m3.update')}</button>
            <button className={primary} onClick={() => { setTitle(''); setPrompt(''); setSourceText(''); setPasteImages([]); setFile(null); setView('create'); }}>{t('ppt.new')}</button>
          </> : <button className={button} onClick={back}>{t('ppt.back')}</button>}
        </div>
      </header>
      {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {view === 'list' && <div className="grid gap-5 lg:grid-cols-[210px_1fr]">
        <nav aria-label={t('ppt.library')} className="space-y-2 rounded-xl border border-border bg-card p-3 lg:self-start">
          {(['recent', 'all', 'favorites', 'trash'] as Tab[]).map(item => <button key={item} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${tab === item && !folderId ? 'bg-accent font-medium' : 'hover:bg-accent/60'}`} onClick={() => { setTab(item); setFolderId(null); setChecked([]); }}>{t(`ppt.tab.${item}` as TranslationKey)}{item === 'trash' ? ` (${trashed.length})` : ''}</button>)}
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3"><span className="px-3 text-xs font-medium uppercase text-muted-foreground">{t('ppt.folders')}</span><button aria-label={t('ppt.folderCreate')} className="px-2 text-lg" onClick={() => setDialog({ type: 'createFolder', value: '' })}>+</button></div>
          {folders.map(folder => <div key={folder.id} className={`relative flex items-center rounded-lg ${folderId === folder.id ? 'bg-accent' : 'hover:bg-accent/60'}`}><button className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm" onClick={() => { setTab('all'); setFolderId(folder.id); setChecked([]); }}>{folder.pinned ? '📌 ' : ''}{folder.name} ({folder.count})</button><button className="px-2 text-xs" aria-label={`${t('ppt.folderMenu')} ${folder.name}`} onClick={() => setMenuId(menuId === folder.id ? null : folder.id)}>⋯</button>{menuId === folder.id && <div className="absolute right-0 top-full z-30 min-w-32 rounded-lg border border-border bg-popover p-2 shadow-lg"><button className="block p-1 text-sm" onClick={() => { setDialog({ type: 'renameFolder', id: folder.id, value: folder.name }); setMenuId(null); }}>{t('ppt.rename')}</button><button className="block p-1 text-sm" onClick={() => { setMenuId(null); void run(async () => { await api('folders', `/${folder.id}`, 'PATCH', { pinned: !folder.pinned }); await refresh(); }); }}>{folder.pinned ? t('ppt.unpin') : t('ppt.pin')}</button><button className="block p-1 text-sm" onClick={() => { setMenuId(null); if (window.confirm(t('ppt.folderDeleteConfirm'))) void run(async () => { await api('folders', `/${folder.id}`, 'DELETE'); setFolderId(null); await refresh(); }); }}>{t('ppt.delete')}</button></div>}</div>)}
        </nav>
        <section className="min-w-0 space-y-4"><div className="sticky top-0 z-10 space-y-3 rounded-xl border border-border bg-background p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">{folderId ? folders.find(f => f.id === folderId)?.name : t(`ppt.tab.${tab}` as TranslationKey)} · {visible.length}</h2><div className="flex gap-2">{tab === 'trash' && trashed.length > 0 && <button className={button} disabled={busy} onClick={() => { if (window.confirm(t('ppt.clearTrashConfirm'))) void run(async () => { for (let i = 0; i < trashed.length; i += 100) await api('projects', '/bulk', 'POST', { action: 'permanent', ids: trashed.slice(i, i + 100).map(p => p.id) }); await refresh(); }); }}>{t('ppt.clearTrash')}</button>}<button className={button} onClick={() => setLayout(layout === 'grid' ? 'list' : 'grid')}>{layout === 'grid' ? t('ppt.listView') : t('ppt.gridView')}</button></div></div><div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"><input ref={searchRef} className={input} value={query} onChange={e => setQuery(e.target.value)} placeholder={t('ppt.search')} aria-label={t('ppt.search')} /><select className={input} value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label={t('ppt.sort')}><option value="updated">{t('ppt.sortUpdated')}</option><option value="created">{t('ppt.sortCreated')}</option><option value="name">{t('ppt.sortName')}</option></select><select className={input} value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label={t('ppt.filterStatus')}><option value="">{t('ppt.allStatus')}</option><option value="completed">{t('ppt.status.completed')}</option><option value="generating">{t('ppt.status.generating')}</option><option value="quality_blocked">{t('ppt.status.quality_blocked')}</option><option value="failed">{t('ppt.status.failed')}</option></select></div></div>
          {loading ? <p>{t('ppt.loading')}</p> : visible.length === 0 ? <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">{t('ppt.empty')}</div> : <div className={layout === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-3'}>{visible.map(project => <article key={project.id} className={`relative rounded-xl border border-border bg-card p-4 ${layout === 'list' ? 'flex items-center gap-4' : ''}`}><input type="checkbox" className="h-4 w-4 shrink-0" checked={checked.includes(project.id)} aria-label={`${t('ppt.select')} ${project.title}`} onChange={e => setChecked(prev => e.target.checked ? [...prev, project.id] : prev.filter(id => id !== project.id))} /> <button className={`min-w-0 text-left ${layout === 'list' ? 'flex flex-1 items-center gap-4' : 'mt-2 block w-full'}`} onClick={() => { if (tab !== 'trash') void openProject(project); }}><div className={`${layout === 'list' ? 'h-16 w-28 shrink-0' : 'mb-3 aspect-video'} flex items-center rounded-lg border-t-4 p-3 ${project.templateSpec?.palette ? '' : themes[project.template] || themes.violet}`} style={project.templateSpec?.palette ? { background: project.templateSpec.palette.background, borderColor: project.templateSpec.palette.accent, color: project.templateSpec.palette.foreground } : undefined}><span className="line-clamp-2 text-sm font-semibold">{project.deck?.slides[0]?.title || project.outline[0]?.title || project.title}</span></div><div className="min-w-0"><h3 className="truncate font-medium">{project.pinned ? '📌 ' : ''}{project.title}</h3><p className="mt-1 text-xs text-muted-foreground">{project.pages} {t('ppt.pages')} · {t(`ppt.status.${project.status}` as TranslationKey)}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(project.deletedAt || project.updatedAt).toLocaleString()}</p>{(project.tags || []).length > 0 && <p className="mt-1 truncate text-xs text-muted-foreground">{project.tags?.join(' · ')}</p>}</div></button><div className="mt-2 flex shrink-0 flex-wrap gap-1">{tab === 'trash' ? <><button className={button} onClick={() => void action(project, 'restore')}>{t('ppt.restore')}</button><button className={button} onClick={() => void action(project, 'permanent')}>{t('ppt.permanent')}</button></> : <><button className={button} aria-label={`${t('ppt.favorite')} ${project.title}`} onClick={() => void action(project, 'metadata', { favorite: !project.favorite })}>{project.favorite ? '★' : '☆'}</button><button className={button} aria-label={`${t('ppt.pin')} ${project.title}`} onClick={() => void action(project, 'metadata', { pinned: !project.pinned })}>{project.pinned ? '📌' : '📍'}</button><button className={button} onClick={() => setMenuId(menuId === project.id ? null : project.id)}>{t('ppt.more')}</button>{menuId === project.id && <div className="absolute right-3 top-14 z-20 grid min-w-36 gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg"><button className="text-left text-sm" onClick={() => { setDialog({ type: 'renameProject', id: project.id, value: project.title }); setMenuId(null); }}>{t('ppt.rename')}</button><button className="text-left text-sm" onClick={() => void action(project, 'duplicate')}>{t('ppt.duplicate')}</button><button className="text-left text-sm" onClick={() => { setDialog({ type: 'move', id: project.id, value: project.folderId || '' }); setMenuId(null); }}>{t('ppt.move')}</button><button className="text-left text-sm" onClick={() => { setMenuId(null); if (window.confirm(t('ppt.deleteConfirm'))) void action(project, 'trash'); }}>{t('ppt.delete')}</button></div>}</>}</div></article>)}</div>}
        </section>
      </div>}
      {(view === 'templates' || view === 'update') && <PptM3 mode={view} projects={projects} models={models}
        baseProjectId={m3BaseId} onUseTemplate={(id, item) => { setTemplate(id); setTemplateOptions(prev => [...prev.filter(row => row.id !== id), item]); setTitle(''); setPrompt(''); setView('create'); }}
        onCreated={project => { void refresh(); void openProject(project as Project); }} />}
      {view === 'create' && <section className="mx-auto max-w-3xl space-y-5 rounded-xl border border-border bg-card p-6"><h2 className="text-lg font-medium">{t('ppt.create')}</h2><div className="flex flex-wrap gap-2">{(['prompt', 'paste', 'file'] as const).map(kind => <button key={kind} className={inputKind === kind ? primary : button} onClick={() => setInputKind(kind)}>{t(`ppt.input.${kind}` as TranslationKey)}</button>)}</div><label className="block space-y-1 text-sm"><span>{t('ppt.filename')}</span><input className={input} value={title} onChange={e => setTitle(e.target.value)} maxLength={160} /></label>{inputKind === 'prompt' && <label className="block space-y-1 text-sm"><span>{t('ppt.prompt')}</span><textarea className={`${input} min-h-32 resize-y`} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={12000} placeholder={t('ppt.promptHint')} /></label>}{inputKind === 'paste' && <div className="space-y-3"><label className="block space-y-1 text-sm"><span>{t('ppt.pasteText')}</span><textarea className={`${input} min-h-64 resize-y`} value={sourceText} onChange={e => setSourceText(e.target.value)} onPaste={event => void addClipboardImages(event.clipboardData)} maxLength={80000} placeholder={t('ppt.pasteHint')} /></label><div className="rounded-lg border border-dashed border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">{t('ppt.pasteImages')}</p><p className="text-xs text-muted-foreground">{t('ppt.pasteImagesHint')}</p></div><label className={button}><span>{t('ppt.addImages')}</span><input className="sr-only" type="file" accept="image/png,image/jpeg" multiple disabled={busy || pasteImages.length >= 4} onChange={event => { if (event.target.files) void addPasteImages([...event.target.files]); event.target.value = ''; }} /></label></div>{pasteImages.length > 0 && <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{pasteImages.map(image => <figure key={image.id} className="relative rounded-lg border border-border bg-muted p-2"><img src={image.dataUrl} alt={image.caption || t('ppt.m4.image')} className="h-24 w-full rounded object-contain" /><figcaption className="mt-1 truncate text-xs">{image.caption}</figcaption><button type="button" aria-label={`${t('ppt.delete')} ${image.caption}`} className="absolute right-1 top-1 rounded bg-background/90 px-2 py-1 text-xs" onClick={() => setPasteImages(current => current.filter(item => item.id !== image.id))}>×</button></figure>)}</div>}</div></div>}{inputKind === 'file' && <div className="rounded-lg border border-dashed border-border p-6" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); setFile(e.dataTransfer.files[0] || null); }}><label className="block space-y-2 text-sm"><span>{t('ppt.importFile')}</span><input type="file" accept=".md,.markdown,.html,.htm,.docx,.pdf,.xlsx,.pptx" onChange={e => setFile(e.target.files?.[0] || null)} /></label><p className="mt-2 text-xs text-muted-foreground">{file?.name || t('ppt.formats')}</p>{file?.name.toLowerCase().endsWith('.pptx') && <select aria-label={t('ppt.importMode.label')} className={`${input} mt-3`} value={importMode} onChange={e => setImportMode(e.target.value as 'generate' | 'editable')}><option value="generate">{t('ppt.importMode.generate')}</option><option value="editable">{t('ppt.importMode.editable')}</option></select>}</div>}{!(inputKind === 'file' && file?.name.toLowerCase().endsWith('.pptx') && importMode === 'editable') && <div className="grid gap-4 sm:grid-cols-3"><label className="space-y-1 text-sm"><span>{t('ppt.pages')}</span><input className={input} type="number" min={3} max={50} value={pages} onChange={e => setPages(Number(e.target.value))} /></label><label className="space-y-1 text-sm"><span>{t('ppt.template')}</span><select className={input} value={template} onChange={e => setTemplate(e.target.value)}>{(templateOptions.length ? templateOptions : [{ id: 'violet', name: 'Violet', compatibility: 'mapped' }, { id: 'blue', name: 'Blue', compatibility: 'mapped' }, { id: 'light', name: 'Light', compatibility: 'mapped' }]).filter(item => item.compatibility === 'mapped').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="space-y-1 text-sm"><span>{t('ppt.model')}</span><select className={input} value={modelKey} onChange={e => setModelKey(e.target.value)}><option value="">{t('ppt.chooseModel')}</option>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label></div>}<button className={primary} disabled={busy || (!(inputKind === 'file' && file?.name.toLowerCase().endsWith('.pptx') && importMode === 'editable') && (!modelKey || pages < 3 || pages > 50)) || (inputKind === 'prompt' ? !prompt.trim() : inputKind === 'paste' ? !sourceText.trim() : !file)} onClick={() => void create()}>{busy ? t('ppt.loading') : t(inputKind === 'file' && file?.name.toLowerCase().endsWith('.pptx') && importMode === 'editable' ? 'ppt.importMode.open' : 'ppt.makeOutline')}</button></section>}
      {view === 'detail' && selected && <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"><div><h2 className="font-medium">{selected.title}</h2><p className="text-sm text-muted-foreground">{t(`ppt.status.${selected.status}` as TranslationKey)} · {selected.pages} {t('ppt.pages')}</p></div>{selected.status === 'completed' && <div className="flex flex-wrap gap-2"><button className={button} onClick={() => { setM3BaseId(selected.id); setView('update'); }}>{t('ppt.m3.update')}</button><button className={button} onClick={() => setPresentation(0)}>{t('ppt.present')}</button><a className={button} href={`/api/ppt/projects/${selected.id}/pdf`} download>{t('ppt.exportPdf')}</a><a className={primary} href={`/api/ppt/projects/${selected.id}/export`} download>{t('ppt.export')}</a></div>}</div>
        {(selected.update || versions.length > 1) && <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="font-medium">{t('ppt.m3.versions')}</h3>
          {versions.length > 1 && <div className="flex flex-wrap gap-2">{versions.map(version => <button key={version.id} className={version.id === selected.id ? primary : button} onClick={() => void openProject({ id: version.id } as Project)}>{version.title} · v{version.number}</button>)}</div>}
          {selected.diff && <p className="text-sm text-muted-foreground">{t('ppt.m3.keep')} {selected.diff.kept} · {t('ppt.m3.rewrite')} {selected.diff.rewritten} · {t('ppt.m3.add')} {selected.diff.added} · {t('ppt.m3.removed')} {selected.diff.removed.map(item => item.title).join(', ') || '0'}</p>}
          {selected.status === 'outline_ready' && selected.update && <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="max-w-xl"><SlidePreview slide={outline[previewPage] || outline[0] || { id: '1', title: selected.title }} template={selected.template} palette={selected.templateSpec?.palette} fonts={selected.templateSpec?.fonts} /></div>
            <div className="flex items-center gap-2"><button className={button} disabled={previewPage === 0} onClick={() => setPreviewPage(page => page - 1)}>←</button><span className="text-sm">{previewPage + 1}/{outline.length}</span><button className={button} disabled={previewPage >= outline.length - 1} onClick={() => setPreviewPage(page => page + 1)}>→</button></div>
          </div>}
        </div>}
        {['ingesting', 'outlining', 'generating'].includes(selected.status) && <PptGenerationMonitor project={selected} onProject={acceptStructuredProject} />}{selected.status === 'failed' && <div className="rounded-xl border border-destructive/40 p-5"><p className="mb-3 text-destructive">{selected.error}</p><button className={button} disabled={busy} onClick={() => void mutate('/retry', 'POST')}>{t('ppt.retry')}</button></div>}{selected.status === 'outline_ready' && <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><div className="space-y-3 rounded-xl border border-border p-4"><h3 className="font-medium">{t('ppt.sourcePreview')}</h3>{selected.inputKind === 'paste' ? <><textarea className={`${input} min-h-72`} value={sourceDraft} onChange={e => setSourceDraft(e.target.value)} /><button className={button} disabled={busy || !sourceDirty} onClick={() => void mutate('/source', 'PATCH', { text: sourceDraft, sourceRevision: selected.sourceRevision })}>{t('ppt.reread')}</button>{sourceDirty && <p className="text-xs text-destructive">{t('ppt.sourceChanged')}</p>}{Boolean(selected.source?.images?.length) && <div><p className="mb-2 text-xs font-medium text-muted-foreground">{t('ppt.pasteImages')} · {selected.source?.images?.length}</p><div className="grid grid-cols-2 gap-2">{selected.source?.images?.map(image => <img key={image.id} src={image.dataUrl} alt={image.caption || t('ppt.m4.image')} className="h-28 w-full rounded border border-border object-contain" />)}</div></div>}</> : selected.source ? <div className="max-h-[36rem] space-y-2 overflow-y-auto text-sm">{selected.source.segments.map(segment => <div key={segment.id} className="rounded-lg bg-muted p-3"><b>[{segment.id}] {segment.location}</b><p className="mt-1 whitespace-pre-wrap">{segment.text}</p></div>)}</div> : <p className="text-sm text-muted-foreground">{selected.prompt}</p>}{selected.source?.truncated && <p className="text-xs text-destructive">{t('ppt.sourceTruncated')}</p>}</div><div className="space-y-3 rounded-xl border border-border p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{t('ppt.outline')}</h3><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => { if (window.confirm(t('ppt.reorganizeConfirm'))) void mutate('/outline', 'POST'); }}>{t('ppt.reorganize')}</button><button className={primary} disabled={busy || sourceDirty || outline.length < (selected.update ? 6 : 3) || outline.length > (selected.update ? 30 : 50)} onClick={async () => { if (await mutate('/outline', 'PATCH', { slides: outline })) await mutate('/generate', 'POST'); }}>{t('ppt.confirmGenerate')}</button></div></div><div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">{outline.map((slide, i) => <div key={slide.id} className="rounded-lg border border-border bg-card p-3"><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>{i + 1} / {outline.length} {slide.refs?.length ? `· ${t('ppt.references')}: ${slide.refs.join(', ')}` : ''}</span><button disabled={outline.length <= (selected.update ? 6 : 3)} onClick={() => setOutline(prev => prev.filter((_, j) => j !== i))}>{t('ppt.delete')}</button></div>
          {selected.update && <div className="mb-2 grid gap-2 sm:grid-cols-2"><select className={input} aria-label={`${t('ppt.m3.baseSlide')} ${i + 1}`} value={slide.baseSlideId || ''} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, baseSlideId: e.target.value || null, change: e.target.value ? 'rewrite' : 'add' } : x))}><option value="">{t('ppt.m3.newSlide')}</option>{(selected.update?.baseSnapshot.deck?.slides || []).map(base => <option key={base.id} value={base.id}>{base.title}</option>)}</select><select className={input} aria-label={`${t('ppt.m3.change')} ${i + 1}`} value={slide.change || 'add'} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, change: e.target.value as Slide['change'], baseSlideId: e.target.value === 'add' ? null : x.baseSlideId } : x))}><option value="keep" disabled={!slide.baseSlideId}>{t('ppt.m3.keep')}</option><option value="rewrite" disabled={!slide.baseSlideId}>{t('ppt.m3.rewrite')}</option><option value="add">{t('ppt.m3.add')}</option></select></div>}
          <input aria-label={`${t('ppt.section')} ${i + 1}`} className={`${input} mb-2`} value={slide.section || ''} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, section: e.target.value } : x))}/><input aria-label={`${t('ppt.slideTitle')} ${i + 1}`} className={`${input} mb-2`} value={slide.title} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}/><textarea aria-label={`${t('ppt.focus')} ${i + 1}`} className={input} value={slide.focus || ''} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, focus: e.target.value } : x))}/></div>)}</div><button className={button} disabled={outline.length >= (selected.update ? 30 : 50)} onClick={() => setOutline(prev => [...prev, { id: crypto.randomUUID().replaceAll('-', ''), section: t('ppt.newSection'), title: t('ppt.newSlide'), focus: '' }])}>{t('ppt.addSlide')}</button></div></div>}{['completed', 'quality_blocked'].includes(selected.status) && <div className="space-y-4">{selected.renderTree && <StructuredPptEditor project={selected} onProject={acceptStructuredProject} />}{selected.quality && <section data-testid="ppt-quality-report" className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{t('ppt.quality.title')}</h3><span className={`rounded-full px-2 py-1 text-xs ${selected.quality.status === 'passed' ? 'bg-primary/10 text-primary' : 'bg-muted text-foreground'}`}>{t(`ppt.quality.${selected.quality.status}` as TranslationKey)}</span></div><div className="mt-3 grid gap-3 text-sm sm:grid-cols-3"><div><b>{t('ppt.quality.automatic')}</b><p className="text-muted-foreground">{selected.quality.deterministic.issues.length} {t('ppt.quality.findings')} · {selected.quality.deterministic.hardErrors} {t('ppt.quality.errors')}</p></div><div><b>{t('ppt.quality.review')}</b><p className="text-muted-foreground">{Object.values(selected.quality.modelReview).reduce((sum, findings) => sum + findings.length, 0)} {t('ppt.quality.findings')}</p></div><div><b>{t('ppt.quality.repairs')}</b><p className="text-muted-foreground">{selected.quality.repairs.length}</p></div></div>{selected.templateSpec?.fonts && <p className="mt-3 text-xs text-muted-foreground">{t('ppt.quality.templateFonts')}: {selected.templateSpec.fonts.titleEastAsia || selected.templateSpec.fonts.title} / {selected.templateSpec.fonts.bodyEastAsia || selected.templateSpec.fonts.body}</p>}</section>}{selected.status === 'quality_blocked' && <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"><p>{t('ppt.quality.blockedHelp')}</p>{selected.error && <p className="mt-1 text-xs">{selected.error}</p>}</div>}<label className="block max-w-xl space-y-1 text-sm"><span>{t('ppt.filename')}</span><input className={input} value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title.trim() !== selected.title) void mutate('', 'PATCH', { title }); }}/></label><label className="block max-w-xl space-y-1 text-sm"><span>{t('ppt.tags')}</span><input className={input} defaultValue={(selected.tags || []).join(', ')} onBlur={e => { const tags = e.target.value.split(',').map(s => s.trim()).filter(Boolean); if (tags.join(',') !== (selected.tags || []).join(',')) void mutate('', 'PATCH', { tags }); }} placeholder={t('ppt.tagsHint')} /></label><div className="flex justify-between gap-2"><h3 className="font-medium">{t('ppt.edit')}</h3><div className="flex gap-2"><button className={button} disabled={busy || slides.length >= 50} onClick={() => changeSlides([...slides, { id: crypto.randomUUID().replaceAll('-', ''), title: t('ppt.newSlide'), bullets: [], blocks: [] }])}>{t('ppt.addSlide')}</button><button className={primary} disabled={busy || !dirty || hasIncompleteImage} title={hasIncompleteImage ? t('ppt.m4.uploadImage') : undefined} onClick={() => void saveSlides()}>{t('ppt.save')}</button></div></div><div className="flex flex-wrap items-center gap-2"><button className={button} disabled={!undoHistory.current.length} onClick={undo}>{t('ppt.m4.undo')}</button><button className={button} disabled={!redoHistory.current.length} onClick={redo}>{t('ppt.m4.redo')}</button><input className={`${input} max-w-xs`} aria-label={t('ppt.m4.searchSlides')} placeholder={t('ppt.m4.searchSlides')} value={editorSearch} onChange={e => setEditorSearch(e.target.value)} /><label className="flex items-center gap-2 text-sm"><span>{t('ppt.m4.switchTemplate')}</span><select className={input} value={selected.template} disabled={busy || dirty} onChange={e => void mutate('', 'PATCH', { template: e.target.value, revision: selected.revision })}>{templateOptions.filter(item => item.compatibility === 'mapped').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="grid gap-4 lg:grid-cols-2">{slides.filter(slide => `${slide.title} ${(slide.bullets || []).join(' ')}`.toLocaleLowerCase().includes(editorSearch.toLocaleLowerCase())).map((slide, i) => <div key={slide.id} className="rounded-xl border border-border bg-card p-4"><p className="mb-2 text-xs text-muted-foreground">{t('ppt.slide')} {i + 1}{slide.sourceRefs?.length ? ` · ${t('ppt.references')}: ${slide.sourceRefs.join(', ')}` : ''}</p><SlidePreview slide={slide} template={selected.template} palette={selected.templateSpec?.palette} fonts={selected.templateSpec?.fonts}/><input aria-label={`${t('ppt.slideTitle')} ${i + 1}`} className={`${input} my-3 font-medium`} value={slide.title} onChange={e => changeSlides(slides.map(x => x.id === slide.id ? { ...x, title: e.target.value } : x))}/><textarea aria-label={`${t('ppt.bullets')} ${i + 1}`} className={`${input} min-h-36`} value={(slide.bullets || []).join('\n')} onChange={e => changeSlides(slides.map(x => x.id === slide.id ? { ...x, bullets: e.target.value.split('\n').filter(Boolean) } : x))}/><p className="mt-2 text-xs text-muted-foreground">{t('ppt.bulletHint')}</p><BlockEditor blocks={slide.blocks} onChange={blocks => changeSlides(slides.map(item => item.id === slide.id ? { ...item, blocks } : item))} canRewrite={!busy && !dirty && aiSlideId === slide.id && Boolean(aiDraft.trim())} onRewrite={blockId => void rewriteSlide(slide.id, aiDraft, blockId)} /><label className="mt-2 block space-y-1 text-xs"><span>{t('ppt.m4.layout')}</span><select className={input} value={slide.layoutId || 'summary'} onChange={e => changeSlides(slides.map(item => item.id === slide.id ? { ...item, layoutId: e.target.value as LayoutId } : item))}>{layoutIds.map(layoutId => <option key={layoutId} value={layoutId}>{t(`ppt.layout.${layoutId}` as TranslationKey)}</option>)}</select></label><div className="mt-3 flex gap-2"><input className={input} aria-label={`${t('ppt.m4.aiInstruction')} ${slide.title}`} placeholder={t('ppt.m4.aiInstruction')} value={aiSlideId === slide.id ? aiDraft : ''} onChange={e => { setAiSlideId(slide.id); setAiDraft(e.target.value); }} /><button className={button} disabled={busy || dirty || aiSlideId !== slide.id || !aiDraft.trim()} onClick={() => void rewriteSlide(slide.id, aiDraft)}>{t('ppt.m4.aiRewrite')}</button></div></div>)}</div></div>}</section>}
    </div>
    {checked.length > 0 && view === 'list' && <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-xl border border-border bg-popover p-3 shadow-xl"><span className="whitespace-nowrap text-sm">{checked.length} {t('ppt.selected')}</span>{tab === 'trash' ? <><button className={button} onClick={() => void bulk('restore')}>{t('ppt.restore')}</button><button className={button} onClick={() => void bulk('permanent')}>{t('ppt.permanent')}</button></> : <><button className={button} onClick={() => setDialog({ type: 'move', value: '' })}>{t('ppt.move')}</button><button className={button} onClick={() => void bulk('trash')}>{t('ppt.delete')}</button></>}<button className={button} onClick={() => setChecked([])}>{t('ppt.cancel')}</button></div>}
    {dialog && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"><form role="dialog" aria-modal="true" className="w-full max-w-md space-y-4 rounded-xl border border-border bg-background p-6" onSubmit={e => { e.preventDefault(); void submitDialog(); }}><h2 className="text-lg font-medium">{t(`ppt.dialog.${dialog.type}` as TranslationKey)}</h2>{dialog.type === 'move' ? <select className={input} value={dialog.value} onChange={e => setDialog({ ...dialog, value: e.target.value })}><option value="">{t('ppt.ungrouped')}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select> : <input autoFocus className={input} value={dialog.value} onChange={e => setDialog({ ...dialog, value: e.target.value })} maxLength={dialog.type === 'renameProject' ? 160 : 80}/>}<div className="flex justify-end gap-2"><button type="button" className={button} onClick={() => setDialog(null)}>{t('ppt.cancel')}</button><button className={primary} disabled={busy || (dialog.type !== 'move' && !dialog.value.trim())}>{t('ppt.confirm')}</button></div></form></div>}
    {presentation !== null && slides[presentation] && selected && <div className="fixed inset-0 z-50 flex flex-col bg-background p-4"><div className="mb-3 flex items-center justify-between"><span className="text-sm">{selected.title} · {presentation + 1}/{slides.length}</span><button className={button} onClick={() => setPresentation(null)}>{t('ppt.close')}</button></div><div className="m-auto w-full max-w-6xl"><SlidePreview slide={slides[presentation]} template={selected.template} palette={selected.templateSpec?.palette} fonts={selected.templateSpec?.fonts} large/></div><div className="flex justify-center gap-4"><button className={button} disabled={presentation === 0} onClick={() => setPresentation(n => n === null ? null : n - 1)}>←</button><button className={button} disabled={presentation === slides.length - 1} onClick={() => setPresentation(n => n === null ? null : n + 1)}>→</button></div></div>}
  </main>;
}
