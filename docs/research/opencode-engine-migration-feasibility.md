# 内嵌引擎迁移调研：Claude Code → OpenCode 可行性与迁移方案

> 调研日期：2026-07-04。方法：代码库全量触点摸底（Explore agent）+ 两路并行网络调研（OpenCode 架构/能力、风险/法务/生态），关键结论交叉核实。信息未凭记忆，版本相关结论均为当日检索。

## TL;DR

**技术上可行，但不建议"一步到位完全替换"。**

- OpenCode（anomalyco/opencode，MIT，v1.17.13）的 server + SDK 形态与本项目现有架构**一一对位**：流式 SSE、权限事件回调、MCP、session resume、skills（直接兼容 `.claude/skills`）、subagents、todowrite、usage 统计全都有，且官方 Desktop 自己就是 Electron 内嵌 server 的形态，另有 4+ 个第三方 Electron/Tauri GUI 生产先例。
- 本项目已有 **Runtime 抽象层**（`src/lib/runtime/`，17 种 SSE 事件为唯一输出契约，前端不感知引擎），OpenCode 接入的正确形态是**新增第三个 `AgentRuntime` 实现**，而非全局重写——这把迁移从"手术"降为"插件"。
- **四个硬风险**决定不能直接切换：① managed CLI 别名（`claude-opus-4-7[1m]`）与 sdkProxyOnly 中国代理只有 Claude Code 请求形状才通，OpenCode 走标准 Anthropic 协议会直接不可用；② 同 Claude 模型在 OpenCode harness 下实测慢 ~78%、任务完成率 82%→74%；③ prompt caching 命中率有已知缺陷（企业网关 token 成本放大）；④ Windows 成色差（官方 Desktop 在 Windows 都改走 WSL-backed）。
- **廉价替代项必须先摆上桌**：仓库里已建成的 Native Runtime（`decouple-claude-code` 计划 Phase 1-8 已完成）本身就能实现"摆脱内嵌 Claude Code"的目标，零新依赖、且已含 ClaudeCodeCompatAdapter 解决 sdkProxyOnly 代理问题——如果迁移动机是"去掉 Anthropic 官方 CLI"，把 Native Runtime 提升为默认是成本最低的路径，OpenCode 未必是必要环节。
- 附带发现（现状合规敞口）：把 Claude Code CLI 打包进安装包再分发，在 Anthropic 的 LICENSE（"All rights reserved"）下**没有字面授权**，属灰色地带，建议通过商务渠道书面确认；换 OpenCode（MIT）则此敞口消除。

---

## 1. 现状：内嵌 Claude Code 的依赖面

### 1.1 集成方式

- 通过 `@anthropic-ai/claude-agent-sdk`（^0.2.141）内嵌：SDK 平台子包 `claude-agent-sdk-<platform>-<arch>` 携带 native binary（~230 MB），electron-builder `asarUnpack` 解出、`after-pack.js` Step 4 校验 + chmod。
- 运行时：SDK 在 Node 子进程 spawn CLI，凭证经 `prepareSdkSubprocessEnv()`（shadow `~/.claude/` 隔离）以环境变量过河。

### 1.2 耦合量化（Explore agent 全量摸底）

| 指标 | 数值 |
|---|---|
| import SDK 的文件 | 17 个（44 处 import） |
| 核心文件 | `claude-client.ts` 2,284 行（~79% SDK 相关） |
| SDK 强耦合总量 | ~5,700 行（占代码库 165K 行的 3.5%） |
| 内置 MCP tools | 8 个 server / 22 个 tool（`createSdkMcpServer` 进程内注册） |
| 打包体积占比 | Claude Code binary ~230MB / 应用总 ~350MB（64%） |

### 1.3 SDK 承担的职责清单（迁移时必须逐项有去处）

