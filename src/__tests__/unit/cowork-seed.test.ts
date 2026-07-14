import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const seedMod = () => import(path.resolve(__dirname, '../../lib/cowork-seed.ts'));
const DAEMON_PATH = path.resolve(__dirname, '../../../scripts/poc/cowork/cowork-daemon.py');

describe('cowork-seed: buildMetaData', () => {
  it('instance-id 跟随模板版本(升级机制的核心:版本 bump → instance-id 变 → cloud-init 重跑)', async () => {
    const { buildMetaData, SEED_TEMPLATE_VERSION } = await seedMod();
    const meta = buildMetaData();
    assert.match(meta, new RegExp(`^instance-id: codepilot-cowork-v${SEED_TEMPLATE_VERSION}$`, 'm'));
    assert.match(meta, /^local-hostname: cowork-poc$/m);
  });
});

describe('cowork-seed: buildUserData', () => {
  const FAKE_DAEMON = '#!/usr/bin/env python3\nprint("hi")\n';

  it('daemon base64 内嵌可无损还原', async () => {
    const { buildUserData, GUEST_DAEMON_TARGET } = await seedMod();
    const ud = buildUserData(FAKE_DAEMON);
    assert.ok(ud.startsWith('#cloud-config\n'));
    assert.ok(ud.includes(`path: ${GUEST_DAEMON_TARGET}`));
    const m = ud.match(/encoding: b64\n\s+content: ([A-Za-z0-9+/=]+)/);
    assert.ok(m, 'base64 content block present');
    assert.equal(Buffer.from(m![1], 'base64').toString('utf8'), FAKE_DAEMON);
  });

  it('无任何 SSH 访问面:不注入公钥,禁用并 mask ssh 服务', async () => {
    const { buildUserData } = await seedMod();
    const ud = buildUserData(FAKE_DAEMON);
    assert.ok(!ud.includes('ssh_authorized_keys'), 'no ssh keys injected');
    assert.ok(ud.includes('systemctl disable --now ssh.service ssh.socket'));
    assert.ok(ud.includes('systemctl mask ssh.service ssh.socket'));
    assert.ok(ud.includes('lock_passwd: true'));
  });

  it('systemd unit 要件齐全(agent 用户 + 显式 HOME + modprobe 兜底 + 自愈重启 + 开机启用)', async () => {
    const { buildUserData } = await seedMod();
    const ud = buildUserData(FAKE_DAEMON);
    assert.ok(ud.includes('User=agent'));
    assert.ok(ud.includes('Environment=HOME=/home/agent'), 'systemd 不给 system service 设 HOME,必须显式');
    assert.ok(ud.includes('ExecStartPre=-/sbin/modprobe vsock'));
    assert.ok(ud.includes('Restart=always'));
    assert.ok(ud.includes('systemctl enable --now codepilot-daemon.service'));
    assert.ok(ud.includes('WantedBy=multi-user.target'));
  });

  it('保留 growpart(M2 稀疏扩容后由它吃满)与 workspace 目录初始化', async () => {
    const { buildUserData } = await seedMod();
    const ud = buildUserData(FAKE_DAEMON);
    assert.ok(ud.includes('growpart:'));
    assert.ok(ud.includes('mkdir -p /home/agent/workspace /home/agent/bin /home/agent/sessions'));
    assert.ok(ud.includes('chown -R agent:agent /home/agent'));
  });
});

describe('cowork-seed: seedIsoPath(内容寻址)', () => {
  it('同输入确定性命名,不同输入不同哈希,带模板版本前缀', async () => {
    const { seedIsoPath, SEED_TEMPLATE_VERSION } = await seedMod();
    const a1 = seedIsoPath('content-a');
    const a2 = seedIsoPath('content-a');
    const b = seedIsoPath('content-b');
    assert.equal(a1, a2);
    assert.notEqual(a1, b);
    assert.ok(path.basename(a1).startsWith(`seed-codepilot-v${SEED_TEMPLATE_VERSION}-`));
    assert.ok(a1.endsWith('.iso'));
  });
});

describe('cowork-seed ↔ cowork-daemon.py 跨层锁定', () => {
  it('EXPECTED_DAEMON_VERSION 与 daemon 的 DAEMON_VERSION 一致(改 daemon 必同步 bump 两处 + SEED_TEMPLATE_VERSION)', async () => {
    const { EXPECTED_DAEMON_VERSION } = await seedMod();
    const daemonSrc = fs.readFileSync(DAEMON_PATH, 'utf8');
    const m = daemonSrc.match(/^DAEMON_VERSION = (\d+)$/m);
    assert.ok(m, 'daemon declares DAEMON_VERSION');
    assert.equal(Number(m![1]), EXPECTED_DAEMON_VERSION);
  });

  it('daemon 注册了 M1 新增的 installBinary op,且 health 上报 version/claude', async () => {
    const daemonSrc = fs.readFileSync(DAEMON_PATH, 'utf8');
    assert.ok(daemonSrc.includes('"installBinary": op_install_binary'));
    assert.ok(daemonSrc.includes('"version": DAEMON_VERSION'));
    assert.match(daemonSrc, /"claude": claude_ready/);
  });
});
