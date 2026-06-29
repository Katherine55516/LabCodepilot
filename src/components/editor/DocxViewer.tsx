"use client";

import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { SpinnerGap } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * DocxViewer — Phase 2。docx-preview 渲染 Word(.docx），三层强制 XSS 防护。
 *
 * 文档内容渲染在 Electron 渲染进程的同源上下文，能访问 localhost API 读写用户
 * 文件——恶意 .docx 的 XSS 爆炸半径很大。对抗验证（执行计划 §7）定下三层防护，
 * 缺一不可：
 *
 *   ① renderAltChunks:false —— docx-preview 默认会把文档内嵌的 HTML 片段塞进
 *      一个无 sandbox 的 <iframe srcdoc>，同源执行脚本。这是最大爆炸半径来源，
 *      必须显式关闭。
 *   ② DOMPurify.sanitize —— docx-preview 产物含 innerHTML 注入面（renderSymbol 的
 *      elem.char）+ hyperlink href 可为 javascript:。渲染完成后整树清洗。
 *   ③ sandbox iframe —— 渲染结果（含 docx-preview 生成的 <style>）放进 srcdoc 的
 *      sandbox iframe（无 allow-scripts / 无 allow-same-origin），纵深防御：即便
 *      前两层漏网，脚本也无法执行、无法触达同源 API。
 *
 * 流程：offscreen 容器跑 renderAsync（docx-preview 需要真实 DOM 做度量）→ 取 HTML
 * → DOMPurify 清洗正文 → 组装完整 HTML 注入 sandbox iframe。图片用 base64 内联
 * （useBase64URL），因为 sandbox 无 allow-same-origin 时 blob: URL 不可达。
 *
 * 经 next/dynamic(ssr:false) 懒加载，DOMPurify/docx-preview/jszip 落在独立 chunk。
 */
export function DocxViewer({ fileServeUrl }: { fileServeUrl: string }) {
  const { t } = useTranslation();
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 跟踪 offscreen 节点，effect 清理时确保移除（即便渲染中途切换文件）。
  const offscreenRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrcDoc(null);
    setError(null);

    const cleanupOffscreen = () => {
      if (offscreenRef.current) {
        offscreenRef.current.remove();
        offscreenRef.current = null;
      }
    };

    (async () => {
      try {
        const res = await fetch(fileServeUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;

        // offscreen：docx-preview 直接操作 DOM 并依赖布局度量，所以必须挂到
        // 文档树，但移出视口、不可见，渲染完立即移除。
        const offscreen = document.createElement("div");
        offscreen.style.cssText =
          "position:fixed;left:-99999px;top:0;width:816px;visibility:hidden;pointer-events:none;";
        document.body.appendChild(offscreen);
        offscreenRef.current = offscreen;

        const styleDiv = document.createElement("div");

        await renderAsync(new Uint8Array(buf), offscreen, styleDiv, {
          inWrapper: true,
          breakPages: true,
          renderAltChunks: false, // 第一层防护
          renderComments: false,
          renderChanges: false,
          experimental: false,
          useBase64URL: true, // 图片内联 base64，sandbox iframe 内可显示
        });
        if (cancelled) {
          cleanupOffscreen();
          return;
        }

        // 第二层防护：清洗正文。DOMPurify 默认移除 <script>/on* 事件/
        // javascript: href，保留 class/style 属性与 data:image（图片）。
        const cleanBody = DOMPurify.sanitize(offscreen.innerHTML);
        // docx-preview 写入 styleDiv 的本就是 <style> 元素（它自身生成的 CSS，
        // 非用户注入），直接放进 head。
        const styleHtml = styleDiv.innerHTML;
        cleanupOffscreen();

        // 第三层防护：sandbox iframe（sandbox="" → 禁脚本/表单/同源）。
        const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">${styleHtml}<style>body{margin:0;background:#f3f4f6;}</style></head><body>${cleanBody}</body></html>`;
        if (!cancelled) setSrcDoc(doc);
      } catch (e) {
        cleanupOffscreen();
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      cleanupOffscreen();
    };
  }, [fileServeUrl]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-destructive">
        {t("docPreview.error")}
      </div>
    );
  }
  if (srcDoc === null) {
    return (
      <div className="flex h-full items-center justify-center py-12">
        <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <iframe
      srcDoc={srcDoc}
      sandbox=""
      className="h-full w-full border-0"
      title="Document preview"
    />
  );
}
