/**
 * 定时任务的创建入口(P7)。
 *
 * 这里锁的两条都不是「功能有没有」,而是「用错了会不会有人发现」——
 * 两条都属于**成功了但用户什么也没得到**的那一类,测试是唯一的护栏。
 *
 * 1. **本地定时任务工具必须彻底消失。** 它建的任务跑在用户电脑上、关机就不跑,而且那套
 *    界面早已隐藏。留着它,模型在办公会话里有很大概率挑错 —— 而挑错的表现是「已创建」,
 *    没有任何报错,用户要等到第二天发现什么都没发生才知道。
 * 2. **创建成功的回复必须说清结果去哪。** 定时任务的会话不进办公对话列表(用户否掉过
 *    混排),所以用户会在当前对话里等一个永远不会来的结果。这句话是改版引入的新失败模式
 *    的唯一解药。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// 与仓库里其它读源码的测试同姿态(见 claude-session-parser.test.ts)
const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 本机定时任务工具的三个名字。 */
const LOCAL_TASK_TOOLS = ['codepilot_schedule_task', 'codepilot_list_tasks', 'codepilot_cancel_task'];

/**
 * 通往模型的**两条**独立路径,都要查。
 *
 * 踩过:第一次只删了 MCP 那条,以为干净了 —— 其实 native runtime 走的是 AI SDK 的
 * `tool()`,在 `builtin-tools/notification.ts` 里有**同样三个工具的第二份实现**,
 * 模型在那条路径上照样能调。所以这里按「路径」列举而不是按文件,新增运行时时容易想起来补。
 */
const MODEL_FACING_TOOL_SOURCES = [
  ['SDK/MCP 路径', 'src/lib/notification-mcp.ts'],
  ['native runtime / AI SDK 路径', 'src/lib/builtin-tools/notification.ts'],
] as const;

describe('本地定时任务工具已下线', () => {
  const notify = read('src/lib/notification-mcp.ts');

  for (const [label, file] of MODEL_FACING_TOOL_SOURCES) {
    for (const name of LOCAL_TASK_TOOLS) {
      it(`${label}:${file.split('/').pop()} 里不再有 ${name}`, () => {
        assert.ok(
          !read(file).includes(name),
          `${name} 还在(${label})—— 模型在这条路径上会建出一个跑在用户电脑上、关机就停、` +
          `而且没有任何界面能看到的任务,表现却是「已创建」`,
        );
      });
    }
  }

  it('notification-mcp 不再 import 本地调度引擎', () => {
    // 只查真实 import —— 文件头注释里会提到 task-scheduler(说明引擎为何暂留),那是文档不是依赖
    assert.ok(
      !/import\(['"]@\/lib\/task-scheduler['"]\)/.test(notify) && !/from ['"]@\/lib\/task-scheduler['"]/.test(notify),
      '还在 import task-scheduler,说明有工具没删干净',
    );
  });

  it('保留的两个工具没被误删', () => {
    assert.ok(notify.includes("'codepilot_notify'"), 'codepilot_notify 被误删了');
    assert.ok(notify.includes("'codepilot_hatch_buddy'"), 'codepilot_hatch_buddy 被误删了');
  });

  it('两条路径的系统提示词里也不再宣传它们', () => {
    // 工具删了但提示词还在教怎么用,模型会去调一个不存在的工具 —— 报错难懂,不如一起清
    for (const [label, file] of MODEL_FACING_TOOL_SOURCES) {
      const src = read(file);
      for (const name of LOCAL_TASK_TOOLS) {
        assert.ok(!src.includes(name), `${label} 的提示词还在教模型用 ${name}`);
      }
    }
  });
});

describe('routines MCP', () => {
  const mcp = read('src/lib/routines-mcp.ts');

  it('五个工具齐全', () => {
    for (const name of [
      'codepilot_create_routine', 'codepilot_list_routines',
      'codepilot_update_routine', 'codepilot_delete_routine', 'codepilot_run_routine_now',
    ]) {
      assert.ok(mcp.includes(`'${name}'`), `缺 ${name}`);
    }
  });

  it('🔴 创建成功的回复带「结果会出现在左侧定时任务里」', () => {
    // 这句话在改版后是硬要求:结果不再落进当前对话,不说用户就会一直等
    assert.match(mcp, /运行结果会出现在左侧「定时任务」里/);
    const createBlock = mcp.slice(mcp.indexOf("'codepilot_create_routine'"), mcp.indexOf("'codepilot_list_routines'"));
    assert.ok(createBlock.includes('WHERE_RESULTS_GO'), '创建工具的成功返回里没带这句话');
  });

  it('🔴 立即运行的回复也带这句话', () => {
    const runBlock = mcp.slice(mcp.indexOf("'codepilot_run_routine_now'"));
    assert.ok(runBlock.includes('WHERE_RESULTS_GO'), '立即运行的回复没说结果去哪');
  });

  it('系统提示词要求先复述确认、不静默创建', () => {
    assert.match(mcp, /不要静默创建/);
    assert.match(mcp, /指令必须能独立看懂/);
  });
});

describe('MCP 注册门控', () => {
  const client = read('src/lib/claude-client.ts');

  it('🔴 routines MCP 只在办公(沙箱)会话注册', () => {
    const i = client.indexOf("'codepilot-routines'");
    assert.ok(i > 0, 'routines MCP 没接线');
    // 往前找最近的条件:必须是 coworkActive
    const before = client.slice(Math.max(0, i - 900), i);
    assert.match(
      before, /if \(coworkActive\)/,
      '不是按 coworkActive 门控 —— 研发会话没有沙箱,建了也跑不了,不该让模型看见这些工具',
    );
  });
});

describe('存为定时任务的草稿传递', () => {
  const draft = read('src/lib/routine-draft.ts');

  it('读完即焚', () => {
    const take = draft.slice(draft.indexOf('export function takeRoutineDraft'));
    assert.ok(
      take.includes('removeItem'),
      '取完没清 —— 用户下次正常点「新建」会莫名看到上次那段指令',
    );
  });

  it('剥掉附件元信息且不用 ES2018 的 s 标志', () => {
    assert.ok(draft.includes('stripFileMeta'));
    assert.ok(!/\/[su]*s[su]*,\s*''\)/.test(draft), '用了 s 标志,编译目标不支持');
    assert.ok(draft.includes('[\\s\\S]'), '应该用 [\\s\\S] 代替 . + s 标志');
  });
});
