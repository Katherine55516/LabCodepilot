'use client';

/**
 * 图片脱敏 — 客户端 canvas 重绘(契约 §7.2)。
 *
 * 铁律:**每次都从原图重绘全部保留区域**,绝不在已打码的图片上"擦除"遮罩
 * (契约 §7.2 末句)。因此本模块始终持有原图 base64,取消/恢复某个区域只是
 * 改变绘制列表,不做任何逆向像素操作。
 *
 * 外发的图 = 本模块的产出,而不是服务端返回的 redactedImageBase64 ——
 * 否则用户在预览里取消某个区域后,真正发出去的仍是全打码版本,
 * 预览与外发就对不上了。
 */

import { visibleBoxes } from '@/lib/deid-utils';
import type { DeidEntity } from '@/types/deid';

/** placeholder 模式的浅色遮罩(与服务端渲染风格一致:浅底 + 深色占位符文字) */
const PLACEHOLDER_FILL = '#dbe3ef';
const PLACEHOLDER_TEXT = '#1e3a5f';
/** fill 模式的纯色遮罩 */
const SOLID_FILL = '#000000';

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
}

/** 在给定宽度内把占位符文字缩到能放下的字号(下限 9px,过窄则不绘制文字) */
function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
): number {
  let size = Math.min(Math.floor(maxHeight * 0.7), 28);
  while (size >= 9) {
    ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    if (ctx.measureText(text).width <= maxWidth * 0.94) return size;
    size -= 1;
  }
  return 0;
}

/**
 * 从原图重绘打码图。
 *
 * @param originalBase64 裸 base64(不含 data: 前缀)
 * @param mimeType 原图 MIME(仅用于解码;输出统一 PNG —— 遮罩块在 JPEG 下
 *                 会因有损压缩产生振铃边缘,PNG 无此问题且无损)
 * @param excluded 该图中被用户取消脱敏的实体 id(这些区域保持原图像素)
 * @returns 裸 base64(image/png)
 */
export async function redrawRedactedImage(
  originalBase64: string,
  mimeType: string,
  entities: DeidEntity[],
  excluded: Set<number>,
  mode: 'placeholder' | 'fill',
): Promise<string> {
  const img = await loadImage(`data:${mimeType || 'image/png'};base64,${originalBase64}`);

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  // 1. 原图打底 —— 每次重绘都从这里开始,不做增量
  ctx.drawImage(img, 0, 0);

  // 2. 逐个绘制仍需遮盖的区域
  for (const e of visibleBoxes(entities, excluded)) {
    const { left, top, width, height } = e.box!;
    if (mode === 'fill') {
      ctx.fillStyle = SOLID_FILL;
      ctx.fillRect(left, top, width, height);
      continue;
    }
    ctx.fillStyle = PLACEHOLDER_FILL;
    ctx.fillRect(left, top, width, height);
    const label = e.placeholder || '';
    if (!label) continue;
    const size = fitFontSize(ctx, label, width, height);
    if (size === 0) continue; // 区域太窄,只保留纯色遮罩(宁可少字不可溢出)
    ctx.fillStyle = PLACEHOLDER_TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, left + width / 2, top + height / 2, width * 0.94);
  }

  return canvas.toDataURL('image/png').split(',')[1] || '';
}
