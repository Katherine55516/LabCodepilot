/**
 * 沙箱定时任务 REST 客户端(P4)。
 *
 * 定时任务跑在**沙箱服务器**上,客户端只做管理 / 拉取 / 展示 —— 本模块就是「管理」那一半:
 * 把 `/api/routines/*` 代理路由收到的请求转成对 cowork-server 的调用。
 *
 * 配置与鉴权**完全复用办公模式那一套**(`cowork_remote_url` / `cowork_remote_token`,
 * 由账号登录后下发)—— 定时任务不引入任何新的凭证或端点配置。
 *
 * ⚠️ 只在 **Next server 侧**用。token 绝不能进 renderer:那等于把沙箱的 per-user 凭证
 * 交给页面 JS。所有调用都必须经 `/api/routines/*` 路由中转,与既有 cowork 路由同姿态。
 */
import type { CoworkRoutine, RoutineRun, RoutineSchedule } from '@/types';
import { getSetting, getCurrentUserUid } from './db';

/** 服务端 view() 的形状(camelCase,原样) */
export interface RemoteRoutine {
  id: string;
  name: string;
  description: string;
  prompt: string;
  model: string;
  configId: string;
  schedule: RoutineSchedule;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  ranAt: string | null;
  consecutiveErrors: number;
  disabledReason: string;
  createdAt: string;
  updatedAt: string;
}

function remoteConfig() {
  return {
    url: (getSetting('cowork_remote_url') || '').trim().replace(/\/+$/, ''),
    token: (getSetting('cowork_remote_token') || '').trim(),
  };
}

/** 定时任务是否可用 = 办公模式是否已由账号下发配置。未下发时 UI 不渲染入口。 */
export function routinesAvailable(): boolean {
  const { url, token } = remoteConfig();
  return !!(url && token);
}

export class RoutinesUnavailableError extends Error {
  constructor() {
    super('cowork 未开通(账号未下发沙箱配置)');
    this.name = 'RoutinesUnavailableError';
  }
}

/** 带上服务端返回的状态码,让代理路由能原样透传(400 校验消息、429 配额等)。 */
export class RoutinesHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'RoutinesHttpError';
    this.status = status;
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { url, token } = remoteConfig();
  if (!url || !token) throw new RoutinesUnavailableError();
  const res = await fetch(url + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // 服务端的 400 校验消息是面向用户的中文(如「触发间隔 5 分钟,低于最小间隔 30 分钟」),
    // 必须原样带到 UI —— 自己编一句「创建失败」等于把服务端辛苦做的校验说明扔了。
    let detail = '';
    try { detail = String(((await res.json()) as { error?: string }).error || ''); } catch { /* 非 JSON */ }
    throw new RoutinesHttpError(res.status, detail || `cowork-server ${method} ${path} → ${res.status}`);
  }
  return (await res.json()) as T;
}

/** 列表接口的完整响应。配额两项是**可选**的 —— 老版本沙箱不回,界面就不显示那块。 */
export interface RoutineListEnvelope {
  routines: RemoteRoutine[];
  max: number;
  dailyCap?: number;
  usedToday?: number;
}

export async function listRoutinesEnvelope(): Promise<RoutineListEnvelope> {
  const r = await api<RoutineListEnvelope>('GET', '/routines');
  return { ...r, routines: r.routines || [] };
}

export async function listRoutines(): Promise<RemoteRoutine[]> {
  return (await listRoutinesEnvelope()).routines;
}

export async function getRoutine(id: string): Promise<RemoteRoutine> {
  return api<RemoteRoutine>('GET', `/routines/${id}`);
}

export async function createRoutine(payload: Record<string, unknown>): Promise<RemoteRoutine> {
  return api<RemoteRoutine>('POST', '/routines', payload);
}

export async function updateRoutine(id: string, payload: Record<string, unknown>): Promise<RemoteRoutine> {
  return api<RemoteRoutine>('PATCH', `/routines/${id}`, payload);
}

export async function deleteRoutine(id: string): Promise<void> {
  await api<{ ok: boolean }>('DELETE', `/routines/${id}`);
}

/** 立即运行。服务端在被限流/并发满时返回 429 + reason,这里原样抛出让 UI 说清楚。 */
export async function runRoutineNow(id: string): Promise<{ started: boolean }> {
  return api<{ started: boolean }>('POST', `/routines/${id}/run`);
}

export async function listRuns(id: string, opts: { since?: string; limit?: number } = {}): Promise<RoutineRun[]> {
  const qs = new URLSearchParams();
  if (opts.since) qs.set('since', opts.since);
  if (opts.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  const r = await api<{ runs: RoutineRun[] }>('GET', `/routines/${id}/runs${q ? '?' + q : ''}`);
  return r.runs || [];
}

/** 取某次运行的 stream-json 原文(P5 的物化要用它重放成消息)。 */
export async function fetchTranscript(runId: string): Promise<string> {
  const { url, token } = remoteConfig();
  if (!url || !token) throw new RoutinesUnavailableError();
  const res = await fetch(`${url}/runs/${runId}/transcript`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new RoutinesHttpError(res.status, `transcript ${runId} → ${res.status}`);
  return res.text();
}

/**
 * 服务端 view → 本地缓存行。
 *
 * owner_uid 取**当前登录账号**而不是服务端返回值 —— 服务端的 view() 刻意不回传 uid
 * (那是内部字段),而客户端本来就只能看到自己的 routine(token 里带着 uid)。
 */
export function toCacheRow(r: RemoteRoutine): CoworkRoutine {
  return {
    id: r.id,
    owner_uid: getCurrentUserUid(),
    name: r.name,
    description: r.description || '',
    prompt: r.prompt || '',
    model: r.model || '',
    config_id: r.configId || '',
    schedule_kind: r.schedule?.kind || 'manual',
    schedule_expr: r.schedule?.expr || '',
    schedule_tz: r.schedule?.tz || '',
    schedule_fire_at: r.schedule?.fireAt || '',
    enabled: r.enabled ? 1 : 0,
    next_run_at: r.nextRunAt || '',
    last_run_at: r.lastRunAt || '',
    last_status: r.lastStatus || '',
    ran_at: r.ranAt || '',
    consecutive_errors: r.consecutiveErrors || 0,
    disabled_reason: r.disabledReason || '',
    created_at: r.createdAt || '',
    updated_at: r.updatedAt || '',
    synced_at: new Date().toISOString(),
  };
}
