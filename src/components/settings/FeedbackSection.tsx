"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SpinnerGap, UserCircle, Plus, X } from "@/components/ui/icon";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import { useAccount } from "@/hooks/useAccount";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";
import type { TranslationKey } from "@/i18n";

const MESSAGE_MAX = 5000;
/** 与 electron/feedback-core.ts 及服务端同值（服务端复验，这里只做前置拦截）。 */
const MAX_IMAGES = 5;
const IMAGE_MAX_BYTES = 1024 * 1024;
const ALLOWED_IMAGE_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp"];

interface PendingImage {
  id: string;
  name: string;
  type: string;
  size: number;
  file: File;
  /** createObjectURL 生成的预览地址，卸载/移除时 revoke。 */
  url: string;
}

/**
 * 设置页「问题反馈」— 文字描述 + 可选附带应用日志（默认不勾），登录态一键
 * 上报到账号后端。上报走主进程 IPC（token 与 main.log 都只在主进程），
 * 身份以服务端 JWT claims 为准。契约见
 * docs/exec-plans/active/bug-report-feedback.md。
 */
export function FeedbackSection() {
  const { t } = useTranslation();
  const { authenticated, triggerLogin, loading } = useAccount();
  const [message, setMessage] = useState("");
  const [includeLog, setIncludeLog] = useState(false); // 用户决策：默认不上传日志
  const [images, setImages] = useState<PendingImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 卸载时释放所有预览 URL（组件常驻设置页，反复贴图不 revoke 会累积）
  const imagesRef = useRef<PendingImage[]>([]);
  imagesRef.current = images;
  useEffect(() => () => imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  /**
   * 收编待上传图片：逐张校验类型/大小，并按剩余名额截断。
   * 三个拒绝理由分别给提示 —— 只说"添加失败"用户不知道该改什么。
   */
  const addFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    setImages((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (room <= 0) {
        showToast({ type: "warning", message: t("feedback.imageTooMany").replace("{max}", String(MAX_IMAGES)) });
        return prev;
      }
      const accepted: PendingImage[] = [];
      let badType = false;
      let tooBig = false;
      for (const file of files) {
        if (accepted.length >= room) break;
        if (!ALLOWED_IMAGE_MIME.includes(file.type)) { badType = true; continue; }
        if (file.size > IMAGE_MAX_BYTES) { tooBig = true; continue; }
        accepted.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name || "screenshot.png",
          type: file.type,
          size: file.size,
          file,
          url: URL.createObjectURL(file),
        });
      }
      if (badType) showToast({ type: "warning", message: t("feedback.imageBadType") });
      if (tooBig) showToast({ type: "warning", message: t("feedback.imageTooLarge") });
      if (files.length > room && accepted.length === room) {
        showToast({ type: "warning", message: t("feedback.imageTooMany").replace("{max}", String(MAX_IMAGES)) });
      }
      return accepted.length ? [...prev, ...accepted] : prev;
    });
  }, [t]);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const hit = prev.find((i) => i.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  /** 剪贴板粘贴：只取 items 里的图片，纯文本粘贴照常走默认行为。 */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (!files.length) return;
    e.preventDefault(); // 阻止把二进制当文本插进输入框
    addFiles(files);
  }, [addFiles]);

  // Web dev 环境（无 Electron preload）：整节提示仅桌面版可用
  const desktopAvailable =
    typeof window !== "undefined" && !!window.electronAPI?.feedback;

  const trimmed = message.trim();
  const canSubmit =
    desktopAvailable && authenticated && !submitting && trimmed.length > 0 && trimmed.length <= MESSAGE_MAX;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // File → ArrayBuffer：IPC 走结构化克隆，File 对象本身传不过去
      const payloadImages = await Promise.all(
        images.map(async (i) => ({ name: i.name, type: i.type, data: await i.file.arrayBuffer() })),
      );
      const result = await window.electronAPI!.feedback!.submit({
        message: trimmed,
        includeLog,
        images: payloadImages,
      });
      if (result.ok) {
        showToast({ type: "success", message: t("feedback.success") });
        setMessage("");
        setIncludeLog(false);
        images.forEach((i) => URL.revokeObjectURL(i.url));
        setImages([]);
      } else {
        const errorKeys: Record<string, TranslationKey> = {
          "not-logged-in": "feedback.errorNotLoggedIn",
          // 429：服务端每日次数上限。按产品决策，只有真正撞上限时才提示，
          // 未达上限期间界面不出现任何次数相关文案。
          "rate-limited": "feedback.errorDailyLimit",
          "too-large": "feedback.errorTooLarge",
          "invalid-image": "feedback.errorInvalidImage",
          network: "feedback.errorNetwork",
        };
        showToast({
          type: "error",
          message: t(errorKeys[result.error] ?? "feedback.errorGeneric"),
        });
      }
    } catch {
      showToast({ type: "error", message: t("feedback.errorGeneric") });
    } finally {
      setSubmitting(false);
    }
  };

  if (!desktopAvailable) {
    return (
      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <h2 className="text-base font-semibold">{t("feedback.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("feedback.desktopOnly")}</p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsCard title={t("feedback.title")} description={t("feedback.description")}>
        {!loading && !authenticated ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t("feedback.loginRequired")}</p>
            <Button onClick={() => void triggerLogin()} size="sm" className="w-fit">
              <UserCircle size={16} />
              <span>{t("auth.login")}</span>
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onPaste={handlePaste}
                placeholder={t("feedback.placeholder")}
                rows={6}
                maxLength={MESSAGE_MAX}
                disabled={submitting}
                className="resize-y"
              />
              <div className="text-right text-xs text-muted-foreground">
                {message.length} / {MESSAGE_MAX}
              </div>
            </div>

            {/* 截图：粘贴（输入框内 Ctrl/Cmd+V）或点加号选本地图片 */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{t("feedback.images")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("feedback.imagesHint")
                    .replace("{max}", String(MAX_IMAGES))
                    .replace("{size}", "1MB")}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {images.map((img) => (
                  <div
                    key={img.id}
                    className="group relative h-20 w-20 overflow-hidden rounded-md border border-border"
                  >
                    {/* 本地 object URL 预览，无需 next/image 优化 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={img.name} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label={t("feedback.imageRemove")}
                      title={t("feedback.imageRemove")}
                      disabled={submitting}
                      onClick={() => removeImage(img.id)}
                      className="absolute right-0.5 top-0.5 rounded-full bg-background/85 p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100 disabled:pointer-events-none"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {images.length < MAX_IMAGES && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label={t("feedback.imageAdd")}
                    title={t("feedback.imageAdd")}
                    className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Plus size={18} />
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                // accept 只是系统选择器的过滤器，用户仍可切「所有文件」——
                // 真正的把关是 addFiles 里的 MIME 校验与服务端的魔术字节嗅探。
                accept={ALLOWED_IMAGE_MIME.join(",")}
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = ""; // 允许再次选择同一文件
                }}
              />
            </div>

            <FieldRow
              label={t("feedback.includeLog")}
              description={t("feedback.includeLogHint")}
            >
              <Switch
                checked={includeLog}
                onCheckedChange={setIncludeLog}
                disabled={submitting}
              />
            </FieldRow>

            <div className="flex justify-end border-t border-border/30 pt-3">
              <Button onClick={() => void handleSubmit()} disabled={!canSubmit} size="sm">
                {submitting && <SpinnerGap size={16} className="animate-spin" />}
                <span>{submitting ? t("feedback.submitting") : t("feedback.submit")}</span>
              </Button>
            </div>
          </>
        )}
      </SettingsCard>
    </div>
  );
}
