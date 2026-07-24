// ==========================================
// Database Models
// ==========================================

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  model: string;
  system_prompt: string;
  working_directory: string;
  sdk_session_id: string; // Claude Agent SDK session ID for resume
  project_name: string;
  status: 'active' | 'archived';
  mode?: 'code' | 'plan' | 'ask';
  needs_approval?: boolean;
  provider_name: string;
  provider_id: string;
  sdk_cwd: string;
  runtime_status: string;
  runtime_updated_at: string;
  runtime_error: string;
  permission_profile?: 'default' | 'full_access';
  /** Cowork POC: 1 = SDK CLI runs inside an isolated VM, 0 = host runtime. */
  sandbox_enabled?: number;
  /** Per-session reasoning effort (e.g. 'low'|'medium'|'high'|'max'); ''/undefined = no explicit effort */
  effort?: string;
  context_summary?: string;
  context_summary_updated_at?: string;
}

// ==========================================
// Project / File Types
// ==========================================

export interface ProjectInfo {
  path: string;
  name: string;
  files_count: number;
  last_modified: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  size?: number;
  extension?: string;
}

/**
 * Text encodings the preview/write pipeline can round-trip. 'gbk' covers
 * GB2312/GBK legacy files (decoded and re-encoded via the gb18030 codec,
 * a strict superset, so rare four-byte chars survive the round trip).
 */
export type TextFileEncoding = 'utf-8' | 'gbk';

export interface FilePreview {
  path: string;
  content: string;
  language: string;
  /**
   * Detected on-disk encoding. Clients editing the file must pass this
   * back to /api/files/write so a GBK file is not silently re-saved as
   * UTF-8 (which would break e.g. javac's platform-default decoding on
   * Chinese-locale Windows).
   */
  encoding: TextFileEncoding;
  line_count: number;
  /** When true, line_count is exact; when false it is a best-effort estimate. */
  line_count_exact: boolean;
  /** When true, content is only the first N lines/bytes of a larger file. */
  truncated: boolean;
  /** Actual bytes read into content (UTF-8 byte length). */
  bytes_read: number;
  /** Total file size in bytes (from fs.stat). */
  bytes_total: number;
}

// ==========================================
// Skill / Command Types
// ==========================================

export type SkillKind = 'agent_skill' | 'slash_command' | 'sdk_command' | 'codepilot_command';

// ==========================================
// Popover / Command Input Types
// ==========================================

import type { TranslationKey } from '@/i18n';
import type { ComponentType, SVGAttributes, RefAttributes } from 'react';

/** Generic icon component type — compatible with Phosphor, Lucide, or any SVG icon. */
export type IconComponent = ComponentType<
  SVGAttributes<SVGSVGElement> & RefAttributes<SVGSVGElement> & { size?: number | string; className?: string }
>;

export type MentionNodeType = 'file' | 'directory';

/** Shared model for popover items (slash commands, file mentions, skills). */
export interface PopoverItem {
  label: string;
  value: string;
  display?: string;
  description?: string;
  descriptionKey?: TranslationKey;
  builtIn?: boolean;
  immediate?: boolean;
  installedSource?: 'agents' | 'claude';
  source?: 'global' | 'project' | 'plugin' | 'installed' | 'sdk';
  /**
   * True when this command comes from a AI Native Lab-bundled plugin (e.g. GSD)
   * — `plugin.json` has `builtIn: true`. Bundled plugins exist on disk
   * because AI Native Lab put them there, so they are always "loaded" regardless
   * of what the Claude Code SDK reports. The slash-command popover must
   * skip its two SDK-whitelist filters for these items.
   */
  builtInPlugin?: boolean;
  kind?: SkillKind;
  icon?: IconComponent;
  nodeType?: MentionNodeType;
}

/** Which popover is currently active in the command input. */
export type PopoverMode = 'file' | 'skill' | 'cli' | null;

/** Active slash-command badge shown above the textarea. */
export interface CommandBadge {
  command: string;
  label: string;
  description: string;
  kind: SkillKind;
  installedSource?: 'agents' | 'claude';
  /**
   * Scope of the skill this badge represents. Carried from the popover item so
   * the submit path can expand project-scoped slash commands client-side
   * (project commands are not loaded by the SDK under DB/managed providers —
   * see message-input-logic.ts expandSkillBody and MessageInput handleSubmit).
   */
  source?: 'global' | 'project' | 'plugin' | 'installed' | 'sdk';
}

/** Active CLI tool badge shown above the textarea. */
export interface CliBadge {
  id: string;
  name: string;
}

/** A detected CLI tool available for use. */
export interface CliToolItem {
  id: string;
  name: string;
  version: string | null;
  summary: string;
}

// ==========================================
// Task Types
// ==========================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface TaskItem {
  id: string;
  session_id: string;
  title: string;
  status: TaskStatus;
  description: string | null;
  source: 'user' | 'sdk';
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string; // JSON string of MessageContentBlock[] for structured content
  created_at: string;
  token_usage: string | null; // JSON string of TokenUsage
  is_heartbeat_ack?: number; // 1 = heartbeat ack (prunable from transcript), 0 = normal
  /**
   * SQLite rowid, monotonically increasing per insert — used as the compact
   * coverage boundary (see `context_summary_boundary_rowid`). Populated by
   * `getMessages()` which does `SELECT *, rowid as _rowid`. Optional here
   * because some code paths synthesize Message-like objects without DB origin.
   */
  _rowid?: number;
}

// Media content block (MCP-compatible: image/audio/video in tool results)
export interface MediaBlock {
  type: 'image' | 'audio' | 'video';
  data?: string;        // base64 (transit only, cleared after save to disk)
  mimeType: string;     // e.g. 'image/png', 'video/mp4'
  localPath?: string;   // local file path (after save to .codepilot-media/)
  mediaId?: string;     // media_generations.id (after DB save)
}

// Structured message content blocks (stored as JSON in messages.content)
export type MessageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean; media?: MediaBlock[] }
  | { type: 'code'; language: string; code: string };

/**
 * Render-time view model for the interleaved conversation flow. Walks the
 * ordered MessageContentBlock[] and pairs each tool_use with its matching
 * tool_result (by id), so the renderer can lay out text / thinking / tool in
 * the true chronological order they occurred. Unlike MessageContentBlock,
 * tool_use + tool_result are collapsed into a single `tool` segment.
 *
 * See MessageSegments.tsx (renderer) and parseOrderedSegments (MessageItem.tsx).
 */
export type RenderSegment =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; thinking: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      input: unknown;
      result?: string;
      isError?: boolean;
      media?: MediaBlock[];
    };

// Helper to parse message content - returns blocks or wraps plain text
export function parseMessageContent(content: string): MessageContentBlock[] {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON, treat as plain text
  }
  return [{ type: 'text', text: content }];
}

export interface Setting {
  id: number;
  key: string;
  value: string;
}

// ==========================================
// API Provider Types
// ==========================================

