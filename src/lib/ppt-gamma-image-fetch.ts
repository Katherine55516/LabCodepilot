/**
 * Fetches an input image URL for the Gamma-compatible API, the way Gamma
 * re-hosts image URLs from inputText, within the engine's media contract:
 * PNG or JPEG, at most 512 KB (apps/cowork-server/lib/ppt-blocks.mjs).
 *
 * The caller holds the API key, but the request runs on the user's machine,
 * so only public HTTPS hosts are fetched: the host must resolve to public
 * addresses only, redirects are refused (a redirect could lead to a private
 * host), and the body is read with a hard byte cap. A failure returns a
 * reason; it never throws, so one bad URL never fails the generation.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const MAX_ENGINE_IMAGE_BYTES = 512 * 1024;

export type ImageFetchResult = { ok: true; dataUrl: string } | { ok: false; reason: string };

/** Loopback, private, link-local, CGNAT, multicast, reserved and unique-local ranges. */
export function isPrivateAddress(address: string): boolean {
  const mapped = address.toLowerCase().startsWith('::ffff:') ? address.slice(7) : address;
  if (isIP(mapped) === 4) {
    const [a, b] = mapped.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const v6 = mapped.toLowerCase();
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
}

function imageKind(bytes: Uint8Array): 'png' | 'jpeg' | undefined {
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return undefined;
}

export async function fetchInputImage(href: string, timeoutMs = 10_000): Promise<ImageFetchResult> {
  let url: URL;
  try { url = new URL(href); } catch { return { ok: false, reason: 'invalid URL' }; }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not HTTPS' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  try {
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) return { ok: false, reason: 'host is not public' };
  } catch { return { ok: false, reason: 'host did not resolve' }; }
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'image/png,image/jpeg' } });
    if (!response.ok || !response.body) return { ok: false, reason: `HTTP ${response.status}` };
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_ENGINE_IMAGE_BYTES) return { ok: false, reason: 'larger than 512 KB' };
    const reader = response.body.getReader();
    const parts: Uint8Array[] = []; let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ENGINE_IMAGE_BYTES) { await reader.cancel(); return { ok: false, reason: 'larger than 512 KB' }; }
      parts.push(value);
    }
    const bytes = Buffer.concat(parts);
    const kind = imageKind(bytes);
    if (!kind) return { ok: false, reason: 'not a PNG or JPEG image' };
    return { ok: true, dataUrl: `data:image/${kind};base64,${bytes.toString('base64')}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'fetch failed' };
  }
}
