/**
 * codepilot-routines MCP —— 在办公对话里直接管理沙箱定时任务(P7)。
 *
 * 这是定时任务的**第二条创建路径**,也是最自然的一条:用户正在办公对话里聊着
 * 「这个报表以后每天都要」,一句话就能建。第一条路径是「定时任务」页里点新建。
 *
 * ## 🔴 只在办公会话注册
 * 研发会话没有沙箱,建了也跑不了。接线在 `claude-client.ts`,判据是 `coworkActive`。
 * 内置的 `codepilot-*` in-process 服务器跑在**宿主侧**的 SDK 控制通道上,所以沙箱回合
 * 照样能用(与被丢弃的外部 stdio MCP 不同)。
 *
 * ## 🔴 与本地 `codepilot_schedule_task` 的区分
 * `notification-mcp.ts` 里有一套同名相近的工具,建的是**跑在用户电脑上**的本地任务
 * (界面早已隐藏,D16 待清理)。办公会话里两套并存的话,模型有很大概率挑错 —— 而挑错的
 * 后果极其隐蔽:任务建成功了、用户也看到「已创建」,但它永远不会在沙箱上跑,也没有任何
 * 界面能看到它。所以办公回合里那三个本地调度工具**整个不注册**
 * (`createNotificationMcpServer({ omitScheduling: true })`),让模型没得挑。
 *
 * ## 🔴 创建成功后必须说清结果去哪
 * 改版后定时任务的会话**不进办公对话列表**,于是引入一个新的失败模式:用户在这个对话里
 * 说「以后每天九点做日报」,助手答「已创建」,然后用户就**在这个对话里一直等** ——
 * 结果永远不会出现在这里。所以每个创建/立即运行的成功返回里都带着那句话,
 * 见 `WHERE_RESULTS_GO`。
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  listRoutines, createRoutine, updateRoutine, deleteRoutine, runRoutineNow,
  RoutinesUnavailableError, RoutinesHttpError,
} from './routines-client';

/** 每次创建/触发成功都要带上的一句。少了它,用户会在当前对话里干等一个不会来的结果。 */
const WHERE_RESULTS_GO =
  '运行结果会出现在左侧「定时任务」里,不会打扰这个对话。';

export const ROUTINES_MCP_SYSTEM_PROMPT = `## 定时任务(跑在沙箱服务器上)

当前是**办公会话**,你可以为用户创建定时任务。这些任务跑在**公司沙箱服务器**上,
用户关掉客户端、关掉电脑都照常运行。

- codepilot_create_routine: 创建定时任务
- codepilot_list_routines: 查看已有的定时任务
- codepilot_update_routine: 修改(改指令/调度/启用停用)
- codepilot_delete_routine: 删除(连同它的工作区文件和运行历史)
- codepilot_run_routine_now: 立即跑一次(不等下次触发)

### 🔴 三条必须遵守的

1. **不要静默创建。** 先把你打算写进去的**完整指令**复述给用户确认。用户说的
   「每天给我做个日报」离一条能独立跑的指令还差很远,而指令写得对不对是这个功能成败的关键。
2. **指令必须能独立看懂。** 每次运行都是全新对话,没有上下文、也没人能回答追问。
   所以指令里要写清楚:读哪个文件、产出什么、**异常时怎么办**(比如"如果源文件不存在,
   不要臆造数据,直接说明情况并结束")。不要写成对当前对话的追问。
3. **创建成功后必须告诉用户结果去哪。** 原话:「${WHERE_RESULTS_GO}」
   —— 定时任务产生的会话**不在**办公对话列表里,不说这句用户会在这个对话里一直等。

### 其它约束
- 最小触发间隔 **15 分钟**;实际触发会有几分钟固定偏移(错开服务器负载)
- 每人最多 **50 个**任务、每天 **20 次**运行
- 每个任务**独占一个工作区**,多次运行之间**文件会累积保留**(昨天生成的表今天能接着读),
  但**上下文不累积**
- 任务**不能访问内网**
- schedule 三种:\`{kind:'cron', expr:'分 时 日 月 周', tz:'Asia/Shanghai'}\` /
  \`{kind:'once', fireAt:'ISO 时刻'}\` / \`{kind:'manual'}\`(只手动触发)`;

const scheduleSchema = z.object({
  kind: z.enum(['cron', 'once', 'manual']).describe('cron=按表达式重复, once=指定时刻跑一次, manual=只能手动触发'),
  expr: z.string().optional().describe('kind=cron 时的 5 字段表达式,如 "0 9 * * 1-5" 表示工作日 09:00'),
  tz: z.string().optional().describe('kind=cron 时的 IANA 时区,如 Asia/Shanghai。不给则服务端用默认'),
  fireAt: z.string().optional().describe('kind=once 时的 ISO 触发时刻'),
});

/**
 * 错误 → 给模型看的一句话。
 *
 * 服务端的 400 校验消息本来就是**面向用户的中文**(如「触发间隔 5 分钟,低于最小间隔 15 分钟」),
 * 原样透出去比自己编一句「创建失败」有用得多 —— 模型能据此直接告诉用户改哪儿。
 */
