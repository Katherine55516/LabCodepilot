/**
 * cowork-seed.ts — cloud-init NoCloud seed 生成(镜像流水线 M1)。
 *
 * 定制不烘进托管镜像,而是首启自注入:把 guest daemon(base64 内嵌)+ systemd
 * unit 写进 user-data 的 write_files,runcmd 启用服务并关停 ssh。上游 Debian
 * 底镜保持原样(中科大源可下),宿主侧 SSH/scp provisioning 链整体退役——
 * 宿主从头到尾只碰 vsock,不再需要知道 VM 的 IP。
 *
 * 升级机制:cloud-init 的 write_files/runcmd 是 per-instance 语义(同
 * instance-id 不重跑)。SEED_TEMPLATE_VERSION 决定 instance-id,因此
 * **改 cowork-daemon.py 或本文件的 user-data 模板,必须 bump
 * SEED_TEMPLATE_VERSION**,已有磁盘才会在下次开机重跑 cloud-init 完成升级。
 * seed 文件名另带 user-data 内容哈希(内容寻址):模板/daemon 一变即生成新
 * ISO 并挂载,与 instance-id 语义解耦。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IMAGES_DIR, bundledCoworkResource } from './cowork-paths';

const execFileAsync = promisify(execFile);

// v2(M3):daemon v3 —— health 增加 claudeSize(guest binary 版本偏斜自愈)
export const SEED_TEMPLATE_VERSION = 2;

/**
 * guest daemon 版本的宿主侧期望值,必须与 cowork-daemon.py 的 DAEMON_VERSION
 * 一致(单测跨层断言)。provisionGuest 用它做运行时一致性哨兵。
 */
export const EXPECTED_DAEMON_VERSION = 3;

/** daemon 在 guest 内的落点(root 经 write_files 写入,agent 只读执行)。 */
export const GUEST_DAEMON_TARGET = '/opt/codepilot/cowork-daemon.py';

/** hostname 保持 POC 时代的值:vm-up.sh 的 `ip` 子命令(dev 调试)按它反查租约。 */
const GUEST_HOSTNAME = 'cowork-poc';

export function buildMetaData(): string {
  return `instance-id: codepilot-cowork-v${SEED_TEMPLATE_VERSION}\nlocal-hostname: ${GUEST_HOSTNAME}\n`;
}

/**
 * 生成 user-data(#cloud-config)。要点:
 * - agent 用户**无 ssh_authorized_keys**、lock_passwd —— 唯一访问面是 vsock daemon
 * - daemon base64 内嵌 write_files → /opt/codepilot/cowork-daemon.py(0755)
 * - systemd unit:User=agent + 显式 HOME(systemd 不给 system service 设 HOME,
 *   claude 子进程需要)+ modprobe vsock 兜底 + Restart=always
 * - runcmd:enable --now daemon;disable+mask ssh(服务与 socket 激活双堵,
 *   P3 攻击面收缩提前落袋)
 * - growpart 保留:M2 下载器把 raw 稀疏扩容后由它吃满
 */
export function buildUserData(daemonSource: string): string {
  const daemonB64 = Buffer.from(daemonSource, 'utf8').toString('base64');
  return `#cloud-config
users:
  - name: agent
    shell: /bin/bash
    lock_passwd: true
growpart:
  mode: auto
  devices: ['/']
write_files:
  - path: ${GUEST_DAEMON_TARGET}
    permissions: '0755'
    encoding: b64
    content: ${daemonB64}
  - path: /etc/systemd/system/codepilot-daemon.service
    permissions: '0644'
    content: |
      [Unit]
      Description=CodePilot cowork guest daemon (vsock RPC)
      After=local-fs.target

      [Service]
      User=agent
      Environment=HOME=/home/agent
      ExecStartPre=-/sbin/modprobe vsock
      ExecStartPre=-/sbin/modprobe vmw_vsock_virtio_transport
      ExecStart=/usr/bin/python3 ${GUEST_DAEMON_TARGET}
      Restart=always
      RestartSec=2

      [Install]
      WantedBy=multi-user.target
runcmd:
  - mkdir -p /home/agent/workspace /home/agent/bin /home/agent/sessions
  - chown -R agent:agent /home/agent
  - systemctl daemon-reload
  - systemctl enable --now codepilot-daemon.service
  - systemctl disable --now ssh.service ssh.socket 2>/dev/null || true
  - systemctl mask ssh.service ssh.socket 2>/dev/null || true
`;
}

/**
 * daemon 源码路径解析(M3 三级候选):随包 Resources/cowork/(打包版正道,
 * 去仓库绝对路径依赖)→ cowork_forwarder_path 同目录(遗留设置)→ 仓库路径(dev)。
 */
export function resolveDaemonSource(): string | null {
  const candidates: string[] = [];
  const bundled = bundledCoworkResource('cowork-daemon.py');
  if (bundled) candidates.push(bundled);
  try {
    const { getSetting } = require('./db') as typeof import('./db');
    const fwd = (getSetting('cowork_forwarder_path') || '').trim();
    if (fwd) candidates.push(path.join(path.dirname(fwd), 'cowork-daemon.py'));
  } catch { /* db not available */ }
  candidates.push(path.join(process.cwd(), 'scripts/poc/cowork/cowork-daemon.py'));
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/** 内容寻址的 seed 文件名:模板版本 + user-data sha256 前 8 位。 */
export function seedIsoPath(userData: string): string {
  const hash = crypto.createHash('sha256').update(userData).digest('hex').slice(0, 8);
  return path.join(IMAGES_DIR, `seed-codepilot-v${SEED_TEMPLATE_VERSION}-${hash}.iso`);
}

/**
 * 确保当前模板+daemon 对应的 seed ISO 存在,返回其路径(存在即复用)。
 * 用 macOS 自带 hdiutil makehybrid 造 ISO(NoCloud 要求卷标 cidata),零依赖。
 * 生成成功后清掉旧版本 seed(内容寻址,旧哈希文件已无用)。
 */
export async function ensureSeedIso(): Promise<string> {
  const daemonSrc = resolveDaemonSource();
  if (!daemonSrc) throw new Error('cowork daemon source not found on host — cannot build seed');
  const userData = buildUserData(fs.readFileSync(daemonSrc, 'utf8'));
  const iso = seedIsoPath(userData);
  if (fs.existsSync(iso)) return iso;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-seed-'));
  try {
    fs.writeFileSync(path.join(tmp, 'user-data'), userData);
    fs.writeFileSync(path.join(tmp, 'meta-data'), buildMetaData());
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    // 先出到临时名再原子 rename(保持 .iso 后缀,hdiutil 对无后缀路径会自行追加)
    const tmpIso = iso.replace(/\.iso$/, '.tmp.iso');
    fs.rmSync(tmpIso, { force: true });
    await execFileAsync('hdiutil', [
      'makehybrid', '-iso', '-joliet',
      '-default-volume-name', 'cidata',
      '-o', tmpIso, tmp,
    ], { timeout: 30_000 });
    fs.renameSync(tmpIso, iso);
    // 清旧 seed(best-effort):同前缀不同哈希/版本的生成产物
    try {
      for (const name of fs.readdirSync(IMAGES_DIR)) {
        if (name.startsWith('seed-codepilot-') && name.endsWith('.iso') && path.join(IMAGES_DIR, name) !== iso) {
          fs.rmSync(path.join(IMAGES_DIR, name), { force: true });
        }
      }
    } catch { /* ignore */ }
    return iso;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
