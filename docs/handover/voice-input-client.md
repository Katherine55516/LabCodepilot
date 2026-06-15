# 语音转文字输入 — 客户端实现文档（本应用）

> 服务端实现见 [voice-input-server.md](./voice-input-server.md)
>
> 创建时间：2026-06-15 ｜ 状态：📋 待实现（已完成全链路实测验证）
>
> 本文覆盖 **CodePilot 桌面端（Electron + Next.js）** 的全部改动。配套的"换临时 token"后端接口在**另一个项目**（`code-agent.ai-native-lab.com`），见上面的服务端文档。

---

## 0. 一句话目标

聊天输入框工具栏加一个**麦克风按钮**：点击 → 调系统麦克风 → 实时把说话转成文字、边说边出现在输入框 → 再次点击/停顿自动结束。识别用**阿里云百炼 `qwen3-asr-flash-realtime`**（WebSocket 实时 ASR），**客户端直连百炼**，音频不经过自建服务器。

## 1. 已验证的架构与数据流

> 下列协议事实均为 2026-06-15 用真实 key 实测确认（非文档推断）。

```
┌─ Electron 客户端（全程在用户机器内）───────────────────────────────┐
│ 渲染进程 (renderer)                                                  │
│   getUserMedia(mic) → AudioContext(16k) → AudioWorklet 抽 PCM16     │
│   每 100ms 一帧(3200B) ──IPC 'asr:audio'──▶ 主进程                  │
│   ◀──IPC 'asr:transcript'── 文字增量/最终 → 回填输入框              │
│                                                                     │
│ 主进程 (main, Node)  ← 持有 WebSocket（浏览器设不了 header，必须在此）│
│   ① 换 token：apiRequest('/api/v1/asr/token') 到自建服务器（带用户   │
│      bearer，token 永不进 renderer）                                 │
│   ② 用临时 token 开 WS 直连百炼，转发音频、解析事件回推 renderer     │
└───────┬─────────────────────────────────────────────┬──────────────┘
        │ ① HTTPS（自建服务器换 token，秒级、可缓存30min）│ ② WSS 直连
        ▼                                               ▼
  code-agent.ai-native-lab.com                  wss://dashscope.aliyuncs.com
  POST /api/v1/asr/token → {token, expiresAt}    /api-ws/v1/realtime?model=...
        │（服务器用真 DASHSCOPE_API_KEY 换）
        ▼
  https://dashscope.aliyuncs.com/api/v1/tokens
```

**三种凭证（务必分清）：**
| 凭证 | 存哪 | 谁能见 |
|---|---|---|
| 真 `DASHSCOPE_API_KEY` | 自建服务器环境变量 | 只有服务端 |
| 用户登录 bearer（现有体系） | 主进程 `~/.codepilot/anlcode/session_token` | 只有主进程（`loadToken()`） |
| 百炼临时 token `st-...`（≤30min） | 主进程内存（不落盘） | 只有主进程 |

renderer **只经手两样东西：它自己采的音频、返回的文字**。任何凭证都不进 renderer。

## 2. 百炼实时 ASR 协议合同（客户端必须遵守）

- **WS 端点**：`wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime-2026-02-10`
- **握手 header**（浏览器设不了，故必须主进程 `ws` 库）：
  - `Authorization: Bearer <临时token 或 真key>`
  - `OpenAI-Beta: realtime=v1`
- **音频格式**：原始 **PCM / 16000Hz / 16bit / 单声道**；每帧 **3200 字节（=100ms）**，base64 后放进 `input_audio_buffer.append` 事件的 `audio` 字段。**不能用 `MediaRecorder`（它只出 webm/opus）。**
- **客户端→服务端事件**：
  | type | 时机 | 关键字段 |
  |---|---|---|
  | `session.update` | open 后立即发一次（配置会话） | 见下方 config |
  | `input_audio_buffer.append` | 持续推音频 | `audio`(base64 PCM) |
  | `input_audio_buffer.commit` | **仅手动模式**；server_vad 模式不发 | — |
