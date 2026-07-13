import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKPartialAssistantMessage,
  SDKSystemMessage,
  SDKToolProgressMessage,
  Options,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
  McpServerConfig,
} from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeStreamOptions, SSEEvent, TokenUsage, MCPServerConfig, PermissionRequestEvent, FileAttachment, MediaBlock } from '@/types';
import { isImageFile } from '@/types';
import { registerPendingPermission } from './permission-registry';
import { registerConversation, unregisterConversation } from './conversation-registry';
import { captureCapabilities, isCacheFresh, setCachedPlugins } from './agent-sdk-capabilities';
import { normalizeMessageContent, microCompactMessage } from './message-normalizer';
import { roughTokenEstimate } from './context-estimator';
import { getSetting, updateSdkSessionId, createPermissionRequest } from './db';
import { fireContextUsageProbe } from './context-usage-probe';
import { resolveForClaudeCode } from './provider-resolver';
import { sanitizeClaudeModelOptions } from './claude-model-options';
// platform.ts CLI binary lookup helpers were removed when AI Native Lab switched to
// the bundled platform-specific @anthropic-ai/claude-agent-sdk subpackage
// (cli.js no longer needs to be resolved against the user's local install).
import { notifyPermissionRequest, notifyGeneric } from './telegram-bot';
import { classifyError, formatClassifiedError } from './error-classifier';
import { resolveWorkingDirectory } from './working-directory';
import { wrapController } from './safe-stream';
import { type ShadowHome } from './claude-home-shadow';
import { prepareSdkSubprocessEnv } from './sdk-subprocess-env';
// Static imports for resolveRuntime/detectTransport — used to be lazy
// `require('./runtime')` / `require('./provider-transport')`, but Turbopack's
// CJS↔ESM interop returns `{ default: ... }` shape that broke destructuring
// at runtime ("resolveRuntime is not a function" etc).
//
// IMPORTANT: import from `./runtime/registry` NOT from `./runtime` (== index).
// runtime/index.ts imports native-runtime AND sdk-runtime at top-level and
// registers them. sdk-runtime in turn imports FROM this file (claude-client).
// Importing `./runtime` here closes the cycle
// claude-client → runtime/index → sdk-runtime → claude-client
// and during evaluation of sdk-runtime's `export const sdkRuntime = {...}`,
// runtime/index's own `registerRuntime(sdkRuntime)` line hits the TDZ and
// throws "Cannot access 'sdkRuntime' before initialization" (caught by
// sdk-availability.test.ts under certain module load orders).
// registry.ts only imports types/db/claude-settings — no cycle. The actual
// runtime registration still happens elsewhere (runtime/index is imported
// via its own entry points at app startup).
import { resolveRuntime, getRuntime } from './runtime/registry';
import { detectTransport, isNativeCompatible } from './provider-transport';
import os from 'os';
import fs from 'fs';
import path from 'path';

/**
 * Sanitize a string for use as an environment variable value.
 * Removes null bytes and control characters that cause spawn EINVAL.
 */
function sanitizeEnvValue(value: string): string {
   
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Sanitize all values in an env record so child_process.spawn won't
 * throw EINVAL due to invalid characters or non-string values.
 * On Windows, spawn is strict: every env value MUST be a string.
 * Spreading process.env can include undefined values which cause EINVAL.
 */
function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      clean[key] = sanitizeEnvValue(value);
    }
  }
  return clean;
}

/**
 * @deprecated Local CLI path lookup is no longer used since AI Native Lab switched
 * to the bundled platform-specific @anthropic-ai/claude-agent-sdk subpackage.
 * Kept as a no-op for backwards compatibility with /api/claude-upgrade and
 * /api/claude-status/invalidate which still call this. Those routes will be
 * cleaned up alongside the UI rework.
 */
export function invalidateClaudeClientCache(): void {
  // no-op
}

/**
 * Convert our MCPServerConfig to the SDK's McpServerConfig format.
 * Supports stdio, sse, and http transport types.
 */
function toSdkMcpConfig(
  servers: Record<string, MCPServerConfig>
): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {};
  for (const [name, config] of Object.entries(servers)) {
    const transport = config.type || 'stdio';

    switch (transport) {
      case 'sse': {
        if (!config.url) {
          console.warn(`[mcp] SSE server "${name}" is missing url, skipping`);
          continue;
        }
        const sseConfig: McpSSEServerConfig = {
          type: 'sse',
          url: config.url,
        };
        if (config.headers && Object.keys(config.headers).length > 0) {
          sseConfig.headers = config.headers;
        }
        result[name] = sseConfig;
        break;
      }

      case 'http': {
        if (!config.url) {
          console.warn(`[mcp] HTTP server "${name}" is missing url, skipping`);
          continue;
        }
        const httpConfig: McpHttpServerConfig = {
          type: 'http',
          url: config.url,
        };
        if (config.headers && Object.keys(config.headers).length > 0) {
          httpConfig.headers = config.headers;
        }
        result[name] = httpConfig;
        break;
      }

      case 'stdio':
      default: {
        if (!config.command) {
          console.warn(`[mcp] stdio server "${name}" is missing command, skipping`);
          continue;
        }
        const stdioConfig: McpStdioServerConfig = {
          command: config.command,
          args: config.args,
          env: config.env,
        };
        result[name] = stdioConfig;
        break;
      }
    }
  }
  return result;
}

/**
 * Format an SSE line from an event object
 */
function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Extract text content from an SDK assistant message
 */
