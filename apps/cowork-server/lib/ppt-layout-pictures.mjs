/** Pictures a slide layout or master paints behind every slide that uses it
 * (Fable G1, 2026-11-02; Copy-of-Professional-Portfolio: the cover's city
 * photo is three full-bleed pictures on slideLayout2, so the editor showed a
 * black cover and the media ledger never saw the hero).
 *
 * A layout stacks full-bleed (≥25%) pictures and colour layers, its master's
 * below its own. The visible one is found from the top: an opaque colour layer
 * (Mood-Board's beige over its dark texture) means no picture shows and none
 * is promoted; an opaque picture is promoted with the translucent colour
 * layers above it (Portfolio's 10% navy tint over the cover photo) when it is
 * certified (no text, continuous tone), no translucent picture lies above it
 * and the tints together stay under 75%. It becomes nodes of each slide using
 * that layout, the export removes them from the layout and draws them behind
 * every other object, so nothing is drawn twice and deleting it removes it.
 * Uploaded templates only. (3222 live, 2026-11-02: the first rule took the
 * topmost picture and promoted Mood-Board's hidden dark texture to the front
 * of every page.) */
import zlib from 'node:zlib';
import { pictureCertificate } from './ppt-template-picture-read.mjs';
import { stableId } from './ppt/ir.mjs';

export const LAYOUT_PICTURE_SHARE = .25;
const LAYOUT_PICTURE_Z = -1000, OPAQUE = .99, TINT_LIMIT = .75;

/** Whether an image's encoded bytes may carry transparency (PNG with alpha,
 * GIF, WebP); a JPEG never does. */
function mayBeTranslucent(dataUrl) {
  const match = /^data:image\/([a-z]+);base64,(.*)$/isu.exec(String(dataUrl || ''));
  if (!match) return true;
  const kind = match[1].toLowerCase();
  if (kind === 'jpeg' || kind === 'jpg') return false;
  if (kind !== 'png') return true;
  const head = Buffer.from(match[2].slice(0, 44), 'base64');
  // IHDR colour type at byte 25: 4 grey+alpha, 6 RGBA; 3 palette may carry tRNS.
  return [3, 4, 6].includes(head[25]);
}