- **`session.update` 的 session 配置**（用 server_vad 自动断句）：
  ```json
  {
    "modalities": ["text"],
    "input_audio_format": "pcm",
    "sample_rate": 16000,
    "input_audio_transcription": { "language": "zh" },
    "turn_detection": { "type": "server_vad", "threshold": 0.2, "silence_duration_ms": 800 }
  }
  ```
- **服务端→客户端事件**（实测确认）：
  | type | 含义 | 关键字段 | 客户端动作 |
  |---|---|---|---|
  | `session.created` / `session.updated` | 会话就绪 | — | 可开始推音频 |
  | `input_audio_buffer.speech_started` | 检测到说话 | — | UI 标"聆听中" |
  | `conversation.item.input_audio_transcription.text` | **实时增量** | `text`(已确认前缀) + `stash`(暂定后缀) | 输入框预览 = `text + stash` |
  | `input_audio_buffer.speech_stopped` | 静音 800ms | — | — |
  | `conversation.item.input_audio_transcription.completed` | **最终结果** | `transcript` | 用 `transcript` 落定 |
  | `conversation.item.input_audio_transcription.failed` | 识别失败 | `error` | 报错 |
  | `error` | 协议/鉴权错误 | `error.message` | 报错 |
- **延迟**：首个增量 ~0.5s，`completed` 紧跟 `speech_stopped`。

## 3. 改动清单总览

**新增文件（5 个）：**
| 文件 | 作用 |
|---|---|
| `electron/asr/realtime-session.ts` | 主进程：百炼 WS 会话封装（连接/配置/推音频/解析事件） |
| `electron/asr/token-cache.ts` | 主进程：临时 token 缓存（30min，过期才换） |
| `public/asr-worklet.js` | 渲染进程：AudioWorklet，抽 PCM16/16k、100ms 成帧 |
| `src/hooks/useVoiceInput.ts` | 渲染进程：录音 + IPC + 状态机 + 文字组装 |
| `src/components/chat/VoiceInputButton.tsx` | 麦克风按钮 |

**修改文件（10 个）：**
| 文件 | 改动 |
|---|---|
| `electron/auth/client.ts` | 加 `fetchAsrToken()` |
| `electron/main.ts` | 加 asr IPC handlers + 媒体权限处理 |
| `electron/preload.ts` | 加 `asr` 命名空间 |
| `src/types/electron.d.ts` | 加 `asr` 类型 |
| `src/components/chat/MessageInput.tsx` | 插入按钮 + 回填 |
| `src/components/ui/icon.tsx` | 加 `Microphone` 图标再导出 |
| `src/i18n/en.ts` / `zh.ts` / `zh-HK.ts` | 加 `composer.voiceInput*` 文案 |
| `build/entitlements.mac.plist` | 加麦克风 entitlement |
| `electron-builder.yml` | 加 `NSMicrophoneUsageDescription` |

> 构建无忧：主进程用 esbuild 打包（`scripts/build-electron.mjs`，`external` 仅 `['electron']`），`ws`（已是依赖 `^8.19.0`）和新增的 `electron/asr/*.ts` 都会被打进 `dist-electron/main.js`。`public/` 会被 electron-builder 复制到 `standalone/public/`，故 worklet 以 `/asr-worklet.js` 提供。

---

## 4. 逐文件实现

### 4.1 `electron/auth/client.ts`（修改）— 换 token 函数

照搬现有 `fetchUsage()`（`client.ts:257`）的写法。`apiRequest` 会自动拼 base URL、自动注入 `Authorization: Bearer <用户token>`、15s 超时、分类错误。

```ts
// 文件已 import { apiRequest } from './http';（顶部已有）
// 在文件末尾新增：

export interface AsrTokenResp {
  token: string;
  /** unix 秒；客户端据此缓存到近过期才再换 */
  expiresAt: number;
}

/** 向自建服务器换一个百炼实时 ASR 的临时 token（服务器持真 key）。 */
export async function fetchAsrToken(): Promise<AsrTokenResp> {
  const r = await apiRequest<AsrTokenResp>('/api/v1/asr/token', { method: 'POST' });
  if (!r.json) throw new Error('/api/v1/asr/token returned empty body');
  return r.json;
}
```

### 4.2 `electron/asr/token-cache.ts`（新增）— 临时 token 缓存

