"use client";
import dynamic from 'next/dynamic';
import {useEffect,useSyncExternalStore,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {TooltipProvider} from '@/components/ui/tooltip';
import {Toaster} from '@/components/ui/toast';
import {PptBackgroundTasks} from '@/components/ppt/workspace/PptBackgroundTasks';
import {useGlobalSearchShortcut} from '@/hooks/useGlobalSearchShortcut';
import {LAST_NON_SETTINGS_PATH_KEY} from '@/lib/settings-route';
const ApplicationShell=dynamic(()=>import('./AppShell').then(module=>module.AppShell),{ssr:false});
const subscribeHost=()=>()=>{};
const desktopHost=()=>Boolean(window.electronAPI);
function StandalonePptShell({children}:{children:ReactNode}){
 useGlobalSearchShortcut(()=>{});
 useEffect(()=>{try{sessionStorage.setItem(LAST_NON_SETTINGS_PATH_KEY,window.location.pathname+window.location.search);}catch{}},[]);
 return <TooltipProvider delayDuration={300}><PptBackgroundTasks/><div data-testid="ppt-standalone-shell" className="flex h-screen min-h-0 flex-col overflow-hidden"><main className="relative min-h-0 flex-1 overflow-hidden">{children}</main></div><Toaster/></TooltipProvider>;
}
export function RouteShell({children}:{children:ReactNode}){
 const pathname=usePathname(),desktop=useSyncExternalStore(subscribeHost,desktopHost,()=>false);
 return pathname==='/ppt'&&!desktop?<StandalonePptShell>{children}</StandalonePptShell>:<ApplicationShell>{children}</ApplicationShell>;
}
