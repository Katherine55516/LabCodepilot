# 内置 Claude Code 升级方案书：2.1.141 → 2.1.20x（Agent SDK 0.2.141 → 0.3.20x）

> 创建时间：2026-07-08
> 性质：升级前调研 + 实施方案（纯调研文档；确定执行后按本文档 §6 建执行计划到 `docs/exec-plans/active/`）
> 上次升级参考：[docs/exec-plans/active/agent-sdk-0-2-141-upgrade.md](../exec-plans/active/agent-sdk-0-2-141-upgrade.md)（0.2.111 → 0.2.141）

## 0. 结论摘要（TL;DR）

1. **目标版本需要修正**：npm 上不存在 SDK `0.2.201`。`@anthropic-ai/claude-agent-sdk` 的 0.2.x 系列止步于 0.2.141（恰为当前版本），之后直接从 0.3.142 续接。CLI 2.1.201 对应 **SDK 0.3.201**（已确认存在）。升级是**跨 minor（0.2 → 0.3）**，`^0.2.141` 的 semver 范围不会自动覆盖，必须显式改 package.json。
2. **兼容性总体良好**：对两版本 `sdk.d.ts` 逐类型 diff 核验，本项目用到的**全部** SDK 类型（Options / Query / 各消息类型 / PermissionResult / McpServerConfig / AgentDefinition 等）**零字段移除，只有新增**；`tool()` / `createSdkMcpServer()` 签名不变；0.3.x 移除的只有 `unstable_v2_*` 会话 API 和 `./assistant` 入口，本项目均未使用。打包链路（asarUnpack / after-pack 校验 / CI 跨架构注入 / Win Docker 交叉构建）全部版本无关，**零改动**。
3. **建议落点调整为 0.3.203（CLI 2.1.203），而非 0.3.201**：2.1.201 本身只有一条无关变更（安静版本），但它落在两个已确认的回归区间内——① 2.1.196 引入的「macOS 假低内存检测导致 15–20 秒卡顿」（2.1.203 修复）；② 「context-usage 指示器每回合重新分析整个 transcript 的内存/CPU 回归」（2.1.203 修复，本项目每回合跑 `getContextUsage` 探针，直接相关）。若可接受再进一版，0.3.204 还修了 headless（=SDK 子进程）模式 SessionStart hook 事件不流式的问题。三个版本的升级成本完全相同。
4. **真正的风险不在编译层，在运行时行为**（详见 §5 风险登记册）：
   - P0：任务清单 UI 依赖 `TodoWrite` 工具特判——新版模型行为可能转向 `TaskCreate/TaskUpdate` 系列（工具类型两版本都在，但系统提示导向可能变化），需实测；失效则需补 Task* 消息映射。
   - P0：打包版自带 MCP（chrome-devtools）靠 SDK 从 `<cwd>/.mcp.json` 自动加载，而 2.1.154→2.1.196 期间 `.mcp.json` 信任模型系统性收紧，需打包实测。
   - P1：env 模式的 `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL` 角色映射，2.1.172/174/176 连续动过这条链路（含 availableModels 强制校验）；managed 场景本地验不了，需打包后真账号回归。
5. **当前 2.1.141 有已知缺陷，升级本身有正向收益**：2.1.144 修复了「headless 模式 Skill 工具权限错误（2.1.141 引入的回归）」；此外区间内修复了 stream-json 模式进程退出挂起、SDK 会话 interrupt 静默丢弃、Agent SDK 流结束未捕获异常、远程 MCP 工具挂起 5 分钟无响应等多个直接命中本项目使用面的 bug，还有 `[1m]` 别名系列修复。
6. **工作量估算**：代码改动很小（package.json 依赖声明 + 注释更新，约半天）；大头在验证（本地全链路 + macOS/Windows 打包实测，1–2 天）。若 TodoWrite 行为验证不通过，补 Task* 映射约 +1 天。

---

## 1. 现状