function errText(e: unknown, action: string): string {
  if (e instanceof RoutinesUnavailableError) {
    return `${action}失败:这个账号还没开通办公沙箱,定时任务不可用。`;
  }
  if (e instanceof RoutinesHttpError) {
    if (e.status === 429) return `${action}失败(被限流):${e.message}`;
    if (e.status === 404) return `${action}失败:找不到这个定时任务(可能已被删除)。`;
    return `${action}失败:${e.message}`;
  }
  return `${action}失败:${e instanceof Error ? e.message : String(e)}`;
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });

/** 一条 routine 的单行摘要,列表与创建回执共用。 */
function summarize(r: { id: string; name: string; schedule?: { kind: string; expr?: string; tz?: string; fireAt?: string }; enabled: boolean; nextRunAt?: string | null; model?: string }): string {
  const s = r.schedule;
  const when = s?.kind === 'cron' ? `cron ${s.expr}${s.tz ? ` (${s.tz})` : ''}`
    : s?.kind === 'once' ? `一次性 ${s.fireAt}`
    : '仅手动触发';
  return [
    `- ${r.name} [${r.id}]`,
    `  调度:${when}${r.enabled ? '' : '(已停用)'}`,
    r.nextRunAt ? `  下次:${r.nextRunAt}` : '',
    r.model ? `  模型:${r.model}` : '',
  ].filter(Boolean).join('\n');
}

export function createRoutinesMcpServer() {
  return createSdkMcpServer({
    name: 'codepilot-routines',
    version: '1.0.0',
    tools: [
      tool(
        'codepilot_create_routine',
        'Create a scheduled task that runs on the company sandbox server (keeps running when the user closes the app). Restate the full prompt to the user for confirmation BEFORE calling this. The prompt must be self-contained — every run is a fresh conversation with no context and nobody to answer follow-up questions.',
        {
          name: z.string().describe('任务名,显示在列表里,如「每日销售日报」'),
          prompt: z.string().describe('每次运行时执行的完整指令。必须能独立看懂,并写清楚异常时怎么办'),
          schedule: scheduleSchema,
          description: z.string().optional().describe('一句话说明,显示在列表卡片上'),
          model: z.string().optional().describe('模型 id。不给则跟随账号配置的第一个(推荐不给)'),
        },
        async ({ name, prompt, schedule, description, model }) => {
          try {
            const r = await createRoutine({ name, prompt, schedule, description, model });
            return ok([
              `已创建定时任务:`,
              summarize(r),
              '',
              // 🔴 这句是硬要求,不是客套。见文件头。
              WHERE_RESULTS_GO,
            ].join('\n'));
          } catch (e) {
            return ok(errText(e, '创建定时任务'));
          }
        },
      ),

      tool(
        'codepilot_list_routines',
        'List the scheduled tasks that run on the sandbox server. Use when the user asks what scheduled tasks exist.',
        {},
        async () => {
          try {
            const rs = await listRoutines();
            if (rs.length === 0) return ok('还没有定时任务。');
            return ok([`共 ${rs.length} 个定时任务:`, ...rs.map(summarize)].join('\n'));
          } catch (e) {
            return ok(errText(e, '读取定时任务'));
          }
        },
      ),

      tool(
        'codepilot_update_routine',
        'Update a scheduled task — change its prompt, schedule, name, model, or enable/disable it. Only pass the fields you want to change.',
        {
          id: z.string().describe('任务 id(先用 codepilot_list_routines 拿到)'),
          name: z.string().optional(),
          prompt: z.string().optional().describe('新的完整指令。同样必须能独立看懂'),
          schedule: scheduleSchema.optional(),
          description: z.string().optional(),
          model: z.string().optional(),
          enabled: z.boolean().optional().describe('false=暂停(不再自动触发),true=恢复'),
        },
        async ({ id, ...patch }) => {
          const body = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
          if (Object.keys(body).length === 0) return ok('没有要改的字段。');
          try {
            const r = await updateRoutine(id, body);
            return ok([`已更新:`, summarize(r)].join('\n'));
          } catch (e) {
            return ok(errText(e, '更新定时任务'));
          }
        },
      ),

      tool(
        'codepilot_delete_routine',
        'Delete a scheduled task. This also deletes its workspace files and run history permanently — confirm with the user before calling.',
        { id: z.string().describe('任务 id') },
        async ({ id }) => {
          try {
            await deleteRoutine(id);
            return ok('已删除。它的工作区文件和运行历史也一并删除了。');
          } catch (e) {
            return ok(errText(e, '删除定时任务'));
          }
        },
      ),

      tool(
        'codepilot_run_routine_now',
        'Trigger a scheduled task immediately instead of waiting for its next scheduled time. Useful right after creating one, to let the user see what it produces.',
        { id: z.string().describe('任务 id') },
        async ({ id }) => {
          try {
            await runRoutineNow(id);
            return ok(`已开始运行。${WHERE_RESULTS_GO}`);
          } catch (e) {
            return ok(errText(e, '立即运行'));
          }
        },
      ),
    ],
  });
}
