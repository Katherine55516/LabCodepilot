"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { UpdateInfo, UpdateContextValue } from "@/hooks/useUpdate";
import { showToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";

const DISMISSED_VERSION_KEY = "codepilot_dismissed_update_version";

/**
 * 「检查新版本」总开关（保留为一键回滚 kill-switch）。
 *
 * 自动更新已改造为：主进程(electron/updater/*)调研发平台 V2 接口检查（带登录
 * Bearer），渲染层经 window.electronAPI.updater 桥接收状态。把此常量改回 true
 * 即可整体隐藏所有更新 UI（弹窗/横幅/会话列表角标/设置卡），用于应急回滚。
 */
const UPDATE_CHECK_DISABLED = false;

/** 当前应用版本（构建期注入；仅用于弹窗展示 Current→Latest，权威判定在主进程）。 */
const CURRENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

/**
 * 驱动「检查新版本」的渲染层逻辑。
 *
 * 真实链路只在 Electron 主进程（`window.electronAPI.updater` 存在时）：主进程检查
 * 并通过 `updater:status` 推送 checking/available/not-available/downloading/
 * downloaded/error。非 Electron 环境（next dev / 浏览器）不发起检查，更新 UI 默认
 * 不出现（dev 用注入 mock `window.electronAPI.updater` 验证）。
 */
export function useUpdateChecker(): UpdateContextValue {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  // 仅在 Electron 主进程暴露 updater 桥时才有真实更新能力。
  const isNativeUpdater = typeof window !== "undefined" && !!window.electronAPI?.updater;

  const { t } = useTranslation();
  // 让长生命周期的 onStatus 闭包始终拿到最新 t，又不必把 t 加进 onStatus 的依赖
  // （否则会随 locale 变化重订阅并重复触发首检）。用 effect 同步 ref，避免在
  // render 期写 ref（react-hooks/refs）。
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  // 仅在「用户手动点击检查更新」期间为 true：用于区分启动自动首检/后台检查，
  // 保证只有手动检查在"无更新/出错"时才弹 toast（自动检查保持静默）。
  const manualCheckRef = useRef(false);

  // --- 主进程更新器状态监听 + 首检触发 ---
  useEffect(() => {
    if (UPDATE_CHECK_DISABLED || !isNativeUpdater) return;

    const updater = window.electronAPI!.updater!;
    const cleanup = updater.onStatus((event) => {
      switch (event.status) {
        case 'checking':
          setChecking(true);
          break;
        case 'available': {
          // 有更新时由卡片/弹窗负责反馈，手动检查标记直接消费掉。
          manualCheckRef.current = false;
          const mustUpgrade = event.info?.mustUpgrade === true;
          setUpdateInfo({
            updateAvailable: true,
            mustUpgrade,
            latestVersion: event.info?.version ?? '',
            currentVersion: CURRENT_VERSION,
            releaseName: event.info?.releaseName ?? event.info?.version ?? '',
            releaseNotes: typeof event.info?.releaseNotes === 'string' ? event.info.releaseNotes : '',
            releaseUrl: '',
            publishedAt: event.info?.releaseDate ?? '',
            downloadProgress: null,
            readyToInstall: false,
            isNativeUpdate: true,
            lastError: null,
          });
          // 强制升级无视"稍后"记录、始终弹窗阻断；否则尊重已忽略的版本。
          const ver = event.info?.version;
          const dismissed = localStorage.getItem(DISMISSED_VERSION_KEY);
          if (mustUpgrade || (ver && dismissed !== ver)) {
            setShowDialog(true);
          }
          setChecking(false);
          break;
        }
        case 'not-available':
          setUpdateInfo((prev) => (prev ? { ...prev, updateAvailable: false, lastError: null } : prev));
          // 手动检查且无更新：弹一个简短提示，告诉用户已是最新版本。
          // 自动首检/后台检查不弹（manualCheckRef 为 false），避免每次启动打扰。
          if (manualCheckRef.current) {
            manualCheckRef.current = false;
            showToast({ type: 'success', message: tRef.current('settings.latestVersion'), duration: 3000 });
          }
          setChecking(false);
          break;
        case 'downloading':
          setUpdateInfo((prev) => (prev ? {
            ...prev,
            downloadProgress: event.progress?.percent ?? prev.downloadProgress,
            lastError: null,
          } : prev));
          setChecking(false);
          break;
        case 'downloaded':
          setUpdateInfo((prev) => (prev ? {
            ...prev,
            readyToInstall: true,
            downloadProgress: 100,
            lastError: null,
          } : prev));
          setChecking(false);
          break;
        case 'error':
          setUpdateInfo((prev) => (prev ? { ...prev, lastError: event.error ?? 'Unknown error' } : prev));
          // 手动检查失败也给出反馈，避免点了按钮却毫无动静。
          if (manualCheckRef.current) {
            manualCheckRef.current = false;
            showToast({ type: 'error', message: tRef.current('settings.checkUpdateFailed') });
          }
          setChecking(false);
          break;
      }
    });

    // 触发首检：监听已在上面同步注册，结果必经 onStatus 回来，无竞态。
    void updater.checkForUpdates();

    return cleanup;
  }, [isNativeUpdater]);

  // 手动检查（设置页 / 关于页按钮）。标记本次为手动触发，结果回到 onStatus 时
  // 据此决定是否弹 toast（无更新→已是最新；出错→失败提示）。
  const checkForUpdates = useCallback(async () => {
    if (UPDATE_CHECK_DISABLED || !isNativeUpdater) return;
    manualCheckRef.current = true;
    try {
      await window.electronAPI!.updater!.checkForUpdates();
    } catch {
      // 主进程会通过 onStatus 推 error 状态；这里静默。
    }
  }, [isNativeUpdater]);

  const dismissUpdate = useCallback(() => {
    setShowDialog(false);
    // 记住"稍后"的版本，避免周期检查重复弹窗。强制升级不可忽略，不写记录。
    setUpdateInfo((prev) => {
      if (prev && !prev.mustUpgrade && prev.latestVersion) {
        try {
          localStorage.setItem(DISMISSED_VERSION_KEY, prev.latestVersion);
        } catch {
          /* ignore persistence failure */
        }
      }
      return prev;
    });
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
