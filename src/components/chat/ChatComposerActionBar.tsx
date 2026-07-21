'use client';

import type { ReactNode } from 'react';

interface ChatComposerActionBarProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}

export function ChatComposerActionBar({ left, center, right }: ChatComposerActionBarProps) {
  return (
    // relative: 供子项(如办公模式出品标识)相对整条 bar 绝对居中定位。
    <div className="relative flex items-center justify-between gap-2 px-4 pt-0.5 pb-2.5">
      <div className="flex items-center gap-2">
        {left}
        {center}
      </div>
      <div className="flex items-center gap-2">
        {right}
      </div>
    </div>
  );
}
