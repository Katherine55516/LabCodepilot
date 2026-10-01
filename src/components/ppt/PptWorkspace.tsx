'use client';
/* eslint-disable @next/next/no-img-element -- pasted images are locally resized data URLs in the presentation IR */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { PptM3 } from './PptM3';
import { BlockEditor, BlockPreview, prepareImage, type VisualBlock } from './PptBlocks';
import { GenerationEditDialog } from './generation/GenerationEditDialog';
import { PptGenerationMonitor } from './generation/PptGenerationMonitor';
import { StructuredPptEditor } from './editor/StructuredPptEditor';
import { PptCreateWizard, type CreateEntry, type PptCreateDraft } from './create/PptCreateWizard';
import { PptTaskCenter } from './workspace/PptTaskCenter';
import { PptWorkspaceRail, type WorkspaceFolder } from './workspace/PptWorkspaceRail';
import { PptConfirmDialog } from './workspace/PptConfirmDialog';
import { PptLlmGate, type PptLlmGateContext } from './workspace/PptLlmGate';
import { PptReportReadiness } from './workspace/PptReportReadiness';
import type { PptLayoutId as LayoutId, PptModel as Model, PptProject as Project, PptSlide as Slide, PptTemplate, StructuredProjectView } from './types';
import './ppt-prototype.css';

type PasteImage = Extract<VisualBlock, { type: 'image' }>;
type Folder = WorkspaceFolder;
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
const layoutIds: LayoutId[] = ['cover', 'summary', 'editorial', 'big-number', 'comparison', 'chart', 'table', 'image-text', 'timeline', 'conclusion'];

