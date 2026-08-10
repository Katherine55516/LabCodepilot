# Agent SDK 0.3.203 → 0.3.221 升级影响分析（内置 Claude Code 2.1.203 → 2.1.221）

> 调研日期：2026-08-07。前作（0.2.141 → 0.3.203 升级书）见 [agent-sdk-0-3-201-upgrade-research.md](./agent-sdk-0-3-201-upgrade-research.md)，本文只覆盖 0.3.203 → 0.3.221 的增量。
>
> 证据来源：两版 npm tarball 的 `sdk.d.ts` / `sdk-tools.d.ts` / `bridge.d.ts` / `manifest.json` / `package.json` 全量 diff；`anthropics/claude-code` CHANGELOG（2.1.204–2.1.221）；`anthropics/claude-agent-sdk-typescript` CHANGELOG（0.3.204–0.3.221）；本仓库集成面逐文件扫描。

## 结论（TL;DR）

**可以升级，风险可控。** 包结构、打包链路、核心 API 签名全部兼容，`npm run test` 能编译通过的概率高。必须改的代码只有 **1 处**（`cowork-assets.ts` 的版本常量，有单测强制锁定）；建议顺手改 1 处（构造 `SDKUserMessage` 时补 `origin` 标）；另有 **5 个必须实测回归的行为点**（任务列表投影、上下文用量探针、MCP 长调用自动后台、git-bash 错误分类字符串、打包产物）。

## 1. 版本事实

| 项 | 0.3.203 | 0.3.221 |
|---|---|---|
| 对应 CLI | 2.1.203（2026-07-07 构建） | 2.1.221（2026-08-03 构建） |
| 主包布局 | `sdk.mjs` 平铺 + 8 个平台二进制子包 | **完全相同**（exports 亦未变） |
| 平台子包布局 | 包根单个 `claude` / `claude.exe` | **完全相同** |
| darwin-arm64 二进制 | 237 MB | 270 MB（**+33.5 MB**，各平台均涨约 13%） |
| `claudeCodeVersion` 字段 | 有 | 有（`/api/claude-status` 读取链路无需改动） |
| engines | node >=18 | node >=18 |
| manifest 新增 | — | `sdkCompat.testedWrapperVersions`（二进制侧记录测过的 wrapper 版本，wrapper 与二进制同版本升级时无影响） |

npm 上 `0.3.221` 及全部 8 个平台子包均已发布（`claude-agent-sdk-linux-arm64-0.3.221.tgz` 存在，Cowork 沙箱下载链路可用）。

## 2. 必须修改的代码

### 2.1 `src/lib/cowork-assets.ts:53`（唯一硬编码）

```
export const CLAUDE_SDK_VERSION = '0.3.203'  →  '0.3.221'
```

`src/__tests__/unit/cowork-assets.test.ts:9-15` 断言该常量与 package.json 依赖一致（去 caret 比较），只升 package.json 不改这里会直接挂 `npm run test`。该常量喂给 `claudeTarballUrl()` 下载 linux-arm64 二进制进沙箱 VM——注意下载体积同步 +33 MB，R 系列容器镜像若内嵌该二进制需同步重建。

### 2.2 建议：`src/lib/claude-client.ts` 构造 `SDKUserMessage` 处补 `origin`

带图片的消息走"手工构造 `SDKUserMessage` + async generator"路径（`claude-client.ts:1544` 附近），当前未设置 `origin` 字段。0.3.221 起语义变更（sdk.d.ts `SDKMessageOrigin` 文档）：

> A host wrapping keyboard input must stamp `{kind:'human'}` explicitly — absent origin is treated as unattributed and **fails closed** at strict isHuman() trust gates.

0.3.203 里"缺省=人类"，新版"缺省=未归因"。影响面：ultracode 关键词等"仅响应人类输入"的门控对带图消息失效（纯文本 prompt 走字符串路径由 CLI 自己包装，不受影响）。修法一行：

```ts
const userMessage: SDKUserMessage = {
  type: 'user',
  message: { role: 'user', content: contentBlocks },
  parent_tool_use_id: null,
  session_id: sdkSessionId || '',
  origin: { kind: 'human' },   // ← 新增
};
```

### 2.3 可选：注释版本号更新

`src/lib/mcp-loader.ts:333,350` 注释中 "2.1.203 实测验证" 的两条经验结论（`settings.json.mcpServers` 是死字段；`.mcp.json` 信任门控），升级后应重新 spot-check 一次并把注释里的版本号改成 2.1.221（结论大概率不变——本应用 MCP 全部走 `options.mcpServers` 程序化注入，两条都只是防御性记录）。

## 3. 必须实测回归的行为点（P0）

### 3.1 TaskCreate 纯文本结果格式（任务列表 UI 的命门）

