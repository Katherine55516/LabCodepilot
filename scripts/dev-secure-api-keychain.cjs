/* eslint-disable @typescript-eslint/no-require-imports */
/* macOS development setup without an Electron download. A dedicated profile
 * uses an OS Keychain master key and the production AES-GCM DB layer.
 * This profile is intentionally separate from packaged app safeStorage data. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
if (process.platform !== 'darwin') throw new Error('macOS Keychain setup requires macOS');
const data = path.join(os.homedir(), '.aimate-api-development');
const service = 'AIMate API Development Master Key';
const account = os.userInfo().username;
const read = spawnSync('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w'], { encoding: 'utf8' });
let key;
if (read.status === 0) {
  key = read.stdout.trim();
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('Development master key is invalid; no changes made');
} else {
  // Only "item not found" permits creation. Locked/inaccessible Keychain must
  // fail rather than replace a key protecting existing encrypted settings.
  if (read.status !== 44 || fs.existsSync(path.join(data, 'codepilot.db'))) throw new Error('Development Keychain unavailable; existing data preserved');
  key = crypto.randomBytes(32).toString('hex');
  const write = spawnSync('/usr/bin/security', ['add-generic-password', '-s', service, '-a', account, '-w', key], { stdio: ['ignore', 'ignore', 'ignore'] });
  if (write.status !== 0) throw new Error('Could not save development master key to Keychain');
}
fs.mkdirSync(data, { recursive: true, mode: 0o700 });
const port = process.env.PORT || '3109';
const server = spawn(process.execPath, [path.resolve(__dirname, '../node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', port], {
  cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
  env: { ...process.env, CLAUDE_GUI_DATA_DIR: data, CLAUDE_GUI_SECRET_KEY: key },
});
key = undefined;
console.log(`AIMate development API profile (Keychain + encrypted DB): http://127.0.0.1:${port}/settings#providers`);
server.on('exit', code => process.exit(code || 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill('SIGTERM'));
