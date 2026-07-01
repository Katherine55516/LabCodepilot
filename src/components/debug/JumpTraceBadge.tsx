"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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
    const origReplace = history.replaceState;
    const origPush = history.pushState;
    // 记录所有程序式导航（pushState=router.push / replaceState=router.replace），带调用栈。
    // 这次不再只过滤 /chat —— 工作台"消失"也可能是 pathname 变成非 /chat 让 isChatRoute=false，
    // 需要看到跳去了哪。栈能指出是哪个文件/函数触发的导航。
    const record = (method: string, url: unknown) => {
      try {
        const stack = (new Error().stack || "").split("\n").slice(3, 9).map((s) => s.trim()).join("  |  ");
        const arr = readJumps();
        arr.unshift({ src: `history.${method}`, to: String(url ?? ""), extra: stack, t: new Date().toLocaleTimeString() });
        sessionStorage.setItem("jumpTrace", JSON.stringify(arr.slice(0, 20)));
        setJumps(arr.slice(0, 20));
      } catch {}
    };
    history.replaceState = function (this: History, d: unknown, un: string, url?: string | URL | null) {
      record("replaceState", url);
      return origReplace.call(this, d, un, url);
    } as typeof history.replaceState;
    history.pushState = function (this: History, d: unknown, un: string, url?: string | URL | null) {
      record("pushState", url);
      return origPush.call(this, d, un, url);
    } as typeof history.pushState;
    const iv = setInterval(() => setJumps(readJumps()), 800);
    return () => {
      history.replaceState = origReplace;
      history.pushState = origPush;
      clearInterval(iv);
    };
  }, []);

  if (!jumps.length) return null;
  return createPortal(
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
    </div>,
    document.body,
  );
}
