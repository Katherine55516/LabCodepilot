'use client';

import { useMemo, useState } from 'react';
import type { VmArtifactFile } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { showToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { ShieldCheck, DownloadSimple, Package, SpinnerGap, SidebarSimple, Sparkle } from '@/components/ui/icon';

interface VmArtifactsCardProps {
  sessionId: string;
  files: VmArtifactFile[];
  /** VM 在线状态:false 时显示"沙箱休眠"徽标(列表来自持久化,下载会自动唤醒 VM)。 */
  vmOnline?: boolean;
  /** 本会话调用过的 skill(已按名聚合计数,来源见 ChatView 三源合并)。 */
  skillsUsed?: Array<{ skill: string; count: number }>;
  /**
   * 产物接口的 base。定时任务的工作区挂在 routineId 名下、不在 chat_sessions 里,
   * 走的是另一条按 `cowork_routines.owner_uid` 校验的路由,故此处可覆盖。
   * 带不带 query 都行 —— 连接符由下面按有无 `?` 自动选。
   */
  endpointBase?: string;
}

/** 折叠偏好跨会话记住(全局,不分会话 —— 这是用户的界面习惯,不是会话状态)。 */
const COLLAPSE_KEY = 'cowork.artifactsPanel.collapsed';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Cowork 沙箱产物浮窗 — 悬浮在聊天区右上角(对齐 Claude Cowork 的右侧浮动面板形态),
 * 展示 agent 在 VM 内新建/修改的文件,提供单文件下载与整包下载。
 *
 * 由内联卡片改为浮窗的原因(用户反馈):产物多时内联卡片把输入框上方占满,
 * 且绿色大块横条视觉侵入。浮窗 + 可折叠 + 列表内滚动(max-h)三者配合,
 * 产物再多也只占固定一角;折叠后只剩一个小按钮。
 *
 * 下载走受控 fetch(不用裸 <a download>):VM 休眠时下载接口会先唤醒 VM
 * (数秒冷启动),期间给对应条目转圈动画,避免"点了没反应像卡死"的困惑。
 */
export function VmArtifactsCard({ sessionId, files, vmOnline = true, skillsUsed = [], endpointBase }: VmArtifactsCardProps) {
  const { t } = useTranslation();
  // 正在下载的 key 集合('__all__' 表示整包下载)。
  const [busy, setBusy] = useState<Set<string>>(new Set());
  // 初始值读 localStorage:本卡片只在客户端拿到产物列表后才渲染(SSR 恒为空列表
  // → null),不存在水合不一致问题。
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });

  const sorted = useMemo(
    () => [...files].sort((a, b) => b.mtime - a.mtime),
    [files],
  );

  if (sorted.length === 0 && skillsUsed.length === 0) return null;

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const setKeyBusy = (key: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });

  /**
   * fetch → blob → 触发浏览器另存。fetch 会命中服务端 ensureRunning(VM 休眠时
   * 唤醒),响应到达前 spinner 一直转。saveName 为空时用响应头/后备名。
   */
  const download = async (url: string, key: string, saveName: string) => {
    if (busy.has(key)) return;
    setKeyBusy(key, true);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[VmArtifactsCard] download failed: ${res.status}`);
        // E4.2: 大概率是文件已被 agent 删除(清单残留)。给出提示并触发
        // 清单重拉 —— list 端点在 VM 在线时会对账剔除已不存在的文件。
        showToast({ type: 'warning', message: t('sandbox.artifacts.downloadMissing') });
        window.dispatchEvent(new CustomEvent('vm-artifacts-refresh'));
        return;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = saveName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 释放放到下一帧,确保下载已触发
      setTimeout(() => URL.revokeObjectURL(objUrl), 0);
    } catch (err) {
      console.warn('[VmArtifactsCard] download error:', err);
    } finally {
      setKeyBusy(key, false);
    }
  };

  const base = endpointBase ?? `/api/cowork/artifacts?sessionId=${encodeURIComponent(sessionId)}`;
  const sep = base.includes('?') ? '&' : '?';
  const fileUrl = (p: string) => `${base}${sep}path=${encodeURIComponent(p)}`;
  const archiveUrl = `${base}${sep}archive=1`;

  // 折叠态:只剩一个角落小按钮,点击展开。计数只显示**文件数**(用户决策;
  // 技能数展开可见),仅有技能、尚无产物时不显示数字。
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggleCollapsed}
        className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/95 px-2 py-1.5 text-xs shadow-md backdrop-blur transition-colors hover:border-foreground/30"
        title={t('sandbox.artifacts.expand')}
        aria-label={t('sandbox.artifacts.expand')}
        aria-expanded={false}
      >
        <ShieldCheck size={14} className="text-status-success-foreground" />
        {sorted.length > 0 && <span className="font-medium">{sorted.length}</span>}
        <SidebarSimple size={14} className="text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="absolute right-3 top-3 z-20 flex w-72 max-w-[calc(100%-1.5rem)] flex-col rounded-xl border border-border/70 bg-background/95 shadow-lg backdrop-blur">
      {/* 头部:标题 + 数量 + 休眠徽标 + 整包下载 + 折叠 */}
      <div className="flex items-center gap-1.5 border-b border-border/50 px-3 py-2 text-xs font-medium">
        <ShieldCheck size={14} className="shrink-0 text-status-success-foreground" />
        <span className="truncate">{t('sandbox.artifacts.title')}</span>
        {sorted.length > 0 && (
          <span className="shrink-0 font-normal text-muted-foreground">· {sorted.length}</span>
        )}
        {!vmOnline && (
          <span
            className="ml-0.5 shrink-0 rounded-full border border-border/60 bg-background px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground"
            title={t('sandbox.artifacts.sleepingHint')}
          >
            {t('sandbox.artifacts.sleeping')}
          </span>
        )}
        <div className="flex-1" />
        {sorted.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
            disabled={busy.has('__all__')}
            title={t('sandbox.artifacts.downloadAll')}
            aria-label={t('sandbox.artifacts.downloadAll')}
            onClick={() => download(archiveUrl, '__all__', `sandbox-${sessionId.slice(0, 8)}.tar.gz`)}
          >
            {busy.has('__all__') ? <SpinnerGap size={14} className="animate-spin" /> : <Package size={14} />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          title={t('sandbox.artifacts.collapse')}
          aria-label={t('sandbox.artifacts.collapse')}
          aria-expanded
          onClick={toggleCollapsed}
        >
          <SidebarSimple size={14} />
        </Button>
      </div>
      {/* 文件与技能共用同一滚动区:产物多时在面板内滚动,不再撑满屏幕 */}
      <div className="max-h-[45vh] overflow-y-auto">
        {sorted.length > 0 && (
          <div className="p-1.5">
            {sorted.map((f) => {
              const isBusy = busy.has(f.path);
              return (
                <button
                  key={f.path}
                  type="button"
                  disabled={isBusy}
                  onClick={() => download(fileUrl(f.path), f.path, f.name)}
                  className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60 disabled:opacity-70"
                  title={isBusy ? t('sandbox.artifacts.starting') : `${f.path} · ${formatSize(f.size)}`}
                >
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatSize(f.size)}</span>
                  {isBusy
                    ? <SpinnerGap size={13} className="shrink-0 animate-spin text-status-success-foreground" />
                    : <DownloadSimple size={13} className="shrink-0 text-muted-foreground group-hover:text-foreground" />}
                </button>
              );
            })}
          </div>
        )}
        {/* 使用的技能:agent 本会话调用过的 skill(×N = 累计调用次数) */}
        {skillsUsed.length > 0 && (
          <div className={sorted.length > 0 ? 'border-t border-border/50 px-3 py-2' : 'px-3 py-2'}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Sparkle size={12} className="shrink-0" />
              <span>{t('sandbox.skills.title')}</span>
              <span className="font-normal">· {skillsUsed.length}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {skillsUsed.map(({ skill, count }) => (
                <span
                  key={skill}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px]"
                  title={t('sandbox.skills.times', { count: String(count) })}
                >
                  <span className="truncate">{skill}</span>
                  {count > 1 && <span className="shrink-0 text-muted-foreground">×{count}</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      {busy.size > 0 && !vmOnline && (
        <div className="flex items-center gap-1.5 border-t border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
          <SpinnerGap size={12} className="animate-spin" />
          {t('sandbox.artifacts.starting')}
        </div>
      )}
    </div>
  );
}
