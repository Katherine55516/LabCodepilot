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
