import fs from 'fs';
import path from 'path';
import { roundDirRel } from './rounds';

/**
 * 测试工作台 · 回归轮次的 AI 失败归因(v2 二期)。
 *
 * 产物落 `report/回归用例库/{roundId}/verdicts.json`,与该轮的 run.json 同目录、随轮删除——
 * **归因是「这一轮的解读」,不是库用例的属性**。同一条用例这轮判「产品缺陷」、下轮修好了就
 * 不该在库里留下一条永久标记。
 *
 * 归因是 AI 给的**建议**不是结论:UI 必须标明来源(「AI 归因」),转缺陷仍走人工确认。
 */

/** 归因分类。四类穷尽了「这条为什么挂」的可行动方向。 */
export type VerdictClass = '产品缺陷' | '测试用例问题' | '环境问题' | '疑似 flaky';

export const VERDICT_CLASSES: readonly VerdictClass[] = ['产品缺陷', '测试用例问题', '环境问题', '疑似 flaky'];

export interface CaseVerdict {
  /** 归因分类。 */
  cls: VerdictClass;
  /** 建议动作(一句话,面向「下一步做什么」)。 */
  act: string;
  /** 判定理由(引用实际结果/错误/跨轮历史,不臆造)。 */
  why: string;
}

export interface VerdictsFile {
  version: number;
  roundId: string;
  generatedAt: string;
  /** 键 = `{task}\u0000{originalId}`(与库条目身份对齐)。 */
  verdicts: Record<string, CaseVerdict>;
}

const VERDICTS_VERSION = 1;

export function verdictsFile(projectPath: string, roundId: string): string {
  return path.join(projectPath, roundDirRel(roundId), 'verdicts.json');
}

/** 条目身份 → verdicts 键(NUL 分隔;任务名可含空格)。 */
export function verdictKey(task: string, originalId: string): string {
  return `${task}\u0000${originalId}`;
}

function isVerdict(v: unknown): v is CaseVerdict {
  if (!v || typeof v !== 'object') return false;
  const c = v as CaseVerdict;
  return VERDICT_CLASSES.includes(c.cls) && typeof c.act === 'string' && typeof c.why === 'string';
}

/**
 * 读某轮归因。缺文件/坏 JSON → null(报告页据此显示「未归因」并给出触发按钮);
 * 单条坏记录跳过,不拖垮整份。
 */
export function readVerdicts(projectPath: string, roundId: string): Record<string, CaseVerdict> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(verdictsFile(projectPath, roundId), 'utf-8')) as VerdictsFile;
    if (!parsed || typeof parsed !== 'object' || !parsed.verdicts || typeof parsed.verdicts !== 'object') return null;
    const out: Record<string, CaseVerdict> = {};
    for (const [k, v] of Object.entries(parsed.verdicts)) if (isVerdict(v)) out[k] = v;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** 原子写某轮归因(.tmp + rename)。目录必然已存在(轮次产物目录先于归因创建)。 */
export function writeVerdicts(projectPath: string, roundId: string, verdicts: Record<string, CaseVerdict>): void {
  const file = verdictsFile(projectPath, roundId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out: VerdictsFile = { version: VERDICTS_VERSION, roundId, generatedAt: new Date().toISOString(), verdicts };
  fs.writeFileSync(file + '.tmp', JSON.stringify(out, null, 2), 'utf-8');
  fs.renameSync(file + '.tmp', file);
}

/**
 * 从 AI 输出里 harvest `@@VERDICT {json}` 行(与 recommend 路由同款「AI 只读、代码落盘」范式:
 * 模型没有 Write 权限,平台按它的输出行精确写文件)。
 *
 * 容错:非 JSON 行跳过;缺字段/分类不在枚举内的整条丢弃;同一 id 后出现的覆盖先出现的。
 * 返回 runId → verdict(runId 反解回 (task, originalId) 由调用方用当轮快照 idMap 完成)。
 */
export function harvestVerdicts(text: string): Record<string, CaseVerdict> {
  const out: Record<string, CaseVerdict> = {};
  const re = /^@@VERDICT\s+(\{.*\})\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const o = JSON.parse(m[1]) as { id?: unknown; cls?: unknown; act?: unknown; why?: unknown };
      if (typeof o.id !== 'string' || !o.id) continue;
      const v = { cls: o.cls, act: o.act ?? '', why: o.why ?? '' } as CaseVerdict;
      if (!isVerdict(v)) continue;
      out[o.id] = v;
    } catch { /* 坏行跳过 */ }
  }
  return out;
}

