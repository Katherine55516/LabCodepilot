"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { SpinnerGap } from "@/components/ui/icon";
import { openSettings } from "@/components/settings/SettingsDialog";
import { readLastNonSettingsPath } from "@/lib/settings-route";

/**
 * /settings 兼容层。
 *
 * 设置本身已经是浮在应用之上的全局弹窗(components/settings/SettingsDialog.tsx),
 * 这个路由不再渲染设置内容,只负责接住既有的深链 —— `router.push('/settings#cli')`、
 * `<Link href="/settings#providers">`、错误提示里生成的 markdown 链接等十几处入口
 * 全都还指向这里。进来后:把 hash 当作要打开的分类 → 打开弹窗 → 地址栏换回用户
 * 原本待着的页面。用户看到的效果就是「原地弹出设置」,不会丢掉当前会话。
 */
export default function SettingsPage() {
  const router = useRouter();
  // React 18 StrictMode 下 effect 会跑两次,用 ref 保证只转发一次
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const section = window.location.hash.replace("#", "");
    router.replace(readLastNonSettingsPath());
    // 等 replace 落地后再开弹窗,避免路由切换把刚挂上的 overlay 顶掉
    queueMicrotask(() => openSettings(section));
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center">
      <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
    </div>
  );
}
