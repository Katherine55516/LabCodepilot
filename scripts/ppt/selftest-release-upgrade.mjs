/** Upgrade/rollback logic with isolated Linux-shaped tool doubles; no real service. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-upgrade-test-'));
const archive = path.join(root, 'release.tar.gz');
try {
  execFileSync(process.execPath, ['scripts/ppt/package-cowork-release.mjs', archive]);
  execFileSync('tar', ['-xzf', archive, '-C', root]);
  const release = path.join(root, 'cowork-release');
  const tools = path.join(root, 'tools'); fs.mkdirSync(tools);
  const script = (name, body) => { const target = path.join(tools, name); fs.writeFileSync(target, body); fs.chmodSync(target, 0o755); };
  script('uname', '#!/bin/sh\necho Linux\n');
  script('id', '#!/bin/sh\necho 0\n');
  script('stat', `#!/bin/sh\necho '${process.getuid()}:${process.getgid()}'\n`);
  script('npm', '#!/bin/sh\nexit 0\n');
  script('systemctl', `#!${process.execPath}\nconst fs=require('fs'),p=require('path');const [action]=process.argv.slice(2),dest=process.env.PPT_UPGRADE_TEST_DEST;\nfs.appendFileSync(process.env.PPT_UPGRADE_TEST_LOG,action+'\\n');\nif(action==='show')console.log(process.env.PPT_UPGRADE_TEST_WRONG_DIR?'wrong-directory':dest);\nif(action==='is-active'&&process.env.PPT_UPGRADE_TEST_FAIL&&fs.existsSync(p.join(dest,'release-manifest.json')))process.exit(1);\n`);
  for (const scenario of ['success', 'rollback', 'wrong-working-directory']) {
    const dest = path.join(root, scenario); fs.mkdirSync(dest); fs.mkdirSync(path.join(dest, 'logs'));
    fs.writeFileSync(path.join(dest, 'index.mjs'), '// prior source\n');
    const config = `COWORK_AUTH_SECRET=test-only-not-a-real-token\nCOWORK_STATE_DIR=${path.join(root, 'external-state')}\nCOWORK_AUDIT_FILE=logs/audit.jsonl\n`;
    fs.writeFileSync(path.join(dest, '.env'), config, { mode: 0o600 });
    fs.writeFileSync(path.join(dest, 'logs/audit.jsonl'), 'prior audit\n');
    const log = path.join(root, scenario + '.actions');
    const env = { ...process.env, PATH: tools + path.delimiter + process.env.PATH, PPT_UPGRADE_TEST_DEST: dest, PPT_UPGRADE_TEST_LOG: log,
      ...(scenario === 'rollback' ? { PPT_UPGRADE_TEST_FAIL: '1' } : {}), ...(scenario === 'wrong-working-directory' ? { PPT_UPGRADE_TEST_WRONG_DIR: '1' } : {}) };
    const result = spawnSync('bash', [path.join(release, 'deploy/apply-release.sh'), release, dest], { env, encoding: 'utf8', timeout: 30000 });
    assert.equal(fs.readFileSync(path.join(dest, '.env'), 'utf8'), config, 'existing config must not change');
    assert.equal(fs.readFileSync(path.join(dest, 'logs/audit.jsonl'), 'utf8'), 'prior audit\n', 'configured audit location must remain');
    assert.ok(!result.stdout.includes('test-only-not-a-real-token') && !result.stderr.includes('test-only-not-a-real-token'));
    if (scenario === 'success') {
      assert.equal(result.status, 0, result.stderr); assert.ok(fs.existsSync(path.join(dest, 'lib/ppt-model-jobs.mjs')));
      assert.ok(fs.readdirSync(root).some(name => name.startsWith('success.bak-')));
    } else {
      assert.notEqual(result.status, 0); assert.equal(fs.readFileSync(path.join(dest, 'index.mjs'), 'utf8'), '// prior source\n');
      if (scenario === 'rollback') assert.match(result.stderr, /restored prior deployment/);
      else assert.ok(!fs.readFileSync(log, 'utf8').includes('stop'), 'wrong service must fail before stopping anything');
    }
    console.log(`Upgrade logic passed: ${scenario} (systemd/npm/platform doubles; no real deployment)`);
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
