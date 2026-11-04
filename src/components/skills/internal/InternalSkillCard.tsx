"use client";

import { Lightning, CheckCircle, ArrowCircleUp, UserCircle } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { InternalStoreSkill } from "@/types/electron";

interface InternalSkillCardProps {
  skill: InternalStoreSkill;
  selected: boolean;
  onSelect: () => void;
}

/** 内部市场列表卡片 — 对照外部 MarketplaceSkillCard 的布局与选中态。 */
export function InternalSkillCard({ skill, selected, onSelect }: InternalSkillCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer transition-colors",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      )}
      onClick={onSelect}
    >
      <Lightning size={16} className="shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{skill.displayName || skill.slug}</span>
          {/* 徽章优先级:可更新 > 已安装(两者互斥展示,可更新蕴含已安装) */}
          {skill.isInstalled && skill.hasUpdate ? (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-status-warning-border text-status-warning-foreground shrink-0"
            >
              <ArrowCircleUp size={10} className="mr-0.5" />
              {t('skills.internalUpdatable')}
            </Badge>
          ) : skill.isInstalled ? (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-status-success-border text-status-success-foreground shrink-0"
            >
              <CheckCircle size={10} className="mr-0.5" />
              {t('skills.installed')}
            </Badge>
          ) : null}
          {skill.state === 'DEPRECATED' && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 text-muted-foreground shrink-0"
            >
              {t('skills.internalDeprecated')}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{skill.description || skill.slug}</span>
          {skill.isOwn && (
            <span className="flex items-center gap-0.5 shrink-0">
              <UserCircle size={10} />
              {t('skills.internalOwn')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
