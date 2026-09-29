'use client';

import type { PptModel, PptTemplate } from '../types';

const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';
const primary = 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50';

export type PptLlmGateContext = 'new' | 'template' | 'update';

function copy(context: PptLlmGateContext, template?: PptTemplate | null) {
  if (context === 'update') return {
    heading: '版本更新解析模型',
    description: '选择用于解析上一版与最新进展的模型。',
  };
  if (context === 'template') return {
    heading: '模板生成解析模型',
    description: `模板「${template?.name || '已选模板'}」已确认；继续选择用于解析后续输入的模型。`,
  };
  return {
    heading: 'PPT 创建解析模型',
    description: '选择用于解析 Prompt、文本或文件的模型。',
  };
}

export function PptLlmGate({ context, models, modelKey, template, onModelKeyChange, onClose, onConfirm }: {
  context: PptLlmGateContext;
  models: PptModel[];
  modelKey: string;
  template?: PptTemplate | null;
  onModelKeyChange: (key: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const content = copy(context, template);
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4" role="presentation">
    <section className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="ppt-llm-gate-title">
      <header className="flex items-start justify-between border-b border-border p-5">
        <div><h2 id="ppt-llm-gate-title" className="text-lg font-semibold">先选择 LLM</h2><p className="mt-1 text-sm text-muted-foreground">{content.description}</p></div>
        <button className="grid h-8 w-8 place-items-center rounded-lg border border-border" aria-label="关闭" onClick={onClose}>×</button>
      </header>
      <div className="space-y-4 p-5">
        {template && <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"><strong>模板 · {template.name}</strong><p className="mt-1 text-xs text-muted-foreground">{template.category} · {template.pages} 页 · 模板保持锁定，后续不需要再次选择。</p></div>}
        <section className="rounded-xl border border-border bg-card p-4"><h3 className="font-medium">{content.heading} <span className="text-destructive">*</span></h3><p className="mt-1 text-sm text-muted-foreground">模型会在后续流程中持续沿用，不需要重复选择。</p>
          <label className="mt-4 block space-y-1 text-sm"><span>LLM（必填）</span><select className={field} aria-label="LLM（必填）" value={modelKey} onChange={event => onModelKeyChange(event.target.value)}><option value="">请选择 LLM</option>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
          {!models.length && <p className="mt-3 text-xs text-destructive">当前没有可用于 Cowork 的 LLM。请先在 Agent 设置中配置托管模型。</p>}
        </section>
      </div>
      <footer className="flex justify-end gap-2 border-t border-border p-4"><button className={button} onClick={onClose}>取消</button><button className={primary} disabled={!modelKey} onClick={onConfirm}>确认并继续 →</button></footer>
    </section>
  </div>;
}
