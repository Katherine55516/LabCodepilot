'use client';
import { Microphone, Stop } from '@/components/ui/icon';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { useTranslation } from '@/hooks/useTranslation';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { showToast } from '@/hooks/useToast';
import type { TranslationKey } from '@/i18n';

export function VoiceInputButton({
  getBaseText,
  onUpdate,
}: {
  getBaseText: () => string;
  onUpdate: (full: string) => void;
}) {
  const { t } = useTranslation();
  const { state, supported, start, stop } = useVoiceInput({
    getBaseText,
    onUpdate,
    onErrorMessage: (code) => {
      const key = code === 'mic-permission-denied' ? 'composer.voiceInputDenied' : 'composer.voiceInputError';
      showToast({ type: 'error', message: t(key as TranslationKey) });
    },
  });
  if (!supported) return null; // 非 Electron 环境（如浏览器 dev）不显示

  const active = state === 'listening' || state === 'connecting' || state === 'requesting';
  return (
    <PromptInputButton
      onClick={active ? () => void stop() : () => void start()}
      tooltip={t((active ? 'composer.voiceInputStop' : 'composer.voiceInput') as TranslationKey)}
      className={active ? 'text-destructive animate-pulse' : ''}
    >
      {active ? <Stop size={16} /> : <Microphone size={16} />}
    </PromptInputButton>
  );
}