export interface ApiProvider {
  id: string;
  name: string;
  provider_type: string; // legacy: 'anthropic' | 'openrouter' | 'bedrock' | 'vertex' | 'custom'
  /** Wire protocol — new field, takes precedence over provider_type for dispatch */
  protocol: string; // 'anthropic' | 'openai-compatible' | 'openrouter' | 'bedrock' | 'vertex' | 'google' | 'gemini-image' | 'openai-image'
  base_url: string;
  api_key: string;
  is_active: number; // SQLite boolean: 0 or 1
  sort_order: number;
  extra_env: string; // JSON string of Record<string, string> (legacy, prefer env_overrides_json)
  /** Extra headers to send with API requests — JSON string of Record<string, string> */
  headers_json: string;
  /** Environment overrides for Claude Code SDK subprocess — JSON string of Record<string, string> */
  env_overrides_json: string;
  /** Semantic model role mapping — JSON string of { default?, reasoning?, small?, haiku?, sonnet?, opus? } */
  role_models_json: string;
  /** Per-provider options — JSON string of { thinking_mode?, context_1m? } */
  options_json: string;
  notes: string;
  /**
   * Origin of this provider record:
   *   - 'local'   (default): user-managed BYOK provider, editable
   *   - 'managed': pushed by the managed-account login server; read-only in
   *               the UI and pruned on logout
   *
   * Optional in the type because every row in the DB has a NOT NULL DEFAULT,
   * so consumers reading from the DB always see a value — and inline test
   * fixtures (which omit it) get treated as 'local' via `?? 'local'`.
   */
  source?: 'local' | 'managed' | string;
  /** When source='managed', the server-side ModelConfig.id (lookup key for upsert) */
  managed_config_id?: string;
  /** When source='managed', JSON dump of fields not mapped into typed columns */
  managed_extra_json?: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderModelGroup {
  provider_id: string;       // provider DB id, or 'env' for environment variables
  provider_name: string;
  provider_type: string;
  /** True if this provider only supports Claude Code SDK wire protocol, not standard Messages API */
  sdkProxyOnly?: boolean;
  models: Array<{
    value: string;           // internal/UI model ID
    label: string;           // display name
    upstreamModelId?: string; // actual API model ID (if different from value)
    contextWindow?: number;
    description?: string;
    supportsEffort?: boolean;
    supportedEffortLevels?: string[];
    supportsAdaptiveThinking?: boolean;
    capabilities?: Record<string, unknown>;
    variants?: Record<string, unknown>;
  }>;
}

export interface ProviderModel {
  id: string;
  provider_id: string;
  model_id: string;
  upstream_model_id: string;
  display_name: string;
  capabilities_json: string;
  variants_json: string;
  sort_order: number;
  enabled: number; // SQLite boolean
  created_at: string;
}

export interface CreateProviderRequest {
  name: string;
  provider_type?: string;
  protocol?: string;
  base_url?: string;
  api_key?: string;
  extra_env?: string;
  headers_json?: string;
  env_overrides_json?: string;
  role_models_json?: string;
  options_json?: string;
  notes?: string;
}

export interface UpdateProviderRequest {
  name?: string;
  provider_type?: string;
  protocol?: string;
  base_url?: string;
  api_key?: string;
  extra_env?: string;
  headers_json?: string;
  env_overrides_json?: string;
  role_models_json?: string;
  options_json?: string;
  notes?: string;
  sort_order?: number;
}

/** Provider options stored in options_json (per-provider) or settings (global) */
export interface ProviderOptions {
  thinking_mode?: 'adaptive' | 'enabled' | 'disabled';
  context_1m?: boolean;
  /** Global default model ID — used for new sessions */
  default_model?: string;
  /** Global default model's provider ID — which provider the default model belongs to */
  default_model_provider?: string;
}

export interface ProvidersResponse {
  providers: ApiProvider[];
}

export interface ProviderResponse {
  provider: ApiProvider;
}

// ==========================================
// Token Usage
// ==========================================

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cost_usd?: number;
  /**
   * Per-turn context window reported by the SDK result, when available.
   * Preferred over the static model catalog by the context-usage card
   * (see context-usage-walk.ts). Optional: not all runtimes report it, and
   * the card falls back to the provider-models / catalog window when absent.
   */
  context_window?: number;
  /**
   * FIX(权威分子): 回合末 Query.getContextUsage() 的 totalTokens —— Claude Code
   * 对"当前上下文占用"的权威口径（/context 同源，auto-compact 按它触发）。
   * context-usage-walk 的分子优先用它；缺失（快照超时/失败）时回退
   * input + cache_read + cache_creation 的旧口径。
   */
  context_used_tokens?: number;
  /**
   * 同一快照里 CLI 报的窗口（maxTokens）。仅作诊断留档——分母刻意不用它，
   * 窗口仍走应用侧解析（[1m] 别名/托管表/目录，见 useContextUsage），所以
   * 不写入 context_window 字段，避免进入窗口解析链。
   */
  cli_context_window?: number;
  /**
   * 本回合实际请求的模型名 —— 与执行状态行 "Connected (…)" 括号里显示的是同
   * 一个值（requested_model || SDK init 的 model），可能是 CLI 别名（如
   * claude-opus-4-7[1m]）。上下文卡片用它做 [1m] → 1M 窗口的最高优先级判断
   * （见 useContextUsage / model-context.ts）。注意它不是下拉框里的展示名。
   */
  model?: string;
}

// ==========================================
// API Request Types
// ==========================================

export interface CreateSessionRequest {
  title?: string;
  model?: string;
  system_prompt?: string;
  working_directory?: string;
  mode?: string;
  provider_id?: string;
  permission_profile?: string;
  effort?: string;
  /**
   * E2 (cowork): 创建期定死沙箱(办公)会话。为 truthy 且未给
   * working_directory 时,服务端生成宿主暂存目录 ~/.codepilot/cowork/<id>
   * 并默认 permission_profile='full_access'。见 cowork-office-mode.md D2/D3。
   */
  sandbox_enabled?: boolean | number;
}

export interface SendMessageRequest {
  session_id: string;
  content: string;
  model?: string;
  mode?: string;
  provider_id?: string;
  mentions?: MentionRef[];
}

export interface UpdateMCPConfigRequest {
  mcpServers: Record<string, MCPServerConfig>;
}

export interface AddMCPServerRequest {
  name: string;
  server: MCPServerConfig;
}

export interface UpdateSettingsRequest {
  settings: SettingsMap;
}

// --- File API ---

export interface FileTreeRequest {
  dir: string;
  depth?: number; // default 3
}

export interface FilePreviewRequest {
  path: string;
  maxLines?: number; // default 200
}

// --- Task API ---

export interface CreateTaskRequest {
  session_id: string;
  title: string;
  description?: string;
}

export interface UpdateTaskRequest {
  title?: string;
  status?: TaskStatus;
  description?: string;
}

// --- Skill API ---

