/**
 * Pure algorithm functions for MessageInput behavior.
 *
 * These functions contain no React dependencies — they are plain TypeScript
 * and can be tested directly without any framework setup.
 */

import { BUILT_IN_COMMANDS, COMMAND_PROMPTS } from '@/lib/constants/commands';
import type { PopoverItem, PopoverMode, CommandBadge, CliBadge, MentionNodeType, MentionRef } from '@/types';

// ─── Result types ────────────────────────────────────────────────

export interface InsertResult {
  action: 'immediate_command' | 'set_badge' | 'insert_file_mention' | 'insert_command_text';
  commandValue?: string;
  badge?: CommandBadge;
  newInputValue?: string;
}

export interface BadgeDispatchResult {
  prompt: string;
  displayLabel: string;
}

export type KeyAction =
  | { type: 'popover_navigate'; direction: 'up' | 'down' }
  | { type: 'popover_select' }
  | { type: 'close_popover' }
  | { type: 'remove_badge' }
  | { type: 'remove_cli_badge' }
  | { type: 'passthrough' };

export interface DirectSlashResult {
  action: 'immediate_command' | 'set_badge' | 'unknown_slash_badge' | 'btw_command' | 'not_slash';
  commandValue?: string;
  badge?: CommandBadge;
  /** For 'btw_command': the free-text question after "/btw " (may be empty). */
  question?: string;
}

// ─── Functions ───────────────────────────────────────────────────

/**
 * Detects popover trigger from input text and cursor position.
 * Used by handleInputChange in useSlashCommands.
 */
export function detectPopoverTrigger(
  text: string,
  cursorPos: number,
): { mode: PopoverMode; filter: string; triggerPos: number } | null {
  const beforeCursor = text.slice(0, cursorPos);

  // Check for @ trigger
  const atMatch = beforeCursor.match(/@([^\s@]*)$/);
  if (atMatch) {
    return {
      mode: 'file',
      filter: atMatch[1],
      triggerPos: cursorPos - atMatch[0].length,
    };
  }

  // Check for / trigger. Only fires when `/` is at the start of input or
  // immediately after whitespace — regex alone can't tell "hello/skill" from
  // "src/app" or "foo/bar", so we accept the trade-off: typing `/` mid-word
  // does NOT open the picker (it would false-positive on every single-slash
  // path). Users who want to invoke a command mid-sentence use the slash
  // button, which auto-inserts a leading space (see handleInsertSlash).
  const slashMatch = beforeCursor.match(/(^|\s)\/([^\s]*)$/);
  if (slashMatch) {
    return {
      mode: 'skill',
      filter: slashMatch[2],
      triggerPos: cursorPos - slashMatch[2].length - 1,
    };
  }

  return null;
}

/**
 * Filters popover items by substring match on label or description.
 * Used by the filteredItems useMemo in usePopoverState.
 */
export function filterItems(items: PopoverItem[], filter: string): PopoverItem[] {
  const q = filter.toLowerCase();
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      (item.description || '').toLowerCase().includes(q),
  );
}

/**
 * Splits input text around a popover trigger, removing the trigger character
 * and any filter text that was typed after it.
 */
function splitAroundTrigger(
  inputValue: string,
  triggerPos: number,
  popoverFilter: string,
): { before: string; after: string } {
  const before = inputValue.slice(0, triggerPos);
  const cursorEnd = triggerPos + popoverFilter.length + 1; // +1 to consume the trigger character
  const after = inputValue.slice(cursorEnd);
  return { before, after };
}

/**
 * Determines what happens when an item is selected from the popover.
 * Used by insertItem in useSlashCommands.
 */
export function resolveItemSelection(
  item: PopoverItem,
  popoverMode: PopoverMode,
  triggerPos: number,
  inputValue: string,
  popoverFilter: string,
): InsertResult {
  // Immediate built-in commands
  if (item.builtIn && item.immediate) {
    return { action: 'immediate_command', commandValue: item.value };
  }

  // /btw carries a free-text question, so selecting it fills the input with
  // "/btw " for the user to keep typing — it must NOT fire immediately or turn
  // into a badge. Submit-time parsing (resolveDirectSlash) routes it to the popup.
  if (item.value === '/btw') {
    const { before, after } = splitAroundTrigger(inputValue, triggerPos, popoverFilter);
    return { action: 'insert_command_text', newInputValue: `${before}/btw ${after}` };
  }

  // Non-immediate commands: show as badge, preserving any text outside the trigger
  if (popoverMode === 'skill') {
    const { before, after } = splitAroundTrigger(inputValue, triggerPos, popoverFilter);
    return {
      action: 'set_badge',
      badge: {
        command: item.value,
        label: item.label,
        description: item.description || '',
        kind: item.kind || 'slash_command',
        installedSource: item.installedSource,
        source: item.source,
      },
      newInputValue: before + after,
    };
  }

  // File mention: insert into text
  const { before, after } = splitAroundTrigger(inputValue, triggerPos, popoverFilter);
  const insertText = `@${item.value} `;
  return {
    action: 'insert_file_mention',
    newInputValue: before + insertText + after,
  };
}

