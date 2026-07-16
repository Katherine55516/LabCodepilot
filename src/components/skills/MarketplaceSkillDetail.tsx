"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DownloadSimple,
  Trash,
  CheckCircle,
  ArrowSquareOut,
  Lightning,
  SpinnerGap,
  Translate,
} from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";
import { InstallProgressDialog } from "./InstallProgressDialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MarketplaceSkill } from "@/types";

interface MarketplaceSkillDetailProps {
  skill: MarketplaceSkill;
  onInstallComplete: () => void;
}

// AI-translated READMEs, keyed by `${source}/${skillId}::${locale}`.
// Module-level so revisiting a skill (or toggling 原文/译文) within the page
// session never re-pays the model call.
const translationCache = new Map<string, string>();

export function MarketplaceSkillDetail({
  skill,
  onInstallComplete,
}: MarketplaceSkillDetailProps) {
  const { t, locale } = useTranslation();
  const [showProgress, setShowProgress] = useState(false);
  const [progressAction, setProgressAction] = useState<"install" | "uninstall">("install");
  const [readme, setReadme] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(true);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);

  const cacheKey = `${skill.source}/${skill.skillId}::${locale}`;
  // Guards late translate responses after the user switched skill/locale:
  // apply-to-state only when the response still belongs to the current view
  // (the cache write itself is always safe — it's keyed by the request).
  const cacheKeyRef = useRef(cacheKey);

  useEffect(() => {
    cacheKeyRef.current = cacheKey;
    setTranslation(translationCache.get(cacheKey) ?? null);
    setShowTranslation(false);
    setTranslating(false);
  }, [cacheKey]);

  useEffect(() => {
    let cancelled = false;
    setReadme(null);
    setReadmeLoading(true);

    const fetchReadme = async () => {
      try {
        const params = new URLSearchParams({
          source: skill.source,
          skillId: skill.skillId,
        });
        const res = await fetch(`/api/skills/marketplace/readme?${params}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setReadme(data.content || null);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setReadmeLoading(false);
      }
    };

    fetchReadme();
    return () => { cancelled = true; };
  }, [skill.source, skill.skillId]);

  const handleInstall = () => {
    setProgressAction("install");
    setShowProgress(true);
  };

  const handleUninstall = () => {
    setProgressAction("uninstall");
    setShowProgress(true);
  };

  const githubUrl = skill.source.includes("/")
    ? `https://github.com/${skill.source}`
    : null;

  // Strip YAML front matter from readme for display
  const displayContent = readme
    ? readme.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
    : null;

  const handleTranslate = async () => {
    if (translating) return;
    // A translation already exists (state or just-restored cache) → pure toggle
    if (translation) {
      setShowTranslation((v) => !v);
      return;
    }
    if (!displayContent) return;

    const key = cacheKey;
    setTranslating(true);
    try {
      const res = await fetch("/api/skills/marketplace/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: displayContent, targetLocale: locale }),
      });
      if (res.status === 409) {
        showToast({ type: "error", message: t("skills.translateNoProvider") });
        return;
      }
      const data = res.ok ? await res.json() : null;
      const translated = typeof data?.translated === "string" ? data.translated.trim() : "";
      if (!translated) {
        showToast({ type: "error", message: t("skills.translateFailed") });
        return;
      }
      translationCache.set(key, translated);
      if (key === cacheKeyRef.current) {
        setTranslation(translated);
        setShowTranslation(true);
      }
    } catch {
      showToast({ type: "error", message: t("skills.translateFailed") });
    } finally {
      if (key === cacheKeyRef.current) setTranslating(false);
    }
  };

  const translateLabel = translating
    ? t("skills.translating")
    : translation
      ? (showTranslation ? t("skills.showOriginal") : t("skills.showTranslation"))
      : t("skills.aiTranslate");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 shrink-0">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/50 shrink-0">
            <Lightning size={20} className="text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold truncate">{skill.name}</h3>
              {skill.isInstalled && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 border-status-success-border text-status-success-foreground shrink-0"
                >
                  <CheckCircle size={10} className="mr-0.5" />
                  {t('skills.installed')}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-muted-foreground truncate">{skill.source}</span>
              {githubUrl && (
                <a
                  href={githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <ArrowSquareOut size={14} />
                </a>
              )}
              {skill.installs > 0 && (
                <span className="flex items-center gap-0.5 text-xs text-muted-foreground shrink-0">
                  <DownloadSimple size={12} />
                  {skill.installs.toLocaleString()}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {locale !== 'en' && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={translating || readmeLoading || !displayContent}
                onClick={handleTranslate}
              >
                {translating ? (
                  <SpinnerGap size={14} className="animate-spin" />
                ) : (
                  <Translate size={14} />
                )}
                {translateLabel}
              </Button>
            )}
            {skill.isInstalled ? (
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                onClick={handleUninstall}
              >
                <Trash size={14} />
                {t('skills.uninstall')}
              </Button>
            ) : (
              <Button size="sm" className="gap-1.5" onClick={handleInstall}>
                <DownloadSimple size={14} />
                {t('skills.install')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Body — SKILL.md content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {readmeLoading ? (
          <div className="flex items-center justify-center py-12">
            <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : displayContent ? (
          <div className="prose prose-sm dark:prose-invert max-w-none px-6 py-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {showTranslation && translation ? translation : displayContent}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <p className="text-sm">{t('skills.noReadme')}</p>
          </div>
        )}
      </div>

      <InstallProgressDialog
        open={showProgress}
        onOpenChange={setShowProgress}
        action={progressAction}
        source={skill.source}
        skillId={skill.skillId}
        skillName={skill.name}
        onComplete={onInstallComplete}
      />
    </div>
  );
}
