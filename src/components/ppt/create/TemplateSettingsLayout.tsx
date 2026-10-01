'use client';
import type { ReactNode } from 'react';

export function TemplateSettingsLayout({ main, sidebar, outline }: { main: ReactNode; sidebar: ReactNode; outline?: ReactNode }) {
  return <div className="space-y-5" data-testid="ppt-template-settings">
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]"><div className="min-w-0">{main}</div><aside className="min-w-0 space-y-4">{sidebar}</aside></div>
    {outline}
  </div>;
}
