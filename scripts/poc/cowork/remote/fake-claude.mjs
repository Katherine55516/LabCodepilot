#!/usr/bin/env node
/**
 * mac 本机验协议用的"模拟 claude"——不需要凭证,只验通道字节语义。
 * 行为贴近 claude 的 stream-json stdio:
 *   - 启动即发一条 init 行(证明 stdout 立刻回流,非缓冲)
 *   - 每收到一行 stdin(帧解出来的原始字节)→ 回一条 assistant 行(证明双向 + 内容穿透)
 *   - stdin EOF(← 零长度帧 → shim 关 claude stdin)→ 发 result 行 → 退出 0(证明优雅收尾)
 * abort 时它会被 shim 的 watch_abort 杀掉(收不到 result,进程消失)。
 */
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', pid: process.pid }) + '\n');

let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    process.stdout.write(JSON.stringify({ type: 'assistant', echo_len: line.length, echo_head: line.slice(0, 48) }) + '\n');
  }
});
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', done: true }) + '\n');
  process.exit(0);
});