export interface SkillDefinition {
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

// --- Marketplace (Skills.sh) ---

export interface MarketplaceSkill {
  id: string;
  skillId: string;      // e.g. "git-commit"
  name: string;
  installs: number;
  source: string;       // e.g. "owner/repo"
  isInstalled?: boolean;
  installedAt?: string;
}

export interface SkillLockFile {
  version: number;
  skills: Record<string, SkillLockEntry>;
}

// ── MCP 市场 ───────────────────────────────────────────────────────────

/** MCP 市场列表/详情卡片的归一化 DTO（数据源：官方 Registry / Glama 兜底）。 */
export interface MarketplaceMcpServer {
  /** 完整反向 DNS 名，如 `ai.agenttrust/mcp-server`（唯一标识）。 */
  name: string;
  title?: string;
  description?: string;
  version?: string;
  /** 命名空间（name 中 `/` 之前），如 `ai.agenttrust`。 */
  namespace: string;
  /** 'github' = io.github.* GitHub 验证；'domain' = 反向域名验证。 */
  namespaceKind: 'github' | 'domain';
  hasPackages: boolean;
  hasRemotes: boolean;
  /** 可用的本地包类型，如 ['npm']。 */
  registryTypes: string[];
  /** 可用的远程传输类型，如 ['streamable-http']。 */
  remoteTypes: string[];
  repositoryUrl?: string;
  /** registry 状态：active / deprecated / deleted。 */
  status?: string;
  /** 数据源。 */
  source: 'official' | 'glama';
  /** 是否已安装（按 ledger + ~/.claude.json 现存校验）。 */
  isInstalled?: boolean;
  /** 已安装时在 mcpServers 里的 key。 */
  installedKey?: string;
  /** 安装时记录的版本（Phase 3 版本变更复查）。 */
  installedVersion?: string;
  /** 注册中心 latest 比安装时版本更新 → 提示更新前复查（rug-pull 防线）。 */
  updateAvailable?: boolean;
  /** 信任评估（Phase 2 安全加固）。 */
  trust?: McpTrustAssessment;
}

// ── MCP 安全/信任（Phase 2） ────────────────────────────────────────────

/**
 * 信任 tier —— 只陈述「可验证的来源事实」，不代表安全。
 * official-reviewed: 官方目录已审（手维护白名单）；
 * namespace-verified: 命名空间已验证（github / 反向域名，官方 Registry 默认满足）；
 * community: 无额外背书（Glama 等兜底源）。
 */
export type McpTrustTier = 'official-reviewed' | 'namespace-verified' | 'community';

/** 风险标记 —— 启发式提示，不是「不安全」判定。 */
export interface McpRiskFlag {
  /** 规则码，如 'shell-exec' | 'dangerous-command' | 'network-fetch-exec' | 'sensitive-path' | 'unpinned-version' | 'no-repository' | 'secret-injected'。 */
  code: string;
  /** 人类可读细节（命中的 token / 字段）。 */
  detail: string;
  severity: 'warn' | 'high';
}

/** 一个 MCP 的纵深信任评估（不含 isSafe）。 */
export interface McpTrustAssessment {
  tier: McpTrustTier;
  /** 正面可验证信号。 */
  signals: string[];
  /** 风险提示。 */
  risks: McpRiskFlag[];
  /** 命中已知恶意黑名单 → 硬拦。 */
  blocked: boolean;
  blockReason?: string;
  /** 安装对话框摩擦力：normal 正常 / extra-confirm 强制勾选 / blocked 禁止。 */
  friction: 'normal' | 'extra-confirm' | 'blocked';
}

/** 运行时预检结果（Phase 2b）：stdio server 需要的运行时是否就绪。 */
export interface McpRuntimeRequirement {
  /** 运行时类别。 */
  kind: 'node' | 'uv' | 'docker' | 'dotnet' | 'unknown';
  /** 实际要执行的命令（npx / uvx / docker …）。 */
  command: string;
  /** 展示名（Node.js / uv / Docker / .NET）。 */
  name: string;
  /** 安装指引链接。 */
  url?: string;
  /** 是否在 PATH（含扩展目录）中检测到。 */
  available: boolean;
}

/** 已知恶意/漏洞黑名单条目。 */
export interface McpDenylistEntry {
  /** 包类型；省略 = 任意。 */
  registryType?: string;
  /** 包标识（npm/pypi 包名、oci 镜像名，不含 tag/version）。 */
  identifier: string;
  /** 版本区间（'>=1.0.16' / '<0.1.16' / 精确 '1.2.3'）；省略 = 所有版本。 */
  versionRange?: string;
  reason: string;
  /** 公告/参考链接。 */
  ref?: string;
}

/** 市场安装台账条目（记录 marketplace server → 本地 mcpServers key 的来源映射）。 */
export interface McpMarketInstallEntry {
  /** mcpServers 里的 key。 */
  key: string;
  version?: string;
  source: 'official' | 'glama';
  installedAt: string;
  /** 该 server 写入的密钥 settingKey 列表（卸载时一并清除）。 */
  secretKeys?: string[];
}

export interface SkillLockEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  skillPath?: string;
  skillFolderHash: string;
  installedAt: string;
  updatedAt: string;
}

export interface CreateSkillRequest {
  name: string;
  description: string;
  prompt: string;
}

export interface UpdateSkillRequest {
  description?: string;
  prompt?: string;
  enabled?: boolean;
}

// ==========================================
// API Response Types
// ==========================================

export interface SessionsResponse {
  sessions: ChatSession[];
}

export interface SessionResponse {
  session: ChatSession;
}

export interface MessagesResponse {
  messages: Message[];
  hasMore?: boolean;
}

export interface SuccessResponse {
  success: true;
}

export interface ErrorResponse {
  error: string;
  /** Machine-readable error code for client-side branching */
  code?: string;
  /** Extra recovery hints surfaced in UI */
  initialCard?: string;
}

export interface SettingsResponse {
  settings: SettingsMap;
}

export interface PluginsResponse {
  plugins: PluginInfo[];
}

export interface MCPConfigResponse {
  mcpServers: Record<string, MCPServerConfig>;
}

// --- File API Responses ---

export interface FileTreeResponse {
  tree: FileTreeNode[];
  root: string;
}

export interface FilePreviewResponse {
  preview: FilePreview;
}

// --- Task API Responses ---

export interface TasksResponse {
  tasks: TaskItem[];
}

export interface TaskResponse {
  task: TaskItem;
}

// --- Skill API Responses ---

export interface SkillsResponse {
  skills: SkillDefinition[];
}

export interface SkillResponse {
  skill: SkillDefinition;
}

// ==========================================
// SSE Event Types (streaming chat response)
// ==========================================

export type SSEEventType =
  | 'text'               // text content delta
  | 'thinking'           // extended thinking content delta
  | 'tool_use'           // tool invocation info
  | 'tool_result'        // tool execution result
  | 'tool_output'        // streaming tool output (stderr from SDK process)
  | 'tool_timeout'       // tool execution timed out
  | 'status'             // status update (compacting, etc.)
  | 'result'             // final result with usage stats
  | 'error'              // error occurred
  | 'permission_request' // permission approval needed
  | 'mode_changed'       // SDK permission mode changed (e.g. plan → code)
  | 'task_update'        // SDK TodoWrite task sync
  | 'keep_alive'         // SDK keep-alive heartbeat (resets idle timer)
  | 'rewind_point'       // SDK user message with rewind checkpoint
  | 'rate_limit'         // SDK 0.2.111 subscription rate-limit telemetry
  | 'context_usage'      // SDK 0.2.111 post-turn context usage snapshot
  | 'vm_artifacts'       // cowork sandbox: files created/modified in the VM this turn
  | 'vm_status'          // cowork sandbox: VM provisioning progress (P1-D readiness window)
  | 'done';              // stream complete

export interface SSEEvent {
  type: SSEEventType;
  data: string;
}

