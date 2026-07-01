"use client";

/**
 * BtwDialog — ephemeral "by the way" side-question popup.
 *
 * Shows a single question + answer over the current conversation. It never
 * writes to the transcript: when closed it simply unmounts and the Q&A is gone.
 * The answer is fetched by the parent (ChatView) from /api/chat/btw, which runs
 * concurrently with the main stream and takes no session lock — so opening this
 * popup never interrupts the ongoing conversation.
 *
 * MVP renders the answer as plain text (whitespace-pre-wrap). Rich Markdown
 * rendering is a later enhancement.
 */
import { useTranslation } from '@/hooks/useTranslation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface BtwDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: string;
  answer: string;
  loading: boolean;
  error?: string | null;
}

export function BtwDialog({ open, onOpenChange, question, answer, loading, error }: BtwDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">/btw</span>
            {t('btw.title')}
          </DialogTitle>
        </DialogHeader>

        {question.trim() && (
          <div className="whitespace-pre-wrap break-words text-sm font-medium text-foreground">
            {question}
          </div>
        )}

        <div className="min-h-[2.5rem] text-sm">
          {loading && (
            <span className="text-muted-foreground">{t('btw.thinking')}</span>
          )}
          {!loading && error && (
            <span className="text-destructive">{error}</span>
          )}
          {!loading && !error && answer && (
            <div className="whitespace-pre-wrap break-words leading-relaxed text-foreground">
              {answer}
            </div>
          )}
          {!loading && !error && !answer && !question.trim() && (
            <span className="text-muted-foreground">{t('btw.emptyHint')}</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
