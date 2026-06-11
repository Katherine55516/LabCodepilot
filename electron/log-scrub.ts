/**
 * Secret scrubbing for the file logger.
 *
 * Pure module (no electron / node-only deps) so it can be unit-tested in
 * isolation. The file logger runs EVERY line through `scrubSecrets()` before
 * writing it to disk, so the log file a user may share when reporting a problem
 * never contains API keys, auth tokens, the credential master key, or
 * credential-bearing URLs.
 *
 * Two layers:
 *  1. Exact-value redaction — the caller passes the actual secret values it
 *     knows (from the main process env: CLAUDE_GUI_SECRET_KEY master key,
 *     ANTHROPIC_API_KEY, etc.). Any verbatim occurrence is replaced. Zero false
 *     positives, highest confidence.
 *  2. Pattern redaction — well-known credential shapes (sk-/Bearer/AKIA/hex
 *     tokens, auth headers, credentials embedded in URLs/query strings) for
 *     secrets we do NOT know the value of (e.g. a per-request provider key that
 *     leaks into upstream stderr).
 *
 * Patterns are ported and hardened from src/lib/runtime-log.ts `scrubMessage`.
 * Note: filesystem paths are deliberately NOT scrubbed — they are essential for
 * diagnosing "binary not found" / config-path issues, which is the whole point
 * of the log.
 */

const REDACTED = '«redacted»';

// [pattern, replacement] — applied in order. Broad header/URL rules first so a
// token inside a header isn't half-matched by a narrower token rule.
const PATTERNS: Array<[RegExp, string | ((substring: string, ...args: string[]) => string)]> = [
  // Authorization / api-key headers — redact the value, keep the header name.
  [/((?:authorization|x-api-key|x-goog-api-key|api[_-]?key|auth[_-]?token)["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[A-Za-z0-9._\-]{8,}/gi, `$1${REDACTED}`],
  // Bearer tokens anywhere.
  [/(Bearer\s+)[A-Za-z0-9._\-]{8,}/gi, `$1${REDACTED}`],
  // Anthropic / OpenAI-style keys.
  [/\b(sk-ant-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, `$1${REDACTED}`],
  [/\b(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]{8,}/g, `$1${REDACTED}`],
  [/\b(anthropic-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, `$1${REDACTED}`],
  [/\b(key-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, `$1${REDACTED}`],
  // AWS access key id (AKIA…/ASIA…).
  [/\b((?:AKIA|ASIA)[A-Z0-9]{2})[A-Z0-9]{10,}/g, `$1${REDACTED}`],
  // Well-known provider key prefixes appearing bare (not behind a header name).
  [/\bAIza[0-9A-Za-z_-]{16,}/g, REDACTED], // Google API key
  [/\bya29\.[0-9A-Za-z_-]{16,}/g, REDACTED], // Google OAuth access token
  [/\bgsk_[A-Za-z0-9]{16,}/g, REDACTED], // Groq
  [/\bxai-[A-Za-z0-9]{16,}/g, REDACTED], // xAI
  [/\b(?:gh[oprsu]|github_pat)_[A-Za-z0-9_]{16,}/g, REDACTED], // GitHub tokens
  // Credentials embedded in a URL: scheme://user:password@host  → keep user, mask password.
  [/(\b[a-z][a-z0-9+.\-]*:\/\/[^/\s:@]+:)[^/\s@]+(@)/gi, `$1${REDACTED}$2`],
  // Credential-bearing query params: ?token=… &api_key=… &access_token=… etc.
  [/([?&](?:token|key|api[_-]?key|access[_-]?token|auth|password|secret)=)[^&\s"'()]+/gi, `$1${REDACTED}`],
  // High-entropy token-ish strings (40+ chars with BOTH cases AND a digit) —
  // catches bare provider keys / session tokens that have no recognisable
  // prefix and aren't in a header/query context. The mixed-class requirement
  // avoids redacting ordinary words, file paths, and lowercase git SHAs (which
  // are useful to keep in a diagnostic log).
  [/\b(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{40,}={0,2}/g, (m: string) => m.slice(0, 6) + REDACTED],
  // Generic long hex tokens (48+ chars) — backstop for the 64-hex master key
  // (also redacted exactly via known-secret values). 48+ (not 32+) so 40-char
  // git commit SHAs survive for diagnosis.
  [/\b[A-Fa-f0-9]{48,}\b/g, (m: string) => m.slice(0, 6) + REDACTED],
];

/**
 * Redact secrets from a single line of log text.
 *
 * @param text         the raw log line
 * @param knownSecrets exact secret values to redact verbatim (length >= 8)
 */
export function scrubSecrets(text: string, knownSecrets: string[] = []): string {
  if (!text) return text;
  let out = text;

  // Layer 1 — exact known values (verbatim replace). Cheap and zero false positives.
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 8 && out.includes(secret)) {
      out = out.split(secret).join(REDACTED);
    }
  }

  // Layer 2 — pattern-based shapes.
  try {
    for (const [re, replacement] of PATTERNS) {
      out = out.replace(re, replacement as string);
    }
  } catch {
    // A pathological input must never break logging — fall back to layer-1 result.
  }

  return out;
}

/** Exported for tests / callers that want to know the placeholder. */
export const REDACTION_PLACEHOLDER = REDACTED;
