"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DownloadSimple,
  Trash,
  CheckCircle,
  ArrowCircleUp,
  Lightning,
  SpinnerGap,
  UserCircle,
} from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { InternalStoreSkill, SkillsStoreFailureEnvelope } from "@/types/electron";

interface InternalSkillDetailProps {
  skill: InternalStoreSkill;
  /** 安装/更新/卸载完成后回调（刷新列表 + 我的技能）。 */
  onChanged: () => void;
}

type Busy = null | "install" | "update" | "uninstall";

/**
 * 内部技能详情 — 布局对照外部 MarketplaceSkillDetail。
 * 数据流：列表项进来先渲染已有字段，同时经 IPC 拉全量详情（guide/fileManifest；
 * INLINE 型带 withContent=1 取 inlineContent 预览）。
 * 安装/更新/卸载按钮 Phase 2 激活（preload 未暴露时禁用），错误分支只认 code。
 */
export function InternalSkillDetail({ skill, onChanged }: InternalSkillDetailProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<InternalStoreSkill>(skill);
  const [detailLoading, setDetailLoading] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);

  const api = typeof window !== "undefined" ? window.electronAPI?.skillsStore : undefined;

  useEffect(() => {
    let cancelled = false;
    setDetail(skill);
    setDetailLoading(true);

    const fetchDetail = async () => {
      if (!api) {
        setDetailLoading(false);
        return;
      }
      const withContent = skill.deliveryMode === "INLINE";
      const r = await api.detail(skill.id, { withContent });
      if (cancelled) return;
      if (r.ok) {
        setDetail(r.skill);
      }
      // 详情失败不清空已有列表字段 — 正文区按缺 guide 处理即可
      setDetailLoading(false);
    };

    fetchDetail();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill.id]);

  /** 失败信封 → 用户可读提示（方案 §5 错误码映射表）。 */
  const toastFailure = (f: SkillsStoreFailureEnvelope) => {
    switch (f.error) {
      case "RATE_LIMITED":
        showToast({
          type: "error",
          message: t("skills.internalRateLimited", { seconds: f.retryAfter ?? 60 }),
        });
        return;
      case "USER_NOT_ACTIVE":
        showToast({ type: "error", message: t("skills.internalNotActive") });
        return;
      case "SKILL_NOT_DOWNLOADABLE":
        showToast({ type: "error", message: t("skills.internalDeprecated") });
        return;
      case "not-logged-in":
        showToast({ type: "error", message: t("skills.internalLoginRequired") });
        return;
      case "INVALID_PACKAGE":
        showToast({ type: "error", message: t("skills.internalInvalidPackage") });
        return;
      default:
        showToast({ type: "error", message: t("skills.internalUnavailable") });
    }
  };

  const run = async (action: Exclude<Busy, null>) => {
    if (!api || busy) return;
    const fn =
      action === "install" ? api.install : action === "update" ? api.update : api.uninstall;
    if (!fn) return; // preload 未暴露(旧版)时按钮已禁用,这里只是类型收窄
    setBusy(action);
    try {
      const r = await fn(skill.id);
      if (r.ok) {
        if (action === "install") {
          showToast({ type: "success", message: t("skills.installSuccess") });
        } else if (action === "update") {
          // 304/内容未变 → 提示已是最新(台账已对齐,列表刷新后徽章消失)
          const updated = (r as { updated?: boolean }).updated !== false;
          showToast({
            type: "success",
            message: t(updated ? "skills.installSuccess" : "skills.internalUpToDate"),
          });
        }
        onChanged();
      } else {
        toastFailure(r);
      }
    } finally {
      setBusy(null);
    }
  };

  // 安装状态以 prop 为准:安装/卸载后上层重拉列表并同步 selected(同 id 新对象),
  // 组件内 detail state 只在 mount 初始化,拿它判断会停在操作前的旧状态。
  const installed = skill.isInstalled;
  const hasUpdate = skill.hasUpdate;
  const deprecated = (detail.state ?? skill.state) === "DEPRECATED";
  const actionsReady = !!api?.install; // preload 未暴露(旧版)时禁用动作按钮

  // guide 优先;INLINE 型的 inlineContent 作为补充预览段
  const guide = typeof detail.guide === "string" ? detail.guide.trim() : "";
  const inline = typeof detail.inlineContent === "string" ? detail.inlineContent.trim() : "";
  const manifest = Array.isArray(detail.fileManifest) ? detail.fileManifest : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 shrink-0">
        {/* flex-wrap:设置弹窗较窄,标题/徽章/按钮挤不下时按钮折行,而不是把标题挤没 */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/50 shrink-0">
            <Lightning size={20} className="text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0 basis-48">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-base font-semibold truncate">
                {detail.displayName || detail.slug}
              </h3>
              {installed && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 border-status-success-border text-status-success-foreground shrink-0"
                >
                  <CheckCircle size={10} className="mr-0.5" />
                  {t("skills.installed")}
                </Badge>
              )}
              {installed && hasUpdate && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 border-status-warning-border text-status-warning-foreground shrink-0"
                >
                  <ArrowCircleUp size={10} className="mr-0.5" />
                  {t("skills.internalUpdatable")}
                </Badge>
              )}
              {deprecated && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground shrink-0">
                  {t("skills.internalDeprecated")}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-sm text-muted-foreground">
              <span className="truncate">{detail.slug}</span>
              {typeof detail.downloadVersion === "number" && detail.downloadVersion > 0 && (
                <span className="shrink-0">v{detail.downloadVersion}</span>
              )}
              {detail.isOwn && (
                <span className="flex items-center gap-0.5 shrink-0 text-xs">
                  <UserCircle size={12} />
                  {t("skills.internalOwn")}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {installed ? (
              <>
                {hasUpdate && (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={!actionsReady || busy !== null}
                    onClick={() => run("update")}
                  >
                    {busy === "update" ? (
                      <SpinnerGap size={14} className="animate-spin" />
                    ) : (
                      <ArrowCircleUp size={14} />
                    )}
                    {t("skills.internalUpdate")}
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  disabled={!actionsReady || busy !== null}
                  onClick={() => run("uninstall")}
                >
                  {busy === "uninstall" ? (
                    <SpinnerGap size={14} className="animate-spin" />
                  ) : (
                    <Trash size={14} />
                  )}
                  {t("skills.uninstall")}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={!actionsReady || busy !== null || deprecated}
                onClick={() => run("install")}
              >
                {busy === "install" ? (
                  <SpinnerGap size={14} className="animate-spin" />
                ) : (
                  <DownloadSimple size={14} />
                )}
                {t("skills.install")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {detailLoading && !guide ? (
          <div className="flex items-center justify-center py-12">
            <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="px-6 py-4 space-y-6">
            {detail.description && (
              <p className="text-sm text-muted-foreground">{detail.description}</p>
            )}
            {guide ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{guide}</ReactMarkdown>
              </div>
            ) : !detail.description && !inline ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <p className="text-sm">{t("skills.noReadme")}</p>
              </div>
            ) : null}
            {inline && (
              <div>
                <h4 className="text-xs font-medium uppercase text-muted-foreground mb-2">
                  {t("skills.internalInlinePreview")}
                </h4>
                <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border border-border/50 p-4">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{inline}</ReactMarkdown>
                </div>
              </div>
            )}
            {manifest && manifest.length > 0 && (
              <div>
                <h4 className="text-xs font-medium uppercase text-muted-foreground mb-2">
                  {t("skills.internalFileManifest")}
                </h4>
                <ul className="text-xs text-muted-foreground space-y-1 font-mono">
                  {manifest.map((f, i) => {
                    // 形状防御:契约未穷举 manifest 条目字段,只认得出的 path/size
                    const item = f as Record<string, unknown>;
                    const p =
                      typeof item === "string"
                        ? item
                        : typeof item.path === "string"
                          ? item.path
                          : typeof item.name === "string"
                            ? item.name
                            : null;
                    if (!p) return null;
                    const size = typeof item.size === "number" ? item.size : null;
                    return (
                      <li key={`${p}:${i}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">{p}</span>
                        {size !== null && (
                          <span className="shrink-0">
                            {size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