function extractTextFromMessage(msg: SDKAssistantMessage): string {
  const parts: string[] = [];
  for (const block of msg.message.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

/**
 * Extract token usage from an SDK result message
 */
function extractTokenUsage(msg: SDKResultMessage): TokenUsage | null {
  if (!msg.usage) return null;
  return {
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
    cost_usd: 'total_cost_usd' in msg ? msg.total_cost_usd : undefined,
  };
}

/**
 * FIX(占用口径): 从单条 assistant 消息（= 一次模型请求）提取其单次 usage。
 * 与整轮累计的 result.usage 不同，这是「该次请求的真实 prompt 大小」——
 * input + cache_read + cache_creation 不含跨内部请求累加，适合作为当前上下文占用。
 * 探针实测：整轮 result.usage.cacheR 会随回合内 N 次工具调用累加（一次回合 17 次请求
 * → cacheR 虚高 6.5×），而单条 assistant 请求的值是平的、等于真实驻留量。
 */
function extractAssistantTurnUsage(msg: SDKAssistantMessage): TokenUsage | null {
  const u = msg.message?.usage as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  } | undefined;
  if (!u) return null;
  return {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Stream Claude responses using the Agent SDK.
 * Returns a ReadableStream of SSE-formatted strings.
 */
/**
 * Get file paths for non-image attachments. If the file already has a
 * persisted filePath (written by the uploads route), reuse it. Otherwise
 * fall back to writing the file to .codepilot-uploads/.
 */
function getUploadedFilePaths(files: FileAttachment[], workDir: string): string[] {
  const paths: string[] = [];
  let uploadDir: string | undefined;
  for (const file of files) {
    if (file.filePath) {
      paths.push(file.filePath);
    } else {
      // Fallback: write file to disk (should not happen in normal flow)
      if (!uploadDir) {
        uploadDir = path.join(workDir, '.codepilot-uploads');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
      }
      const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = path.join(uploadDir, `${Date.now()}-${safeName}`);
      const buffer = Buffer.from(file.data, 'base64');
      fs.writeFileSync(filePath, buffer);
      paths.push(filePath);
    }
  }
  return paths;
}

// Message normalization is in message-normalizer.ts (shared with context-compressor.ts).
// Imported dynamically in buildFallbackContext to avoid circular deps at module level.

/**
 * Build fallback context from conversation history with token-budget awareness.
 *
 * Instead of a fixed message count, walks backward from the newest message
 * and includes as many as fit within the token budget. Optionally prepends
 * a session summary as a context skeleton for the full conversation.
 */
function buildFallbackContext(params: {
  prompt: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  sessionSummary?: string;
  tokenBudget?: number;
}): string {
  const { prompt, history, sessionSummary, tokenBudget } = params;
  if (!history || history.length === 0) {
    if (sessionSummary) {
      return `<session-summary>\n${sessionSummary}\n</session-summary>\n\n${prompt}`;
    }
    return prompt;
  }

  // Normalize + microcompact: strip metadata, summarize tool blocks, truncate old messages
  const normalized = history.map((msg, i) => ({
    role: msg.role,
    content: microCompactMessage(
      msg.role,
      normalizeMessageContent(msg.role, msg.content),
      history.length - 1 - i, // ageFromEnd: 0 = newest
    ),
  }));

  // Select messages within token budget (walk backward from newest).
  // Floor at 10K tokens so even extreme sessions keep some recent context.
  const effectiveBudget = tokenBudget != null ? Math.max(tokenBudget, 10000) : undefined;
  let selected: typeof normalized;
  if (effectiveBudget) {
    selected = [];
    let accumulated = 0;
    for (let i = normalized.length - 1; i >= 0; i--) {
      const msgTokens = roughTokenEstimate(normalized[i].content) + 10; // role label overhead
      if (accumulated + msgTokens > effectiveBudget) break;
      selected.unshift(normalized[i]);
      accumulated += msgTokens;
    }
  } else {
    selected = normalized;
  }

  // Build the output
  const lines: string[] = [];

  if (sessionSummary) {
    lines.push('<session-summary>');
    lines.push(sessionSummary);
    lines.push('</session-summary>');
    lines.push('');
  }

  lines.push('<conversation_history>');
  lines.push('(This is a summary of earlier conversation turns for context. <prior-tool-call .../> and <prior-reasoning>...</prior-reasoning> are metadata markers describing what already happened — they are NOT assistant output format. Do not reproduce these tags. To call a tool, emit a real tool_use block; do not write tool calls as prose or as these markers.)');
  for (const msg of selected) {
    lines.push(`${msg.role === 'user' ? 'Human' : 'Assistant'}: ${msg.content}`);
  }
  lines.push('</conversation_history>');
  lines.push('');
  lines.push(prompt);
  return lines.join('\n');
}

/**
 * Lightweight text generation via the Claude Code SDK subprocess.
 * Uses the same provider/env resolution as streamClaude but without sessions,
 * MCP, permissions, or conversation history. Suitable for simple tasks like
 * generating tool descriptions.
 */
export async function generateTextViaSdk(params: {
  providerId?: string;
  model?: string;
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const resolved = resolveForClaudeCode(undefined, {
    providerId: params.providerId,
  });

  // Same provider-owned auth isolation as the main streaming path: when an
  // explicit DB provider is selected, this auxiliary call must NOT pick up
  // cc-switch credentials from ~/.claude/settings.json or ~/.claude.json.
  // See src/lib/sdk-subprocess-env.ts.
  const setup = prepareSdkSubprocessEnv(resolved);
  const sdkEnv = setup.env;

  const abortController = new AbortController();
  if (params.abortSignal) {
    params.abortSignal.addEventListener('abort', () => abortController.abort());
  }

  // Auto-timeout after 60s to prevent indefinite hangs
  const timeoutId = setTimeout(() => abortController.abort(), 60_000);

  const queryOptions: Options = {
    cwd: os.homedir(),
    abortController,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    env: sanitizeEnv(sdkEnv),
    settingSources: resolved.settingSources as Options['settingSources'],
    systemPrompt: params.system,
    maxTurns: 1,
    // Text-only single-turn contract: strip ALL tools. With tools available,
    // a tool-eager model (e.g. qwen3.7-max asked to translate a long doc)
    // spends turn 1 on a tool call and maxTurns(1) kills the run with
    // "Reached maximum number of turns". tools:[] disables built-ins;
    // strictMcpConfig keeps settings-file MCP servers (loaded via
    // settingSources) out of the subprocess.
    tools: [],
    strictMcpConfig: true,
  };

  if (params.model) {
    queryOptions.model = params.model;
  }

  // pathToClaudeCodeExecutable is intentionally not set — the SDK auto-discovers
  // the native binary from the bundled platform subpackage
  // (@anthropic-ai/claude-agent-sdk-<platform>-<arch>).

  let resultText = '';
  try {
    const conversation = query({
      prompt: params.prompt,
      options: queryOptions,
    });

    // Iterate through all messages; the last one with type 'result' has the answer
    for await (const msg of conversation) {
      if (msg.type === 'result' && 'result' in msg) {
        resultText = (msg as SDKResultSuccess).result || '';
      }
    }
  } catch (err) {
    clearTimeout(timeoutId);
    setup.shadow.cleanup();
    if (abortController.signal.aborted && !(params.abortSignal?.aborted)) {
      throw new Error('SDK query timed out after 60s');
    }
    throw err;
  }

  clearTimeout(timeoutId);
  setup.shadow.cleanup();

  if (!resultText) {
    throw new Error('SDK query returned no result');
  }

  return resultText;
}

/**
 * Enumerate the CLI's supported slash commands WITHOUT running a turn.
 *
 * Streaming-input mode with a never-yielding iterable keeps the subprocess
 * idle; supportedCommands() is a control-channel request the CLI answers
 * locally — no model call, no tokens, no API key validation (~500ms cold).
 *
 * Why: CLI built-ins like /simplify are embedded in the claude binary and
 * invisible to the /api/skills filesystem scan; without this, they're only
 * knowable from a live session's init message (i.e. after the first message
 * of a conversation). Used by /api/sdk-commands to prewarm the slash popover
 * cache at app startup. Same provider/env isolation as generateTextViaSdk.
 */
export async function enumerateSdkSlashCommands(params?: {
  providerId?: string;
}): Promise<Array<{ name: string; description: string; argumentHint?: string }>> {
  const resolved = resolveForClaudeCode(undefined, { providerId: params?.providerId });
  const setup = prepareSdkSubprocessEnv(resolved);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 15_000);

  // Never yields: keeps stdin open until we abort after reading the list.
  async function* noMessages(): AsyncGenerator<never> {
    await new Promise<never>(() => {});
  }

  try {
    const conversation = query({
      prompt: noMessages() as AsyncIterable<SDKUserMessage>,
      options: {
        cwd: os.homedir(),
        abortController,
        env: sanitizeEnv(setup.env),
        settingSources: resolved.settingSources as Options['settingSources'],
        maxTurns: 1,
      },
    });
    const commands = await conversation.supportedCommands();
    return commands.map((c) => ({
      name: c.name,
      description: c.description,
      argumentHint: c.argumentHint || undefined,
    }));
  } finally {
    clearTimeout(timeoutId);
    abortController.abort();
    setup.shadow.cleanup();
  }
}

/**
 * Streaming variant of generateTextViaSdk — yields assistant text deltas as they
 * arrive. Same single-turn / no-session / no-lock / SDK-subprocess path (so it
 * resolves CLI model aliases like `[1m]` identically to the main stream), but
 * with includePartialMessages so callers can render token-by-token. Used by /btw
 * to match the CLI's streaming feel.
 *
 * Fallback: if the provider never emits partial deltas, the whole `result` text
 * is yielded once at the end so the caller still gets an answer (never empty).
 * The `finally` cleans up the shadow home even if the consumer stops early
 * (popup closed → generator aborted).
 */
export async function* streamTextViaSdk(params: {
  providerId?: string;
  model?: string;
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
}): AsyncGenerator<string> {
  const resolved = resolveForClaudeCode(undefined, {
    providerId: params.providerId,
  });
  const setup = prepareSdkSubprocessEnv(resolved);
  const sdkEnv = setup.env;

  const abortController = new AbortController();
  if (params.abortSignal) {
    params.abortSignal.addEventListener('abort', () => abortController.abort());
  }
  const timeoutId = setTimeout(() => abortController.abort(), 60_000);

  const queryOptions: Options = {
    cwd: os.homedir(),
    abortController,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    env: sanitizeEnv(sdkEnv),
    settingSources: resolved.settingSources as Options['settingSources'],
    systemPrompt: params.system,
    maxTurns: 1,
    includePartialMessages: true,
    // Same text-only contract as generateTextViaSdk — see comment there.
    tools: [],
    strictMcpConfig: true,
  };
  if (params.model) {
    queryOptions.model = params.model;
  }

  try {
    const conversation = query({ prompt: params.prompt, options: queryOptions });
    let sawDelta = false;
    let resultText = '';
    for await (const msg of conversation) {
      if (msg.type === 'stream_event') {
        const se = msg as { type: 'stream_event'; event: { type: string; delta?: { text?: string } } };
        if (se.event.type === 'content_block_delta' && se.event.delta?.text) {
          sawDelta = true;
          yield se.event.delta.text;
        }
      } else if (msg.type === 'result' && 'result' in msg) {
        resultText = (msg as SDKResultSuccess).result || '';
      }
    }
    // Provider didn't stream partials → emit the whole result once.
    if (!sawDelta && resultText) {
      yield resultText;
    }
  } catch (err) {
    if (abortController.signal.aborted && !(params.abortSignal?.aborted)) {
      throw new Error('SDK query timed out after 60s');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    setup.shadow.cleanup();
  }
}

/**
 * Main entry point for streaming chat. Dispatches to the resolved AgentRuntime.
 *
 * All callers (chat route, bridge, onboarding) call this function.
 * It converts ClaudeStreamOptions → RuntimeStreamOptions, resolves
 * the appropriate runtime, and delegates.
 */
export function streamClaude(options: ClaudeStreamOptions): ReadableStream<string> {
  // ── Capability-aware routing ────────────────────────────────
  // Route to the right runtime based on provider + user setting.
  const cliDisabled = getSetting('cli_enabled') === 'false';
  const effectiveProvider = options.providerId || options.sessionProviderId || '';
  let runtime;

  // Non-Anthropic providers (OpenAI OAuth, etc.) MUST use Native Runtime
  // because Claude Code SDK only supports Anthropic models.
  const isNonAnthropicProvider = effectiveProvider === 'openai-oauth';

  if (isNonAnthropicProvider) {
    runtime = getRuntime('native');
  } else if (!cliDisabled) {
    // Only attempt transport-based SDK forcing when CLI is enabled
    try {
      const { transport } = detectTransport({
        providerId: options.providerId,
        sessionProviderId: options.sessionProviderId,
      });

      if (!isNativeCompatible(transport)) {
        const sdkRt = getRuntime('claude-code-sdk');
        if (sdkRt?.isAvailable()) {
          runtime = sdkRt;
        }
      }
    } catch { /* ignore detection errors — fall through to normal routing */ }
  }

  if (!runtime) {
    runtime = resolveRuntime(getSetting('agent_runtime') || undefined, effectiveProvider || undefined);
  }

  console.log(`[streamClaude] Using runtime: ${runtime.id} (setting: ${getSetting('agent_runtime') || 'auto'})`);

  return runtime.stream({
    // Universal fields
    prompt: options.prompt,
    sessionId: options.sessionId,
    model: options.model,
    systemPrompt: options.systemPrompt,
    workingDirectory: options.workingDirectory,
    abortController: options.abortController,
    autoTrigger: options.autoTrigger,
    providerId: options.providerId,
    sessionProviderId: options.sessionProviderId,
    thinking: options.thinking,
    effort: options.effort,
    context1m: options.context1m,
    mcpServers: options.mcpServers,
    permissionMode: options.permissionMode,
    bypassPermissions: options.bypassPermissions,
    onRuntimeStatusChange: options.onRuntimeStatusChange,

    // Runtime-specific fields (SDK Runtime reads these from runtimeOptions)
    runtimeOptions: {
      sdkSessionId: options.sdkSessionId,
      files: options.files,
      conversationHistory: options.conversationHistory,
      sessionSummary: options.sessionSummary,
      fallbackTokenBudget: options.fallbackTokenBudget,
      imageAgentMode: options.imageAgentMode,
      toolTimeoutSeconds: options.toolTimeoutSeconds,
      outputFormat: options.outputFormat,
      agents: options.agents,
      agent: options.agent,
      enableFileCheckpointing: options.enableFileCheckpointing,
      generativeUI: options.generativeUI,
      provider: options.provider,
    },
  });
}

/**
 * SDK path — used by SdkRuntime. Contains the original Claude Code SDK query() logic.
 * Exported so sdk-runtime.ts can call it without circular dependency issues.
 */
export function streamClaudeSdk(options: ClaudeStreamOptions): ReadableStream<string> {
  const {
    prompt,
    sessionId,
    sdkSessionId,
    model,
    systemPrompt,
    workingDirectory,
    mcpServers,
    abortController,
    permissionMode,
    files,
    toolTimeoutSeconds = 0,
    conversationHistory,
    onRuntimeStatusChange,
    imageAgentMode,
    bypassPermissions: sessionBypassPermissions,
    thinking,
    effort,
    outputFormat,
    agents,
    agent,
    enableFileCheckpointing,
    autoTrigger,
    context1m,
    generativeUI,
  } = options;

  return new ReadableStream<string>({
    async start(controllerRaw) {
      // Wrap controller so async callbacks (keep-alive timer, late tool-result
      // handlers, post-abort message processing) can call enqueue() without
      // crashing when the consumer aborts. See src/lib/safe-stream.ts.
      const controller = wrapController(controllerRaw, (kind) => {
        console.warn(`[claude-client] late ${kind} after stream close — silently dropped`);
      });
      // Flag to prevent infinite PTL retry loops (at most one retry per request)
      let ptlRetryAttempted = false;
      // Per-request shadow ~/.claude/ for DB-provider isolation. Built lazily
      // below once we know whether we have an explicit DB provider; cleaned up
      // in the outer finally block. See src/lib/claude-home-shadow.ts.
      let shadowHome: ShadowHome | null = null;

      // Cowork sandbox state for this turn. When active, attachments are pushed
      // into the VM session workspace (host path → VM path map) and the end of
      // turn diffs the workspace to emit a vm_artifacts SSE event.
      let coworkActive = false;
      // Set to the sessionId once the VM is marked active this turn, so the
      // outer finally can release it (idle-reclaim gate) exactly once.
      let coworkActiveSessionId: string | null = null;
      // True when the session row has sandbox_enabled. Drives the E1 hard-fail
      // guard: a sandbox turn must NEVER silently fall back to host execution
      // — that would break the isolation promise the session was created under.
      let coworkSandboxRequested = false;
      const coworkVmPathByHostPath = new Map<string, string>();
      const coworkTurnStartMs = Date.now();

      // Resolve provider via the unified resolver. The caller may pass an explicit
      // provider (from resolveProvider().provider), or undefined when 'env' mode is
      // intended. We do NOT fall back to getActiveProvider() here — that's handled
      // inside resolveForClaudeCode() only when no resolution was attempted at all.
      const resolved = resolveForClaudeCode(options.provider, {
        providerId: options.providerId,
        sessionProviderId: options.sessionProviderId,
      });

      try {
        // Mirror ~/.agents/skills/ → ~/.claude/skills/ before the SDK reads
        // skills, so skills installed by the `skills` CLI into the agent-neutral
        // location are loadable by the bundled binary. TTL-cached, so steady
        // state is a cheap no-op. See src/lib/skill-reconcile.ts.
        try {
          const { reconcileSkillsCached } = await import('./skill-reconcile');
          reconcileSkillsCached();
        } catch { /* non-fatal: skills just won't be reconciled this turn */ }

        const resolvedWorkingDirectory = resolveWorkingDirectory([
          { path: workingDirectory, source: 'requested' },
        ]);

        if (workingDirectory && resolvedWorkingDirectory.source !== 'requested') {
          console.warn(
            `[claude-client] Working directory "${workingDirectory}" is unavailable, falling back to "${resolvedWorkingDirectory.path}"`,
          );
        }

        // Build env for the Claude Code subprocess via the shared helper —
        // every SDK entry point (this stream, generateTextViaSdk, provider
        // doctor live probe) goes through `prepareSdkSubprocessEnv` so the
        // provider-group ownership rule is applied uniformly. See
        // src/lib/sdk-subprocess-env.ts.
        const setup = prepareSdkSubprocessEnv(resolved);
        const sdkEnv = setup.env;
        shadowHome = setup.shadow;

        // Warn if no credentials found at all
        if (!resolved.hasCredentials && !sdkEnv.ANTHROPIC_API_KEY && !sdkEnv.ANTHROPIC_AUTH_TOKEN) {
          console.warn('[claude-client] No API key found: no active provider, no legacy settings, and no ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN in environment');
        }


        // Check if dangerously_skip_permissions is enabled globally or per-session
        const globalSkip = getSetting('dangerously_skip_permissions') === 'true';
        const skipPermissions = globalSkip || !!sessionBypassPermissions;

        const queryOptions: Options = {
          cwd: resolvedWorkingDirectory.path,
          abortController,
          includePartialMessages: true,
          permissionMode: skipPermissions
            ? 'bypassPermissions'
            : ((permissionMode as Options['permissionMode']) || 'acceptEdits'),
          env: sanitizeEnv(sdkEnv),
          // Load settings so the SDK behaves like the CLI (tool permissions,
          // CLAUDE.md, etc.). For DB providers settingSources is ['user'] only;
          // for env mode it's ['user', 'project', 'local']. See provider-resolver.ts.
          settingSources: resolved.settingSources as Options['settingSources'],
          // Auto-allow all AI Native Lab built-in MCPs. These are host-defined
          // in-process servers (createSdkMcpServer in claude-client.ts below)
          // that ship with AI Native Lab — they're not third-party plugins and
          // don't need per-tool user approval. Without this list, SDK's
          // default 'acceptEdits' mode prompts the user for each mcp__codepilot-*
          // invocation, which is the regression users reported after we
          // stopped silently allowing everything via project-level settings.
          //
          // Also auto-allow project-level MCP servers loaded from .mcp.json
          // (e.g. Playwright for browser-driven test execution via ai-lab-test).
          allowedTools: [
            'mcp__codepilot-memory',
            'mcp__codepilot-notify',
            'mcp__codepilot-widget',
            'mcp__codepilot-widget-guidelines',
            'mcp__codepilot-media',
            'mcp__codepilot-image-gen',
            'mcp__codepilot-cli-tools',
            'mcp__codepilot-dashboard',
            'mcp__playwright',
            'mcp__codepilot-skill',
          ],
        };

        if (skipPermissions) {
          queryOptions.allowDangerouslySkipPermissions = true;
        }

        // pathToClaudeCodeExecutable is normally NOT set — the SDK auto-discovers
        // the native binary from the bundled platform subpackage
        // (@anthropic-ai/claude-agent-sdk-<platform>-<arch>). This is the same
        // claude.exe / claude binary that the official native installer ships,
        // but distributed via npm so it's bundled at install/build time.
        //
        // Cowork POC: when the session has sandbox enabled (and the global
        // cowork_enabled gate is on + VM is ready), point the SDK at a forwarder
        // that runs the linux claude binary INSIDE an isolated VM. The SDK is
        // unaware — it just spawns what it thinks is claude and talks stream-json
        // over the forwarded stdio. See src/lib/cowork-poc.ts.
        //
        // E1 hard-fail helper: emit a failed vm_status + structured error, then
        // end the stream cleanly (done + close). Callers `return` right after.
        // The outer finally still runs (shadow cleanup / unregister); any VM
        // active-gate acquired earlier this turn is released there too.
        const hardFailSandboxTurn = async (reason?: string) => {
          const { buildSandboxUnavailableError } = await import('./cowork-guards');
          const guardErr = buildSandboxUnavailableError(reason);
          controller.enqueue(formatSSE({ type: 'vm_status', data: JSON.stringify({ phase: 'failed', detail: guardErr.rawMessage }) }));
          controller.enqueue(formatSSE({
            type: 'error',
            data: JSON.stringify({ ...guardErr, _formattedMessage: guardErr.userMessage }),
          }));
          controller.enqueue(formatSSE({ type: 'done', data: '' }));
          controller.close();
        };
        try {
          const { getSession } = await import('./db');
          const { decideCowork } = await import('./cowork-poc');
          const sess = getSession(sessionId);
          coworkSandboxRequested = !!sess?.sandbox_enabled;
          // P1-D readiness window: while the VM cold-starts (spawn vfkit +
          // provision daemon, ~5–30s), stream vm_status events so the frontend
          // shows "沙箱准备中" progress instead of a bare "生成中" that reads as
          // a hang. Subscribe before the blocking decideCowork; unsubscribe after.
          let unsubVmProgress: (() => void) | null = null;
          if (coworkSandboxRequested) {
            const vmMgrEarly = await import('./cowork-vm-manager');
            // If not already running, announce "starting" up front so the banner
            // appears immediately (before the first progress transition).
            if (vmMgrEarly.getStatus().phase !== 'running') {
              controller.enqueue(formatSSE({ type: 'vm_status', data: JSON.stringify({ phase: 'starting' }) }));
            }
            unsubVmProgress = vmMgrEarly.onVmProgress((p) => {
              controller.enqueue(formatSSE({ type: 'vm_status', data: JSON.stringify(p) }));
            });
          }
          // decideCowork is async in P1-B: it lazily starts/rebuilds the VM
          // via cowork-vm-manager and only resolves once the VM is ready (or
          // decides to fall back to host).
          const decision = await decideCowork(sess?.sandbox_enabled).finally(() => {
            unsubVmProgress?.();
          });
          if (decision.useSandbox && decision.executablePath) {
            queryOptions.pathToClaudeCodeExecutable = decision.executablePath;
            const coworkEnv = queryOptions.env as Record<string, string>;
            // Session-scoped VM workspace: the forwarder reads COWORK_SESSION_ID
            // and the daemon cd's to /home/agent/sessions/<id>/workspace.
            coworkEnv.COWORK_SESSION_ID = sessionId;
            // P1-C: the forwarder connects to this vsock unix socket and runs
            // under the app's own node (Electron with ELECTRON_RUN_AS_NODE=1 in
            // the packaged app, plain node in dev) — no reliance on PATH having node.
            const { VSOCK_SOCKET_PATH } = await import('./cowork-vsock');
            coworkEnv.COWORK_VSOCK_PATH = VSOCK_SOCKET_PATH;
            coworkEnv.COWORK_NODE_BIN = process.execPath;
            coworkEnv.ELECTRON_RUN_AS_NODE = '1';
            // Keep the VM alive while this turn runs (blocks idle reclaim);
            // released in the outer finally.
            const vmMgr = await import('./cowork-vm-manager');
            vmMgr.markSessionActive(sessionId);
            coworkActiveSessionId = sessionId;
            const transfer = await import('./cowork-transfer');
            await transfer.ensureSessionWorkspace(sessionId);
            // Push attachments (all types — the agent may process images with
            // scripts too) into the VM workspace; prompt references are rewritten
            // to VM paths in buildFinalPrompt via coworkVmPathByHostPath.
            if (files && files.length > 0) {
              const hostPaths = getUploadedFilePaths(files, resolvedWorkingDirectory.path);
              for (let i = 0; i < hostPaths.length; i++) {
                try {
                  const vmPath = await transfer.pushFileToVm(sessionId, hostPaths[i], files[i].name);
                  coworkVmPathByHostPath.set(hostPaths[i], vmPath);
                } catch (pushErr) {
                  // Keep the host path reference; the agent will report the miss.
                  console.warn(`[claude-client] cowork: failed to push ${files[i].name} into VM:`, pushErr);
                }
              }
            }
            coworkActive = true;
            console.log(`[claude-client] cowork sandbox ON for session ${sessionId} → forwarder ${decision.executablePath}, pushed ${coworkVmPathByHostPath.size} file(s)`);
          } else if (coworkSandboxRequested) {
            // E1 hard-fail: sandbox was requested but the VM isn't usable this
            // turn. Running on the host would silently violate the "files never
            // touch the host" promise — end the turn instead (no host fallback).
            console.warn(`[claude-client] cowork sandbox unavailable (${decision.reason}) — hard-failing turn, no host fallback`);
            await hardFailSandboxTurn(decision.reason);
            return;
          }
        } catch (err) {
          if (coworkSandboxRequested) {
            // Unexpected crash while deciding/preparing the sandbox — same
            // hard-fail rule: a sandbox turn must never continue on the host.
            console.error('[claude-client] cowork decision crashed for sandbox session — hard-failing turn:', err);
            await hardFailSandboxTurn('decision_error');
            return;
          }
          console.warn('[claude-client] cowork decision failed, using host runtime:', err);
        }

        if (model) {
          queryOptions.model = model;
        }

        if (systemPrompt) {
          // Use preset append mode to keep Claude Code's default system prompt
          // (which includes skills, working directory awareness, etc.)
          queryOptions.systemPrompt = {
            type: 'preset',
            preset: 'claude_code',
            append: systemPrompt,
          };
        }

        // E1 (cowork): capability-boundary note for sandbox turns — tells the
        // agent it lives in an isolated VM, where its session workspace is, and
        // that host paths / external MCP servers are unavailable. Placed before
        // the built-in MCP blocks below so their prompt appends stack after it.
        if (coworkActive) {
          const { buildSandboxSystemNote } = await import('./cowork-guards');
          const note = buildSandboxSystemNote(sessionId);
          if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
            queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + note;
          } else {
            queryOptions.systemPrompt = { type: 'preset', preset: 'claude_code', append: note };
          }
        }

        // MCP servers: pass explicitly provided config (e.g. from AI Native Lab UI's
        // ${...}-resolved servers + in-process SDK MCPs like memory/widget/...).
        //
        // User-scope MCP config from `~/.claude.json.mcpServers` is auto-loaded
        // by the SDK at runtime — the bundled binary reads that file directly
        // regardless of which `--setting-sources` layers we pass. NOTE that
        // `~/.claude/settings.json.mcpServers` is a dead field the binary
        // never reads; see `mcp-loader.ts` for the empirical proof. The MCP
        // Manager API enforces this by writing only to `.claude.json` and
        // migrating any legacy settings.json entries on read.
        if (mcpServers && Object.keys(mcpServers).length > 0) {
          if (coworkActive) {
            // E1 (cowork): sandbox turns load NO external MCP servers. stdio
            // servers would be spawned INSIDE the VM (no npx/uvx there — they
            // fail silently), and sse/http would connect from the VM with
            // confusing semantics. Built-in in-process codepilot-* servers
            // (registered below) run host-side over the SDK control channel and
            // are unaffected. User-scope ~/.claude.json servers are naturally
            // absent too: the CLI inside the VM reads the VM's own home, not
            // the host's. See docs/exec-plans/active/cowork-office-mode.md (D4).
            console.warn(`[claude-client] cowork: dropped external MCP servers for sandbox turn: ${Object.keys(mcpServers).join(', ')}`);
          } else {
            queryOptions.mcpServers = toSdkMcpConfig(mcpServers);
          }
        }

        // For DB-provider requests, settingSources is ['user'] only (project
        // and local layers are dropped to prevent <cwd>/.claude/settings.json
        // env from overriding the explicit provider's auth — see
        // provider-resolver.ts ~800). That also disables SDK auto-loading of
        // `<cwd>/.mcp.json`, which is normally an auth-neutral file team
        // members commit to share project MCP servers. Re-inject it here so
        // those servers don't silently disappear for DB-provider users.
        // Skipped for sandbox turns (E1) — project .mcp.json servers are
        // external MCPs and would fail/act confusingly inside the VM.
        if (resolved.provider && !coworkActive) {
          const { loadProjectMcpServers } = await import('@/lib/mcp-loader');
          const projectMcps = loadProjectMcpServers(resolvedWorkingDirectory.path);
          if (projectMcps) {
            const sdkProjectMcps = toSdkMcpConfig(projectMcps);
            // Existing entries (AI Native Lab UI / placeholder-managed) take
            // precedence on name collision — they're the user's currently-
            // chosen config layer, project file is the team default.
            queryOptions.mcpServers = {
              ...sdkProjectMcps,
              ...(queryOptions.mcpServers || {}),
            };
          }
        }

        // Memory MCP: always registered in assistant mode for memory search/retrieval.
        // Unlike other MCPs which are keyword-gated, memory search is a core assistant capability.
        {
          const assistantWorkspacePath = getSetting('assistant_workspace_path');
          if (assistantWorkspacePath && resolvedWorkingDirectory.path === assistantWorkspacePath) {
            const { createMemorySearchMcpServer, MEMORY_SEARCH_SYSTEM_PROMPT } = await import('@/lib/memory-search-mcp');
            queryOptions.mcpServers = {
              ...(queryOptions.mcpServers || {}),
              'codepilot-memory': createMemorySearchMcpServer(assistantWorkspacePath),
            };
            if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
              queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + MEMORY_SEARCH_SYSTEM_PROMPT;
            }
          }
        }

        // Notification + Schedule MCP: globally available in all contexts
        {
          const { createNotificationMcpServer, NOTIFICATION_MCP_SYSTEM_PROMPT } =
            await import('@/lib/notification-mcp');
          queryOptions.mcpServers = {
            ...(queryOptions.mcpServers || {}),
            'codepilot-notify': createNotificationMcpServer(),
          };
          if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
            queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + NOTIFICATION_MCP_SYSTEM_PROMPT;
          }
        }

        // Skill MCP: surfaces PROJECT-level skills/commands to the agent. Under
        // DB/managed providers the SDK drops the 'project' settingSource, so
        // skills in <cwd>/.claude/{skills,commands} are otherwise invisible —
        // whether the user created them in-app or dropped them in manually. This
        // in-process server reads them directly from disk (provider-independent)
        // and only registers when the project actually has skills, so projects
        // without any pay no tool-discovery overhead. See src/lib/skill-mcp.ts.
        {
          const { createSkillMcpServer, buildSkillSystemPrompt } = await import('@/lib/skill-mcp');
          const skillPrompt = buildSkillSystemPrompt(resolvedWorkingDirectory.path);
          if (skillPrompt) {
            queryOptions.mcpServers = {
              ...(queryOptions.mcpServers || {}),
              'codepilot-skill': createSkillMcpServer(resolvedWorkingDirectory.path),
            };
            if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
              queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + skillPrompt;
            }
          }
        }

        // Widget guidelines: progressive loading strategy.
        // The system prompt always includes WIDGET_SYSTEM_PROMPT with format rules.
        // The MCP server (detailed design specs) is only registered when the
        // conversation likely involves widget generation — detected by keywords in
        // the user's prompt or existing show-widget output in conversation history.
        // This avoids SDK tool discovery overhead (~1s) on plain text conversations.
        if (generativeUI !== false) {
          const needsWidgetSpecs = (() => {
            const widgetKeywords = /可视化|图表|流程图|时间线|架构图|对比|visualiz|diagram|chart|flowchart|timeline|infographic|interactive|widget|show-widget|hierarchy|dashboard/i;
            // Check current user prompt
            if (widgetKeywords.test(prompt)) return true;
            // Check if conversation already has widgets (resume context)
            if (conversationHistory?.some(m => m.content.includes('show-widget'))) return true;
            // Check explicit widget/image-agent mode
            if (imageAgentMode) return true;
            return false;
          })();

          if (needsWidgetSpecs) {
            const { createWidgetMcpServer } = await import('@/lib/widget-guidelines');
            const widgetServer = createWidgetMcpServer();
            queryOptions.mcpServers = {
              ...(queryOptions.mcpServers || {}),
              'codepilot-widget': widgetServer,
            };
          }
        }

        // Media MCP: import + generation tools (keyword-gated).
        // Registered when the conversation involves media/image generation tasks
        // in CODE mode. Design Agent mode uses the old image-gen-request flow
        // and does NOT need these MCP tools.
        const needsMediaMcp = (() => {
          if (imageAgentMode) return false; // Design Agent uses its own flow
          const mediaKeywords = /生成图片|画一|图像|图片|素材|保存.*素材|import.*library|save.*library|codepilot_import_media|codepilot_generate_image/i;
          if (mediaKeywords.test(prompt)) return true;
          if (conversationHistory?.some(m =>
            mediaKeywords.test(m.content)
          )) return true;
          return false;
        })();

        if (needsMediaMcp) {
          const { createMediaImportMcpServer, MEDIA_MCP_SYSTEM_PROMPT } = await import('@/lib/media-import-mcp');
          const { createImageGenMcpServer } = await import('@/lib/image-gen-mcp');
          queryOptions.mcpServers = {
            ...(queryOptions.mcpServers || {}),
            'codepilot-media': createMediaImportMcpServer(sessionId, resolvedWorkingDirectory.path),
            'codepilot-image-gen': createImageGenMcpServer(sessionId, resolvedWorkingDirectory.path),
          };
          // Inject media capability hint into system prompt
          if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
            queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + MEDIA_MCP_SYSTEM_PROMPT;
          }
        }

        // CLI tools MCP: tool management capabilities (keyword-gated).
        // Wide regex to cover natural phrasing like "帮我装 jq", "install uv",
        // "brew install", "pip install", "npm install -g", etc.
        const needsCliToolsMcp = (() => {
          const cliKeywords = /CLI\s*工具|cli.tool|安装.*工具|卸载.*工具|添加.*工具|更新.*工具|升级.*工具|入库.*工具|工具.*入库|加入.*工具库|添加到.*库|工具库|tool\s*library|codepilot_cli_tools|帮我装|帮我安装|帮我更新|帮我升级|\binstall\s+[@\w./-]+|\buninstall\s+[@\w./-]+|\bupdate\s+[@\w./-]+|\bupgrade\s+[@\w./-]+|brew\s+install|brew\s+upgrade|pip\s+install|pipx\s+install|npm\s+install\s+-g|npm\s+update\s+-g|cargo\s+install|apt\s+install|apt-get\s+install/i;
          if (cliKeywords.test(prompt)) return true;
          if (conversationHistory?.some(m => cliKeywords.test(m.content))) return true;
          return false;
        })();

        if (needsCliToolsMcp) {
          const { createCliToolsMcpServer, CLI_TOOLS_MCP_SYSTEM_PROMPT } = await import('@/lib/cli-tools-mcp');
          queryOptions.mcpServers = {
            ...(queryOptions.mcpServers || {}),
            'codepilot-cli-tools': createCliToolsMcpServer(),
          };
          if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
            queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + CLI_TOOLS_MCP_SYSTEM_PROMPT;
          }
        }

        // Dashboard MCP: widget management capabilities (keyword-gated).
        const needsDashboardMcp = (() => {
          const dashboardKeywords = /dashboard|仪表盘|看板|pin.*widget|pinned.*widget|refresh.*widget|固定.*组件|刷新.*组件|codepilot_dashboard/i;
          if (dashboardKeywords.test(prompt)) return true;
          if (conversationHistory?.some(m => dashboardKeywords.test(m.content))) return true;
          return false;
        })();

        if (needsDashboardMcp) {
          const { createDashboardMcpServer, DASHBOARD_MCP_SYSTEM_PROMPT } = await import('@/lib/dashboard-mcp');
          queryOptions.mcpServers = {
            ...(queryOptions.mcpServers || {}),
            'codepilot-dashboard': createDashboardMcpServer(sessionId, resolvedWorkingDirectory.path),
          };
          if (queryOptions.systemPrompt && typeof queryOptions.systemPrompt === 'object' && 'append' in queryOptions.systemPrompt) {
            queryOptions.systemPrompt.append = (queryOptions.systemPrompt.append || '') + '\n\n' + DASHBOARD_MCP_SYSTEM_PROMPT;
          }
        }

        // Pass through SDK-specific options from ClaudeStreamOptions.
        // Shared sanitizer runs the same Opus 4.7 migration guards as the
        // native agent-loop path — manual extended thinking becomes
        // adaptive, and the context-1m beta header is dropped since 4.7
        // ships 1M by default.
        const sanitized = sanitizeClaudeModelOptions({
          model,
          thinking,
          effort,
          context1m,
        });

        if (sanitized.thinking) {
          queryOptions.thinking = sanitized.thinking;
        }
        // SDK-runtime effort policy: when the UI doesn't explicitly pick a
        // level, leave `effort` unset so Claude Code CLI applies its
        // per-model default (e.g. Opus 4.7 defaults to xhigh, Sonnet to
        // high). Writing 'medium' unconditionally would override that and
        // regress the 4.7 out-of-box experience.
        //
        // The previous concern about settings.json injecting 'high' is
        // mitigated by CLI defaults: they're applied with lower precedence
        // than both queryOptions.effort and settingSources, so an explicit
        // UI choice still wins and a missing one doesn't silently escalate
        // to 'high'.
        if (sanitized.effort) {
          queryOptions.effort = sanitized.effort as Options['effort'];
        }
        if (outputFormat) {
          queryOptions.outputFormat = outputFormat;
        }
        if (agents) {
          queryOptions.agents = agents as Options['agents'];
        }
        if (agent) {
          queryOptions.agent = agent;
        }
        if (enableFileCheckpointing) {
          queryOptions.enableFileCheckpointing = true;
        }
        if (sanitized.applyContext1mBeta) {
          queryOptions.betas = [
            ...(queryOptions.betas || []),
            'context-1m-2025-08-07',
          ];
        }

        // Plugins: loaded by the SDK itself via enabledPlugins in ~/.claude/settings.json.
        // AI Native Lab does NOT explicitly inject plugins — the SDK reads settingSources
        // ['user', 'project', 'local'] and resolves enabledPlugins on its own,
        // ensuring parity with Claude CLI.

        // Resume session if we have an SDK session ID from a previous conversation turn.
        // Pre-check: verify working_directory exists before attempting resume.
        // Resume depends on session context (cwd/project scope), so if the
        // original working_directory no longer exists, resume will fail.
        let shouldResume = !!sdkSessionId;
        if (shouldResume && workingDirectory && resolvedWorkingDirectory.source !== 'requested') {
          console.warn(
            `[claude-client] Working directory "${workingDirectory}" does not exist, skipping resume`,
          );
          shouldResume = false;
          if (sessionId) {
            try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
          }
          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify({
              _internal: true,
              resumeFallback: true,
              title: 'Session fallback',
              message: 'Original working directory no longer exists. Starting fresh conversation.',
            }),
          }));
        }
        if (shouldResume) {
          // Emit visible status so the user sees feedback during resume initialization
          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify({
              notification: true,
              title: 'Resuming session',
              message: 'Reconnecting to previous conversation...',
            }),
          }));
          queryOptions.resume = sdkSessionId;
        }

        // Permission handler: sends SSE event and waits for user response
        queryOptions.canUseTool = async (toolName, input, opts) => {
          // Auto-approve ALL of AI Native Lab's own in-process MCP tools. They are
          // internal capabilities (memory / dashboard / widget / media / image-gen /
          // cli-tools) and the user has already opted in by enabling the relevant
          // mode. The SDK prefixes MCP tool names with mcp__<server>__, so match
          // both the bare name (codepilot_*) and the prefixed form
          // (mcp__codepilot-*__codepilot_*). This mirrors the native agent-loop
          // policy (agent-tools.ts: a codepilot_ prefix bypasses the permission
          // wrapper), keeping both runtimes consistent — and, critically, prevents
          // any codepilot_ tool (notably codepilot_memory_*, which the old explicit
          // list omitted) from falling into the ask branch and hanging forever on a
          // permission prompt the generative-UI flow never surfaces.
          if (/(?:^|__)codepilot_/.test(toolName)) {
            return { behavior: 'allow' as const, updatedInput: input };
          }

          const permissionRequestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const permEvent: PermissionRequestEvent = {
            permissionRequestId,
            toolName,
            toolInput: input,
            suggestions: opts.suggestions as PermissionRequestEvent['suggestions'],
            decisionReason: opts.decisionReason,
            blockedPath: opts.blockedPath,
            toolUseId: opts.toolUseID,
            description: undefined,
          };

          // Persist permission request to DB for audit/recovery
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace('T', ' ').split('.')[0];
          try {
            createPermissionRequest({
              id: permissionRequestId,
              sessionId,
              sdkSessionId: sdkSessionId || '',
              toolName,
              toolInput: JSON.stringify(input),
              decisionReason: opts.decisionReason || '',
              expiresAt,
            });
          } catch (e) {
            console.warn('[claude-client] Failed to persist permission request to DB:', e);
          }

          // Send permission_request SSE event to the client
          controller.enqueue(formatSSE({
            type: 'permission_request',
            data: JSON.stringify(permEvent),
          }));

          // Notify via Telegram (fire-and-forget) — skip for auto-trigger turns
          if (!autoTrigger) {
            notifyPermissionRequest(toolName, input as Record<string, unknown>, telegramOpts).catch(() => {});
          }

          // Notify runtime status change
          onRuntimeStatusChange?.('waiting_permission');

          // Wait for user response (resolved by POST /api/chat/permission)
          // Store original input so registry can inject updatedInput on allow
          const result = await registerPendingPermission(permissionRequestId, input, opts.signal);

          // Restore runtime status after permission resolved
          onRuntimeStatusChange?.('running');

          // Cast to SDK PermissionResult (NativePermissionResult is a compatible subset)
          return result as unknown as import('@anthropic-ai/claude-agent-sdk').PermissionResult;
        };

        // Telegram notification context for hooks
        const telegramOpts = {
          sessionId,
          sessionTitle: undefined as string | undefined,
          workingDirectory: resolvedWorkingDirectory.path,
        };

        // No queryOptions.hooks — all hook types (Notification, PostToolUse) use
        // the SDK's hook_callback control_request transport, which fails with
        // "CLI output was not valid JSON" when the CLI mixes control frames with
        // normal stdout. Notifications are derived from stream messages instead
        // (task_notification, result). TodoWrite sync uses tool_use → tool_result.

        // Capture real-time stderr output from Claude Code process
        queryOptions.stderr = (data: string) => {
          // Diagnostic: log raw stderr data length to server console
          console.log(`[stderr] received ${data.length} bytes, first 200 chars:`, data.slice(0, 200).replace(/[\x00-\x1F\x7F]/g, '?'));
          // Strip ANSI escape codes, OSC sequences, and control characters
          // but preserve tabs (\x09) and carriage returns (\x0D)
          const cleaned = data
            .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')   // CSI sequences (colors, cursor)
            .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '') // OSC sequences
            .replace(/\x1B\([A-Z]/g, '')               // Character set selection
            .replace(/\x1B[=>]/g, '')                   // Keypad mode
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Control chars (keep \t \n \r)
            .replace(/\r\n/g, '\n')                    // Normalize CRLF
            .replace(/\r/g, '\n')                      // Convert remaining CR to LF
            .replace(/\n{3,}/g, '\n\n')                // Collapse multiple blank lines
            .trim();
          if (cleaned) {
            controller.enqueue(formatSSE({
              type: 'tool_output',
              data: cleaned,
            }));
          }
        };

        // Build the prompt with file attachments and optional conversation history.
        // When resuming, the SDK has full context so we send the raw prompt.
        // When NOT resuming (fresh or fallback), prepend DB history for context.
        function buildFinalPrompt(useHistory: boolean): string | AsyncIterable<SDKUserMessage> {
          const basePrompt = useHistory
            ? buildFallbackContext({
                prompt,
                history: conversationHistory,
                sessionSummary: options.sessionSummary,
                tokenBudget: options.fallbackTokenBudget,
              })
            : prompt;

          if (!files || files.length === 0) return basePrompt;

          const imageFiles = files.filter(f => isImageFile(f.type));
          const nonImageFiles = files.filter(f => !isImageFile(f.type));

          let textPrompt = basePrompt;
          if (nonImageFiles.length > 0) {
            const workDir = resolvedWorkingDirectory.path;
            const savedPaths = getUploadedFilePaths(nonImageFiles, workDir);
            // Cowork sandbox: attachments were pushed into the VM workspace —
            // reference the in-VM path so the CLI (running inside the VM) can Read it.
            const refPaths = savedPaths.map((p) => coworkVmPathByHostPath.get(p) || p);
            const fileReferences = refPaths
              .map((p, i) => `[User attached file: ${p} (${nonImageFiles[i].name})]`)
              .join('\n');
            textPrompt = `${fileReferences}\n\nPlease read the attached file(s) above using your Read tool, then respond to the user's message:\n\n${basePrompt}`;
          }

          if (imageFiles.length > 0) {
            // Limit media items: keep the MOST RECENT images (drop oldest first),
            // consistent with "preserve recent context" strategy.
            const MAX_MEDIA_ITEMS = 100;
            const limitedImages = imageFiles.length > MAX_MEDIA_ITEMS
              ? imageFiles.slice(-MAX_MEDIA_ITEMS)
              : imageFiles;
            const droppedCount = imageFiles.length - limitedImages.length;

            // In imageAgentMode, skip file path references so Claude doesn't
            // try to use built-in tools to analyze images from disk. It will
            // see the images via vision (base64 content blocks) and follow the
            // IMAGE_AGENT_SYSTEM_PROMPT to output image-gen-request blocks.
            // In normal mode, append disk paths — only for the images actually included.
            const textWithImageRefs = imageAgentMode
              ? textPrompt
              : (() => {
                  const workDir = resolvedWorkingDirectory.path;
                  const imagePaths = getUploadedFilePaths(limitedImages, workDir)
                    .map((p) => coworkVmPathByHostPath.get(p) || p);
                  const imageReferences = imagePaths
                    .map((p, i) => `[User attached image: ${p} (${limitedImages[i].name})]`)
                    .join('\n');
                  return `${imageReferences}\n\n${textPrompt}`;
                })();

            const contentBlocks: Array<
              | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } }
              | { type: 'text'; text: string }
            > = [];

            for (const img of limitedImages) {
              // Read base64 from disk if the data was cleared after upload
              let imgData = img.data;
              if (!imgData && img.filePath) {
                try {
                  imgData = fs.readFileSync(img.filePath).toString('base64');
                } catch {
                  continue; // Skip images whose files are missing
                }
              }
              if (!imgData) continue;
              contentBlocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: (img.type || 'image/png') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                  data: imgData,
                },
              });
            }

            if (droppedCount > 0) {
              contentBlocks.push({ type: 'text', text: `[Note: ${droppedCount} older image(s) were omitted due to the ${MAX_MEDIA_ITEMS}-image limit per request.]` });
            }
            contentBlocks.push({ type: 'text', text: textWithImageRefs });

            const userMessage: SDKUserMessage = {
              type: 'user',
              message: {
                role: 'user',
                content: contentBlocks,
              },
              parent_tool_use_id: null,
              session_id: sdkSessionId || '',
            };

            return (async function* () {
              yield userMessage;
            })();
          }

          return textPrompt;
        }

        const finalPrompt = buildFinalPrompt(!shouldResume);

        // Try to start the conversation. If resuming a previous session fails
        // (e.g. stale/corrupt session file, CLI version mismatch), automatically
        // fall back to starting a fresh conversation without resume.
        let conversation = query({
          prompt: finalPrompt,
          options: queryOptions,
        });

        // Wrap the iterator so we can detect resume failures on the first message
        if (shouldResume) {
          try {
            // Peek at the first message to verify resume works
            const iter = conversation[Symbol.asyncIterator]();
            const first = await iter.next();

            // Re-wrap into an async iterable that yields the first message then the rest
            conversation = (async function* () {
              if (!first.done) yield first.value;
              while (true) {
                const next = await iter.next();
                if (next.done) break;
                yield next.value;
              }
            })() as ReturnType<typeof query>;
          } catch (resumeError) {
            const errMsg = resumeError instanceof Error ? resumeError.message : String(resumeError);
            console.warn('[claude-client] Resume failed, retrying without resume:', errMsg);
            // Clear stale sdk_session_id so future messages don't retry this broken resume
            if (sessionId) {
              try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
            }
            // Notify frontend about the fallback
            controller.enqueue(formatSSE({
              type: 'status',
              data: JSON.stringify({
                _internal: true,
                resumeFallback: true,
                title: 'Session fallback',
                message: 'Previous session could not be resumed. Starting fresh conversation.',
              }),
            }));
            // Remove resume and try again as a fresh conversation with history context
            delete queryOptions.resume;
            conversation = query({
              prompt: buildFinalPrompt(true),
              options: queryOptions,
            });
          }
        }

        registerConversation(sessionId, conversation);

        // Defer capability capture until first assistant response to avoid
        // competing with first-token latency. Skip entirely if cache is fresh.
        const capProviderId = resolved.provider?.api_key ? resolved.provider.id || 'custom' : 'env';
        let capturePending = !isCacheFresh(capProviderId);

        let tokenUsage: TokenUsage | null = null;
        // FIX(占用口径): 最后一条 assistant 请求的单次 usage（= 当前上下文真实占用基线）。
        let lastAssistantUsage: TokenUsage | null = null;
        // 本回合实际请求的模型名 —— 与状态行 "Connected (…)" 括号里同源
        // （requested_model || init.model），随 result usage 持久化到
        // token_usage.model，供上下文卡片做 [1m] → 1M 窗口判断。
        let connectedModel: string | undefined = model || undefined;
        // Track pending TodoWrite tool_use_ids so we can sync after successful execution
        const pendingTodoWrites = new Map<string, Array<{ content: string; status: string; activeForm?: string }>>();
        // Task* → 任务清单投影：内置 Claude Code 2.1.20x 起系统提示把任务管理导向
        // TaskCreate/TaskUpdate（TodoWrite 类型仍在但模型不再调用）。把 Task* 的增量
        // 变更投影成 todos 快照，复用 TodoWrite 的 task_update SSE 事件与前端组件。
        // 注册表是流级状态：resume 后由前端从 DB 恢复历史面板，与 TodoWrite 行为一致。
        const sdkTaskRegistry = new Map<string, { content: string; status: string; activeForm: string }>();
        const pendingTaskCreates = new Map<string, { subject: string; activeForm?: string }>();
        const pendingTaskUpdates = new Map<string, { taskId: string; subject?: string; status?: string; activeForm?: string }>();
        const emitTaskSnapshot = () => {
          controller.enqueue(formatSSE({
            type: 'task_update',
            data: JSON.stringify({
              session_id: sessionId,
              todos: [...sdkTaskRegistry.values()].map((t, i) => ({
                id: String(i),
                content: t.content,
                status: t.status,
                activeForm: t.activeForm,
              })),
            }),
          }));
        };
        for await (const message of conversation) {
          if (abortController?.signal.aborted) {
            break;
          }

          switch (message.type) {
            case 'assistant': {
              // Deferred capability capture: trigger after first assistant message
              if (capturePending) {
                capturePending = false;
                captureCapabilities(sessionId, conversation, capProviderId).catch((err) => {
                  console.warn('[claude-client] Deferred capability capture failed:', err);
                });
              }
              const assistantMsg = message as SDKAssistantMessage;
              // FIX(占用口径): 记录最新一条 assistant 请求的单次 usage，回合结束用它覆盖累计值。
              const turnUsage = extractAssistantTurnUsage(assistantMsg);
              if (turnUsage) lastAssistantUsage = turnUsage;
              // Text deltas are handled by stream_event for real-time streaming.
              // Here we only process tool_use blocks.

              // Check for tool use blocks
              for (const block of assistantMsg.message.content) {
                if (block.type === 'tool_use') {
                  controller.enqueue(formatSSE({
                    type: 'tool_use',
                    data: JSON.stringify({
                      id: block.id,
                      name: block.name,
                      input: block.input,
                    }),
                  }));

                  // Track TodoWrite calls — sync deferred until tool_result confirms success
                  if (block.name === 'TodoWrite') {
                    try {
                      const toolInput = block.input as {
                        todos?: Array<{ content: string; status: string; activeForm?: string }>;
                      };
                      if (toolInput?.todos && Array.isArray(toolInput.todos)) {
                        pendingTodoWrites.set(block.id, toolInput.todos);
                      }
                    } catch (e) {
                      console.warn('[claude-client] Failed to parse TodoWrite input:', e);
                    }
                  } else if (block.name === 'TaskCreate') {
                    // Task* 同 TodoWrite：暂存，等 tool_result 确认成功再同步
                    const taskInput = block.input as { subject?: string; activeForm?: string };
                    if (taskInput?.subject) {
                      pendingTaskCreates.set(block.id, { subject: taskInput.subject, activeForm: taskInput.activeForm });
                    }
                  } else if (block.name === 'TaskUpdate') {
                    const taskInput = block.input as { taskId?: string; subject?: string; status?: string; activeForm?: string };
                    if (taskInput?.taskId) {
                      pendingTaskUpdates.set(block.id, taskInput as { taskId: string; subject?: string; status?: string; activeForm?: string });
                    }
                  }
                }
              }
              break;
            }

            case 'user': {
              // Tool execution results come back as user messages with tool_result blocks
              const userMsg = message as SDKUserMessage;
              const content = userMsg.message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_result') {
                    let resultContent = typeof block.content === 'string'
                      ? block.content
                      : Array.isArray(block.content)
                        ? block.content
                            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                            .map((c) => c.text)
                            .join('\n')
                        : String(block.content ?? '');

                    // Extract media blocks (image/audio) from MCP tool results.
                    // Two sources:
                    // 1. SDK content array: image/audio blocks with base64 data (external MCP servers)
                    // 2. MEDIA_RESULT_MARKER in text: localPath-based media from in-process MCP tools
                    //    (SDK strips image blocks from in-process tool results, so we use a text marker)
                    const mediaBlocks: MediaBlock[] = [];
                    if (Array.isArray(block.content)) {
                      for (const c of block.content) {
                        const cb = c as { type: string; data?: string; mimeType?: string; media_type?: string };
                        if ((cb.type === 'image' || cb.type === 'audio') && cb.data) {
                          mediaBlocks.push({
                            type: cb.type === 'audio' ? 'audio' : 'image',
                            data: cb.data,
                            mimeType: cb.mimeType || cb.media_type || (cb.type === 'image' ? 'image/png' : 'audio/wav'),
                          });
                        }
                      }
                    }
                    // Detect MEDIA_RESULT_MARKER in text result (from codepilot-image-gen MCP)
                    const MEDIA_MARKER = '__MEDIA_RESULT__';
                    const markerIdx = resultContent.indexOf(MEDIA_MARKER);
                    if (markerIdx >= 0) {
                      try {
                        const mediaJson = resultContent.slice(markerIdx + MEDIA_MARKER.length).trim();
                        const parsed = JSON.parse(mediaJson) as Array<{ type: string; mimeType: string; localPath: string; mediaId?: string }>;
                        for (const m of parsed) {
                          mediaBlocks.push({
                            type: (m.type as MediaBlock['type']) || 'image',
                            mimeType: m.mimeType,
                            localPath: m.localPath,
                            mediaId: m.mediaId,
                          });
                        }
                      } catch {
                        // Malformed marker payload — ignore
                      }
                      // Strip marker from content so it's not shown in the UI
                      resultContent = resultContent.slice(0, markerIdx).trim();
                    }

                    const ssePayload: Record<string, unknown> = {
                      tool_use_id: block.tool_use_id,
                      content: resultContent,
                      is_error: block.is_error || false,
                    };
                    if (mediaBlocks.length > 0) {
                      ssePayload.media = mediaBlocks;
                    }
                    controller.enqueue(formatSSE({
                      type: 'tool_result',
                      data: JSON.stringify(ssePayload),
                    }));

                    // Deferred TodoWrite sync: only emit task_update after successful execution
                    if (!block.is_error && pendingTodoWrites.has(block.tool_use_id)) {
                      const todos = pendingTodoWrites.get(block.tool_use_id)!;
                      pendingTodoWrites.delete(block.tool_use_id);
                      controller.enqueue(formatSSE({
                        type: 'task_update',
                        data: JSON.stringify({
                          session_id: sessionId,
                          todos: todos.map((t, i) => ({
                            id: String(i),
                            content: t.content,
                            status: t.status,
                            activeForm: t.activeForm || '',
                          })),
                        }),
                      }));
                    } else if (!block.is_error && pendingTaskCreates.has(block.tool_use_id)) {
                      // Deferred TaskCreate sync → 注册并投影 todos 快照
                      const taskInput = pendingTaskCreates.get(block.tool_use_id)!;
                      pendingTaskCreates.delete(block.tool_use_id);
                      // 2.1.203 实测 result 为纯文本 "Task #4 created successfully: <subject>"，
                      // 其中编号即后续 TaskUpdate 引用的 taskId；JSON 解析留作兜底
                      // （sdk-tools.d.ts 声明的 TaskCreateOutput 为 { task: { id } } 结构）。
                      let taskId = '';
                      const idMatch = /Task #(\S+) created/.exec(resultContent);
                      if (idMatch) {
                        taskId = idMatch[1];
                      } else {
                        try {
                          taskId = (JSON.parse(resultContent) as { task?: { id?: string } })?.task?.id || '';
                        } catch { /* 非 JSON → 落合成 id */ }
                      }
                      if (!taskId) taskId = `synthetic-${block.tool_use_id}`;
                      sdkTaskRegistry.set(taskId, {
                        content: taskInput.subject,
                        status: 'pending',
                        activeForm: taskInput.activeForm || '',
                      });
                      emitTaskSnapshot();
                    } else if (!block.is_error && pendingTaskUpdates.has(block.tool_use_id)) {
                      // Deferred TaskUpdate sync → 更新注册表并投影
                      const taskInput = pendingTaskUpdates.get(block.tool_use_id)!;
                      pendingTaskUpdates.delete(block.tool_use_id);
                      const entry = sdkTaskRegistry.get(taskInput.taskId);
                      if (entry) {
                        if (taskInput.status === 'deleted') {
                          sdkTaskRegistry.delete(taskInput.taskId);
                        } else {
                          if (taskInput.status) entry.status = taskInput.status;
                          if (taskInput.subject) entry.content = taskInput.subject;
                          if (taskInput.activeForm) entry.activeForm = taskInput.activeForm;
                        }
                        emitTaskSnapshot();
                      }
                    }
                  }
                }
              }

              // Emit rewind_point for file checkpointing — only for prompt-level
              // user messages (parent_tool_use_id === null), and skip auto-trigger
              // turns which are invisible to the user (onboarding/check-in).
              if (
                userMsg.parent_tool_use_id === null &&
                !autoTrigger &&
                userMsg.uuid
              ) {
                controller.enqueue(formatSSE({
                  type: 'rewind_point',
                  data: JSON.stringify({ userMessageId: userMsg.uuid }),
                }));
              }
              break;
            }

            case 'stream_event': {
              const streamEvent = message as SDKPartialAssistantMessage;
              const evt = streamEvent.event;
              if (evt.type === 'content_block_delta' && 'delta' in evt) {
                const delta = evt.delta;
                if ('text' in delta && delta.text) {
                  controller.enqueue(formatSSE({ type: 'text', data: delta.text }));
                }
                if ('thinking' in delta && (delta as { thinking?: string }).thinking) {
                  controller.enqueue(formatSSE({ type: 'thinking', data: (delta as { thinking: string }).thinking }));
                }
              }
              break;
            }

            case 'system': {
              const sysMsg = message as SDKSystemMessage;
              if ('subtype' in sysMsg) {
                if (sysMsg.subtype === 'init') {
                  const initMsg = sysMsg as SDKSystemMessage & {
                    slash_commands?: unknown;
                    skills?: unknown;
                    plugins?: Array<{ name: string; path: string }>;
                    mcp_servers?: unknown;
                    output_style?: string;
                  };
                  // 与前端状态行的取值逻辑一致（requested_model || model）。
                  connectedModel = model || sysMsg.model || connectedModel;
                  controller.enqueue(formatSSE({
                    type: 'status',
                    data: JSON.stringify({
                      session_id: sysMsg.session_id,
                      model: sysMsg.model,
                      requested_model: model,
                      tools: sysMsg.tools,
                      slash_commands: initMsg.slash_commands,
                      skills: initMsg.skills,
                      plugins: initMsg.plugins,
                      mcp_servers: initMsg.mcp_servers,
                      output_style: initMsg.output_style,
                    }),
                  }));

                  // Cache loaded plugins from init meta for cross-reference in skills route.
                  // Always set — including empty array — so stale data from a previous
                  // session that had plugins doesn't leak into a session without plugins.
                  // capProviderId is defined at line 786 in the same scope.
                  setCachedPlugins(capProviderId, Array.isArray(initMsg.plugins) ? initMsg.plugins : []);
                } else if (sysMsg.subtype === 'status') {
                  // SDK sends status messages when permission mode changes (e.g. ExitPlanMode)
                  const statusMsg = sysMsg as SDKSystemMessage & { permissionMode?: string };
                  if (statusMsg.permissionMode) {
                    controller.enqueue(formatSSE({
                      type: 'mode_changed',
                      data: statusMsg.permissionMode,
                    }));
                  }
                } else if (sysMsg.subtype === 'task_notification') {
                  // Agent task completed/failed/stopped — surface as notification
                  const taskMsg = sysMsg as SDKSystemMessage & {
                    status: string; summary: string; task_id: string;
                  };
                  const title = taskMsg.status === 'completed' ? 'Task completed' : `Task ${taskMsg.status}`;
                  controller.enqueue(formatSSE({
                    type: 'status',
                    data: JSON.stringify({
                      notification: true,
                      title,
                      message: taskMsg.summary || '',
                    }),
                  }));
                  if (!autoTrigger) {
                    notifyGeneric(title, taskMsg.summary || '', telegramOpts).catch(() => {});
                  }
                }
              }
              break;
            }

            case 'tool_progress': {
              const progressMsg = message as SDKToolProgressMessage;
              controller.enqueue(formatSSE({
                type: 'tool_output',
                data: JSON.stringify({
                  _progress: true,
                  tool_use_id: progressMsg.tool_use_id,
                  tool_name: progressMsg.tool_name,
                  elapsed_time_seconds: progressMsg.elapsed_time_seconds,
                }),
              }));
              // Auto-timeout: abort if tool runs longer than configured threshold
              if (toolTimeoutSeconds > 0 && progressMsg.elapsed_time_seconds >= toolTimeoutSeconds) {
                controller.enqueue(formatSSE({
                  type: 'tool_timeout',
                  data: JSON.stringify({
                    tool_name: progressMsg.tool_name,
                    elapsed_seconds: Math.round(progressMsg.elapsed_time_seconds),
                  }),
                }));
                abortController?.abort();
              }
              break;
            }

            case 'result': {
              const resultMsg = message as SDKResultMessage;
              tokenUsage = extractTokenUsage(resultMsg);
              // FIX(占用口径): 用最后一条 assistant 请求的单次 usage 覆盖占用字段，避免整轮
              // 累计 result.usage 的 cache_read 跨内部请求累加导致虚高（实测一个回合内
              // cache_read 随工具调用次数累加，可虚高数倍——卡片曾因此一轮就“打满”窗口）。
              // cost_usd 仍取整轮累计（整轮总成本）。无 assistant usage 时回退到累计值。
              if (lastAssistantUsage) {
                tokenUsage = { ...lastAssistantUsage, cost_usd: tokenUsage?.cost_usd };
              }
              // 把 Connected 模型名并入 usage，随消息 token_usage 落库。
              if (tokenUsage && connectedModel) {
                tokenUsage = { ...tokenUsage, model: connectedModel };
              }
              // terminal_reason is an optional field added in SDK 0.2.111.
              // When present, it enriches the end-of-turn UI chip (Phase 1 of
              // agent-sdk-0-2-111-adoption) without replacing error-classifier.
              const terminalReason = (resultMsg as SDKResultMessage & { terminal_reason?: string }).terminal_reason;
              controller.enqueue(formatSSE({
                type: 'result',
                data: JSON.stringify({
                  subtype: resultMsg.subtype,
                  is_error: resultMsg.is_error,
                  num_turns: resultMsg.num_turns,
                  duration_ms: resultMsg.duration_ms,
                  usage: tokenUsage,
                  session_id: resultMsg.session_id,
                  ...(terminalReason ? { terminal_reason: terminalReason } : {}),
                }),
              }));
              // Notify on conversation-level errors (e.g. rate limit, auth failure)
              if (resultMsg.is_error) {
                const errTitle = 'Conversation error';
                const errMsg = resultMsg.subtype || 'The conversation ended with an error';
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({ notification: true, title: errTitle, message: errMsg }),
                }));
                // Skip Telegram for auto-trigger turns (onboarding/heartbeat)
                if (!autoTrigger) {
                  notifyGeneric(errTitle, errMsg, telegramOpts).catch(() => {});
                }
              }

              // Cowork sandbox: diff the VM session workspace for files the agent
              // created/modified this turn and surface them as downloadable
              // artifacts. Bounded by a 8s race so a wedged VM can never stall
              // stream close; uploads pushed at turn start are excluded.
              if (coworkActive && !resultMsg.is_error) {
                try {
                  const { listNewFiles } = await import('./cowork-transfer');
                  const artifacts = await Promise.race([
                    listNewFiles(sessionId, coworkTurnStartMs, [...coworkVmPathByHostPath.values()]),
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('vm diff timeout')), 8000)),
                  ]);
                  if (artifacts.length > 0) {
                    // Persist the merged artifact list so history sessions can
                    // render the card while the VM is asleep (list from DB;
                    // the VM is only needed at download time).
                    try {
                      const { mergeSessionVmArtifacts } = await import('./db');
                      mergeSessionVmArtifacts(sessionId, artifacts);
                    } catch (persistErr) {
                      console.warn('[claude-client] cowork artifacts persist failed:', persistErr);
                    }
                    controller.enqueue(formatSSE({
                      type: 'vm_artifacts',
                      data: JSON.stringify({ sessionId, files: artifacts }),
                    }));
                  }
                } catch (diffErr) {
                  console.warn('[claude-client] cowork artifacts diff failed:', diffErr);
                }
              }

              // FIX(权威分子): 占用快照由无凭据探针进程后补(context-usage-probe.ts)。
              // 不在本进程调 getContextUsage —— 有凭据时 CLI 会对上下文逐组件
              // 发 ~82 个 count_tokens 非流式请求(网关请求风暴 + 几十秒延迟的
              // 根因);探针无凭据走本地估算,totalTokens 实测与 API 计数逐位
              // 一致。探针自带 1.5s 延迟,晚于 route 落库,match 防串扰。
              if (sessionId) {
                fireContextUsageProbe({
                  appSessionId: sessionId,
                  sdkSessionId: resultMsg.session_id,
                  cwd: resolvedWorkingDirectory.path,
                  match: tokenUsage
                    ? {
                        input_tokens: tokenUsage.input_tokens,
                        output_tokens: tokenUsage.output_tokens,
                      }
                    : null,
                });
              }
              break;
            }

            default: {
              const mType = (message as { type: string }).type;
              if (mType === 'keep_alive') {
                controller.enqueue(formatSSE({ type: 'keep_alive', data: '' }));
              } else if (mType === 'rate_limit_event') {
                // SDK 0.2.111+ — subscription rate limit telemetry. SDK
                // only emits these for claude.ai subscription paths, so
                // API-key / third-party provider sessions won't see this
                // branch. Forward verbatim so the UI can render a
                // warning banner (allowed_warning) or a closable recovery
                // panel (rejected) per Phase 2 of agent-sdk-0-2-111.
                const rlEvent = message as {
                  type: 'rate_limit_event';
                  rate_limit_info: {
                    status: 'allowed' | 'allowed_warning' | 'rejected';
                    resetsAt?: number;
                    rateLimitType?: string;
                    utilization?: number;
                    overageStatus?: string;
                    overageResetsAt?: number;
                    overageDisabledReason?: string;
                    isUsingOverage?: boolean;
                  };
                  session_id: string;
                };
                controller.enqueue(formatSSE({
                  type: 'rate_limit',
                  data: JSON.stringify(rlEvent.rate_limit_info),
                }));
              }
              break;
            }
          }
        }

        controller.enqueue(formatSSE({ type: 'done', data: '' }));
        controller.close();
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : 'Unknown error';
        // Log full error details for debugging (visible in terminal / dev tools)
        const stderrContent = error instanceof Error ? (error as { stderr?: string }).stderr : undefined;
        console.error('[claude-client] Stream error:', {
          message: rawMessage,
          stack: error instanceof Error ? error.stack : undefined,
          cause: error instanceof Error ? (error as { cause?: unknown }).cause : undefined,
          stderr: stderrContent,
          code: error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined,
        });

        // Look up preset meta for recovery action URLs
        const presetForMeta = resolved.provider?.base_url
          ? (await import('./provider-catalog')).findPresetForLegacy(resolved.provider.base_url, resolved.provider.provider_type, resolved.protocol)
          : undefined;

        // Classify the error using structured pattern matching
        const classified = classifyError({
          error,
          stderr: stderrContent,
          providerName: resolved.provider?.name,
          baseUrl: resolved.provider?.base_url,
          hasImages: files && files.some(f => isImageFile(f.type)),
          thinkingEnabled: !!thinking,
          context1mEnabled: !!context1m,
          effortSet: !!effort,
          providerMeta: presetForMeta?.meta ? {
            apiKeyUrl: presetForMeta.meta.apiKeyUrl,
            docsUrl: presetForMeta.meta.docsUrl,
            pricingUrl: presetForMeta.meta.pricingUrl,
          } : undefined,
        });

        // ── Reactive compact: auto-compress and retry on CONTEXT_TOO_LONG ──
        if (classified.category === 'CONTEXT_TOO_LONG' && !ptlRetryAttempted && conversationHistory && conversationHistory.length > 4) {
          ptlRetryAttempted = true;
          try {
            console.log('[claude-client] CONTEXT_TOO_LONG detected — attempting auto-compress + retry');
            controller.enqueue(formatSSE({ type: 'status', data: JSON.stringify({ notification: true, message: 'context_compressing_retry' }) }));

            const { compressConversation, resolveReactiveCompactBoundaryRowid } = await import('./context-compressor');
            const { updateSessionSummary: updateSummary, getSessionSummary } = await import('@/lib/db');
            const compResult = await compressConversation({
              sessionId,
              messages: conversationHistory,
              existingSummary: options.sessionSummary,
              providerId: options.providerId || options.sessionProviderId,
              sessionModel: model,
            });
            // Derive boundary from rowids plumbed through conversationHistory.
            // Invariant: reactive compact here hands the WHOLE
            // conversationHistory to compressConversation — no keep/compress
            // split — so the last row with a known _rowid is exactly the
            // last DB row this summary covers.
            //
            // Fallback (no _rowid in history): use Math.max of the DB's
            // CURRENT boundary and the caller's hint. Re-reading DB here
            // matters because an auto pre-compression earlier in the same
            // request may have already advanced the boundary past what
            // options.sessionSummaryBoundaryRowid captured (that value was
            // snapshotted in chat/route.ts before auto pre-compression ran).
            // Without the re-read, a degraded reactive compact could
            // silently roll the DB boundary back to a stale value.
            const existingBoundary = Math.max(
              getSessionSummary(sessionId).boundaryRowid,
              options.sessionSummaryBoundaryRowid ?? 0,
            );
            const reactiveBoundaryRowid = resolveReactiveCompactBoundaryRowid({
              history: conversationHistory,
              existingBoundaryRowid: existingBoundary,
            });
            updateSummary(sessionId, compResult.summary, reactiveBoundaryRowid);
            options.sessionSummary = compResult.summary;
            // Recalculate fallback budget with new summary size
            const newSummaryTokens = roughTokenEstimate(compResult.summary);
            const promptTokens = roughTokenEstimate(prompt);
            const systemTokens = roughTokenEstimate(systemPrompt || '');
            // Use a conservative 50% of actual context window for retry
            const { getContextWindow } = await import('./model-context');
            const ctxWindow = getContextWindow(model || 'sonnet', { context1m: !!context1m }) || 200000;
            const retryBudget = Math.max(10000, Math.floor(ctxWindow * 0.5 - systemTokens - newSummaryTokens - promptTokens));
            console.log(`[claude-client] Compressed ${compResult.messagesCompressed} messages for PTL retry, budget=${retryBudget}`);

            // Clear stale session so retry starts fresh
            if (sessionId) {
              try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
            }

            // Build retry prompt using compressed context with recalculated budget
            const retryPrompt = buildFallbackContext({
              prompt,
              history: conversationHistory,
              sessionSummary: options.sessionSummary,
              tokenBudget: retryBudget,
            });

            // Rebuild minimal query options from closure variables
            // (queryOptions is scoped to the try block and not accessible here)
            // NOTE: this path bypasses prepareSdkSubprocessEnv(), so replicate
            // its NODE_ENV strip here — otherwise the host Next-server
            // production NODE_ENV leaks into the retry subprocess and its Bash
            // tool (see sdk-subprocess-env.ts for the full rationale).
            const retryEnv = { ...process.env as Record<string, string> };
            delete retryEnv.NODE_ENV;
            const retryOptions: Options = {
              cwd: options.workingDirectory || os.homedir(),
              abortController,
              permissionMode: 'bypassPermissions' as Options['permissionMode'],
              allowDangerouslySkipPermissions: true,
              env: retryEnv,
              maxTurns: undefined,
            };
            if (model) retryOptions.model = model;
            if (systemPrompt) {
              retryOptions.systemPrompt = { type: 'preset', preset: 'claude_code', append: systemPrompt };
            }

            const retryConversation = query({ prompt: retryPrompt, options: retryOptions });

            // 与主路径同源的 Connected 模型名（requested_model || init.model），
            // 供重试回合的 result usage 携带 token_usage.model。
            let retryConnectedModel: string | undefined = model || undefined;

            // Forward retry stream events (simplified — covers the critical path)
            for await (const msg of retryConversation) {
              if (abortController?.signal.aborted) break;
              switch (msg.type) {
                case 'system': {
                  // Forward init event so the chat route persists the NEW
                  // sdk_session_id. Without this, the session row keeps an
                  // empty sdk_session_id (cleared above at line ~1619) and the
                  // next user message goes back through buildFallbackContext,
                  // re-exposing prior-tool-call history to the model.
                  const sysMsg = msg as SDKSystemMessage;
                  if ('subtype' in sysMsg && sysMsg.subtype === 'init') {
                    retryConnectedModel = model || sysMsg.model || retryConnectedModel;
                    controller.enqueue(formatSSE({
                      type: 'status',
                      data: JSON.stringify({
                        session_id: sysMsg.session_id,
                        model: sysMsg.model,
                        requested_model: model,
                        tools: sysMsg.tools,
                      }),
                    }));
                  }
                  break;
                }
                case 'assistant': {
                  // Text deltas are forwarded via stream_event below; here we
                  // only emit tool_use blocks (matches main path at L1213).
                  const aMsg = msg as SDKAssistantMessage;
                  for (const block of aMsg.message.content) {
                    if (block.type === 'tool_use') {
                      controller.enqueue(formatSSE({ type: 'tool_use', data: JSON.stringify({ id: block.id, name: block.name, input: block.input }) }));
                    }
                  }
                  break;
                }
                case 'user': {
                  const uMsg = msg as { type: 'user'; message: { content: Array<{ type: string; content?: string | Array<Record<string, unknown>>; tool_use_id?: string; is_error?: boolean }> } };
                  for (const block of uMsg.message.content) {
                    if (block.type === 'tool_result') {
                      const retryMedia: MediaBlock[] = [];
                      let retryContent = '';

                      if (Array.isArray(block.content)) {
                        // Array-form tool result (external MCP): extract text + image/audio blocks
                        const textParts: string[] = [];
                        for (const c of block.content) {
                          const cb = c as { type: string; text?: string; data?: string; mimeType?: string; media_type?: string };
                          if (cb.type === 'text' && cb.text) {
                            textParts.push(cb.text);
                          } else if ((cb.type === 'image' || cb.type === 'audio') && cb.data) {
                            retryMedia.push({
                              type: cb.type === 'audio' ? 'audio' : 'image',
                              data: cb.data,
                              mimeType: cb.mimeType || cb.media_type || (cb.type === 'image' ? 'image/png' : 'audio/wav'),
                            });
                          }
                        }
                        retryContent = textParts.join('\n').slice(0, 2000);
                      } else if (typeof block.content === 'string') {
                        retryContent = block.content.slice(0, 2000);
                      }

                      // Extract __MEDIA_RESULT__ markers from text content
                      const RETRY_MEDIA_MARKER = '__MEDIA_RESULT__';
                      const retryMarkerIdx = retryContent.indexOf(RETRY_MEDIA_MARKER);
                      if (retryMarkerIdx >= 0) {
                        try {
                          const mediaJson = retryContent.slice(retryMarkerIdx + RETRY_MEDIA_MARKER.length).trim();
                          const parsed = JSON.parse(mediaJson) as Array<{ type: string; mimeType: string; localPath: string; mediaId?: string }>;
                          for (const m of parsed) {
                            retryMedia.push({
                              type: (m.type as MediaBlock['type']) || 'image',
                              mimeType: m.mimeType,
                              localPath: m.localPath,
                              mediaId: m.mediaId,
                            });
                          }
                        } catch { /* malformed marker */ }
                        retryContent = retryContent.slice(0, retryMarkerIdx).trim();
                      }

                      controller.enqueue(formatSSE({ type: 'tool_result', data: JSON.stringify({
                        tool_use_id: block.tool_use_id,
                        content: retryContent,
                        ...(block.is_error ? { is_error: true } : {}),
                        ...(retryMedia.length > 0 ? { media: retryMedia } : {}),
                      }) }));
                    }
                  }
                  break;
                }
                case 'stream_event': {
                  const se = msg as { type: 'stream_event'; event: { type: string; delta?: { text?: string; thinking?: string }; index?: number } };
                  if (se.event.type === 'content_block_delta') {
                    if (se.event.delta?.text) {
                      controller.enqueue(formatSSE({ type: 'text', data: se.event.delta.text }));
                    }
                    if (se.event.delta?.thinking) {
                      controller.enqueue(formatSSE({ type: 'thinking', data: se.event.delta.thinking }));
                    }
                  }
                  break;
                }
                case 'result': {
                  const rMsg = msg as SDKResultMessage;
                  let usage = 'result' in rMsg ? extractTokenUsage(rMsg as SDKResultSuccess) : undefined;
                  if (usage && retryConnectedModel) {
                    usage = { ...usage, model: retryConnectedModel };
                  }
                  // Match main-path result shape so the chat route can persist
                  // the new sdk_session_id (route reads result.session_id as a
                  // safety net when status init was missed).
                  controller.enqueue(formatSSE({
                    type: 'result',
                    data: JSON.stringify({
                      subtype: rMsg.subtype,
                      is_error: rMsg.is_error,
                      num_turns: rMsg.num_turns,
                      duration_ms: rMsg.duration_ms,
                      usage,
                      session_id: rMsg.session_id,
                    }),
                  }));
                  // Emit compression notification via the shared builder so
                  // useSSEStream's subtype=context_compressed dispatch fires.
                  const { buildContextCompressedStatus } = await import('./context-compressor');
                  controller.enqueue(formatSSE({
                    type: 'status',
                    data: JSON.stringify(buildContextCompressedStatus({
                      messagesCompressed: compResult.messagesCompressed,
                      tokensSaved: compResult.estimatedTokensSaved,
                    })),
                  }));
                  // FIX(权威分子): 重试回合同样交给无凭据探针后补(同主路径)。
                  if (sessionId) {
                    fireContextUsageProbe({
                      appSessionId: sessionId,
                      sdkSessionId: rMsg.session_id,
                      cwd: retryOptions.cwd as string,
                      match: usage
                        ? {
                            input_tokens: usage.input_tokens,
                            output_tokens: usage.output_tokens,
                          }
                        : null,
                    });
                  }
                  break;
                }
              }
            }
            controller.enqueue(formatSSE({ type: 'done', data: '' }));
            controller.close();
            return; // Retry succeeded — skip normal error path
          } catch (retryErr) {
            console.warn('[claude-client] PTL retry failed, falling through to error display:', retryErr);
            // Fall through to normal error handling below
          }
        }

        // Send structured error JSON so frontend can parse category + hints
        // Falls back gracefully for older frontends that only read raw text
        const errorMessage = formatClassifiedError(classified);
        controller.enqueue(formatSSE({
          type: 'error',
          data: JSON.stringify({
            category: classified.category,
            userMessage: classified.userMessage,
            actionHint: classified.actionHint,
            retryable: classified.retryable,
            providerName: classified.providerName,
            details: classified.details,
            rawMessage: classified.rawMessage,
            recoveryActions: classified.recoveryActions,
            // Include formatted text for backward compatibility
            _formattedMessage: errorMessage,
          }),
        }));
        controller.enqueue(formatSSE({ type: 'done', data: '' }));

        // Always clear sdk_session_id on crash so the next message starts fresh.
        // Even for fresh sessions — the SDK may emit a session_id via status
        // event before crashing, which gets persisted by consumeStream/SSE
        // handlers. Leaving it would cause repeated resume failures.
        if (sessionId) {
          try {
            updateSdkSessionId(sessionId, '');
            console.warn('[claude-client] Cleared stale sdk_session_id for session', sessionId);
          } catch {
            // best effort
          }
        }

        controller.close();
      } finally {
        unregisterConversation(sessionId);
        // Tear down shadow ~/.claude/ if we built one. Best-effort — the OS
        // will eventually GC tmpdir even if this fails.
        if (shadowHome) {
          shadowHome.cleanup();
          shadowHome = null;
        }
        // Cowork: release the VM idle-reclaim gate for this session's turn.
        if (coworkActiveSessionId) {
          const releasingId = coworkActiveSessionId;
          coworkActiveSessionId = null;
          import('./cowork-vm-manager')
            .then((m) => m.releaseSession(releasingId))
            .catch(() => { /* manager not loaded — nothing to release */ });
        }
      }
    },

    cancel() {
      abortController?.abort();
    },
  });
}

