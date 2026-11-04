/**
 * server-json-mapper.ts — 把官方 MCP Registry 的 `server.json` 确定性映射成
 * 本应用的 `MCPServerConfig`，并抽取「安装表单 spec」+「需收集的密钥」。
 *
 * 这是 MCP 市场的技术枢纽。映射是纯函数、无副作用、无 AI——已由 Phase-0 POC
 * （`scripts/poc-mcp-marketplace.mjs`）对 npm/pypi/oci/remote 五类真实数据验证。
 *
 * 关键事实（POC 实测，勿改）：
 * - `runtimeHint` 经常缺失 → 必须按 `registryType` 兜底运行器。
 * - npx 必须自注入 `-y`，否则首次冷启动会卡在确认提示。
 * - `args` 不是只有 identifier：顺序是 runtimeArguments → identifier@version → packageArguments。
 * - oci 的 `identifier` 已含完整镜像引用 + tag；docker 需 `-e NAME` 显式转发环境变量。
 * - 密钥（isSecret）只产出 `${mcp_<slug>_<NAME>}` 占位符，明文走 settings 加密列，
 *   由 `mcp-loader.ts` 在 spawn 时解析回真值（该链路已存在）。
 *
 * 文档：docs/exec-plans/active/mcp-marketplace.md
 */

import type { MCPServerConfig } from '@/types';

// ── server.json 类型（2025-12-11 schema 的相关子集） ───────────────────

export interface McpInput {
  /** env 变量名 / header 名（KeyValueInput）。纯 value-input 可缺。 */
  name?: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
  choices?: string[];
  format?: 'string' | 'number' | 'boolean' | 'filepath' | string;
  placeholder?: string;
  value?: string;
}

export interface McpArgument {
  type?: 'positional' | 'named';
  /** named 参数的旗标名，如 "--port"。 */
  name?: string;
  value?: string;
  default?: string;
  valueHint?: string;
  isRepeated?: boolean;
}

export interface McpTransport {
  type?: 'stdio' | 'streamable-http' | 'sse';
  url?: string;
}

export interface McpPackage {
  registryType?: 'npm' | 'pypi' | 'oci' | 'nuget' | 'mcpb' | string;
  identifier?: string;
  version?: string;
  runtimeHint?: string;
  transport?: McpTransport;
  runtimeArguments?: McpArgument[];
  packageArguments?: McpArgument[];
  environmentVariables?: McpInput[];
}

export interface McpRemote {
  type?: 'streamable-http' | 'sse';
  url?: string;
  headers?: McpInput[];
}

export interface ServerJson {
  $schema?: string;
  name: string;
  description?: string;
  title?: string;
  version?: string;
  repository?: { url?: string; source?: string };
  packages?: McpPackage[];
  remotes?: McpRemote[];
}

// ── 映射输出 ───────────────────────────────────────────────────────────

/** 安装表单需要向用户收集的一项输入（env / header / url 模板变量）。 */
export interface RequiredInput {
  /** 写入 settings 表的 key（仅 secret 用），如 `mcp_<slug>_<NAME>`。 */
  settingKey: string;
  /** env 变量名 / header 名 / url 变量名。 */
  name: string;
  target: 'env' | 'header' | 'urlVar';
  description?: string;
  isSecret: boolean;
  isRequired: boolean;
  default?: string;
  choices?: string[];
  format?: string;
  placeholder?: string;
}

export interface MappedServer {
  /** 完整反向 DNS 名，如 `ai.agenttrust/mcp-server`。 */
  name: string;
  /** 建议的 mcpServers key（短名，去重由调用方负责）。 */
  suggestedKey: string;
  /** 用于密钥 settingKey 前缀的 slug。 */
  slug: string;
  kind: 'stdio' | 'remote' | 'none';
  /** 预览配置：密钥位为 `${...}` 占位符；必填非密位为空串（待表单填充）。 */
  config: MCPServerConfig | null;
  /** 安装表单 spec。 */
  requiredInputs: RequiredInput[];
  notes: string[];
}

export interface BuildResult {
  config: MCPServerConfig;
  /** 需写入 settings 表的密钥：settingKey → 明文值（调用方负责加密落库）。 */
  secretsToStore: Record<string, string>;
  notes: string[];
}

// ── 内部工具 ───────────────────────────────────────────────────────────

const DEFAULT_RUNNER: Record<string, string> = {
  npm: 'npx',
  pypi: 'uvx',
  oci: 'docker',
  nuget: 'dnx',
};

