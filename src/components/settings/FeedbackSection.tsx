"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SpinnerGap, UserCircle } from "@/components/ui/icon";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import { useAccount } from "@/hooks/useAccount";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";
import type { TranslationKey } from "@/i18n";

const MESSAGE_MAX = 5000;

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
  const [submitting, setSubmitting] = useState(false);

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
      const result = await window.electronAPI!.feedback!.submit({
        message: trimmed,
        includeLog,
      });
      if (result.ok) {
        showToast({ type: "success", message: t("feedback.success") });
        setMessage("");
        setIncludeLog(false);
      } else {
        const errorKeys: Record<string, TranslationKey> = {
          "not-logged-in": "feedback.errorNotLoggedIn",
          "rate-limited": "feedback.errorRateLimited",
          "too-large": "feedback.errorTooLarge",
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
