'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/useTranslation';
import { localize } from '@/i18n/zh-hk-runtime';

export function CompatibleModels({ providerId }: { providerId: string }) {
  const { locale } = useTranslation();
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function update(discover: boolean) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/providers/${encodeURIComponent(providerId)}/models${discover ? '/discover' : ''}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(discover ? {} : { model_id: model.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setMessage(discover ? localize(locale, `已同步 ${result.discovered} 个模型；保留手动 ID`, `${result.discovered} models synchronized; manual IDs kept`) : localize(locale, '模型已添加', 'Model added'));
      if (!discover) setModel('');
      window.dispatchEvent(new Event('provider-changed'));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed'); }
    finally { setBusy(false); }
  }
  return <section className="mt-3 space-y-2 rounded-lg border border-border p-3">
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void update(true)}>{localize(locale, '同步 API 模型列表', 'Sync API models')}</Button>
    <div className="flex gap-2"><Input aria-label={localize(locale, '添加模型 ID', 'Add model ID')} value={model} onChange={event => setModel(event.target.value)} placeholder={localize(locale, '输入平台支持的模型 ID', 'Endpoint-supported model ID')} maxLength={120}/><Button type="button" variant="outline" disabled={busy || !model.trim()} onClick={() => void update(false)}>{localize(locale, '添加', 'Add')}</Button></div>
    <p className="text-xs text-muted-foreground">{localize(locale, '使用已保存的密钥；仅同步和添加模型，不自动更改默认模型。', 'Uses the saved key; syncing does not change the default model.')}</p>
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
