'use client';

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SpinnerGap, Warning } from '@/components/ui/icon';
import { useTranslation } from '@/hooks/useTranslation';
import { buildPreviewSegments } from '@/lib/deid-utils';
import type { DeidPreviewDialogState } from '@/hooks/useDeidGate';
import type { DeidEntity } from '@/types/deid';
import { cn } from '@/lib/utils';

/**
 * 脱敏预览确认弹窗(交互文档 §5.1/§5.2/§5.3)。
 * - 外发预览与真实外发同源(buildPreviewSegments 与 buildOutbound 同一游标算法)
 * - 蓝 = 替换为占位符;黄 = 用户取消脱敏保留原文(同时有勾选状态,不只靠颜色)
 * - 只有 action==='anonymized' 可取消;kept/allowlisted/unlocated 只读展示原因
 * - 失败 fail-closed:只能关闭,不提供"跳过脱敏直接发送"
 */
/**
 * 新增实体输入行。独立组件 = 随 DialogContent 卸载,输入内容天然按次重置
 * (不需要 open 变化时 setState 清空)。
 */
function AddEntityRow({
  loading,
  onAdd,
}: {
  loading: boolean;
  onAdd: (text: string, entityType: string) => void;
}) {
  const { t } = useTranslation();
  const [addText, setAddText] = useState('');
  const [addType, setAddType] = useState('');

  const handleAdd = () => {
    if (!addText.trim() || loading) return;
    onAdd(addText, addType);
    setAddText('');
  };

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{t('deid.addEntity')}</div>
      <div className="flex items-center gap-2">
        <Input
          value={addText}
          onChange={(e) => setAddText(e.target.value)}
          placeholder={t('deid.addEntityPlaceholder')}
          className="h-8 text-xs"
          maxLength={200}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <Input
          value={addType}
          onChange={(e) => setAddType(e.target.value)}
          placeholder={t('deid.addEntityTypePlaceholder')}
          className="h-8 w-36 text-xs"
          maxLength={40}
          list="deid-entity-types"
        />
        <datalist id="deid-entity-types">
          {['PERSON', 'LOCATION', 'ORGANIZATION', 'PHONE_NUMBER', 'EMAIL_ADDRESS', 'CN_ID_CARD', 'PROJECT', 'CUSTOM'].map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 text-xs"
          disabled={!addText.trim() || loading}
          onClick={handleAdd}
        >
          {t('deid.addEntityConfirm')}
        </Button>
      </div>
    </div>
  );
}

