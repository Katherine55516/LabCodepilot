'use client';
import {pptModelReviewState} from '@/lib/ppt-quality-state';

import {PptProjectCover} from './workspace/PptProjectCover';
import {PptExecutionPanel} from './editor/PptExecutionPanel';
import {initialExecutionPolicy,bindExecutionPolicy} from './create/PptQualitySettings';
import {PptPin} from './workspace/PptPin';
import {pptPageLabel,pptTimelineLabel,pptRoleLabel} from '@/lib/ppt-page-label';
import {PptFailureDialog} from './workspace/PptFailureDialog';
import {pptFailureMessage} from "@/lib/ppt-error";
import {PptSelectField} from './PptSelect';
import { PptOutlineDiagnostic } from './PptOutlineDiagnostic';
/* eslint-disable @next/next/no-img-element -- pasted images are locally resized data URLs in the presentation IR */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {useSearchParams} from 'next/navigation';
import {retryPptRead} from '@/lib/ppt-read-retry';
import {pollOutlineProject,pptAbortError} from '@/lib/ppt-outline-poll';
import {pptTaskStore} from '@/lib/ppt-task-store';
import {isLibraryPresentation} from '@/lib/ppt-library';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
import { requirePptByokCapabilities } from '@/lib/ppt-byok-contract';
import { useTranslation } from '@/hooks/useTranslation';
import type {PptModelCapabilities} from '@/lib/ppt-model-catalog';
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
import { PptQualityBlockNotice } from './workspace/PptQualityBlockNotice';
import { PptMediaRetirements } from './workspace/PptMediaRetirements';
import { PptOutlineConcision } from './workspace/PptOutlineConcision';
import { PptOutlineCorrections, outlineNeedsRepair } from './workspace/PptOutlineCorrections';
import type { PptExecutionPolicy, PptLayoutId as LayoutId, PptModel as Model, PptProject as Project, PptSlide as Slide, PptTemplate, StructuredProjectView } from './types';
import './ppt-prototype.css';

type PasteImage = Extract<VisualBlock, { type: 'image' }>;
type Folder = WorkspaceFolder;
type Dialog = { type: 'renameProject' | 'renameFolder' | 'createFolder' | 'move'; id?: string; value: string };
type Tab = 'recent' | 'all' | 'favorites' | 'trash';

