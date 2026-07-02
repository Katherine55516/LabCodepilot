/**
 * Unit tests for the shared reachability probe (src/lib/test/probe.ts) and the
 * execution pre-flight gate in POST /api/test/run (src/app/api/test/run/route.ts).
 *
 * The bug this guards: when the system-under-test is down, the AI followed rule
 * §0.3 and curl-probed the target FOREVER (no cap). The fix is a bounded (≤3-try)
 * server-side probe that stops and tells the user to check the system.
 *
 * Run with: npx tsx --test src/__tests__/unit/test-probe.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { probeUrl, probeUrlWithRetry } from "../../lib/test/probe";
import { POST } from "../../app/api/test/run/route";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("probeUrl (single-shot)", () => {
  it("reachable: any HTTP response (incl 4xx/5xx) counts as reachable", async () => {
    let called = 0;
    globalThis.fetch = (async () => { called++; return new Response("", { status: 404 }); }) as typeof fetch;
    const r = await probeUrl("http://localhost:5173/");
    assert.equal(r.reachable, true);
    assert.equal(r.status, 404);
    assert.equal(called, 1);
  });

  it("unreachable: fetch rejection (connection refused) → reachable:false + error", async () => {
    globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
    const r = await probeUrl("http://localhost:5173/");
    assert.equal(r.reachable, false);
    assert.match(r.error || "", /ECONNREFUSED/);
  });

  it("invalid url → error:'invalid url', never calls fetch", async () => {
    let called = 0;
    globalThis.fetch = (async () => { called++; return new Response(""); }) as typeof fetch;
    const r = await probeUrl("not-a-url");
    assert.equal(r.reachable, false);
    assert.equal(r.error, "invalid url");
    assert.equal(called, 0);
  });

  it("unsupported protocol (file://) → error:'unsupported protocol', never calls fetch (SSRF-safe)", async () => {
    let called = 0;
    globalThis.fetch = (async () => { called++; return new Response(""); }) as typeof fetch;
    const r = await probeUrl("file:///etc/passwd");
    assert.equal(r.reachable, false);
    assert.equal(r.error, "unsupported protocol");
    assert.equal(called, 0);
  });
});

describe("probeUrlWithRetry (execution pre-flight gate)", () => {
  it("returns as soon as reachable (2nd attempt) — stops retrying early", async () => {
    let called = 0;
    globalThis.fetch = (async () => {
      called++;
      if (called < 2) throw new Error("ECONNREFUSED");
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const r = await probeUrlWithRetry("http://localhost:5173/", { delayMs: 0 });
    assert.equal(r.reachable, true);
    assert.equal(r.attempts, 2);
    assert.equal(called, 2);
  });

  it("caps at 3 attempts when never reachable, then gives up (THE FIX: bounded, not endless)", async () => {
    let called = 0;
    globalThis.fetch = (async () => { called++; throw new Error("ECONNREFUSED"); }) as typeof fetch;
    const r = await probeUrlWithRetry("http://localhost:5173/siway/", { attempts: 3, delayMs: 0 });
    assert.equal(r.reachable, false);
    assert.equal(r.attempts, 3);
    assert.equal(called, 3); // exactly 3 — the whole point of the fix
  });

  it("does not retry an unsupported-protocol url (attempts:1, no fetch)", async () => {
    let called = 0;
    globalThis.fetch = (async () => { called++; return new Response(""); }) as typeof fetch;
    const r = await probeUrlWithRetry("ftp://example.com/", { attempts: 3, delayMs: 0 });
    assert.equal(r.reachable, false);
    assert.equal(r.last.error, "unsupported protocol");
    assert.equal(r.attempts, 1);
    assert.equal(called, 0);
  });

  it("honors an already-aborted signal (bails without probing)", async () => {
    let called = 0;
    globalThis.fetch = (async () => { called++; throw new Error("ECONNREFUSED"); }) as typeof fetch;
    const ac = new AbortController();
    ac.abort();
    const r = await probeUrlWithRetry("http://localhost:5173/", { attempts: 3, delayMs: 0, signal: ac.signal });
    assert.equal(r.reachable, false);
    assert.equal(called, 0);
  });
});

describe("POST /api/test/run — reachability gate (execution step)", () => {
  let proj: string;
  beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "run-gate-")); });
  afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

  it("unreachable http baseUrl → 503 + check-the-system message; AI never launched (probes exactly 3×)", async () => {
    let called = 0;
    globalThis.fetch = (async () => { called++; throw new Error("ECONNREFUSED"); }) as typeof fetch;
    const res = await POST(new Request("http://x/api/test/run", {
      method: "POST",
      body: JSON.stringify({ projectPath: proj, taskName: "jiandao", step: "execution", baseUrl: "http://localhost:5173/siway/" }),
    }));
    assert.equal(res.status, 503);
    const j = await res.json() as { error?: string };
    assert.match(j.error || "", /被测系统无法访问/);
    assert.match(j.error || "", /3 次/);
    assert.equal(called, 3); // gate probed 3× then returned — no streamClaude, no infinite loop
  });
});