| 项 | 值 |
|---|---|
| 依赖声明 | `@anthropic-ai/claude-agent-sdk: ^0.2.141`（package.json:57） |
| 实际安装 | 0.2.141，内嵌 CLI 2.1.141 |
| 分发方式 | 8 个平台子包（optionalDependencies），每个含 Bun 编译的 `claude`/`claude.exe`（~230MB）；npm install 按 OS/arch 只装当前平台 |
| 运行方式 | SDK `query()` 自动 `require.resolve` 平台子包并 spawn 二进制；`pathToClaudeCodeExecutable` 故意不设 |
| 使用范围 | 仅 Next.js server 层（`src/lib/**`、`src/app/api/**`）；Electron 主进程不 import SDK |
| 调用面 | 5 个 `query()` 调用点（主聊天流 / 压缩重试 / generateTextViaSdk / 斜杠命令枚举 / streamTextViaSdk）+ provider-doctor 探针 + context-usage 探针；8 个 `createSdkMcpServer` 进程内 MCP；Query 控制方法 `supportedModels/supportedCommands/accountInfo/mcpServerStatus/getContextUsage/interrupt` |

集成面完整清单（含文件行号）由本次调研整理，要点已并入 §4 影响评估；上次升级的架构决策见 exec-plans 中 0.2.141 升级文档。

## 2. 版本事实与落点建议

### 2.1 版本轨道修正

- npm `@anthropic-ai/claude-agent-sdk` 实际版本序列：`0.2.131 … 0.2.141`（0.2.x 终点）→ `0.3.142 … 0.3.204`（与 CLI 2.1.x 尾号对齐续接）。
- **不存在 0.2.201**。用户目标「CLI 2.1.201」= **SDK 0.3.201**。
- 0.x 时代跨 minor 是官方的破坏性变更信号，实际破坏点见 §3。

### 2.2 目标版本质量时间线（changelog 原文核验）

| CLI 版本 | 关键事实 | 对本项目 |
|---|---|---|
| 2.1.196 | 引入「macOS 假低内存检测」回归（后被 2.1.203 修复：*"Fixed opening or switching background agent sessions on macOS stalling for 15–20 seconds due to a false low-memory detection (regression in 2.1.196)"*）；同版本收紧 `.mcp.json` 信任（安全变更） | macOS 是主要发布平台；卡顿条目描述的是 background agent 场景，嵌入场景是否命中未知，但风险真实 |
| 2.1.200 | permission mode「default」在 UI 层改叫「Manual」（**API 层 `default` 仍被接受**，已验证 0.3.201 类型定义中 `PermissionMode` 取值与旧版完全一致）；AskUserQuestion 不再默认自动继续 | 权限 API 兼容；行为微调需观察 |
| **2.1.201** | 仅 1 条变更：Sonnet 5 会话不再用 mid-conversation system role 传 harness reminders | 安静版本，但继承 2.1.196 的回归 |
| 2.1.202 | 修 unicode 引号解析崩溃、mTLS 轮换、skill 重复加载等 | 中性 |
| **2.1.203** | 修 macOS 15–20s 卡顿回归；修「context-usage 指示器每回合重分析整个 transcript 的内存/CPU 回归」；二进制减 ~7MB、启动内存减 ~7MB | **本项目每回合结束后跑 `getContextUsage` 探针（token 用量卡片），CPU 修复直接相关**；体积红利 |
| 2.1.204 | 修 headless 会话 SessionStart hook 事件不流式（远程 worker 被误回收）；修 Windows 后台 PATH 继承 | headless=SDK 子进程模式，直接相关（本项目虽不用 hooks，但同链路） |

### 2.3 落点建议

**推荐 `0.3.203` 起步的较新版本（CLI ≥2.1.203），实施日复查当天最新版后定稿**，理由：
- 0.3.203 修复了 2.1.201 所处的两个回归区间，且其中 context-usage 修复直接命中本项目 token 用量卡片链路（该链路历史上就因「打包环境计算慢几十秒」踩过坑，见 token-usage 修复史）——**≥0.3.203 是硬下限**；
- 发布时间事实（npm registry 核验，北京时间）：0.3.201=07-04、0.3.202=07-07、0.3.203=07-08 凌晨、0.3.204=07-08 早上（`latest` 标签）。该包跟随 CLI **约每工作日一版**，0.3.203 与 0.3.204 仅隔 6.5 小时，社区暴露时间都不足一天，二者 d.ts 实质差异仅为新增消息类型（已 diff 验证）；0.3.204 另修 headless SessionStart hook 流式与 Windows PATH 继承，对本项目是同链路加固而非必需（我们不用 hooks）。
- 鉴于日更节奏，Phase 1 动手当天先 `npm view @anthropic-ai/claude-agent-sdk dist-tags.latest` 复查，并扫一眼 2.1.204 之后新版的 changelog 条目：无回归信号则取当日最新，有拿不准的条目则退回已核验的 0.3.203/0.3.204。

