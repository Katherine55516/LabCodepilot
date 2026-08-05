/**
 * claude-content-blocks.ts —— Anthropic 内容块 → 应用内 `MessageContentBlock[]` 的归一化。
 *
 * 应用里有**两处**要读 Anthropic 风格的对话记录,格式不同但内容块同形:
 *   1. `claude-session-parser.ts` —— Claude Code CLI 的会话文件
 *      (`~/.claude/projects/<项目>/<uuid>.jsonl`,靠 parentUuid→uuid 串起来)
 *   2. `routine-transcript.ts` —— 沙箱定时任务的 stream-json 原文
 *      (服务端 `claude -p --output-format stream-json` 的逐行输出)
 *
 * 两者的**行结构**不一样(前者有 parentUuid/cwd/gitBranch,后者有 system/init 与 result),
 * 但 `message.content` 里的块是同一套。归一化逻辑只写一份放这里 —— 各写一份的话,
 * 哪天在其中一处修了块解析的 bug(比如 tool_result 的 content 可能是数组而不是字符串),
 * 另一处会静默留着那个 bug。
 *
 * 本模块**保持纯函数**(不碰 fs/网络),这样两边都能拿它做单测。
 */
import type { MessageContentBlock } from '@/types';

/** Anthropic 消息里的一个内容块(各字段按块类型择一存在)。 */
export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

/** 归一化 tool_result 的 content:可能是字符串,也可能是 text 块数组。 */
export function toolResultContentToString(content: string | ContentBlock[] | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === 'text').map(c => c.text || '').join('\n');
  }
  return '';
}

/**
 * 抽取 assistant 消息的有序内容块。**保持数组原序**(= 时间序),thinking 也保留。
 * 无可渲染块时返回 []。
 */
export function parseAssistantContent(msgContent: ContentBlock[] | undefined): MessageContentBlock[] {
  if (!msgContent || !Array.isArray(msgContent)) return [];

  const blocks: MessageContentBlock[] = [];
  for (const block of msgContent) {
    switch (block.type) {
      case 'thinking': {
        if (block.thinking) blocks.push({ type: 'thinking', thinking: block.thinking });
        break;
      }
      case 'text': {
        if (block.text) blocks.push({ type: 'text', text: block.text });
        break;
      }
      case 'tool_use': {
        blocks.push({ type: 'tool_use', id: block.id || '', name: block.name || '', input: block.input });
        break;
      }
      case 'tool_result': {
        blocks.push({
          type: 'tool_result',
          tool_use_id: block.tool_use_id || '',
          content: toolResultContentToString(block.content),
          is_error: block.is_error || false,
        });
        break;
      }
    }
  }
  return blocks;
}

/**
 * 分析一条 "user" 记录。Anthropic 的对话记录里,user 行**要么**是真的用户输入
 * (字符串 / text 块),**要么**是 tool_use 之后喂回模型的 tool_result(块数组)。
 * 拆开来,调用方才能把 tool_result 归进 assistant 回合、只拿真输入当回合边界。
 */
export function analyzeUserContent(
  content: string | ContentBlock[] | undefined,
): { prompt: string | null; toolResults: MessageContentBlock[] } {
  if (typeof content === 'string') {
    return { prompt: content.trim() ? content : null, toolResults: [] };
  }
  if (Array.isArray(content)) {
    const text = content.filter(b => b.type === 'text').map(b => b.text || '').join('\n');
    const toolResults: MessageContentBlock[] = content
      .filter(b => b.type === 'tool_result')
      .map(b => ({
        type: 'tool_result' as const,
        tool_use_id: b.tool_use_id || '',
        content: toolResultContentToString(b.content),
        is_error: b.is_error || false,
      }));
    return { prompt: text.trim() ? text : null, toolResults };
  }
  return { prompt: null, toolResults: [] };
}
