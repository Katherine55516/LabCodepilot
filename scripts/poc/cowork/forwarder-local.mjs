#!/usr/bin/env node
/**
 * Cowork POC — Step A 本地转发器。
 *
 * SDK 把本脚本当作 claude 可执行文件 spawn。本脚本不 exec 替换进程,
 * 而是刻意用「子进程 + 管道逐字节转发」的拓扑运行本机 darwin claude,
 * 与 Step B 的 SSH/vsock 跨 VM 转发同构 —— 验证 SDK 对中间转发层的
 * 容忍度(argv 透传 / stdin/stdout 字节流 / stderr / 退出码 / 信号)。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

function resolveDarwinClaude() {
  const pkgJson = require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/package.json', {
    paths: [new URL('../../../', import.meta.url).pathname],
  });
  return pkgJson.replace(/package\.json$/, 'claude');
}

const target = process.env.POC_CLAUDE_BIN || resolveDarwinClaude();
if (!fs.existsSync(target)) {
  process.stderr.write(`[forwarder] target binary not found: ${target}\n`);
  process.exit(127);
}

const args = process.argv.slice(2);
fs.appendFileSync('/tmp/cowork-poc-forwarder.log',
  `${new Date().toISOString()} spawn ${target}\n  argv: ${JSON.stringify(args)}\n  cwd: ${process.cwd()}\n`);

const child = spawn(target, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
  cwd: process.cwd(),
});

process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => child.kill(sig));
}
child.on('exit', (code, signal) => {
  fs.appendFileSync('/tmp/cowork-poc-forwarder.log',
    `${new Date().toISOString()} exit code=${code} signal=${signal}\n`);
  process.exit(code ?? 1);
});
