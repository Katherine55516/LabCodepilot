import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exportVerificationIssue, blockExportVerification } from './lib/ppt-export-integrity.mjs';
import { OFFICE_BINARY_SCRIPT } from './lib/ppt-fonts.mjs';
import { GLYPH_SPAN_SCRIPT, GLYPH_IN_FRAME_SCRIPT } from './lib/ppt/export-verifier-python.mjs';

// 3143, 367a72d8: the export check ran bare 'soffice', LibreOffice was not
// installed, and the raw Python traceback became the user's error message.
const missing = 'Traceback (most recent call last):\n  File "<string>", line 1268, in <module>\n  File "<string>", line 484, in verify_export\n' +
  '__main__.RuntimeDependencyMissing: export_verifier_unavailable: LibreOffice (soffice) is not installed in this runtime, so the exported PPTX cannot be rendered for verification';
const unavailable = exportVerificationIssue(new Error(missing));
assert.equal(unavailable.code, 'export_verifier_unavailable');
assert.equal(unavailable.repairable, false, 'a missing LibreOffice is an environment error, not a content repair');
assert.ok(unavailable.message.startsWith('export_verifier_unavailable: LibreOffice') && !unavailable.message.includes('Traceback'));
assert.ok(unavailable.details.trace.includes('verify_export'), 'the trace stays available for diagnosis');

const failed = exportVerificationIssue(new Error('Traceback (most recent call last):\n  File "x", line 1\nValueError: PPTX rendered visibility failed on slide 3'));
assert.deepEqual([failed.code, failed.repairable, failed.message], ['export_integrity_failed', true, 'PPTX rendered visibility failed on slide 3'], 'a traceback is reduced to its final message');
assert.equal(exportVerificationIssue(new Error('PPTX relation routes were not verified')).message, 'PPTX relation routes were not verified');

const project = { status: 'publishing', quality: { deterministic: { issues: [{ code: 'export_integrity_failed', severity: 'error' }] } } };
blockExportVerification(project, new Error(missing));
assert.ok(project.error.startsWith('PPT export verification blocked publish: export_verifier_unavailable:') && !project.error.includes('Traceback'));
assert.deepEqual(project.quality.deterministic.issues.map(issue => issue.code), ['export_verifier_unavailable'], 'the earlier export issue is replaced');

