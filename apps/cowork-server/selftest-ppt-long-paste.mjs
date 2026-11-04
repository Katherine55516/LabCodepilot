// E2 of the full review: a paste longer than 80,000 characters is read through
// the file pipeline as a Markdown document instead of being rejected.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-long-paste-'));
process.env.COWORK_STATE_DIR = root;
const [api, store, source] = await Promise.all([import('./lib/ppt-api.mjs'), import('./lib/ppt-store.mjs'), import('./lib/ppt-source.mjs')]);
const uid = 'long-paste';
const extracted = [];
const deps = { ...api._internals.defaultDeps, removeContainer: async () => {},
  extractFile: async (p, name, bytes) => { extracted.push({ name, bytes }); return new Promise(() => {}); } };
async function call(method, route, data) {
  const req = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []); req.method = method; let result;
  await api.handlePpt(req, new URL('http://test' + route), { uid, deps, activity: () => {}, log: () => {}, send: (status, body) => { result = { status, body }; return true; }, res: { writeHead() {}, on() {}, destroy() {} } });
  return result;
}

const section = i => `## Chapter ${i}\n\n` + Array.from({ length: 40 }, (_, k) => `Chapter ${i} records observation ${k} under condition ${k % 7}.`).join(' ');
const long = '# Long tutorial\n\n' + Array.from({ length: 60 }, (_, i) => section(i + 1)).join('\n\n');
assert.ok(long.length > source.MAX_PASTE_CHARS);

// Helper: short pastes are unchanged; long ones become a Markdown file input.
const short = { inputKind: 'paste', text: 'Short paste' };
assert.equal(source.pasteAsFileInput(short), short);
const converted = source.pasteAsFileInput({ inputKind: 'paste', text: long, prompt: 'Teach it' });
assert.equal(converted.inputKind, 'file'); assert.equal(converted.fileName, source.LONG_PASTE_FILE_NAME);
assert.equal(Buffer.from(converted.fileBase64, 'base64').toString('utf8'), long, 'the pasted text is kept byte for byte');
assert.equal(converted.pastedTitle, 'Long tutorial'); assert.equal(converted.prompt, 'Teach it'); assert.equal(converted.text, undefined);
assert.throws(() => source.pasteAsFileInput({ inputKind: 'paste', text: 'x'.repeat(source.MAX_FILE_BYTES + 1) }), /8 MB/);
assert.throws(() => source.normalizePaste(long), /80000/, 'the paste normalizer itself still bounds direct paste');

// Create: the long paste starts as a file project and is ingested from the file.
const created = await call('POST', '/ppt/projects', { inputKind: 'paste', text: long, template: 'light', configId: 'fixture' });
assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 300));
const project = created.body.project;
assert.equal(project.inputKind, 'file');
assert.equal(project.source.pastedAsFile, true);
assert.equal(project.source.name, source.LONG_PASTE_FILE_NAME);
assert.equal(project.title, 'Long tutorial', 'the deck title comes from the pasted heading, not the file name');
assert.equal(project.status, 'ingesting');
assert.equal(store.readSource(uid, project.id).toString('utf8'), long);
await new Promise(resolve => setTimeout(resolve, 50));
assert.equal(extracted[0]?.name, source.LONG_PASTE_FILE_NAME);

// A paste within the limit is still a paste project.
const pasted = await call('POST', '/ppt/projects', { inputKind: 'paste', text: '# Short\n\nOne measured fact.', template: 'light', configId: 'fixture' });
assert.equal(pasted.status, 201); assert.equal(pasted.body.project.inputKind, 'paste');

console.log('PPT long paste: >80k characters read as a Markdown file, title kept, short pastes unchanged: OK');
process.exit(0);
