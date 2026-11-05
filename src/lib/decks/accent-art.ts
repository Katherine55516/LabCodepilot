import type { DeckTheme } from './types';

/**
 * Original, deterministic accent artwork for the `themeAccent` image source.
 *
 * Gamma's `themeAccent` uses each theme's own accent images (report 04 §1).
 * Decks generates its own: an SVG drawn from the theme palette and a seed (the
 * card id), so the same card always gets the same art, neighbouring cards get
 * different art, and there are no licensing questions. Pure function: the
 * same output on server and client, safe to rasterise for PPTX export.
 */

function rng(seedText: string) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) { h ^= seedText.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

const esc = (value: string) => value.replace(/[^#a-zA-Z0-9(),.% -]/g, '');

export function accentSvg(theme: DeckTheme, seed: string, width = 800, height = 1000): string {
  const r = rng(`${theme.id}:${seed}`);
  const { accent, accent2, surface, background } = theme.colors;
  const W = width, H = height;
  const defs: string[] = [];
  const body: string[] = [];
  const gid = `g${Math.floor(r() * 1e6)}`;
  defs.push(`<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${esc(accent)}"/><stop offset="1" stop-color="${esc(accent2)}"/></linearGradient>`);
  body.push(`<rect width="${W}" height="${H}" fill="${esc(theme.dark ? surface : background)}"/>`);

  switch (theme.accentStyle) {
    case 'aurora': {
      defs.push(`<filter id="b${gid}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${Math.round(W / 9)}"/></filter>`);
      for (let i = 0; i < 4; i++) {
        const cx = r() * W, cy = r() * H, rx = W * (0.35 + r() * 0.4), ry = H * (0.15 + r() * 0.25);
        body.push(`<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="${i % 2 ? esc(accent2) : esc(accent)}" opacity="${(0.55 + r() * 0.35).toFixed(2)}" filter="url(#b${gid})" transform="rotate(${(r() * 60 - 30).toFixed(0)} ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`);
      }
      break;
    }
    case 'orbs': {
      for (let i = 0; i < 7; i++) {
        const radius = W * (0.08 + r() * 0.28);
        body.push(`<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" r="${radius.toFixed(0)}" fill="${i % 3 === 0 ? `url(#${gid})` : i % 3 === 1 ? esc(accent) : esc(accent2)}" opacity="${(0.35 + r() * 0.55).toFixed(2)}"/>`);
      }
      break;
    }
    case 'waves': {
      for (let i = 0; i < 6; i++) {
        const y = H * (0.25 + i * 0.12), amp = H * (0.04 + r() * 0.06), phase = r() * W;
        const pts: string[] = [];
        for (let i = 0; i <= 24; i++) { const x = (W * i) / 24; pts.push(`${x.toFixed(0)},${(y + Math.sin((x + phase) / (W / 5)) * amp).toFixed(1)}`); }
        body.push(`<path d="M0,${H} L${pts.join(' L')} L${W},${H} Z" fill="${i % 2 ? esc(accent2) : esc(accent)}" opacity="${(0.18 + i * 0.1).toFixed(2)}"/>`);
      }
      break;
    }
    case 'grid': {
      const step = W / (8 + Math.floor(r() * 5));
      for (let x = 0; x <= W; x += step) body.push(`<line x1="${x.toFixed(0)}" y1="0" x2="${x.toFixed(0)}" y2="${H}" stroke="${esc(accent)}" stroke-opacity="0.16" stroke-width="2"/>`);
      for (let y = 0; y <= H; y += step) body.push(`<line x1="0" y1="${y.toFixed(0)}" x2="${W}" y2="${y.toFixed(0)}" stroke="${esc(accent)}" stroke-opacity="0.16" stroke-width="2"/>`);
      for (let i = 0; i < 9; i++) {
        const gx = Math.floor(r() * (W / step)) * step, gy = Math.floor(r() * (H / step)) * step;
        body.push(`<rect x="${gx.toFixed(0)}" y="${gy.toFixed(0)}" width="${step.toFixed(0)}" height="${step.toFixed(0)}" fill="${i % 2 ? esc(accent2) : `url(#${gid})`}" opacity="${(0.5 + r() * 0.45).toFixed(2)}"/>`);
      }
      break;
    }
    case 'stripes': {
      const count = 5 + Math.floor(r() * 5);
      for (let i = 0; i < count; i++) {
        const w = W * (0.03 + r() * 0.1), x = r() * W;
        body.push(`<rect x="${x.toFixed(0)}" y="-${H}" width="${w.toFixed(0)}" height="${H * 3}" fill="${i === 0 ? esc(accent) : esc(accent2)}" opacity="${i === 0 ? 0.95 : (0.08 + r() * 0.25).toFixed(2)}" transform="rotate(${(18 + r() * 8).toFixed(0)} ${W / 2} ${H / 2})"/>`);
      }
      break;
    }
    case 'paper': {
      for (let i = 0; i < 5; i++) {
        const x = r() * W * 0.8, y = r() * H * 0.8, w = W * (0.25 + r() * 0.45), h = H * (0.12 + r() * 0.3);
        body.push(`<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="${i % 2 ? esc(accent2) : esc(accent)}" opacity="${(0.18 + r() * 0.5).toFixed(2)}" transform="rotate(${(r() * 16 - 8).toFixed(1)} ${(x + w / 2).toFixed(0)} ${(y + h / 2).toFixed(0)})"/>`);
      }
      body.push(`<circle cx="${(W * (0.3 + r() * 0.4)).toFixed(0)}" cy="${(H * (0.3 + r() * 0.4)).toFixed(0)}" r="${(W * 0.16).toFixed(0)}" fill="none" stroke="${esc(theme.colors.text)}" stroke-opacity="0.5" stroke-width="3"/>`);
      break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs.join('')}</defs>${body.join('')}</svg>`;
}

export function accentDataUrl(theme: DeckTheme, seed: string, width?: number, height?: number): string {
  const svg = accentSvg(theme, seed, width, height);
  const base64 = typeof Buffer !== 'undefined' ? Buffer.from(svg).toString('base64') : btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${base64}`;
}