/**
 * Badge dispatch logic — what prompt is sent for each badge kind.
 * Used by handleSubmit in MessageInput.
 *
 * Accepts a single badge or an array. Multi-badge is only meaningful for
 * `agent_skill` kind (user can stack multiple skills); other kinds always
 * arrive as a single-element array because addBadge() replaces on non-skill.
 */
export function dispatchBadge(
  badgeOrBadges: CommandBadge | CommandBadge[],
  userContent: string,
): BadgeDispatchResult {
  const badges = Array.isArray(badgeOrBadges) ? badgeOrBadges : [badgeOrBadges];
  if (badges.length === 0) {
    return { prompt: userContent, displayLabel: userContent };
  }

  // Multi-skill path: combine labels into one prompt, join display labels.
  if (badges.length > 1 && badges.every((b) => b.kind === 'agent_skill')) {
    const skillNames = badges.map((b) => b.label).join(', ');
    const displayLabel = userContent
      ? `${badges.map((b) => `/${b.label}`).join(' ')}\n${userContent}`
      : badges.map((b) => `/${b.label}`).join(' ');
    const agentPrompt = userContent
      ? `Use the ${skillNames} skills. User context: ${userContent}`
      : `Please use the ${skillNames} skills.`;
    return { prompt: agentPrompt, displayLabel };
  }

  const badge = badges[0];
  const baseLabel = `/${badge.label}`;
  const displayLabel = userContent ? `${baseLabel}\n${userContent}` : baseLabel;

  switch (badge.kind) {
    case 'agent_skill': {
      const agentPrompt = userContent
        ? `Use the ${badge.label} skill. User context: ${userContent}`
        : `Please use the ${badge.label} skill.`;
      return { prompt: agentPrompt, displayLabel };
    }
    case 'slash_command':
    case 'sdk_command': {
      const slashPrompt = userContent
        ? `${badge.command} ${userContent}`
        : badge.command;
      return { prompt: slashPrompt, displayLabel };
    }
    case 'codepilot_command': {
      const expandedPrompt = COMMAND_PROMPTS[badge.command] || '';
      const finalPrompt = userContent
        ? `${expandedPrompt}\n\nUser context: ${userContent}`
        : expandedPrompt || badge.command;
      return { prompt: finalPrompt, displayLabel };
    }
  }
}

/**
 * Expand a project-scoped slash command's markdown body into a plain prompt.
 *
 * Project slash commands live in <cwd>/.claude/commands and are NOT loaded by
 * the Claude Agent SDK under DB/managed providers (the 'project' settingSource
 * is dropped — see provider-resolver.ts). Sending the literal `/command` would
 * therefore not resolve. Instead the app reads the command body and sends it as
 * a normal prompt, which works for every provider.
 *
 * Supports the common `$ARGUMENTS` placeholder (Claude Code's primary slash
 * command token); when absent, any user context is appended after the body.
 * Advanced native tokens (frontmatter, $1..$9, !`bash`, @file) are intentionally
 * NOT interpreted — app-authored skills are plain prompt templates.
 */
