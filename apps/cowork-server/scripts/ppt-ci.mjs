/** Portable, secret-free PPT selftest suite. This is not live-model/remote E2E. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.PPT_CI_OUTPUT || 'outputs/ppt-ci');
fs.mkdirSync(output, { recursive: true });
if (process.argv.includes('--require-arm64') && (process.platform !== 'darwin' || process.arch !== 'arm64')) throw new Error('PPT CI requires native Darwin arm64');
const records = [];
for (const name of fs.readdirSync(root).filter(name => /^selftest-ppt(?:-.+)?\.mjs$/.test(name)).sort()) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(root, name)], { cwd: root, env: process.env, encoding: 'utf8', timeout: 180000, maxBuffer: 4000000 });
  fs.writeFileSync(path.join(output, name + '.log'), (run.stdout || '') + (run.stderr || '') + (run.error ? '\n' + run.error.message : ''));
  const optionalFixtureAbsent = ['selftest-ppt-real-fixture.mjs', 'selftest-ppt-gamma-http.mjs'].includes(name) && /skip/i.test(run.stdout || '');
  records.push({ name, status: run.status === 0 ? optionalFixtureAbsent ? 'skipped-fixture' : 'passed' : 'failed', exitCode: run.status, ms: Date.now() - started });
  console.log(`${records.at(-1).status}: ${name}`);
}
const report = { schemaVersion: 1, environment: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, node: process.version, python: process.env.PPT_TEST_PYTHON || 'python3' }, liveModel: false, remoteDeployment: false, records };
fs.writeFileSync(path.join(output, 'selftests.json'), JSON.stringify(report, null, 2));
if (records.some(record => record.status === 'failed')) process.exitCode = 1;
