/**
 * cowork-paths.ts — 沙箱资产/运行时路径的单一事实源(镜像流水线 M3)。
 *
 * 两件事:
 * 1. **资产目录正式化**:`~/.codepilot/cowork-poc/`(POC 时代命名)→
 *    `~/.codepilot/cowork-assets/`。首次触达时一次性 renameSync 迁移(同卷
 *    原子;目录里的 vsock socket / pidfile / 打开的 fd 随 rename 平移,运行中
 *    的 VM 不受影响)。两目录并存时用新目录并告警(不动老目录)。
 * 2. **随包资源解析**:打包版经 `AILAB_RESOURCES_PATH`(main.ts fork server 时
 *    注入 = process.resourcesPath)定位 Resources/cowork/ 下随包分发的
 *    daemon/forwarder/vfkit;dev 无此 env → 调用方回退仓库路径/PATH。
 *
 * 注意:本模块是 server-only(import 即做 fs 探测),绝不能被客户端组件引用。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const NEW_ROOT = path.join(os.homedir(), '.codepilot', 'cowork-assets');
const LEGACY_ROOT = path.join(os.homedir(), '.codepilot', 'cowork-poc');

function resolveRoot(): string {
  try {
    const hasNew = fs.existsSync(NEW_ROOT);
    const hasLegacy = fs.existsSync(LEGACY_ROOT);
    if (!hasNew && hasLegacy) {
      fs.renameSync(LEGACY_ROOT, NEW_ROOT);
      console.log('[cowork-paths] migrated assets dir: cowork-poc → cowork-assets');
    } else if (hasNew && hasLegacy) {
      console.warn('[cowork-paths] both cowork-assets and legacy cowork-poc exist — using cowork-assets (legacy dir left untouched)');
    }
  } catch (err) {
    // 迁移失败(权限/占用等):老目录还在就继续用老的,绝不因迁移丢可用性
    console.warn('[cowork-paths] assets dir migration failed (non-fatal):', err instanceof Error ? err.message : err);
    if (fs.existsSync(LEGACY_ROOT)) return LEGACY_ROOT;
  }
  return NEW_ROOT;
}

/** 资产根目录(迁移在模块首次加载时完成一次,幂等)。 */
export const COWORK_ROOT = resolveRoot();

export const IMAGES_DIR = path.join(COWORK_ROOT, 'images');
/** 底镜规范路径(文件名不带 build 后缀,升级=原子替换)。 */
export const IMAGE_PATH = path.join(IMAGES_DIR, 'debian-12-genericcloud-arm64.raw');
/** 底镜已装版本戳(build/sha512;legacy 无戳时按当前 manifest 懒栽种)。 */
export const IMAGE_MARKER_PATH = path.join(IMAGES_DIR, 'installed-image.json');
/** claude linux binary 规范路径。 */
export const CLAUDE_BIN_PATH = path.join(COWORK_ROOT, 'bin', 'package', 'claude');
/** claude binary 已装版本戳。 */
export const CLAUDE_MARKER_PATH = path.join(COWORK_ROOT, 'bin', 'package', 'installed-claude.json');
export const EFI_STORE_PATH = path.join(COWORK_ROOT, 'efi-variable-store');
export const VFKIT_PID_FILE = path.join(COWORK_ROOT, 'vfkit.pid');
export const CONSOLE_LOG_PATH = path.join(COWORK_ROOT, 'vm-console.log');
export const VSOCK_SOCKET_PATH = path.join(COWORK_ROOT, 'vsock-1024.sock');

/**
 * 随包分发的 cowork 资源(Resources/cowork/<name>)。打包版返回绝对路径,
 * dev(无 AILAB_RESOURCES_PATH)或文件缺失返回 null,调用方走回退链。
 */
export function bundledCoworkResource(name: string): string | null {
  const base = (process.env.AILAB_RESOURCES_PATH || '').trim();
  if (!base) return null;
  const p = path.join(base, 'cowork', name);
  return fs.existsSync(p) ? p : null;
}

/**
 * vfkit 可执行文件:随包 bin/vfkit 优先(M3 内置,免 brew 前置),
 * 回退 PATH 里的 vfkit(dev / brew)。
 */
export function vfkitBin(): string {
  return bundledCoworkResource(path.join('bin', 'vfkit')) || 'vfkit';
}