上轮升级的 R1：2.1.203 把系统提示词导向 `TaskCreate`/`TaskUpdate`，应用靠 `claude-client.ts:1805` 的正则 `/Task #(\S+) created/` 从 **纯文本** tool_result 中抠 task id，再投影回 todos UI（修复 commit `23af5ec`）。类型上 `TaskCreateOutput` 一直声明为 `{task:{id}}` 结构体但 2.1.203 实际回的是文本——这属于"类型与运行时不符"的灰区，2.1.221 随时可能把运行时改成和类型一致，正则就抓空，任务列表 UI **静默失效**（无报错）。

值得注意的新信号：0.3.221 的 `SDKUserMessage.tool_use_result` 文档明确写了 "render from it instead of parsing the tool_result text"——官方在推 host 改用结构化 `tool_use_result` 字段。**验证法**：升级后发一条会创建任务的消息，断点/日志确认 `tool_result` 文本格式与 `tool_use_result` 字段内容；若文本格式变了，把投影逻辑改为优先读 `message.tool_use_result`（更稳，一劳永逸）。

### 3.2 getContextUsage 凭证剥离探针

`context-usage-probe.ts` 的整套设计（假 HOME + 无凭证 + 复制 transcript）建立在 2.1.203 修复的 CPU 行为上（有凭证时每次快照发 ~82 个 count_tokens 请求）。2.1.221 需重验：① 无凭证探针仍能返回 `totalTokens`；② 不再出现请求风暴；③ transcript 路径假设 `~/.claude/projects/<cwd 的 / → ->/<sessionId>.jsonl` 仍成立——**2.1.221 恰好改了长路径（>200 字符）的 session 目录解析**（changelog: "Fixed long project paths resolving to wrong session directory"），常规路径 slug 算法未动的概率大，但探针的 slug 拼接逻辑（`:49-51`）要跑一遍确认。

### 3.3 MCP 长调用自动转后台（2.1.212 新行为）

2.1.212 起 **超过 2 分钟的 MCP 工具调用自动转后台**（`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` 可调）。本应用 8 个 in-process MCP server（image-gen、cli-tools、media 等）里文生图/媒体导入可能超 2 分钟；一旦被转后台，tool_result 的到达时机和形态改变，聊天流的同步渲染假设可能被打破。仓库当前没有设置任何相关 env。**验证法**：构造一个 >2 分钟的图片生成调用观察流；若行为不可接受，在 `prepareSdkSubprocessEnv` 的 env 里加 `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` 设为极大值关掉它。另外 in-process MCP 的超时机制从 "60s 上限 + `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` 覆写" 改为 "`MCP_TOOL_TIMEOUT`（默认实际无界）"——本应用两个 env 都没设过，属于净收益，但长调用测试要一并覆盖。

### 3.4 Windows git-bash 错误分类字符串

`src/__tests__/unit/error-classifier-missing-git-bash.test.ts:18-26` 硬编码了从 2.1.203 二进制 stderr 抠出的两条原文（"Claude Code on Windows requires either Git for Windows…" 等）。单测用同样的硬编码字符串所以**永远绿**；真正的风险是 2.1.221 二进制改了措辞，运行时 `MISSING_GIT_BASH` 分类静默退化为 `PROCESS_CRASH`。**验证法**（无需 Windows 机器）：`npm install` 后对本地平台二进制 `grep -a "Git Bash was not found" node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`（JS 打包进各平台二进制，darwin 上能查到 win 分支字符串）；措辞变了就同步改 classifier 和测试。

### 3.5 打包链路全量走一遍

布局未变，`electron-builder.yml` 的 asarUnpack / standalone 拷贝规则、`after-pack.js` 的子包校验、CI 的 darwin-arm64 注入步骤（动态读 `SDK_VER`，自动适配）理论上零改动。但 electron-builder 26.8.1 有"failedTask 却 exit 0"的已知坑（yml 注释有记录），**必须实际跑一次 `electron:pack:mac` 确认 DMG 产出**且体积增长符合预期（约 +15–30 MB 压缩后）。Win 侧 CI windows-2022 x64 原生安装 win32-x64 子包，无需动。

## 4. 兼容但需知晓的变更（不改代码）