/** Cowork sandbox: VM provisioning progress during the cold-start readiness window. */
export interface VmStatusEvent {
  phase: 'starting' | 'booting' | 'provisioning' | 'ready' | 'failed';
  detail?: string;
}

/** Cowork sandbox: one file the agent created/modified inside the VM this turn. */
export interface VmArtifactFile {
  /** Absolute path inside the VM (under the session workspace). */
  path: string;
  name: string;
  size: number;
  /** Epoch millis of last modification (VM clock). */
  mtime: number;
}

// ==========================================
// Permission Types
// ==========================================

export interface PermissionSuggestion {
  type: string;
  rules?: Array<{ toolName: string; ruleContent?: string }>;
  behavior?: string;
  destination?: string;
}

export interface PermissionRequestEvent {
  permissionRequestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  suggestions?: PermissionSuggestion[];
  decisionReason?: string;
  blockedPath?: string;
  toolUseId: string;
  description?: string;
}

export interface PermissionResponseRequest {
  permissionRequestId: string;
  decision: {
    behavior: 'allow';
    updatedPermissions?: PermissionSuggestion[];
    updatedInput?: Record<string, unknown>;
  } | {
    behavior: 'deny';
    message?: string;
  };
}

// ==========================================
// Plugin / MCP Types
// ==========================================

export interface PluginInfo {
  name: string;
  description: string;
  author?: { name: string; url?: string };
  path: string;
  marketplace: string;
  location: 'plugins' | 'external_plugins';
  hasCommands: boolean;
  hasSkills: boolean;
  hasAgents: boolean;
  blocked: boolean;
  enabled: boolean;
}

export interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: 'stdio' | 'sse' | 'http';
  url?: string;
  headers?: Record<string, string>;
  /** Persistent enable/disable. undefined or true = enabled; false = disabled. */
  enabled?: boolean;
  /**
   * true = 该 server 的全部工具始终进入 turn-1 prompt，绝不被 tool search 延迟。
   * Claude Code 2.1.203 起启用 tool search 时 MCP 工具默认延迟加载
   * (defer_loading)，模型须先 ToolSearch 命中才能使用；对"必须立刻可用"的
   * 工具集（如测试执行注入的 Playwright）延迟会导致模型反复 ToolSearch 空转。
   * 映射为 SDK McpServerConfig.alwaysLoad（= API defer_loading:false）。
   * 副作用：会话启动会阻塞等待该 server 连接（上限 5s）。
   */
  alwaysLoad?: boolean;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

// Backward-compatible alias
export type MCPServer = MCPServerConfig;

// ==========================================
// Settings Types
// ==========================================

export interface SettingsMap {
  [key: string]: string;
}

// Well-known setting keys
export const SETTING_KEYS = {
  DEFAULT_MODEL: 'default_model',
  DEFAULT_SYSTEM_PROMPT: 'default_system_prompt',
  THEME: 'theme',
  PERMISSION_MODE: 'permission_mode',
  MAX_THINKING_TOKENS: 'max_thinking_tokens',
  ASSISTANT_WORKSPACE_PATH: 'assistant_workspace_path',
} as const;

// ==========================================
// Setup Center Types
// ==========================================

export type SetupCardStatus = 'not-configured' | 'completed' | 'skipped' | 'needs-fix';
export interface SetupState {
  completed: boolean;
  claude: SetupCardStatus;
  provider: SetupCardStatus;
  project: SetupCardStatus;
  defaultProject?: string;
}

// ==========================================
// Assistant Workspace Types
// ==========================================

export interface AssistantWorkspaceState {
  onboardingComplete: boolean;
  /** @deprecated Use lastHeartbeatDate instead */
  lastCheckInDate?: string | null;
  lastHeartbeatDate: string | null;
  lastHeartbeatText?: string;
  lastHeartbeatSentAt?: number;
  /** @deprecated Use heartbeatEnabled instead */
  dailyCheckInEnabled?: boolean;
  heartbeatEnabled: boolean;
  schemaVersion: number;
  hookTriggeredSessionId?: string;
  hookTriggeredAt?: string;
  buddy?: {
    species: string;
    rarity: string;
    stats: Record<string, number>;
    emoji: string;
    peakStat: string;
    hatchedAt: string;
    buddyName?: string;
  };
}

export interface AssistantWorkspaceFiles {
  soul?: string;
  memory?: string;
  user?: string;
  claude?: string;
}

export interface AssistantWorkspaceFilesV2 extends AssistantWorkspaceFiles {
  rootDir?: string;
  heartbeatMd?: string;
}

// ==========================================
// Workspace Inspect Types
// ==========================================

export interface WorkspaceInspectResult {
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  writable: boolean;
  hasAssistantData: boolean;
  workspaceStatus: 'empty' | 'normal_directory' | 'existing_workspace' | 'partial_workspace' | 'invalid';
  summary?: {
    onboardingComplete: boolean;
    lastHeartbeatDate: string | null;
    /** @deprecated Use lastHeartbeatDate instead */
    lastCheckInDate?: string | null;
    fileCount: number;
  };
}

// ==========================================
// Workspace Config Types
// ==========================================

export interface AssistantWorkspaceConfig {
  workspaceType: string;
  organizationStyle: 'project' | 'time' | 'topic' | 'mixed';
  captureDefault: string;
  archivePolicy: {
    completedTaskArchiveAfterDays: number;
    closedProjectArchive: boolean;
    dailyMemoryRetentionDays: number;
  };
  ignore: string[];
  index: {
    maxFileSizeKB: number;
    chunkSize: number;
    chunkOverlap: number;
    maxDepth: number;
    includeExtensions: string[];
  };
}

// ==========================================
// Taxonomy Types
// ==========================================

export interface TaxonomyCategory {
  id: string;
  label: string;
  paths: string[];
  role: string;
  confidence: number;
  source: 'user' | 'learned' | 'default';
  description: string;
  createdBy: string;
}

export interface TaxonomyFile {
  version: number;
  categories: TaxonomyCategory[];
  evolutionRules: {
    allowAutoCreateCategory: boolean;
    allowAutoArchive: boolean;
    requireConfirmationForMoves: boolean;
  };
}

// ==========================================
// Workspace Index Types
// ==========================================

export interface ManifestEntry {
  noteId: string;
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  headings: string[];
  mtime: number;
  size: number;
  hash: string;
  summary: string;
  categoryIds: string[];
}

export interface ChunkEntry {
  chunkId: string;
  noteId: string;
  path: string;
  heading: string;
  text: string;
  startLine: number;
  endLine: number;
}

export interface HotsetFile {
  pinned: string[];
  frequent: Array<{ path: string; count: number; lastAccessed: number }>;
  lastUpdated: number;
}

export interface SearchResult {
  path: string;
  heading: string;
  snippet: string;
  score: number;
  source: 'title' | 'heading' | 'tag' | 'content';
}

// ==========================================
// Reference Image Types (for image generation)
// ==========================================

export interface ReferenceImage {
  mimeType: string;
  data?: string;       // base64 (user upload)
  localPath?: string;  // file path (generated result)
}

export interface MentionRef {
  path: string;
  nodeType: MentionNodeType;
  display: string;
  sourceRange: {
    start: number;
    end: number;
  };
}

// ==========================================
// File Attachment Types
// ==========================================