**若坚持 0.3.201**（严格对齐用户最初目标）：功能可用，编译与 API 层无差别，但需接受 macOS 卡顿回归风险 + context-usage 每回合 CPU 回归（正好打在本项目的高频路径上），不推荐。

> 版本号锚定建议：无论选哪个落点，package.json 用**精确版本**（如 `0.3.203`，去掉 `^`）或保持 `^0.3.203`。因 0.3.x 与 CLI 版本同步周更，`^` 会在重装时静默前移内嵌 CLI 版本，与「打包内容可复现」的发版纪律冲突——上一版用 `^0.2.141` 时因 0.2.x 恰好停更未暴露此问题。**建议本次起改精确锁定**，lock 文件双保险。

## 3. 变更分析（三层）

### 3.1 包结构层（npm 元数据，已核验）

| 项 | 0.2.141 | 0.3.201/203/204 | 影响 |
|---|---|---|---|
| dependencies | `@anthropic-ai/sdk ^0.93.0`、`@modelcontextprotocol/sdk ^1.29.0` | **无（降为 peer）** | 见下 |
| peerDependencies | `zod ^4.0.0` | `zod ^4.0.0`、`@anthropic-ai/sdk >=0.93.0`、`@modelcontextprotocol/sdk ^1.29.0` | 需应用侧显式声明（§6 Phase 1） |
| optionalDependencies | 8 平台子包 0.2.141 | 8 平台子包同号（结构不变） | 打包链路零改动 |
| engines | node >=18 | node >=18 | 无 |
| exports | 含 `./assistant` | **移除 `./assistant`**，新增 `./extract` | 项目未用 assistant ✓ |
| 主包体积 | 4.5MB | 3.8MB | 无 |

关键点：
- **项目当前顶层已满足全部 peer 范围**：zod 4.3.6（传递提升）、`@anthropic-ai/sdk` 0.93.0、`@modelcontextprotocol/sdk` 1.29.0——npm install 升级预计无 ERESOLVE 冲突。
- 但存在两个**规范性隐患**要一并处理：
  1. 项目 36 个文件直接 `import { z } from 'zod'`（8 个进程内 MCP server 的 schema 全靠它），而 zod 不在 package.json——现状是幽灵依赖，恰好被其他包提升。升级时把 `zod` 显式声明为直接依赖，锁 `^4.3.6`。
  2. `@anthropic-ai/sdk >=0.93.0` 是**开放区间**，npm 自动装 peer 时会解析到最新版。为避免不可控前移，显式声明 `@anthropic-ai/sdk: ^0.93.0` 与 `@modelcontextprotocol/sdk: ^1.29.0`（SDK 运行时真正 import 它们，版本必须与 SDK 期望一致）。

### 3.2 TypeScript API 层（两版本 sdk.d.ts / sdk-tools.d.ts 逐类型 diff，已核验）

**移除**（全部与本项目无关，已 grep 确认零引用）：
- `unstable_v2_createSession` / `unstable_v2_prompt` / `unstable_v2_resumeSession`、`SDKSession(Options)`、`InboundPrompt`、`ConnectRemoteControl*`

**项目使用面内的类型：零移除、零改名，仅新增**：
- `Options` +3（onUserDialog、supportedDialogKinds、toolAliases）；`Query` +4（reinitialize、reloadSkills、setMcpPermissionModeOverride、usage_EXPERIMENTAL）；`SDKAssistantMessage` +4（request_id、subagent_type、supersedes、task_description）；`SDKResultSuccess` +6（ttft_ms 等计时字段）；`ModelInfo` +1（resolvedModel）；`AgentDefinition` +2；`McpStdioServerConfig` +1（timeout）
- `PermissionMode` 取值**完全一致**（`'default'` 仍合法，未改名）
- `tool()` / `createSdkMcpServer()` 签名逐字一致（zod schema 用法不变）
- `TodoWriteInput/Output` 与 `TaskCreate/TaskUpdate` 类型**在两版本中并存**（0.2.141 就有 Task 系列）——「TodoWrite 被移除」的说法不成立，风险在行为层（见 3.3）

