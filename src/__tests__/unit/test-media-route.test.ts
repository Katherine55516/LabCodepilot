/**
 * Integration tests for the 证据媒体 service (src/app/api/test/media/route.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-media-route.test.ts
 *
 * Focus: path-traversal safety (the security-critical bit), mime, 404/400, and
 * HTTP Range (206 partial / 416) for video seek.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET } from "../../app/api/test/media/route";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
let proj: string;
let evidenceDir: string;
beforeEach(() => {
  proj = fs.mkdtempSync(path.join(os.tmpdir(), "media-route-"));
  evidenceDir = path.join(proj, "AI_LabTest", "report", "_evidence", "订单-local");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "TC-001.png"), PNG);
});
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const url = (p: Record<string, string>) =>
  "http://x/api/test/media?" + new URLSearchParams(p).toString();

describe("GET /api/test/media — serving", () => {
  it("serves an existing evidence image with the right mime + bytes", async () => {
    const res = await GET(new Request(url({ projectPath: proj, taskName: "订单", env: "local", file: "TC-001.png" })));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  });
  it("400 when required params are missing", async () => {
    const res = await GET(new Request(url({ projectPath: proj, taskName: "订单" })));
    assert.equal(res.status, 400);
  });
  it("404 for a non-existent file", async () => {
    const res = await GET(new Request(url({ projectPath: proj, taskName: "订单", env: "local", file: "nope.png" })));
    assert.equal(res.status, 404);
  });
  it("404 when the target resolves to a directory, not a file", async () => {
    // file='' → basename '' → target === evidenceRoot (a dir) → not a file
    const res = await GET(new Request(url({ projectPath: proj, taskName: "订单", env: "local", file: "." })));
    assert.equal(res.status, 404);
  });
});

describe("GET /api/test/media — path traversal safety", () => {
  it("strips ../ traversal to a basename — cannot escape the evidence dir", async () => {
    fs.writeFileSync(path.join(proj, "secret.txt"), "TOP SECRET");
    const res = await GET(new Request(url({ projectPath: proj, taskName: "订单", env: "local", file: "../../../../secret.txt" })));
    assert.equal(res.status, 404); // basename=secret.txt, looked up INSIDE evidence dir → miss
  });
  it("cannot read an absolute path outside the project", async () => {
    const res = await GET(new Request(url({ projectPath: proj, taskName: "订单", env: "local", file: "/etc/hosts" })));
    assert.equal(res.status, 404); // basename=hosts, not in evidence dir
  });
  it("an evidence file reachable only via traversal basename still serves (proves basename, not prefix-strip)", async () => {
    // a file literally named after a traversal payload's basename, sitting in the evidence dir
    fs.writeFileSync(path.join(evidenceDir, "passwd"), Buffer.from("not-a-secret"));
    const res = await GET(new Request(url({ projectPath: proj, taskName: "订单", env: "local", file: "../../../../etc/passwd" })));
    assert.equal(res.status, 200); // basename=passwd resolves inside evidence dir
  });
  it("rejects a traversal taskName — the evidence-root must not escape the project (H2)", async () => {
    // taskName is NOT basename-stripped → it flows straight into evidenceRoot. A
    // traversal taskName lets the root climb out of the project. Must be rejected.
    const res = await GET(new Request(url({ projectPath: proj, taskName: "../../../../etc", env: "local", file: "passwd" })));
    assert.equal(res.status, 400);
  });
});

describe("GET /api/test/media — video Range", () => {
  beforeEach(() => {
    fs.writeFileSync(path.join(evidenceDir, "TC-002.webm"), Buffer.alloc(100, 7));
  });
  it("returns 206 partial with Content-Range for a ranged video request", async () => {
    const res = await GET(new Request(url({ projectPath: proj, taskName: "订单", env: "local", file: "TC-002.webm" }), { headers: { Range: "bytes=0-49" } }));
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), "bytes 0-49/100");
    assert.equal(res.headers.get("content-length"), "50");
    assert.equal(res.headers.get("accept-ranges"), "bytes");
  });
  it("serves the whole video (with Accept-Ranges) when no Range header", async () => {
    const res = await GET(new Request(url({ projectPath: proj, taskName: "订单", env: "local", file: "TC-002.webm" })));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "video/webm");
    assert.equal(res.headers.get("accept-ranges"), "bytes");
  });
  it("416 when the range is unsatisfiable", async () => {
    const res = await GET(new Request(url({ projectPath: proj, taskName: "订单", env: "local", file: "TC-002.webm" }), { headers: { Range: "bytes=200-300" } }));
    assert.equal(res.status, 416);
  });
  it("handles a suffix range (bytes=-N → the LAST N bytes) (H3)", async () => {
    // 100-byte file, request last 30 bytes → should be bytes 70-99/100, not 0-30.
    const res = await GET(new Request(url({ projectPath: proj, taskName: "订单", env: "local", file: "TC-002.webm" }), { headers: { Range: "bytes=-30" } }));
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), "bytes 70-99/100");
    assert.equal(res.headers.get("content-length"), "30");
  });
  it("handles an open-ended range (bytes=50- → byte 50 to EOF)", async () => {
    const res = await GET(new Request(url({ projectPath: proj, taskName: "订单", env: "local", file: "TC-002.webm" }), { headers: { Range: "bytes=50-" } }));
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), "bytes 50-99/100");
    assert.equal(res.headers.get("content-length"), "50");
  });
});
