/**
 * routine-draft.ts —— 「存为定时任务」的跨页面预填(P7)。
 *
 * 办公对话的顶部栏点「存为定时任务」→ 跳到 `/routines?new=1` 并把指令预填进新建表单。
 * 中间需要一个能跨路由传一段长文本的地方。
 *
 * **为什么用 sessionStorage 而不是 URL 参数**:指令动辄几百字,塞进 URL 既难看又可能超长
 * (部分环境仍有长度上限);而且它只是「这一次跳转」的临时数据,不该留在地址栏里被
 * 复制、被分享、被历史记录留存。
 *
 * **读完即焚**:`takeRoutineDraft()` 取完就清。不清的话,用户下次从侧边栏正常点「新建」
 * 会莫名其妙看到上次那段指令 —— 那种"我没填怎么有字"的困惑比丢掉预填更糟。
 */

const KEY = 'codepilot:routine-draft';

export interface RoutineDraft {
  prompt: string;
  name?: string;
}

/**
 * 用户消息里可能带 `<!--files:[...]-->` 的附件元信息,预填时要剥掉(那不是指令的一部分)。
 * 用 `[\s\S]` 而不是 `.` + `s` 标志 —— 后者要 ES2018,本项目的编译目标还没到。
 */
export function stripFileMeta(content: string): string {
  return content.replace(/^<!--files:\[[\s\S]*?\]-->/, '').trim();
}

export function stashRoutineDraft(draft: RoutineDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // 隐私模式/配额满:预填丢了而已,新建表单照常能用
  }
}

/** 取出并清除。返回 null = 没有待预填的草稿(正常从侧边栏进来的情况)。 */
export function takeRoutineDraft(): RoutineDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const d = JSON.parse(raw) as RoutineDraft;
    return typeof d?.prompt === 'string' ? d : null;
  } catch {
    return null;
  }
}
