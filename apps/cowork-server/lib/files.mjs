/**
 * 文件通道(R2)—— 服务端直读会话 volume,会话容器不用醒。
 *
 * 每个 op 起一个短命 helper 容器(--rm,秒级),把会话 volume 挂到 /ws 读写:
 * 不依赖 docker 宿主路径(/var/lib/docker/volumes 需 root 且绑 storage driver),
 * 只用已有的 docker 权限;顺带零成本硬化(--network none / cap-drop / no-new-privileges)。
 * helper 用 python one-liner(镜像本就为 shim 依赖 python3),语义逐条复刻
 * cowork-daemon.py 的 op_write_file / op_list_files / op_read_file / op_archive:
 *   - path 对外统一沙箱视角绝对路径 /workspace/...(与 VmArtifact.path、shim cwd 一致)
 *   - list:递归全量(含 dotfiles),mtime 毫秒,按 name 排序
 *   - read:容器内 realpath 权威校验(exit 4=越权 / exit 3=不存在),首行 size + 裸字节
 *   - archive:tar.gz(arcname='.'),先落服务端临时文件取 size 再流式回
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENT_UID, IMAGE, ensureVolume, volumeExists, volumeName } from './orchestrator.mjs';

const WORKSPACE = '/workspace';
// 与 daemon SAFE_NAME_RE 一致:字母数字._- 与 CJK 之外全替换为 _
const SAFE_NAME_RE = /[^a-zA-Z0-9._一-鿿-]/g;

function helperArgs(sid, { ro = true, stdin = false, user = AGENT_UID } = {}) {
  return [
    'run', '--rm', ...(stdin ? ['-i'] : []),
    '--network', 'none',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    ...(user ? ['--user', `${user}:${user}`] : []),
    '-v', `${volumeName(sid)}:/ws${ro ? ':ro' : ''}`,
    IMAGE, 'python3', '-c',
  ];
}

/** /workspace/... → /ws/...(helper 容器内挂载点)。仅接受工作区内路径。 */
function toHelperPath(vmPath) {
  if (vmPath !== WORKSPACE && !vmPath.startsWith(WORKSPACE + '/')) {
    throw new Error('path escapes session workspace');
  }
  if (vmPath.includes('\0')) throw new Error('invalid path');
  return '/ws' + vmPath.slice(WORKSPACE.length);
}

const PY_WRITE = `
import os, sys
dest, expect = sys.argv[1], int(sys.argv[2])
tmp = dest + '.part'
n = 0
with open(tmp, 'wb') as f:
    while True:
        chunk = sys.stdin.buffer.read(65536)
        if not chunk:
            break
        f.write(chunk)
        n += len(chunk)
if expect >= 0 and n != expect:
    os.remove(tmp)
    sys.exit(5)
os.replace(tmp, dest)
`;

const PY_LIST = `
import json, os, sys
since = int(sys.argv[1])
files = []
if os.path.isdir('/ws'):
    for root, _dirs, names in os.walk('/ws'):
        for n in names:
            p = os.path.join(root, n)
            try:
                st = os.stat(p)
            except OSError:
                continue
            m = int(st.st_mtime * 1000)
            if m >= since:
                files.append({"path": '/workspace' + p[3:], "name": n, "size": st.st_size, "mtime": m})
files.sort(key=lambda f: f["name"])
sys.stdout.write(json.dumps(files))
`;

const PY_READ = `
import os, shutil, sys
real = os.path.realpath(sys.argv[1])
if real != '/ws' and not real.startswith('/ws/'):
    sys.exit(4)
if not os.path.isfile(real):
    sys.exit(3)
out = sys.stdout.buffer
out.write((str(os.path.getsize(real)) + "\\n").encode())
with open(real, 'rb') as f:
    shutil.copyfileobj(f, out)
`;

const PY_ARCHIVE = `
import sys, tarfile
t = tarfile.open(fileobj=sys.stdout.buffer, mode='w|gz')
t.add('/ws', arcname='.')
t.close()
`;

