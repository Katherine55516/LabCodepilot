import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const seedMod = () => import(path.resolve(__dirname, '../../lib/cowork-seed.ts'));
const DAEMON_PATH = path.resolve(__dirname, '../../../scripts/poc/cowork/cowork-daemon.py');

describe('cowork-seed: buildMetaData', () => {
  it('instance-id 带模板版本;内容哈希可选(P3-A 起内容寻址:daemon 一改即重灌)', async () => {
    const { buildMetaData, SEED_TEMPLATE_VERSION } = await seedMod();
    // 无 hash(向后兼容形态)
    assert.match(buildMetaData(), new RegExp(`^instance-id: codepilot-cowork-v${SEED_TEMPLATE_VERSION}$`, 'm'));
    assert.match(buildMetaData(), /^local-hostname: cowork-poc$/m);
    // 带 hash → instance-id 含它 → 内容不同即触发 cloud-init 重灌
    assert.match(buildMetaData('deadbeef'), new RegExp(`^instance-id: codepilot-cowork-v${SEED_TEMPLATE_VERSION}-deadbeef$`, 'm'));
    assert.notEqual(buildMetaData('aaaa1111'), buildMetaData('bbbb2222'));
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

  it('systemd unit 要件齐全(P3-A: root 用户 + 显式 HOME + modprobe 兜底 + 自愈重启 + 开机启用)', async () => {
    const { buildUserData } = await seedMod();
    const ud = buildUserData(FAKE_DAEMON);
    // P3-A:daemon 须 root(useradd + exec setuid 降权);绝不能退回 User=agent(会话隔离失效)
    assert.ok(ud.includes('User=root'), 'P3-A: daemon 须 root 才能 setuid 降权到会话专属用户');
    assert.ok(!ud.includes('User=agent'), 'P3-A: 绝不能留 User=agent(每会话隔离会静默失效)');
    assert.ok(ud.includes('Environment=HOME=/home/agent'), 'systemd 不给 system service 设 HOME,必须显式');
    assert.ok(ud.includes('ExecStartPre=-/sbin/modprobe vsock'));
    assert.ok(ud.includes('Restart=always'));
    assert.ok(ud.includes('systemctl enable codepilot-daemon.service'));
    // P3-A:升级重灌必须 restart(非 enable --now no-op)才能加载 User=root 新配置
    assert.ok(ud.includes('systemctl restart codepilot-daemon.service'));
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

  it('P3-A: daemon exec 以会话专属用户降权(user=/group=),会话清理带 userdel', async () => {
    const daemonSrc = fs.readFileSync(DAEMON_PATH, 'utf8');
    // exec 必须 setuid 降权(否则所有会话共用 agent,隔离失效)
    assert.match(daemonSrc, /user=name, group=name/);
    assert.ok(daemonSrc.includes('def ensure_session_user'));
    assert.ok(daemonSrc.includes('def prepare_session_fs'));
    // 会话目录 700 阻断兄弟会话穿越
    assert.match(daemonSrc, /os\.chmod\(base, 0o700\)/);
    // 会话用户随会话删 + 孤儿对账清(防 uid 累积)
    assert.ok(daemonSrc.includes('delete_session_user'));
  });
});