function SlidePreview({ slide, template, palette, fonts, large = false }: { slide: Slide; template: string; palette?: PptTemplate['palette']; fonts?: PptTemplate['fonts']; large?: boolean }) {
  const layoutId = slide.layoutId || ((slide.blocks || []).length ? 'image-text' : 'summary');
  const titleStyle = { fontFamily: fonts?.titleEastAsia || fonts?.title };
  const bodyStyle = { fontFamily: fonts?.bodyEastAsia || fonts?.body };
  const bulletList = <ul className={`${large ? 'text-lg' : 'text-xs md:text-sm'} space-y-1 opacity-80`} style={bodyStyle}>{(slide.bullets || []).slice(0, 6).map((bullet, j) => <li key={j} className="line-clamp-2">• {bullet}</li>)}</ul>;
  const blocks = <BlockPreview blocks={slide.blocks || []} compact={!large} />;
  const body = layoutId === 'comparison'
    ? <div className="mt-4 grid grid-cols-2 gap-3">{(slide.bullets || []).slice(0, 6).map((bullet, j) => <div key={j} className="rounded border border-current/20 p-2 text-xs opacity-80" style={bodyStyle}>{bullet}</div>)}</div>
    : ['summary', 'editorial', 'conclusion'].includes(layoutId)
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [generationEditOpen, setGenerationEditOpen] = useState(false);
  const [generationEdit, setGenerationEdit] = useState<{ projectId: string; slideId: string } | null>(null);
  const [view, setView] = useState<'list' | 'create' | 'detail' | 'templates' | 'tasks' | 'update'>('list');
  const [createChooserOpen, setCreateChooserOpen] = useState(false);
  const [createKind, setCreateKind] = useState<'prompt' | 'paste' | 'file' | undefined>();
  const [m3BaseId, setM3BaseId] = useState<string | null>(null);
  const [templateOptions, setTemplateOptions] = useState<PptTemplate[]>([]);
  const [versions, setVersions] = useState<{ id: string; title: string; number: number; status: string }[]>([]);
  const [previewPage, setPreviewPage] = useState(0);
  const [tab, setTab] = useState<Tab>('recent');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'updated' | 'created' | 'name' | 'manual'>('updated');
  const [statusFilter, setStatusFilter] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [checked, setChecked] = useState<string[]>([]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [confirmation, setConfirmation] = useState<{ title: string; message: string; action: () => void } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [flowModelKey, setFlowModelKey] = useState('');
  const [updateModelKey, setUpdateModelKey] = useState('');
  const [createEntry, setCreateEntry] = useState<CreateEntry>('new');
  const [lockedTemplate, setLockedTemplate] = useState<PptTemplate | null>(null);
  const [llmGate, setLlmGate] = useState<PptLlmGateContext | null>(null);
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
      const managed = new Map<string, { name: string; configId: string }>((p.providers || [])
        .filter((x: { source?: string }) => x.source === 'managed')
        .map((x: { id: string; name: string; managed_config_id?: string }) => [x.id, {
          name: x.name,
          // managed_config_id is the account backend's canonical credential lookup key.
          // Older local records lacked it, so preserve the old ID convention as a fallback.
          configId: x.managed_config_id || x.id.replace(/^managed-/, ''),
        }]));
      const rows: Model[] = (m.groups || []).flatMap((group: { provider_id: string; models?: { value: string; label?: string }[] }) => {
        const provider = managed.get(group.provider_id); if (!provider) return [];
        return (group.models || []).filter(model => model.value).map(model => ({ id: `${group.provider_id}::${model.value}`, name: `${provider.name} · ${model.label || model.value}`, providerId: group.provider_id, configId: provider.configId, modelId: model.value }));
      });
      setModels(rows);
      // The LLM gate deliberately starts empty. A provider default must not bypass
      // the required, user-visible model confirmation before parsing begins.
    }).catch(() => {});
  }, []);
  useEffect(() => {
    api<{ templates: PptTemplate[] }>('templates').then(result => setTemplateOptions(result.templates)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!selected) return;
    try {
      const prefix = `ppt-generation-draft:${selected.id}:`;
      const key = Object.keys(sessionStorage).find(item => item.startsWith(prefix));
      if (key) setGenerationEdit({ projectId: selected.id, slideId: key.slice(prefix.length) });
    } catch {}
  }, [selected?.id]);
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
    const comparator = sort === 'name' ? (a: Project, b: Project) => a.title.localeCompare(b.title) : sort === 'created' ? (a: Project, b: Project) => b.createdAt.localeCompare(a.createdAt) : sort === 'manual' ? (a: Project, b: Project) => (a.manualOrder ?? Number.MAX_SAFE_INTEGER) - (b.manualOrder ?? Number.MAX_SAFE_INTEGER) || b.updatedAt.localeCompare(a.updatedAt) : (a: Project, b: Project) => b.updatedAt.localeCompare(a.updatedAt);
    rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || comparator(a, b));
    if (tab === 'recent') rows = rows.slice(0, 12);
    return rows;
  }, [projects, trashed, tab, folderId, statusFilter, query, sort]);

  function requestConfirm(title: string, message: string, action: () => void) { setConfirmation({ title, message, action }); }
  async function openProject(project: Project, discard = false) {
    if (dirty && !discard) { requestConfirm(t('ppt.unsaved'), t('ppt.unsaved'), () => { setDirty(false); void openProject(project, true); }); return; }
    try {
      const result = await api<{ project: Project }>('projects', `/${project.id}`);
      const fresh = result.project;
      setSelected(fresh); setTitle(fresh.title); setOutline(fresh.outline.map(s => ({ ...s })));
      setSlides(structuredClone(fresh.deck?.slides || [])); undoHistory.current = []; redoHistory.current = []; setEditorSearch(''); setAiSlideId(null);
      setSourceDraft(fresh.source?.text || ''); setDirty(false); setEditorOpen(false); setError(''); setView('detail');
      setPreviewPage(0);
      api<{ versions: { id: string; title: string; number: number; status: string }[] }>('projects', `/${fresh.id}/versions`)
        .then(result => setVersions(result.versions)).catch(() => setVersions([]));
    } catch (e) { setError((e as Error).message); }
  }
  function back(discard = false) { if (dirty && !discard) { requestConfirm(t('ppt.unsaved'), t('ppt.unsaved'), () => back(true)); return; } setDirty(false); setEditorOpen(false); setView('list'); setSelected(null); void refresh(); }
  function startNew() {
    setCreateEntry('new'); setLockedTemplate(null); setCreateKind(undefined); setFlowModelKey(''); setCreateChooserOpen(false); setLlmGate('new');
  }
  function startDirectImport() {
    setCreateEntry('direct'); setLockedTemplate(null); setCreateKind('file'); setFlowModelKey(''); setCreateChooserOpen(false); setView('create');
  }
  function startTemplate(templateValue: PptTemplate) {
    setCreateEntry('template'); setLockedTemplate(templateValue); setTemplate(templateValue.id); setTemplateOptions(current => [...current.filter(item => item.id !== templateValue.id), templateValue]); setCreateKind(undefined); setFlowModelKey(''); setCreateChooserOpen(false); setLlmGate('template');
  }
  function startUpdate(baseId: string | null = null) {
    setM3BaseId(baseId); setUpdateModelKey(''); setLlmGate('update');
  }
  function confirmLlmGate() {
    if (llmGate === 'update') { if (!updateModelKey) return; setLlmGate(null); setView('update'); return; }
    if (!flowModelKey) return;
    setLlmGate(null); setCreateChooserOpen(true); setView('list');
  }
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
  async function fileBase64(value: File) {
    if (value.size > 8 * 1024 * 1024) throw new Error(t('ppt.fileTooLarge'));
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('file read failed'));
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.readAsDataURL(value);
    });
  }
  async function analyzeDraft(value: PptCreateDraft) {
    const model = models.find(row => row.id === value.modelKey);
    if (!model) throw new Error(t('ppt.chooseModel'));
    let id = value.analyzedProjectId;
    if (id) {
      await api('projects', `/${id}/outline`, 'POST', { pages: value.pages, template: value.template,
        seedOutline: value.outline });
    } else {
      const result = await api<{ project: Project }>('projects', '', 'POST', {
        inputKind: value.inputKind, title: value.title.trim() || undefined, prompt: value.prompt.trim() || undefined,
        text: value.inputKind === 'paste' ? value.text : undefined,
        fileName: value.inputKind === 'file' ? value.file?.name : undefined,
        fileBase64: value.inputKind === 'file' && value.file ? await fileBase64(value.file) : undefined,
        images: value.inputKind === 'paste' ? value.images : undefined,
        pages: value.pageSource === 'estimate' ? undefined : value.pages,
        template: value.template, configId: model.configId, model: model.modelId,
      });
      id = result.project.id;
    }
    const projectId = id;
    for (let attempt = 0; attempt < 180; attempt++) {
      const { project } = await api<{ project: Project }>('projects', `/${projectId}`);
      if (project.status === 'outline_ready') {
        await refresh();
        return { id: projectId, pages: project.pages,
          recommendation: project.planning?.pageRecommendation ? {
            recommended: project.planning.pageRecommendation.recommended,
            min: project.planning.pageRecommendation.range[0], max: project.planning.pageRecommendation.range[1],
            reason: project.planning.pageRecommendation.reason,
          } : undefined,
          outline: project.outline.map(slide => ({
          ...slide, id: slide.id, section: slide.section || slide.title, title: slide.title,
          focus: slide.focus || slide.title, description: slide.description || '',
          children: slide.children || [],
        })) };
      }
      if (['failed', 'cancelled'].includes(project.status)) throw new Error(project.error || '大纲生成失败，请重试');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('大纲生成超时，请到工作区任务中查看进度');
  }
  async function create(draft?: PptCreateDraft) {
    const value: PptCreateDraft = draft || { inputKind, title, prompt, text: sourceText, file, importMode, pages, compressionApproved: false, template, modelKey: flowModelKey, images: pasteImages };
    const editablePptx = value.inputKind === 'file' && value.file?.name.toLowerCase().endsWith('.pptx') && value.importMode === 'editable';
    const model = models.find(row => row.id === value.modelKey);
    if (!model && !editablePptx) return;
    await run(async () => {
      const filePayload = value.inputKind === 'file' && value.file && !value.analyzedProjectId ? await fileBase64(value.file) : undefined;
      const { project } = value.analyzedProjectId
        ? await api<{ project: Project }>('projects', `/${value.analyzedProjectId}/outline`, 'PATCH', {
          slides: value.outline, finalPageCount: value.pages, template: value.template, compressionApproved: value.compressionApproved,
        })
        : await api<{ project: Project }>('projects', '', 'POST', {
        inputKind: value.inputKind, title: value.title.trim() || undefined, prompt: value.prompt.trim() || undefined,
        text: value.inputKind === 'paste' ? value.text : undefined, fileName: value.inputKind === 'file' ? value.file?.name : undefined,
        images: value.inputKind === 'paste' ? value.images : undefined, fileBase64: filePayload, importMode: value.inputKind === 'file' && value.file?.name.toLowerCase().endsWith('.pptx') ? value.importMode : undefined,
        pages: value.pages,
        compressionApproved: value.compressionApproved, outline: value.outline,
        template: value.template, configId: model?.configId || 'pptx-import', model: model?.modelId || '',
      });
      let nextProject = project;
      if (!editablePptx) {
        const started = await api<{ project: Project }>('projects', `/${project.id}/generate`, 'POST');
        nextProject = started.project;
      }
      setProjects(prev => [nextProject, ...prev.filter(item => item.id !== nextProject.id)]);
      setSelected(nextProject); setTitle(nextProject.title); setOutline(nextProject.outline.map(slide => ({ ...slide })));
      setSlides(structuredClone(nextProject.deck?.slides || [])); setSourceDraft(nextProject.source?.text || ''); setDirty(false); setEditorOpen(false); setView('detail');
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
  async function confirmOutline() {
    if (!selected) return;
    if (outline.length !== selected.pages) {
      await mutate('/outline', 'POST', { pages: outline.length, seedOutline: outline });
      return;
    }
    if (await mutate('/outline', 'PATCH', { slides: outline, finalPageCount: outline.length }))
      await mutate('/generate', 'POST');
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
    if (kind === 'permanent') { requestConfirm(t('ppt.permanent'), t('ppt.permanentConfirm'), () => void action(project, 'permanent-confirmed')); return; }
    if (kind === 'trash') { requestConfirm(t('ppt.delete'), t('ppt.deleteConfirm'), () => void action(project, 'trash-confirmed')); return; }
    if (kind.endsWith('-confirmed')) kind = kind.replace('-confirmed', '');
    await run(async () => {
      if (kind === 'permanent') await api('projects', `/${project.id}/permanent`, 'DELETE');
      else if (kind === 'metadata') await api('projects', `/${project.id}`, 'PATCH', payload);
      else await api('projects', `/${project.id}/${kind}`, 'POST');
      await refresh();
    });
  }
  async function bulk(kind: string, targetFolder?: string | null) {
    if (!checked.length) return;
    if (kind === 'trash') { requestConfirm(t('ppt.delete'), t('ppt.deleteConfirm'), () => void bulk('trash-confirmed', targetFolder)); return; }
    if (kind === 'permanent') { requestConfirm(t('ppt.permanent'), t('ppt.permanentConfirm'), () => void bulk('permanent-confirmed', targetFolder)); return; }
    if (kind.endsWith('-confirmed')) kind = kind.replace('-confirmed', '');
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
  const completedCount = projects.filter(project => project.status === 'completed').length;
  async function reorderProject(movedId: string, targetId: string) {
    const moved = projects.find(item => item.id === movedId);
    const target = projects.find(item => item.id === targetId);
    if (!moved || !target) return;
    if (Boolean(moved.pinned) !== Boolean(target.pinned)) { setError(t('ppt.order.projectPinMismatch')); return; }
    await run(async () => { await api('projects', '/order', 'POST', { movedId, targetId, position: 'before' }); setSort('manual'); await refresh(); });
  }
  async function reorderFolder(movedId: string, targetId: string) {
    const moved = folders.find(item => item.id === movedId);
    const target = folders.find(item => item.id === targetId);
    if (!moved || !target) return;
    if (Boolean(moved.pinned) !== Boolean(target.pinned)) { setError(t('ppt.order.folderPinMismatch')); return; }
    await run(async () => { await api('folders', '/order', 'POST', { movedId, targetId, position: 'before' }); await refresh(); });
  }
  const renderRail = (mobile: boolean) => <PptWorkspaceRail mobile={mobile} folders={folders} projects={projects} trashCount={trashed.length} view={view} tab={tab} folderId={folderId}
    onNav={item => { setView('list'); setTab(item); setFolderId(null); setChecked([]); setMobileNavOpen(false); }}
    onTemplates={() => { setView('templates'); setMobileNavOpen(false); }} onTasks={() => { setView('tasks'); setMobileNavOpen(false); }}
    onFolder={id => { setView('list'); setTab('all'); setFolderId(id); setChecked([]); setMobileNavOpen(false); }}
    onNewFolder={() => setDialog({ type: 'createFolder', value: '' })}
    onRenameFolder={folder => setDialog({ type: 'renameFolder', id: folder.id, value: folder.name })}
    onPinFolder={folder => { void run(async () => { await api('folders', `/${folder.id}`, 'PATCH', { pinned: !folder.pinned }); await refresh(); }); }}
    onDeleteFolder={folder => requestConfirm(t('ppt.delete'), t('ppt.folderDeleteConfirm'), () => void run(async () => { await api('folders', `/${folder.id}`, 'DELETE'); setFolderId(null); await refresh(); }))}
    onReorderFolder={(moved, target) => void reorderFolder(moved, target)} />;
  const workspaceRail = renderRail(false);

  return <main className="ppt-prototype ppt-workspace-shell h-full overflow-y-auto bg-background text-foreground">
    <div className="ppt-workspace-frame min-h-full space-y-6 p-4 xl:p-0">
      {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {['list', 'templates', 'tasks'].includes(view) && <button className="rounded-lg border border-border px-3 py-2 text-sm xl:hidden" aria-label={t('ppt.workspaceNav.open')} onClick={() => setMobileNavOpen(true)}>☰ PPT Workspace</button>}
      {mobileNavOpen && <div className="fixed inset-0 z-[65] bg-black/60 p-4 xl:hidden" role="dialog" aria-modal="true" aria-label={t('ppt.workspaceNav.label')}><div className="max-w-xs space-y-2"><button className="ml-auto block rounded-lg border border-border bg-card px-3 py-1" aria-label={t('ppt.workspaceNav.close')} onClick={() => setMobileNavOpen(false)}>×</button>{renderRail(true)}</div></div>}
      {view === 'list' && <div className="ppt-workspace-grid grid min-h-[calc(100vh-7rem)] gap-6 xl:grid-cols-[218px_minmax(0,1fr)]">
        {workspaceRail}
        <section className="ppt-workspace-content min-w-0 space-y-5"><div className="sticky top-0 z-10 space-y-4 bg-background/95 pb-4 backdrop-blur"><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-wider text-primary">Workspace / PPT Workspace</div><h1 className="mt-2 text-2xl font-semibold">{tab === 'trash' ? '回收站' : 'PPT Workspace'}</h1>{tab === 'trash' && <p className="mt-1 text-sm text-muted-foreground">已删除的项目会在这里保留，可以恢复或永久删除。</p>}</div><div className="flex flex-wrap gap-2">{tab === 'trash' ? trashed.length > 0 && <button className={button} disabled={busy} onClick={() => { requestConfirm('清空回收站', t('ppt.clearTrashConfirm'), () => void run(async () => { for (let i = 0; i < trashed.length; i += 100) await api('projects', '/bulk', 'POST', { action: 'permanent', ids: trashed.slice(i, i + 100).map(p => p.id) }); await refresh(); })); }}>⌫ 清空</button> : <><button className={button} onClick={startDirectImport}>↥ 导入</button><button className={button} onClick={() => startUpdate()}>↻ 基于上一版更新</button><button className={primary} onClick={startNew}>＋ 新建</button></>}</div></div>{tab !== 'trash' && <><div className="rounded-xl border border-border bg-card p-3"><div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"><label className="relative"><span className="absolute left-3 top-2.5 text-muted-foreground">⌕</span><input ref={searchRef} className={`${input} pl-8`} value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索 PPT 名称或标签" aria-label="搜索 PPT" /></label><select className={input} value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="排序"><option value="updated">最近编辑</option><option value="created">最近创建</option><option value="name">名称 A-Z</option><option value="manual">手动排序</option></select><div className="flex rounded-lg border border-border p-1" aria-label="视图切换"><button className={`rounded px-3 ${layout === 'grid' ? 'bg-accent' : ''}`} aria-label="网格视图" onClick={() => setLayout('grid')}>▦</button><button className={`rounded px-3 ${layout === 'list' ? 'bg-accent' : ''}`} aria-label="列表视图" onClick={() => setLayout('list')}>☷</button></div></div></div><nav className="flex gap-6 border-b border-border" aria-label="PPT 筛选">{([['recent','最近使用'],['favorites','收藏'],['all','全部 PPT']] as const).map(([value,label]) => <button key={value} className={`border-b-2 px-1 pb-3 text-sm ${tab === value && !folderId ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`} onClick={() => { setTab(value); setFolderId(null); setChecked([]); }}>{label}</button>)}</nav></>}</div><div className="flex items-center justify-between"><h2 className="font-semibold">{folderId ? folders.find(f => f.id === folderId)?.name : tab === 'favorites' ? '收藏的 PPT' : tab === 'all' ? '全部 PPT' : tab === 'trash' ? '回收站' : '最近使用'}</h2><span className="text-xs text-muted-foreground">{visible.length} 个项目</span></div>
          {loading ? <p>{t('ppt.loading')}</p> : visible.length === 0 ? <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground"><div className="text-3xl">⌁</div><h3 className="mt-3 font-medium text-foreground">{query ? '没有匹配结果' : '从一个新想法开始'}</h3><p className="mt-1">{query ? `没有找到与“${query}”相关的演示文稿。` : tab === 'favorites' ? '还没有收藏任何演示文稿。' : tab === 'trash' ? '删除的项目会在这里保留。' : '这个区域还没有演示文稿。'}</p>{tab !== 'trash' && <button className={`${query ? button : primary} mt-4`} onClick={() => query ? setQuery('') : startNew()}>{query ? '清除搜索' : '新建 PPT'}</button>}</div> : <div className={layout === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-3'}>{visible.map(project => <article key={project.id} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-aimate-ppt-project')) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const moved = event.dataTransfer.getData('application/x-aimate-ppt-project'); if (moved && moved !== project.id) void reorderProject(moved, project.id); }} className={`relative overflow-hidden rounded-xl border border-border bg-card ${layout === 'list' ? 'flex items-center' : ''}`}><input type="checkbox" className="absolute left-3 top-3 z-10 h-4 w-4" checked={checked.includes(project.id)} aria-label={`${t('ppt.select')} ${project.title}`} onChange={e => setChecked(prev => e.target.checked ? [...prev, project.id] : prev.filter(id => id !== project.id))} /><button className={`min-w-0 text-left ${layout === 'list' ? 'flex flex-1 items-center' : 'block w-full'}`} onClick={() => { if (tab !== 'trash') void openProject(project); }}><div className={`${layout === 'list' ? 'm-3 h-20 w-36 shrink-0' : 'aspect-[16/9]'} relative flex flex-col justify-between overflow-hidden p-4 ${project.templateSpec?.palette ? '' : themes[project.template] || themes.violet}`} style={project.templateSpec?.palette ? { background: project.templateSpec.palette.background, color: project.templateSpec.palette.foreground } : undefined}><span className="text-[9px] uppercase tracking-widest opacity-70">AIMate · presentation</span><strong className="line-clamp-2 text-lg">{project.deck?.slides[0]?.title || project.outline[0]?.title || project.title}</strong><div className="absolute -bottom-9 -right-4 h-24 w-24 rounded-full border-[12px] border-white/10"/></div><div className="min-w-0 p-3"><h3 className="truncate font-medium">{project.title}</h3><p className="mt-2 text-xs text-muted-foreground"><span className="rounded bg-primary/10 px-1.5 py-1 text-primary">{t(`ppt.status.${project.status}` as TranslationKey)}</span> · {project.pages} 页 · {new Date(project.deletedAt || project.updatedAt).toLocaleDateString()}</p>{(project.tags || []).length > 0 && <p className="mt-2 truncate text-xs text-muted-foreground">{project.tags?.join('　')}</p>}</div></button><div className={`${layout === 'list' ? 'mr-3' : 'absolute bottom-3 right-3'} flex shrink-0 gap-1`}>{tab === 'trash' ? <><button className={button} onClick={() => void action(project, 'restore')}>恢复</button><button className={button} onClick={() => void action(project, 'permanent')}>永久删除</button></> : <><button draggable className="cursor-grab px-2 text-muted-foreground" aria-label={`${t('ppt.order.dragProject')} ${project.title}`} title={t('ppt.order.dragProject')} onDragStart={event => { event.dataTransfer.setData('application/x-aimate-ppt-project', project.id); event.dataTransfer.effectAllowed = 'move'; }}>⋮⋮</button><button className="px-2" aria-label={project.pinned ? '取消置顶' : '置顶'} onClick={() => void action(project, 'metadata', { pinned: !project.pinned })}>{project.pinned ? '📌' : '♧'}</button><button className="px-2" aria-label={project.favorite ? '取消收藏' : '收藏'} onClick={() => void action(project, 'metadata', { favorite: !project.favorite })}>{project.favorite ? '★' : '☆'}</button><button className="px-2" aria-label="更多操作" onClick={() => setMenuId(menuId === project.id ? null : project.id)}>•••</button>{menuId === project.id && <div className="absolute right-3 top-full z-20 grid min-w-36 gap-2 rounded-lg border border-border bg-popover p-3 shadow-lg"><button className="text-left text-sm" onClick={() => { setDialog({ type: 'renameProject', id: project.id, value: project.title }); setMenuId(null); }}>重命名</button><button className="text-left text-sm" onClick={() => void action(project, 'duplicate')}>复制项目</button><button className="text-left text-sm" onClick={() => { setDialog({ type: 'move', id: project.id, value: project.folderId || '' }); setMenuId(null); }}>移动文件夹</button>{project.folderId && <button className="text-left text-sm" onClick={() => void action(project, 'metadata', { folderId: null })}>从文件夹移除</button>}<button className="text-left text-sm text-destructive" onClick={() => { setMenuId(null); void action(project, 'trash'); }}>删除项目</button></div>}</>}</div></article>)}</div>}
        </section>
      </div>}
      {view === 'tasks' && <div className="ppt-workspace-grid grid min-h-[calc(100vh-7rem)] gap-6 xl:grid-cols-[218px_minmax(0,1fr)]">{workspaceRail}<PptTaskCenter projects={projects} onCreate={startNew} onOpen={project => void openProject(project)} onRetry={project => void run(async () => { const result = await api<{ project: Project }>('projects', `/${project.id}/retry`, 'POST'); acceptStructuredProject(result.project); setSelected(result.project); setView('detail'); })} /></div>}
      {view === 'templates' && <div className="ppt-workspace-grid grid min-h-[calc(100vh-7rem)] gap-6 xl:grid-cols-[218px_minmax(0,1fr)]">{workspaceRail}<PptM3 mode="templates" projects={projects} models={models}
        baseProjectId={m3BaseId} onUseTemplate={(_, item) => startTemplate(item)}
        onCreated={project => { void refresh(); void openProject(project as Project); }} onBack={() => back()} /></div>}
      {view === 'update' && <PptM3 mode="update" projects={projects} models={models} modelKey={updateModelKey}
        baseProjectId={m3BaseId} onUseTemplate={(_, item) => startTemplate(item)} onBackToLlm={() => setLlmGate('update')}
        onCreated={project => { void refresh(); void openProject(project as Project); }} onBack={() => back()} />}
      {view === 'create' && <PptCreateWizard models={models} templates={templateOptions} initialKind={createKind} entry={createEntry} modelKey={flowModelKey} onModelKeyChange={setFlowModelKey} lockedTemplate={lockedTemplate} busy={busy} onCancel={() => { setCreateKind(undefined); back(); }} onBackToChooser={() => { setCreateKind(undefined); setView('list'); setCreateChooserOpen(true); }} onAnalyze={analyzeDraft} onSubmit={async draft => { await create(draft); }} />}
      {view === 'detail' && selected && ['completed', 'quality_blocked'].includes(selected.status) && !editorOpen && <div className="fixed inset-0 z-40 bg-black/55" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) back(); }}><aside className="ml-auto flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="ppt-project-detail-title"><header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5"><h2 id="ppt-project-detail-title" className="font-semibold">项目详情</h2><button className="grid h-8 w-8 place-items-center rounded-lg border border-border" aria-label="关闭" onClick={() => back()}>×</button></header><div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="relative aspect-video overflow-hidden rounded-xl border-t-4 p-[8%]" style={{ background: selected.templateSpec?.palette?.background || '#273255', borderColor: selected.templateSpec?.palette?.accent || '#7c70d6', color: selected.templateSpec?.palette?.foreground || '#fff' }}><span className="text-[10px] uppercase tracking-widest opacity-70">AIMate · presentation</span><h3 className="mt-8 text-2xl font-semibold">{selected.deck?.slides[0]?.title || selected.title}</h3></div><div className="mt-4 flex items-start justify-between gap-3"><div><h3 className="font-semibold">{selected.title}</h3><p className="mt-1 text-xs text-muted-foreground">{selected.pages} 页 · {new Date(selected.updatedAt).toLocaleDateString()}</p></div><span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{selected.status === 'completed' ? '已完成' : '需检查'}</span></div><div className="mt-5 grid grid-cols-2 gap-2"><button className={primary} onClick={() => setEditorOpen(true)}>打开编辑器</button><button className={button} onClick={() => { const favorite = !selected.favorite; setSelected({ ...selected, favorite }); void action(selected, 'metadata', { favorite }); }}>{selected.favorite ? '★ 已收藏' : '☆ 收藏'}</button><button className={button} onClick={() => void action(selected, 'duplicate')}>复制项目</button><button className={button} onClick={() => setDialog({ type: 'renameProject', id: selected.id, value: selected.title })}>重命名</button><button className={button} onClick={() => setDialog({ type: 'move', id: selected.id, value: selected.folderId || '' })}>移动文件夹</button><button className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10" onClick={() => void action(selected, 'trash')}>删除项目</button></div><PptReportReadiness report={selected.quality?.report} /><section className="mt-6 border-t border-border pt-5"><h4 className="text-sm font-semibold">生成时间线</h4><div className="mt-4 space-y-4 text-sm">{[['项目已创建', selected.createdAt], ['AI 完成内容规划', selected.updatedAt], ['页面生成与版式检查', selected.updatedAt], [selected.status === 'completed' ? '已完成，可继续编辑' : '质量门禁需要检查', selected.updatedAt]].map(([label, date]) => <div key={label} className="grid grid-cols-[10px_1fr] gap-3"><span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary"/><p>{label}<small className="mt-0.5 block text-muted-foreground">{new Date(date).toLocaleString()}</small></p></div>)}</div></section><section className="mt-6 border-t border-border pt-5"><h4 className="text-sm font-semibold">页面预览</h4><div className="mt-3 grid grid-cols-2 gap-2">{selected.renderTree?.slides.slice(0, 6).map((item, index) => <div key={item.id} className="overflow-hidden rounded-lg border border-border"><img alt={`第 ${index + 1} 页`} src={`/api/ppt/projects/${selected.id}/preview/${item.id}.svg`} className="aspect-video w-full bg-muted object-contain"/><span className="block p-2 text-[10px] text-muted-foreground">{String(index + 1).padStart(2, '0')} · {index === 0 ? '封面' : index === 1 ? '结论' : '内容页'}</span></div>)}</div></section></div></aside></div>}
      {view === 'detail' && selected && (!['completed', 'quality_blocked'].includes(selected.status) || editorOpen) && <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"><div><h2 className="font-medium">{selected.title}</h2><p className="text-sm text-muted-foreground">{t(`ppt.status.${selected.status}` as TranslationKey)} · {selected.pages} {t('ppt.pages')}</p></div>{selected.status === 'completed' && !selected.renderTree && <div className="flex flex-wrap gap-2"><button className={button} onClick={() => startUpdate(selected.id)}>{t('ppt.m3.update')}</button><button className={button} onClick={() => setPresentation(0)}>{t('ppt.present')}</button><a className={button} href={`/api/ppt/projects/${selected.id}/pdf`} download>{t('ppt.exportPdf')}</a><a className={primary} href={`/api/ppt/projects/${selected.id}/export`} download>{t('ppt.export')}</a></div>}</div>
        {(selected.update || versions.length > 1) && <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="font-medium">{t('ppt.m3.versions')}</h3>
          {versions.length > 1 && <div className="flex flex-wrap gap-2">{versions.map(version => <button key={version.id} className={version.id === selected.id ? primary : button} onClick={() => void openProject({ id: version.id } as Project)}>{version.title} · v{version.number}</button>)}</div>}
          {selected.diff && <p className="text-sm text-muted-foreground">{t('ppt.m3.keep')} {selected.diff.kept} · {t('ppt.m3.rewrite')} {selected.diff.rewritten} · {t('ppt.m3.add')} {selected.diff.added} · {t('ppt.m3.removed')} {selected.diff.removed.map(item => item.title).join(', ') || '0'}</p>}
          {selected.status === 'outline_ready' && selected.update && <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="max-w-xl"><SlidePreview slide={outline[previewPage] || outline[0] || { id: '1', title: selected.title }} template={selected.template} palette={selected.templateSpec?.palette} fonts={selected.templateSpec?.fonts} /></div>
            <div className="flex items-center gap-2"><button className={button} disabled={previewPage === 0} onClick={() => setPreviewPage(page => page - 1)}>←</button><span className="text-sm">{previewPage + 1}/{outline.length}</span><button className={button} disabled={previewPage >= outline.length - 1} onClick={() => setPreviewPage(page => page + 1)}>→</button></div>
          </div>}
        </div>}
        {['ingesting', 'outlining', 'generating', 'paused'].includes(selected.status) && <PptGenerationMonitor project={selected} onEdit={slideId => { setGenerationEdit({ projectId: selected.id, slideId }); setGenerationEditOpen(true); }} onProject={project => { acceptStructuredProject(project); if (project.status === 'completed' || project.status === 'quality_blocked') setEditorOpen(true); }} onBackground={() => back()} />}{selected.status === 'failed' && <div className="rounded-xl border border-destructive/40 p-5"><p className="mb-3 text-destructive">{selected.error}</p><button className={button} disabled={busy} onClick={() => void mutate('/retry', 'POST')}>{t('ppt.retry')}</button></div>}{selected.status === 'outline_ready' && <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><div className="space-y-3 rounded-xl border border-border p-4"><h3 className="font-medium">{t('ppt.sourcePreview')}</h3>{selected.inputKind === 'paste' ? <><textarea className={`${input} min-h-72`} value={sourceDraft} onChange={e => setSourceDraft(e.target.value)} /><button className={button} disabled={busy || !sourceDirty} onClick={() => void mutate('/source', 'PATCH', { text: sourceDraft, sourceRevision: selected.sourceRevision })}>{t('ppt.reread')}</button>{sourceDirty && <p className="text-xs text-destructive">{t('ppt.sourceChanged')}</p>}{Boolean(selected.source?.images?.length) && <div><p className="mb-2 text-xs font-medium text-muted-foreground">{t('ppt.pasteImages')} · {selected.source?.images?.length}</p><div className="grid grid-cols-2 gap-2">{selected.source?.images?.map(image => <img key={image.id} src={image.dataUrl} alt={image.caption || t('ppt.m4.image')} className="h-28 w-full rounded border border-border object-contain" />)}</div></div>}</> : selected.source ? <div className="max-h-[36rem] space-y-2 overflow-y-auto text-sm">{selected.source.segments.map(segment => <div key={segment.id} className="rounded-lg bg-muted p-3"><b>[{segment.id}] {segment.location}</b><p className="mt-1 whitespace-pre-wrap">{segment.text}</p></div>)}</div> : <p className="text-sm text-muted-foreground">{selected.prompt}</p>}{selected.source?.truncated && <p className="text-xs text-destructive">{t('ppt.sourceTruncated')}</p>}</div><div className="space-y-3 rounded-xl border border-border p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{t('ppt.outline')}</h3><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => { requestConfirm(t('ppt.reorganize'), t('ppt.reorganizeConfirm'), () => void mutate('/outline', 'POST')); }}>{t('ppt.reorganize')}</button><button className={primary} disabled={busy || sourceDirty || outline.length < (selected.update ? 6 : 3) || outline.length > (100)} onClick={() => void confirmOutline()}>{outline.length !== selected.pages ? t('ppt.replanPages') : t('ppt.confirmGenerate')}</button></div></div><div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">{outline.map((slide, i) => <div key={slide.id} className="rounded-lg border border-border bg-card p-3"><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>{i + 1} / {outline.length} {slide.refs?.length ? `· ${t('ppt.references')}: ${slide.refs.join(', ')}` : ''}</span><button disabled={outline.length <= (selected.update ? 6 : 3)} onClick={() => setOutline(prev => prev.filter((_, j) => j !== i))}>{t('ppt.delete')}</button></div>
          {selected.update && <div className="mb-2 grid gap-2 sm:grid-cols-2"><select className={input} aria-label={`${t('ppt.m3.baseSlide')} ${i + 1}`} value={slide.baseSlideId || ''} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, baseSlideId: e.target.value || null, change: e.target.value ? 'rewrite' : 'add' } : x))}><option value="">{t('ppt.m3.newSlide')}</option>{(selected.update?.baseSnapshot.deck?.slides || []).map(base => <option key={base.id} value={base.id}>{base.title}</option>)}</select><select className={input} aria-label={`${t('ppt.m3.change')} ${i + 1}`} value={slide.change || 'add'} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, change: e.target.value as Slide['change'], baseSlideId: e.target.value === 'add' ? null : x.baseSlideId } : x))}><option value="keep" disabled={!slide.baseSlideId}>{t('ppt.m3.keep')}</option><option value="rewrite" disabled={!slide.baseSlideId}>{t('ppt.m3.rewrite')}</option><option value="add">{t('ppt.m3.add')}</option></select></div>}
          <input aria-label={`${t('ppt.section')} ${i + 1}`} className={`${input} mb-2`} value={slide.section || ''} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, section: e.target.value } : x))}/><input aria-label={`${t('ppt.slideTitle')} ${i + 1}`} className={`${input} mb-2`} value={slide.title} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}/><textarea aria-label={`${t('ppt.focus')} ${i + 1}`} className={input} value={slide.focus || ''} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, focus: e.target.value } : x))}/><textarea aria-label={`${t('ppt.outlineDescription')} ${i + 1}`} className={`${input} mt-2`} value={slide.description || ''} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} placeholder={t('ppt.outlineDescriptionPlaceholder')}/><div className="mt-2 space-y-2">{(slide.children || []).map((child, childIndex) => <div key={child.id} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]"><input aria-label={`${t('ppt.outlineChildTitle')} ${i + 1}-${childIndex + 1}`} className={input} value={child.title} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, children: (x.children || []).map(item => item.id === child.id ? { ...item, title: e.target.value } : item) } : x))}/><input aria-label={`${t('ppt.outlineChildDescription')} ${i + 1}-${childIndex + 1}`} className={input} value={child.description} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, children: (x.children || []).map(item => item.id === child.id ? { ...item, description: e.target.value } : item) } : x))}/><button className={button} onClick={() => setOutline(prev => prev.map((x, j) => j === i ? { ...x, children: (x.children || []).filter(item => item.id !== child.id) } : x))}>{t('ppt.delete')}</button></div>)}<button className={button} onClick={() => setOutline(prev => prev.map((x, j) => j === i ? { ...x, children: [...(x.children || []), { id: crypto.randomUUID().replaceAll('-', ''), title: '', description: '' }] } : x))}>＋ {t('ppt.outlineAddChild')}</button></div></div>)}</div><button className={button} disabled={outline.length >= (100)} onClick={() => setOutline(prev => [...prev, { id: crypto.randomUUID().replaceAll('-', ''), section: t('ppt.newSection'), title: t('ppt.newSlide'), focus: '' }])}>{t('ppt.addSlide')}</button></div></div>}{['completed', 'quality_blocked'].includes(selected.status) && <div className="space-y-4">{selected.renderTree && <StructuredPptEditor project={selected} onProject={acceptStructuredProject} onClose={() => setEditorOpen(false)} />}{selected.quality && <section data-testid="ppt-quality-report" className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{t('ppt.quality.title')}</h3><span className={`rounded-full px-2 py-1 text-xs ${selected.quality.status === 'passed' ? 'bg-primary/10 text-primary' : 'bg-muted text-foreground'}`}>{t(`ppt.quality.${selected.quality.status}` as TranslationKey)}</span></div><div className="mt-3 grid gap-3 text-sm sm:grid-cols-3"><div><b>{t('ppt.quality.automatic')}</b><p className="text-muted-foreground">{selected.quality.deterministic.issues.length} {t('ppt.quality.findings')} · {selected.quality.deterministic.hardErrors} {t('ppt.quality.errors')}</p></div><div><b>{t('ppt.quality.review')}</b><p className="text-muted-foreground">{Object.values(selected.quality.modelReview || {}).reduce((sum, findings) => sum + findings.length, 0)} {t('ppt.quality.findings')}</p></div><div><b>{t('ppt.quality.repairs')}</b><p className="text-muted-foreground">{selected.quality.repairs.length}</p></div></div>{selected.templateSpec?.fonts && <p className="mt-3 text-xs text-muted-foreground">{t('ppt.quality.templateFonts')}: {selected.templateSpec.fonts.titleEastAsia || selected.templateSpec.fonts.title} / {selected.templateSpec.fonts.bodyEastAsia || selected.templateSpec.fonts.body}</p>}</section>}{selected.status === 'quality_blocked' && <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"><p>{t('ppt.quality.blockedHelp')}</p>{selected.error && <p className="mt-1 text-xs">{selected.error}</p>}</div>}{!selected.renderTree && <><label className="block max-w-xl space-y-1 text-sm"><span>{t('ppt.filename')}</span><input className={input} value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title.trim() !== selected.title) void mutate('', 'PATCH', { title }); }}/></label><label className="block max-w-xl space-y-1 text-sm"><span>{t('ppt.tags')}</span><input className={input} defaultValue={(selected.tags || []).join(', ')} onBlur={e => { const tags = e.target.value.split(',').map(s => s.trim()).filter(Boolean); if (tags.join(',') !== (selected.tags || []).join(',')) void mutate('', 'PATCH', { tags }); }} placeholder={t('ppt.tagsHint')} /></label><div className="flex justify-between gap-2"><h3 className="font-medium">{t('ppt.edit')}</h3><div className="flex gap-2"><button className={button} disabled={busy || slides.length >= 100} onClick={() => changeSlides([...slides, { id: crypto.randomUUID().replaceAll('-', ''), title: t('ppt.newSlide'), bullets: [], blocks: [] }])}>{t('ppt.addSlide')}</button><button className={primary} disabled={busy || !dirty || hasIncompleteImage} title={hasIncompleteImage ? t('ppt.m4.uploadImage') : undefined} onClick={() => void saveSlides()}>{t('ppt.save')}</button></div></div><div className="flex flex-wrap items-center gap-2"><button className={button} disabled={!undoHistory.current.length} onClick={undo}>{t('ppt.m4.undo')}</button><button className={button} disabled={!redoHistory.current.length} onClick={redo}>{t('ppt.m4.redo')}</button><input className={`${input} max-w-xs`} aria-label={t('ppt.m4.searchSlides')} placeholder={t('ppt.m4.searchSlides')} value={editorSearch} onChange={e => setEditorSearch(e.target.value)} /><label className="flex items-center gap-2 text-sm"><span>{t('ppt.m4.switchTemplate')}</span><select className={input} value={selected.template} disabled={busy || dirty} onChange={e => void mutate('', 'PATCH', { template: e.target.value, revision: selected.revision })}>{templateOptions.filter(item => item.compatibility === 'mapped').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="grid gap-4 lg:grid-cols-2">{slides.filter(slide => `${slide.title} ${(slide.bullets || []).join(' ')}`.toLocaleLowerCase().includes(editorSearch.toLocaleLowerCase())).map((slide, i) => <div key={slide.id} className="rounded-xl border border-border bg-card p-4"><p className="mb-2 text-xs text-muted-foreground">{t('ppt.slide')} {i + 1}{slide.sourceRefs?.length ? ` · ${t('ppt.references')}: ${slide.sourceRefs.join(', ')}` : ''}</p><SlidePreview slide={slide} template={selected.template} palette={selected.templateSpec?.palette} fonts={selected.templateSpec?.fonts}/><input aria-label={`${t('ppt.slideTitle')} ${i + 1}`} className={`${input} my-3 font-medium`} value={slide.title} onChange={e => changeSlides(slides.map(x => x.id === slide.id ? { ...x, title: e.target.value } : x))}/><textarea aria-label={`${t('ppt.bullets')} ${i + 1}`} className={`${input} min-h-36`} value={(slide.bullets || []).join('\n')} onChange={e => changeSlides(slides.map(x => x.id === slide.id ? { ...x, bullets: e.target.value.split('\n').filter(Boolean) } : x))}/><p className="mt-2 text-xs text-muted-foreground">{t('ppt.bulletHint')}</p><BlockEditor blocks={slide.blocks} onChange={blocks => changeSlides(slides.map(item => item.id === slide.id ? { ...item, blocks } : item))} canRewrite={!busy && !dirty && aiSlideId === slide.id && Boolean(aiDraft.trim())} onRewrite={blockId => void rewriteSlide(slide.id, aiDraft, blockId)} /><label className="mt-2 block space-y-1 text-xs"><span>{t('ppt.m4.layout')}</span><select className={input} value={slide.layoutId || 'summary'} onChange={e => changeSlides(slides.map(item => item.id === slide.id ? { ...item, layoutId: e.target.value as LayoutId } : item))}>{layoutIds.map(layoutId => <option key={layoutId} value={layoutId}>{t(`ppt.layout.${layoutId}` as TranslationKey)}</option>)}</select></label><div className="mt-3 flex gap-2"><input className={input} aria-label={`${t('ppt.m4.aiInstruction')} ${slide.title}`} placeholder={t('ppt.m4.aiInstruction')} value={aiSlideId === slide.id ? aiDraft : ''} onChange={e => { setAiSlideId(slide.id); setAiDraft(e.target.value); }} /><button className={button} disabled={busy || dirty || aiSlideId !== slide.id || !aiDraft.trim()} onClick={() => void rewriteSlide(slide.id, aiDraft)}>{t('ppt.m4.aiRewrite')}</button></div></div>)}</div></>}</div>}</section>}
    </div>
    {!generationEditOpen && !generationEdit && selected?.editing && Object.keys(selected.editing.intents).length > 0 && <button className="fixed bottom-16 right-4 z-[80] rounded-lg border border-border bg-background px-4 py-2 text-sm shadow-lg" onClick={() => { const latest = Object.values(selected.editing!.intents).slice(-1)[0]; const slideId = Object.keys(latest.perSlideResults).find(id => selected.outline.some(slide => slide.id === id)) || selected.outline[0]?.id; if (slideId) { setGenerationEdit({ projectId: selected.id, slideId }); setGenerationEditOpen(true); } }}>{t('ppt.edit.history')}</button>}
    {generationEditOpen && generationEdit && selected?.id === generationEdit.projectId && <GenerationEditDialog key={`${generationEdit.projectId}:${generationEdit.slideId}`} project={selected} slideId={generationEdit.slideId} onProject={acceptStructuredProject} onClose={() => { setGenerationEditOpen(false); if (!sessionStorage.getItem(`ppt-generation-draft:${generationEdit.projectId}:${generationEdit.slideId}`)) setGenerationEdit(null); }}/>}
    {!generationEditOpen && generationEdit && selected?.id === generationEdit.projectId && <button className="fixed bottom-16 right-4 z-[80] rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg" onClick={() => setGenerationEditOpen(true)}>{t('ppt.edit.editDuring')}</button>}
    {checked.length > 0 && view === 'list' && <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-xl border border-border bg-popover p-3 shadow-xl"><span className="whitespace-nowrap text-sm">{checked.length} {t('ppt.selected')}</span>{tab === 'trash' ? <><button className={button} onClick={() => void bulk('restore')}>{t('ppt.restore')}</button><button className={button} onClick={() => void bulk('permanent')}>{t('ppt.permanent')}</button></> : <><button className={button} onClick={() => setDialog({ type: 'move', value: '' })}>{t('ppt.move')}</button><button className={button} onClick={() => void bulk('trash')}>{t('ppt.delete')}</button></>}<button className={button} onClick={() => setChecked([])}>{t('ppt.cancel')}</button></div>}
    {dialog && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"><form role="dialog" aria-modal="true" className="w-full max-w-md space-y-4 rounded-xl border border-border bg-background p-6" onSubmit={e => { e.preventDefault(); void submitDialog(); }}><h2 className="text-lg font-medium">{t(`ppt.dialog.${dialog.type}` as TranslationKey)}</h2>{dialog.type === 'move' ? <><select className={input} value={dialog.value} onChange={e => setDialog({ ...dialog, value: e.target.value })}><option value="">{t('ppt.ungrouped')}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><button type="button" className={button} onClick={() => setDialog({ type: 'createFolder', value: '' })}>＋ {t('ppt.folderCreate')}</button></> : <input autoFocus className={input} value={dialog.value} onChange={e => setDialog({ ...dialog, value: e.target.value })} maxLength={dialog.type === 'renameProject' ? 160 : 80}/>}<div className="flex justify-end gap-2"><button type="button" className={button} onClick={() => setDialog(null)}>{t('ppt.cancel')}</button><button className={primary} disabled={busy || (dialog.type !== 'move' && !dialog.value.trim())}>{t('ppt.confirm')}</button></div></form></div>}
    {createChooserOpen && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setCreateChooserOpen(false); }}><section className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="ppt-new-title"><header className="flex items-start justify-between border-b border-border p-5"><div><h2 id="ppt-new-title" className="text-lg font-semibold">新建</h2><p className="mt-1 text-sm text-muted-foreground">选择一种方式开始创建演示文稿</p></div><button className="grid h-8 w-8 place-items-center rounded-lg border border-border" aria-label="关闭" onClick={() => setCreateChooserOpen(false)}>×</button></header><div className="p-5"><div className="mb-4 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"><div><strong>LLM · {models.find(model => model.id === flowModelKey)?.name || '未选择'}</strong>{lockedTemplate && <p className="mt-1 text-xs text-muted-foreground">模板 · {lockedTemplate.name}，模板与 LLM 将保持锁定。</p>}</div><button className={button} onClick={() => { setCreateChooserOpen(false); setLlmGate(createEntry === 'template' ? 'template' : 'new'); }}>更换模型</button></div><div className="grid gap-3 md:grid-cols-3">{([['prompt','✦','从 Prompt 开始','告诉 AI 主题与目标，生成完整结构。'],['paste','▤','粘贴文本','粘贴笔记、报告或大纲，生成演示文稿。'],['file','↥','导入文件','上传文档，AI 将提炼为演示文稿。']] as const).map(([kind, icon, label, help]) => <button key={kind} className="rounded-xl border border-border bg-card p-5 text-left hover:border-primary hover:bg-accent/40" onClick={() => { setCreateChooserOpen(false); setCreateKind(kind); setView('create'); }}><span className="text-xl text-primary">{icon}</span><strong className="mt-3 block">{label}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{help}</span></button>)}</div></div></section></div>}
    {llmGate && <PptLlmGate context={llmGate} models={models} modelKey={llmGate === 'update' ? updateModelKey : flowModelKey} template={llmGate === 'template' ? lockedTemplate : undefined} onModelKeyChange={llmGate === 'update' ? setUpdateModelKey : setFlowModelKey} onClose={() => setLlmGate(null)} onConfirm={confirmLlmGate}/>}
    {confirmation && <PptConfirmDialog title={confirmation.title} message={confirmation.message} confirmLabel={t('ppt.confirm')} dangerous onClose={() => setConfirmation(null)} onConfirm={() => { const action = confirmation.action; setConfirmation(null); action(); }} />}
    {presentation !== null && slides[presentation] && selected && <div className="fixed inset-0 z-50 flex flex-col bg-background p-4"><div className="mb-3 flex items-center justify-between"><span className="text-sm">{selected.title} · {presentation + 1}/{slides.length}</span><button className={button} onClick={() => setPresentation(null)}>{t('ppt.close')}</button></div><div className="m-auto w-full max-w-6xl"><SlidePreview slide={slides[presentation]} template={selected.template} palette={selected.templateSpec?.palette} fonts={selected.templateSpec?.fonts} large/></div><div className="flex justify-center gap-4"><button className={button} disabled={presentation === 0} onClick={() => setPresentation(n => n === null ? null : n - 1)}>←</button><button className={button} disabled={presentation === slides.length - 1} onClick={() => setPresentation(n => n === null ? null : n + 1)}>→</button></div></div>}
  </main>;
}
