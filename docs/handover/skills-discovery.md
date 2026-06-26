# 技能创建与发现（应用内创建 + 手动拖入）

> 产品思考见 [docs/insights/skills-discovery.md](../insights/skills-discovery.md)
> 执行计划见 [docs/exec-plans/active/skills-discovery-fix.md](../exec-plans/active/skills-discovery-fix.md)

## 概览

技能 = `.claude/commands/*.md`（slash command）或 `.claude/skills/<name>/SKILL.md`（agent skill），分**全局**（`~/.claude`）与**项目**（`<cwd>/.claude`）两级。本模块解决「应用内创建的项目技能」与「用户手动拖入的项目技能」在两套运行时、各服务商下都能被列出、调用、被 agent 发现。

## 关键约束：两套运行时 + settingSources

| | SDK 运行时（默认） | Native 运行时 |
|---|---|---|
| 何时启用 | 默认（Anthropic 协议托管/自定义服务商） | `openai-oauth` / `cli_enabled=false` / `agent_runtime=native` |
| 技能发现 | Claude Agent SDK，按 `settingSources` 文件层 | 自带 `Skill` 工具走 `discoverSkills` 文件系统直扫 |
| 项目技能（DB 服务商） | **不加载**：`settingSources=['user']` 丢弃 `project` 层（[provider-resolver.ts](../../src/lib/provider-resolver.ts) ~826-867） | 加载：与 settingSources 无关 |
| 全局技能 | 加载：`user` 层 + shadow 软链 `~/.claude/commands` | 加载 |

> 路由见 [claude-client.ts](../../src/lib/claude-client.ts) `streamClaude` 与 [runtime/registry.ts](../../src/lib/runtime/registry.ts)。SDK 运行时是绝大多数托管用户的实际路径 —— 项目技能缺口就在这里。

## 三条修复链路

### 1. 列表显示（前端）
[SkillsManager.tsx](../../src/components/skills/SkillsManager.tsx) `fetchSkills` 不再过滤 `source==='project'`；新增 **PROJECT** 分区；`projectName = basename(workingDirectory)` 传给 [SkillListItem.tsx](../../src/components/skills/SkillListItem.tsx)，`source==='project'` 时渲染项目名徽章。

### 2. 项目级斜杠命令调用（Option C，客户端展开）
用户显式 `/命令` 路径。`CommandBadge.source`（[types/index.ts](../../src/types/index.ts)）由 [message-input-logic.ts](../../src/lib/message-input-logic.ts) `resolveItemSelection` 透传。提交时 [MessageInput.tsx](../../src/components/chat/MessageInput.tsx) `handleSubmit`：
- 单个 `slash_command` badge 且 source ∈ {project, undefined} → `expandProjectSlashCommand` 取 `GET /api/skills/<name>?cwd=`，确认 `source==='project' && kind==='slash_command'` 后用纯函数 `expandSkillBody`（剥 frontmatter + 替换 `$ARGUMENTS`，无占位符则追加用户输入）得到 prompt；`displayLabel` 仍 `/名`（气泡显示 `/命令`，agent 收正文）。
- 失败/非项目 → 回退 `dispatchBadge`（原样 `/命令`）。
- [useSlashCommands.ts](../../src/hooks/useSlashCommands.ts)：SDK init 白名单过滤豁免 `source==='project'`，保证项目命令在托管下仍进 popover。

发送语义对照（[ChatView.tsx](../../src/components/chat/ChatView.tsx) `sendMessage` 用 `displayOverride||content` 渲染气泡）：用户看 `/命令`，模型收展开正文。

### 3. agent 自主发现（codepilot-skill in-process MCP）
覆盖「手动拖入 Agent Skill」与「应用内项目技能的自主发现」。[skill-mcp.ts](../../src/lib/skill-mcp.ts)：
- `createSkillMcpServer(cwd)` → SDK in-process MCP（`createSdkMcpServer`），单工具 `codepilot_skill`：无参列出项目技能；传 `skill_name` 经 `getSkill`+`prepareSkillExecution` 返回正文。
- `buildSkillSystemPrompt(cwd)`：列出 `<cwd>/.claude` 下技能（name/description/whenToUse）注入系统提示词，引导模型调用工具；无项目技能返回 null。
- 仅项目级（`filePath.startsWith(path.join(cwd,'.claude'))`），避免与 SDK 原生加载的用户级技能重复。
- [claude-client.ts](../../src/lib/claude-client.ts) SDK 路径：`buildSkillSystemPrompt` 非空时注册 `codepilot-skill` MCP + 追加系统提示词；`allowedTools` 含 `mcp__codepilot-skill`（自动放行）。仅有项目技能才注册 → 无技能项目零工具发现开销。

### Phase 3：无项目边界
[CreateSkillDialog.tsx](../../src/components/skills/CreateSkillDialog.tsx) `hasProject=false` 时默认 global、禁用 project、改提示文案，避免技能落到服务器 `process.cwd()`。

## 磁盘格式识别（重要）

| 布局 | /api/skills popover | native/MCP discoverSkills |
|---|---|---|
| `.claude/skills/foo/SKILL.md`（规范） | ✅ | ✅ |
| `.claude/skills/foo.md`（散文件） | ❌（要求子目录+SKILL.md） | ✅ |
| `.claude/commands/foo.md` | ✅ | ✅ |
| `.claude/foo.md`（根，非 skills/commands） | ❌ | ❌ |

## 数据流

创建：CreateSkillDialog → `POST /api/skills {name,scope,cwd}` → 写 `.claude/commands/<name>.md`。
列表：SkillsManager → `GET /api/skills?cwd=` → 扫描全部来源（含 `scanProjectSkills` 读 `.claude/skills`）。
调用(斜杠)：badge → handleSubmit → `GET /api/skills/<name>?cwd=`（取正文）→ 展开 → onSend。
调用(自主)：模型 → `codepilot_skill` MCP → discoverSkills/getSkill → 返回正文。

## 测试

- 单元：[message-input-interactions.test.ts](../../src/__tests__/unit/message-input-interactions.test.ts)（`expandSkillBody` + badge source）、[skill-mcp.test.ts](../../src/__tests__/unit/skill-mcp.test.ts)（`buildSkillSystemPrompt` 项目级过滤）。
- CDP：PROJECT 分区渲染、`GET /api/skills/<name>` 返回 source/kind/content。
- 全量：`npm run test`(1542)、`test:smoke`(6)、`test:e2e --workers=2`(28 pass/0 fail；6-worker 下 provider/streaming 用例会因并发超时，降并发即跳过)。

## 已知局限 / 后续

非原生执行语义（不替代 `$1..$9`/frontmatter/`` !`bash` ``/`@file`）。原生对齐 = Phase 4（Agent Skills/Slash Commands 拆分 + SDK `skills` 选项 + `system:init` 下发真实 inventory），见 [tech-debt-tracker.md](../exec-plans/tech-debt-tracker.md) 与 [research/skills-agent-sdk-review-2026-03-10.md](../research/skills-agent-sdk-review-2026-03-10.md)。
