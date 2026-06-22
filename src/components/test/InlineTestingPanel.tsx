"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { ListChecks, ChartBar, Gear, ArrowLeft, FolderPlus, CaretRight, Play, type Icon } from "@/components/ui/icon";
import type { TranslationKey } from "@/i18n";
import { useNativeFolderPicker } from "@/hooks/useNativeFolderPicker";
import { FolderPicker } from "@/components/chat/FolderPicker";

/**
 * Inline testing workbench (Phase 1 · 对话内嵌测试).
 *
 * Opened from the sidebar "测试" entry; fills the whole content area (covers the
 * chat) until 收起. Phase 1 is a UI skeleton — no engine. The 看板 is a two-level
 * project manager: projects list (+ 添加项目) → click a project → its test tasks
 * (+ 新建任务). Data lives in local component state (real, user-entered, NOT mock
 * — just not persisted yet); the engine + persistence land in Phase 2+.
 * Workflow (per design): 需求→用例→执行→报告 (no code analysis).
 */

type View = "dash" | "flow" | "report";
type ModalKind = "none" | "newTask" | "env";
type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

interface Project {
  name: string;
  path: string;
  tasks: { name: string }[];
}

const INPUT =
  "w-full h-9 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-accent";

// Per-task workflow (1-based, no code analysis): 需求→用例→执行→报告.
const PIPELINE: { key: string; name: TranslationKey }[] = [
  { key: "req", name: "test.step.requirements.name" },
  { key: "cases", name: "test.step.cases.name" },
  { key: "exec", name: "test.step.execution.name" },
  { key: "report", name: "test.step.report.name" },
];

