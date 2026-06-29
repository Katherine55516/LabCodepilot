"use client";

import { Lightning, Trash } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";

export interface SkillItem {
  name: string;
  description: string;
  content: string;
  source: "global" | "project" | "plugin" | "installed";
  installedSource?: "agents" | "claude";
  filePath: string;
  /** Working directory of the owning project (project-scoped skills only). */
  projectCwd?: string;
  /** Display name of the owning project (project-scoped skills only). */
  projectName?: string;
}

interface SkillListItemProps {
  skill: SkillItem;
  selected: boolean;
  onSelect: () => void;
  onDelete: (skill: SkillItem) => void;
  /**
   * Fallback project display name. Prefer `skill.projectName`; this prop is a
   * fallback for callers that don't tag skills per-project.
   */
  projectName?: string;
}

export function SkillListItem({
  skill,
  selected,
  onSelect,
  onDelete,
  projectName,
}: SkillListItemProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete(skill);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      // Auto-reset after 3 seconds
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer transition-colors",
        selected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50"
      )}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setConfirmDelete(false);
      }}
    >
      <Lightning size={16} className="shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">/{skill.name}</span>
          {skill.source === "project" && (skill.projectName || projectName) && (
            <span
              className="shrink-0 rounded border border-primary/30 bg-primary/5 px-1 py-0 text-[9px] font-medium leading-tight text-primary/80"
              title={`Project: ${skill.projectName || projectName}`}
            >
              {skill.projectName || projectName}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {skill.description}
        </p>
      </div>
      {(hovered || confirmDelete) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={confirmDelete ? "destructive" : "ghost"}
              size="icon-xs"
              className="shrink-0"
              onClick={handleDelete}
            >
              <Trash size={12} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {confirmDelete ? t('skills.deleteConfirm') : t('common.delete')}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
