/**
 * 定时任务执行器 —— 服务端自主发起一轮 agent(P2)。
 *
 * 与 exec-bridge.mjs 的区别:那条路是「给客户端 SDK 当哑管道」,agent loop 在客户端;
 * 这条路**服务端自己发起并跑完**,客户端可以完全不在。
 *
 *   docker exec -i -u 1000 -e … <容器> python3 cowork-shim.py -- \
 *       -p "<prompt>" --output-format stream-json --verbose \
 *       --dangerously-skip-permissions [--model …]
 *   ↑ `--` 之后**直接是 claude 的参数,不带二进制路径** —— shim 自己会 prepend。
 *
 * ⚠️ 三条来自生产实测、写死不能改的结论:
 *
 * ① **必须走 shim,不能直连 claude。** shim 的 link_preinstalled_skills() 负责把镜像里
 *    5 个办公 skill(docx/xlsx/pptx/pdf/office-cn)软链进 ~/.claude/skills —— HOME 是
 *    会话状态卷,新建时是空的,镜像里写死没用。实测:直连 14 个 skill,经 shim 19 个。
 *    绕开 shim = 静默丢掉全部办公能力,而定时任务恰恰最需要它们。
 *
 * ② **stdin 写 4 字节零长帧就是优雅 EOF,shim 零改动。** `-p` 模式 prompt 在 argv 里,
 *    本就不需要 stdin。不必给 shim 加 --oneshot(早期方案,已废弃)。
 *
 * ③ **`--` 之后不要再写 claude 二进制路径**(P2 首测踩过,详见 execOnce 里的注释)。
 *    `-p/--print` 是布尔开关、prompt 走位置参数;多写一次路径就会把它变成 prompt 本身,
 *    而回合照样 exit=0 / status=success —— 只有读输出才发现模型答非所问。
 *
 * 四个护栏(交互回合有人盯着,定时任务没有):
 *   - **401 立即中止**:见首条 api_retry(error_status=401)即 kill。不做的话 claude 会
 *     退避重试 10 次,P0 实测白烧 **181 秒**才退出 —— 无人值守下会持续挤占并发额度。
 *     非 401 的 retry(429/5xx)**放行**,让它正常退避。
 *   - 硬超时:默认 15min,SIGTERM → 3s → SIGKILL。
 *   - 输出上限:transcript 8MB,超了掐掉(防单次跑飞把盘写满)。
 *   - 并发闸:默认 4;满了直接返回 skipped 让调度器下个 tick 再来,**不排队**。
 *
 * 成败判定(P0 结论,写死):
 *   ok = exitCode===0 && result.is_error!==true && result.api_error_status==null
 *   **绝不读 result.subtype** —— 401 全程失败的回合它仍然是字面的 "success"。
 */
import { spawn } from 'node:child_process';
import {pptModelInput} from './ppt-model-input.mjs';
import { PPT_SYSTEM_PROMPT } from './ppt-prompt-contracts.mjs';
import fs from 'node:fs';
import path from 'node:path';
import * as orch from './orchestrator.mjs';
import * as cred from './cred-proxy.mjs';
import { fetchModelCredentials, CredentialError } from './backend-credentials.mjs';
import { audit } from './audit.mjs';
import { createCapacity } from './model-capacity.mjs';

const SHIM = process.env.COWORK_SHIM_PATH || '/opt/cowork/cowork-shim.py';
const TIMEOUT_MS = parseInt(process.env.COWORK_ROUTINE_TIMEOUT_MS || String(15 * 60 * 1000), 10);
const MAX_OUTPUT_BYTES = parseInt(process.env.COWORK_ROUTINE_MAX_OUTPUT || String(8 * 1024 * 1024), 10);
const CONCURRENCY = parseInt(process.env.COWORK_ROUTINE_CONCURRENCY || '4', 10);
const KILL_GRACE_MS = 3000;
/** stderr 只留尾部若干字节做诊断 —— claude 可能什么都不输出,但输出起来也可能很长。 */
const MAX_STDERR_BYTES = 16 * 1024;

let active = 0;
const capacity = createCapacity(CONCURRENCY);
export function activeCount() { return active; }
export { CONCURRENCY };

