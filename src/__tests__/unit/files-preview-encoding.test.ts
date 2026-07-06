/**
 * Unit tests for text-encoding detection in the file preview / write
 * pipeline (GBK 兼容 — GBK files used to render as U+FFFD mojibake because
 * readFilePreview hardcoded utf-8 stream decoding, and saving through the
 * preview panel silently transcoded them to UTF-8).
 *
 * Covers:
 *   - detection: ASCII / UTF-8 / UTF-8+BOM → 'utf-8'; GBK bytes → 'gbk'
 *   - decode correctness for GBK content (incl. CRLF + line caps)
 *   - the 4KB sample boundary cutting a UTF-8 char in half (must NOT
 *     misclassify as GBK)
 *   - write route round-trip: encoding:'gbk' writes GBK bytes back
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';
import iconv from 'iconv-lite';
import { NextRequest } from 'next/server';

import { readFilePreview } from '../../lib/files';
import { POST as writePost } from '../../app/api/files/write/route';

// realpath: macOS tmpdir lives under /var → /private/var symlink, which the
// write route's symlink-chain guard would (correctly) reject.
let root = '';

const CN_TEXT = '// 这是一个简单的 Java 示例\n// 演示中文注释；\npublic class HelloWorld {\n}\n';

function plant(name: string, bytes: Buffer | string): string {
  const p = path.join(root, name);
  fs.writeFileSync(p, bytes);
  return p;
}

describe('readFilePreview — encoding detection & decode', () => {
  before(() => {
    root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'enc-preview-'));
  });
  after(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('plain ASCII file → utf-8', async () => {
    const p = plant('ascii.txt', 'hello world\nsecond line\n');
    const preview = await readFilePreview(p);
    assert.equal(preview.encoding, 'utf-8');
    assert.equal(preview.content, 'hello world\nsecond line');
  });

  it('UTF-8 Chinese file → utf-8, content intact', async () => {
    const p = plant('utf8.java', CN_TEXT);
    const preview = await readFilePreview(p);
    assert.equal(preview.encoding, 'utf-8');
    assert.ok(preview.content.includes('这是一个简单的 Java 示例'));
  });

  it('UTF-8 file with BOM → utf-8 (BOM must not trip GBK detection)', async () => {
    const p = plant('bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(CN_TEXT)]));
    const preview = await readFilePreview(p);
    assert.equal(preview.encoding, 'utf-8');
  });

  it('GBK Chinese file → gbk, decodes without mojibake', async () => {
    const p = plant('gbk.java', iconv.encode(CN_TEXT, 'gbk'));
    const preview = await readFilePreview(p);
    assert.equal(preview.encoding, 'gbk');
    assert.ok(!preview.content.includes('�'), 'no replacement chars');
    assert.equal(preview.content, CN_TEXT.replace(/\n$/, ''));
    assert.equal(preview.line_count, 4);
    assert.equal(preview.line_count_exact, true);
    assert.equal(preview.truncated, false);
  });

  it('GBK file with CRLF line endings splits lines like readline', async () => {
    const p = plant('gbk-crlf.txt', iconv.encode('第一行\r\n第二行\r\n', 'gbk'));
    const preview = await readFilePreview(p);
    assert.equal(preview.encoding, 'gbk');
    assert.equal(preview.content, '第一行\n第二行');
    assert.equal(preview.line_count, 2);
  });

  it('GBK file respects the line cap and reports exact totals', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `第${i}行内容`).join('\n');
    const p = plant('gbk-long.txt', iconv.encode(lines, 'gbk'));
    const preview = await readFilePreview(p, 5);
    assert.equal(preview.encoding, 'gbk');
    assert.equal(preview.truncated, true);
    assert.equal(preview.line_count, 10);
    assert.equal(preview.line_count_exact, true);
    assert.equal(preview.content.split('\n').length, 5);
    assert.ok(!preview.content.includes('�'));
  });

  it('UTF-8 char straddling the 4KB sample boundary is NOT misread as GBK', async () => {
    // 4095 ASCII bytes, then a 3-byte Chinese char whose bytes 2–3 fall
    // outside the 4096-byte detection sample.
    const head = 'a'.repeat(4095);
    const p = plant('boundary.txt', Buffer.from(head + '中' + '\nrest of file\n', 'utf-8'));
    const preview = await readFilePreview(p);
    assert.equal(preview.encoding, 'utf-8');
    assert.ok(preview.content.includes('中'));
  });

  it('GBK bytes near the sample start are detected even in mostly-ASCII files', async () => {
    const body = '// 配置文件\n' + 'key=value\n'.repeat(50);
    const p = plant('gbk-sparse.properties', iconv.encode(body, 'gbk'));
    const preview = await readFilePreview(p);
    assert.equal(preview.encoding, 'gbk');
    assert.ok(preview.content.includes('配置文件'));
  });
});

describe('POST /api/files/write — encoding round-trip', () => {
  // Own tmpdir — the previous suite's after() removes the shared one.
  let wroot = '';
  before(() => {
    wroot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'enc-write-'));
  });
  after(() => {
    if (wroot) fs.rmSync(wroot, { recursive: true, force: true });
  });

  const post = (body: object) =>
    writePost(
      new NextRequest('http://localhost/api/files/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  it("encoding:'gbk' writes GBK bytes; preview reads them back verbatim", async () => {
    const target = path.join(wroot, 'roundtrip.java');
    fs.writeFileSync(target, iconv.encode(CN_TEXT, 'gbk'));

    const edited = CN_TEXT + '// 追加的中文行\n';
    const res = await post({
      path: target,
      baseDir: wroot,
      content: edited,
      encoding: 'gbk',
      overwrite: true,
    });
    assert.equal(res.status, 200);

    const onDisk = fs.readFileSync(target);
    assert.deepEqual(onDisk, iconv.encode(edited, 'gb18030'));
    assert.ok(!onDisk.equals(Buffer.from(edited, 'utf-8')), 'must not have been transcoded to UTF-8');

    const preview = await readFilePreview(target);
    assert.equal(preview.encoding, 'gbk');
    assert.ok(preview.content.includes('追加的中文行'));
  });

  it('default (no encoding field) still writes UTF-8 — existing callers unchanged', async () => {
    const target = path.join(wroot, 'default-utf8.txt');
    const res = await post({ path: target, baseDir: wroot, content: CN_TEXT, overwrite: true });
    assert.equal(res.status, 200);
    assert.deepEqual(fs.readFileSync(target), Buffer.from(CN_TEXT, 'utf-8'));
  });

  it('unknown encoding value → 400 invalid_encoding, file untouched', async () => {
    const target = path.join(wroot, 'bad-enc.txt');
    const res = await post({ path: target, baseDir: wroot, content: 'x', encoding: 'big5', overwrite: true });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'invalid_encoding');
    assert.ok(!fs.existsSync(target));
  });
});