export function slugify(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** mcpServers 的建议 key：取 name 最后一段并 sanitize。 */
export function suggestKey(name: string): string {
  const last = name.split('/').pop() || name;
  return last.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || slugify(name);
}

// 前缀 `mcp_secret_` 与 db.ts 的加密判定对齐：密钥写入 settings 时自动 AES-256-GCM 加密，
// 配置里只留 ${mcp_secret_...} 占位符，由 mcp-loader 在 spawn 时解密回真值。
function settingKeyFor(slug: string, inputName: string): string {
  return `mcp_secret_${slug}_${inputName}`;
}

/** 展平 runtimeArguments / packageArguments 成 argv 片段。 */
export function flattenArgs(decls: McpArgument[] | undefined): string[] {
  const out: string[] = [];
  for (const a of decls || []) {
    if (a.type === 'named') {
      if (a.name) out.push(a.name);
      const v = a.value ?? a.default;
      if (v !== undefined && v !== null && v !== '') out.push(String(v));
    } else {
      const v = a.value ?? a.default ?? a.valueHint;
      if (v !== undefined && v !== null && v !== '') out.push(String(v));
    }
  }
  return out;
}

/** npm/pypi/nuget 的包标识：identifier(@version)；version 缺失或 latest 时不钉。 */
export function packageSpec(pkg: McpPackage, pinVersion = true): string {
  const id = pkg.identifier || '';
  const v = pkg.version;
  if (!pinVersion || !v || v === 'latest') return id;
  return `${id}@${v}`;
}

/** 提取 url 里的 `{var}` 模板变量名。 */
function urlTemplateVars(url: string): string[] {
  return (url.match(/\{([a-zA-Z0-9_]+)\}/g) || []).map((s) => s.slice(1, -1));
}

/** 把一组 McpInput 转成 RequiredInput[]（安装表单 spec）。 */
function toRequiredInputs(
  decls: McpInput[] | undefined,
  slug: string,
  target: 'env' | 'header',
): RequiredInput[] {
  const out: RequiredInput[] = [];
  for (const d of decls || []) {
    if (!d.name) continue;
    out.push({
      settingKey: settingKeyFor(slug, d.name),
      name: d.name,
      target,
      description: d.description,
      isSecret: !!d.isSecret,
      isRequired: !!d.isRequired,
      default: d.default,
      choices: d.choices,
      format: d.format,
      placeholder: d.placeholder,
    });
  }
  return out;
}

// ── 选择某个 package / remote ──────────────────────────────────────────

export interface MapOptions {
  /** 选第几个 package（默认 0）。 */
  packageIndex?: number;
  /** 'remote' 强制用远程；默认有 package 用 package。 */
  prefer?: 'package' | 'remote';
  pinVersion?: boolean;
}

interface Choice {
  kind: 'package' | 'remote';
  pkg?: McpPackage;
  remote?: McpRemote;
}

function pickChoice(server: ServerJson, opts: MapOptions): Choice | null {
  const packages = server.packages || [];
  const remotes = server.remotes || [];
  const useRemote = opts.prefer === 'remote' || packages.length === 0;
  if (!useRemote && packages.length > 0) {
    return { kind: 'package', pkg: packages[opts.packageIndex || 0] };
  }
  if (remotes.length > 0) {
    // 优先 streamable-http，退回 sse
    const sorted = [...remotes].sort(
      (a, b) =>
        (a.type === 'streamable-http' ? 0 : 1) - (b.type === 'streamable-http' ? 0 : 1),
    );
    return { kind: 'remote', remote: sorted[0] };
  }
  return null;
}

// ── 公共 API ───────────────────────────────────────────────────────────

/**
 * 抽取安装表单 spec + 预览配置（不含用户值）。
 * 详情页/安装对话框用它渲染表单。
 */
export function mapServer(server: ServerJson, opts: MapOptions = {}): MappedServer {
  const slug = slugify(server.name);
  const suggestedKey = suggestKey(server.name);
  const notes: string[] = [];
  const choice = pickChoice(server, opts);

  if (!choice) {
    return { name: server.name, suggestedKey, slug, kind: 'none', config: null, requiredInputs: [], notes: ['既无 packages 也无 remotes'] };
  }

  if (choice.kind === 'package') {
    const pkg = choice.pkg!;
    const runner = pkg.runtimeHint || DEFAULT_RUNNER[pkg.registryType || ''];
    if (!runner) notes.push(`未知 registryType=${pkg.registryType}，无默认运行器`);

    const requiredInputs = toRequiredInputs(pkg.environmentVariables, slug, 'env');
    let args: string[];

    if (pkg.registryType === 'oci') {
      args = [
        'run', '-i', '--rm',
        ...(pkg.environmentVariables || []).flatMap((e) => (e.name ? ['-e', e.name] : [])),
        ...flattenArgs(pkg.runtimeArguments),
        pkg.identifier || '',
        ...flattenArgs(pkg.packageArguments),
      ];
    } else {
      const runtimeArgs = flattenArgs(pkg.runtimeArguments);
      if (runner === 'npx' && !runtimeArgs.some((a) => a === '-y' || a === '--yes')) {
        runtimeArgs.unshift('-y');
      }
      args = [...runtimeArgs, packageSpec(pkg, opts.pinVersion), ...flattenArgs(pkg.packageArguments)];
    }

    // 预览 env：密钥 → 占位符；非密有默认 → 默认；其余空串。
    const env: Record<string, string> = {};
    for (const i of requiredInputs) {
      env[i.name] = i.isSecret ? '${' + i.settingKey + '}' : i.default ?? '';
    }

    const config: MCPServerConfig = { command: runner, args };
    if (Object.keys(env).length > 0) config.env = env;
    // 与现有 McpServerEditor 约定一致：stdio 不写 type。
    return { name: server.name, suggestedKey, slug, kind: 'stdio', config, requiredInputs, notes };
  }

  // remote
  const r = choice.remote!;
  const url = r.url || '';
  const requiredInputs = toRequiredInputs(r.headers, slug, 'header');
  // url 模板变量也是要收集的输入
  for (const v of urlTemplateVars(url)) {
    requiredInputs.push({
      settingKey: settingKeyFor(slug, v),
      name: v,
      target: 'urlVar',
      isSecret: false,
      isRequired: true,
    });
  }

  const headers: Record<string, string> = {};
  for (const i of requiredInputs) {
    if (i.target !== 'header') continue;
    headers[i.name] = i.isSecret ? '${' + i.settingKey + '}' : i.default ?? '';
  }

  const config: MCPServerConfig = { type: r.type === 'sse' ? 'sse' : 'http', url };
  if (Object.keys(headers).length > 0) config.headers = headers;
  if (urlTemplateVars(url).length > 0) notes.push(`URL 含模板变量 {${urlTemplateVars(url).join(',')}}，需表单填充`);

  return { name: server.name, suggestedKey, slug, kind: 'remote', config, requiredInputs, notes };
}

/**
 * 预热（prefetch）命令：在写入配置/首次连接前把包下载进缓存，规避「冷启动下载超
 * 健康检查超时」（Phase-0 POC 实测的唯一真坑）。命令均「下载完即退出」，可流式显示进度。
 * 远程/未知生态返回 null（无需预热）。
 *
 * - npm:  npx -y -p <id@ver> -- node --version   （装包入 _npx/_cacache 后跑 node 退出）
 * - pypi: uvx --from <id@ver> python --version    （装包入 uv 缓存后跑 python 退出）
 * - oci:  docker pull <image>                      （标准拉取，自带进度）
 */
export function prefetchCommand(server: ServerJson, opts: MapOptions = {}): { command: string; args: string[] } | null {
  const choice = pickChoice(server, opts);
  if (!choice || choice.kind !== 'package' || !choice.pkg) return null;
  const pkg = choice.pkg;
  const spec = packageSpec(pkg, opts.pinVersion);
  if (!spec) return null;
  const runner = pkg.runtimeHint || DEFAULT_RUNNER[pkg.registryType || ''];
  switch (pkg.registryType) {
    case 'npm':
      return { command: runner || 'npx', args: ['-y', '-p', spec, '--', 'node', '--version'] };
    case 'pypi':
      return { command: runner || 'uvx', args: ['--from', spec, 'python', '--version'] };
    case 'oci':
      return { command: runner || 'docker', args: ['pull', pkg.identifier || ''] };
    default:
      return null; // nuget/dnx 等暂不预热
  }
}

/**
 * 用用户填写的值构建最终可写入 `~/.claude.json` 的配置。
 * 密钥位写 `${settingKey}` 占位符并在 secretsToStore 里返回明文（调用方加密落库）；
 * 非密位内联值。
 *
 * @param values 表单收集的值：input name → 用户输入（缺失则回落 default）。
 */
export function buildConfig(
  server: ServerJson,
  values: Record<string, string>,
  opts: MapOptions = {},
): BuildResult {
  const mapped = mapServer(server, opts);
  const notes = [...mapped.notes];
  const secretsToStore: Record<string, string> = {};
  if (!mapped.config) {
    return { config: { command: '' }, secretsToStore, notes: ['无法构建：既无 packages 也无 remotes'] };
  }

  const config: MCPServerConfig = JSON.parse(JSON.stringify(mapped.config));

  for (const input of mapped.requiredInputs) {
    const provided = values[input.name];
    const value = provided !== undefined && provided !== '' ? provided : input.default ?? '';

    if (input.isSecret) {
      if (value) secretsToStore[input.settingKey] = value;
      // 占位符已在预览 config 里，无需改动
      continue;
    }

    if (input.target === 'env' && config.env) config.env[input.name] = value;
    else if (input.target === 'header' && config.headers) config.headers[input.name] = value;
    else if (input.target === 'urlVar' && config.url) {
      config.url = config.url.replace(new RegExp(`\\{${input.name}\\}`, 'g'), value);
    }

    if (input.isRequired && !value) notes.push(`必填项 ${input.name} 未提供`);
  }

  return { config, secretsToStore, notes };
}
