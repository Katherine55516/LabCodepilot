/**
 * mcp-market-ledger.ts — MCP 市场安装台账。
 *
 * 记录「marketplace server(name) → 本地 mcpServers key」的来源映射，用于：
 *  - 搜索结果标记「已安装」（对照 ~/.claude.json 现存做自愈，与技能市场 lock 同思路）
 *  - 卸载时定位 key + 清除该 server 写入的密钥
 *
 * 存储：settings 表单条 JSON（key=`mcp_market_ledger`）。不进 ~/.claude.json，
 * 避免污染内置二进制读取的配置。
 *
 * 文档：docs/exec-plans/active/mcp-marketplace.md
 */

import { getSetting, setSetting } from '@/lib/db';
import { loadAllMcpServers } from '@/lib/mcp-loader';
import type { McpMarketInstallEntry } from '@/types';

const LEDGER_KEY = 'mcp_market_ledger';

type Ledger = Record<string, McpMarketInstallEntry>;

export function readLedger(): Ledger {
  try {
    const raw = getSetting(LEDGER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Ledger) : {};
  } catch {
    return {};
  }
}

function writeLedger(ledger: Ledger): void {
  setSetting(LEDGER_KEY, JSON.stringify(ledger));
}

export function recordInstall(serverName: string, entry: McpMarketInstallEntry): void {
  const ledger = readLedger();
  ledger[serverName] = entry;
  writeLedger(ledger);
}

export function removeInstall(serverName: string): McpMarketInstallEntry | undefined {
  const ledger = readLedger();
  const entry = ledger[serverName];
  if (entry) {
    delete ledger[serverName];
    writeLedger(ledger);
  }
  return entry;
}

/**
 * 返回「真正在装」的映射：台账条目 ∩ key 仍存在于 ~/.claude.json。
 * 若 key 已被用户在 MCP 管理页手动删除，则自愈剔除台账。
 * @returns serverName → installedKey
 */
export function getActiveInstalls(): Record<string, string> {
  const ledger = readLedger();
  const names = Object.keys(ledger);
  if (names.length === 0) return {};

  const all = loadAllMcpServers() || {};
  const out: Record<string, string> = {};
  let healed = false;
  for (const name of names) {
    const entry = ledger[name];
    if (entry?.key && all[entry.key]) {
      out[name] = entry.key;
    } else {
      delete ledger[name];
      healed = true;
    }
  }
  if (healed) writeLedger(ledger);
  return out;
}