// ── Provider Connection Test ─────────────────────────────────────

export interface ConnectionTestResult {
  success: boolean;
  error?: {
    code: string;
    message: string;
    suggestion: string;
    recoveryActions?: Array<{ label: string; url?: string; action?: string }>;
  };
}

/**
 * Test a provider connection by sending a direct HTTP request to the API endpoint.
 * Bypasses the Claude Code SDK subprocess entirely to avoid false positives
 * from keychain/OAuth credentials leaking into the test.
 */
export async function testProviderConnection(config: {
  apiKey: string;
  baseUrl: string;
  protocol: string;
  authStyle: string;
  envOverrides?: Record<string, string>;
  modelName?: string;
  presetKey?: string;
  providerName?: string;
  providerMeta?: { apiKeyUrl?: string; docsUrl?: string; pricingUrl?: string };
}): Promise<ConnectionTestResult> {
  const { getPreset, findPresetForLegacy } = await import('./provider-catalog');

  // Look up preset for default model
  const preset = config.presetKey
    ? getPreset(config.presetKey)
    : (config.baseUrl ? findPresetForLegacy(config.baseUrl, 'custom', config.protocol as import('./provider-catalog').Protocol) : undefined);

  // Determine model to use in test request
  const model = config.modelName
    || preset?.defaultRoleModels?.default
    || (preset?.defaultModels?.[0]?.upstreamModelId || preset?.defaultModels?.[0]?.modelId)
    || 'sonnet';

  // For bedrock/vertex/env_only protocols, we can't do a simple HTTP test
  if (config.protocol === 'bedrock' || config.protocol === 'vertex' || config.authStyle === 'env_only') {
    return {
      success: false,
      error: { code: 'SKIPPED', message: 'Cloud providers (Bedrock/Vertex) require IAM or OAuth credentials — connection test is not available for this provider type', suggestion: 'Save the configuration and send a message to verify' },
    };
  }

  // Media-only protocols: the rest of this function builds an Anthropic
  // /v1/messages probe with anthropic-version + x-api-key. That endpoint
  // doesn't exist for GPT Image or Nano Banana, so the generic probe would
  // always report failure even for correctly-configured providers. Route
  // them to a minimal image-API probe instead (both endpoints return a
  // 401/403 for bad auth and a 400/422 for a valid-but-rejected request,
  // which is enough to verify that the key reaches the right service).
  if (config.protocol === 'openai-image' || config.protocol === 'gemini-image') {
    return testMediaProviderConnection(config);
  }

  // Reject third-party / custom Anthropic providers without a base URL.
  // Otherwise the fallback to https://api.anthropic.com would test the
  // official endpoint, giving a misleading green signal before saving a
  // provider that in production would also resolve to api.anthropic.com
  // via the same fallback and silently inherit first-party catalog.
  // Users who genuinely want official Anthropic must pass the URL
  // explicitly (or choose the anthropic-official preset).
  if (config.protocol === 'anthropic' && !config.baseUrl?.trim()) {
    return {
      success: false,
      error: {
        code: 'MISSING_BASE_URL',
        message: 'Base URL is required for Anthropic-protocol providers',
        suggestion: 'Use https://api.anthropic.com for the official API or your third-party endpoint',
      },
    };
  }

  // Build the API URL — Anthropic-compatible endpoint.
  // baseUrl is guaranteed non-empty above for protocol='anthropic';
  // other protocols retain the historical fallback behavior.
  let apiUrl = config.baseUrl || 'https://api.anthropic.com';
  // Ensure URL ends with /v1/messages for Anthropic-compatible providers
  if (!apiUrl.endsWith('/v1/messages')) {
    apiUrl = apiUrl.replace(/\/+$/, '');
    if (!apiUrl.endsWith('/v1')) {
      apiUrl += '/v1';
    }
    apiUrl += '/messages';
  }

  // Build headers based on auth style
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (config.authStyle === 'auth_token') {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  } else {
    headers['x-api-key'] = config.apiKey;
  }

  // Minimal request body — just enough to verify auth + endpoint
  const body = JSON.stringify({
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // 2xx = success (even if model returns an error in body, auth works)
    if (response.ok) {
      return { success: true };
    }

    // Parse error response
    let errorBody = '';
    try { errorBody = await response.text(); } catch { /* ignore */ }

    const classified = classifyError({
      error: new Error(`HTTP ${response.status}: ${errorBody.slice(0, 500)}`),
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      providerMeta: config.providerMeta,
    });

    return {
      success: false,
      error: {
        code: classified.category,
        message: classified.userMessage,
        suggestion: classified.actionHint,
        recoveryActions: classified.recoveryActions,
      },
    };
  } catch (err) {
    clearTimeout(timeoutId);

    // Network errors (ECONNREFUSED, ENOTFOUND, timeout, etc.)
    const classified = classifyError({
      error: err,
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      providerMeta: config.providerMeta,
    });

    return {
      success: false,
      error: {
        code: classified.category,
        message: classified.userMessage,
        suggestion: classified.actionHint,
        recoveryActions: classified.recoveryActions,
      },
    };
  }
}

/**
 * Connection probe for media providers (Gemini image, OpenAI image). Each
 * provider has a different authentication scheme and endpoint shape:
 *
 *   OpenAI Image:   Bearer auth, GET /v1/models is the cheapest reachable
 *                   probe (no body; returns 401 for bad keys, 200 for good).
 *   Gemini Image:   Google uses an API key query parameter, not a header.
 *                   GET /v1beta/models?key=... mirrors the same 401/200 shape.
 *
 * Using these instead of the Anthropic /v1/messages probe means a valid
 * media configuration no longer reports a false failure because it never
 * had /v1/messages to hit.
 */
async function testMediaProviderConnection(config: {
  apiKey: string;
  baseUrl: string;
  protocol: string;
  providerName?: string;
  providerMeta?: { apiKeyUrl?: string; docsUrl?: string; pricingUrl?: string };
}): Promise<ConnectionTestResult> {
  const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
  const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const trimmed = (config.baseUrl || '').replace(/\/+$/, '');

  let apiUrl: string;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (config.protocol === 'openai-image') {
    const base = trimmed || DEFAULT_OPENAI_BASE;
    apiUrl = `${base}/models`;
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  } else {
    // gemini-image: Google AI Studio uses ?key=... query-string auth.
    const base = trimmed || DEFAULT_GEMINI_BASE;
    apiUrl = `${base}/models?key=${encodeURIComponent(config.apiKey)}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(apiUrl, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) return { success: true };

    let errorBody = '';
    try { errorBody = await response.text(); } catch { /* ignore */ }

    const classified = classifyError({
      error: new Error(`HTTP ${response.status}: ${errorBody.slice(0, 500)}`),
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      providerMeta: config.providerMeta,
    });

    return {
      success: false,
      error: {
        code: classified.category,
        message: classified.userMessage,
        suggestion: classified.actionHint,
        recoveryActions: classified.recoveryActions,
      },
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const classified = classifyError({
      error: err,
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      providerMeta: config.providerMeta,
    });
    return {
      success: false,
      error: {
        code: classified.category,
        message: classified.userMessage,
        suggestion: classified.actionHint,
        recoveryActions: classified.recoveryActions,
      },
    };
  }
}