/** Consume only actual text deltas from the CLI. Neither tool events nor a
 * completed response are expanded into a simulated typing sequence. */
export function routineTextProgress(onProgress, now = Date.now) {
  let text='',sent=0,seq=0,dirty=false;
  const flush=()=>{if(!dirty||typeof onProgress!=='function')return;dirty=false;sent=now();try{onProgress({chars:text.length,text:text.slice(0,60000),seq:++seq});}catch{ /* transient draft only */ }};
  return {accept:msg=>{if(msg?.type!=='stream_event'||msg.event?.type!=='content_block_delta'||msg.event.delta?.type!=='text_delta'||typeof msg.event.delta.text!=='string')return;text+=msg.event.delta.text;dirty=true;if(now()-sent>=700)flush();},flush};
}

/**
 * 跑一轮定时任务。绝不抛异常 —— 一律以结构化结果返回,让调度器只需看 status。
 *
 * @param {object} o
 * @param {string} o.sid          routine 的 sid(= routineId,容器 cowork-<sid>)
 * @param {string} o.uid          归属用户 UUID
 * @param {string} o.prompt       任务指令
 * @param {string} [o.model]      模型 id;省略用容器内默认
 * @param {string} [o.configId]   指定 managed 配置(防管理员调 sort_order 导致模型漂移)
 * @param {string} [o.transcriptPath] 给了就把 stream-json 原文落这个文件
 * @param {{start?:Function,end?:Function}} [o.activity]
 *        ⚠️ **必须传**(P3 接线):把 index.mjs 现成的 execOpened/execClosed 接进来。
 *        不传的话空闲回收器看不到这次运行(它只认 WS 连接),跑到第 30 分钟容器会被
 *        docker stop 掉 —— 机制是现成的,纯粹是「要记得调」。
 * @param {Function} [o.log]
 * @param {string} [o.kind]         'routine' or server-owned 'ppt' workspace
 * @param {Function} [o.fetchCredentials]
 *        取凭证的实现,默认走账号后端。**这是给单测和联调用的注入接缝,不是后门** ——
 *        生产路径永远用默认值;routine-once.mjs 在账号后端还没部署时用它直接喂测试
 *        凭证,好把执行链路先验通(P2 与 P1 解耦,不必互相等)。
 */
