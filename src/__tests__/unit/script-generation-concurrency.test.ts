/**
 * 生成阶段并发（两阶段：模型调用并发 / 校验落盘串行）的行为契约。
 *
 * 背景：单条脚本生成实测 ~120s，大头是【等模型返回】（跨境链路 latency-bound）。这类等待型
 * 工作只有并发能成倍改善。但校验/重放会起 Playwright 真跑被测应用，**必须串行** —— 多个
 * 浏览器并发操作同一个 SUT 会互相踩数据（真机已见测试库堆出 5 条同名「前端开发」）。
 *
 * 这里不接真实模型，用可控的假实现验证编排本身的性质：并发度、串行落盘、顺序确定、
 * 单条失败隔离、中止传播。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * 复刻 generateMissing 的两阶段编排（同一套 pump/游标逻辑）。
 * 生产实现依赖 SDK/Playwright/文件系统，无法在单测中直接驱动；此处验证的是编排契约，
 * 与生产代码保持结构一致 —— 改动生产编排时这里必须同步，否则契约失去意义。
 */
async function orchestrate<T>(
  items: string[],
  concurrency: number,
  generate: (id: string) => Promise<T | { error: string }>,
  publish: (id: string, value: T) => Promise<void>,
  onFailed: (id: string, error: string) => void,
  aborted: () => boolean = () => false,
): Promise<void> {
  const inFlight = new Map<string, Promise<T | { error: string }>>();
  let cursor = 0;
  const pump = () => {
    while (inFlight.size < concurrency && cursor < items.length) {
      const id = items[cursor++];
      inFlight.set(id, generate(id));
    }
  };
  pump();
  for (const id of items) {
    if (aborted()) throw new Error('aborted');
    const pending = inFlight.get(id);
    const outcome = pending ? await pending : await generate(id);
    inFlight.delete(id);
    pump();
    if (outcome && typeof outcome === 'object' && 'error' in outcome) {
      onFailed(id, (outcome as { error: string }).error);
      continue;
    }
    await publish(id, outcome as T);
  }
}

const IDS = ['a', 'b', 'c', 'd', 'e', 'f'];
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('生成阶段并发编排', () => {
  it('模型调用并发不超过设定上限', async () => {
    let live = 0;
    let peak = 0;
    await orchestrate(IDS, 3,
      async (id) => { live++; peak = Math.max(peak, live); await tick(); live--; return id; },
      async () => { await tick(); },
      () => {},
    );
    assert.ok(peak > 1, `应当真的并发（实测峰值 ${peak}）`);
    assert.ok(peak <= 3, `并发度不得超过上限 3（实测峰值 ${peak}）`);
  });

  it('校验落盘严格串行 —— 并发跑 Playwright 会踩同一个被测系统', async () => {
    let livePublish = 0;
    let peakPublish = 0;
    await orchestrate(IDS, 3,
      async (id) => { await tick(); return id; },
      async () => { livePublish++; peakPublish = Math.max(peakPublish, livePublish); await tick(); livePublish--; },
      () => {},
    );
    assert.equal(peakPublish, 1, '落盘阶段任何时刻只能有一条在跑');
  });

  it('落盘顺序与候选顺序一致（先到的先算好放着，轮到谁取谁）', async () => {
    // 故意让后面的先算完：若按「谁先完成谁先落盘」，顺序会乱。
    const delays: Record<string, number> = { a: 40, b: 5, c: 5, d: 5, e: 5, f: 5 };
    const published: string[] = [];
    await orchestrate(IDS, 3,
      async (id) => { await new Promise((r) => setTimeout(r, delays[id])); return id; },
      async (id) => { published.push(id); },
      () => {},
    );
    assert.deepEqual(published, IDS, '结果顺序必须确定，不受完成先后影响');
  });

  it('单条失败被隔离，其余照常落盘', async () => {
    const published: string[] = [];
    const failed: string[] = [];
    await orchestrate(IDS, 3,
      async (id) => (id === 'c' ? { error: '生成失败' } : id),
      async (id) => { published.push(id); },
      (id) => { failed.push(id); },
    );
    assert.deepEqual(failed, ['c']);
    assert.deepEqual(published, ['a', 'b', 'd', 'e', 'f'], '一条失败不得拖累其余');
  });

  it('每条都被处理恰好一次（pump 补位不重复、不遗漏）', async () => {
    const seen: string[] = [];
    await orchestrate(IDS, 3,
      async (id) => { seen.push(id); await tick(); return id; },
      async () => {},
      () => {},
    );
    assert.equal(seen.length, IDS.length);
    assert.equal(new Set(seen).size, IDS.length, '不得重复生成（重复即重复烧 token）');
  });

  it('候选数少于并发度时不出错', async () => {
    const published: string[] = [];
    await orchestrate(['only'], 3, async (id) => id, async (id) => { published.push(id); }, () => {});
    assert.deepEqual(published, ['only']);
  });

  it('中止信号立即冒泡，不继续落盘', async () => {
    let aborted = false;
    const published: string[] = [];
    await assert.rejects(
      () => orchestrate(IDS, 3,
        async (id) => id,
        async (id) => { published.push(id); if (published.length === 2) aborted = true; },
        () => {},
        () => aborted),
      /aborted/,
    );
    assert.equal(published.length, 2, '中止后不得再落盘');
  });
});