// Every converter finds LibreOffice the same way: PPT_SOFFICE first.
const python = process.env.PPT_TEST_PYTHON || process.env.PPT_PYTHON || 'python3';
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-office-binary-'));
try {
  const fake = path.join(folder, 'soffice');
  fs.writeFileSync(fake, '#!/bin/sh\necho fake\n'); fs.chmodSync(fake, 0o755);
  const found = spawnSync(python, ['-c', OFFICE_BINARY_SCRIPT + '\nprint(office_binary())'], { env: { ...process.env, PPT_SOFFICE: fake }, encoding: 'utf8' });
  assert.equal(found.stdout.trim(), fake, found.stderr);
  // An explicit engine that is not there is missing, even with LibreOffice installed elsewhere.
  const absent = spawnSync(python, ['-c', OFFICE_BINARY_SCRIPT + "\noffice_binary('export_verifier_unavailable: test')"], { env: { ...process.env, PPT_SOFFICE: path.join(folder, 'missing-soffice') }, encoding: 'utf8' });
  assert.ok(absent.status !== 0 && absent.stderr.includes('RuntimeDependencyMissing: export_verifier_unavailable: test'), absent.stderr);
} finally { fs.rmSync(folder, { recursive: true, force: true }); }
// Hanging punctuation (Fable D1, gamma-http p4): a line-end closing CJK mark up to one em
// past the right edge counts as present; a clipped letter, a far mark or a second mark on one line does not.
{const {EXPORT_VERIFY_SCRIPT}=await import('./lib/ppt/export-verifier-python.mjs');
 const start=EXPORT_VERIFY_SCRIPT.indexOf('def verify_key'),block=EXPORT_VERIFY_SCRIPT.slice(start,EXPORT_VERIFY_SCRIPT.indexOf('    return found',start)+'    return found'.length);
 const glyph=(text,x0,top)=>({text,x0,x1:x0+18,top,bottom:top+18});
 const cases={hang:[[glyph('。',590,200)],{'。':1}],clipped:[[glyph('A',590,200)],{'A':1}],far:[[glyph('。',620,200)],{'。':1}],twice:[[glyph('。',590,200),glyph('。',592,200)],{'。':2}]};
 const code=`import re as verify_re, unicodedata as verify_unicode, json, sys\n${block}\ncases=json.loads(sys.argv[1])\nprint(json.dumps({k:verify_hanging_marks(c,(62,178,597.8,457),s) for k,(c,s) in cases.items()},ensure_ascii=False))`;
 const run=spawnSync(process.env.PPT_TEST_PYTHON||'python3',['-I','-c',code,JSON.stringify(cases)],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 assert.deepEqual(JSON.parse(run.stdout),{hang:{'。':1},clipped:{},far:{},twice:{'。':1}});}
// 3143, cb2fd261: a synthetic italic (Roboto Regular sheared by 0.346) starts
// on its frame's edge, but pdfplumber's sheared em box reaches 1.1pt left of it.
const glyphs = [
  { text: 'E', upright: true, matrix: [1, 0, 0.346, 1, 451.98, 111.37], adv: 7.39, x0: 450.88, x1: 462.78 },
  { text: 'D', upright: true, matrix: [1, 0, 0, 1, 52.07, 300], adv: 21.198, x0: 52.07, x1: 73.27 },
  { text: 'R', upright: false, matrix: [0, 1, -1, 0, 80, 200], adv: 9, x0: 70, x1: 80 },
];
const spans = spawnSync(python, ['-c', GLYPH_SPAN_SCRIPT + '\nimport json,sys\nprint(json.dumps([glyph_span(c) for c in json.load(sys.stdin)]))'], { input: JSON.stringify(glyphs), encoding: 'utf8' });
assert.equal(spans.status, 0, spans.stderr);
assert.deepEqual(JSON.parse(spans.stdout).map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]), [[451.98, 459.37], [52.07, 73.27], [70, 80]], 'a sheared glyph is measured on its baseline; upright and rotated glyphs keep their box');
// 3143 g5b: a 44.1 pt frame ending at 320.0 pt, DM Sans 14 pt at line spacing
// 1.3; LibreOffice drew the second line's em box to 321.1 pt with its ink
// inside. Below the frame a tenth of the font size is allowed; every other
// edge keeps 1 pt.
const frame = [100, 275.9, 300, 320];
const cases = [
  [{ x0: 110, x1: 120, top: 307.1, bottom: 321.1 }, 14, true],
  [{ x0: 110, x1: 120, top: 307.1, bottom: 321.1 }, null, false],
  [{ x0: 110, x1: 120, top: 308, bottom: 322 }, 14, false],
  [{ x0: 110, x1: 301.2, top: 290, bottom: 304 }, 14, false],
  [{ x0: 110, x1: 120, top: 274.7, bottom: 288.7 }, 14, false],
];
const inFrame = spawnSync(python, ['-c', GLYPH_IN_FRAME_SCRIPT + '\nimport json,sys\nf=' + JSON.stringify(frame) + '\nprint(json.dumps([glyph_in_frame(c,*f,size) for c,size in json.load(sys.stdin)]))'], { input: JSON.stringify(cases.map(([c, size]) => [c, size])), encoding: 'utf8' });
assert.equal(inFrame.status, 0, inFrame.stderr);
assert.deepEqual(JSON.parse(inFrame.stdout), cases.map(([, , expected]) => expected), 'the last line may hang 0.1 x size below its frame; sides and top keep 1 pt');
console.log('PPT export verifier errors: readable messages, environment errors, one LibreOffice lookup, hanging CJK punctuation, baseline spans for synthetic italics and the frame tolerance: OK');
