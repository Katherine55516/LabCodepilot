/** Small, deterministic PNG diagrams for copied decorative template pictures.
 * No model chooses coordinates. The source slide, shape, fonts and text slots
 * remain native; this bitmap occupies only a copied picture's existing frame. */
import { deflateSync } from 'node:zlib';

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const name = Buffer.from(type, 'ascii');
  const size = Buffer.alloc(4); size.writeUInt32BE(body.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(Buffer.concat([name, body])));
  return Buffer.concat([size, name, body, checksum]);
}
function color(value, fallback) {
  return /^#[0-9a-f]{6}$/iu.test(value || '') ? [1, 3, 5].map(start => parseInt(value.slice(start, start + 2), 16)) : fallback;
}
function mix(a, b, ratio) { return a.map((value, i) => Math.round(value * (1 - ratio) + b[i] * ratio)); }
function renderDiagram(kind, palette, values, aspect) {
  const portrait = aspect < .85;
  const W = portrait ? 600 : 960, H = portrait ? 900 : 540;
  const bg = color(palette?.background, [28, 28, 28]);
  const accent = color(palette?.accent, [147, 115, 49]);
  const fg = color(palette?.foreground, [245, 246, 252]);
  const pixels = Buffer.alloc(W * H * 4);
  function rect(x, y, width, height, fill) {
    const startX = Math.max(0, Math.floor(x)), endX = Math.min(W, Math.ceil(x + width));
    const startY = Math.max(0, Math.floor(y)), endY = Math.min(H, Math.ceil(y + height));
    for (let row = startY; row < endY; row++) for (let col = startX; col < endX; col++) {
      const offset = (row * W + col) * 4;
      pixels[offset] = fill[0]; pixels[offset + 1] = fill[1]; pixels[offset + 2] = fill[2]; pixels[offset + 3] = 255;
    }
  }
  function line(x1, y1, x2, y2, fill, thickness = 5) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let step = 0; step <= steps; step++) {
      const t = step / Math.max(1, steps);
      rect(x1 + (x2 - x1) * t - thickness / 2, y1 + (y2 - y1) * t - thickness / 2, thickness, thickness, fill);
    }
  }
  rect(0, 0, W, H, bg);
  rect(28, 28, W - 56, H - 56, mix(bg, accent, .18));
  rect(32, 32, W - 64, H - 64, mix(bg, fg, .035));
  if (portrait && kind === 'metric') {
    const max = Math.max(...values);
    values.slice(0, 3).forEach((value, index) => {
      const y = 184 + index * 210;
      rect(74, y, 452, 105, mix(bg, fg, .12));
      rect(74, y, Math.max(18, 452 * value / max), 105, mix(accent, fg, index * .15));
      rect(64, y, 7, 105, fg);
    });
  } else if (portrait && kind === 'comparison') {
    for (const [index, y] of [100, 480].entries()) {
      rect(75, y, 450, 310, mix(bg, accent, index ? .3 : .5));
      rect(110, y + 35, 380, 18, fg);
      for (let row = 0; row < 3; row++) rect(110, y + 105 + row * 62, 310 - row * 30, 19, mix(fg, bg, .42));
    }
  } else if (portrait && kind === 'architecture') {
    for (let index = 0; index < 4; index++) {
      const inset = 92 + index * 20, y = 102 + index * 184;
      rect(inset, y, W - inset * 2, 112, mix(accent, fg, index * .16));
      if (index < 3) line(W / 2, y + 118, W / 2, y + 174, fg);
    }
  } else if (portrait) {
    const centers = [200, 450, 700];
    centers.forEach((y, index) => {
      rect(102, y - 84, 396, 168, mix(accent, fg, index * .17));
      rect(148, y - 45, 260, 19, fg);
      rect(148, y + 2, 190, 15, mix(fg, bg, .4));
      rect(148, y + 37, 230, 15, mix(fg, bg, .4));
      if (index < 2) {
        line(W / 2, y + 91, W / 2, centers[index + 1] - 112, fg, 7);
        line(W / 2 - 18, centers[index + 1] - 130, W / 2, centers[index + 1] - 112, fg, 7);
        line(W / 2 + 18, centers[index + 1] - 130, W / 2, centers[index + 1] - 112, fg, 7);
      }
    });
  } else if (kind === 'metric') {
    const max = Math.max(...values);
    values.slice(0, 3).forEach((value, index) => {
      const y = 128 + index * 124;
      rect(114, y, 710, 64, mix(bg, fg, .12));
      rect(114, y, Math.max(18, 710 * value / max), 64, mix(accent, fg, index * .15));
      rect(89, y, 10, 64, fg);
    });
  } else if (kind === 'comparison') {
    for (const [index, x] of [94, 494].entries()) {
      rect(x, 112, 370, 318, mix(bg, accent, index ? .3 : .5));
      rect(x + 22, 139, 326, 14, fg);
      for (let row = 0; row < 3; row++) rect(x + 22, 192 + row * 71, 250 - row * 22, 20, mix(fg, bg, .42));
    }
    rect(476, 122, 8, 306, fg);
  } else if (kind === 'architecture') {
    for (let index = 0; index < 4; index++) {
      const inset = 114 + index * 37, y = 94 + index * 91;
      rect(inset, y, W - inset * 2, 63, mix(accent, fg, index * .16));
      if (index < 3) line(W / 2, y + 65, W / 2, y + 86, fg);
    }
  } else {
    const centers = [171, 480, 789];
    centers.forEach((x, index) => {
      rect(x - 110, 191, 220, 158, mix(accent, fg, index * .17));
      rect(x - 78, 226, 156, 17, fg);
      rect(x - 78, 269, 110, 13, mix(fg, bg, .4));
      rect(x - 78, 299, 128, 13, mix(fg, bg, .4));
      if (index < 2) {
        line(x + 114, 270, centers[index + 1] - 127, 270, fg, 7);
        line(centers[index + 1] - 143, 256, centers[index + 1] - 127, 270, fg, 7);
        line(centers[index + 1] - 143, 284, centers[index + 1] - 127, 270, fg, 7);
      }
    });
  }
  const rows = Buffer.alloc(H * (W * 4 + 1));
  for (let row = 0; row < H; row++) pixels.copy(rows, row * (W * 4 + 1) + 1, row * W * 4, (row + 1) * W * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

export function semanticMediaForSlide(project, index, frame) {
  const slide = project.outline?.[index] || {};
  const visual = slide.visualIntent?.type || slide.visual_intent?.type || '';
  const kind = ['metric', 'chart', 'table'].includes(visual) ? 'metric'
    : ['comparison', 'contrast'].includes(visual) ? 'comparison'
      : ['architecture', 'layers'].includes(visual) ? 'architecture'
        : ['pipeline', 'process', 'timeline', 'mechanism'].includes(visual) ? 'process' : null;
  if (!kind) return null;
  const contract = project.planning?.slidePlan?.[index] || {};
  const atoms = (project.source?.semantic?.evidenceAtoms || []).filter(atom => (contract.requiredEvidenceIds || []).includes(atom.id));
  const measures = atoms.flatMap(atom => atom.measurements || []);
  const groups = new Map();
  for (const measure of measures) {
    const value = Number(measure.value);
    if (Number.isFinite(value) && value > 0) groups.set(measure.unit, [...(groups.get(measure.unit) || []), value]);
  }
  const values = [...groups.values()].find(group => group.length >= 2);
  if (kind === 'metric' && !values) return null; // A lone number must not become a made-up chart.
  const dataUrl = renderDiagram(kind, project.templateSpec?.palette, values || [], frame.geometry.width / frame.geometry.height);
  return { id: `semantic-${kind}-${index + 1}`, dataUrl, kind, evidenceIds: atoms.map(atom => atom.id) };
}