**SDKMessage 联合新增 8 个成员**，其中 6 个是 `type:'system'` 新 subtype（informational / thinking_tokens / model_refusal_fallback / model_refusal_no_fallback / worker_shutting_down / commands_changed），0.3.204 另有 active_goal / background_tasks_changed。已核验主消息循环（claude-client.ts:1331 起）：`system` 分支按 subtype if/else 匹配、未知 subtype 安静跳过；`default` 分支仅 string-match keep_alive/rate_limit_event、其余忽略——**新消息不会导致崩溃或 UI 异常**，代价只是新信息暂不展示（可作为后续迭代点，如 model_refusal 提示）。

### 3.3 CLI 行为层（2.1.142 → 2.1.203 changelog 原文逐条核验，47 个版本）

**风险类**（→ §5 风险登记册）：
- 2.1.196：`.mcp.json`「repo 自批准」路径收紧（安全变更），untrusted workspace 显示 Pending approval；2.1.154 起管道输出场景已不自动连接。条目字面只涉 `claude mcp list/get`，但信任模型整体收紧的趋势明确。
- 2.1.176：availableModels 强制校验——别名选择不能再经 `ANTHROPIC_DEFAULT_*_MODEL` 重定向到被封锁模型。
- 2.1.183 / 2.1.160：权限系统新增破坏性命令阻止（git --amend、terraform destroy 等）与新检查面（shell 启动文件、build config）——`acceptEdits` 模式下权限弹窗频率可能变化。
- 2.1.198：子代理改为后台运行（消息里新增 subagent_type/task_description 字段与此呼应），子代理工具流的 UI 呈现可能有观感变化。
- 任务管理导向：类型层 TodoWrite 未移除，但 2.1.169 起 TaskCreate 可靠性持续投入，新版系统提示可能引导模型改用 Task* 系列 → 本项目 TodoWrite 特判（claude-client.ts:1332-1375，解析 todos 渲染任务清单）可能不再被触发。
- 2.1.154/163：stdio MCP 子进程新增注入 `CLAUDE_CODE_SESSION_ID`、`CLAUDECODE=1` 环境变量——用户配置的 stdio MCP 会看到新 env（一般无害；本项目有 NODE_ENV 泄漏的历史教训，注意同族问题）。

**收益类**（当前 2.1.141 的已知缺陷在区间内被修复）：
- 2.1.144：修「headless 模式 Skill 工具权限错误（**v2.1.141 引入的回归**）」——当前版本自带的 bug；另有 SDK/headless MCP 启动提速（pre-wait 与启动重叠，慢 MCP 场景最多快 2s）
- 2.1.147：修 Agent SDK 流式会话结束时未捕获异常
- 2.1.153：修 stream-json 模式 stdin 无 EOF 关闭时 CLI 不退出（进程滞留）；`--strict-mcp-config` 不再剥离 SDK `agents` 定义中的内联 mcpServers
- 2.1.162：修 SDK 会话回合开始时 interrupt 被静默丢弃（本项目 `conversation-registry.interrupt()` 停止按钮链路）
- 2.1.172/173/174/176：`[1m]` 别名系列修复（双重后缀、opusplan[1m]、Fable 5 归一化）——本项目 managed 模型即用 `[1m]` 别名
- 2.1.187：远程 MCP 工具挂起 5 分钟改为超时报错（可用 `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` 覆盖）
- 2.1.191：MCP 能力发现对瞬时网络错误自动重试
- 2.1.203：见 §2.2（macOS 卡顿、context-usage CPU、体积）

## 4. 项目影响面逐项评估

