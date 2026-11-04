'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/hooks/useTranslation';

interface LogoutConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called when the user confirms. Typically the useAccount `logout`
   * function — its real return type is `Promise<{ ok: true }>`, but we
   * type the callback loosely so the dialog doesn't need to know.
   */
  onConfirm: () => unknown | Promise<unknown>;
}

/**
 * Reusable "are you sure you want to sign out?" dialog.
 *
 * Both UserMenu (the chip dropdown in ChatListPanel's bottom row) and
 * AccountSection (the Settings → Account section) open this dialog so the
 * two entry points stay phrased identically. Copy lives in i18n under
 * `auth.confirmLogout*`, and the destructive variant is used on the
 * confirm action to reinforce that the click is irreversible.
 */
export function LogoutConfirmDialog({ open, onOpenChange, onConfirm }: LogoutConfirmDialogProps) {
  const { t } = useTranslation();

  const handleConfirm = async () => {
    onOpenChange(false);
    await onConfirm();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('auth.confirmLogout')}</AlertDialogTitle>
          <AlertDialogDescription>{t('auth.confirmLogoutBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm}>
            {t('auth.logout')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