```ts
import { fetchAsrToken } from '../auth/client';

let cached: { token: string; expiresAt: number } | null = null;
// 距过期 <120s 就提前换，留出握手 + 时钟偏差余量
const REFRESH_MARGIN_S = 120;

/** 拿一个有效临时 token：命中缓存直接返回，否则向服务器换新。 */
export async function getAsrToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (cached && cached.expiresAt - now > REFRESH_MARGIN_S) {
    return cached.token;
  }
  const fresh = await fetchAsrToken(); // { token, expiresAt }
  cached = fresh;
  return fresh.token;
}

/** 握手被拒（401）时清缓存，下次强制换新。 */
export function invalidateAsrToken(): void {
  cached = null;
}
```

### 4.3 `electron/asr/realtime-session.ts`（新增）— 百炼 WS 会话

```ts
import WebSocket from 'ws';

const MODEL = process.env.ASR_MODEL || 'qwen3-asr-flash-realtime-2026-02-10';
const WS_BASE = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';

export interface AsrCallbacks {
  /** 实时增量：text=已确认前缀, stash=暂定后缀 */
  onPartial: (text: string, stash: string) => void;
  /** 一段话最终结果 */
  onFinal: (transcript: string) => void;
  onState: (state: 'connecting' | 'listening' | 'closed') => void;
  /** code: handshake|ws|server|transcription */
  onError: (code: string, message: string, httpStatus?: number) => void;
}

export class RealtimeAsrSession {
  private ws: WebSocket | null = null;

  constructor(
    private token: string,
    private cb: AsrCallbacks,
    private lang: string = 'zh',
  ) {}

  start(): void {
    const url = `${WS_BASE}?model=${encodeURIComponent(MODEL)}`;
    this.cb.onState('connecting');
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    this.ws.on('open', () => this.onOpen());
    this.ws.on('message', (d) => this.onMessage(d));
    this.ws.on('unexpected-response', (_req, res) => {
      // 握手被拒（含 401 token 失效）
      this.cb.onError('handshake', `handshake HTTP ${res.statusCode}`, res.statusCode);
    });
    this.ws.on('error', (e) => this.cb.onError('ws', e.message));
    this.ws.on('close', () => this.cb.onState('closed'));
  }

  private onOpen(): void {
    this.send({
      event_id: `cfg_${Date.now()}`,
      type: 'session.update',
      session: {
        modalities: ['text'],
        input_audio_format: 'pcm',
        sample_rate: 16000,
        input_audio_transcription: { language: this.lang },
        turn_detection: { type: 'server_vad', threshold: 0.2, silence_duration_ms: 800 },
      },
    });
    this.cb.onState('listening');
  }

  /** 推一帧原始 PCM16（mono 16k）。 */
  appendAudio(pcm: Buffer): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.send({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') });
  }

  private onMessage(data: WebSocket.RawData): void {
    let m: Record<string, unknown>;
    try { m = JSON.parse(data.toString()); } catch { return; }
    switch (m.type) {
      case 'conversation.item.input_audio_transcription.text':
        this.cb.onPartial((m.text as string) || '', (m.stash as string) || '');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.cb.onFinal((m.transcript as string) || '');
        break;
      case 'conversation.item.input_audio_transcription.failed':
        this.cb.onError('transcription', 'transcription failed');
        break;
      case 'error': {
        const err = m.error as { message?: string } | undefined;
        this.cb.onError('server', err?.message || JSON.stringify(m));
        break;
      }
      // session.created/updated、speech_started/stopped、committed 不需处理
    }
  }

  private send(obj: unknown): void {
    try { this.ws?.send(JSON.stringify(obj)); } catch { /* socket 已关 */ }
  }

  stop(): void {
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
  }
}
```

### 4.4 `electron/main.ts`（修改）— IPC handlers + 媒体权限

**(a) 顶部 import 补充**（与现有 `electron` 解构合并）：
```ts
import { app, BrowserWindow, ipcMain, systemPreferences /* …现有… */ } from 'electron';
import { RealtimeAsrSession } from './asr/realtime-session';
import { getAsrToken, invalidateAsrToken } from './asr/token-cache';
```