1. **Agent 主循环**：`query()` + 流式消息（assistant/result/partial/stream_event）
2. **权限回调**：`canUseTool` async callback → SSE `permission_request` → 前端/IM 审批闭环
3. **MCP**：外部 server（stdio/sse/http）+ 进程内 22 个内置 tool
4. **会话**：`resume`（sdkSessionId → `~/.claude/projects/**.jsonl`）
5. **managed 模型解析**：CLI 别名（`claude-opus-4-7[1m]`）只有 SDK 子进程认识；`generateTextViaSdk`/`streamTextViaSdk` 因此存在（翻译、/btw、CLI 工具描述、provider doctor 全走它）
6. **sdkProxyOnly 代理兼容**：智谱/Kimi 等中国代理不实现标准 Anthropic Messages API，只兼容"Claude Code 的请求形状"
7. **系统提示**：`systemPrompt: {preset:'claude_code', append}` 复用官方提示词（模型 RL 对齐的就是这套工具形状）
8. **其余**：thinking/effort/`context-1m` beta header、structured output、`supportedCommands()` 斜杠命令枚举、interrupt/rewind、usage（单条 assistant 级）

### 1.4 关键架构资产：Runtime 抽象层已存在

`decouple-claude-code` 执行计划（Phase 1-8 已完成，见 `docs/exec-plans/active/decouple-claude-code.md`）留下了：

- **`AgentRuntime` 接口**（[types.ts](../../src/lib/runtime/types.ts)）：`stream() / interrupt() / isAvailable() / dispose()` 四方法，注释明言为 "future Codex/Gemini CLI/ACP" 预留
- **17 种 SSE 事件是唯一输出契约**，前端完全不感知 Runtime
- **两个现役实现**：`claude-code-sdk`（默认）与 `native`（Vercel AI SDK 自建 loop，含 8 个自建工具、权限规则引擎、上下文压缩、skills、子 agent、ClaudeCodeCompatAdapter）
- 22 个内置工具已提取为共享层（`builtin-tools/`），Native 路径不依赖 SDK 注册方式

**含义：OpenCode 迁移 = 实现一个 `OpenCodeRuntime` 并注册，改动集中且前端零改动。**

---

## 2. OpenCode 项目画像（2026-07 快照）

### 2.1 基本面

| 项 | 事实 | 来源 |
|---|---|---|
| 仓库/许可 | anomalyco/opencode（原 sst/opencode，301 重定向），**MIT** | github.com/anomalyco/opencode |
| 版本 | v1.17.13（2026-07-01），日更级节奏（830+ releases/年） | GitHub releases API |
| 维护方 | **Anomaly** 公司（SST 团队独立出来），$34M 融资（2026-05 Series B），8M 月活，OpenCode 是主业而非副业 | tracxn / awesomeagents |
| 规模 | 182k stars，455 贡献者，issue 开闭比 4.9k open / 15k closed | GitHub API 实查 |
| 商业化 | Zen（模型网关）/ Black / Go 订阅——与"自带企业网关"用法无冲突 | opencode.ai/docs/zen |

### 2.2 架构与嵌入形态

- **client/server**：`opencode serve` 起 headless HTTP server（默认 127.0.0.1:4096，HTTP Basic Auth），OpenAPI 3.1 spec 暴露在 `GET /doc`
- **官方 TS SDK `@opencode-ai/sdk`**：`createOpencodeServer()`（spawn 子进程）/ `createOpencodeClient()`（连既有 server，`x-opencode-directory` 头支持一 server 多项目目录）；类型由 OpenAPI 生成
- **运行时**：`bun build --compile` 单文件二进制（内嵌 Bun，不需要用户装 Node/Bun）；npm 主包 + 12 个平台子包（optionalDependencies）——**分发结构与 claude-agent-sdk 平台子包同构，打包管线可平移**
- **体积**：macOS arm64 39.5MB / Windows x64 53.4MB / Linux ~52MB——**比 Claude Code binary 省约 180MB**
- **先例**：官方 Desktop 2026-04 从 Tauri 迁 Electron（server 直接跑在 Electron Node 进程内）；第三方 Palot（Electron）、OpenChamber（4.7k stars）、CodeNomad、OpenGUI 均走 serve + SDK + SSE 路径

### 2.3 能力对照（vs 本项目实际用到的 SDK 面）

