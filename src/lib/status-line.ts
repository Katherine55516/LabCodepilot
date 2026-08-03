/**
 * 执行状态行（StreamingMessage 的 StreamingStatusBar）的文案规范化。
 *
 * 这一行在聊天区底部只占一行高度，紧挨着计时器和 Force stop 按钮。任何流进
 * 它的文案都必须是「单行、短」的——但上游有多条通道会往里塞不受控的长文本：
 *
 *   - claude-client 的 `task_notification`：子代理 summary 是整份报告；
 *   - useSSEStream 的 `catch { onStatus(event.data) }` 兜底：原始 SSE 载荷；
 *   - StreamingMessage 的 getRunningCommandSummary()：file_path 分支不截断。
 *
 * 任一通道漏进多行/超长文本，状态行就会换行铺开、挤满整个聊天区，把真正的
 * 输出顶出视口（用户实拍回归）。此外 Shimmer 的高光宽度按 `字符数 × spread`
 * 算，几千字会算出几千 px 的 spread，渐变高光远超容器，整段文字被背景色填满
 * ——这就是那段长文案「淡到几乎看不清」的成因。
 *
 * 所以规范化必须同时做两件事：压成单行 + 限长。纯 CSS 的 `truncate` 只能挡
 * 住溢出，挡不住 Shimmer 的 spread 计算，故字符串层面的截断不可省。
 */

/** 状态行单行可读的字符上限。与 getRunningCommandSummary() 的 Bash 截断同宽。 */
export const STATUS_LINE_MAX_CHARS = 80;

/**
 * 把任意文案压成适合状态行的单行短文本。
 * 空/全空白输入返回 ''，调用方据此回退到自己的默认文案。
 */
export function toStatusLine(
  raw: string | undefined | null,
  maxChars: number = STATUS_LINE_MAX_CHARS,
): string {
  if (!raw) return '';
  // 换行/制表/连续空格一律压成单空格——状态行没有第二行可用。
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxChars) return oneLine;
  return `${oneLine.slice(0, maxChars).trimEnd()}…`;
}