**(b) `createWindow()` 内、`mainWindow = new BrowserWindow(...)`（约 1098 行）之后，加媒体权限放行**（renderer 的 getUserMedia 要过 Electron 这层）：
```ts
// 麦克风：renderer getUserMedia 需要 session 放行 'media'。本应用只加载第一方
// 可信内容（本地 Next server），故 'media' 放行、其余维持原放行默认（return true）。
const ses = mainWindow.webContents.session;
ses.setPermissionRequestHandler((_wc, permission, callback) => {
  callback(true); // 第一方内容，保持原有宽松默认；'media' 在其中
});
ses.setPermissionCheckHandler(() => true);
```
> 若你们出于安全要收紧，可改成 `permission === 'media' ? true : <原策略>`；当前无 handler 即等于全放行，故 `return true` 不引入回归。

**(c) IPC handlers（放在 terminal handlers 附近，约 1994 行后）：**
```ts
// ===== 语音转文字（百炼实时 ASR）IPC =====
let asrSession: RealtimeAsrSession | null = null;

/** macOS 需要系统级麦克风授权（TCC）；Win/Linux 直接放行。 */
async function ensureMicPermission(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return true;
  // 'not-determined' 会弹系统授权框；'denied'/'restricted' 直接 false
  return systemPreferences.askForMediaAccess('microphone');
}

ipcMain.handle('asr:request-mic-permission', async () => {
  try {
    return { granted: await ensureMicPermission() };
  } catch (e) {
    return { granted: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('asr:start', async () => {
  if (asrSession) { asrSession.stop(); asrSession = null; }

  const sendTranscript = (p: unknown) => mainWindow?.webContents.send('asr:transcript', p);
  const sendState = (state: string) => mainWindow?.webContents.send('asr:state', { state });
  const sendError = (code: string, message: string) => mainWindow?.webContents.send('asr:error', { code, message });

  // 开一个会话，并把「是否成功进入 listening」变成可 await 的结果（用于 401 重试）。
  const attempt = (token: string) =>
    new Promise<{ ok: true } | { ok: false; status?: number; error: string }>((resolve) => {
      let settled = false;
      const session = new RealtimeAsrSession(token, {
        onPartial: (text, stash) => sendTranscript({ kind: 'partial', text, stash }),
        onFinal: (transcript) => sendTranscript({ kind: 'final', transcript }),
        onState: (s) => {
          sendState(s);
          if (s === 'listening' && !settled) { settled = true; resolve({ ok: true }); }
          if (s === 'closed' && !settled) { settled = true; resolve({ ok: false, error: 'closed before ready' }); }
        },
        onError: (code, message, httpStatus) => {
          if (!settled) { settled = true; resolve({ ok: false, status: httpStatus, error: `${code}: ${message}` }); }
          else sendError(code, message); // 已就绪后才发生的错误，照常上报 renderer
        },
      }, 'zh');
      asrSession = session;
      session.start();
    });

  try {
    let token = await getAsrToken();
    let r = await attempt(token);
    if (!r.ok && r.status === 401) {           // 临时 token 失效 → 清缓存换新、重试一次
      invalidateAsrToken();
      token = await getAsrToken();
      r = await attempt(token);
    }
    if (!r.ok) { asrSession?.stop(); asrSession = null; return { ok: false as const, status: r.status, error: r.error }; }
    return { ok: true as const };
  } catch (e) {
    asrSession?.stop(); asrSession = null;
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
});

// 高频音频帧：用 ipcMain.on（fire-and-forget），仿 terminal:write
ipcMain.on('asr:audio', (_event, chunk: ArrayBuffer) => {
  if (!asrSession) return;
  asrSession.appendAudio(Buffer.from(chunk));
});

ipcMain.handle('asr:stop', async () => {
  asrSession?.stop();
  asrSession = null;
  return { ok: true };
});
```
> 说明：上面 `connect()` 用一次性 `probe` 会话把"握手成败/是否 listening"变成可 await 的结果，从而实现"401 换新重试一次"。若想更简洁，可去掉重试、直接 `asrSession = new RealtimeAsrSession(...)` 后 start，靠 `onError` 上报——但保留重试能在临时 token 边界过期时无感恢复。

