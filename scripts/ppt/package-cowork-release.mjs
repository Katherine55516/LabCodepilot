/** Create a source-only deployment artifact from the current checkout. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(repo, 'apps/cowork-server');
const output = path.resolve(process.argv[2] || path.join(repo, 'outputs/ppt-deployment/cowork-release.tar.gz'));
const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'apps/cowork-server'], { cwd: repo }).toString().split('\0').filter(Boolean);
const allowed = names.map(name => path.relative(source, path.join(repo, name))).filter(name => {
  const parts = name.split(path.sep), base = path.basename(name);
  if (parts.some(part => ['node_modules', 'outputs', 'coverage', '.git', '.ppt-build'].includes(part) || part.startsWith('.bak-'))) return false;
  if (base.startsWith('.env') && base !== '.env.example') return false;
  return /\.(mjs|js|cjs|py|sh|json|md|txt|service|yml)$/.test(base) || ['Dockerfile', 'Caddyfile.example', '.env.example'].includes(base);
}).sort();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-release-'));
try {
  const staged = path.join(temp, 'cowork-release'); fs.mkdirSync(staged);
  const files = [];
  for (const name of allowed) {
    const original = path.join(source, name);
    if (!fs.existsSync(original)) continue;
    if (!fs.lstatSync(original).isFile()) throw new Error(`Non-regular deployment source: ${name}`);
    const target = path.join(staged, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(original, target); fs.chmodSync(target, fs.statSync(original).mode & 0o777);
    files.push({ path: name.replaceAll(path.sep, '/'), sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') });
  }
  for (const required of ['index.mjs', 'lib/ppt-api.mjs', 'lib/ppt-model-jobs.mjs', 'lib/ppt-template-components.mjs', 'ppt-scope-test-helpers.mjs', 'scripts/ppt-ci.mjs', 'deploy/apply-release.sh', 'deploy/verify-release.mjs']) {
    if (!files.some(file => file.path === required)) throw new Error(`Deployment dependency missing: ${required}`);
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();
  fs.writeFileSync(path.join(staged, 'release-manifest.json'), JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), baseCommit: head, workingTreeSnapshot: true, byokProtocolVersion: 1, files }, null, 2));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  execFileSync('tar', ['-czf', output, '-C', temp, 'cowork-release']);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(output + '.sha256', `${sha}  ${path.basename(output)}\n`);
  console.log(JSON.stringify({ archive: output, sha256: sha, files: files.length, bytes: fs.statSync(output).size }));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
