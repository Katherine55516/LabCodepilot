import fs from 'fs';
import path from 'path';

/**
 * 测试工作台 · 操作审计(需求:门控与关键操作全程留痕)。
 *
 * 一条操作 = 一行 JSON(JSONL,追加写)。文件按任务落在
 * `<projectPath>/AI_LabTest/audit/<taskName>.jsonl` —— 独立于 `AI_LabTest/report/<task>/`,
 * 删任务只删 report 目录与证据(见 reports/delete),审计文件天然留痕、随项目目录可交付。
 * 全链路 best-effort:追加失败静默,绝不阻塞业务主流程。
 */
export interface AuditEvent {
  /** ISO 时间戳,服务端生成(前端时钟不可信)。 */
  time: string;
  /** 前端任务 id(workbench.json 键;任务删除后靠 taskName 溯源)。 */
  taskId?: string;
  /** requirement | cases | execution | report;与具体步骤无关的动作缺省。 */
  step?: string;
  /**
   * approve(批准门控) | run(运行某步) | run-task(点「运行任务」起跑流水线) |
   * chat-action(对话 @@ACTION 建议的确认) | revise(对话式修订产物) | stop(停止) |
   * auto-approve(排队提升时旧待批准产物自动确认) | import(导入需求/用例) |
   * edit-cases(用例编辑保存) | delete-task(删除任务) | recommend-suite(AI 推荐回归集)
   */
  action: string;
  /** manual(用户点击) | batch(排队/批量自动) | auto(auto-chain 接力)。 */
  mode: string;
  /** 补充说明(修订指令摘要 / 导入文件名 / 推荐变更条数等)。 */
  detail?: string;
}

/** 审计文件路径(调用方保证 taskName 已过 isUnsafeSegment 校验)。 */
export function auditFile(projectPath: string, taskName: string): string {
  return path.join(projectPath, 'AI_LabTest', 'audit', `${taskName}.jsonl`);
}

/** 追加一条审计事件(time 由本函数生成;失败静默)。 */
export async function appendAudit(
  projectPath: string,
  taskName: string,
  event: Omit<AuditEvent, 'time'>,
): Promise<void> {
  try {
    const f = auditFile(projectPath, taskName);
    await fs.promises.mkdir(path.dirname(f), { recursive: true });
    const line = JSON.stringify({ time: new Date().toISOString(), ...event });
    await fs.promises.appendFile(f, line + '\n', 'utf-8');
  } catch {
    /* 审计 best-effort,绝不抛给调用方 */
  }
}

/** 读取任务全部审计事件,最新在前。文件不存在 → [];坏行跳过不影响其余。 */
export async function readAudit(projectPath: string, taskName: string): Promise<AuditEvent[]> {
  try {
    const raw = await fs.promises.readFile(auditFile(projectPath, taskName), 'utf-8');
    const events: AuditEvent[] = [];
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        events.push(JSON.parse(s) as AuditEvent);
      } catch {
        /* skip malformed line */
      }
    }
    return events.reverse();
  } catch {
    return [];
  }
}