export async function runRoutine({
  sid, uid, prompt, model, configId, transcriptPath, activity, log = () => {},
  kind = 'routine',
  fetchCredentials = fetchModelCredentials,
  canStart = () => true,
  onProgress, images, maxWireAttempts, maxOutputTokens,
}) {
  const releaseSlot = kind === orch.KIND_PPT ? await capacity.acquire() : capacity.tryAcquire();
  if (!releaseSlot) {
    // 不排队:排队会让「到点没跑」变成「几小时后突然跑了」,对定时任务是更坏的结果。
    log(`routine ${sid} skipped: concurrency ${active}/${CONCURRENCY}`);
    return { ok: false, status: 'skipped', skipReason: 'concurrency_limit', durationMs: 0 };
  }
  active++;
  const startedAt = Date.now();
  let credRegistered = false;
  try {
    if (!canStart()) return { ok: false, status: 'cancelled', error: 'task stopped before model execution', durationMs: 0 };
    // ── 1. 取凭证(账号后端直取)────────────────────────────────
    let c;
    try {
      c = await fetchCredentials(uid, { configId });
    } catch (e) {
      const reason = e instanceof CredentialError ? e.reason : 'backend_error';
      log(`routine ${sid} credential fetch failed: ${reason}`);
      audit('routine_end', { sessionId: sid, detail: `${uid} credential_error:${reason}`, code: -1, durationMs: Date.now() - startedAt });
      return { ok: false, status: 'credential_error', error: `${reason}: ${e.message}`, durationMs: Date.now() - startedAt };
    }

    // 取凭证成功也要留痕:排障时「这次运行到底有没有拿到凭证、拿的是哪套配置」
    // 是第一个要问的问题。账号后端那边虽然也记了,但两边日志对不到一条时间线上,
    // 而这条能和同一 sessionId 的 routine_fire / routine_end 直接串起来。
    // ⚠️ 只记 uid 与配置名,**绝不记 key 本体**(与 cred_issued/cred_revoked 同规矩)。
    audit('cred_fetched', { sessionId: sid, detail: `${uid} ${c.configName || 'default'}` });

    // ── 2. 登记进 cred-proxy(真 key 到此为止,不再往下走)──────────
    const { token, baseUrl } = await cred.registerCredentials(
      sid, { realKey: c.realKey, realBase: c.realBase, authStyle: c.authStyle }, log,
    );
    credRegistered = true;
    c.realKey = '';  // 主动清引用,别让它出现在任何后续结构里

    // ── 3. 确保容器就绪(TTL 回收过的会 docker start 复用)──────────
    // kind='routine':让容器与卷带上 cowork.kind 标签,reconcile 才会放过它们。
    // 漏了这个参数 = 用户下次打开 app 时定时任务的累积工作区被当孤儿删光。
    const { name, reused } = await orch.ensureContainer(sid, uid, kind);
    audit('routine_fire', { sessionId: sid, detail: `${uid} ${reused ? 'reused' : 'new'}` });

    // ── 4. 跑 ────────────────────────────────────────────────
    activity?.start?.(sid);
    const run = partial => execOnce({
      sid, container: name, prompt, model, token, baseUrl, authStyle: c.authStyle, log,
      defaultModels: c.defaultModels, effortLevel: c.effortLevel, images, maxWireAttempts, maxOutputTokens, kind, onProgress: partial ? onProgress : undefined,
    });
    // PPT writers stream partial text for the live draft (round 7, A7). A CLI
    // without partial-message support is retried once without streaming.
    let r = await run(Boolean(onProgress) && kind === orch.KIND_PPT);
    if (r.status === 'partial_unsupported') { log(`routine ${sid} partial messages unsupported; rerunning without streaming`); r = await run(false); }
    activity?.end?.(sid);

    // ── 5. transcript 落盘 ───────────────────────────────────
    if (transcriptPath && r.transcript.length) {
      try {
        fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
        fs.writeFileSync(transcriptPath, r.transcript.join('\n') + '\n');
      } catch (e) {
        log(`routine ${sid} transcript write failed: ${e.message}`);  // 不影响判定
      }
    }

    const durationMs = Date.now() - startedAt;
    audit('routine_end', { sessionId: sid, detail: `${uid} ${r.status}`, code: r.exitCode ?? -1, durationMs });
    log(`routine ${sid} ${r.status} in ${durationMs}ms (exit=${r.exitCode})`);
    return { ...r, ok: r.status === 'success', durationMs, configId: c.configId, configName: c.configName };
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    log(`routine ${sid} crashed: ${e.message}`);
    audit('routine_end', { sessionId: sid, detail: `${uid} crash`, code: -1, durationMs });
    return { ok: false, status: 'error', error: String(e?.message || e), durationMs };
  } finally {
    // 用完即废:两次运行之间服务端**不持有任何有效凭证**,把"能自主花钱"的窗口
    // 压到只存在于运行期间。best-effort,失败不影响结果。
    if (credRegistered) { try { await cred.revokeCredentials(sid); } catch { /* ignore */ } }
    active--;
    releaseSlot();
  }
}