### 4.5 `electron/preload.ts`（修改）— 暴露 `asr`

在 `contextBridge.exposeInMainWorld('electronAPI', { ... })` 里加一个 `asr` 命名空间（仿 `terminal` 的 invoke + send + on 三种）：
```ts
  asr: {
    requestMicPermission: (): Promise<{ granted: boolean; error?: string }> =>
      ipcRenderer.invoke('asr:request-mic-permission'),
    start: (): Promise<{ ok: boolean; status?: number; error?: string }> =>
      ipcRenderer.invoke('asr:start'),
    sendAudio: (chunk: ArrayBuffer): void => ipcRenderer.send('asr:audio', chunk),
    stop: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('asr:stop'),
    onTranscript: (
      cb: (data: { kind: 'partial'; text: string; stash: string } | { kind: 'final'; transcript: string }) => void,
    ) => {
      const listener = (_e: unknown, data: unknown) => cb(data as never);
      ipcRenderer.on('asr:transcript', listener);
      return () => { ipcRenderer.removeListener('asr:transcript', listener); };
    },
    onState: (cb: (data: { state: string }) => void) => {
      const listener = (_e: unknown, data: unknown) => cb(data as { state: string });
      ipcRenderer.on('asr:state', listener);
      return () => { ipcRenderer.removeListener('asr:state', listener); };
    },
    onError: (cb: (data: { code: string; message: string }) => void) => {
      const listener = (_e: unknown, data: unknown) => cb(data as { code: string; message: string });
      ipcRenderer.on('asr:error', listener);
      return () => { ipcRenderer.removeListener('asr:error', listener); };
    },
  },
```

### 4.6 `src/types/electron.d.ts`（修改）— renderer 类型

在 `interface ElectronAPI { ... }`（约 166 行）里加：
```ts
  asr?: {
    requestMicPermission: () => Promise<{ granted: boolean; error?: string }>;
    start: () => Promise<{ ok: boolean; status?: number; error?: string }>;
    sendAudio: (chunk: ArrayBuffer) => void;
    stop: () => Promise<{ ok: boolean }>;
    onTranscript: (
      cb: (data: { kind: 'partial'; text: string; stash: string } | { kind: 'final'; transcript: string }) => void,
    ) => () => void;
    onState: (cb: (data: { state: string }) => void) => () => void;
    onError: (cb: (data: { code: string; message: string }) => void) => () => void;
  };
```

### 4.7 `public/asr-worklet.js`（新增）— PCM 抽取

```js
// AudioWorklet：把 16kHz Float32 帧累积成 100ms（1600 样本）的 Int16 PCM，
// 通过 port 传回主线程。注册名 'pcm-worklet'。
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(1600);
    this._n = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0]; // Float32Array，通常 128 样本
    for (let i = 0; i < ch.length; i++) {
      this._buf[this._n++] = ch[i];
      if (this._n === 1600) {
        const pcm = new Int16Array(1600);
        for (let j = 0; j < 1600; j++) {
          const s = Math.max(-1, Math.min(1, this._buf[j]));
          pcm[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]); // 转移所有权，零拷贝
        this._n = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PcmWorklet);
```

### 4.8 `src/hooks/useVoiceInput.ts`（新增）— 录音 + 状态机 + 文字组装

