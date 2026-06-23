#!/usr/bin/env node
/**
 * POC: MCP 市场核心假设验证（Phase 0）
 *
 * 验证两件事——整个功能成立与否就压在这两点上：
 *   A. 确定性映射：官方 Registry 的 server.json 能否无歧义地转成本应用的 MCPServerConfig
 *   B. 内置二进制能否真的拉起映射出来的 server（用 `claude mcp list` 的健康检查）
 *
 * 安全纪律：
 *   - Part B 只在「临时 HOME + 临时 .mcp.json」里跑，绝不读写用户真实的 ~/.claude.json
 *   - Part B 只 spawn 官方参考 server（Anthropic 发布、纯本地、无密钥、无外网）
 *
 * 用法：node scripts/poc-mcp-marketplace.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0.1/servers';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE_BIN = path.join(
  REPO_ROOT,
  'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
);

// ────────────────────────────────────────────────────────────────────────
// 映射器（这是将来要晋升到 src/lib/server-json-mapper.ts 的核心逻辑）
// ────────────────────────────────────────────────────────────────────────

/** runtimeHint 经常缺失，必须按 registryType 兜底运行器。 */
const DEFAULT_RUNNER = { npm: 'npx', pypi: 'uvx', oci: 'docker', nuget: 'dnx' };

function slugify(name) {
  return name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** 把 server.json 的 runtimeArguments / packageArguments 展平成 argv 片段。 */
function flattenArgs(decls) {
  const out = [];
  for (const a of decls || []) {
    if (a.type === 'named') {
      if (a.name) out.push(a.name);
      const v = a.value ?? a.default;
      if (v !== undefined && v !== null && v !== '') out.push(String(v));
    } else {
      // positional（或未标 type）
      const v = a.value ?? a.default ?? a.valueHint;
      if (v !== undefined && v !== null && v !== '') out.push(String(v));
    }
  }
  return out;
}

/** npm/pypi 的包标识：identifier(@version)，version 为 latest/缺失时不钉。 */
function packageSpec(pkg) {
  const v = pkg.version;
  if (!v || v === 'latest') return pkg.identifier;
  return `${pkg.identifier}@${v}`;
}

/**
 * 解析输入声明（env / headers）→ 可写入 MCPServerConfig 的键值对。
 * 密钥（isSecret）只产出 ${占位符}，明文走钥匙串/DB（POC 里仅演示占位符形态）。
 */
function resolveInputs(decls, serverSlug, kind) {
  const out = {};
  const secretKeys = [];
  for (const d of decls || []) {
    const name = d.name;
    if (!name) continue;
    if (d.isSecret) {
      const key = `mcp_${serverSlug}_${name}`;
      out[name] = '${' + key + '}';
      secretKeys.push(key);
    } else if (d.default !== undefined) {
      out[name] = String(d.default);
    } else {
      // 必填非密：安装表单收集；POC 里用占位符标注
      out[name] = d.isRequired ? `<REQUIRED:${name}>` : '';
    }
  }
  return { values: out, secretKeys };
}

/** docker 需要显式把环境变量转发进容器：-e NAME。 */
function dockerEnvFlags(envDecls) {
  const flags = [];
  for (const d of envDecls || []) {
    if (d.name) flags.push('-e', d.name);
  }
  return flags;
}

/**
 * 核心转换：server.json + 选择（哪个 package / 远程偏好）→ { name, config, notes }
 * config 形如本应用 MCPServerConfig：{ command, args, env, type, url, headers }
 */
function mapServerJson(server, opts = {}) {
  const slug = slugify(server.name);
  const notes = [];
  const secretKeys = [];

  const packages = server.packages || [];
  const remotes = server.remotes || [];

  // 优先本地 package（除非 opts.prefer === 'remote'），与多数客户端默认一致
  const useRemote = opts.prefer === 'remote' || packages.length === 0;

  if (!useRemote && packages.length > 0) {
    const pkg = packages[opts.packageIndex || 0];
    const runner = pkg.runtimeHint || DEFAULT_RUNNER[pkg.registryType];
    if (!runner) notes.push(`未知 registryType=${pkg.registryType}，无默认运行器`);

    let args = [];
    const env = {};

    if (pkg.registryType === 'oci') {
      // docker run -i --rm [-e NAME...] <image-with-tag> [packageArguments]
      args = [
        'run', '-i', '--rm',
        ...dockerEnvFlags(pkg.environmentVariables),
        ...flattenArgs(pkg.runtimeArguments),
        pkg.identifier, // OCI identifier 已含完整镜像引用 + tag
        ...flattenArgs(pkg.packageArguments),
      ];
    } else {
      const runtimeArgs = flattenArgs(pkg.runtimeArguments);
      // npx 非交互必须 -y，否则首次下载会卡在确认提示
      if (runner === 'npx' && !runtimeArgs.some((a) => a === '-y' || a === '--yes')) {
        runtimeArgs.unshift('-y');
      }
      args = [...runtimeArgs, packageSpec(pkg), ...flattenArgs(pkg.packageArguments)];
    }

    // 环境变量（OCI 与 stdio 同样适用：值挂在 docker 进程上，-e 转发进容器）
    const resolved = resolveInputs(pkg.environmentVariables, slug, 'env');
    Object.assign(env, resolved.values);
    secretKeys.push(...resolved.secretKeys);

    const config = { command: runner, args };
    if (Object.keys(env).length > 0) config.env = env;
    // 与现有 McpServerEditor 约定一致：stdio 不写 type
    return { name: server.name, slug, config, notes, secretKeys, kind: 'stdio' };
  }

  // 远程：优先 streamable-http（http），退回 sse
  if (remotes.length > 0) {
    const sorted = [...remotes].sort(
      (a, b) => (a.type === 'streamable-http' ? -1 : 1) - (b.type === 'streamable-http' ? -1 : 1),
    );
    const r = sorted[0];
    const config = {
      type: r.type === 'sse' ? 'sse' : 'http',
      url: r.url,
    };
    const resolved = resolveInputs(r.headers, slug, 'header');
    if (Object.keys(resolved.values).length > 0) config.headers = resolved.values;
    secretKeys.push(...resolved.secretKeys);
    if (/\{[a-zA-Z0-9_]+\}/.test(r.url)) {
      notes.push(`URL 含模板变量 ${r.url.match(/\{[a-zA-Z0-9_]+\}/g).join(',')}，需安装表单填充`);
    }
    return { name: server.name, slug, config, notes, secretKeys, kind: 'remote' };
  }

  return { name: server.name, slug, config: null, notes: ['既无 packages 也无 remotes'], secretKeys, kind: 'none' };
}

// ────────────────────────────────────────────────────────────────────────
// Part A — 纯映射验证（不执行任何代码）
// ────────────────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'ainativelab-poc/0.1' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function pick(items, pred) {
  return items.find(pred);
}

