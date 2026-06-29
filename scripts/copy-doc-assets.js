#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * copy-doc-assets — 把 pdfjs-dist 的浏览器侧静态资产拷进 public/pdf/，
 * 供 PdfViewer 以绝对路径离线加载（workerSrc / cMapUrl / standardFontDataUrl
 * / wasmUrl / iccUrl 全指向 /pdf/...）。
 *
 * 为什么不用打包器的 new URL(..., import.meta.url)：
 *   本项目 next build 走 Turbopack + output:'standalone'。Turbopack 对
 *   worker/wasm asset 的发射不可靠，且 standalone 的 NFT tracing 跟不到
 *   浏览器侧资源（见 next.config.ts 注释）。把这些资产当普通静态文件放
 *   public/、用绝对路径字符串加载，是与 public/asr-worklet.js 同一套已
 *   验证的离线模式。electron-builder.yml 的 `public/ -> standalone/public/`
 *   规则会把 public/pdf/ 随包带走，无需改打包配置。
 *
 * 资产清单（pdfjs 5.x）：
 *   - build/pdf.worker.min.mjs  worker（版本必须 == pdfjs.version，否则运行时
 *                               报 "API version does not match Worker version"。
 *                               这里拷的就是当前 node_modules 的 pdfjs-dist，天然同源）
 *   - cmaps/                    CID 字体映射（中文/日文 PDF 命门，缺则整页空白）
 *   - standard_fonts/           14 个 PDF 标准字体回退
 *   - wasm/                     OpenJPEG/JPEG2000 解码器（含 JPEG2000 图的 PDF 缺则 JpxError）
 *   - iccs/                     ICC color profile（pdfjs 5.x iccUrl，缺则部分 PDF 颜色异常）
 *
 * 幂等：写 public/pdf/.version 戳记；再次运行时若戳记 == pdfjs.version 且
 * worker 已就位则秒退。升级 react-pdf/pdfjs-dist 后版本变化会自动触发重拷。
 * 挂载点：package.json 的 predev / prebuild 钩子 + electron:build / electron:dev 链。
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "public", "pdf");
const STAMP = path.join(OUT_DIR, ".version");

// 资产目录清单。worker 是单文件，单独处理。
const ASSET_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];
// 拷贝后必须存在的关键资产（缺则视为失败）。iccs/standard_fonts 容缺
// （老 pdfjs 版本可能未提供），但 worker + cmaps + wasm 是硬性。
const REQUIRED_AFTER = ["pdf.worker.min.mjs", "cmaps", "wasm"];

function log(msg) {
  console.log(`[copy-doc-assets] ${msg}`);
}

/** 定位 pdfjs-dist 包根 + 版本。优先 require.resolve，兜底到 node_modules。 */
function resolvePdfjs() {
  try {
    const pkgPath = require.resolve("pdfjs-dist/package.json");
    return { root: path.dirname(pkgPath), version: require(pkgPath).version };
  } catch {
    const root = path.join(REPO_ROOT, "node_modules", "pdfjs-dist");
    const pkgPath = path.join(root, "package.json");
    if (!fs.existsSync(pkgPath)) {
      console.error(
        "[copy-doc-assets] FATAL: 找不到 pdfjs-dist。请先安装 react-pdf（带来 pdfjs-dist 传递依赖）。",
      );
      process.exit(1);
    }
    return { root, version: require(pkgPath).version };
  }
}

function isUpToDate(version) {
  if (!fs.existsSync(STAMP)) return false;
  if (!fs.existsSync(path.join(OUT_DIR, "pdf.worker.min.mjs"))) return false;
  try {
    return fs.readFileSync(STAMP, "utf-8").trim() === version;
  } catch {
    return false;
  }
}

function main() {
  const { root: PDFJS_ROOT, version: PDFJS_VERSION } = resolvePdfjs();
  const workerSrc = path.join(PDFJS_ROOT, "build", "pdf.worker.min.mjs");

  if (!fs.existsSync(workerSrc)) {
    console.error(
      `[copy-doc-assets] FATAL: worker 源文件缺失：${workerSrc}\n` +
        "  pdfjs-dist 安装不完整，请重装 react-pdf。",
    );
    process.exit(1);
  }

  if (isUpToDate(PDFJS_VERSION)) {
    log(`public/pdf/ 已是 pdfjs ${PDFJS_VERSION}，跳过。`);
    return;
  }

  // 全量重建，避免旧版本资产残留。
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  fs.copyFileSync(workerSrc, path.join(OUT_DIR, "pdf.worker.min.mjs"));
  log("copied build/pdf.worker.min.mjs");

  for (const dir of ASSET_DIRS) {
    const src = path.join(PDFJS_ROOT, dir);
    if (!fs.existsSync(src)) {
      console.warn(
        `[copy-doc-assets] WARN: 资产目录缺失，跳过：${dir}（pdfjs ${PDFJS_VERSION} 未提供）`,
      );
      continue;
    }
    fs.cpSync(src, path.join(OUT_DIR, dir), { recursive: true });
    const count = fs.readdirSync(path.join(OUT_DIR, dir)).length;
    log(`copied ${dir}/ (${count} entries)`);
  }

  fs.writeFileSync(STAMP, PDFJS_VERSION + "\n", "utf-8");

  // 断言关键资产就位。
  const missing = REQUIRED_AFTER.filter(
    (rel) => !fs.existsSync(path.join(OUT_DIR, rel)),
  );
  if (missing.length > 0) {
    console.error(
      `[copy-doc-assets] FATAL: 拷贝后缺失关键资产：${missing.join(", ")}`,
    );
    process.exit(1);
  }

  log(`DONE. public/pdf/ ready for pdfjs ${PDFJS_VERSION}`);
}

main();