export function DeidPreviewDialog(props: DeidPreviewDialogState) {
  const { open, loading, errorStatus, data, hasFiles, excluded, onToggleEntity, onAddEntity, onConfirm, onCancel } = props;
  const { t } = useTranslation();

  const segments = useMemo(
    () => (data ? buildPreviewSegments(data.normalizedText, data.entities || [], excluded) : []),
    [data, excluded],
  );

  const anonymizedCount = data?.entities?.filter((e) => e.action === 'anonymized').length ?? 0;
  const keptCount = excluded.size;
  const normalizationEdits = (data?.normalization?.edits || []).filter((e) => e.accepted !== false);

  const errorMessage =
    errorStatus === null
      ? null
      : errorStatus === 401
        ? t('deid.errAuth')
        : errorStatus === 400
          ? t('deid.errBadRequest')
          : t('deid.errUnavailable');

  const actionLabel = (e: DeidEntity): string => {
    switch (e.action) {
      case 'anonymized':
        return excluded.has(e.id) ? t('deid.actionKeptByUser') : t('deid.actionAnonymized');
      case 'kept':
        return t('deid.actionKept');
      case 'allowlisted':
        return t('deid.actionAllowlisted');
      case 'unlocated':
        return t('deid.actionUnlocated');
      default:
        return e.action;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('deid.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('deid.dialogSubtitle')}</DialogDescription>
        </DialogHeader>

        {/* 失败态(fail-closed):内容尚未发送,只能关闭 */}
        {errorMessage && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            <Warning size={16} className="mt-0.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* 初次识别中 */}
        {loading && !data && !errorMessage && (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
            <SpinnerGap size={18} className="animate-spin" />
            {t('deid.processing')}
          </div>
        )}

        {data && !errorMessage && (
          <div className="space-y-3 text-sm">
            {/* 重跑中的轻量提示 */}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <SpinnerGap size={14} className="animate-spin" />
                {t('deid.processing')}
              </div>
            )}

            {/* LLM 层降级(契约 §11:保留规则/NER 结果,允许继续) */}
            {data.llmError && (
              <div className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs">
                <Warning size={14} className="mt-0.5 shrink-0 text-status-warning" />
                <span>{t('deid.degraded')}</span>
              </div>
            )}

            {/* 规范化说明(仅 edits 非空时) */}
            {normalizationEdits.length > 0 && (
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {t('deid.normalizationNote')}
                {normalizationEdits.slice(0, 5).map((e, i) => (
                  <span key={i} className="ml-1 font-mono">
                    {e.from}→{e.to}
                  </span>
                ))}
              </div>
            )}

            {/* 附件不参与脱敏提示(D6) */}
            {hasFiles && (
              <div className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs">
                <Warning size={14} className="mt-0.5 shrink-0 text-status-warning" />
                <span>{t('deid.filesNotice')}</span>
              </div>
            )}

            {/* 最终外发内容预览(与 buildOutbound 同源) */}
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">{t('deid.previewLabel')}</div>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/30 px-3 py-2 leading-relaxed">
                {segments.map((seg, i) =>
                  seg.kind === 'text' ? (
                    <span key={i}>{seg.text}</span>
                  ) : (
                    <span
                      key={i}
                      className={cn(
                        'mx-0.5 rounded px-1 font-mono text-xs',
                        seg.kind === 'placeholder'
                          ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                          : 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
                      )}
                    >
                      {seg.text}
                    </span>
                  ),
                )}
              </div>
            </div>

            {/* 实体确认表 */}
            {data.entities && data.entities.length > 0 ? (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">{t('deid.entities')}</div>
                <div className="max-h-44 overflow-y-auto rounded-md border border-border/60 divide-y divide-border/40">
                  {data.entities.map((e) => {
                    const cancellable = e.action === 'anonymized';
                    const checked = cancellable && !excluded.has(e.id);
                    return (
                      <label
                        key={e.id}
                        className={cn(
                          'flex items-center gap-2 px-3 py-1.5 text-xs',
                          cancellable ? 'cursor-pointer hover:bg-muted/40' : 'opacity-70',
                        )}
                        title={`${e.layer || ''}${e.recognizer ? ` · ${e.recognizer}` : ''}${typeof e.score === 'number' ? ` · ${e.score.toFixed(2)}` : ''}`}
                      >
                        {/* 原生 checkbox:ui/ 下无 Checkbox 组件,且这里要的就是
                            紧凑的行内多选(Switch 语义不符) */}
                        {/* eslint-disable-next-line no-restricted-syntax */}
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={checked}
                          disabled={!cancellable || loading}
                          onChange={() => onToggleEntity(e.id)}
                        />
                        <span className="w-28 shrink-0 truncate font-mono text-[11px] text-muted-foreground">{e.entity_type}</span>
                        <span className="min-w-0 flex-1 truncate" title={e.original}>{e.original}</span>
                        <span className="shrink-0 font-mono text-[11px] text-blue-700 dark:text-blue-300">{e.placeholder || '—'}</span>
                        <span
                          className={cn(
                            'w-16 shrink-0 text-right text-[11px]',
                            cancellable && !checked ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
                          )}
                        >
                          {actionLabel(e)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {t('deid.noEntities')}
              </div>
            )}

            {/* 新增脱敏实体(漏检修正,写入 denyValues 跨轮生效) */}
            <AddEntityRow loading={loading} onAdd={onAddEntity} />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('deid.cancel')}
          </Button>
          {!errorMessage && (
            <Button type="button" onClick={onConfirm} disabled={loading || !data}>
              {keptCount > 0
                ? t('deid.confirmWithKept', { n: keptCount })
                : anonymizedCount === 0
                  ? t('deid.confirmPlain')
                  : t('deid.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
