/**
 * 沙箱回合的两条护栏(2026-08 线上事故补的)。
 *
 * 背景:办公模式下带 --resume 的回合曾 100% 失败且**完全静默** —— 容器被 TTL 回收后
 * HOME(tmpfs)清空,claude 找不到会话记录,打 "No conversation found with session ID"
 * 后 exit 1;转发器把退出码抹平成 0,SDK 于是既不抛错也不产出消息,回合悄无声息地结束。
 * 客户端侧补两条:
 *   ① 转发器必须能被拉起 —— .mjs 转发器要显式给运行时,否则 SDK 去 spawn PATH 里的
 *      字面量 "node",打包版 Electron 没有独立 node,用户机器没装就整条办公模式不可用;
 *   ② 首消息不能裸 await —— 超时要能退出去走兜底(挂住那一类)。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from '@/lib/claude-client';

describe('withTimeout — resume 首消息护栏', () => {
  it('在时限内完成就原样返回', async () => {
    assert.equal(await withTimeout(Promise.resolve('ok'), 1000, 'x'), 'ok');
  });

  it('原始 promise 自己失败时,原样抛它的错(不被超时信息盖掉)', async () => {
    await assert.rejects(
      withTimeout(Promise.reject(new Error('boom')), 1000, 'x'),
      /boom/,
    );
  });

  it('超时抛错,错误信息带 label 与时限(日志据此定位是哪一步挂了)', async () => {
    // keepAlive 不是装饰:本用例 await 的 promise 永不 settle,而 withTimeout 的
    // 超时定时器是 unref 的(生产上正确——不能为了一个超时把进程吊住)。于是这
    // 20ms 里事件循环可能没有任何 ref 句柄,Node 直接退出进程,本用例连同其后的
    // 用例被判 cancelledByParent。macOS 本地不复现(有别的句柄撑着),Linux CI 上
    // 必现——2026-08-15 首次把 scheduler 合进 para 时,CI 连挂两轮就是这里。
    const keepAlive = setInterval(() => { /* 撑住事件循环 */ }, 1000);
    try {
      await assert.rejects(
        withTimeout(new Promise(() => { /* 永不 settle,模拟"首消息永远不来" */ }), 20, 'resume first message'),
        /resume first message timed out after 20ms/,
      );
    } finally {
      clearInterval(keepAlive);
    }
  });

  it('超时后不吊住事件循环(定时器 unref + clear);先完成的一方不受后到的超时影响', async () => {
    // 若定时器没被清掉,这个 100ms 的等待会被 20ms 的 reject 打断成 unhandled rejection。
    const slow = new Promise((r) => setTimeout(() => r('late'), 40));
    assert.equal(await withTimeout(slow, 1000, 'x'), 'late');
  });
});

describe('remote 后端 execEndpoint — 转发器运行时', () => {
  it('给出 runtimeExecutable=process.execPath(不给的话 SDK 会去 spawn PATH 里的 node)', async () => {
    const { remoteBackend } = await import('@/lib/cowork-backend-remote');
    const ep = remoteBackend.execEndpoint('a1b2c3d4e5f6a7b8');
    assert.equal(ep.runtimeExecutable, process.execPath);
    // 配套:转发器以 Electron 二进制跑时必须带这个,否则起的是 Electron 而不是 node 运行时。
    assert.equal(ep.env.ELECTRON_RUN_AS_NODE, '1');
    assert.ok(ep.forwarderPath.endsWith('.mjs'), `转发器应是 .mjs:${ep.forwarderPath}`);
  });
});
