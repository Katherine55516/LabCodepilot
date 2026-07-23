/**
 * 问题反馈上报的纯逻辑核心 — 无 electron / fs 依赖，可被单测直接 import。
 *
 * 职责：message 校验、multipart 表单组装、POST 状态码 → 结构化结果映射。
 * Electron 侧的胶水（读 main.log、app.getVersion()、token/baseUrl）在
 * main.ts 的 feedback:submit handler 里，见 docs/exec-plans/active/
 * bug-report-feedback.md。
 *
 * 信任边界：客户端不上送任何身份字段 — 服务端一律以 JWT claims 为准，
 * 表单里只有 message + 环境信息 + 可选日志文件。
 */

export const FEEDBACK_MESSAGE_MAX = 5000;

/** 与服务端 LOG_MAX_BYTES 对齐（6MB）；客户端 main.log 轮转上限 5MB，正常不会触发。 */
export const FEEDBACK_LOG_MAX_BYTES = 6 * 1024 * 1024;

export interface FeedbackEnv {
  appVersion: string;
  platform: string;
  osVersion: string;
}

export type FeedbackSubmitResult =
  | { ok: true; id?: string }
  | {
      ok: false;
      error:
        | 'invalid-message'
        | 'not-logged-in'
        | 'network'
        | 'rate-limited'
        | 'too-large'
        | 'server';
      status?: number;
    };

/** trim 后 1..5000 字为合法；否则 null。 */
export function normalizeFeedbackMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > FEEDBACK_MESSAGE_MAX) return null;
  return text;
}

export function buildFeedbackForm(opts: {
  message: string;
  env: FeedbackEnv;
  logBytes?: Uint8Array | null;
}): FormData {
  const form = new FormData();
  form.set('message', opts.message);
  form.set('app_version', opts.env.appVersion);
  form.set('platform', opts.env.platform);
  form.set('os_version', opts.env.osVersion);
  if (opts.logBytes && opts.logBytes.byteLength > 0) {
    // 文件名仅作展示；服务端落盘用记录 UUID，不信任这里的名字
    form.set('log', new Blob([opts.logBytes as BlobPart], { type: 'text/plain' }), 'main.log');
  }
  return form;
}

/**
 * POST /api/v1/feedback。fetchImpl 可注入（单测）；默认全局 fetch。
 * 不设 Content-Type — fetch 会为 FormData 自动带 multipart boundary。
 */
export async function postFeedback(opts: {
  baseUrl: string;
  token: string;
  form: FormData;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<FeedbackSubmitResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);

  let res: Response;
  try {
    res = await doFetch(`${opts.baseUrl}/api/v1/feedback`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.token}` },
      body: opts.form,
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    return { ok: false, error: 'network' };
  }
  clearTimeout(timeout);

  if (res.status === 201) {
    let id: string | undefined;
    try {
      id = ((await res.json()) as { id?: string }).id;
    } catch {
      // 201 无 body 也算成功
    }
    return { ok: true, id };
  }
  if (res.status === 401) return { ok: false, error: 'not-logged-in', status: 401 };
  if (res.status === 413) return { ok: false, error: 'too-large', status: 413 };
  if (res.status === 429) return { ok: false, error: 'rate-limited', status: 429 };
  return { ok: false, error: 'server', status: res.status };
}