function runHelper(sid, script, scriptArgs, opts) {
  const child = spawn('docker', [...helperArgs(sid, opts), script, ...scriptArgs], {
    stdio: [opts?.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  const exit = new Promise((resolve) => child.on('close', (code) => resolve({ code, stderr })));
  return { child, exit };
}

/**
 * 写一个文件进会话 workspace 根(daemon op_write_file 语义:basename + 清洗,不接受子目录)。
 * source 是可读流(HTTP 请求体直灌 helper stdin,大文件不进内存);expectedSize 来自
 * Content-Length(-1=未知):helper 写 .part + 字节数校验 + 原子 rename —— 客户端中途
 * 断连(EOF 早到,字节数对不上)不会留下半截文件。返回沙箱内绝对路径。
 */
export async function writeFile(sid, fileName, source, expectedSize = -1) {
  await ensureVolume(sid);
  const safe = path.basename(fileName || 'file').replace(SAFE_NAME_RE, '_') || 'file';
  const { child, exit } = runHelper(sid, PY_WRITE, [`/ws/${safe}`, String(Math.trunc(expectedSize))], { ro: false, stdin: true });
  child.stdin.on('error', () => { /* EPIPE:helper 先退 */ });
  source.pipe(child.stdin);
  source.on('error', () => { try { child.stdin.destroy(); } catch { /* ignore */ } });
  const { code, stderr } = await exit;
  if (code === 5) throw new Error('upload truncated (size mismatch)');
  if (code !== 0) throw new Error(`write helper exit ${code}: ${stderr.slice(0, 200)}`);
  return `${WORKSPACE}/${safe}`;
}

/** 列出 workspace 中 mtime >= sinceMs 的全部文件(daemon op_list_files 语义)。 */
export async function listFiles(sid, sinceMs) {
  if (!(await volumeExists(sid))) return [];
  const { child, exit } = runHelper(sid, PY_LIST, [String(Math.max(0, Math.trunc(sinceMs || 0)))]);
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  const { code, stderr } = await exit;
  if (code !== 0) throw new Error(`list helper exit ${code}: ${stderr.slice(0, 200)}`);
  return JSON.parse(out);
}

/**
 * 读单个文件:返回 { size, stream }。文件缺失/越权分别抛带 "No such file" / "escapes"
 * 的错误(调用侧据此回 404/403)。helper 首行是 size,其后裸字节。
 */
export async function readFile(sid, vmPath) {
  const helperPath = toHelperPath(vmPath);
  if (!(await volumeExists(sid))) throw new Error(`No such file: ${vmPath}`);
  const { child, exit } = runHelper(sid, PY_READ, [helperPath]);
  return await new Promise((resolve, reject) => {
    let header = Buffer.alloc(0);
    let settled = false;
    const onData = (chunk) => {
      header = Buffer.concat([header, chunk]);
      const nl = header.indexOf(0x0a);
      if (nl === -1) return; // size 行还没齐
      settled = true;
      child.stdout.off('data', onData);
      const size = parseInt(header.subarray(0, nl).toString(), 10);
      const rest = header.subarray(nl + 1);
      child.stdout.pause();
      if (rest.length) child.stdout.unshift(rest);
      resolve({ size, stream: child.stdout });
    };
    child.stdout.on('data', onData);
    exit.then(({ code, stderr }) => {
      if (settled) return;
      if (code === 3) reject(new Error(`No such file: ${vmPath}`));
      else if (code === 4) reject(new Error('path escapes session workspace'));
      else reject(new Error(`read helper exit ${code}: ${stderr.slice(0, 200)}`));
    });
  });
}

/**
 * 打包整个 workspace 为 tar.gz:helper 流到服务端临时文件(拿到确切 size,复刻 daemon
 * op_archive),返回 { size, stream, cleanup }。调用侧流完(或失败)必须 cleanup()。
 */
export async function archive(sid) {
  if (!(await volumeExists(sid))) throw new Error(`No such file: workspace of ${sid}`);
  const tmp = path.join(os.tmpdir(), `cowork-archive-${sid}-${process.pid}.tgz`);
  const cleanup = () => { fs.unlink(tmp, () => {}); };
  const { child, exit } = runHelper(sid, PY_ARCHIVE, []);
  try {
    await new Promise((resolve, reject) => {
      const sink = fs.createWriteStream(tmp);
      child.stdout.pipe(sink);
      sink.on('finish', resolve);
      sink.on('error', reject);
    });
    const { code, stderr } = await exit;
    if (code !== 0) throw new Error(`archive helper exit ${code}: ${stderr.slice(0, 200)}`);
    const size = (await fs.promises.stat(tmp)).size;
    const stream = fs.createReadStream(tmp);
    return { size, stream, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}
