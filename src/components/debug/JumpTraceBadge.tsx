"use client";
import { useEffect, useState } from "react";

type Jump = { src: string; from?: string; to: string; extra?: string; t: string };

const readJumps = (): Jump[] => {
  try {
    return JSON.parse(sessionStorage.getItem("jumpTrace") || "[]");
  } catch {
    return [];
  }
};

/**
 * 跳转诊断浮层（临时排障用）。
 *
 * 目的：在【无法开 F12】的 Windows 打包版里，把「点报告过几秒自动跳回对话」的真凶暴露到
 * 界面上。两个来源叠加记录到 sessionStorage['jumpTrace']：
 *   ① 本组件 patch history.replaceState —— 捕获所有【程序式】导航到 /chat/{id}
 *      （router.replace 底层走 replaceState；用户点 Link 是 pushState，不记，避免噪音）
 *      连同精简调用栈，能看出是哪个文件/effect 触发的。
 *   ② AppShell 的 URL-sync effect 在 replace 前主动写一条（src=AppShell.URLSync）并附带
 *      当时的 isSplitActive/activeColumnId/testPanelOpen/onSplitMemberPage 状态。
 * 用户截图右下角浮层即可定位。排障结束后应移除本组件与 AppShell 内的记录代码。
 */
export function JumpTraceBadge() {
  const [jumps, setJumps] = useState<Jump[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setJumps(readJumps());
    const orig = history.replaceState;
    history.replaceState = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
      const u = String(url ?? "");
      if (/\/chat\/[^/]/.test(u)) {
        try {
          const stack = (new Error().stack || "")
            .split("\n")
            .slice(2, 8)
            .map((s) => s.trim())
            .join("  |  ");
          const arr = readJumps();
          arr.unshift({ src: "history.replaceState", to: u, extra: stack, t: new Date().toLocaleTimeString() });
          sessionStorage.setItem("jumpTrace", JSON.stringify(arr.slice(0, 15)));
          setJumps(arr.slice(0, 15));
        } catch {}
      }
      return orig.call(this, data, unused, url);
    } as typeof history.replaceState;
    const iv = setInterval(() => setJumps(readJumps()), 800);
    return () => {
      history.replaceState = orig;
      clearInterval(iv);
    };
  }, []);

  if (!jumps.length) return null;
  return (
    <div className="fixed bottom-2 right-2 z-[999] max-w-[92vw] font-mono text-[10px] leading-tight">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded bg-red-600 px-2 py-1 font-semibold text-white shadow-lg"
      >
        ⚠️ 跳转诊断 {jumps.length} 条 {open ? "▲ 收起" : "▼ 展开"}
      </button>
      {open && (
        <div className="mt-1 max-h-[55vh] w-[520px] max-w-[92vw] overflow-auto rounded bg-black/90 p-2 text-white ring-1 ring-white/30">
          <button
            onClick={() => {
              try {
                sessionStorage.removeItem("jumpTrace");
              } catch {}
              setJumps([]);
            }}
            className="mb-1.5 rounded bg-white/20 px-1.5 py-0.5"
          >
            清空
          </button>
          {jumps.map((j, i) => (
            <div key={i} className="mb-1.5 border-b border-white/20 pb-1.5">
              <div>
                [{j.t}] <b className="text-yellow-300">{j.src}</b>
              </div>
              {j.from && <div>from: {j.from}</div>}
              <div>to: {j.to}</div>
              {j.extra && <div className="mt-0.5 whitespace-pre-wrap break-all text-white/70">{j.extra}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