| 本项目用的 SDK 能力 | OpenCode 等价物 | 判定 |
|---|---|---|
| `query()` 流式 | `POST /session/{id}/prompt_async` + `GET /event` SSE（32 种事件；`message.part.updated` 带 delta 增量） | ✅ 等价 |
| `canUseTool` 权限回调 | SSE `permission.updated` → `POST /session/{id}/permissions/{permissionID}`（once/always/reject）；插件另有 `permission.ask` 钩子；权限规则支持按工具/pattern 的 allow/deny/ask | ✅ 等价且策略更细，正好匹配 IM Bridge 审批桥 |
| MCP servers 传入 | config `mcp`（local/remote）+ 运行时 `POST /mcp` 动态添加 + 远程 MCP OAuth（DCR） | ✅ 等价（配置格式需转换；MCP 新 spec 跟进略慢） |
| 进程内 `createSdkMcpServer`（22 内置 tool） | ❌ 无进程内注册——OpenCode 是独立子进程 | ⚠️ 需改造：本地 HTTP MCP 桥或 OpenCode 插件（`tool` 钩子） |
| `resume` | session 服务端持久化（JSON 文件），旧 session 直接再 prompt；另送 fork/revert/undo/diff | ✅ 等价偏强；但历史 `.jsonl` 会话不互通 |
| skills（Skills 市场装到 `~/.claude/skills`） | **原生扫描 `.claude/skills` / `~/.claude/skills`**，SKILL.md 无需修改 | ✅ 直接兼容（含脚本的技能包需逐个 POC；`allowed-tools` 语义等价性未核实） |
| CLAUDE.md | AGENTS.md + **CLAUDE.md 兼容回退**（含 `~/.claude/CLAUDE.md`） | ✅ |
| subagents / AgentDefinition | primary/subagent 双层 agent，`.opencode/agents/*.md`，子会话 `/session/{id}/children` | ✅ |
| TodoWrite 任务桥 | `todowrite` 工具 + `GET /session/{id}/todo` + `todo.updated` 事件 | ✅ |
| usage（单条 assistant 级） | AssistantMessage 自带 `tokens{input,output,reasoning,cache{read,write}}` + `cost`（美元）；`step-finish` part 每步带 usage | ✅ 甚至更细（cost 计算忽略 cache_read 有已知 bug #28494） |
| thinking / effort | provider options `thinking:{type,budgetTokens}`；adaptive/effort 新参数跟进有滞后 | ⚠️ 基本等价，边缘参数需验证 |
| `context-1m` beta | ❌ **不自动下发 beta header**（#12507），需插件注入 + 覆盖 context limit | ⚠️ 需自建 |
| systemPrompt preset claude_code | 各 provider 有专调 prompt，但工具形状 ≠ Claude Code | ⚠️ 效果差异（见风险 R2） |
| structured output | `format:{type:"json_schema",schema}` | ✅ |
| `supportedCommands()` | `GET /command` + `POST /session/{id}/command` | ✅ |
| interrupt / rewind | `POST /session/{id}/abort` / `revert`+`unrevert`（git-based） | ✅ |
| 多模态图片 | file part（mime/url/filename） | ✅ |
| Anthropic 订阅 OAuth | ❌ 2026-01 被 Anthropic 服务端封杀、2026-03 应律师函从代码库删除；**API key / 自建网关不受影响** | 本项目走网关下发凭证，不受影响 |

---

## 3. 风险清单（按严重度）