```ts
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceState = 'idle' | 'requesting' | 'connecting' | 'listening' | 'error';

interface Opts {
  /** 录音开始时输入框已有的文本（语音文字追加在它后面） */
  getBaseText: () => string;
  /** 把"基础文本 + 已落定 + 当前预览"整体写回输入框 */
  onUpdate: (full: string) => void;
  onErrorMessage?: (msg: string) => void;
}

export function useVoiceInput({ getBaseText, onUpdate, onErrorMessage }: Opts) {
  const [state, setState] = useState<VoiceState>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const cleanupListenersRef = useRef<Array<() => void>>([]);
  const baseRef = useRef('');
  const committedRef = useRef('');
  const listeningRef = useRef(false); // 仅在 WS listening 后才发音频

  // mounted-gate 避免 SSR/hydration 不匹配：服务端与首屏客户端都先 false（按钮不渲染），
  // 挂载后再探测 electronAPI（Electron 里 preload 已注入 → 变 true → 按钮出现）。
  // 若直接用 `typeof window !== 'undefined' && !!window.electronAPI?.asr` 会在 Electron 里
  // 触发 hydration mismatch（服务端无 electronAPI 渲染为 null，客户端有 → 渲染按钮）。
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(typeof window !== 'undefined' && !!window.electronAPI?.asr);
  }, []);

  const teardownAudio = useCallback(() => {
    listeningRef.current = false;
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(async () => {
    teardownAudio();
    cleanupListenersRef.current.forEach((fn) => fn());
    cleanupListenersRef.current = [];
    await window.electronAPI?.asr?.stop();
    setState('idle');
  }, [teardownAudio]);

  const start = useCallback(async () => {
    if (!supported) { onErrorMessage?.('voice unsupported (Electron only)'); return; }
    const asr = window.electronAPI!.asr!;
    try {
      // 1) 系统级麦克风授权（macOS TCC）
      setState('requesting');
      const perm = await asr.requestMicPermission();
      if (!perm.granted) { setState('error'); onErrorMessage?.('mic-permission-denied'); return; }

      // 2) 采集音频（renderer），强制 16k 单声道
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 16000 });
      ctxRef.current = ctx;
      if (ctx.sampleRate !== 16000) {
        // Electron(Chromium) 在 mac/win 上会 honor 16000；个别平台不认时需在 worklet 内重采样。
        console.warn('[voice] AudioContext sampleRate =', ctx.sampleRate, '(expected 16000)');
      }
      await ctx.audioWorklet.addModule('/asr-worklet.js');
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'pcm-worklet');
      nodeRef.current = node;
      // 仅在 WS 就绪(listening)后才发音频，避免连接前的帧无谓占用 IPC
      node.port.onmessage = (e) => { if (listeningRef.current) asr.sendAudio(e.data as ArrayBuffer); };
      source.connect(node);
      // 不接 ctx.destination，避免回放自己的声音

      // 3) 订阅主进程回推
      baseRef.current = getBaseText();
      committedRef.current = '';
      const sep = baseRef.current && !/\s$/.test(baseRef.current) ? ' ' : '';
      const offT = asr.onTranscript((d) => {
        if (d.kind === 'partial') {
          onUpdate(baseRef.current + sep + committedRef.current + d.text + d.stash);
        } else {
          committedRef.current += d.transcript;
          onUpdate(baseRef.current + sep + committedRef.current);
        }
      });
      const offS = asr.onState((s) => {
        if (s.state === 'connecting') setState('connecting');
        else if (s.state === 'listening') { listeningRef.current = true; setState('listening'); }
        else if (s.state === 'closed') { listeningRef.current = false; setState((p) => (p === 'listening' || p === 'connecting' ? 'idle' : p)); }
      });
      const offE = asr.onError((err) => { setState('error'); onErrorMessage?.(err.code + ': ' + err.message); });
      cleanupListenersRef.current = [offT, offS, offE];

      // 4) 开 WS
      setState('connecting');
      const r = await asr.start();
      if (!r.ok) { await stop(); setState('error'); onErrorMessage?.(r.error || 'asr-start-failed'); }
    } catch (e) {
      await stop();
      setState('error');
      onErrorMessage?.(e instanceof Error ? e.message : String(e));
    }
  }, [supported, getBaseText, onUpdate, onErrorMessage, stop]);

  useEffect(() => () => { void stop(); }, [stop]); // 卸载时清理

  return { state, supported, start, stop };
}
```

### 4.9 `src/components/chat/VoiceInputButton.tsx`（新增）