| 集成点 | 位置 | 影响 | 定级 |
|---|---|---|---|
| 主聊天流 `streamClaudeSdk` | claude-client.ts:717-1683 | Options 全兼容；消息循环对新类型容错已核验 | 🟢 |
| TodoWrite 任务清单特判 | claude-client.ts:1332-1375 | 模型行为可能转向 Task* → UI 静默失效 | 🔴 P0 实测 |
| 自带 MCP（.mcp.json 自动加载） | mcp-loader.ts + 打包 standalone/.mcp.json | 信任收紧可能致打包版 chrome-devtools 消失 | 🔴 P0 实测 |
| env 模式角色映射 | provider-resolver.ts:277-283 | 2.1.172/174/176 动过该链路；managed 本地验不了 | 🟠 P1 打包实测 |
| token 用量卡片 | context-usage-probe.ts（getContextUsage） | 0.3.203 的 CPU 修复为正收益；快照结构未变 | 🟢（选 203 更优） |
| 停止按钮 | conversation-registry.interrupt() | 2.1.162 修复为正收益 | 🟢 |
| 幻影 sonnet 四层修复 | 已修（0151ff6） | 新增 model_refusal_fallback 消息族=新的降级信号面，确认不复发 | 🟠 P1 |
| 权限弹窗（canUseTool + SSE） | claude-client.ts:1049-1117 | PermissionResult 类型不变；权限面收紧或增弹窗 | 🟠 P1 |
| 8 个进程内 MCP | *-mcp.ts × 8 | tool()/createSdkMcpServer 签名不变、zod 用法不变 | 🟢 |
| Query 控制方法 5 个 | agent-sdk-capabilities.ts 等 | 全部保留、签名不变 | 🟢 |
| init 增强字段（slash_commands/skills/plugins/…） | claude-client.ts:1502-1508 | 非公开类型字段，需实测仍下发（技能/插件/命令列表 UI 依赖） | 🟠 P1 |
| generateTextViaSdk / streamTextViaSdk（别名解析） | claude-client.ts:326-539 | 机制不变；`[1m]` 修复为正收益 | 🟢 |
| provider-doctor | provider-doctor.ts | `permissionMode:'default'` 仍合法 | 🟢 |
| 打包链路全套 | next.config.ts / electron-builder.yml / after-pack.js / CI / docker-win-build.sh | 全部动态化、版本无关；子包名单不变 | 🟢 零改动 |
| POC 测试 | test:sdk-poc × 3 | 可直接复用作升级验证器（hooks-poc 顺带回答「hooks 能不能启用了」） | 🟢 资产 |

## 5. 风险登记册

| # | 风险 | 等级 | 依据 | 缓解 / 验证手段 |
|---|---|---|---|---|
| R1 | 任务清单 UI 失效（模型改用 TaskCreate/TaskUpdate，TodoWrite 特判不再触发） | 🔴 高 | 类型并存但系统提示导向可能变化；2.1.169 起 Task* 持续投入 | 升级后发「多步骤任务」提示词实测：若模型仍用 TodoWrite → 无感通过；若改用 Task* → 在 assistant 分支补 TaskCreate/TaskUpdate → todos 映射（预估 1 天，UI 组件不动，只做消息层适配） |
| R2 | 打包版自带 MCP 消失（.mcp.json 信任收紧） | 🔴 高 | 2.1.154/196 信任模型收紧；打包版 standalone cwd 属「陌生目录」 | 打包后实测 chrome-devtools 出现在 MCP 列表且可调用；若失效：把 .mcp.json 内容改为经 `loadProjectMcpServers` 读出后并入 `options.mcpServers` 程序化传入（SDK `--mcp-config` 通道不受目录信任限制，代码改动小、mcp-loader 已有现成读取函数） |
| R3 | env 模式第三方模型（GLM 等经 ANTHROPIC_DEFAULT_*）行为变化 | 🟠 中 | 2.1.176 availableModels 强制校验、2.1.172 双重 [1m] 后缀修复 | env 模式配第三方 provider 全链路回归；managed 真账号在打包版上回归（本地无 managed 数据，按惯例打包后验） |
| R4 | 权限弹窗频率/范围变化打扰用户 | 🟠 中 | 2.1.183/2.1.160 新增权限检查面 | 实测常用操作（编辑文件、跑命令、MCP 工具）在 acceptEdits 与 bypass 模式下弹窗行为与升级前一致 |
| R5 | init 增强字段（skills/plugins/slash_commands）结构变化 → 技能/插件 UI 静默变空 | 🟠 中 | 依赖非公开字段（类型层未声明，经验字段） | 升级后核对设置页技能列表、插件列表、斜杠命令枚举非空且与升级前一致（sdk-init-cache 单测 + 实测） |
| R6 | 子代理消息呈现变化（后台化） | 🟡 低 | 2.1.198 + 消息新增 subagent_type 字段 | 实测带子代理的会话（如 /gsd 类命令）工具流渲染正常 |
| R7 | peer 依赖解析漂移（@anthropic-ai/sdk 开放区间被解析到最新） | 🟡 低 | `>=0.93.0` 开放区间 + npm 自动装 peer | §6 Phase 1 显式声明三个 peer 为直接依赖并锁范围；lock 提交 |
| R8 | 新 system 消息刷屏/异常 | 🟢 已排除 | 消息循环容错已核验（未知 subtype/type 安静忽略） | 冒烟时看 console 无异常即可 |
| R9 | 二进制体积/杀软 | 🟢 低 | 结构不变，2.1.203 反而减 ~7MB | after-pack 校验已有 fail-fast；安装包体积对比记录 |
| R10 | 0.3.201 落在 macOS 卡顿回归区间 | 🔴（仅当坚持 201） | 2.1.196 引入、2.1.203 修复 | **选 0.3.203 直接消除**；若坚持 201，需在 macOS 打包版上重点观察启动/切换会话卡顿 |

