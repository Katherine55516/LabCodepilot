#!/usr/bin/env node
/**
 * 手工触发一次定时任务 —— P2 的验收工具,也是日后排障时"绕开调度器直接跑一轮"的入口。
 *
 * 用法(在装了 cowork-server 的机器上跑,需能访问 docker):
 *   node routine-once.mjs --uid <用户UUID> --prompt "列出 /workspace 下的文件"
 *   node routine-once.mjs --uid <uid> --prompt "..." --sid <32位hex> --model claude-opus-4-8
 *   node routine-once.mjs ... --transcript /tmp/run.jsonl     # 落 stream-json 原文
 *   node routine-once.mjs ... --keep                          # 跑完保留容器+卷(默认清理)
 *
 * 凭证来源二选一:
 *   ① 默认走账号后端(需配 COWORK_BACKEND_URL + COWORK_INTERNAL_SECRET);
 *   ② 账号后端还没部署时,用环境变量直接喂 —— 用于把执行链路先验通,与 P1 解耦:
 *        COWORK_TEST_REAL_BASE=https://newapi.example.com \
 *        COWORK_TEST_REAL_KEY=sk-xxx \
 *        node routine-once.mjs --uid probe --prompt "..."
 *      走的是 runRoutine 的 fetchCredentials 注入接缝,**不是**生产代码里的后门。
 *
 * ⚠️ 本脚本不打印任何凭证。要确认是否取到,看输出里的 credentials= 那一行的来源标记。
 */
import { runRoutine } from './lib/routine-runner.mjs';
import * as orch from './lib/orchestrator.mjs';
import { backendConfigured } from './lib/backend-credentials.mjs';
import crypto from 'node:crypto';

function arg(name, dflt = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const uid = arg('uid');
const prompt = arg('prompt');
if (!uid || !prompt || uid === true || prompt === true) {
  process.stderr.write('用法: node routine-once.mjs --uid <uid> --prompt "<指令>" [--sid hex] [--model m] [--config id] [--transcript path] [--keep]\n');
  process.exit(2);
}
const sid = arg('sid') || crypto.randomBytes(16).toString('hex');
const model = arg('model');
const configId = arg('config');
const transcriptPath = arg('transcript');
const keep = arg('keep') === true;

// 联调用的直喂凭证(见文件头 ②)。只有两个变量都给了才生效。
const TEST_BASE = process.env.COWORK_TEST_REAL_BASE || '';
const TEST_KEY = process.env.COWORK_TEST_REAL_KEY || '';
const useTestCreds = !!(TEST_BASE && TEST_KEY);

const log = (...a) => process.stderr.write('[routine-once] ' + a.join(' ') + '\n');

const credSource = useTestCreds
  ? 'COWORK_TEST_REAL_* 环境变量(联调)'
  : (backendConfigured ? '账号后端' : '未配置(会失败)');
log(`sid=${sid} uid=${uid} model=${model || '默认'} credentials=${credSource}`);

const fetchCredentials = useTestCreds
  ? async () => ({
      realBase: TEST_BASE,
      realKey: TEST_KEY,
      authStyle: process.env.COWORK_TEST_AUTH_STYLE === 'auth_token' ? 'auth_token' : 'api_key',
      configId: 'test', configName: 'test', defaultModels: {}, effortLevel: '',
    })
  : undefined;

const t0 = Date.now();
const r = await runRoutine({
  sid, uid, prompt, model, configId, transcriptPath, log,
  // 手工触发没有调度器在管 TTL,自己接一个空实现即可(单次运行不会超 30 分钟空闲)
  activity: { start: () => {}, end: () => {} },
  ...(fetchCredentials ? { fetchCredentials } : {}),
});

process.stdout.write(JSON.stringify({
  status: r.status,
  ok: r.ok,
  exitCode: r.exitCode,
  durationMs: r.durationMs,
  wallMs: Date.now() - t0,
  apiErrorStatus: r.apiErrorStatus ?? null,
  costUsd: r.costUsd ?? null,
  numTurns: r.numTurns ?? null,
  transcriptLines: r.transcript?.length ?? 0,
  transcriptBytes: r.transcriptBytes ?? 0,
  skipReason: r.skipReason,
  error: r.error || '',
  resultText: (r.resultText || '').slice(0, 500),
}, null, 2) + '\n');

if (!keep) {
  log('清理容器与卷(--keep 可保留)');
  try { await orch.removeContainer(sid, { keepVolume: false }); } catch (e) { log('清理失败:', e.message); }
}

process.exit(r.ok ? 0 : 1);
