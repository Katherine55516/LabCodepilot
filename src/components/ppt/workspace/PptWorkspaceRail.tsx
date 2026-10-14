'use client';

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { PptProject } from '../types';
import {isLibraryPresentation,isPptTask} from '@/lib/ppt-library';

export type WorkspaceFolder = { id: string; name: string; count: number; pinned: boolean; manualOrder?: number };
type Tab = 'recent' | 'all' | 'favorites' | 'trash';

export function PptWorkspaceRail({ folders, projects, trashCount, view, tab, folderId, onNav, onTemplates, onTasks,
  onFolder, onNewFolder, onRenameFolder, onPinFolder, onDeleteFolder, onReorderFolder, mobile = false,countsReady=true }: {
  folders: WorkspaceFolder[]; projects: PptProject[]; trashCount: number; view: string; tab: Tab; folderId: string | null;
  onNav: (tab: Tab) => void; onTemplates: () => void; onTasks: () => void; onFolder: (id: string) => void;
  onNewFolder: () => void; onRenameFolder: (folder: WorkspaceFolder) => void; onPinFolder: (folder: WorkspaceFolder) => void;
  onDeleteFolder: (folder: WorkspaceFolder) => void; onReorderFolder: (movedId: string, targetId: string) => void;
  mobile?: boolean;countsReady?:boolean;
}) {
  const { t } = useTranslation();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const completed = projects.filter(isLibraryPresentation).length;
  const running = projects.filter(isPptTask).length;
  return <nav aria-label={t('ppt.workspaceNav.label')} className={`ppt-workspace-rail ${mobile ? 'block' : 'hidden xl:block xl:self-start'} space-y-1 rounded-xl border border-border bg-card p-3`}>
    <div className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">PPT Workspace</div>
    {([['recent', '▣ '], ['all', '▤ '], ['favorites', '☆ ']] as const).map(([value, icon]) =>
      <button key={value} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${view === 'list' && tab === value && !folderId ? 'bg-accent font-medium' : 'hover:bg-accent/60'}`}
        onClick={() => onNav(value)}>{icon}{t(`ppt.tab.${value}`)}{value === 'all' ? ` (${countsReady?completed:"…"})` : ''}</button>)}
    <button className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${view === 'templates' ? 'bg-accent font-medium' : 'hover:bg-accent/60'}`} onClick={onTemplates}>▦ {t('ppt.m3.templateCenter')}</button>
    <button className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${view === 'tasks' ? 'bg-accent font-medium' : 'hover:bg-accent/60'}`} onClick={onTasks}>◷ {t('ppt.tasks.nav')}{!countsReady?" (…)":running ? ` (${running})` : ''}</button>
    <div className="mt-4 flex items-center justify-between border-t border-border pt-3"><span className="px-3 text-xs font-medium uppercase text-muted-foreground">{t('ppt.folders')}</span><button aria-label={t('ppt.folderCreate')} className="px-2 text-lg" onClick={onNewFolder}>+</button></div>
    {folders.map(folder => <div key={folder.id} className={`relative flex items-center rounded-lg ${view === 'list' && folderId === folder.id ? 'bg-accent' : 'hover:bg-accent/60'}`}
      onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const moved = event.dataTransfer.getData('application/x-aimate-ppt-folder') || dragId; if (moved && moved !== folder.id) onReorderFolder(moved, folder.id); setDragId(null); }}>
      <button type="button" draggable aria-label={`${t('ppt.order.dragFolder')} ${folder.name}`} title={t('ppt.order.dragFolder')} className="cursor-grab px-1.5 text-muted-foreground"
        onDragStart={event => { setDragId(folder.id); event.dataTransfer.setData('application/x-aimate-ppt-folder', folder.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragId(null)}>⋮⋮</button>
      <button className="min-w-0 flex-1 truncate px-1 py-2 text-left text-sm" onClick={() => onFolder(folder.id)}>{folder.pinned ? '📌 ' : '▱ '}{folder.name} ({countsReady?folder.count:"…"})</button>
      <button className="px-2 text-xs" aria-label={`${t('ppt.folderMenu')} ${folder.name}`} onClick={() => setMenuId(menuId === folder.id ? null : folder.id)}>⋯</button>
      {menuId === folder.id && <div className="absolute right-0 top-full z-30 min-w-32 rounded-lg border border-border bg-popover p-2 shadow-lg">
        <button className="block p-1 text-sm" onClick={() => { setMenuId(null); onPinFolder(folder); }}>{folder.pinned ? t('ppt.unpin') : t('ppt.pin')}</button>
        <button className="block p-1 text-sm" onClick={() => { setMenuId(null); onRenameFolder(folder); }}>{t('ppt.rename')}</button>
        <button className="block p-1 text-sm text-destructive" onClick={() => { setMenuId(null); onDeleteFolder(folder); }}>{t('ppt.delete')}</button>
      </div>}</div>)}
    <button className={`mt-3 block w-full rounded-lg px-3 py-2 text-left text-sm ${view === 'list' && tab === 'trash' ? 'bg-accent font-medium' : 'hover:bg-accent/60'}`} onClick={() => onNav('trash')}>⌫ {t('ppt.tab.trash')} ({countsReady?trashCount:"…"})</button>
    <div className="ppt-workspace-footer mt-4 rounded-lg border border-border bg-card px-3 py-3 text-xs text-muted-foreground"><strong className="block text-foreground">个人工作区</strong><span>演示文稿仅自己可见</span><p className="mt-2">{countsReady?completed:"…"} 个演示文稿 · {countsReady?running:"…"} 个待处理任务</p><p>{countsReady?projects.length:"…"} / 50 个存储项目</p></div>
  </nav>;
}
