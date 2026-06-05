"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { UpdateInfo, UpdateContextValue } from "@/hooks/useUpdate";

const CHECK_INTERVAL = 8 * 60 * 60 * 1000; // 8 hours
const DISMISSED_VERSION_KEY = "codepilot_dismissed_update_version";

/**
 * 临时整体关闭「检查新版本」功能。
 *
 * 当前更新检查指向旧的发布源(GitHub op7418/CodePilot 的 Releases),
 * 后续会改造成从另一个服务器源拉取版本信息。在改造完成前,这里统一关闭:
 * 不发起任何检查请求,自动更新弹窗(UpdateDialog)、顶部横幅(UpdateBanner)、
 * 会话列表更新角标均不再出现;设置页的「检查更新」卡片已在
 * GeneralSection.tsx 中注释隐藏。
 *
 * 恢复方式:把此常量改回 false(并确认更新源已切到新服务器)。
 */
const UPDATE_CHECK_DISABLED = true;

/**
 * Encapsulates all update-checking logic (native Electron updater + browser fallback).
 * Returns a memoised context value suitable for UpdateContext.Provider.
 */
export function useUpdateChecker(): UpdateContextValue {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  // Runtime detection: native updater available when running in Electron with updater bridge
  const isNativeUpdater = typeof window !== "undefined" && !!window.electronAPI?.updater;

  // --- Native updater status listener ---
  useEffect(() => {
    if (UPDATE_CHECK_DISABLED || !isNativeUpdater) return;
    const cleanup = window.electronAPI!.updater!.onStatus((event) => {
      switch (event.status) {
        case 'available':
          setUpdateInfo((prev) => ({
            updateAvailable: true,
            latestVersion: event.info?.version ?? prev?.latestVersion ?? '',
            currentVersion: prev?.currentVersion ?? '',
            releaseName: event.info?.releaseName ?? prev?.releaseName ?? '',
            releaseNotes: typeof event.info?.releaseNotes === 'string' ? event.info.releaseNotes : prev?.releaseNotes ?? '',
            releaseUrl: prev?.releaseUrl ?? '',
            publishedAt: event.info?.releaseDate ?? prev?.publishedAt ?? '',
            downloadProgress: null,
            readyToInstall: false,
            isNativeUpdate: true,
            lastError: null,
          }));
          {
            const ver = event.info?.version;
            const dismissed = localStorage.getItem(DISMISSED_VERSION_KEY);
            if (ver && dismissed !== ver) {
              setShowDialog(true);
            }
          }
          break;
        case 'not-available':
          setUpdateInfo((prev) => prev ? { ...prev, updateAvailable: false, isNativeUpdate: true, lastError: null } : prev);
          break;
        case 'downloading':
          setUpdateInfo((prev) => prev ? {
            ...prev,
            downloadProgress: event.progress?.percent ?? prev.downloadProgress,
            isNativeUpdate: true,
            lastError: null,
          } : prev);
          break;
        case 'downloaded':
          setUpdateInfo((prev) => prev ? {
            ...prev,
            readyToInstall: true,
            downloadProgress: 100,
            isNativeUpdate: true,
            lastError: null,
          } : prev);
          break;
        case 'error':
          setUpdateInfo((prev) => prev ? {
            ...prev,
            lastError: event.error ?? 'Unknown error',
            isNativeUpdate: true,
          } : prev);
          break;
      }
      if (event.status === 'checking') {
        setChecking(true);
      } else {
        setChecking(false);
      }
    });
    return cleanup;
  }, [isNativeUpdater]);

  // --- Browser-mode update check (fallback for non-Electron) ---
  const checkForUpdatesBrowser = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/app/updates");
      if (!res.ok) return;
      const data = await res.json();
      const info: UpdateInfo = {
        ...data,
        downloadProgress: null,
        readyToInstall: false,
        isNativeUpdate: false,
        lastError: null,
      };
      setUpdateInfo(info);

      if (info.updateAvailable) {
        const dismissed = localStorage.getItem(DISMISSED_VERSION_KEY);
        if (dismissed !== info.latestVersion) {
          setShowDialog(true);
        }
      }
    } catch {
      // silently ignore network errors
    } finally {
      setChecking(false);
    }
  }, []);

  // --- Unified check: native first, browser fallback ---
  const checkForUpdates = useCallback(async () => {
    if (UPDATE_CHECK_DISABLED) return;
    if (isNativeUpdater) {
      try {
        await window.electronAPI!.updater!.checkForUpdates();
        return;
      } catch {
        // native check failed, fall through to browser mode
      }
    }
    await checkForUpdatesBrowser();
  }, [isNativeUpdater, checkForUpdatesBrowser]);

  // Browser mode: periodic check (non-Electron or as fallback)
  useEffect(() => {
    if (UPDATE_CHECK_DISABLED || isNativeUpdater) return; // native updater handles its own initial check
    checkForUpdatesBrowser();
    const id = setInterval(checkForUpdatesBrowser, CHECK_INTERVAL);
    return () => clearInterval(id);
  }, [isNativeUpdater, checkForUpdatesBrowser]);

  const dismissUpdate = useCallback(() => {
    setShowDialog(false);
  }, []);

  const downloadUpdate = useCallback(async () => {
    if (isNativeUpdater) {
      await window.electronAPI!.updater!.downloadUpdate();
    }
  }, [isNativeUpdater]);

  const quitAndInstall = useCallback(() => {
    if (isNativeUpdater) {
      window.electronAPI!.updater!.quitAndInstall();
    }
  }, [isNativeUpdater]);

  return useMemo(
    () => ({
      updateInfo,
      checking,
      checkForUpdates,
      downloadUpdate,
      dismissUpdate,
      showDialog,
      setShowDialog,
      quitAndInstall,
    }),
    [updateInfo, checking, checkForUpdates, downloadUpdate, dismissUpdate, showDialog, quitAndInstall]
  );
}