```tsx
'use client';
import { Microphone, Stop } from '@/components/ui/icon';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { useTranslation } from '@/hooks/useTranslation';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { showToast } from '@/hooks/useToast';
import type { TranslationKey } from '@/i18n';

export function VoiceInputButton({
  getBaseText,
  onUpdate,
}: {
  getBaseText: () => string;
  onUpdate: (full: string) => void;
}) {
  const { t } = useTranslation();
  const { state, supported, start, stop } = useVoiceInput({
    getBaseText,
    onUpdate,
    onErrorMessage: (code) => {
      const key = code === 'mic-permission-denied' ? 'composer.voiceInputDenied' : 'composer.voiceInputError';
      showToast({ type: 'error', message: t(key as TranslationKey) });
    },
  });
  if (!supported) return null; // 非 Electron 环境（如浏览器 dev）不显示

  const active = state === 'listening' || state === 'connecting' || state === 'requesting';
  return (
    <PromptInputButton
      onClick={active ? () => void stop() : () => void start()}
      tooltip={t((active ? 'composer.voiceInputStop' : 'composer.voiceInput') as TranslationKey)}
      className={active ? 'text-destructive animate-pulse' : ''}
    >
      {active ? <Stop size={16} /> : <Microphone size={16} />}
    </PromptInputButton>
  );
}
```

### 4.10 `src/components/chat/MessageInput.tsx`（修改）— 插入按钮 + 回填

import 区加：
```ts
import { VoiceInputButton } from './VoiceInputButton';
```
在 `<PromptInputTools>` 里、`<AttachFileButton />`（约 904 行）之后插入：
```tsx
                {/* 语音输入按钮 */}
                <VoiceInputButton
                  getBaseText={() => inputValue}
                  onUpdate={(full) => setInputValue(full)}
                />
```
> `inputValue` / `setInputValue` 已在本组件作用域内（分别见 141 / 149 行）。`setInputValue` 接受绝对字符串，并自动维护 sessionStorage 草稿，无需额外处理。

### 4.11 `src/components/ui/icon.tsx`（修改）— 加麦克风图标

图标统一从 `@phosphor-icons/react` 再导出。在 `export { ... } from "@phosphor-icons/react";` 列表里、字母序合适处加：
```ts
  Microphone,
  MicrophoneSlash,
```
（`Stop` 已在列表中，无需加。）

### 4.12 i18n — 三个文件同步加 `composer.voiceInput*`

> ⚠️ 三个文件必须同步，否则 `TranslationKey` 类型不匹配导致 tsc 报错。加在各自的 `composer.*` 块内（en.ts ~1160 行、zh.ts ~1144 行、zh-HK.ts ~1153 行之后）。

`src/i18n/en.ts`：
```ts
  'composer.voiceInput': 'Voice input',
  'composer.voiceInputStop': 'Stop recording',
  'composer.voiceInputDenied': 'Microphone permission denied. Enable it in System Settings › Privacy.',
  'composer.voiceInputError': 'Voice transcription failed. Please try again.',
```
`src/i18n/zh.ts`：
```ts
  'composer.voiceInput': '语音输入',
  'composer.voiceInputStop': '停止录音',
  'composer.voiceInputDenied': '麦克风权限被拒绝，请在系统设置 › 隐私与安全中开启。',
  'composer.voiceInputError': '语音转录失败，请重试。',
```
`src/i18n/zh-HK.ts`：
```ts
  'composer.voiceInput': '語音輸入',
  'composer.voiceInputStop': '停止錄音',
  'composer.voiceInputDenied': '麥克風權限被拒絕，請在系統設定 › 私隱與安全性中開啟。',
  'composer.voiceInputError': '語音轉錄失敗，請重試。',
```

### 4.13 `build/entitlements.mac.plist`（修改）— 麦克风 entitlement

在 `<dict>` 内加（hardened runtime 下访问麦克风必需）：
```xml
  <key>com.apple.security.device.audio-input</key>
  <true/>
```

### 4.14 `electron-builder.yml`（修改）— Info.plist 用途说明

在 `mac:` 小节内（约 125 行）加 `extendInfo`（**缺这条会在调用麦克风时直接崩溃**，Apple 强制）：
```yaml
mac:
  icon: build/icon.icns
  # …现有字段…
  extendInfo:
    NSMicrophoneUsageDescription: "CodePilot 需要使用麦克风，以支持语音输入（将你的说话实时转写为文字）。"
```

---

## 5. 临时 token 缓存策略（已实测）