## 6. 实施方案（分阶段）

> 原则：一次只动版本号与依赖声明，**不顺手启用新能力**（hooks、onUserDialog、Task* 新消息展示等一律另开迭代），最小化变量。

### Phase 0 — 准备（0.5h）
1. 从 `V3.1.0_dev` 切出升级分支（如 `feat/agent-sdk-0-3-203`）。
2. 记录基线：当前版本聊天冒烟一遍（任务清单渲染、MCP 列表、token 卡片、权限弹窗、停止按钮），留证据便于对比。

### Phase 1 — 依赖升级（1h）
1. package.json：
   - `@anthropic-ai/claude-agent-sdk`: `^0.2.141` → **`0.3.203`**（精确锁定，理由见 §2.3）
   - 新增显式直接依赖：`zod: ^4.3.6`、`@anthropic-ai/sdk: ^0.93.0`、`@modelcontextprotocol/sdk: ^1.29.0`（消除幽灵依赖 + 钉住开放 peer 区间）
2. `npm install`（注意 nvm PATH；网络走既有镜像策略），确认 lock 中 8 个平台子包同号跟进、无 ERESOLVE、无嵌套重复 SDK。
3. `npm run test`（typecheck + 单测）。预期全绿——类型面已预核验零移除；若有意外报错按报错处理（大概率是新增字段的窄化推断，属小改）。

### Phase 2 — 本地全链路验证（0.5–1 天）
按 §7 验证清单 P0/P1 项在 `npm run dev` + CDP 下逐项过；`npm run test:smoke`；跑 `test:sdk-poc` 三个 POC（凭证具备时），其中 hooks-poc 的结果**只记录不行动**（是否启用 hooks 属后续迭代决策）。

### Phase 3 — 注释与文档同步（1h）
- mcp-loader.ts:5、:331 的「2.1.141」经验注释：重新实测 settings.json.mcpServers 是否仍为 dead field，按实测结果更新版本号与结论。
- mcp-settings-migration.test.ts:4 注释同步。
- 本文档补记实测结果；RELEASE_NOTES.md 在发版时更新「内置 Claude Code v2.1.203」。

### Phase 4 — 打包验证（1 天，双平台）
1. macOS：`npm run electron:pack:mac` → 干净环境装 DMG → 登录 managed 账号 → §7 打包侧清单（重点 R2/R3）；Activity Monitor 确认 spawn 的是新版二进制（`claude --version` 应出 2.1.203）。
2. Windows：CI windows-2022 构建 NSIS 包（本地 Docker 交叉构建仅出便携版可先冒烟）→ 同清单验证。
3. 对比安装包体积（预期持平或略减）。

### Phase 5 — 收尾
- 全部验证通过后 commit（分组：依赖 / 注释 / 文档）；合入与发版按既有纪律等用户指示。
- 若 R1/R2 任一实测失败：其修复（Task* 映射 / .mcp.json 程序化注入）在同分支追加为独立 commit，重新过 Phase 2/4 对应项。

## 7. 验证清单