| # | 风险 | 严重度 | 说明与对策 |
|---|---|---|---|
| R1 | **sdkProxyOnly 代理不可用** | 🔴 高 | 智谱/Kimi 等只兼容 Claude Code 请求形状的代理，OpenCode 走 `@ai-sdk/anthropic` 标准协议会空响应/404。对策：这些 provider 保留在 SDK/Native(compat adapter) 路径，或写 OpenCode 插件用 `chat.headers`/`chat.params` 钩子仿真（未验证）。**迁移前先统计此类 provider 的用户占比，占比高则 OpenCode 只能做可选引擎。** |
| R2 | **同模型效果回退** | 🔴 高 | Builder.io 对照实测：同 Sonnet 4.5，Claude Code 9m09s vs OpenCode 16m20s（慢 78%）；38 任务完成率 82% vs 74%。Claude 模型 RL 对齐的是 Claude Code 工具形状。对策：灰度期间收集内部任务对比数据，不达标不切默认。 |
| R3 | **managed CLI 别名失效** | 🟠 中高 | `claude-opus-4-7[1m]` 类别名 OpenCode 不解析。对策：账号体系下发"真实模型 id + context limit"，客户端建映射层；`[1m]` 需配合 R5 的 beta header 插件。别名解析职责从 SDK 子进程转移到自己身上。 |
| R4 | **prompt caching 命中缺陷** | 🟠 中高 | #20110（open）：动态 system 合并进静态前缀导致 follow-up 全 cache miss → 企业网关 token 成本直接放大。对策：POC 阶段用真实网关账单验证命中率，不达标视为 no-go。 |
| R5 | **1M context 需自建** | 🟡 中 | beta header `context-1m-2025-08-07` 不自动下发（#12507），社区靠插件注入。对策：自维护一个小插件（已有开源参考 DusKing1/opencode-anthropic-context-1m）。 |
| R6 | **Windows 成色** | 🟠 中高 | PowerShell/PATH/spawn 类 issue 高发反复回归；**官方 Desktop 在 Windows 都改走 WSL-backed**。本项目 Windows 用户是 NSIS 原生安装，风险直接命中 bash 工具执行。对策：POC 必须含 Windows 原生冒烟；不过关则 Windows 保留 SDK/Native 路径。 |
| R7 | **版本日更 + breaking 史** | 🟡 中 | `tools`→`permission` 配置合并（同时重构 permission 事件结构）、`maxSteps`→`steps`、SDK v2 参数形状变更、会话存储 JSON→SQLite 迁移曾丢历史会话（#13636）。对策：锁 minor 版本 + REST/SSE 薄适配层 + 跟版回归门禁；升级视同发版风险管理。 |
| R8 | **内置 22 工具需重新暴露** | 🟡 中 | 进程内 SDK MCP 注册方式不可用。对策：在 Next server 起本地 HTTP MCP endpoint，把 `builtin-tools/` 共享层经 MCP 协议暴露给 OpenCode（remote MCP 指向 localhost），或写成 OpenCode 插件。估 300-500 行。 |
| R9 | **数据外发纪律** | 🟡 中 | 社区抓包曾发现会话标题生成默认发 Grok 免费档；share 功能生成公网链接。与本项目"不向美国第三方发数据"纪律冲突。对策：配置层封死 share/Zen/标题外发，纳入安全 checklist 逐项审计默认行为。 |
| R10 | **历史会话不互通** | 🟢 低 | SDK 的 `.jsonl` 会话与 OpenCode session 格式不互通。对策：本项目消息本就完整存 SQLite，恢复走 DB 重放即可；旧 sdkSessionId 的 resume 放弃（新引擎新会话）。 |
| R11 | OpenCode license/可持续性 | 🟢 低 | MIT 无再分发限制（About 页加版权声明即可）；Anomaly 融资后主业化，投入可持续。 |
| （反向）R0 | **现状合规敞口** | 🟠 中高 | Claude Code LICENSE 为 "All rights reserved"，打包再分发无字面授权（认证走 API key/网关在允许侧，但分发本身是灰色地带）。**与是否迁移无关，建议尽快通过商务渠道向 Anthropic 书面确认。** |

---

## 4. 方案对比

### 方案 C（廉价替代，先评估）：Native Runtime 提升为默认，不引入 OpenCode

- **改动量：≈0 新代码**。Native Runtime 已建成（工具/权限/压缩/skills/子 agent/ClaudeCodeCompatAdapter 全齐），只改 `resolveRuntime()` 默认策略 + 灰度验证。
- 直接达成"摆脱内嵌 Claude Code"目标：删平台子包省 230MB、消除 R0 合规敞口、managed 别名和 sdkProxyOnly 代理均已有解。
- 代价：自建 harness 的效果同样需要和 Claude Code 对照验证（与 R2 同类问题，但调优权在自己手里）；维护 8 个工具 + agent loop 的长期成本在自己身上。
- **如果迁移动机主要是"去官方 CLI/去合规风险/减体积"，此方案性价比最高，应最先做效果对照评估。**

