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