/* ============ 归因上下文与 prompt ============ */

/** 一条待归因的失败用例(喂给 AI 的全部事实)。 */
export interface FailureContext {
  /** 本轮执行结果里的 id(AI 原样回填,平台据此反解回来源任务)。 */
  runId: string;
  task: string;
  originalId: string;
  purpose: string;
  status: string;
  actual?: string;
  error?: string;
  api?: unknown;
  /** 跨轮结果串(旧→新),如 "ppfff";'-' 表示该轮未执行。判 flaky 与连败的唯一依据。 */
  history: string;
}

/**
 * 归因 prompt。**规则内联**而非从 `rules/regression-verdict.md` 读取:
 * 打包 standalone 下 next.config 的 outputFileTracingExcludes 会剥掉 `**\/*.md`,
 * 读文件会让 dev 与打包态给出不同质量的归因。那份 md 是给人看的规范,与此处保持同义。
 *
 * AI 全程**只读**:它没有 Write 权限,平台按 `@@VERDICT` 行精确落盘(与 recommend 路由同款)。
 */
export function buildVerdictPrompt(roundId: string, failures: FailureContext[]): string {
  const cases = failures.map((f, i) => {
    const parts = [
      `${i + 1}. id=${f.runId}（来源任务：${f.task} · ${f.originalId}）`,
      `   用例目的：${f.purpose || '—'}`,
      `   本轮状态：${f.status}`,
      `   跨轮历史（旧→新，p=通过 f=失败 -=未执行）：${f.history || '—'}`,
    ];
    if (f.actual) parts.push(`   实际结果：${f.actual}`);
    if (f.error) parts.push(`   错误：${f.error}`);
    if (f.api) parts.push(`   关键接口：${JSON.stringify(f.api)}`);
    return parts.join('\n');
  }).join('\n\n');

  return `请为回归轮次 ${roundId} 的 ${failures.length} 条失败用例做归因判定。

## 分类（四选一，不得自创）
- 产品缺陷：被测应用自身行为与预期不符（断言指向业务逻辑错误、接口 5xx/错误业务码、数据未按预期写入）。
- 测试用例问题：用例过时或写错（预期与当前 PRD 不符、依赖已改版的实现细节、前置数据假设不成立）。
- 环境问题：与被测代码无关的外部因素（地址不可达、超时、鉴权/证书失效、依赖服务不可用）。status=blocked 一律归此类，除非错误明确指向应用崩溃。
- 疑似 flaky：同一版本下结果不稳定（跨轮历史反复翻转；错误指向竞态/等待不足）。

## 判定原则
1. **只用下面给出的事实**（实际结果 / 错误 / 关键接口 / 跨轮历史），禁止臆造未提供的信息。
2. **跨轮历史是重要输入**：连续多轮失败 → 强烈指向「产品缺陷」或「测试用例问题」，**不要**判「疑似 flaky」；反复翻转才考虑「疑似 flaky」。
3. **「疑似 flaky」是候选不是定论**（跨轮翻转可能只是版本在变），理由里须写明「需同版本连跑复核」。
4. **不下修复方案**：\`act\` 只写下一步动作（转缺陷跟踪 / 复核并更新用例 / 检查环境 / 同版本连跑复核），禁止写改哪行代码、优先级、是否发版、指派责任人。

## 失败用例
${cases}

## 输出
对**每一条**输出一行（共 ${failures.length} 行，按上面顺序，一行一条）：
@@VERDICT {"id":"<原样照抄上面的 id>","cls":"<四类之一>","act":"<一句话动作建议>","why":"<一句话理由，引用真实证据；内层引用用中文引号「」>"}

**只读不写**：禁止修改任何文件——平台按你的输出行落盘。输出完后自检行数是否等于 ${failures.length}。`;
}