### 方案 A（推荐的 OpenCode 路线）：OpenCode 作为第三 Runtime，灰度共存

- 实现 `OpenCodeRuntime`（实现 `AgentRuntime` 四方法），注册进 registry，设置页三选一变四选一。
- 保留 SDK Runtime 为默认直至灰度数据达标；sdkProxyOnly 代理自动回落 SDK/Native。
- 符合 registry 注释里预留的演进方向；风险被隔离在单个 Runtime 内，随时可退。

### 方案 B（用户字面问题）：完全替换，OpenCode 为唯一引擎

- 在方案 A 全部完成且灰度达标后，删除 `@anthropic-ai/claude-agent-sdk` 及平台子包、`generateTextViaSdk` 迁移到 OpenCode 的 `noReply`/阻塞 message 接口或 Native 的 `text-generator`。
- **前置条件（no-go 检查点，任一不过即停在方案 A）**：
  1. sdkProxyOnly 代理用户占比可忽略，或插件仿真验证通过
  2. 真实 managed 网关联调通过（含 UA/请求形状白名单放行、caching 命中率、账单对比）
  3. Windows 原生冒烟通过
  4. 内部任务集效果对比不显著劣于 Claude Code

---

## 5. 迁移方案（方案 A → B，分六阶段）

> 工作量按 1 名熟悉本仓库的工程师估算；每阶段结束有可验证交付物。

### Phase 0：POC 与 no-go 验证（1-1.5 周）★决策门

- 本地跑 `opencode serve` + `@opencode-ai/sdk`，用真实 managed 网关凭证走通一轮对话（`provider.anthropic.options.baseURL/apiKey` 配置）
- 验证四个 no-go 项：网关放行、caching 命中（对账单）、`[1m]` 插件注入 1M header、Windows 原生（PowerShell 场景冒烟）
- 含脚本的 Skills 市场技能包抽 3-5 个实测
- **产出：POC 报告 + Go/No-Go 决策。No-Go 则转方案 C 评估。**

### Phase 1：OpenCodeRuntime 骨架（1.5-2 周）

- `src/lib/runtime/opencode-runtime.ts`：`createOpencodeServer()` 管理子进程生命周期（复用 conversation-registry 的 AbortController 模式；参考官方 Desktop 的进程内跑法可后置探索）
- 事件适配层：OpenCode 32 种 SSE 事件 → 本项目 17 种 SSE 契约（`message.part.updated`→`text/thinking/tool_use`，`session.idle`→`done`，`step-finish`→usage 提取，`todo.updated`→`task_update`，合成 `status/keep_alive`）
- session 映射：`chat_sessions` 表新增 `opencode_session_id` 列（迁移逻辑照 `sdk_session_id` 先例）
- 版本锁定策略 + REST/SSE 薄适配层（隔离 breaking change）
- **产出：纯文本对话 + 工具调用在新 Runtime 下端到端可用**

### Phase 2：权限桥 + MCP（1-1.5 周）

- 权限：订阅 `permission.updated` → 复用现有 permission-registry/SSE `permission_request`/IM Bridge 内联按钮 → `POST /session/{id}/permissions/{id}` 回复；`permissionMode` 映射为 OpenCode permission 规则对象
- 外部 MCP：`MCPServerConfig` → OpenCode `mcp` 配置格式转换（stdio→local、sse/http→remote），MCP 市场装卸走 `POST /mcp` 动态添加
- 内置 22 工具：Next server 内起 localhost HTTP MCP endpoint 暴露 `builtin-tools/` 共享层，注册为 OpenCode remote MCP；keyword-gating 保留在注册层
- SSE 断流对账：针对 #13211 类事件流断流，做断线重连 + 消息列表对账（IM Bridge 场景必需）
- **产出：权限审批（含 IM Bridge）+ MCP 市场 + 内置工具全通**

### Phase 3：能力补齐（1 周）