/** A translucent colour layer as a small RGBA PNG (the export stretches it). */
function tintPng(colour, opacity) {
  const hex = /^#[0-9a-f]{6}$/iu.test(colour) ? colour : '#000000', [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)), a = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
  const w = 16, h = 9, raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(w, 0); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

/** The promoted picture of each layout, keyed "master:layout"; each carries
 * the tint layers drawn above it, back to front. */
export function layoutPictureCatalog(externalPptx = {}) {
  const slideArea = (Number(externalPptx.width) || 12192000) * (Number(externalPptx.height) || 6858000);
  const full = (externalPptx.inherited || []).filter(item => (item.kind === 'image' && item.dataUrl || item.kind === 'fill') && item.width * item.height >= slideArea * LAYOUT_PICTURE_SHARE);
  const layouts = new Set(full.filter(item => item.scope === 'layout').map(item => `${item.masterIndex}:${item.layoutIndex}`));
  for (const item of full.filter(item => item.scope === 'master')) layouts.add(`${item.masterIndex}:*`);
  const byZ = (a, b) => (Number(a.z) || 0) - (Number(b.z) || 0);
  const catalog = {};
  for (const key of layouts) {
    const [master, layout] = key.split(':');
    // Back to front: the master's layers, then the layout's, each in shape order.
    const stack = [...full.filter(item => item.scope === 'master' && String(item.masterIndex) === master).sort(byZ),
      ...full.filter(item => item.scope === 'layout' && String(item.masterIndex) === master && String(item.layoutIndex) === layout).sort(byZ)];
    const opaque = item => item.kind === 'fill' ? Number(item.opacity ?? 1) >= OPAQUE : !mayBeTranslucent(item.dataUrl);
    const top = stack.findLastIndex(opaque);
    if (top < 0 || stack[top].kind !== 'image') continue;
    const above = stack.slice(top + 1);
    // A translucent picture or gradient above cannot be drawn as one flat tint.
    if (above.some(item => item.kind === 'image' || item.fillType && item.fillType !== 'solid')) continue;
    const tints = above.map(item => ({ key: item.key, scope: item.scope, masterIndex: item.masterIndex, layoutIndex: item.layoutIndex, shapeId: item.shapeId, fill: item.fill, opacity: Number(item.opacity ?? 1),
      geometry: { x: item.x, y: item.y, width: item.width, height: item.height } }));
    if (1 - tints.reduce((clear, tint) => clear * (1 - tint.opacity), 1) >= TINT_LIMIT) continue;
    const picture = stack[top], certificate = pictureCertificate(picture);
    if (!certificate) continue;
    catalog[key] = { key: picture.key, scope: picture.scope, masterIndex: picture.masterIndex, layoutIndex: picture.layoutIndex, shapeId: picture.shapeId,
      geometry: { x: picture.x, y: picture.y, width: picture.width, height: picture.height }, dataUrl: picture.dataUrl, imageSha256: picture.imageSha256, certificate,
      tints: tints.map(tint => ({ ...tint, dataUrl: tintPng(tint.fill, tint.opacity) })) };
  }
  return catalog;
}

/** The promoted picture for a template slide's layout, if any. */
export function layoutPictureFor(catalog = {}, nativeLayout) {
  if (!nativeLayout) return null;
  return catalog[`${nativeLayout.masterIndex}:${nativeLayout.layoutIndex}`] || catalog[`${nativeLayout.masterIndex}:*`] || null;
}

/** Remove actions for the promoted pictures and their tints (the export draws their nodes). */
export function layoutPictureActions(catalog = {}) {
  return Object.values(catalog).flatMap(picture => [picture, ...(picture.tints || [])]).map(layer => ({ scope: layer.scope, masterIndex: layer.masterIndex, layoutIndex: layer.layoutIndex, shapeId: layer.shapeId, key: layer.key, action: 'remove', promoted: true }));
}
/** Every promoted layer's image by key (the export sends each once). */
export function layoutPictureImages(pictures = {}) {
  return Object.fromEntries(Object.values(pictures).flatMap(picture => [[picture.key, picture.dataUrl], ...(picture.tints || []).map(tint => [tint.key, tint.dataUrl])]));
}

/** A layout picture node: behind everything, pinned (never moved or resized,
 * deletable), template decoration. */
export const isLayoutPicture = node => node?.content?.derivedFrom === 'layout-picture';

/** Add the slide's layout picture and its tints once; a deleted picture stays deleted. */
export function applyLayoutPicture(project, slide, index) {
  const fidelity = project.templateFidelity;
  if (fidelity?.mode !== 'preserve' || !slide) return false;
  // A picture promoted before the stack was read (no tints list) is unverified
  // and never drawn (3222, 2026-11-02: Mood-Board's covered texture).
  const key = fidelity.slides?.[index]?.layoutPicture, stored = key && fidelity.layoutPictures?.[key], picture = Array.isArray(stored?.tints) ? stored : null;
  slide.nodes ||= [];
  // Layers of another (or no longer promoted) picture go.
  slide.nodes = slide.nodes.filter(node => !isLayoutPicture(node) || picture && (node.content.layoutStackKey || node.content.layoutPictureKey) === key);
  if (!picture || slide.layoutPictureDeleted === key || slide.nodes.some(node => isLayoutPicture(node) && node.content.layoutPictureKey === key)) return false;
  const layer = (item, k, content) => ({ id: stableId('node', slide.id, 'layout-picture', item.key), type: 'image', semanticRole: 'visual', slotId: 'absolute', pinned: true,
    geometry: { ...item.geometry }, zIndex: LAYOUT_PICTURE_Z + k, content: { fit: 'cover', decorative: true, derivedFrom: 'layout-picture', layoutPictureKey: item.key, layoutStackKey: key, ...content } });
  slide.nodes = slide.nodes.filter(node => !isLayoutPicture(node));
  slide.nodes.unshift(layer(picture, 0, { dataUrl: picture.dataUrl, imageSha256: picture.imageSha256, mediaRole: 'template_decoration', pictureCertificate: picture.certificate }),
    ...(picture.tints || []).map((tint, k) => layer(tint, k + 1, { dataUrl: tint.dataUrl, layoutTint: { fill: tint.fill, opacity: tint.opacity } })));
  return true;
}