export function expandSkillBody(rawBody: string, userContent: string): string {
  // Drop YAML frontmatter — it is metadata, not prompt content.
  const body = (rawBody || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  const trimmedUser = (userContent || '').trim();

  if (/\$ARGUMENTS\b/.test(body)) {
    return body.replace(/\$ARGUMENTS\b/g, trimmedUser);
  }
  if (trimmedUser) {
    return body ? `${body}\n\n${trimmedUser}` : trimmedUser;
  }
  return body;
}

/**
 * ArrowDown/ArrowUp index cycling logic.
 * Used by handleKeyDown popover navigation in MessageInput.
 */
export function cycleIndex(current: number, direction: 'up' | 'down', length: number): number {
  if (direction === 'down') return (current + 1) % length;
  return (current - 1 + length) % length;
}

/**
 * Submit gating logic — determines whether submit is enabled.
 * Used by FileAwareSubmitButton disabled logic.
 */
export function isSubmitEnabled(opts: {
  inputValue: string;
  hasBadge: boolean;
  hasFiles: boolean;
  isStreaming: boolean;
  disabled: boolean;
}): boolean {
  if (opts.disabled) return false;
  if (opts.isStreaming) return true; // streaming = stop button
  return !!(opts.inputValue.trim() || opts.hasBadge || opts.hasFiles);
}

/**
 * Keyboard dispatch logic — determines what action to take for a given key.
 * Used by handleKeyDown in MessageInput.
 */
export function resolveKeyAction(
  key: string,
  state: {
    popoverMode: PopoverMode;
    popoverHasItems: boolean;
    inputValue: string;
    hasBadge: boolean;
    hasCliBadge: boolean;
  },
): KeyAction {
  // Popover navigation (skill/file mode)
  if (state.popoverMode && state.popoverMode !== 'cli' && state.popoverHasItems) {
    if (key === 'ArrowDown') return { type: 'popover_navigate', direction: 'down' };
    if (key === 'ArrowUp') return { type: 'popover_navigate', direction: 'up' };
    if (key === 'Enter' || key === 'Tab') return { type: 'popover_select' };
    if (key === 'Escape') return { type: 'close_popover' };
  }

  // CLI popover
  if (state.popoverMode === 'cli') {
    if (key === 'Escape') return { type: 'close_popover' };
  }

  // Backspace removes badge when input is empty
  if (key === 'Backspace' && !state.inputValue) {
    if (state.hasBadge) return { type: 'remove_badge' };
    if (state.hasCliBadge) return { type: 'remove_cli_badge' };
  }

  // Escape removes badge
  if (key === 'Escape') {
    if (state.hasBadge) return { type: 'remove_badge' };
    if (state.hasCliBadge) return { type: 'remove_cli_badge' };
  }

  return { type: 'passthrough' };
}

/**
 * Direct slash command detection — when user types "/command" in input and submits.
 * Used by handleSubmit in MessageInput.
 */
export function resolveDirectSlash(content: string): DirectSlashResult {
  if (!content.startsWith('/')) return { action: 'not_slash' };

  // /btw <question> — side question. Handled before the exact-value lookup
  // because it carries a free-text argument (so "/btw foo" never matches a
  // BUILT_IN_COMMANDS entry), and the caller intentionally bypasses the
  // isStreaming guard for it — asking mid-stream is the whole point.
  if (content === '/btw' || content.startsWith('/btw ')) {
    return { action: 'btw_command', question: content.slice('/btw'.length).trim() };
  }

  const cmd = BUILT_IN_COMMANDS.find((c) => c.value === content);
  if (cmd) {
    if (cmd.immediate) {
      return { action: 'immediate_command', commandValue: content };
    }
    return {
      action: 'set_badge',
      badge: {
        command: cmd.value,
        label: cmd.label,
        description: cmd.description || '',
        kind: cmd.kind || 'sdk_command',
      },
    };
  }

  const skillName = content.slice(1);
  if (skillName) {
    return {
      action: 'unknown_slash_badge',
      badge: {
        command: content,
        label: skillName,
        description: '',
        kind: 'slash_command',
      },
    };
  }

  return { action: 'not_slash' };
}

/**
 * CLI badge system prompt append generation.
 * Used by handleSubmit in MessageInput.
 */
export function buildCliAppend(cliBadge: CliBadge | null): string | undefined {
  if (!cliBadge) return undefined;
  return `The user wants to use the installed CLI tool "${cliBadge.name}" if appropriate for this task. Prefer using "${cliBadge.name}" when suitable.`;
}

/**
 * Parse @mentions from raw input text and return structured mention refs.
 * Mentions keep source ranges so the caller can reconcile edits/deletions.
 */
export function parseMentionRefs(
  input: string,
  nodeTypeLookup?: Record<string, MentionNodeType>,
): MentionRef[] {
  const refs: MentionRef[] = [];
  if (!input) return refs;

  const mentionRegex = /(^|\s)@([^\s@]+)/g;
  for (const match of input.matchAll(mentionRegex)) {
    const rawPath = (match[2] || '').replace(/[.,!?;:)\]}]+$/, '');
    if (!rawPath) continue;
    const full = match[0] || '';
    const start = input.indexOf(full, match.index ?? 0) + full.lastIndexOf('@');
    const end = start + rawPath.length + 1;
    refs.push({
      path: rawPath,
      nodeType: nodeTypeLookup?.[rawPath] || 'file',
      display: rawPath,
      sourceRange: { start, end },
    });
  }
  return refs;
}

/**
 * Dedupe mentions by path (first mention wins).
 */
export function dedupeMentionsByPath(mentions: MentionRef[]): MentionRef[] {
  const seen = new Set<string>();
  const out: MentionRef[] = [];
  for (const mention of mentions) {
    if (seen.has(mention.path)) continue;
    seen.add(mention.path);
    out.push(mention);
  }
  return out;
}
