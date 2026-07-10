#!/usr/bin/env node
/**
 * Cowork POC — SDK 探针。
 *
 * 用 Agent SDK 的 query() 打一条真实消息流,pathToClaudeCodeExecutable
 * 指向转发器,验证:init 握手 / assistant 消息 / 工具调用(写+读文件)/
 * result 全链路经转发层无损;--abort 模式验证中断 kill 链。
 *
 * 用法:
 *   node scripts/poc/cowork/sdk-probe.mjs <forwarder-path> [--abort]
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const forwarder = process.argv[2];
const abortMode = process.argv.includes('--abort');
if (!forwarder || !fs.existsSync(forwarder)) {
  console.error('usage: node sdk-probe.mjs <forwarder-path> [--abort]');
  process.exit(2);
}

const workspace = process.env.POC_WORKSPACE || fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-poc-ws-'));
fs.mkdirSync(workspace, { recursive: true });
const marker = `poc-${Date.now()}`;

const abortController = new AbortController();
const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

console.log(`[probe] workspace=${workspace} marker=${marker} abort=${abortMode}`);

const q = query({
  prompt: `Create a file named ${marker}.txt containing exactly "hello-through-the-bridge", then read it back with the Read tool and tell me its content. Do nothing else.`,
  options: {
    pathToClaudeCodeExecutable: forwarder,
    cwd: workspace,
    model: process.env.POC_MODEL || 'claude-haiku-4-5-20251001',
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 6,
    abortController,
    stderr: (d) => {
      const line = String(d).trim();
      if (line) console.error(`[cli-stderr ${stamp()}] ${line.slice(0, 300)}`);
    },
  },
});

if (abortMode) {
  setTimeout(() => {
    console.log(`[probe ${stamp()}] firing abort()`);
    abortController.abort();
  }, 5000);
}

let sawInit = false;
let sawToolUse = 0;
let resultMsg = null;

try {
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      sawInit = true;
      console.log(`[msg ${stamp()}] system:init model=${msg.model} cwd=${msg.cwd} tools=${(msg.tools || []).length}`);
    } else if (msg.type === 'assistant') {
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          sawToolUse++;
          console.log(`[msg ${stamp()}] tool_use ${block.name} ${JSON.stringify(block.input).slice(0, 140)}`);
        } else if (block.type === 'text') {
          console.log(`[msg ${stamp()}] assistant: ${block.text.slice(0, 160)}`);
        }
      }
    } else if (msg.type === 'result') {
      resultMsg = msg;
      console.log(`[msg ${stamp()}] result subtype=${msg.subtype} turns=${msg.num_turns} cost=${msg.total_cost_usd}`);
    } else {
      console.log(`[msg ${stamp()}] ${msg.type}${msg.subtype ? ':' + msg.subtype : ''}`);
    }
  }
} catch (err) {
  console.log(`[probe ${stamp()}] iteration ended: ${err.constructor.name}: ${String(err.message).slice(0, 200)}`);
}

const expectedFile = path.join(workspace, `${marker}.txt`);
const fileOnHost = fs.existsSync(expectedFile) && fs.readFileSync(expectedFile, 'utf8').includes('hello-through-the-bridge');
const remoteMode = process.env.POC_EXPECT_REMOTE === '1';

console.log('--- verdict ---');
console.log(`init handshake : ${sawInit ? 'PASS' : 'FAIL'}`);
if (abortMode) {
  console.log(`abort          : ${resultMsg == null || resultMsg.subtype !== 'success' ? 'PASS (no success result after abort)' : 'FAIL'}`);
} else if (remoteMode) {
  // 远端(VM)模式:文件必须落在 VM 内、且不得出现在宿主 —— 宿主缺席即隔离生效
  console.log(`tool_use seen  : ${sawToolUse >= 2 ? 'PASS' : `FAIL (${sawToolUse})`}`);
  console.log(`host isolation : ${!fileOnHost ? 'PASS (file NOT on host)' : 'FAIL (file leaked to host!)'}`);
  if (process.env.POC_REMOTE_CHECK) {
    const { execSync } = await import('node:child_process');
    try {
      const remote = execSync(`${process.env.POC_REMOTE_CHECK} 'cat ~/workspace/${marker}.txt'`, { encoding: 'utf8', timeout: 15000 });
      console.log(`file in VM     : ${remote.includes('hello-through-the-bridge') ? 'PASS' : `FAIL (${remote.slice(0, 60)})`}`);
    } catch (e) {
      console.log(`file in VM     : FAIL (${String(e.message).slice(0, 80)})`);
    }
  }
  console.log(`result success : ${resultMsg?.subtype === 'success' ? 'PASS' : `FAIL (${resultMsg?.subtype})`}`);
} else {
  console.log(`tool_use seen  : ${sawToolUse >= 2 ? 'PASS' : `FAIL (${sawToolUse})`}`);
  console.log(`file written   : ${fileOnHost ? 'PASS' : 'FAIL'} (${expectedFile})`);
  console.log(`result success : ${resultMsg?.subtype === 'success' ? 'PASS' : `FAIL (${resultMsg?.subtype})`}`);
}