- 服务端用 `?expire_in_seconds=1800` 换 **30 分钟** token（见服务端文档；放 query string 才生效）。
- 主进程缓存 `{token, expiresAt}`，距过期 <120s 才换新；**token 可跨多次 WS 连接复用**（实测连开 5 次握手全 OK）。
- 故服务器开销极小：每个活跃用户 **≤1 次换 token / 30 分钟**；音频不经过服务器。
- 兜底：WS 握手返回 401 → `invalidateAsrToken()` + 换新重试一次（已写在 `asr:start`）。

## 6. 状态机与回填

```
idle ──点击──▶ requesting(系统授权) ──▶ connecting(开WS) ──▶ listening
  ▲                                                            │
  └────────────── 再次点击/出错/对端关闭 ◀──────────────────────┘
```
- 回填：录音开始记下 `baseText`（输入框原有文本）。`partial` → 显示 `base + 已落定 + (text+stash)`；`final` → `已落定 += transcript`。停止后文字留在输入框，可继续编辑/发送。
- `stash` 是"暂定后缀"，会随后续音频变化；如需更精致可把 `stash` 部分以更淡颜色渲染（需改 textarea 为可富文本，初版不必，直接当普通文本拼接即可）。

## 7. 权限矩阵

| 平台 | 需要 | 已覆盖于 |
|---|---|---|
| macOS | ① Info.plist `NSMicrophoneUsageDescription`（4.14）② 运行时 `askForMediaAccess`（4.4c）③ entitlement（4.13）④ Electron session 放行（4.4b） | 全部 |
| Windows | OS 层无需声明；`askForMediaAccess` 在非 darwin 直接 true；Electron session 放行 | 4.4b/4.4c |
| Linux | 同 Windows | 4.4b/4.4c |

## 8. 错误处理矩阵

| 场景 | 表现 | 处理 |
|---|---|---|
| 用户拒绝系统麦克风 | `requestMicPermission` 返回 `granted:false` | toast `composer.voiceInputDenied`，状态回 idle |
| 临时 token 过期/失效 | WS 握手 401 | 自动清缓存换新重试一次（无感） |
| 网络/百炼不可达 | WS error / 握手非 401 失败 | toast `composer.voiceInputError` |
| `…transcription.failed` / `error` 事件 | 识别失败 | toast `composer.voiceInputError`，可继续重试 |
| 非 Electron 环境（浏览器 dev） | `supported=false` | 按钮不渲染 |

## 9. 验证步骤（提交前必做）

1. `npm run dev` 起 Next，`npm run electron:dev` 起桌面（本地无登录体系，换 token 接口会 401 —— 用 mock：临时把 `getAsrToken()` 改成直接用测试 `sk-` key 走 4.3 的逻辑连百炼，或 mock `fetchAsrToken` 返回 `POST /api/v1/tokens?expire_in_seconds=1800` 的结果；**验证完务必改回**）。
2. 用 chrome-devtools MCP 打开页面，点击麦克风按钮，授权麦克风，说一句中文，确认：①按钮进入"聆听"态 ②输入框实时出现文字 ③停顿后文字落定 ④console 无报错。
3. 打一次包（`npm run electron:pack:mac`），实机验证 macOS 授权弹框文案、签名后麦克风可用（dev 与签名包行为可能不同）。
4. 提交前关闭 dev server，清理任何 mock 改动。

## 10. 可配置项

| 变量 | 默认 | 位置 |
|---|---|---|
| `ASR_MODEL` | `qwen3-asr-flash-realtime-2026-02-10` | `electron/asr/realtime-session.ts` |
| 识别语种 | `zh` | `RealtimeAsrSession` 第三参 / `asr:start` |
| VAD 阈值/静音 | `0.2` / `800ms` | `session.update` |
| token 刷新余量 | `120s` | `token-cache.ts` |
| 换 token 接口路径 | `/api/v1/asr/token` | `electron/auth/client.ts` |

---

## 附：实现顺序建议

1. 先做服务端 `/api/v1/asr/token`（见服务端文档），或本地用测试 key mock。
2. 客户端：`realtime-session.ts` + `token-cache.ts` + `client.ts` → 主进程 IPC → preload/types。
3. worklet + `useVoiceInput` + 按钮 + 接入 MessageInput。
4. i18n + 图标 + 权限/构建配置。
5. 全链路 CDP 验证 → 打包验证。