async function partA() {
  console.log('\n========================================================');
  console.log('Part A — server.json → MCPServerConfig 确定性映射验证');
  console.log('========================================================\n');

  const data = await fetchJson(`${REGISTRY}?limit=100`);
  const items = (data.servers || []).map((x) => x.server).filter(Boolean);
  console.log(`拉取 ${items.length} 条 registry 条目\n`);

  const withPkg = items.filter((s) => (s.packages || []).length > 0);
  const withRemote = items.filter((s) => (s.remotes || []).length > 0);

  const samples = [
    ['NPM + 密钥env', pick(withPkg, (s) => s.packages.some((p) => p.registryType === 'npm' && (p.environmentVariables || []).length))],
    ['NPM 基础', pick(withPkg, (s) => s.packages.some((p) => p.registryType === 'npm' && !(p.environmentVariables || []).length))],
    ['PyPI', pick(withPkg, (s) => s.packages.some((p) => p.registryType === 'pypi'))],
    ['OCI + 密钥env', pick(withPkg, (s) => s.packages.some((p) => p.registryType === 'oci'))],
    ['远程 streamable-http', pick(withRemote, (s) => s.remotes.some((r) => r.type === 'streamable-http'))],
    ['远程 + headers', pick(withRemote, (s) => s.remotes.some((r) => (r.headers || []).length))],
  ];

  let mapped = 0;
  let failed = 0;
  for (const [label, server] of samples) {
    console.log(`────── ${label} ──────`);
    if (!server) {
      console.log('  (本批 100 条样本中无此类)\n');
      continue;
    }
    const result = mapServerJson(server);
    const ok = result.config && (result.config.command || result.config.url);
    if (ok) mapped++;
    else failed++;
    console.log(`  name: ${server.name}  v${server.version}`);
    console.log(`  → ${ok ? '✓' : '✗'} config: ${JSON.stringify(result.config)}`);
    if (result.secretKeys.length) console.log(`  → 密钥占位符: ${result.secretKeys.join(', ')}`);
    if (result.notes.length) console.log(`  → 注意: ${result.notes.join('; ')}`);
    console.log('');
  }
  console.log(`Part A 小结：成功映射 ${mapped} 类，失败 ${failed} 类\n`);
  return { mapped, failed };
}

// ────────────────────────────────────────────────────────────────────────
// Part B — 内置二进制真实拉起（隔离 + 仅安全官方 server）
// ────────────────────────────────────────────────────────────────────────

/** 给已知安全的官方参考包构造 registry 形态的 server.json，过同一个映射器。 */
const SAFE_TARGETS = [
  {
    name: 'io.poc/everything',
    version: '2025.1.1',
    packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-everything', transport: { type: 'stdio' } }],
  },
  {
    name: 'io.poc/sequentialthinking',
    version: '2025.1.1',
    packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-sequential-thinking', transport: { type: 'stdio' } }],
  },
  {
    name: 'io.poc/time',
    version: '2025.1.1',
    packages: [{ registryType: 'pypi', identifier: 'mcp-server-time', transport: { type: 'stdio' } }],
  },
];