async function api<T>(resource: 'projects' | 'folders' | 'templates' | 'updates', path = '', method = 'GET', payload?: unknown): Promise<T> {
  const projection=resource==='projects'&&!path.includes('view=')?`${path.includes('?')?'&':'?'}view=live`:'';
  const request = async ():Promise<T> => {
  const response = await fetch(`/api/ppt/${resource}${path}${projection}`, { method, headers: payload === undefined ? undefined : { 'content-type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), cache: 'no-store', ...(method === 'GET' ? {signal:AbortSignal.timeout(30000)} : {}) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    // A title-capacity refusal carries its limits; pptFailureMessage words it in the UI language.
    const message = data.code === 'title_capacity' && Array.isArray(data.titleLimits) && data.titleLimits.length ? `ppt_title_capacity ${JSON.stringify(data.titleLimits)}` : data.error;
    throw Object.assign(new Error(message || `HTTP ${response.status}`), { status: response.status, code: data.code, issues: Array.isArray(data.issues) ? data.issues : undefined });
  }
  return response.json();
  };
  return method === 'GET' ? retryPptRead(request) : request();
}
const input = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';
const primary = 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50';
const themes: Record<string, string> = { violet: 'bg-[#171b31] text-[#f5f6fc] border-t-[#967fff]', blue: 'bg-[#102b43] text-[#f5f6fc] border-t-[#55ade2]', light: 'bg-[#f8f9fc] text-[#242a3b] border-t-[#404b6b]' };
const layoutIds: LayoutId[] = ['cover', 'summary', 'editorial', 'big-number', 'comparison', 'chart', 'table', 'image-text', 'timeline', 'two-panel', 'formula-variables', 'item-icons', 'conclusion'];

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

function hasViewableFailedPages(project: Project) {
 return project.status==='failed'&&project.stage==='generation'&&Object.entries(project.runtime?.slides||{}).some(([id,state])=>state.phase==='render_ready'&&state.preview&&project.nodes?.[id]?.status==='done');
}
export function PptWorkspace() {
  const { t, locale } = useTranslation();
  const taskSummaries=useSyncExternalStore(pptTaskStore.subscribe,pptTaskStore.getSnapshot,pptTaskStore.getServerSnapshot);
  const [projects, setProjects] = useState<Project[]>([]);
  const [trashed, setTrashed] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const openedProjectRef=useRef<string|null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSlideId, setEditorSlideId] = useState<string | undefined>();
  const [generationEditOpen, setGenerationEditOpen] = useState(false);
  const [generationEdit, setGenerationEdit] = useState<{ projectId: string; slideId: string } | null>(null);
  const [interactive,setInteractive]=useState(false);
  useEffect(()=>setInteractive(true),[]);
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
  const selectionAnchor = useRef<string | null>(null);
  const [failureDetailsOpen,setFailureDetailsOpen]=useState(false);
  const shownFailure=useRef('');
  useEffect(()=>{
    if(selected?.status!=='failed'||!selected.error){setFailureDetailsOpen(false);return;}
    const key=JSON.stringify([selected.id,selected.failure?.at,selected.error]);
    if(shownFailure.current!==key){shownFailure.current=key;setFailureDetailsOpen(true);}
  },[selected?.id,selected?.status,selected?.error,selected?.failure?.at]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [confirmation, setConfirmation] = useState<{ title: string; message: string; action: () => void } | null>(null);
  const [loading, setLoading] = useState(true);
  const [countsReady,setCountsReady]=useState(false);
  const [loadErrors,setLoadErrors]=useState<Record<string,string>>({});
  const refreshSequence=useRef<Record<string,number>>({});
  const modelsSequence=useRef(0);
  const templatesSequence=useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A refused confirm/generate is shown beside its button with the pages it names
  // (3197, 2026-11-03: a 409 at the top of a scrolled page read as a dead button).
  const [confirmRefusal, setConfirmRefusal] = useState<{ message: string; pages: number[] } | null>(null);
  const lastError = useRef<(Error & { issues?: { pageIndex?: number }[] }) | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [modelsLoading,setModelsLoading]=useState(true);
  const [executionPolicy,setExecutionPolicy]=useState<PptExecutionPolicy>(initialExecutionPolicy);
  useEffect(()=>{try{const saved=localStorage.getItem('ppt-execution-policy-v1');if(saved){const value=JSON.parse(saved);if(value.version===1&&['fast','balanced','rigorous'].includes(value.qualityLevel)&&value.roleRoutes&&value.budget)setExecutionPolicy(value);}}catch{}},[]);
  function changeExecutionPolicy(policy:PptExecutionPolicy){setExecutionPolicy(policy);localStorage.setItem('ppt-execution-policy-v1',JSON.stringify(policy));}

  const [flowModelKey, setFlowModelKey] = useState('');
  const [preferredModelKey, setPreferredModelKey] = useState('');
  const [updateModelKey, setUpdateModelKey] = useState('');
  const [resumeCreateProject,setResumeCreateProject]=useState<Project|null>(null);
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

  async function retryResource(resource:string){
    if(resource==='models'){window.dispatchEvent(new Event('ppt-refresh-models'));return;}
    if(resource==='templates'){
      const account=pptTaskStore.beginRequest(),sequence=++templatesSequence.current,current=()=>sequence===templatesSequence.current&&pptTaskStore.isCurrent(account);
      try{const result=await api<{templates:PptTemplate[]}>('templates');if(current()){setTemplateOptions(result.templates);setLoadErrors(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>key!==resource)));}}catch(reason){if(current())setLoadErrors(previous=>({...previous,[resource]:(reason as Error).message}));}return;
    }
    await refresh(resource);
  }
  const refresh = useCallback(async (only?:string) => {
    const resources=only?[only]:['projects','trash','folders'];
    const versions=Object.fromEntries(resources.map(resource=>[resource,refreshSequence.current[resource]=(refreshSequence.current[resource]||0)+1]));
    const request=pptTaskStore.beginRequest();
    const current=(resource:string)=>versions[resource]!==undefined&&versions[resource]===refreshSequence.current[resource]&&pptTaskStore.isCurrent(request);
    const failed=(resource:string,reason:unknown)=>{if(current(resource))setLoadErrors(previous=>({...previous,[resource]:reason instanceof Error?reason.message:String(reason)}));};
    setLoadErrors(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>!resources.includes(key))));
    await Promise.allSettled([
      (!only||only==='projects'?api<{projects:Project[]}>('projects','?view=workspace'):Promise.resolve(null)).then(active=>{if(!active||!current('projects'))return;pptTaskStore.set(active.projects,request);setProjects(pptTaskStore.getSnapshot());setCountsReady(true);}).catch(reason=>{failed('projects',reason);if(current('projects')&&reason?.status===401){pptTaskStore.clear();setCountsReady(false);setProjects([]);setFolders([]);setTrashed([]);setSelected(null);}}).finally(()=>{if(versions.projects!==undefined&&versions.projects===refreshSequence.current.projects)setLoading(false);}),
      (!only||only==='trash'?api<{projects:Project[]}>('projects','?trash=1'):Promise.resolve(null)).then(value=>{if(value&&current('trash'))setTrashed(value.projects);}).catch(reason=>failed('trash',reason)),
      (!only||only==='folders'?api<{folders:Folder[]}>('folders'):Promise.resolve(null)).then(value=>{if(value&&current('folders'))setFolders(value.folders);}).catch(reason=>failed('folders',reason)),
    ]);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(()=>{if(pptTaskStore.isReady()){setProjects(taskSummaries);setCountsReady(true);}else{setCountsReady(false);}},[taskSummaries]);
  useEffect(() => { const onFocus = () => { void refresh(); }; window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus); }, [refresh]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (view==='list' && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setView('list'); setTab('all'); setFolderId(null); setTimeout(() => searchRef.current?.focus(), 0); }
      if (presentation !== null) {
        if (event.key === 'Escape') setPresentation(null);
        if (event.key === 'ArrowRight') setPresentation(n => n === null ? null : Math.min(n + 1, slides.length - 1));
        if (event.key === 'ArrowLeft') setPresentation(n => n === null ? null : Math.max(n - 1, 0));
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [presentation, slides.length,view]);
  useEffect(() => { if (!dirty) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [dirty]);
  useEffect(() => {
    let disposed=false;
    const refreshModels = () => {setModelsLoading(true);setLoadErrors(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>key!=='models')));const sequence=++modelsSequence.current,account=pptTaskStore.beginRequest();const current=()=>sequence===modelsSequence.current&&pptTaskStore.isCurrent(account);return Promise.all(['/api/providers','/api/providers/models'].map(async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();}).concat([fetch('/api/providers/options?providerId=__global__',{signal:AbortSignal.timeout(15000)}).then(async response=>response.ok?response.json():{options:{}}).catch(()=>({options:{}}))])).then(([p, m, defaults]) => {
      if(!current())return;
      const available = new Map<string, { name: string; configId: string }>((p.providers || [])
        .filter((x: { source?: string; protocol?: string; api_key?: string }) => x.source === 'managed' || Boolean(x.api_key) && ['openai-compatible', 'anthropic', 'google', 'openrouter'].includes(x.protocol || ''))
        .map((x: { id: string; name: string; managed_config_id?: string; source?: string }) => [x.id, {
          name: x.name,
          // managed_config_id is the account backend's canonical credential lookup key.
          // Older local records lacked it, so preserve the old ID convention as a fallback.
          configId: x.source === 'managed' ? x.managed_config_id || x.id.replace(/^managed-/, '') : `byok:${x.id}`,
        }]));
      const rows: Model[] = (m.groups || []).flatMap((group: { provider_id: string; sdkProxyOnly?: boolean; models?: { value: string; label?: string; capabilities?:PptModelCapabilities; contextWindow?:number }[] }) => {
        const provider = available.get(group.provider_id); if (!provider || provider.configId.startsWith('byok:') && group.sdkProxyOnly) return [];
        return (group.models || []).filter(model => model.value).map(model => ({ id: `${group.provider_id}::${model.value}`, name: `${provider.name} · ${model.label || model.value}`, providerId: group.provider_id, configId: provider.configId, modelId: model.value,capabilities:{...model.capabilities,contextTokens:model.contextWindow||model.capabilities?.contextTokens} }));
      });
      setModels(rows);setLoadErrors(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>key!=='models')));
      const preferred=rows.find(row=>row.providerId===defaults.options?.default_model_provider&&row.modelId===defaults.options?.default_model)?.id||'';
      setPreferredModelKey(preferred);setFlowModelKey(current=>current||preferred||rows[0]?.id||'');setUpdateModelKey(current=>current||preferred||rows[0]?.id||'');
      // Preselect the configured model while retaining the visible model gate.
    }).catch(reason => {if(current())setLoadErrors(previous=>({...previous,models:`${t('ppt.chooseModel')} (${reason?.name==='TimeoutError'?'15s timeout':reason?.message||'unavailable'})`}));}).finally(()=>{if(current())setModelsLoading(false);});};
    void refreshModels();
    // Account reset listeners may run after this component's listener. Issue
    // the request after the event so its ticket uses the final account epoch.
    const providerChanged=()=>queueMicrotask(()=>{if(!disposed)void refreshModels();});
    window.addEventListener('provider-changed', providerChanged);window.addEventListener('focus',refreshModels);window.addEventListener('ppt-refresh-models',refreshModels);
    return () => {disposed=true;modelsSequence.current++;window.removeEventListener('provider-changed', providerChanged);window.removeEventListener('focus',refreshModels);window.removeEventListener('ppt-refresh-models',refreshModels);};
  }, [t]);
  useEffect(()=>{const reset=()=>{pptTaskStore.clear();setProjects([]);setTrashed([]);setFolders([]);setTemplateOptions([]);setModels([]);setLoadErrors({});setFlowModelKey('');setUpdateModelKey('');setPreferredModelKey('');setCountsReady(false);setLoading(true);setSelected(null);setView('list');setEditorOpen(false);setGenerationEdit(null);setGenerationEditOpen(false);window.dispatchEvent(new Event('provider-changed'));void refresh();const account=pptTaskStore.beginRequest(),sequence=++templatesSequence.current;void api<{templates:PptTemplate[]}>('templates').then(result=>{if(sequence===templatesSequence.current&&pptTaskStore.isCurrent(account))setTemplateOptions(result.templates);}).catch(reason=>{if(sequence===templatesSequence.current&&pptTaskStore.isCurrent(account))setLoadErrors(previous=>({...previous,templates:reason.message}));});};const off=window.electronAPI?.auth?.onChange(reset);return()=>off?.();},[refresh]);
  useEffect(() => {
    let current = true;const account=pptTaskStore.beginRequest(),sequence=++templatesSequence.current;
    api<{ templates: PptTemplate[] }>('templates').then(result => {
      if (current&&sequence===templatesSequence.current&&pptTaskStore.isCurrent(account)) setTemplateOptions(result.templates);
    }).catch(reason => {if(current&&sequence===templatesSequence.current&&pptTaskStore.isCurrent(account))setLoadErrors(previous=>({...previous,templates:reason.message}));});
    return () => { current = false; };
  }, [view]);
  useEffect(() => {
    if (!selected) return;
    try {
      const prefix = `ppt-generation-draft:${selected.id}:`;
      const key = Object.keys(sessionStorage).find(item => item === `${prefix}conversation`) || Object.keys(sessionStorage).find(item => item.startsWith(prefix));
      if (key) setGenerationEdit({ projectId: selected.id, slideId: JSON.parse(sessionStorage.getItem(key) || 'null')?.snapshot?.currentSlideId || key.slice(prefix.length) });
    } catch {}
  }, [selected?.id]);
  const updateSelected = useCallback((value: StructuredProjectView) => {
    const project = value as Project; setSelected(project);
    setProjects(current => current.map(item => item.id === project.id ? project : item));
  }, []);
  const acceptStructuredProject = useCallback((value: StructuredProjectView) => {
    const project = value as Project; setSelected(project);
    if (project.status === 'outline_ready') { setOutline(project.outline.map(slide => ({ ...slide }))); setSourceDraft(project.source?.text || ''); }
    if (['completed', 'quality_blocked'].includes(project.status)||hasViewableFailedPages(project)) { setSlides(structuredClone(project.deck?.slides || [])); setEditorOpen(true); }
    setProjects(current => current.map(item => item.id === project.id ? project : item));
  }, []);

  // A retry started from Home/another tab must reconnect this selected detail.
  // Summaries are not editor content: fetch the fresh projection, and never
  // replace local unsaved copy or switch the selected project.
  useEffect(() => {
    if (!selected || dirty) return;
    const summary = taskSummaries.find(item => item.id === selected.id);
    if (!summary || (summary.status === selected.status && summary.currentRunId === selected.currentRunId)) return;
    let current = true;
    void api<{project: Project}>('projects', `/${selected.id}?view=live`).then(({project}) => {
      if (!current) return;
      updateSelected(project);
      if (['generating','paused'].includes(project.status)||hasViewableFailedPages(project)||['completed','quality_blocked'].includes(project.status)&&['generating','paused','failed'].includes(selected.status)) setEditorOpen(true);
    }).catch(() => {});
    return () => { current = false; };
  }, [selected?.id, selected?.status, selected?.currentRunId, dirty, taskSummaries, updateSelected]);

  const visible = useMemo(() => {
    let rows = tab === 'trash' ? [...trashed] : projects.filter(isLibraryPresentation);
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
      const result = await api<{ project: Project }>('projects', `/${project.id}?view=live`);
      const fresh = result.project;
      openedProjectRef.current=fresh.id;
      setSelected(fresh); setTitle(fresh.title); setOutline(fresh.outline.map(s => ({ ...s })));
      setSlides(structuredClone(fresh.deck?.slides || [])); undoHistory.current = []; redoHistory.current = []; setEditorSearch(''); setAiSlideId(null);
      setSourceDraft(fresh.source?.text || ''); setDirty(false); setEditorOpen(['completed', 'quality_blocked'].includes(fresh.status) || hasViewableFailedPages(fresh)); setError(''); setView('detail');
      // A card outline is shown in its own view while it is written, too.
      const cardOutline=Boolean(fresh.planningContract)&&Boolean(fresh.inputUnderstanding)&&fresh.status==='outlining';
      if(fresh.generationPolicy?.version===2&&(cardOutline||['input_ready','outline_ready'].includes(fresh.status)||fresh.status==='failed'&&fresh.stage==='outline'&&Boolean(fresh.inputUnderstanding)&&(fresh.outline.length>0||Boolean(fresh.planningContract)))){setResumeCreateProject(fresh);setCreateKind('paste');setLockedTemplate(null);setCreateEntry('new');setFlowModelKey(models.find(m=>m.configId===fresh.configId&&m.modelId===fresh.model)?.id||'');setView('create');}
      history.replaceState(null,'',`/ppt?projectId=${fresh.id}`);
      setPreviewPage(0);
      api<{ versions: { id: string; title: string; number: number; status: string }[] }>('projects', `/${fresh.id}/versions`)
        .then(result => setVersions(result.versions)).catch(() => setVersions([]));
    } catch (e) { setError((e as Error).message); }
  }
  // A source recreated from a saved project may still be ingesting when
  // its URL opens. Resume the creation flow as soon as reading finishes.
  useEffect(()=>{
    if(view==='detail'&&!dirty&&selected?.status==='input_ready'&&selected.generationPolicy?.version===2)void openProject(selected,true);
    // openProject updates view synchronously after its bounded fetch; including
    // its render-local identity would trigger duplicate reopen requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[view,dirty,selected?.id,selected?.status]);
  useEffect(()=>{if(resumeCreateProject&&models.length)setFlowModelKey(models.find(m=>m.configId===resumeCreateProject.configId&&m.modelId===resumeCreateProject.model)?.id||'');},[resumeCreateProject,models]);
  const linkedProjectId=useSearchParams().get('projectId');
  useEffect(() => { if(linkedProjectId&&/^[a-f0-9]{32}$/i.test(linkedProjectId)&&linkedProjectId!==openedProjectRef.current) void openProject({id:linkedProjectId} as Project); }, [linkedProjectId]);
  function back(discard = false) { if (dirty && !discard) { requestConfirm(t('ppt.unsaved'), t('ppt.unsaved'), () => back(true)); return; } setDirty(false); setEditorOpen(false); setError(''); setView('list'); setSelected(null); openedProjectRef.current=null; history.replaceState(null,'','/ppt'); void refresh(); }
  function startNew() {
    setResumeCreateProject(null);
    setCreateEntry('new'); setLockedTemplate(null); setCreateKind(undefined); setView('list'); setFlowModelKey(preferredModelKey||models[0]?.id||''); setCreateChooserOpen(true); setLlmGate(null);
  }
  function startDirectImport() {
    setCreateEntry('direct'); setLockedTemplate(null); setCreateKind('file'); setFlowModelKey(preferredModelKey||models[0]?.id||''); setCreateChooserOpen(false); setLlmGate('new');
  }
  function startTemplate(templateValue: PptTemplate) {
    setResumeCreateProject(null);
    setCreateEntry('template'); setLockedTemplate(templateValue); setTemplate(templateValue.id); setTemplateOptions(current => [...current.filter(item => item.id !== templateValue.id), templateValue]); setCreateKind(undefined); setView('list'); setFlowModelKey(preferredModelKey||models[0]?.id||''); setCreateChooserOpen(true); setLlmGate(null);
  }
  function startUpdate(baseId: string | null = null) {
    setM3BaseId(baseId); setUpdateModelKey(preferredModelKey||models[0]?.id||''); setLlmGate('update');
  }
  function confirmLlmGate() {
    if (llmGate === 'update') { if (!updateModelKey) return; setLlmGate(null); setView('update'); return; }
    if (!flowModelKey) return;
    setLlmGate(null); setView('create');
  }
  function changeSlides(next: Slide[]) {
    undoHistory.current = [...undoHistory.current.slice(-19), structuredClone(slides)];
    redoHistory.current = [];
    setSlides(next); setDirty(true);
  }
  function undo() { const previous = undoHistory.current.pop(); if (!previous) return; redoHistory.current.push(structuredClone(slides)); setSlides(previous); setDirty(true); }
  function redo() { const next = redoHistory.current.pop(); if (!next) return; undoHistory.current.push(structuredClone(slides)); setSlides(next); setDirty(true); }
  async function run(task: () => Promise<void>) { setBusy(true); setError(''); lastError.current = null; try { await task(); } catch (e) { lastError.current = e as Error; setError((e as Error).message); } finally { setBusy(false); } }
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
  const [formingOutline,setFormingOutline]=useState<Project|null>(null);
  // Title and model are not part of the reading: apply them to the existing
  // draft instead of starting a new one (the outline is kept).
  async function syncDraftMeta(current: Project, value: PptCreateDraft, model: Model) {
    let latest = current;
    const title = value.title.trim();
    if (title && title !== latest.title) latest = (await api<{ project: Project }>('projects', `/${latest.id}`, 'PATCH', { title })).project;
    const beforeGeneration = ['input_ready', 'outline_ready'].includes(latest.status) || latest.status === 'failed' && ['ingest', 'input', 'outline'].includes(latest.stage || '');
    if (beforeGeneration && (model.configId !== latest.configId || model.modelId !== latest.model))
      latest = (await api<{ project: Project }>('projects', `/${latest.id}`, 'PATCH', { configId: model.configId, model: model.modelId })).project;
    return latest;
  }
  // A draft superseded by new input: stop its run and retire its record.
  async function discardDraft(projectId: string) {
    await api('projects', `/${projectId}/discard`, 'POST', {});
    void refresh('projects');
  }
  async function analyzeDraft(value: PptCreateDraft, signal?: AbortSignal) {
    // A superseded analysis must not show its outline in the wizard.
    const checkAborted = () => { if (signal?.aborted) throw pptAbortError(); };
    setFormingOutline(null);
    const model = models.find(row => row.id === value.modelKey);
    if (!model) throw new Error(t('ppt.chooseModel'));
    if (value.executionPolicy||model.configId.startsWith('byok:')) await requirePptByokCapabilities(fetch,{executionPolicy:Boolean(value.executionPolicy),vision:false});
    let id = value.analyzedProjectId;let lastKnown:Project|null=null;
    if (id) {
      let current=(await api<{project:Project}>('projects', `/${id}?view=live`)).project;
      checkAborted();current=await syncDraftMeta(current,value,model);checkAborted();lastKnown=current;
      const retrySameFailed=current.status==='failed'&&current.stage==='outline'&&current.template===value.template&&current.configId===model.configId&&current.model===model.modelId&&JSON.stringify(current.generationPolicy)===JSON.stringify(value.generationPolicy)&&(value.pageSource==='estimate'?current.pageDecision?.mode==='auto':current.pageDecision?.mode==='explicit'&&current.pages===value.pages);
      if(current.status==='failed'&&!retrySameFailed&&!value.outline?.length){await discardDraft(current.id).catch(()=>{});id=undefined;}
      else if(retrySameFailed)await api('projects', `/${id}/retry`, 'POST', {});
    }
    if(!id){
      const result = await api<{ project: Project }>('projects', '', 'POST', {
        planningFlow:value.planningFlow, readOnlyInput:value.readOnlyInput, inputKind: value.inputKind, title: value.title.trim() || undefined, prompt: value.prompt.trim() || undefined,
        text: value.inputKind === 'paste' ? value.text : undefined,
        fileName: value.inputKind === 'file' ? value.file?.name : undefined,
        fileBase64: value.inputKind === 'file' && value.file ? await fileBase64(value.file) : undefined,
        images: value.images,
        pages: value.pageSource === 'estimate' ? undefined : value.pages,
        templateContentMode: value.templateContentMode,templateFixedObjectIds:value.templateFixedObjectIds, executionPolicy:value.executionPolicy, generationPolicy: value.generationPolicy, template: value.template, configId: model.configId, model: model.modelId,
      });
      id = result.project.id;lastKnown=result.project;
    }
    checkAborted();
    const projectId = id;
    const project = await pollOutlineProject<Project>({
      read: async () => (await api<{ project: Project }>('projects', `/${projectId}?view=live`)).project,
      initial: lastKnown, signal, onProgress: setFormingOutline,
      // A card outline that is forming hands over to the card page, which
      // shows each topic's cards as they are written (Gamma, 2026-10-31).
      settled: current => current.status === 'outlining' && Boolean(current.outlineForming && current.inputUnderstanding),
      failedMessage: '大纲生成失败，请重试', timeoutMessage: '大纲生成超时，请到工作区任务中查看进度',
    });
    await refresh();
    return { id: projectId, pages: project.pages, project,
      recommendation: project.generationPolicy?.version===2&&project.inputUnderstanding ? {...project.inputUnderstanding,assumptions:project.planning?.pageRecommendation?.assumptions} : project.planning?.pageRecommendation ? {
        recommended: project.planning.pageRecommendation.recommended,
        min: project.planning.pageRecommendation.range[0], max: project.planning.pageRecommendation.range[1],
        reason: project.planning.pageRecommendation.reason,
        reasonBase: project.planning.pageRecommendation.reasonBase,
        assumptions: project.planning.pageRecommendation.assumptions,
      } : project.status==='input_ready'&&project.inputUnderstanding ? {recommended:project.inputUnderstanding.recommended,min:project.inputUnderstanding.min,max:project.inputUnderstanding.max,reason:project.inputUnderstanding.reason} : undefined,
      outline: project.outline.map(slide => ({
      ...slide, id: slide.id, section: slide.section || slide.title, title: slide.title,
      focus: slide.focus || slide.title, description: slide.description || '',
      children: slide.children || [],
    })) };
  }
  async function create(draft?: PptCreateDraft) {
    setConfirmRefusal(null);
    const value: PptCreateDraft = draft || { inputKind, title, prompt, text: sourceText, file, importMode, pages, compressionApproved: false, template, modelKey: flowModelKey, images: pasteImages };
    const editablePptx = value.inputKind === 'file' && value.file?.name.toLowerCase().endsWith('.pptx') && value.importMode === 'editable';
    const model = models.find(row => row.id === value.modelKey);
    // Never a silent no-op: a model list that failed to load says so (2026-10-27, 3157).
    // A refusal before any request is shown beside the card outline's button too (it covers the banner).
    const refuse = (message: string) => { setError(message); setConfirmRefusal({ message, pages: [] }); };
    if (!model && !editablePptx) { refuse(t(models.length ? 'ppt.quality.noModels' : 'ppt.create.modelsNotLoaded')); return; }
    if (value.executionPolicy||model?.configId.startsWith('byok:')) {
      try { await requirePptByokCapabilities(fetch,{executionPolicy:Boolean(value.executionPolicy),vision:false}); }
      catch (error) { refuse(error instanceof Error ? error.message : 'PPT 服务连接失败。'); return; }
    }
    await run(async () => {
      const filePayload = value.inputKind === 'file' && value.file && !value.analyzedProjectId ? await fileBase64(value.file) : undefined;
      if (value.analyzedProjectId && model) await syncDraftMeta((await api<{ project: Project }>('projects', `/${value.analyzedProjectId}?view=live`)).project, value, model);
      const { project } = value.analyzedProjectId
        ? await api<{ project: Project }>('projects', `/${value.analyzedProjectId}/outline`, 'PATCH', {
          slides: value.outline, finalPageCount: value.pages, pageSource: value.pageSource, template: value.template, compressionApproved: value.compressionApproved, executionPolicy:value.executionPolicy, generationPolicy: value.generationPolicy,
        })
        : await api<{ project: Project }>('projects', '', 'POST', {
        inputKind: value.inputKind, title: value.title.trim() || undefined, prompt: value.prompt.trim() || undefined,
        text: value.inputKind === 'paste' ? value.text : undefined, fileName: value.inputKind === 'file' ? value.file?.name : undefined,
        images: value.images, fileBase64: filePayload, importMode: value.inputKind === 'file' && value.file?.name.toLowerCase().endsWith('.pptx') ? value.importMode : undefined,
        pages: value.pages,
        compressionApproved: value.compressionApproved, outline: value.outline,
        templateContentMode: value.templateContentMode,templateFixedObjectIds:value.templateFixedObjectIds, executionPolicy:value.executionPolicy, generationPolicy: value.generationPolicy, template: value.template, configId: model?.configId || 'pptx-import', model: model?.modelId || '',
      });
      let nextProject = project;
      if (!editablePptx) {
        const started = await api<{ project: Project }>('projects', `/${project.id}/generate`, 'POST');
        nextProject = started.project;
      }
      setProjects(prev => [nextProject, ...prev.filter(item => item.id !== nextProject.id)]);
      setSelected(nextProject); setTitle(nextProject.title); setOutline(nextProject.outline.map(slide => ({ ...slide })));
      setSlides(structuredClone(nextProject.deck?.slides || [])); setSourceDraft(nextProject.source?.text || ''); setDirty(false); setEditorOpen(['completed', 'quality_blocked'].includes(nextProject.status) || hasViewableFailedPages(nextProject)); setView('detail');
    });
    // A refused generate is shown in the card outline beside its button (it covers this page's banner).
    if (lastError.current) setConfirmRefusal(refusalOf(lastError.current));
  }
  async function mutate(path: string, method: string, payload?: unknown) {
    if (!selected) return false;
    let success = false;
    await run(async () => {
      const { project } = await api<{ project: Project }>('projects', `/${selected.id}${path}`, method, payload);
      acceptStructuredProject(project);
      if (['completed', 'quality_blocked'].includes(project.status)||hasViewableFailedPages(project)) { setSlides(structuredClone(project.deck?.slides || [])); setDirty(false); }
      if (path === '/source') { setOutline([]); setSourceDraft(project.source?.text || ''); }
      success = true;
    });
    return success;
  }
  async function confirmOutline() {
    if (!selected || outlineNeedsRepair(selected, outline)) return;
    setConfirmRefusal(null);
    const ok = await mutate('/outline', 'PATCH', { slides: outline, finalPageCount: outline.length }) && await mutate('/generate', 'POST');
    if (!ok && lastError.current) setConfirmRefusal(refusalOf(lastError.current));
  }
  /** The pages a refusal names: its issues' page indexes, else "pages 3, 7" in its message. */
  function refusalOf(failure: Error & { issues?: { pageIndex?: number }[] }) {
    const fromIssues = (failure.issues || []).map(issue => Number(issue.pageIndex) + 1).filter(page => Number.isInteger(page) && page > 0);
    const fromText = (/\bpages?\s+([\d,\s]+)/iu.exec(failure.message)?.[1] || '').split(/[,\s]+/u).map(Number).filter(page => Number.isInteger(page) && page > 0);
    return { message: failure.message, pages: [...new Set(fromIssues.length ? fromIssues : fromText)].sort((a, b) => a - b) };
  }
  function goToOutlinePage(page: number) {
    const card = document.getElementById(`ppt-outline-page-${page}`);
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')?.focus({ preventScroll: true });
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
  function selectProject(id: string, selected: boolean, range: boolean) {
    const anchor = visible.findIndex(project => project.id === selectionAnchor.current);
    const end = visible.findIndex(project => project.id === id);
    const ids = range && anchor >= 0 && end >= 0 ? visible.slice(Math.min(anchor, end), Math.max(anchor, end) + 1).map(project => project.id) : [id];
    setChecked(previous => selected ? [...new Set([...previous, ...ids])] : previous.filter(value => !ids.includes(value)));
    selectionAnchor.current = id;
  }
  useEffect(() => { const clear = (event: KeyboardEvent) => { if (event.key === 'Escape' && view === 'list' && !dialog && !confirmation) { setChecked([]); selectionAnchor.current = null; } }; window.addEventListener('keydown', clear); return () => window.removeEventListener('keydown', clear); }, [view, dialog, confirmation]);
  function requestTaskDeletion(tasks: Project[]) {
    const targets=[...new Map(tasks.map(project=>[project.id,project])).values()];
    if (!targets.length || busy) return;
    const account=pptTaskStore.beginRequest();
    requestConfirm(t('ppt.task.deleteRecord'),t('ppt.task.deleteConfirm',{count:targets.length}),()=>void run(async()=>{
      const succeeded=new Set<string>(),failed:string[]=[];
      for (const project of targets) {
        if (!pptTaskStore.isCurrent(account)) return;
        try { await api('projects',`/${project.id}/task-record`,'DELETE'); succeeded.add(project.id); }
        catch (error) { failed.push(`${project.title}: ${error instanceof Error?error.message:String(error)}`); }
      }
      if (!pptTaskStore.isCurrent(account)) return;
      if (succeeded.size) {
        const deletedAt=new Date().toISOString();
        const retainFile=(project:Project)=>succeeded.has(project.id)?{...project,taskDeletedAt:deletedAt,taskEligible:false}:project;
        pptTaskStore.set(pptTaskStore.getSnapshot().map(retainFile));
        setProjects(previous=>previous.map(retainFile));
      }
      await refresh('projects');
      if (failed.length && pptTaskStore.isCurrent(account)) setError(t('ppt.task.bulkDeletePartial',{count:failed.length})+' '+failed.join('; '));
    }));
  }
  async function performBulk(action:string,folderId?:string|null) {
    const ids=[...checked];
    const result=await api<{succeeded?:string[];failed?:{id:string;error:string}[]}>('projects','/bulk','POST',{action,ids,folderId});
    const succeeded=result.succeeded||ids;
    setChecked(previous=>previous.filter(id=>!succeeded.includes(id)));
    if(result.failed?.length)setError(t('ppt.workspace.partialFailure',{count:result.failed.length})+' '+result.failed.map(item=>item.error).join('; '));
  }
  async function bulk(kind: string, targetFolder?: string | null) {
    if (!checked.length) return;
    if (kind === 'trash') { requestConfirm(t('ppt.delete'), t('ppt.deleteConfirm'), () => void bulk('trash-confirmed', targetFolder)); return; }
    if (kind === 'permanent') { requestConfirm(t('ppt.permanent'), t('ppt.permanentConfirm'), () => void bulk('permanent-confirmed', targetFolder)); return; }
    if (kind.endsWith('-confirmed')) kind = kind.replace('-confirmed', '');
    await run(async () => { await performBulk(kind,targetFolder); setDialog(null); await refresh(); });
  }
  async function submitDialog() {
    if (!dialog) return;
    await run(async () => {
      if (dialog.type === 'createFolder') await api('folders', '', 'POST', { name: dialog.value });
      if (dialog.type === 'renameFolder') await api('folders', `/${dialog.id}`, 'PATCH', { name: dialog.value });
      if (dialog.type === 'renameProject') await api('projects', `/${dialog.id}`, 'PATCH', { title: dialog.value });
      if (dialog.type === 'move') {
        if (checked.length) await performBulk('move',dialog.value||null);
        else if (dialog.id) await api('projects', `/${dialog.id}`, 'PATCH', { folderId: dialog.value || null });
      }
      setDialog(null); await refresh();
    });
  }
  const sourceDirty = selected?.inputKind === 'paste' && sourceDraft !== (selected.source?.text || '');
  const hasIncompleteImage = slides.some(slide => slide.blocks?.some(block => block.type === 'image' && !block.dataUrl));
  const libraryProjects = projects.filter(isLibraryPresentation);
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
  const renderRail = (mobile: boolean) => <PptWorkspaceRail mobile={mobile} countsReady={countsReady} folders={folders.map(folder=>({...folder,count:libraryProjects.filter(project=>project.folderId===folder.id).length}))} projects={projects} trashCount={trashed.length} view={view} tab={tab} folderId={folderId}
    onNav={item => { setError(''); setView('list'); setTab(item); setFolderId(null); setChecked([]); setMobileNavOpen(false); }}
    onTemplates={() => { setView('templates'); setMobileNavOpen(false); }} onTasks={() => { setView('tasks'); setMobileNavOpen(false); }}
    onFolder={id => { setError(''); setView('list'); setTab('all'); setFolderId(id); setChecked([]); setMobileNavOpen(false); }}
    onNewFolder={() => setDialog({ type: 'createFolder', value: '' })}
    onRenameFolder={folder => setDialog({ type: 'renameFolder', id: folder.id, value: folder.name })}
    onPinFolder={folder => { void run(async () => { await api('folders', `/${folder.id}`, 'PATCH', { pinned: !folder.pinned }); await refresh(); }); }}
    onDeleteFolder={folder => requestConfirm(t('ppt.delete'), t('ppt.folderDeleteConfirm'), () => void run(async () => { await api('folders', `/${folder.id}`, 'DELETE'); setFolderId(null); await refresh(); }))}
    onReorderFolder={(moved, target) => void reorderFolder(moved, target)} />;
  const workspaceRail = renderRail(false);

  return <main inert={!interactive} data-ppt-interactive={interactive?'true':'false'} className="ppt-prototype ppt-workspace-shell h-full overflow-y-auto bg-background text-foreground">
    <div className="ppt-workspace-frame min-h-full space-y-6 p-4 xl:p-0">
      {Object.entries(loadErrors).map(([resource,message])=><div key={resource} role="alert" className="rounded border border-destructive/40 p-3 text-sm">{t('ppt.workspace.loadFailed')} ({resource}): {message}<button className="ml-3 text-primary" onClick={()=>void retryResource(resource)}>{t('ppt.retry')}</button></div>)}
      {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{pptFailureMessage(error,locale)}</div>}
      {['list', 'templates', 'tasks'].includes(view) && <button className="rounded-lg border border-border px-3 py-2 text-sm xl:hidden" aria-label={t('ppt.workspaceNav.open')} onClick={() => setMobileNavOpen(true)}>☰ PPT Workspace</button>}
      {mobileNavOpen && <div className="fixed inset-0 z-[65] bg-black/60 p-4 xl:hidden" role="dialog" aria-modal="true" aria-label={t('ppt.workspaceNav.label')}><div className="max-w-xs space-y-2"><button className="ml-auto block rounded-lg border border-border bg-card px-3 py-1" aria-label={t('ppt.workspaceNav.close')} onClick={() => setMobileNavOpen(false)}>×</button>{renderRail(true)}</div></div>}
      {view === 'list' && <div className="ppt-workspace-grid grid min-h-[calc(100vh-7rem)] gap-6 xl:grid-cols-[218px_minmax(0,1fr)]">
        {workspaceRail}
        <section className="ppt-workspace-content min-w-0 space-y-5"><div className="ppt-workspace-header sticky top-0 z-20 space-y-4 bg-background/95 pb-4 backdrop-blur"><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-wider text-primary">Workspace / PPT Workspace</div><h1 className="mt-2 text-2xl font-semibold">{folderId ? folders.find(f=>f.id===folderId)?.name : tab === 'trash' ? t('ppt.tab.trash') : tab==='favorites'?t('ppt.tab.favorites'):tab==='all'?t('ppt.tab.all'):t('ppt.tab.recent')}</h1>{tab === 'trash' && <p className="mt-1 text-sm text-muted-foreground">已删除的项目会在这里保留，可以恢复或永久删除。</p>}</div><div className="flex flex-wrap gap-2">{tab === 'trash' ? trashed.length > 0 && <button className={button} disabled={busy} onClick={() => { requestConfirm('清空回收站', t('ppt.clearTrashConfirm'), () => void run(async () => { for (let i = 0; i < trashed.length; i += 100) await api('projects', '/bulk', 'POST', { action: 'permanent', ids: trashed.slice(i, i + 100).map(p => p.id) }); await refresh(); })); }}>⌫ 清空</button> : <><button className={button} onClick={startDirectImport}>↥ 导入</button><button className={button} onClick={() => startUpdate()}>↻ 基于上一版更新</button><button className={primary} onClick={startNew}>＋ 新建</button></>}</div></div>{tab !== 'trash' && <><div className="rounded-xl border border-border bg-card p-3"><div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"><label className="relative"><span className="absolute left-3 top-2.5 text-muted-foreground">⌕</span><input ref={searchRef} className={`${input} pl-8`} value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索 PPT 名称或标签" aria-label="搜索 PPT" /></label><PptSelectField className={input} value={sort} onValueChange={value=>setSort(value as typeof sort)} aria-label="排序"><option value="updated">最近编辑</option><option value="created">最近创建</option><option value="name">名称 A-Z</option><option value="manual">手动排序</option></PptSelectField><div className="flex rounded-lg border border-border p-1" aria-label="视图切换"><button className={`rounded px-3 ${layout === 'grid' ? 'bg-accent' : ''}`} aria-label="网格视图" onClick={() => setLayout('grid')}>▦</button><button className={`rounded px-3 ${layout === 'list' ? 'bg-accent' : ''}`} aria-label="列表视图" onClick={() => setLayout('list')}>☷</button></div></div></div></>}{checked.length > 0 && (<div role="toolbar" aria-label="批量操作" data-testid="ppt-bulk-toolbar" className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-popover px-6 py-3 shadow-xl"><span className="whitespace-nowrap text-sm font-semibold">{t('ppt.selectionCount', { count: checked.length })}{checked.some(id=>!visible.some(p=>p.id===id))&&<small className="ml-2 text-muted-foreground">{t('ppt.selectionHidden')}</small>}</span>{tab === 'trash' ? <><button className={button} disabled={busy} onClick={() => void bulk('restore')}>{t('ppt.restore')}</button><button className={button} disabled={busy} onClick={() => void bulk('permanent')}>{t('ppt.permanent')}</button></> : <><button className={button} disabled={busy} onClick={() => setDialog({ type: 'move', value: '' })}>{t('ppt.move')}</button><button className={button} disabled={busy} onClick={() => void bulk('trash')}>{t('ppt.delete')}</button></>}<button className={button} disabled={busy} onClick={() => setChecked([])}>{t('ppt.cancelSelection')}</button></div>)}</div><div className="flex items-center justify-between"><h2 className="font-semibold">{folderId ? folders.find(f => f.id === folderId)?.name : tab === 'favorites' ? '收藏的 PPT' : tab === 'all' ? '全部 PPT' : tab === 'trash' ? '回收站' : '最近使用'}</h2><span className="text-xs text-muted-foreground">{countsReady?visible.length:'…'} 个项目 {tab==='recent'&&<button className="ml-2 text-primary" onClick={()=>setTab('all')}>{t('ppt.workspace.recentLimit')}</button>}</span></div>
          {loading ? <p>{t('ppt.loading')}</p> : visible.length === 0 ? <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground"><div className="text-3xl">⌁</div><h3 className="mt-3 font-medium text-foreground">{query ? '没有匹配结果' : '从一个新想法开始'}</h3><p className="mt-1">{query ? `没有找到与“${query}”相关的演示文稿。` : tab === 'favorites' ? '还没有收藏任何演示文稿。' : tab === 'trash' ? '删除的项目会在这里保留。' : '这个区域还没有演示文稿。'}</p>{tab !== 'trash' && <button className={`${query ? button : primary} mt-4`} onClick={() => query ? setQuery('') : startNew()}>{query ? '清除搜索' : '新建 PPT'}</button>}</div> : <div className={layout === 'grid' ? 'ppt-project-grid' : 'space-y-3'}>{visible.map(project => <article key={project.id} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-aimate-ppt-project')) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const moved = event.dataTransfer.getData('application/x-aimate-ppt-project'); if (moved && moved !== project.id) void reorderProject(moved, project.id); }} data-testid="ppt-project-card" data-selected={checked.includes(project.id)} className={`ppt-project-card relative overflow-hidden rounded-xl border border-border bg-card ${layout === 'list' ? 'flex items-center' : ''}`}><input type="checkbox" className="ppt-project-select" checked={checked.includes(project.id)} aria-label={`${t('ppt.select')} ${project.title}`} onChange={e => selectProject(project.id, e.target.checked, Boolean((e.nativeEvent as MouseEvent).shiftKey))} /><button className={`min-w-0 text-left ${layout === 'list' ? 'flex flex-1 items-center' : 'block w-full'}`} onClick={() => { if (tab !== 'trash') void openProject(project); }}><div className={`${layout === 'list' ? 'm-3 h-20 w-36 shrink-0' : 'aspect-[16/9]'} relative flex flex-col justify-between overflow-hidden p-4 ${project.templateSpec?.palette ? '' : themes[project.template] || themes.violet}`} style={project.templateSpec?.palette ? { background: project.templateSpec.palette.background, color: project.templateSpec.palette.foreground } : undefined}><PptProjectCover project={project}/></div><div className={`ppt-project-copy relative min-w-0 p-3 ${layout === 'grid' ? 'pb-12' : ''}`}><h3 title={project.title} className="truncate pr-14 font-medium">{project.title}</h3><p className="mt-2 text-xs text-muted-foreground">{pptPageLabel(project,locale,'file')} · {new Date(project.deletedAt || project.updatedAt).toLocaleDateString()}</p>{(project.tags || []).length > 0 && <div className="mt-2 flex min-w-0 flex-wrap gap-1">{project.tags?.slice(0,3).map(tag=><span key={tag} title={tag} className="max-w-32 truncate rounded bg-muted px-1.5 py-0.5 text-xs">{tag}</span>)}{(project.tags?.length||0)>3&&<span title={project.tags?.join(', ')} className="text-xs">+{project.tags!.length-3}</span>}</div>}</div></button><div className="ppt-project-meta-actions">{tab!=='trash'&&<><button className="px-2" aria-label={project.pinned ? '取消置顶' : '置顶'} onClick={() => void action(project, 'metadata', { pinned: !project.pinned })}><PptPin active={project.pinned}/></button><button className="px-2" aria-label={project.favorite ? '取消收藏' : '收藏'} onClick={() => void action(project, 'metadata', { favorite: !project.favorite })}>{project.favorite ? '★' : '☆'}</button></>}</div><div className={`${layout === 'list' ? 'mr-3' : 'absolute bottom-3 right-3'} flex shrink-0 gap-1`}>{tab === 'trash' ? <><button className={button} onClick={() => void action(project, 'restore')}>恢复</button><button className={button} onClick={() => void action(project, 'permanent')}>永久删除</button></> : <><button draggable className="cursor-grab px-2 text-muted-foreground" aria-label={`${t('ppt.order.dragProject')} ${project.title}`} title={t('ppt.order.dragProject')} onDragStart={event => { event.dataTransfer.setData('application/x-aimate-ppt-project', project.id); event.dataTransfer.effectAllowed = 'move'; }}>⋮⋮</button>{layout==='list'&&<button className={button} onClick={()=>void openProject(project)}>{t('ppt.task.open')}</button>}<DropdownMenu open={menuId===project.id} onOpenChange={open=>setMenuId(open?project.id:null)}><DropdownMenuTrigger asChild><button className="px-2" aria-label="更多操作">•••</button></DropdownMenuTrigger><DropdownMenuContent align="end" className="z-[70]"><DropdownMenuItem onSelect={()=>setDialog({type:'renameProject',id:project.id,value:project.title})}>重命名</DropdownMenuItem><DropdownMenuItem onSelect={()=>void action(project,'duplicate')}>复制项目</DropdownMenuItem><DropdownMenuItem onSelect={()=>setDialog({type:'move',id:project.id,value:project.folderId||''})}>移动文件夹</DropdownMenuItem>{project.folderId&&<DropdownMenuItem onSelect={()=>void action(project,'metadata',{folderId:null})}>从文件夹移除</DropdownMenuItem>}<DropdownMenuItem className="text-destructive" onSelect={()=>void action(project,'trash')}>删除项目</DropdownMenuItem></DropdownMenuContent></DropdownMenu></>}</div></article>)}</div>}
        </section>
      </div>}
      {view === 'tasks' && <div className="ppt-workspace-grid grid min-h-[calc(100vh-7rem)] gap-6 xl:grid-cols-[218px_minmax(0,1fr)]">{workspaceRail}<PptTaskCenter onOpenTrash={()=>{setTab('trash');setFolderId(null);setView('list');}} projects={projects} busy={busy} onDelete={project=>requestTaskDeletion([project])} onDeleteMany={requestTaskDeletion} onOpen={project => void openProject(project)} onRetry={project => void run(async () => { const result = await api<{ project: Project }>('projects', `/${project.id}/retry`, 'POST'); acceptStructuredProject(result.project); setSelected(result.project); setView('detail'); })} /></div>}
      {view === 'templates' && <div className="ppt-workspace-grid grid min-h-[calc(100vh-7rem)] gap-6 xl:grid-cols-[218px_minmax(0,1fr)]">{workspaceRail}<PptM3 mode="templates" projects={projects} models={models}
        baseProjectId={m3BaseId} onUseTemplate={(_, item) => startTemplate(item)}
        onCreated={project => { void refresh(); void openProject(project as Project); }} onBack={() => back()} /></div>}
      {view === 'update' && <PptM3 executionPolicy={bindExecutionPolicy(executionPolicy,models,updateModelKey)} mode="update" projects={projects} models={models} modelKey={updateModelKey}
        baseProjectId={m3BaseId} onUseTemplate={(_, item) => startTemplate(item)} onBackToLlm={() => setLlmGate('update')}
        onCreated={project => { void refresh(); void openProject(project as Project); }} onBack={() => {setTab('recent');setFolderId(null);back();}} />}
      {view === 'create' && <PptCreateWizard submitRefusal={confirmRefusal} modelsLoading={modelsLoading} modelsError={loadErrors.models} onRetryModels={()=>void retryResource('models')} resumeProject={resumeCreateProject} executionPolicy={resumeCreateProject?.executionPolicy||bindExecutionPolicy(executionPolicy,models,flowModelKey)} key={resumeCreateProject?.id||createKind} models={models} templates={templateOptions} initialKind={createKind} entry={createEntry} modelKey={flowModelKey} onModelKeyChange={setFlowModelKey} lockedTemplate={lockedTemplate} busy={busy} onCancel={() => { setCreateKind(undefined); setTab('recent'); setFolderId(null); back(); }} onBackToModel={() => setLlmGate(createEntry === 'template' ? 'template' : 'new')} onEstimate={async (draft, signal) => { const response = await fetch('/api/ppt/page-estimate', { method: 'POST', headers: { 'content-type': 'application/json' }, signal, body: JSON.stringify({ inputKind: draft.inputKind, prompt: draft.prompt, text: draft.text, fileBytes: draft.file?.size, template: draft.template, generationPolicy: draft.generationPolicy }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result.recommendation; }} onBackToChooser={() => { setCreateChooserOpen(true); }} onAnalyze={analyzeDraft} onDiscard={discardDraft} formingOutline={formingOutline} onSubmit={async draft => { await create(draft); }} />}
      {view === 'detail' && selected && ['completed', 'quality_blocked'].includes(selected.status) && !editorOpen && <div className="fixed inset-0 z-40 bg-black/55" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) back(); }}><aside className="ml-auto flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="ppt-project-detail-title"><header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5"><h2 id="ppt-project-detail-title" className="font-semibold">项目详情</h2><button className="grid h-8 w-8 place-items-center rounded-lg border border-border" aria-label="关闭" onClick={() => back()}>×</button></header><div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="relative aspect-video overflow-hidden rounded-xl border-t-4 p-[8%]" style={{ background: selected.templateSpec?.palette?.background || '#273255', borderColor: selected.templateSpec?.palette?.accent || '#7c70d6', color: selected.templateSpec?.palette?.foreground || '#fff' }}><span className="text-[10px] uppercase tracking-widest opacity-70">AIMate · presentation</span><h3 className="mt-8 text-2xl font-semibold">{selected.deck?.slides[0]?.title || selected.title}</h3></div><div className="mt-4 flex items-start justify-between gap-3"><div><h3 className="font-semibold">{selected.title}</h3><p className="mt-1 text-xs text-muted-foreground">{pptPageLabel(selected,locale,'file')} · {new Date(selected.updatedAt).toLocaleDateString()}</p></div><span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{selected.status === 'completed' ? '已完成' : '需检查'}</span></div><div className="mt-5 grid grid-cols-2 gap-2"><button className={primary} onClick={() => setEditorOpen(true)}>打开编辑器</button><button className={button} onClick={() => { const favorite = !selected.favorite; setSelected({ ...selected, favorite }); void action(selected, 'metadata', { favorite }); }}>{selected.favorite ? '★ 已收藏' : '☆ 收藏'}</button><button className={button} onClick={() => void action(selected, 'duplicate')}>复制项目</button><button className={button} onClick={() => setDialog({ type: 'renameProject', id: selected.id, value: selected.title })}>重命名</button><button className={button} onClick={() => setDialog({ type: 'move', id: selected.id, value: selected.folderId || '' })}>移动文件夹</button><button className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10" onClick={() => void action(selected, 'trash')}>删除项目</button></div><PptQualityBlockNotice project={selected} busy={busy} onRetry={() => void mutate('/retry', 'POST', {})} /><PptReportReadiness report={selected.quality?.report} /><div className="mt-5">{!selected.renderTree && <PptMediaRetirements project={selected} busy={busy} onProject={updateSelected} onRecheck={() => void mutate('/retry', 'POST')} />}</div><section className="mt-6 border-t border-border pt-5"><h4 className="text-sm font-semibold">生成时间线</h4><div className="mt-4 space-y-4 text-sm">{(selected.timeline||[{stage:'created',at:selected.createdAt}]).map(({stage,at:date}) => {const label=pptTimelineLabel(stage,locale);return <div key={label} className="grid grid-cols-[10px_1fr] gap-3"><span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary"/><p>{label}<small className="mt-0.5 block text-muted-foreground">{new Date(date).toLocaleString()}</small></p></div>;})}</div></section><section className="mt-6 border-t border-border pt-5"><h4 className="text-sm font-semibold">页面预览</h4><div className="mt-3 grid grid-cols-2 gap-2">{selected.renderTree?.slides.slice(0, 6).map((item, index) => <div key={item.id} className="overflow-hidden rounded-lg border border-border"><img alt={`第 ${index + 1} 页`} src={`/api/ppt/projects/${selected.id}/preview/${item.id}.svg`} className="aspect-video w-full bg-muted object-contain"/><span className="block p-2 text-[10px] text-muted-foreground">{String(index + 1).padStart(2, '0')} · {pptRoleLabel(selected.outline[index]?.role||(index===0?'cover':undefined),locale)}</span></div>)}</div></section></div></aside></div>}
      {view === 'detail' && selected && (!['completed', 'quality_blocked'].includes(selected.status) || editorOpen) && <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"><div><h2 className="font-medium">{selected.title}</h2><p className="text-sm text-muted-foreground">{t(`ppt.status.${selected.status}` as TranslationKey)} · {pptPageLabel(selected,locale)}</p></div>{!selected.renderTree && <button className={button} onClick={() => back()}>{t('ppt.editor.back')}</button>}{selected.status === 'completed' && !selected.renderTree && <div className="flex flex-wrap gap-2"><button className={button} onClick={() => startUpdate(selected.id)}>{t('ppt.m3.update')}</button><button className={button} onClick={() => setPresentation(0)}>{t('ppt.present')}</button><a className={button} href={`/api/ppt/projects/${selected.id}/pdf`} download>{t('ppt.exportPdf')}</a><a className={primary} href={`/api/ppt/projects/${selected.id}/export`} download>{t('ppt.export')}</a></div>}</div>
        {selected.status==='paused'&&!selected.renderTree&&<PptExecutionPanel project={selected} onProject={value=>updateSelected(value as StructuredProjectView)}/>}
        {(selected.update || versions.length > 1) && <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="font-medium">{t('ppt.m3.versions')}</h3>
          {versions.length > 1 && <div className="flex flex-wrap gap-2">{versions.map(version => <button key={version.id} className={version.id === selected.id ? primary : button} onClick={() => void openProject({ id: version.id } as Project)}>{version.title} · v{version.number}</button>)}</div>}
          {selected.diff && <p className="text-sm text-muted-foreground">{t('ppt.m3.keep')} {selected.diff.kept} · {t('ppt.m3.rewrite')} {selected.diff.rewritten} · {t('ppt.m3.add')} {selected.diff.added} · {t('ppt.m3.removed')} {selected.diff.removed.map(item => item.title).join(', ') || '0'}</p>}
          {selected.status === 'outline_ready' && selected.update && <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="max-w-xl"><SlidePreview slide={outline[previewPage] || outline[0] || { id: '1', title: selected.title }} template={selected.template} palette={selected.templateSpec?.palette} fonts={selected.templateSpec?.fonts} /></div>
            <div className="flex items-center gap-2"><button className={button} disabled={previewPage === 0} onClick={() => setPreviewPage(page => page - 1)}>←</button><span className="text-sm">{previewPage + 1}/{outline.length}</span><button className={button} disabled={previewPage >= outline.length - 1} onClick={() => setPreviewPage(page => page + 1)}>→</button></div>
          </div>}
        </div>}
        {selected.status==='input_ready'&&!selected.planningContract&&<p role="status" data-testid="ppt-retired-flow" className="rounded-lg border border-border p-3 text-sm text-muted-foreground">{t('ppt.retiredFlow')}</p>}
        {['ingesting', 'outlining', 'generating', 'paused'].includes(selected.status) && <PptGenerationMonitor chatOpen={generationEditOpen} project={selected} onOpenEditor={slideId => { setEditorSlideId(slideId); setEditorOpen(true); }} onEdit={slideId => { setGenerationEdit({ projectId: selected.id, slideId }); setGenerationEditOpen(true); }} onProject={project => { acceptStructuredProject(project); if (project.status === 'completed' || project.status === 'quality_blocked') setEditorOpen(true); }} onBackground={() => back()} />}{selected.status === 'failed' && <div className="rounded-xl border border-destructive/40 p-5"><p className="mb-3 text-destructive">{pptFailureMessage(selected.error || "", locale)}</p>{selected.error&&pptFailureMessage(selected.error, locale)!==selected.error&&<details className="mb-3 text-xs"><summary>{locale==='en'?'View diagnostics':'查看诊断'}</summary><pre className="mt-2 whitespace-pre-wrap break-words">{selected.error}</pre></details>}<PptOutlineDiagnostic project={selected}/><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void mutate('/retry', 'POST')}>{t('ppt.retry')}</button>{selected.stage==='generation'&&selected.candidateOutline?.accepted&&/template_slot_overflow/u.test(selected.error||'')&&<button className={button} disabled={busy} onClick={()=>void mutate('/retry','POST',{repairOutlineTitles:true})}>{t('ppt.failure.reviewOutline')}</button>}<button className={button} onClick={()=>setFailureDetailsOpen(true)}>{t('ppt.failure.details')}</button></div></div>}{selected.status === 'outline_ready' && <><PptOutlineConcision project={selected} /><PptOutlineCorrections project={selected} /></>}{selected.status === 'outline_ready' && <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><div className="space-y-3 rounded-xl border border-border p-4"><h3 className="font-medium">{t('ppt.sourcePreview')}</h3>{selected.inputKind === 'paste' ? <><textarea className={`${input} min-h-72`} value={sourceDraft} onChange={e => setSourceDraft(e.target.value)} /><button className={button} disabled={busy || !sourceDirty} onClick={() => void mutate('/source', 'PATCH', { text: sourceDraft, sourceRevision: selected.sourceRevision })}>{t('ppt.reread')}</button>{sourceDirty && <p className="text-xs text-destructive">{t('ppt.sourceChanged')}</p>}{Boolean(selected.source?.images?.length) && <div><p className="mb-2 text-xs font-medium text-muted-foreground">{t('ppt.pasteImages')} · {selected.source?.images?.length}</p><div className="grid grid-cols-2 gap-2">{selected.source?.images?.map(image => <img key={image.id} src={image.dataUrl} alt={image.caption || t('ppt.m4.image')} className="h-28 w-full rounded border border-border object-contain" />)}</div></div>}</> : selected.source ? <div className="max-h-[36rem] space-y-2 overflow-y-auto text-sm">{selected.source.segments.map(segment => <div key={segment.id} className="rounded-lg bg-muted p-3"><b>[{segment.id}] {segment.location}</b><p className="mt-1 whitespace-pre-wrap">{segment.text}</p></div>)}</div> : <p className="text-sm text-muted-foreground">{selected.prompt}</p>}{selected.source?.truncated && <p className="text-xs text-destructive">{t('ppt.sourceTruncated')}</p>}</div><div className="space-y-3 rounded-xl border border-border p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{t('ppt.outline')}</h3><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => { requestConfirm(t('ppt.reorganize'), t('ppt.reorganizeConfirm'), () => void mutate('/outline', 'POST')); }}>{t('ppt.reorganize')}</button><button className={primary} disabled={busy || sourceDirty || outlineNeedsRepair(selected, outline) || outline.length < (selected.update ? 6 : 3) || outline.length > (100)} onClick={() => void confirmOutline()}>{outline.length !== selected.pages ? t('ppt.replanPages') : t('ppt.confirmGenerate')}</button></div></div>{confirmRefusal && <div role="alert" data-ppt-confirm-refusal className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><p>{pptFailureMessage(confirmRefusal.message, locale)}</p>{confirmRefusal.pages.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{confirmRefusal.pages.map(page => <button key={page} className={button} onClick={() => goToOutlinePage(page)}>{t('ppt.outline.goToPage', { page })}</button>)}</div>}</div>}<div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">{outline.map((slide, i) => <div key={slide.id} id={`ppt-outline-page-${i + 1}`} className="rounded-lg border border-border bg-card p-3"><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>{i + 1} / {outline.length} {slide.refs?.length ? `· ${t('ppt.references')}: ${slide.refs.join(', ')}` : ''}</span><button disabled={outline.length <= (selected.update ? 6 : 3)} onClick={() => setOutline(prev => prev.filter((_, j) => j !== i))}>{t('ppt.delete')}</button></div>
          {selected.update && <div className="mb-2 grid gap-2 sm:grid-cols-2"><PptSelectField className={input} aria-label={`${t('ppt.m3.baseSlide')} ${i + 1}`} value={slide.baseSlideId || ''} onValueChange={value=>setOutline(prev => prev.map((x, j) => j === i ? { ...x, baseSlideId: value || null, change: value ? 'rewrite' : 'add' } : x))}><option value="">{t('ppt.m3.newSlide')}</option>{(selected.update?.baseSnapshot.deck?.slides || []).map(base => <option key={base.id} value={base.id}>{base.title}</option>)}</PptSelectField><PptSelectField className={input} aria-label={`${t('ppt.m3.change')} ${i + 1}`} value={slide.change || 'add'} onValueChange={value=>setOutline(prev => prev.map((x, j) => j === i ? { ...x, change: value as Slide['change'], baseSlideId: value === 'add' ? null : x.baseSlideId } : x))}><option value="keep" disabled={!slide.baseSlideId}>{t('ppt.m3.keep')}</option><option value="rewrite" disabled={!slide.baseSlideId}>{t('ppt.m3.rewrite')}</option><option value="add">{t('ppt.m3.add')}</option></PptSelectField></div>}
          <input aria-label={`${t('ppt.section')} ${i + 1}`} className={`${input} mb-2`} value={slide.section || ''} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, section: e.target.value } : x))}/><input aria-label={`${t('ppt.slideTitle')} ${i + 1}`} className={`${input} mb-2`} value={slide.title} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}/><textarea aria-label={`${t('ppt.focus')} ${i + 1}`} className={input} value={slide.focus || ''} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, focus: e.target.value } : x))}/><textarea aria-label={`${t('ppt.outlineDescription')} ${i + 1}`} className={`${input} mt-2`} value={slide.description || ''} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} placeholder={t('ppt.outlineDescriptionPlaceholder')}/><div className="mt-2 space-y-2">{(slide.children || []).map((child, childIndex) => <div key={child.id} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]"><input aria-label={`${t('ppt.outlineChildTitle')} ${i + 1}-${childIndex + 1}`} className={input} value={child.title} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, children: (x.children || []).map(item => item.id === child.id ? { ...item, title: e.target.value } : item) } : x))}/><input aria-label={`${t('ppt.outlineChildDescription')} ${i + 1}-${childIndex + 1}`} className={input} value={child.description} onChange={e => setOutline(prev => prev.map((x, j) => j === i ? { ...x, children: (x.children || []).map(item => item.id === child.id ? { ...item, description: e.target.value } : item) } : x))}/><button className={button} onClick={() => setOutline(prev => prev.map((x, j) => j === i ? { ...x, children: (x.children || []).filter(item => item.id !== child.id) } : x))}>{t('ppt.delete')}</button></div>)}<button className={button} onClick={() => setOutline(prev => prev.map((x, j) => j === i ? { ...x, children: [...(x.children || []), { id: crypto.randomUUID().replaceAll('-', ''), title: '', description: '' }] } : x))}>＋ {t('ppt.outlineAddChild')}</button></div></div>)}</div><button className={button} disabled={outline.length >= (100)} onClick={() => setOutline(prev => [...prev, { id: crypto.randomUUID().replaceAll('-', ''), section: t('ppt.newSection'), title: t('ppt.newSlide'), focus: '' }])}>{t('ppt.addSlide')}</button></div></div>}{(['completed', 'quality_blocked'].includes(selected.status)||hasViewableFailedPages(selected)) && <div className="space-y-4">{selected.renderTree && <StructuredPptEditor chatOpen={generationEditOpen} project={selected} onProject={acceptStructuredProject} onFailureDetails={()=>setFailureDetailsOpen(true)} onClose={() => back()} />}{selected.quality && ['passed', 'passed_with_warnings', 'blocked'].includes(selected.quality.status || '') && <section data-testid="ppt-quality-report" className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{t('ppt.quality.title')}</h3><span className={`rounded-full px-2 py-1 text-xs ${selected.quality.status === 'passed' ? 'bg-primary/10 text-primary' : 'bg-muted text-foreground'}`}>{t(`ppt.quality.${selected.quality.status}` as TranslationKey)}</span></div><div className="mt-3 grid gap-3 text-sm sm:grid-cols-3"><div><b>{t('ppt.quality.automatic')}</b><p className="text-muted-foreground">{(selected.quality.deterministic?.issues?.length ?? 0)} {t('ppt.quality.findings')} · {(selected.quality.deterministic?.hardErrors ?? 0)} {t('ppt.quality.errors')}</p></div><div><b>{t('ppt.quality.review')}</b><p className="text-muted-foreground">{pptModelReviewState(selected.quality)==='completed'?<>{Object.values(selected.quality.modelReview || {}).reduce((sum, findings) => sum + (Array.isArray(findings) ? findings.length : 0), 0)} {t('ppt.quality.findings')}</>:t(`ppt.quality.review.${pptModelReviewState(selected.quality)}` as TranslationKey)}</p></div><div><b>{t('ppt.quality.repairs')}</b><p className="text-muted-foreground">{(selected.quality.repairs?.length ?? 0)}</p></div></div>{(selected.quality.reviewAdvisories ?? 0) > 0 && <div data-testid="ppt-review-advisories" role="status" className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm"><p>{t('ppt.quality.reviewAdvisories').replace('{count}', String(selected.quality.reviewAdvisories))}</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{(selected.quality.modelIssues || []).filter(issue => issue.advisory && !issue.review).slice(0, 5).map((issue, index) => <li key={index} className="break-words">{issue.detail}</li>)}</ul></div>}{selected.templateSpec?.fonts && <p className="mt-3 text-xs text-muted-foreground">{t('ppt.quality.templateFonts')}: {selected.templateSpec.fonts.titleEastAsia || selected.templateSpec.fonts.title} / {selected.templateSpec.fonts.bodyEastAsia || selected.templateSpec.fonts.body}</p>}</section>}{!selected.renderTree && <PptMediaRetirements project={selected} busy={busy} onProject={updateSelected} onRecheck={() => void mutate('/retry', 'POST')} />}{selected.status === 'quality_blocked' && <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"><p>{t(selected.renderTree ? 'ppt.quality.blockedHelpPublish' : 'ppt.quality.blockedHelp')}</p>{selected.error && <p className="mt-1 text-xs">{selected.error}</p>}</div>}{!selected.renderTree && <><label className="block max-w-xl space-y-1 text-sm"><span>{t('ppt.filename')}</span><input className={input} value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title.trim() !== selected.title) void mutate('', 'PATCH', { title }); }}/></label><label className="block max-w-xl space-y-1 text-sm"><span>{t('ppt.tags')}</span><input className={input} defaultValue={(selected.tags || []).join(', ')} onBlur={e => { const tags = e.target.value.split(',').map(s => s.trim()).filter(Boolean); if (tags.join(',') !== (selected.tags || []).join(',')) void mutate('', 'PATCH', { tags }); }} placeholder={t('ppt.tagsHint')} /></label><div className="flex justify-between gap-2"><h3 className="font-medium">{t('ppt.edit')}</h3><div className="flex gap-2"><button className={button} disabled={busy || slides.length >= 100} onClick={() => changeSlides([...slides, { id: crypto.randomUUID().replaceAll('-', ''), title: t('ppt.newSlide'), bullets: [], blocks: [] }])}>{t('ppt.addSlide')}</button><button className={primary} disabled={busy || !dirty || hasIncompleteImage} title={hasIncompleteImage ? t('ppt.m4.uploadImage') : undefined} onClick={() => void saveSlides()}>{t('ppt.save')}</button></div></div><div className="flex flex-wrap items-center gap-2"><button className={button} disabled={!undoHistory.current.length} onClick={undo}>{t('ppt.m4.undo')}</button><button className={button} disabled={!redoHistory.current.length} onClick={redo}>{t('ppt.m4.redo')}</button><input className={`${input} max-w-xs`} aria-label={t('ppt.m4.searchSlides')} placeholder={t('ppt.m4.searchSlides')} value={editorSearch} onChange={e => setEditorSearch(e.target.value)} /><label className="flex items-center gap-2 text-sm"><span>{t('ppt.m4.switchTemplate')}</span><PptSelectField className={input} value={selected.template} disabled={busy || dirty} onValueChange={value=>void mutate('', 'PATCH', { template: value, revision: selected.revision })}>{templateOptions.filter(item => item.compatibility === 'mapped').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</PptSelectField></label></div><div className="grid gap-4 lg:grid-cols-2">{slides.filter(slide => `${slide.title} ${(slide.bullets || []).join(' ')}`.toLocaleLowerCase().includes(editorSearch.toLocaleLowerCase())).map((slide, i) => <div key={slide.id} className="rounded-xl border border-border bg-card p-4"><p className="mb-2 text-xs text-muted-foreground">{t('ppt.slide')} {i + 1}{slide.sourceRefs?.length ? ` · ${t('ppt.references')}: ${slide.sourceRefs.join(', ')}` : ''}</p><SlidePreview slide={slide} template={selected.template} palette={selected.templateSpec?.palette} fonts={selected.templateSpec?.fonts}/><input aria-label={`${t('ppt.slideTitle')} ${i + 1}`} className={`${input} my-3 font-medium`} value={slide.title} onChange={e => changeSlides(slides.map(x => x.id === slide.id ? { ...x, title: e.target.value } : x))}/><textarea aria-label={`${t('ppt.bullets')} ${i + 1}`} className={`${input} min-h-36`} value={(slide.bullets || []).join('\n')} onChange={e => changeSlides(slides.map(x => x.id === slide.id ? { ...x, bullets: e.target.value.split('\n').filter(Boolean) } : x))}/><p className="mt-2 text-xs text-muted-foreground">{t('ppt.bulletHint')}</p><BlockEditor blocks={slide.blocks} onChange={blocks => changeSlides(slides.map(item => item.id === slide.id ? { ...item, blocks } : item))} canRewrite={!busy && !dirty && aiSlideId === slide.id && Boolean(aiDraft.trim())} onRewrite={blockId => void rewriteSlide(slide.id, aiDraft, blockId)} /><label className="mt-2 block space-y-1 text-xs"><span>{t('ppt.m4.layout')}</span><PptSelectField className={input} value={slide.layoutId || 'summary'} onValueChange={value=>changeSlides(slides.map(item => item.id === slide.id ? { ...item, layoutId: value as LayoutId } : item))}>{layoutIds.map(layoutId => <option key={layoutId} value={layoutId}>{t(`ppt.layout.${layoutId}` as TranslationKey)}</option>)}</PptSelectField></label><div className="mt-3 flex gap-2"><input className={input} aria-label={`${t('ppt.m4.aiInstruction')} ${slide.title}`} placeholder={t('ppt.m4.aiInstruction')} value={aiSlideId === slide.id ? aiDraft : ''} onChange={e => { setAiSlideId(slide.id); setAiDraft(e.target.value); }} /><button className={button} disabled={busy || dirty || aiSlideId !== slide.id || !aiDraft.trim()} onClick={() => void rewriteSlide(slide.id, aiDraft)}>{t('ppt.m4.aiRewrite')}</button></div></div>)}</div></>}</div>}</section>}
    </div>
    {!generationEditOpen && !generationEdit && selected?.editing && Object.keys(selected.editing.intents).length > 0 && <button className="fixed bottom-16 right-4 z-[80] rounded-lg border border-border bg-background px-4 py-2 text-sm shadow-lg" onClick={() => { const latest = Object.values(selected.editing!.intents).slice(-1)[0]; const slideId = Object.keys(latest.perSlideResults).find(id => selected.outline.some(slide => slide.id === id)) || selected.outline[0]?.id; if (slideId) { setGenerationEdit({ projectId: selected.id, slideId }); setGenerationEditOpen(true); } }}>{t('ppt.edit.history')}</button>}
    {generationEdit && selected?.id === generationEdit.projectId && <GenerationEditDialog key={generationEdit.projectId} open={generationEditOpen} project={selected} slideId={generationEdit.slideId} onProject={acceptStructuredProject} onClose={() => { setGenerationEditOpen(false); }}/>}
    {!generationEditOpen && generationEdit && selected?.id === generationEdit.projectId && !['ingesting', 'outlining', 'generating', 'paused'].includes(selected.status) && <button className="fixed bottom-16 right-4 z-[80] rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg" onClick={() => setGenerationEditOpen(true)}>{t('ppt.edit.editDuring')}</button>}
    {failureDetailsOpen&&selected?.status==='failed'&&selected.error&&<PptFailureDialog message={selected.error} failure={selected.failure} onReviewOutline={selected.stage==='generation'&&selected.candidateOutline?.accepted&&/template_slot_overflow/u.test(selected.error)?()=>void mutate('/retry','POST',{repairOutlineTitles:true}):undefined} onClose={()=>setFailureDetailsOpen(false)}/>}

    {dialog && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"><form role="dialog" aria-modal="true" className="w-full max-w-md space-y-4 rounded-xl border border-border bg-background p-6" onSubmit={e => { e.preventDefault(); void submitDialog(); }}><h2 className="text-lg font-medium">{t(`ppt.dialog.${dialog.type}` as TranslationKey)}</h2>{dialog.type === 'move' ? <><PptSelectField className={input} value={dialog.value} onValueChange={value=>setDialog({ ...dialog, value: value })}><option value="">{t('ppt.ungrouped')}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</PptSelectField><button type="button" className={button} onClick={() => setDialog({ type: 'createFolder', value: '' })}>＋ {t('ppt.folderCreate')}</button></> : <input autoFocus className={input} value={dialog.value} onChange={e => setDialog({ ...dialog, value: e.target.value })} maxLength={dialog.type === 'renameProject' ? 160 : 80}/>}<div className="flex justify-end gap-2"><button type="button" className={button} onClick={() => setDialog(null)}>{t('ppt.cancel')}</button><button className={primary} disabled={busy || (dialog.type !== 'move' && !dialog.value.trim())}>{t('ppt.confirm')}</button></div></form></div>}
    {createChooserOpen && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setCreateChooserOpen(false); }}><section className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="ppt-new-title"><header className="flex items-start justify-between border-b border-border p-5"><div><h2 id="ppt-new-title" className="text-lg font-semibold">新建</h2><p className="mt-1 text-sm text-muted-foreground">选择一种方式开始创建演示文稿</p></div><button className="grid h-8 w-8 place-items-center rounded-lg border border-border" aria-label="关闭" onClick={() => setCreateChooserOpen(false)}>×</button></header><div className="p-5"><div className="grid gap-3 md:grid-cols-3">{([['prompt','✦','从 Prompt 开始','告诉 AI 主题与目标，生成完整结构。'],['paste','▤','粘贴文本','粘贴笔记、报告或大纲，生成演示文稿。'],['file','↥','导入文件','上传文档，AI 将提炼为演示文稿。']] as const).map(([kind, icon, label, help]) => <button key={kind} className="rounded-xl border border-border bg-card p-5 text-left hover:border-primary hover:bg-accent/40" onClick={() => { setCreateChooserOpen(false); setCreateKind(kind); setLlmGate(createEntry === 'template' ? 'template' : 'new'); }}><span className="text-xl text-primary">{icon}</span><strong className="mt-3 block">{label}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{help}</span></button>)}</div></div></section></div>}
    {llmGate && <PptLlmGate modelsLoading={modelsLoading} modelsError={loadErrors.models} onRetryModels={()=>void retryResource('models')} policy={executionPolicy} onPolicyChange={changeExecutionPolicy} context={llmGate} models={models} modelKey={llmGate === 'update' ? updateModelKey : flowModelKey} template={llmGate === 'template' ? lockedTemplate : undefined} onModelKeyChange={llmGate === 'update' ? setUpdateModelKey : setFlowModelKey} onClose={() => setLlmGate(null)} onConfirm={confirmLlmGate}/>}
    {confirmation && <PptConfirmDialog title={confirmation.title} message={confirmation.message} confirmLabel={t('ppt.confirm')} dangerous onClose={() => setConfirmation(null)} onConfirm={() => { const action = confirmation.action; setConfirmation(null); action(); }} />}
    {presentation !== null && slides[presentation] && selected && <div className="fixed inset-0 z-50 flex flex-col bg-background p-4"><div className="mb-3 flex items-center justify-between"><span className="text-sm">{selected.title} · {presentation + 1}/{slides.length}</span><button className={button} onClick={() => setPresentation(null)}>{t('ppt.close')}</button></div><div className="m-auto w-full max-w-6xl"><SlidePreview slide={slides[presentation]} template={selected.template} palette={selected.templateSpec?.palette} fonts={selected.templateSpec?.fonts} large/></div><div className="flex justify-center gap-4"><button className={button} disabled={presentation === 0} onClick={() => setPresentation(n => n === null ? null : n - 1)}>←</button><button className={button} disabled={presentation === slides.length - 1} onClick={() => setPresentation(n => n === null ? null : n + 1)}>→</button></div></div>}
  </main>;
}