export function InlineTestingPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("dash");
  const [modal, setModal] = useState<ModalKind>("none");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedTask, setSelectedTask] = useState<number | null>(null);

  const current = selected !== null ? projects[selected] ?? null : null;
  const activeTask = current && selectedTask !== null ? current.tasks[selectedTask] ?? null : null;

  const addProject = (name: string, path: string) => setProjects((ps) => [...ps, { name, path, tasks: [] }]);
  const addTask = (name: string) =>
    setProjects((ps) => ps.map((p, i) => (i === selected ? { ...p, tasks: [...p.tasks, { name }] } : p)));

  // Projects are picked from a folder — native dialog in Electron, the
  // FolderPicker browse-dialog in the browser. Project name = folder basename.
  const { isElectron, openNativePicker } = useNativeFolderPicker();
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const addProjectFromPath = (path: string) => {
    const name = path.split(/[/\\]+/).filter(Boolean).pop() || path;
    addProject(name, path);
  };
  const handlePickProject = async () => {
    if (isElectron) {
      const path = await openNativePicker({ title: t("test.addProject") });
      if (path) addProjectFromPath(path);
    } else {
      setFolderPickerOpen(true);
    }
  };

  const segBtn = (v: View, label: string) => (
    <button
      onClick={() => setView(v)}
      className={`px-2.5 py-1 text-xs border-r border-border last:border-r-0 transition-colors ${
        view === v ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <ListChecks size={14} className="text-accent" />
          {t("test.title")}
        </span>
        <span className="flex-1" />
        <div className="flex overflow-hidden rounded-md border border-border">
          {segBtn("dash", t("test.view.dash"))}
          {segBtn("flow", t("test.view.flow"))}
          {segBtn("report", t("test.view.report"))}
        </div>
        <button
          onClick={onClose}
          className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          ✕ {t("test.collapse")}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto w-full max-w-4xl">
          {view === "dash" && current === null && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {t("test.projects")} ({projects.length})
                </h3>
                <span className="flex-1" />
                <button
                  onClick={handlePickProject}
                  className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-medium text-accent-foreground"
                >
                  <FolderPlus size={13} /> {t("test.addProject")}
                </button>
              </div>
              {projects.length === 0 ? (
                <EmptyState icon={FolderPlus} text={t("test.projectsEmpty")} />
              ) : (
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  {projects.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSelected(i);
                        setSelectedTask(null);
                      }}
                      className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3 text-left hover:border-accent/60"
                    >
                      <div className="flex items-center gap-2">
                        <FolderPlus size={16} className="text-accent" />
                        <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
                      </div>
                      {p.path && <div className="truncate font-mono text-[11px] text-muted-foreground">{p.path}</div>}
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {t("test.tasks")} · {p.tasks.length}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {view === "dash" && current !== null && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelected(null);
                    setSelectedTask(null);
                  }}
                  className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft size={12} /> {t("test.projects")}
                </button>
                <h3 className="text-sm font-semibold text-foreground">{current.name}</h3>
                <span className="flex-1" />
                <button
                  onClick={() => setModal("env")}
                  className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <Gear size={12} /> {t("test.envModal.title")}
                </button>
                <button
                  onClick={() => setModal("newTask")}
                  className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[11px] font-medium text-accent-foreground"
                >
                  ＋ {t("test.newTask")}
                </button>
              </div>
              {current.tasks.length === 0 ? (
                <EmptyState icon={ListChecks} text={t("test.tasksEmpty")} />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {current.tasks.map((tk, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSelectedTask(i);
                        setView("flow");
                      }}
                      className="rounded-xl border border-border bg-card p-3 text-left hover:border-accent/60"
                    >
                      <span className="text-sm font-medium text-foreground">{tk.name}</span>
                      <div className="mt-1 text-[11px] text-muted-foreground">{t("test.step.pending")}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {view === "flow" &&
            (activeTask ? (
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <button
                    onClick={() => setView("dash")}
                    className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft size={12} /> {t("test.tasks")}
                  </button>
                  <h3 className="text-sm font-semibold text-foreground">{activeTask.name}</h3>
                  {current && <span className="font-mono text-[11px] text-muted-foreground">{current.name}</span>}
                </div>
                <div className="mb-4 flex gap-2">
                  {PIPELINE.map((s, i) => (
                    <div key={s.key} className="flex flex-1 items-center gap-2">
                      <div className="flex-1 rounded-lg border border-border bg-card p-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                          <span className="text-xs font-medium text-foreground">
                            {i + 1}. {t(s.name)}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">{t("test.step.pending")}</div>
                      </div>
                      {i < PIPELINE.length - 1 && <CaretRight size={12} className="shrink-0 text-muted-foreground/40" />}
                    </div>
                  ))}
                </div>
                <EmptyState icon={Play} text={t("test.flow.engineSoon")} />
              </div>
            ) : (
              <EmptyState icon={ListChecks} text={t("test.flowEmpty")} />
            ))}
          {view === "report" && <EmptyState icon={ChartBar} text={t("test.reportEmpty")} />}
        </div>
      </div>

      {/* Modals + folder picker (browser fallback for project selection) */}
      {modal === "newTask" && <NewTaskModal t={t} onClose={() => setModal("none")} onAdd={addTask} />}
      {modal === "env" && <EnvModal t={t} projectName={current?.name ?? ""} onClose={() => setModal("none")} />}
      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={(p) => {
          setFolderPickerOpen(false);
          addProjectFromPath(p);
        }}
      />
    </div>
  );
}

function EmptyState({ icon: IconCmp, text }: { icon: Icon; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <IconCmp size={28} className="text-muted-foreground/40" />
      <p className="mt-3 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[86vh] w-[460px] max-w-[92vw] overflow-auto rounded-xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="mt-0.5 mb-3 text-[11px] text-muted-foreground">{subtitle}</p>}
        <div className={subtitle ? "" : "mt-3"}>{children}</div>
        <div className="mt-4 flex gap-2">{footer}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-[11px] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const CANCEL_BTN = "flex-1 h-9 rounded-md border border-border text-xs text-foreground hover:bg-muted";
const PRIMARY_BTN =
  "flex-1 h-9 rounded-md bg-accent text-xs font-medium text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed";

function NewTaskModal({ t, onClose, onAdd }: { t: T; onClose: () => void; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <ModalShell
      title={t("test.newTaskModal.title")}
      subtitle={t("test.newTaskModal.subtitle")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={CANCEL_BTN}>{t("test.cancel")}</button>
          <button
            disabled={!name.trim()}
            onClick={() => {
              onAdd(name.trim());
              onClose();
            }}
            className={PRIMARY_BTN}
          >
            {t("test.newTaskModal.create")}
          </button>
        </>
      }
    >
      <Field label={t("test.newTaskModal.nameLabel")}>
        <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("test.newTaskModal.namePlaceholder")} />
      </Field>
      <Field label={t("test.newTaskModal.targetLabel")}>
        <input className={INPUT} placeholder="http://localhost:3000/..." />
      </Field>
      <Field label={t("test.newTaskModal.importLabel")}>
        <div className="flex gap-2">
          <button className="h-9 flex-1 rounded-md border border-border text-xs text-foreground hover:bg-muted">📊 {t("test.newTaskModal.importCases")}</button>
          <button className="h-9 flex-1 rounded-md border border-border text-xs text-foreground hover:bg-muted">📄 {t("test.newTaskModal.importReqs")}</button>
          <button className="h-9 rounded-md border border-border px-3 text-xs text-muted-foreground hover:bg-muted">⬇ {t("test.newTaskModal.template")}</button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{t("test.newTaskModal.importHint")}</p>
      </Field>
      <div className="rounded-md bg-status-warning-muted px-3 py-2 text-[11px] text-status-warning-foreground">
        ⚠ {t("test.newTaskModal.envWarn")}
      </div>
    </ModalShell>
  );
}

function EnvModal({ t, projectName, onClose }: { t: T; projectName: string; onClose: () => void }) {
  const [tab, setTab] = useState<"local" | "sit">("local");
  return (
    <ModalShell
      title={projectName ? `${t("test.envModal.title")} · ${projectName}` : t("test.envModal.title")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={CANCEL_BTN}>{t("test.cancel")}</button>
          <button onClick={onClose} className={PRIMARY_BTN}>{t("test.envModal.save")}</button>
        </>
      }
    >
      <div className="mb-3 flex gap-1 border-b border-border">
        {(["local", "sit"] as const).map((e) => (
          <button
            key={e}
            onClick={() => setTab(e)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-xs ${
              tab === e ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {e === "local" ? "local" : "SIT"}
          </button>
        ))}
      </div>
      <Field label={t("test.envModal.frontendLabel")}>
        <input className={INPUT} placeholder="http://localhost:3000" />
      </Field>
      <Field label={t("test.envModal.apiLabel")}>
        <input className={INPUT} placeholder="http://localhost:3000/api" />
      </Field>
      <Field label={t("test.envModal.userLabel")}>
        <input className={INPUT} placeholder="test_user" />
      </Field>
      <Field label={t("test.envModal.adminLabel")}>
        <input className={INPUT} placeholder={t("test.envModal.adminPlaceholder")} />
      </Field>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("test.envModal.note")}</p>
    </ModalShell>
  );
}
