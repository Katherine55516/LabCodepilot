import { cn } from '@/lib/utils';

interface CodePilotLogoProps {
  className?: string;
}

/**
 * Brand logo shown on the empty "new conversation" state (MessageList).
 *
 * Was a hand-drawn isometric-cube SVG; replaced with the AI Native Lab "A"
 * mark (public/brand/anl-logo.png, 256×256 RGBA). The PNG already carries its
 * own rounded-square shape + gradient, so we render it as-is — no forced
 * rounded-full circle crop. The `className` sizing contract (e.g. h-16 w-16
 * from MessageList) is preserved.
 */
export function CodePilotLogo({ className }: CodePilotLogoProps) {
  return (
    <img
      src="/brand/anl-logo.png"
      alt="AIMate"
      className={cn('object-contain', className)}
    />
  );
}