/** 真正 spawn 的那一段。返回 { status, exitCode, result, resultText, transcript, ... }。 */
function execOnce({ sid, container, prompt, model, token, baseUrl, authStyle, log, defaultModels = {}, effortLevel = '', kind = 'routine', onProgress, images, maxWireAttempts=5, maxOutputTokens }) {
  return new Promise((resolve) => {
    // 容器侧拿的是一次性 cwk_ token。cred-proxy 两种头都认(x-api-key 优先、
    // 回退 Authorization: Bearer),这里跟随 authStyle 保持与客户端同构。
    const keyVar = authStyle === 'auth_token' ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY';

    // 账号配置里的角色模型必须过河 —— 否则 claude 用的是**容器内置默认**,而不是该账号
    // 实际开通的模型。首次端到端实测踩过:账号配的是 qwen3.7-max[1m],回合却跑在
    // claude-opus-4-8[1m] 上 —— 网关恰好放行了,所以既没报错也没人发现,只有去读
    // transcript 的 init 消息才看得出来。与客户端 managed-providers.ts 的映射保持一致。
    const roleEnv = [];
    const input=kind===orch.KIND_PPT?pptModelInput(prompt,images):null;
    const pushEnv = (k, v) => { if (v) roleEnv.push('-e', `${k}=${v}`); };
    pushEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', defaultModels.opus);
    pushEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', defaultModels.sonnet);
    pushEnv('ANTHROPIC_DEFAULT_HAIKU_MODEL', defaultModels.haiku);
    pushEnv('CLAUDE_CODE_SUBAGENT_MODEL', defaultModels.subagent);
    pushEnv('CLAUDE_CODE_EFFORT_LEVEL', effortLevel);
    if(kind===orch.KIND_PPT&&Number.isInteger(maxOutputTokens)&&maxOutputTokens>=256&&maxOutputTokens<=32768)pushEnv('CLAUDE_CODE_MAX_OUTPUT_TOKENS',String(maxOutputTokens));

    // routine 没显式选模型时,退到账号配置的 opus 角色(与客户端「默认取配置第一条」同义);
    // 都没有才交给容器内置默认。
    const effectiveModel = model || defaultModels.opus || defaultModels.sonnet || '';

    const args = [
      'exec', '-i', '-u', '1000',
      '-e', `ANTHROPIC_BASE_URL=${baseUrl}`,
      '-e', `${keyVar}=${token}`,
      ...roleEnv,
      container, 'python3', SHIM, '--',
      // ⚠️ **不要在这里再写一次 claude 二进制路径。** shim 自己会 prepend
      // (cowork-shim.py: `Popen([CLAUDE_BIN] + argv)`,路径取自 COWORK_CLAUDE_BIN)。
      // 多传一次的话它会变成 claude 的**第一个位置参数** —— 而 `-p/--print` 是布尔
      // 开关、prompt 走位置参数,于是 "/opt/cowork/claude" 就成了真正的 prompt,
      // 而你写的指令被丢掉。首次实测就踩了:回合 exit=0、status=success、花了 $0.39,
      // 模型却在一本正经地介绍 /opt/cowork/claude 是什么。
      // ——「绿色不等于任务达成」的活标本。
      '-p', ...(kind === orch.KIND_PPT ? input.args : [prompt]),
      '--output-format', 'stream-json', '--verbose',
      ...(onProgress ? ['--include-partial-messages'] : []),
      '--dangerously-skip-permissions',
      // PPT nodes are semantic transforms only. The renderer is separate code;
      // the model must have no filesystem, shell, web, skill or MCP tools.
      ...(kind === orch.KIND_PPT ? ['--system-prompt', PPT_SYSTEM_PROMPT, '--tools', '', '--disallowedTools', 'mcp__*'] : []),
      ...(effectiveModel ? ['--model', effectiveModel] : []),
    ];
    log(`routine ${sid} spawn model=${effectiveModel || '容器默认'}${model ? '(显式)' : '(账号配置)'} authStyle=${authStyle}`);

    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const transcript = [];
    let wireAttempts=1;
    let bytes = 0;
    let buf = '';
    let stderr = '';
    let result = null;
    const partial = routineTextProgress(onProgress);
    let status = null;       // 非 null = 已判定终态(401/超时/溢出),不再被覆盖
    let settled = false;

    const kill = (why) => {
      if (status === null) status = why;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, KILL_GRACE_MS).unref?.();
    };

    const timer = setTimeout(() => {
      log(`routine ${sid} timeout after ${TIMEOUT_MS}ms`);
      kill('timeout');
    }, TIMEOUT_MS);
    timer.unref?.();

    const onLine = (line) => {
      if (!line) return;
      transcript.push(line);
      let msg;
      try { msg = JSON.parse(line); } catch { return; }  // 非 JSON 行照收,不解析
      // 401 立即中止 —— 唯一的"提前止损"分支。非 401 的重试让它自己退避。
      if(kind===orch.KIND_PPT&&msg.type==='system'&&msg.subtype==='api_retry'&&++wireAttempts>maxWireAttempts){kill('attempt_limit');return;}
      if (msg.type === 'system' && msg.subtype === 'api_retry' && msg.error_status === 401) {
        log(`routine ${sid} aborting on 401 (attempt ${msg.attempt}) — 不等它退避完 10 次`);
        kill('credential_error');
        return;
      }
      if (msg.type === 'result') result = msg;
      // Partial assistant text (only with --include-partial-messages).
      if (onProgress) partial.accept(msg);
    };

    child.stdin.on('error', () => { /* claude 先退出时的 EPIPE */ });
    // PPT uses Claude print mode's plain stdin input through the same framed
    // shim. Other routines keep their established positional-prompt transport.
    child.stdin.end(kind === orch.KIND_PPT ? input.frame : Buffer.alloc(4));

    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        log(`routine ${sid} output overflow (${bytes}B > ${MAX_OUTPUT_BYTES}B)`);
        kill('output_overflow');
        return;
      }
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        onLine(buf.slice(0, nl).trim());
        buf = buf.slice(nl + 1);
      }
    });

    child.stderr.on('data', (chunk) => {
      // 只留尾部:claude 的 stderr 可能一片空白,也可能刷屏,两种都要能应付
      stderr = (stderr + chunk.toString('utf8')).slice(-MAX_STDERR_BYTES);
    });

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (buf.trim()) onLine(buf.trim());  // 收尾:最后一行可能没有换行符
      partial.flush();

      // ⚠️ 判定口径写死。绝不读 result.subtype —— P0 实测 401 全失败时它仍是 "success"。
      const clean = exitCode === 0 && result?.is_error !== true && result?.api_error_status == null;
      const partialUnsupported = Boolean(onProgress) && !clean && !result && /(?:unknown|unrecognized|unexpected)\s+(?:option|argument)[^\n]*include-partial-messages/iu.test(stderr);
      const finalStatus = status ?? (partialUnsupported ? 'partial_unsupported' : clean ? 'success' : 'error');
      // 主动中止的三种终态自带确定的原因,别回落去捡 stderr —— 那里往往是 shim 的
      // 无关信息(如"预制 skill 已挂载: 5 个"),而这串字会原样进用户看到的运行历史。
      const ABORT_REASON = {
        attempt_limit: '模型调用已达本任务上限，请检查后再重试',
        credential_error: '模型凭证被上游拒绝(401),已立即中止而不等它退避重试',
        timeout: `超过 ${Math.round(TIMEOUT_MS / 1000)} 秒未结束,已中止`,
        // 不能写死 MB —— 阈值被调小时(联调/单测)会四舍五入成"超过 0MB",很傻
        output_overflow: `输出超过 ${MAX_OUTPUT_BYTES >= 1048576
          ? `${(MAX_OUTPUT_BYTES / 1048576).toFixed(MAX_OUTPUT_BYTES % 1048576 ? 1 : 0)}MB`
          : `${Math.max(1, Math.round(MAX_OUTPUT_BYTES / 1024))}KB`},已中止`,
      };
      resolve({
        status: finalStatus,
        exitCode,
        result,
        resultText: typeof result?.result === 'string' ? result.result : '',
        apiErrorStatus: result?.api_error_status ?? null,
        costUsd: result?.total_cost_usd ?? null,
        usage: result?.usage ?? null,wireAttempts,
        numTurns: result?.num_turns ?? null,
        transcript,
        transcriptBytes: bytes,
        stderr: stderr.trim(),
        error: finalStatus === 'success'
          ? ''
          : (ABORT_REASON[finalStatus] || result?.result || stderr.trim() || `exit ${exitCode}`),
      });
    };

    child.on('exit', (code) => finish(code === null ? -1 : code));
    child.on('error', (e) => {
      log(`routine ${sid} spawn error: ${e.message}`);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status: 'error', exitCode: -1, result: null, resultText: '',
        apiErrorStatus: null, costUsd: null, usage: null, numTurns: null,
        transcript, transcriptBytes: bytes, stderr: stderr.trim(),
        error: `spawn failed: ${e.message}`,
      });
    });
  });
}

export const _internals = { TIMEOUT_MS, MAX_OUTPUT_BYTES, KILL_GRACE_MS, execOnce };
