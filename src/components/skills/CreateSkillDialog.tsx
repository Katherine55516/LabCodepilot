"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SpinnerGap, Globe, FolderOpen } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";

interface CreateSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, scope: "global" | "project", content: string) => Promise<void>;
  /**
   * Whether a project working directory is selected. When false, the "project"
   * scope is disabled and creation defaults to global — otherwise a project
   * skill would be written to the server's process.cwd() (an orphan location).
   */
  hasProject?: boolean;
}

const TEMPLATES: { label: string; content: string }[] = [
  { label: "Blank", content: "" },
  {
    label: "Commit Helper",
    content: `# Commit Helper

Review the staged changes and generate a concise, descriptive commit message following conventional commit format.

Rules:
- Use conventional commit prefixes: feat, fix, refactor, docs, test, chore
- Keep the first line under 72 characters
- Add a blank line and detailed description if needed
- Reference relevant issue numbers if applicable
`,
  },
  {
    label: "Code Reviewer",
    content: `# Code Reviewer

Review the provided code and give feedback on:

1. **Correctness** - Logic errors, edge cases, potential bugs
2. **Performance** - Inefficiencies, unnecessary allocations
3. **Readability** - Naming, structure, comments where needed
4. **Security** - Input validation, injection risks, data exposure

Be specific with line references. Suggest concrete improvements, not just problems.
`,
  },
];

export function CreateSkillDialog({
  open,
  onOpenChange,
  onCreate,
  hasProject = true,
}: CreateSkillDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"global" | "project">(hasProject ? "project" : "global");
  const [templateIdx, setTemplateIdx] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // Without a selected project, "project" scope has nowhere valid to write —
  // force global whenever the dialog opens in that state.
  useEffect(() => {
    if (open && !hasProject) setScope("global");
  }, [open, hasProject]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('skills.nameRequired'));
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      setError(t('skills.nameInvalid'));
      return;
    }

    setCreating(true);
    setError("");
    try {
      await onCreate(trimmed, scope, TEMPLATES[templateIdx].content);
      // Reset on success
      setName("");
      setScope(hasProject ? "project" : "global");
      setTemplateIdx(0);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create skill");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('skills.createSkill')}</DialogTitle>
          <DialogDescription>
            Create a new slash command skill. It will be saved as a .md file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name input */}
          <div className="space-y-2">
            <Label htmlFor="skill-name">{t('skills.skillName')}</Label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">/</span>
              <Input
                id="skill-name"
                placeholder="my-skill"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
          </div>

          {/* Scope selection */}
          <div className="space-y-2">
            <Label>{t('skills.scope')}</Label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!hasProject}
                onClick={() => hasProject && setScope("project")}
                className={cn(
                  "flex-1 justify-start",
                  scope === "project"
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border hover:bg-accent",
                  !hasProject && "opacity-50 cursor-not-allowed"
                )}
              >
                <FolderOpen size={16} />
                {t('skills.project')}
              </Button>
              <Button
                variant="outline"
                onClick={() => setScope("global")}
                className={cn(
                  "flex-1 justify-start",
                  scope === "global"
                    ? "border-status-success-border bg-status-success-muted text-status-success-foreground"
                    : "border-border hover:bg-accent"
                )}
              >
                <Globe size={16} />
                {t('skills.global')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {!hasProject
                ? "No project selected — saved globally in ~/.claude/commands/ (available everywhere)"
                : scope === "project"
                  ? "Saved in .claude/commands/ (this project only)"
                  : "Saved in ~/.claude/commands/ (available everywhere)"}
            </p>
          </div>

          {/* Template selection */}
          <div className="space-y-2">
            <Label>{t('skills.template')}</Label>
            <div className="flex gap-2 flex-wrap">
              {TEMPLATES.map((tpl, i) => (
                <Button
                  key={tpl.label}
                  variant="outline"
                  size="xs"
                  onClick={() => setTemplateIdx(i)}
                  className={cn(
                    templateIdx === i
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-accent"
                  )}
                >
                  {tpl.label}
                </Button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            {t('common.cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={creating} className="gap-2">
            {creating && <SpinnerGap size={16} className="animate-spin" />}
            {t('skills.createSkill')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