export interface FileAttachment {
  id: string;
  name: string;
  type: string; // MIME type
  size: number;
  data: string; // base64 encoded content
  filePath?: string; // persisted disk path (for messages reloaded from DB)
}

// Check if a MIME type is an image
// type 可能缺失(历史消息/外部调用方构造的附件元数据没带 MIME)——缺失时按
// 非媒体处理,绝不能让一条脏 attachment 白屏整个会话页或 500 掉发送链。
export function isImageFile(type: string | undefined | null): boolean {
  return !!type && type.startsWith('image/');
}

// Check if a MIME type is a video
export function isVideoFile(type: string | undefined | null): boolean {
  return !!type && type.startsWith('video/');
}

// Check if a MIME type is any visual media (image or video)
export function isMediaFile(type: string | undefined | null): boolean {
  return !!type && (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/'));
}

// Format bytes into human-readable size
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ==========================================
// Classified Error Types (from error-classifier)
// ==========================================

export type { ClaudeErrorCategory, ClassifiedError } from '@/lib/error-classifier';

// ==========================================
// Claude Client Types
// ==========================================

// ==========================================
// Batch Image Generation Types
// ==========================================

export type MediaJobStatus = 'draft' | 'planning' | 'planned' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
export type MediaJobItemStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface MediaJob {
  id: string;
  session_id: string | null;
  status: MediaJobStatus;
  doc_paths: string;       // JSON array of file paths
  style_prompt: string;
  batch_config: string;    // JSON of BatchConfig
  total_items: number;
  completed_items: number;
  failed_items: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface MediaJobItem {
  id: string;
  job_id: string;
  idx: number;
  prompt: string;
  aspect_ratio: string;
  image_size: string;
  model: string;
  tags: string;            // JSON array of strings
  source_refs: string;     // JSON array of strings
  status: MediaJobItemStatus;
  retry_count: number;
  result_media_generation_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface MediaContextEvent {
  id: string;
  session_id: string;
  job_id: string;
  payload: string;         // JSON object
  sync_mode: 'manual' | 'auto_batch';
  synced_at: string | null;
  created_at: string;
}

export interface BatchConfig {
  concurrency: number;     // max parallel image generations (default: 2)
  maxRetries: number;      // max retry attempts per item (default: 2)
  retryDelayMs: number;    // base delay for exponential backoff (default: 2000)
}

export interface PlannerItem {
  prompt: string;
  aspectRatio: string;
  resolution: string;
  tags: string[];
  sourceRefs: string[];
}

export interface PlannerOutput {
  summary: string;
  items: PlannerItem[];
}

export type JobProgressEventType =
  | 'item_started'
  | 'item_completed'
  | 'item_failed'
  | 'item_retry'
  | 'job_completed'
  | 'job_paused'
  | 'job_cancelled';

export interface JobProgressEvent {
  type: JobProgressEventType;
  jobId: string;
  itemId?: string;
  itemIdx?: number;
  progress: {
    total: number;
    completed: number;
    failed: number;
    processing: number;
  };
  error?: string;
  retryCount?: number;
  mediaGenerationId?: string;
  timestamp: string;
}

// --- Batch Image Gen API Types ---

export interface CreateMediaJobRequest {
  sessionId?: string;
  items: Array<{
    prompt: string;
    aspectRatio?: string;
    imageSize?: string;
    model?: string;
    tags?: string[];
    sourceRefs?: string[];
  }>;
  batchConfig?: Partial<BatchConfig>;
  stylePrompt?: string;
  docPaths?: string[];
}

export interface PlanMediaJobRequest {
  docPaths?: string[];
  docContent?: string;
  stylePrompt: string;
  sessionId?: string;
  count?: number;
}

export interface UpdateMediaJobItemsRequest {
  items: Array<{
    id: string;
    prompt?: string;
    aspectRatio?: string;
    imageSize?: string;
    tags?: string[];
  }>;
}

export interface MediaJobResponse {
  job: MediaJob;
  items: MediaJobItem[];
}

export interface MediaJobListResponse {
  jobs: MediaJob[];
}

// ==========================================
// Stream Session Manager Types
// ==========================================

export interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  media?: MediaBlock[];
}

export type StreamPhase = 'active' | 'completed' | 'error' | 'stopped';

export interface SessionStreamSnapshot {
  sessionId: string;
  phase: StreamPhase;
  streamingContent: string;
  streamingThinkingContent: string;
  toolUses: ToolUseInfo[];
  toolResults: ToolResultInfo[];
  streamingToolOutput: string;
  /**
   * Ordered content blocks accumulated in SSE-event arrival order (= true
   * chronological order, since the SDK emits text/tool/thinking in content
   * order). Drives the interleaved render in StreamingMessage. The legacy
   * split fields above (streamingContent / toolUses / ...) are kept for
   * back-compat with other readers but `blocks` is the source of truth for
   * ordering. See stream-session-manager.ts accumulation + MessageSegments.
   */
  blocks: MessageContentBlock[];
  statusText: string | undefined;
  pendingPermission: PermissionRequestEvent | null;
  permissionResolved: 'allow' | 'deny' | null;
  tokenUsage: TokenUsage | null;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  /** Final message content built at stream completion for ChatView to consume */
  finalMessageContent: string | null;
  /**
   * Optional terminal reason emitted by SDK 0.2.111 on SDKResultMessage.
   * Used by ChatView to render a contextual end-of-turn chip (Phase 1 of
   * agent-sdk-0-2-111-adoption). Absent for error paths without a result
   * message — those continue to flow through error-classifier.ts.
   */
  terminalReason?: string;
  /**
   * SDK 0.2.111 subscription rate-limit telemetry (Phase 2 of
   * agent-sdk-0-2-111-adoption). Populated from rate_limit_event
   * stream messages; only present on claude.ai subscription paths.
   * ChatView consumes this to render warning / rejected UIs.
   */
  rateLimitInfo?: {
    status: 'allowed' | 'allowed_warning' | 'rejected';
    resetsAt?: number;
    rateLimitType?: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage';
    utilization?: number;
    overageStatus?: 'allowed' | 'allowed_warning' | 'rejected';
    overageResetsAt?: number;
    overageDisabledReason?: string;
    isUsingOverage?: boolean;
  };
  /**
   * Post-turn context-usage snapshot captured via Query.getContextUsage()
   * (SDK 0.2.111 Phase 5). Consumers should treat this as authoritative
   * for ~60s after capturedAt, then fall back to the char-based estimator.
   */
  contextUsageSnapshot?: {
    totalTokens: number;
    maxTokens: number;
    rawMaxTokens: number;
    percentage: number;
    model: string;
    /** Epoch ms at which the snapshot was taken */
    capturedAt: number;
  };
  /**
   * Cowork sandbox: files the agent created/modified inside the VM this
   * turn (emitted after result via the vm_artifacts SSE event). ChatView
   * merges these into its session-level artifact list for download cards.
   */
  vmArtifacts?: VmArtifactFile[];
  /**
   * Cowork sandbox: latest VM provisioning status during the cold-start
   * readiness window (P1-D). Drives the "沙箱准备中" banner; cleared to
   * 'ready'/undefined once the VM is up and normal streaming begins.
   */
  vmStatus?: VmStatusEvent;
}

export interface StreamEvent {
  type: 'snapshot-updated' | 'phase-changed' | 'permission-request' | 'completed';
  sessionId: string;
  snapshot: SessionStreamSnapshot;
}

export type StreamEventListener = (event: StreamEvent) => void;

/**
 * One history row passed via ClaudeStreamOptions.conversationHistory.
 *
 * `_rowid` is the SQLite rowid of the original DB row, propagated so that
 * reactive compact (claude-client.ts) can write a correct
 * context_summary_boundary_rowid on CONTEXT_TOO_LONG retry. Synthesized /
 * non-DB-origin rows may omit it — callers that only have {role, content}
 * pairs (e.g. bridge transports, fallback paths) don't need to fabricate a
 * rowid; the boundary helper falls back to the existing session boundary.
 */
export type ConversationHistoryItem = {
  role: 'user' | 'assistant';
  content: string;
  _rowid?: number;
};

export interface ClaudeStreamOptions {
  prompt: string;
  sessionId: string;
  sdkSessionId?: string; // SDK session ID for resuming conversations
  model?: string;
  systemPrompt?: string;
  workingDirectory?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  abortController?: AbortController;
  permissionMode?: string;
  files?: FileAttachment[];
  imageAgentMode?: boolean;
  toolTimeoutSeconds?: number;
  provider?: ApiProvider;
  /** Explicit provider ID (e.g. 'env') — passed to resolveForClaudeCode */
  providerId?: string;
  /** Session's stored provider ID — passed to resolveForClaudeCode */
  sessionProviderId?: string;
  /** Recent conversation history from DB — used as fallback context when SDK resume is unavailable or fails */
  conversationHistory?: ConversationHistoryItem[];
  /** Compressed session summary — used as context skeleton in fallback mode */
  sessionSummary?: string;
  /** Existing compact coverage boundary (rowid). Reactive compact preserves this
   *  rather than resetting to 0 when it cannot derive a new boundary from _rowid
   *  metadata in conversationHistory. */
  sessionSummaryBoundaryRowid?: number;
  /** Token budget for fallback history — messages beyond this budget are truncated */
  fallbackTokenBudget?: number;
  onRuntimeStatusChange?: (status: string) => void;
  /** Per-session bypass: when true, skip all permission checks for this session */
  bypassPermissions?: boolean;
  /** Thinking configuration for the query */
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
  /** Effort level for the query (Opus 4.7 adds 'xhigh') */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Output format for structured responses */
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
  /** Custom agent definitions */
  agents?: Record<string, { description: string; prompt?: string; tools?: string[]; disallowedTools?: string[] }>;
  /** Agent name for the main thread */
  agent?: string;
  /** Enable file checkpointing for rewind support */
  enableFileCheckpointing?: boolean;
  /** When true, this is an auto-trigger turn (invisible to user) — skip rewind point emission */
  autoTrigger?: boolean;
  /** Enable 1M context window (beta header: context-1m-2025-08-07) */
  context1m?: boolean;
  /** Enable generative UI widget guidelines MCP server (default: true) */
  generativeUI?: boolean;
}

// ==========================================
// CLI Tools Types
// ==========================================

export type CliToolStatus = 'not_installed' | 'installed' | 'needs_auth' | 'ready';
export type CliToolCategory = 'media' | 'data' | 'search' | 'download' | 'document' | 'productivity';
export type InstallMethod = 'brew' | 'npm' | 'pipx' | 'cargo';

export type CliToolPlatform = 'darwin' | 'linux' | 'win32';

export interface CliToolInstallMethod {
  method: InstallMethod;
  command: string;
  platforms: CliToolPlatform[];
}

export interface CliToolExamplePrompt {
  label: string;
  promptZh: string;
  promptEn: string;
}

export interface CliToolDefinition {
  id: string;
  name: string;
  binNames: string[];
  summaryZh: string;
  summaryEn: string;
  categories: CliToolCategory[];
  installMethods: CliToolInstallMethod[];
  setupType: 'simple' | 'needs_auth';
  detailIntro: { zh: string; en: string };
  useCases: { zh: string[]; en: string[] };
  guideSteps: { zh: string[]; en: string[] };
  examplePrompts: CliToolExamplePrompt[];
  /** Commands that MUST be run after install (e.g. skills install, dependency install).
   *  These are injected into the chat prefill — only include machine-executable commands,
   *  not human-readable guidance. */
  postInstallCommands?: string[];
  /** Tool is designed for AI agents (non-interactive flags, structured output, skills) */
  agentFriendly?: boolean;
  /** Tool supports --json or similar structured output flag */
  supportsJson?: boolean;
  /** Tool supports runtime schema introspection (e.g. "gws schema", "--help --json") */
  supportsSchema?: boolean;
  /** Tool supports --dry-run for previewing destructive actions */
  supportsDryRun?: boolean;
  /** Tool supports field masks or pagination to reduce context window usage */
  contextFriendly?: boolean;
  /** Command to check auth/health status (e.g. "stripe status", "lark-cli auth status") */
  healthCheckCommand?: string;
  homepage?: string;
  repoUrl?: string;
  officialDocsUrl?: string;
  supportsAutoDescribe: boolean;
}

export interface CliToolRuntimeInfo {
  id: string;
  status: CliToolStatus;
  version: string | null;
  binPath: string | null;
  autoDescription?: { zh: string; en: string } | null;
}

export interface CustomCliTool {
  id: string;
  name: string;
  binPath: string;
  binName: string;
  version: string | null;
  installMethod: string;
  installPackage: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CliToolAgentCompat {
  agentFriendly?: boolean;
  supportsJson?: boolean;
  supportsSchema?: boolean;
  supportsDryRun?: boolean;
  contextFriendly?: boolean;
}

export interface CliToolStructuredDesc {
  intro: { zh: string; en: string };
  useCases: { zh: string[]; en: string[] };
  guideSteps: { zh: string[]; en: string[] };
  examplePrompts: CliToolExamplePrompt[];
  agentCompat?: CliToolAgentCompat;
}

// ==========================================
// Git Types
// ==========================================

export interface GitStatus {
  isRepo: boolean;
  repoRoot: string;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  changedFiles: GitChangedFile[];
}

export interface GitChangedFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked';
  staged: boolean;
}

export interface GitBranch {
  name: string;
  isRemote: boolean;
  upstream: string;
  worktreePath: string;
}

export interface GitLogEntry {
  sha: string;
  authorName: string;
  authorEmail: string;
  timestamp: string;
  message: string;
}

export interface GitCommitDetail extends GitLogEntry {
  stats: string;
  diff: string;
}

export interface GitWorktree {
  path: string;
  head: string;
  branch: string;
  bare: boolean;
  dirty: boolean;
}

// ==========================================
// WeChat Bridge Types
// ==========================================

export interface WeixinAccount {
  accountId: string;
  userId: string;
  baseUrl: string;
  cdnBaseUrl: string;
  token: string;
  name: string;
  enabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeixinContextTokenRecord {
  accountId: string;
  peerUserId: string;
  contextToken: string;
  updatedAt: string;
}

// ==========================================
// Scheduled Tasks
// ==========================================

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  next_run: string;
  last_run?: string;
  last_status?: 'success' | 'error' | 'skipped' | 'running';
  last_error?: string;
  last_result?: string;
  consecutive_errors: number;
  status: 'active' | 'paused' | 'completed' | 'disabled';
  priority: 'low' | 'normal' | 'urgent';
  notify_on_complete: number;
  session_id?: string;
  working_directory?: string;
  permanent: number;
  created_at: string;
  updated_at: string;
}

// ===== Test Accounts (测试账号设置) =====
// 在设置中配置「测试时访问账号」，导出到 AI_LabTest 的 environments.json 供测试框架消费。
// 对标 AI_LabTest「环境配置」对话框，但支持多个系统：每个系统 = 一个 AI_LabTest 工作区目录，
// 环境固定 local + sit（AI_LabTest 白名单约束）。密钥明文存本地库（与 AI_LabTest 一致，DB 仅本机）。
// 设计/契约见 docs/exec-plans/active/test-account-settings.md。

export type TestEnvKey = 'local' | 'sit';
export type TestAuthMethod = 'password' | 'token' | 'capture';
/** token 注入位置 —— 映射 AI_LabTest 账号的 storageType 字段 */
export type TestTokenStorage = 'header' | 'localStorage' | 'sessionStorage' | 'cookie';

/** 单个登录账号。导出到 environments[env].accounts[]，三种形态字段不同（见 toEnvironmentsJson）。 */
export interface TestLoginAccount {
  /** 角色 key，env 内唯一，导出为 accounts[].key；storageState 文件名按其 sanitize 派生 */
  key: string;
  role: string;
  authMethod: TestAuthMethod;
  // password 方式（明文）
  username?: string;
  password?: string;
  // token 方式（明文；header 类型不要预置 Bearer，AI_LabTest runner 自动加）
  token?: string;
  capturedAt?: string;
  storageType?: TestTokenStorage;
  storageKey?: string;
  // capture（获取登录态）方式：登录态 blob 不入库，存为独立 storageState 文件；
  // captured 仅作 UI 缓存提示，真值以 .auth 文件存在性为准（见 capture status 接口）。
  captured?: boolean;
}

/** 单个环境（local / sit）。映射 environments[env]。 */
export interface TestEnvironment {
  label: string;
  frontendBaseUrl: string;
  apiBaseUrl: string;
  healthEndpoint: string;
  /** 导出为 environments[env].defaultAccount，必须等于某 account.key */
  defaultAccountKey: string;
  accounts: TestLoginAccount[];
}

/** 一个系统的两个环境配置（解析自 DB 的 environments_json 列）。 */
export interface TestSystemEnvironments {
  local: TestEnvironment;
  sit: TestEnvironment;
}

/** DB 行：test_account_systems。environments_json 为 TestSystemEnvironments 的 stringify。 */
export interface TestAccountSystem {
  id: string;
  name: string;
  /** AI_LabTest 工作区目录；导出目标为 {project_root}/AI_LabTest/environments.json */
  project_root: string;
  sort_order: number;
  environments_json: string;
  created_at: string;
  updated_at: string;
}

/** API/前端友好形态：environments 已解析。 */
export interface TestAccountSystemView {
  id: string;
  name: string;
  project_root: string;
  sort_order: number;
  environments: TestSystemEnvironments;
  created_at: string;
  updated_at: string;
}

export interface CreateTestAccountSystemRequest {
  name: string;
  project_root?: string;
  environments?: TestSystemEnvironments;
}

export interface UpdateTestAccountSystemRequest {
  name?: string;
  project_root?: string;
  environments?: TestSystemEnvironments;
  sort_order?: number;
}

// ==========================================
// Test Usage Stats (测试模块使用统计)
// ==========================================
// 测试工作台使用统计：追加式事件流水（DB 表 test_stats_events）+ 聚合响应契约。
// 口径要点：采纳率以首轮 AI 生成为基线；准确度只算人工已复核条次并同示复核覆盖率；
// 401 熔断（circuitBroken）轮次整轮排除；展示层只给指标、不列具体用例
// （底层事件仍按用例粒度 id+hash 记录，是自动 diff 与误判归类的基础）。
// 事件字典 / 冻结口径 / 分期见 docs/exec-plans/active/test-usage-stats.md。

export type TestStatsEventType =
  | 'task_created'        // 新建任务（前端）
  | 'task_deleted'        // 删除任务（前端）
  | 'step_completed'      // 四步任一步 SSE 正常收尾（服务端）
  | 'cases_generated'     // cases 步 / revise 写出 cases.json（服务端，含 id+hash 快照）
  | 'cases_edited'        // 用例手动编辑保存（服务端）
  | 'cases_approved'      // 用户批准用例；diff 由服务端对首轮快照计算（前端触发）
  | 'execution_completed' // 执行步收尾、run.json 落盘（服务端）
  | 'report_generated'    // 报告步收尾（服务端）
  | 'report_reviewed'     // 人工复核单条结论（前端）
  | 'report_review_bulk'; // 一键全部标记准确（前端）

/** 与 lib/test/prompts.ts 的 TestStep 对齐；独立定义避免 types → lib 反向依赖。 */
export type TestStatsStep = 'requirement' | 'cases' | 'execution' | 'report';

/** 复核结论：准确 / 误报（AI 判失败实际正常）/ 漏报（AI 判通过实际有问题）/ 程度不符。 */
export type TestReviewVerdict = 'accurate' | 'false_fail' | 'missed_fail' | 'severity_mismatch';

/** 用例身份快照：id + 内容 hash（不存用例内容本身）。 */
export interface TestStatsCaseKey {
  id: string;
  hash: string;
}

/** POST /api/test/stats 单条事件输入；payload 为开放 JSON，字段随 event_type 而异。 */
export interface TestStatsEventInput {
  eventType: TestStatsEventType;
  projectPath: string;
  taskId: string;
  taskName?: string;
  env?: string;
  payload?: Record<string, unknown>;
}

/** DB 行视图：test_stats_events（payload 已解析；createdAt 为 UTC 'YYYY-MM-DD HH:MM:SS'）。 */
export interface TestStatsEvent {
  id: string;
  eventType: TestStatsEventType;
  projectPath: string;
  taskId: string;
  taskName: string;
  env: string | null;
  payload: Record<string, unknown>;
  schemaVersion: number;
  createdAt: string;
}

/** 四态计数（与 lib/test/reduce.ts 的 RunCounts 对齐，独立定义避免反向依赖）。 */
export interface TestStatsCounts {
  total: number;
  pass: number;
  fail: number;
  partial: number;
  blocked: number;
}

/** 用例采纳汇总。比率为 0-1 小数；分母为 0 时为 null。 */
export interface TestStatsAdoption {
  /** 计入分母的任务数：AI 生成流（source=imported_requirement）且已批准 */
  eligibleTasks: number;
  /** 首轮 AI 生成用例数合计（采纳基线） */
  generated: number;
  kept: number;
  modified: number;
  removed: number;
  userAdded: number;
  /** (kept+modified)/generated */
  adoptionRate: number | null;
  keptRate: number | null;
  /** 返工轮数合计（每任务 cases 生成轮数 - 1，聚合所有 AI 生成流任务） */
  reworkRounds: number;
}

/** 报告复核汇总。totalResults 为可复核条次（排除熔断轮）。 */
export interface TestStatsReview {
  totalResults: number;
  reviewed: number;
  coverage: number | null;
  accurate: number;
  falseFail: number;
  missedFail: number;
  severityMismatch: number;
  accuracy: number | null;
}

export interface TestStatsExecution {
  /** 执行轮次总数（含熔断轮） */
  runs: number;
  /** 四态合计（排除熔断轮） */
  results: TestStatsCounts;
  passRate: number | null;
  avgCaseDurationMs: number | null;
  /** 单用例时长分布（固定桶：<15s / 15–30s / 30–60s / 1–2m / >2m） */
  durationBuckets: { label: string; count: number }[];
  /** 各步骤平均用时（step_completed.durationMs 均值） */
  stepAvgDurationsMs: Partial<Record<TestStatsStep, number>>;
}

export interface TestStatsWeeklyPoint {
  /** 周一（UTC）YYYY-MM-DD */
  weekStart: string;
  tasksCreated: number;
  casesKept: number;
  casesModified: number;
  casesRemoved: number;
  reviewAccuracy: number | null;
}

export interface TestStatsTaskRow {
  taskId: string;
  taskName: string;
  projectPath: string;
  createdAt: string | null;
  /** imported_requirement / imported_cases / both；无 task_created 事件时为 null */
  source: string | null;
  /** 是否计入采纳率（AI 生成流） */
  adoptionEligible: boolean;
  generated: number | null;
  adopted: number | null;
  modified: number | null;
  removed: number | null;
  executionRuns: number;
  latestResults: TestStatsCounts | null;
  latestCircuitBroken: boolean;
  latestDurationMs: number | null;
  reviewed: number;
  reviewTotal: number;
  accuracy: number | null;
  deleted: boolean;
}

export interface TestStatsGlobal {
  range: { from: string | null; to: string | null };
  tasks: { total: number; aiFlow: number; importedCases: number; deleted: number };
  adoption: TestStatsAdoption;
  execution: TestStatsExecution;
  review: TestStatsReview;
  weekly: TestStatsWeeklyPoint[];
  taskRows: TestStatsTaskRow[];
}

/** 任务详情 · 节点轮次（指标做行、轮次做列的数据源；只含指标不含具体用例）。 */
export interface TestStatsNodeRound {
  step: TestStatsStep;
  round: number;
  at: string | null;
  env: string | null;
  model: string | null;
  providerId: string | null;
  durationMs: number | null;
  status: string | null;
  /** cases 轮：本轮生成用例数 */
  caseCount: number | null;
  /** cases 轮：本轮生成集 vs 最终批准集的 diff（无批准快照时为 null） */
  adoption: { rate: number | null; kept: number; modified: number; removed: number; added: number } | null;
  /** execution 轮 */
  results: TestStatsCounts | null;
  passRate: number | null;
  circuitBroken: boolean;
  runHash: string | null;
  /** report 轮：按 runHash 关联的复核进度 */
  reviewed: number | null;
  accuracy: number | null;
}

export interface TestStatsTaskDetail {
  taskId: string;
  taskName: string;
  projectPath: string;
  createdAt: string | null;
  source: string | null;
  rounds: TestStatsNodeRound[];
  adoption: {
    generated: number;
    kept: number;
    modified: number;
    removed: number;
    userAdded: number;
    adoptionRate: number | null;
    reworkRounds: number;
  } | null;
  review: TestStatsReview;
}

/** 模型使用与效果行。归因：采纳率→首轮用例设计模型；准确度/通过率/时长→执行模型。 */
export interface TestStatsModelRow {
  model: string;
  tasks: number;
  executionRuns: number;
  adoptionGenerated: number;
  adoptionKeptModified: number;
  adoptionRate: number | null;
  results: TestStatsCounts;
  passRate: number | null;
  reviewed: number;
  accurate: number;
  accuracy: number | null;
  coverage: number | null;
  avgCaseDurationMs: number | null;
  /** 样本量小（执行轮 <3 或复核 <10），前端提示低置信度 */
  smallSample: boolean;
}

/* ============ 回归测试统计（文件态聚合层的 UI 输出契约） ============
 * 功能测试统计走 test_stats_events 事件溯源、跨项目「本机」口径；回归统计走
 * AI_LabTest/ 下的文件态（回归轮次.json + 每轮 run.json + 回归套件.json + 回归用例库.json），
 * 单项目口径。两条管线互不污染。计算实现与单测在 src/lib/test/regression-stats.ts。 */

/** 周趋势点（ISO 周一 UTC 分桶，与功能统计 stats.ts 同口径）。 */
export interface RegressionWeeklyPoint {
  /** 'YYYY-MM-DD'，该周周一（UTC）。 */
  weekStart: string;
  /** 当周 mode='full' 的已执行轮次数（含 done/partial/aborted，排除 running）。 */
  roundsFull: number;
  /** 当周 mode='failed-only' 的重跑轮次数。 */
  roundsFailedOnly: number;
  /** 当周用例执行条次之和（优先取每轮 run.json 记录数并排除 circuitBroken 轮，退化取 round.counts.total）。 */
  caseExecutions: number;
}

/** 脚本重放 vs AI 执行点（每轮一条，仅取近 N 个已执行且非熔断轮）。 */
export interface RegressionScriptPoint {
  roundId: string;
  /** 轴标签（`#序号`，序号为该轮在已执行轮中的升序位次）。 */
  label: string;
  scriptPass: number;
  scriptFail: number;
  aiPass: number;
  aiFail: number;
}

/** 套件明细行。'builtin' = 内置「全量」；覆盖率 = caseCount/libraryTotal。 */
export interface RegressionSuiteRow {
  name: string;
  type: 'builtin' | 'static' | 'query';
  /** 该套件对当前库求值命中的用例数（内置「全量」= 库内非隔离条目数）。 */
  caseCount: number;
  /** 分母：库内非隔离条目总数。 */
  libraryTotal: number;
  /** 该套件被执行的轮次数（suiteName 匹配、排除 running）。 */
  runCount: number;
  /** 最近一轮（非熔断、done/partial）的通过率 0-1；无有效轮 → null。 */
  latestPassRate: number | null;
  /** 最近一轮通过串，如 "8/10"；无 → null。 */
  latestPassStr: string | null;
  /** 各已收口轮 finishedAt−startedAt 均值（ms）；无 → null。 */
  avgDurationMs: number | null;
  /** 各有 run.json 摘要且非熔断轮的 脚本占比（via='script'/total）均值 0-1；无 → null。 */
  replayRatio: number | null;
}

/** 回归统计 · 聚合输出（GET /api/test/regression-stats 的 data）。 */
export interface RegressionStats {
  /** 当前项目目录名（面板标题曝光单项目口径用）。 */
  projectName: string;
  /** 窗口内已执行轮次总数（排除 running）。 */
  totalRounds: number;
  /** run.json 摘要读取的轮次上限（性能护栏，超出的更早轮不参与 run.json 相关口径）。 */
  runReadLimit: number;
  weekly: RegressionWeeklyPoint[];
  scriptVsAi: RegressionScriptPoint[];
  suites: RegressionSuiteRow[];
  /** 是否有任何可展示数据（轮次/套件/库任一非空）。空态据此判定。 */
  hasData: boolean;
}
