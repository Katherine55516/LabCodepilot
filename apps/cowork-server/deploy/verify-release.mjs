import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(process.argv[2] || '.');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.json')));
if (manifest.schemaVersion !== 1 || manifest.byokProtocolVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid release manifest');
for (const item of manifest.files) {
  if (typeof item.path !== 'string' || path.isAbsolute(item.path) || item.path.split('/').includes('..')) throw new Error('Invalid release path');
  const file = path.join(root, item.path);
  if (!fs.lstatSync(file).isFile()) throw new Error(`Invalid release file: ${item.path}`);
  if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== item.sha256) throw new Error(`Release hash mismatch: ${item.path}`);
}
console.log(`Verified ${manifest.files.length} source files; BYOK protocol v${manifest.byokProtocolVersion}`);