| 变更 | 版本 | 对本应用的影响 |
|---|---|---|
| `interrupt()` 返回 `Promise<SDKControlInterruptResponse \| undefined>`（原 `void`） | 0.3.205 | `sdk-runtime.ts:75` 和 interrupt 路由只 await 不用返回值，兼容；将来可用收据里的 `still_queued` 做"停止即全停" |
| `set_permission_mode` 拒绝无法识别的模式（原静默采用） | 0.3.214 | 应用只传标准模式（`default`/`bypassPermissions` 等），且不调用 `setPermissionMode()`，无影响 |
| 子代理嵌套深度默认 5 → 1 →（2.1.219）3；并发子代理上限默认 20 | 0.3.217 / 2.1.219 | 主聊天场景子代理单层为主，无影响；深度依赖方需知 |
| `setMcpServers({})` 不再清除 plugin 归属的 server | ~0.3.22x | 应用不使用 `setMcpServers()`（MCP 走 query options 静态注入），无影响 |
| `skills` 选项校验收紧（拒绝通配符/不规范名） | 0.3.221 | 应用不传 `skills` 选项，无影响 |
| Task 工具 `mode` 参数废弃（子代理继承父会话权限模式）；`"bubble"` 从类型移除 | 2.1.212 | 应用不传，无影响 |
| 新内置工具：`EndConversation`（辱骂/越狱终止会话）、`SendFeedback`、`RefreshMcpTools`、`ProposeSkills` | 2.1.214–221 | 工具卡片渲染层按未知工具兜底渲染即可（现有通用渲染已覆盖）；`EndConversation` 触发时留意 result subtype |
| `/verify`、`/code-review` 不再自动自发运行 | 2.1.215 | 行为更保守，无影响 |
| AskUserQuestion 默认不再自动继续 | 2.1.217 | TUI 侧行为，SDK host 无感 |
| "always allow" 规则保存至 repo root、跨 worktree 生效 | 2.1.211 | 权限持久化语义微调，对应用自身的 DB 持久化无影响 |
| `service_tier` 类型放宽为 `string \| null`；usage 新增 `inference_geo`/`speed` | — | 应用只读不判枚举，兼容 |
| assistant 消息新增 `timestamp`/`aborted`/`resumed_from_incomplete_thinking`；init 新增 `fast_mode_disabled_reason`、`plugins[].version`、`mcp_server_errors` | — | 纯增量，现有 default 分支静默忽略未知消息，安全 |
| `canUseTool` 回调新增 `matchedAskRule`；权限请求新增 `suppress_always_allow_rule` | 0.3.22x | 增量字段。若权限弹窗提供"始终允许"，后续可按 `suppress_always_allow_rule` 隐藏该选项（改进项非必须） |
| Opus 5 上线并成为默认 Opus；模型清单变化 | 2.1.219 | 模型下拉框 managed-only 投影（见 memory `model-selector-managed-only`），SDK 侧新模型不会漏进 UI |
| 权限/沙箱安全修复约 15 项（Bash 检查绕过、不可见 Unicode、PowerShell 5.1 等） | 2.1.204–221 | 纯收益，也是本次升级的主要动机 |
| `hooks` 选项仍未在生产启用 | — | 顺手机会：用 `hooks-poc.test.ts` 在 2.1.221 上重跑一次，看 "CLI output was not valid JSON" 控制帧污染是否已修（若修复可解锁 hooks 能力） |

## 5. 升级操作步骤

```bash
# 1. 升版本（精确 pin，不带 caret，与现约定一致）
#    package.json: "@anthropic-ai/claude-agent-sdk": "0.3.221"
# 2. 同步 cowork-assets.ts CLAUDE_SDK_VERSION = '0.3.221'
# 3. 补 origin: {kind:'human'}（§2.2）
npm install                    # 本 worktree node_modules 陈旧（实测装着 0.2.141），必须全新安装
npm run test                   # typecheck + 单测（cowork-assets 版本锁在此验证）
# 4. §3 五项 P0 实测：任务列表 / 上下文探针 / 长 MCP 调用 / git-bash 字符串 grep / electron:pack:mac
# 5. dev 侧 managed 真实调用验证法见 memory：CLAUDE_GUI_SECRET_KEY=<hex> npm run dev
# 6. （可选）CLAUDE_SDK_POC=1 重跑 hooks-poc / warm-query-poc，更新 POC 结论
```

## 6. 已排除的风险（调查过、确认无关）

- `./assistant` 子入口在 0.3.x 已移除——仓库无引用（0.2.141 时代遗留，grep 为零）。
- `cli.js` 时代的路径拼接——已全部迁移到平台二进制模型，仓库中残余 `cli.js` 引用全部属于 `@playwright/mcp`。
- `pathToClaudeCodeExecutable` 仅 Cowork 沙箱转发器使用，其余调用点刻意不设，SDK 自动 `require.resolve` 平台二进制，升级无感。
- `betas: ['context-1m-2025-08-07']`、`systemPrompt` preset、`settingSources`、`outputFormat`、`agents`/`agent`、`enableFileCheckpointing`、resume/fallback 双查询——签名与语义均未变。
- compact 全在应用侧自实现，SDK 的 compact 行为变化（2.1.217 /compact 修复等）不波及。
