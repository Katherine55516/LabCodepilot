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
