"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  Folder,
  Sparkle,
  SpinnerGap,
  Trash,
  Warning,
  XCircle,
} from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import { useTranslation } from "@/hooks/useTranslation";
import type { GsdInstallStatus, AilabInstallStatus } from "@/types/electron";

const GSD_SOURCE_URL = "https://github.com/gsd-build/get-shit-done";
const AILAB_SOURCE_URL = "https://github.com/qitianersheng/ai-lab-test-agent";

/**
 * Register the Playwright MCP (npx -y @playwright/mcp@latest --browser chromium)
 * in ~/.claude.json via the HTTP API so it's live immediately (the API
 * invalidates the loader cache). The server name MUST be exactly "playwright"
 * — mcp__playwright is hard-coded into the chat allowedTools for auto-approval,
 * and the shadow-HOME npx cache mirroring keys off that name. Idempotent: a
 * 409 (already exists) is treated as success.
 */
async function ensurePlaywrightMcp(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/plugins/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "playwright",
        server: {
          command: "npx",
          args: ["-y", "@playwright/mcp@latest", "--browser", "chromium"],
          type: "stdio",
        },
      }),
    });
    if (res.ok || res.status === 409) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data?.error || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * "Plugins" settings panel. Currently hosts a single internal plugin (vendor-
 * bundled GSD), but designed so additional internal plugins can plug in here
 * without further changes to SettingsLayout.
 */
export function PluginsManager() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t("settings.plugins.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.plugins.subtitle")}
        </p>
      </div>
      <GsdPluginCard />
      <AilabPluginCard />
    </div>
  );
}

// ────────────────────────── GSD card ──────────────────────────

function GsdPluginCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GsdInstallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "toggle" | "resync" | "uninstall">(null);
  const [error, setError] = useState<string | null>(null);
  const [showUninstall, setShowUninstall] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.gsd) {
      setError(t("settings.plugins.electronOnly"));
      setLoading(false);
      return;
    }
    try {
      const s = await window.electronAPI.gsd.getStatus();
      setStatus(s);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleToggle = async (next: boolean) => {
    if (!window.electronAPI?.gsd) return;
    setBusy("toggle");
    try {
      const s = next
        ? await window.electronAPI.gsd.enable()
        : await window.electronAPI.gsd.disable();
      setStatus(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleResync = async () => {
    if (!window.electronAPI?.gsd) return;
    setBusy("resync");
    try {
      const s = await window.electronAPI.gsd.resync();
      setStatus(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleUninstall = async () => {
    if (!window.electronAPI?.gsd) return;
    setShowUninstall(false);
    setBusy("uninstall");
    try {
      const s = await window.electronAPI.gsd.uninstall();
      setStatus(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleOpenDir = async () => {
    if (status?.installPath && window.electronAPI?.shell) {
      await window.electronAPI.shell.openPath(status.installPath);
    }
  };

  if (loading) {
    return (
      <SettingsCard
        title="GSD (Get-Shit-Done)"
        description={t("settings.gsd.description")}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerGap size={16} className="animate-spin" />
          {t("settings.gsd.loading")}
        </div>
      </SettingsCard>
    );
  }

  if (error || !status) {
    return (
      <SettingsCard
        title="GSD (Get-Shit-Done)"
        description={t("settings.gsd.description")}
      >
        <div className="flex items-center gap-2 text-sm text-destructive">
          <XCircle size={16} />
          {error ?? t("settings.gsd.errorUnknown")}
        </div>
      </SettingsCard>
    );
  }

  const manifest = status.manifest;
  const isEnabled = status.enabled;
  const versionShort = status.installedVersion ?? t("settings.gsd.notInstalled");
  const conflictCount = status.conflicts.length;

  return (
    <SettingsCard className="relative">
      {/* Header: icon + title + status badge + enable switch */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md border border-border/40 bg-accent/30 p-2">
            <Sparkle size={20} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">
                {manifest?.displayName ?? "GSD (Get-Shit-Done)"}
              </h3>
              <StatusBadge enabled={isEnabled} installed={status.installed} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.gsd.description")}
            </p>
          </div>
        </div>
        <Switch
          checked={isEnabled}
          disabled={busy !== null}
          onCheckedChange={handleToggle}
          aria-label={t(
            isEnabled ? "settings.gsd.actions.disable" : "settings.gsd.actions.enable",
          )}
        />
      </div>

      {/* Conflict banner */}
      {conflictCount > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning-foreground/90 lint-allow-raw-color">
          <Warning size={14} className="mt-0.5 flex-shrink-0" />
          <div className="space-y-0.5">
            <div className="font-medium">
              {t("settings.gsd.conflictTitle", { n: String(conflictCount) })}
            </div>
            <div className="text-muted-foreground">
              {t("settings.gsd.conflictBody")}
            </div>
          </div>
        </div>
      )}

      {/* Detail rows */}
      <FieldRow label={t("settings.gsd.version")} separator>
        <span className="font-mono text-xs">{versionShort}</span>
      </FieldRow>

      <FieldRow label={t("settings.gsd.commandCount")}>
        <span className="text-xs">
          {manifest?.commandCount ?? 0}
        </span>
      </FieldRow>

      <FieldRow
        label={t("settings.gsd.agentCount")}
        // description hidden — restore by uncommenting.
        // description={t("settings.gsd.agentMirrorPath")}
      >
        <span className="text-xs">
          {manifest?.agentCount ?? 0}
        </span>
      </FieldRow>

      <FieldRow label={t("settings.gsd.source")}>
        <a
          href={GSD_SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline"
        >
          {manifest?.source ?? "gsd-build/get-shit-done"}
        </a>
      </FieldRow>

      <FieldRow
        label={t("settings.gsd.license")}
        // description hidden — restore by uncommenting.
        // description={t("settings.gsd.licenseDesc")}
      >
        <span className="text-xs">{manifest?.license ?? "MIT"}</span>
      </FieldRow>

      <FieldRow label={t("settings.gsd.installPath")}>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenDir}
          disabled={!status.installed}
          className="gap-1 text-xs"
        >
          <Folder size={14} />
          {t("settings.gsd.actions.openDir")}
        </Button>
      </FieldRow>

      {/* Footer action row */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/30 pt-4">
        {/* "立即重新同步" button hidden — handleResync / busy='resync' state /
            ArrowsClockwise import preserved. Restore by uncommenting. */}
        {/* <Button
          variant="outline"
          size="sm"
          onClick={handleResync}
          disabled={busy !== null}
          className="gap-1.5"
        >
          {busy === "resync" ? (
            <SpinnerGap size={14} className="animate-spin" />
          ) : (
            <ArrowsClockwise size={14} />
          )}
          {t("settings.gsd.actions.resync")}
        </Button> */}
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowUninstall(true)}
          disabled={busy !== null || !status.installed}
          className="gap-1.5"
        >
          <Trash size={14} />
          {t("settings.gsd.actions.uninstall")}
        </Button>
      </div>

      {/* Uninstall confirm */}
      <AlertDialog open={showUninstall} onOpenChange={setShowUninstall}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.gsd.uninstallTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.gsd.uninstallDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settings.gsd.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUninstall}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("settings.gsd.confirmUninstall")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  );
}

// ────────────────────────── AI_LabTest card ──────────────────────────

function AilabPluginCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AilabInstallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "toggle" | "uninstall">(null);
  const [error, setError] = useState<string | null>(null);
  const [mcpWarning, setMcpWarning] = useState<string | null>(null);
  const [showUninstall, setShowUninstall] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.ailab) {
      setError(t("settings.plugins.electronOnly"));
      setLoading(false);
      return;
    }
    try {
      const s = await window.electronAPI.ailab.getStatus();
      setStatus(s);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleToggle = async (next: boolean) => {
    if (!window.electronAPI?.ailab) return;
    setBusy("toggle");
    setMcpWarning(null);
    try {
      const s = next
        ? await window.electronAPI.ailab.enable()
        : await window.electronAPI.ailab.disable();
      setStatus(s);
      // On enable, register the Playwright MCP so `ai-lab-test:execute` can
      // drive a browser. Non-fatal: commands still work without it.
      if (next) {
        const mcp = await ensurePlaywrightMcp();
        if (!mcp.ok) {
          setMcpWarning(
            t("settings.ailab.mcpWarning", { error: mcp.error ?? "" }),
          );
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleUninstall = async () => {
    if (!window.electronAPI?.ailab) return;
    setShowUninstall(false);
    setBusy("uninstall");
    try {
      const s = await window.electronAPI.ailab.uninstall();
      setStatus(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleOpenDir = async () => {
    if (status?.installPath && window.electronAPI?.shell) {
      await window.electronAPI.shell.openPath(status.installPath);
    }
  };

  if (loading) {
    return (
      <SettingsCard
        title="AI_LabTest"
        description={t("settings.ailab.description")}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerGap size={16} className="animate-spin" />
          {t("settings.ailab.loading")}
        </div>
      </SettingsCard>
    );
  }

  if (error || !status) {
    return (
      <SettingsCard
        title="AI_LabTest"
        description={t("settings.ailab.description")}
      >
        <div className="flex items-center gap-2 text-sm text-destructive">
          <XCircle size={16} />
          {error ?? t("settings.ailab.errorUnknown")}
        </div>
      </SettingsCard>
    );
  }

  const manifest = status.manifest;
  const isEnabled = status.enabled;
  const versionShort = status.installedVersion ?? t("settings.ailab.notInstalled");

  return (
    <SettingsCard className="relative">
      {/* Header: icon + title + status badge + enable switch */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md border border-border/40 bg-accent/30 p-2">
            <Sparkle size={20} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">
                {manifest?.displayName ?? "AI_LabTest"}
              </h3>
              <StatusBadge enabled={isEnabled} installed={status.installed} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.ailab.description")}
            </p>
          </div>
        </div>
        <Switch
          checked={isEnabled}
          disabled={busy !== null}
          onCheckedChange={handleToggle}
          aria-label={t(
            isEnabled ? "settings.ailab.actions.disable" : "settings.ailab.actions.enable",
          )}
        />
      </div>

      {/* Playwright MCP note / warning */}
      {mcpWarning ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning-foreground/90 lint-allow-raw-color">
          <Warning size={14} className="mt-0.5 flex-shrink-0" />
          <div>{mcpWarning}</div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("settings.ailab.mcpNote")}
        </p>
      )}

      {/* Detail rows */}
      <FieldRow label={t("settings.ailab.version")} separator>
        <span className="font-mono text-xs">{versionShort}</span>
      </FieldRow>

      <FieldRow label={t("settings.ailab.commandCount")}>
        <span className="text-xs">{manifest?.commandCount ?? 0}</span>
      </FieldRow>

      <FieldRow label={t("settings.ailab.skillCount")}>
        <span className="text-xs">{manifest?.skillCount ?? 0}</span>
      </FieldRow>

      <FieldRow label={t("settings.ailab.source")}>
        <a
          href={AILAB_SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline"
        >
          {manifest?.source ?? "qitianersheng/ai-lab-test-agent"}
        </a>
      </FieldRow>

      <FieldRow label={t("settings.ailab.license")}>
        <span className="text-xs">{manifest?.license ?? "MIT"}</span>
      </FieldRow>

      <FieldRow label={t("settings.ailab.installPath")}>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenDir}
          disabled={!status.installed}
          className="gap-1 text-xs"
        >
          <Folder size={14} />
          {t("settings.ailab.actions.openDir")}
        </Button>
      </FieldRow>

      {/* Footer action row */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/30 pt-4">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowUninstall(true)}
          disabled={busy !== null || !status.installed}
          className="gap-1.5"
        >
          <Trash size={14} />
          {t("settings.ailab.actions.uninstall")}
        </Button>
      </div>

      {/* Uninstall confirm */}
      <AlertDialog open={showUninstall} onOpenChange={setShowUninstall}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.ailab.uninstallTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.ailab.uninstallDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settings.ailab.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUninstall}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("settings.ailab.confirmUninstall")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  );
}

function StatusBadge({
  enabled,
  installed,
}: {
  enabled: boolean;
  installed: boolean;
}) {
  const { t } = useTranslation();
  if (!installed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        <XCircle size={10} />
        {t("settings.gsd.status.notInstalled")}
      </span>
    );
  }
  if (enabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
        <CheckCircle size={10} />
        {t("settings.gsd.status.enabled")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {t("settings.gsd.status.disabled")}
    </span>
  );
}