function runClaude(args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: -1, out, err: err + '\n[POC] 超时被杀', timedOut: true });
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err, timedOut: false });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: err + '\n[POC] spawn 失败: ' + e.message, timedOut: false });
    });
  });
}

async function partB() {
  console.log('\n========================================================');
  console.log('Part B — 内置 claude 二进制真实拉起（隔离临时环境）');
  console.log('========================================================\n');

  // 构造 .mcp.json（用同一个映射器产出配置）
  const mcpServers = {};
  for (const t of SAFE_TARGETS) {
    const r = mapServerJson(t);
    // .mcp.json 的 key 用短名
    const shortName = t.name.split('/').pop();
    mcpServers[shortName] = r.config;
    console.log(`  映射 ${shortName}: ${JSON.stringify(r.config)}`);
  }

  // 隔离：临时 HOME + 临时 cwd，确保只看见我们写的 .mcp.json，绝不碰真实 ~/.claude.json
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'mcp-poc-home-'));
  const tmpProj = mkdtempSync(path.join(tmpdir(), 'mcp-poc-proj-'));
  mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  writeFileSync(path.join(tmpProj, '.mcp.json'), JSON.stringify({ mcpServers }, null, 2));
  // 预批准项目级 server，避免 trust 拦截（list/get 本身会跳过 trust dialog，双保险）
  writeFileSync(
    path.join(tmpHome, '.claude.json'),
    JSON.stringify({ projects: { [tmpProj]: { hasTrustDialogAccepted: true, enabledMcpjsonServers: Object.keys(mcpServers) } } }, null, 2),
  );

  // 持久包缓存：跨「冷/暖」两遍复用，用来区分「冷启动下载超时」与「真映射错误」。
  // 故意不清理，便于复跑；HOME 仍隔离（不碰真实 ~/.claude.json）。
  const persistCache = path.join(tmpdir(), 'mcp-poc-cache');
  mkdirSync(path.join(persistCache, 'npm'), { recursive: true });
  mkdirSync(path.join(persistCache, 'uv'), { recursive: true });

  console.log(`\n  临时 HOME : ${tmpHome}`);
  console.log(`  临时项目  : ${tmpProj}`);
  console.log(`  持久缓存  : ${persistCache}（冷/暖两遍复用）`);
  console.log('  运行: claude mcp list ×2（pass1=冷，pass2=暖）\n');

  const env = {
    ...process.env,
    HOME: tmpHome,
    npm_config_cache: path.join(persistCache, 'npm'),
    UV_CACHE_DIR: path.join(persistCache, 'uv'),
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CI: '1',
  };

  const parseVerdict = (text) => {
    const v = {};
    for (const shortName of Object.keys(mcpServers)) {
      const re = new RegExp(`${shortName}[^\\n]*`, 'i');
      const line = (text.match(re) || [])[0] || '';
      v[shortName] = /✓|connected|healthy/i.test(line)
        ? 'connected'
        : /✗|✘|fail|error|disconnect/i.test(line)
          ? 'failed'
          : 'unknown';
    }
    return v;
  };

  let verdict = {};
  for (let pass = 1; pass <= 2; pass++) {
    const label = pass === 1 ? '冷启动' : '暖缓存';
    console.log(`\n══════ pass ${pass} (${label}) ══════`);
    const res = await runClaude(['mcp', 'list'], { cwd: tmpProj, env, timeoutMs: 180000 });
    console.log(res.out || '(stdout 空)');
    if (res.err.trim()) console.log('[stderr] ' + res.err.slice(0, 1200));
    verdict = parseVerdict(res.out + '\n' + res.err);
    console.log(`判定: ${JSON.stringify(verdict)}`);
    const allConn = Object.values(verdict).every((x) => x === 'connected');
    if (allConn) { console.log('  → 全部连接成功，无需第二遍'); break; }
  }

  // 仅清理临时 HOME / 项目；保留包缓存
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  try { rmSync(tmpProj, { recursive: true, force: true }); } catch {}
  console.log('\n  已清理临时 HOME/项目（保留包缓存）\n');

  return { verdict };
}

// ────────────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2] || 'all';
  let a, b;
  if (mode === 'all' || mode === 'a') a = await partA();
  if (mode === 'all' || mode === 'b') b = await partB();

  console.log('\n========================================================');
  console.log('POC 总结');
  console.log('========================================================');
  if (a) console.log(`Part A 映射: ${a.mapped} 成功 / ${a.failed} 失败`);
  if (b) {
    const conn = Object.values(b.verdict).filter((v) => v === 'connected').length;
    console.log(`Part B 拉起: ${conn}/${Object.keys(b.verdict).length} 个安全 server 连接成功`);
    console.log(`           明细 ${JSON.stringify(b.verdict)}`);
  }
}

main().catch((e) => {
  console.error('POC 失败:', e);
  process.exit(1);
});