**P0（任一失败即阻塞发版）**
- [ ] 主聊天流：多轮对话 + 工具调用 + 流式渲染正常，console 无新报错
- [ ] **任务清单**：发多步骤任务提示词，任务清单 UI 正常出现并随进度更新（R1）
- [ ] **自带 MCP**：打包版 MCP 列表含 chrome-devtools 且工具可调用（R2）；开发版 `.mcp.json` 同样确认
- [ ] 8 个进程内 codepilot-* MCP 工具全部可用（技能、记忆检索、图片生成、通知、dashboard 等各抽 1 个实调）
- [ ] 权限弹窗：acceptEdits 下编辑/命令/MCP 的弹窗行为与基线一致（R4）
- [ ] 停止按钮：回合早期与中期 interrupt 均生效
- [ ] token 用量卡片：数值合理、不阻塞流关闭（fire-and-forget 语义不变）
- [ ] 会话 resume：历史会话继续对话正常（`resume` + 失败回退链路）
- [ ] `npm run test` / `test:smoke` 全绿

**P1（失败可评估是否带病发版）**
- [ ] 技能列表 / 插件列表 / 斜杠命令枚举非空且与基线一致（R5）
- [ ] managed 账号（打包版）：模型下拉、`[1m]` 别名主链路 + /btw 辅助链路、状态行无幻影模型（R3、幻影 sonnet 回归）
- [ ] env 模式第三方 provider（GLM 等）：角色映射生效、对话正常（R3）
- [ ] 上下文压缩：长会话触发 reactive compact 正常
- [ ] 子代理会话渲染正常（R6）
- [ ] provider-doctor 诊断跑通、报告内置版本为 2.1.203
- [ ] `test:sdk-poc` 三项结果记录（hooks-poc 结论存档）
- [ ] Windows 打包版：语音、对话、MCP 冒烟；PATH 相关无异常

## 8. 回滚预案

- **代码层**：单 commit revert package.json + lock 即回 0.2.141；无 schema/数据迁移，用户侧数据（DB、`~/.claude.json`）不受版本影响，双向兼容。
- **发布层**：若打包后发现问题，不发版即可（升级不含任何不可逆操作）；已发版则按既有流程出回滚版本（内置二进制随包走，用户降级安装即回旧版）。
- **风险隔离**：R1/R2 的修复代码均为增量适配（新增映射/注入路径），不删除旧路径——即使回滚 SDK 版本，适配代码对 0.2.141 也无害。

## 9. 工作量与排期

| 阶段 | 工时 |
|---|---|
| Phase 0–1 依赖升级 + typecheck | 0.5 天 |
| Phase 2 本地验证 | 0.5–1 天 |
| Phase 3 注释文档 | 0.25 天 |
| Phase 4 双平台打包验证 | 1 天 |
| （条件触发）R1 Task* 映射 | +1 天 |
| （条件触发）R2 .mcp.json 程序化注入 | +0.5 天 |
| **合计** | **2.5–3 天（顺利）/ 4–4.5 天（触发 R1+R2）** |

## 10. 附录：证据与方法

- 包元数据：`npm view @anthropic-ai/claude-agent-sdk@{0.2.141,0.3.201,0.3.204}`（dependencies/peer/optional/exports/体积）
- 类型面：下载 0.3.201 与 0.3.204 tarball，与本地 0.2.141 的 `sdk.d.ts`/`sdk-tools.d.ts` 做逐类型字段 diff（导出符号集合对比 + 关键类型字段对比 + SDKMessage 联合成员对比 + PermissionMode 字面量对比 + tool/createSdkMcpServer 签名对比）
- CLI 行为：`anthropics/claude-code` 官方 CHANGELOG.md 原文，2.1.142–2.1.204 区间 47 个版本逐条筛查（MCP / SDK / headless / stream-json / stdio / 别名 / 信任 / 权限 关键词族）
- 项目集成面：全仓扫描 SDK import（22 处）、Options 字段使用、消息循环结构、打包链路五件套、版本硬编码点
- 已证伪的传闻（避免后续误导）：「TodoWrite 工具被移除」（类型两版本并存）、「permissionMode default 改名 manual 破坏 API」（类型取值不变、2.1.200 明确向后兼容）、「MCP 非阻塞启动是破坏性变更」（实为 2.1.144 的启动提速优化）