- `[1m]`/beta header 插件 + managed 模型映射层（账号体系下发真实 id + context limit，客户端别名转换表）
- thinking/effort 参数映射；structured output 走 `format:{json_schema}`
- 数据外发封死：share/Zen/标题生成等默认行为逐项配置关闭 + 审计（对照 no-data-to-us-sites 纪律）
- Skills/commands/CLAUDE.md 兼容性回归（重点：含脚本技能包、`allowed-tools` 语义）
- **产出：与 SDK Runtime 的功能对齐清单，逐项打勾**

### Phase 4：打包与分发（0.5-1 周）

- electron-builder：`asarUnpack` 增加 `**/opencode-*/**` 平台子包规则（结构与 claude-agent-sdk 子包同构，管线可平移）；`after-pack.js` Step 4 增加 opencode binary 校验 + chmod
- 三平台安装包实打包验证（macOS arm64/x64、Windows NSIS、Linux）
- About/第三方声明加 MIT 版权条目
- **产出：含 OpenCode 的安装包，双引擎并存（此阶段体积暂 +40-53MB，未删 Claude Code）**

### Phase 5：灰度与效果对照（2-4 周，日历时间）

- 设置页 Runtime 四选一上线，内部用户灰度；采集任务完成率/时长/token 成本对比（对照 R2/R4）
- Bridge/conversation-engine 在 OpenCode 路径下的完整回归
- 跟版机制落地：锁 minor + 升级回归门禁 + changelog 监控（会话存储迁移类变更提前演练）
- **产出：灰度数据报告 → 是否进入 Phase 6 的决策**

### Phase 6：完全替换（可选，0.5-1 周）

- 四个 no-go 检查点复核通过后：默认 Runtime 切 OpenCode → `@anthropic-ai/claude-agent-sdk` 降为 optionalDependencies → 下一版本删除平台子包与 `generateTextViaSdk` SDK 路径（辅助 AI 调用改走 OpenCode `noReply` 阻塞接口或 Native text-generator）
- 净体积收益 ~-180MB；R0 合规敞口消除
- **产出：OpenCode 为唯一内嵌引擎的发行版**

### 总工作量

- 方案 A（Phase 0-5）：**5-7 周工程时间**（+2-4 周灰度日历时间）
- 方案 B 增量（Phase 6）：+0.5-1 周
- 方案 C：**<1 周**（策略切换 + 效果对照评估）

---

## 6. 结论与建议

1. **先做 Phase 0 POC（1-1.5 周），四个 no-go 项见分晓再投入**——其中 sdkProxyOnly 代理占比和网关放行两项，不动代码就能先查。
2. **并行评估方案 C**：Native Runtime 已经是完成品，如果迁移动机是去官方 CLI / 合规 / 体积，它可能直接终结这个问题；OpenCode 的差异化价值在于"吃到一个 $34M 融资团队日更维护的 harness"而非"能跑起来"。
3. **无论是否迁移，两件事都该做**：① 向 Anthropic 书面确认 CLI 再分发授权（R0）；② 若引入 OpenCode，从第一天起锁版本 + 建薄适配层，把它的日更节奏隔离在 Runtime 边界之外。

## 附录：关键来源

- OpenCode 文档：opencode.ai/docs/{server,sdk,permissions,mcp-servers,skills,agents,plugins,providers,enterprise}
- 源码一手确认：packages/sdk/js（sdk.gen.ts / types.gen.ts）、packages/plugin/src/index.ts、packages/opencode/script/build.ts、server/auth.ts
- 效果对照：builder.io/blog/opencode-vs-claude-code、morphllm.com/comparisons/opencode-vs-claude-code
- OAuth 封禁时间线：theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access、news.ycombinator.com/item?id=46549823
- 已知缺陷：anomalyco/opencode issues #20110（caching）、#12507（1M header）、#13211（SSE 断流）、#13636（存储迁移丢会话）、#28494（cost 计算）、#17372/#27078（Windows）
- Electron 先例：dev.to/brendonovich/moving-opencode-desktop-to-electron-4hip、github.com/{itswendell/palot, openchamber/openchamber}
- 本仓库：`docs/exec-plans/active/decouple-claude-code.md`、`src/lib/runtime/`、`docs/handover/builtin-claude-code.md`
