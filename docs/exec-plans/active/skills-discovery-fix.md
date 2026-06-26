# 技能创建与发现修复（应用内创建 + 手动拖入两场景）

> 创建时间：2026-06-26
> 最后更新：2026-06-26
> 技术交接见 [docs/handover/skills-discovery.md](../../handover/skills-discovery.md)

## 背景

两个用户可感知的 bug：

1. **应用内新建技能在「我的技能」列表里看不到**：`SkillsManager.fetchSkills` 过滤掉了所有 `source==='project'`，且列表只渲染 global/installed/plugin 三个分区，没有 project 渲染分支；而创建对话框默认作用域是 `project`，于是新建技能必然不可见。
2. **agent 读取不到项目级技能**：托管/自定义（DB）服务商下 `settingSources` 被钉为 `['user']`（[provider-resolver.ts](../../../src/lib/provider-resolver.ts) ~826-867 防鉴权 env 泄漏），连带丢弃 `<cwd>/.claude/{commands,skills}`，导致斜杠命令原样发送 `/x` 后 SDK 解析不到。

延伸场景：用户手动在项目 `.claude/skills/<name>/SKILL.md` 拖入下载的 skill —— 同样受 `settingSources` 限制，在默认 SDK 运行时下 agent 发现不了（仅 env 模式或 native 运行时可发现）。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 1 | 列表显示项目级技能 + 项目名徽章 | ✅ 已完成 | 去掉 project 过滤 + 新增 PROJECT 分区 + SkillListItem 徽章 |
| Option C | 项目级斜杠命令客户端展开 | ✅ 已完成 | badge 带 source；提交时取正文展开 $ARGUMENTS；popover 豁免 SDK 白名单过滤 |
| 根治 | SDK 运行时注册 codepilot-skill in-process MCP | ✅ 已完成 | 文件系统直扫项目技能，绕开 settingSources，所有服务商一致 |
| Phase 3 | 无项目时禁用 project 作用域 | ✅ 已完成 | CreateSkillDialog 默认/禁用逻辑 |
| 测试 | 单元 + smoke + E2E + CDP | ✅ 已完成 | unit 1542、smoke 6、e2e 28(0 fail)、CDP 验证 PROJECT 分区渲染 |
| Phase 5 | Skills 设置跨项目聚合 + 新建选项目 | ✅ 已完成 | 设置-Skills 不再绑定当前对话项目；按项目分区展示全部项目技能 + 新建时下拉选项目；CDP 验证 fac/satisFac/demo 分区 + 写入正确目录 |

## 决策日志

- 2026-06-26: 放弃「shadow 镜像项目命令」方案。对抗核查确认 shadow 仅在 `~/.claude` 含 cc-switch 鉴权 env 时才构建，多数托管用户走 passthrough → 镜像不执行；要补全须「每轮都建 shadow」，爆炸半径覆盖 MCP/credentials/transcripts + 把数据丢失风险的清理逻辑加到每轮托管对话。
- 2026-06-26: 斜杠命令（应用内创建）用 **Option C 客户端展开**；自主发现（手动拖入 Agent Skill）用 **codepilot-skill MCP**。二者互补：前者保留 `/命令` 交互，后者让 agent 自主发现执行，均绕开 settingSources，对所有服务商生效。
- 2026-06-26: MCP 仅暴露 **项目级**（`<cwd>/.claude` 下）技能 —— 用户级 `~/.claude/skills` 已由 SDK 经 `user` 层 + shadow 软链原生加载，避免与原生 Skill 工具重复。
- 2026-06-26 (Phase 5): 设置-Skills 旧逻辑绑定 `usePanel().workingDirectory`（当前对话所属项目），导致切到 B 项目对话就看不到 A 项目技能、且新建无法选项目。改为：拉取所有 session 经 `groupSessionsByProject` 得到全部项目，`GET /api/skills?cwds=[...]` 一次性返回各项目级技能（每项带 `projectCwd`），按项目分区展示；新建对话框加项目下拉，保存/删除按各技能自身 `projectCwd` 定位。复用现有 /api/skills（加 `cwds` 批量参数），无新端点。

## 详细设计

### Phase 5（Skills 设置跨项目聚合）
- [route.ts](../../../src/app/api/skills/route.ts)：GET 新增 `cwds`（JSON 数组）批量参数，逐项目扫描 commands+skills 并打 `projectCwd` 标签；`cwds=[]` 时不扫任何项目（避免误扫服务器 process.cwd()）。
- [SkillsManager.tsx](../../../src/components/skills/SkillsManager.tsx)：`fetchSkills` 先 `GET /api/chat/sessions` → `groupSessionsByProject` 得项目列表 → `GET /api/skills?cwds=` 聚合；按项目分区渲染；`buildSkillUrl`/`handleSave`/`handleDelete` 用 `skill.projectCwd` 定位；不再依赖 `usePanel().workingDirectory`（仅用于新建默认项目）。
- [CreateSkillDialog.tsx](../../../src/components/skills/CreateSkillDialog.tsx)：`projects` 列表 + 项目 `<Select>`（`skills.selectProject` i18n），项目作用域必选其一；`onCreate(name, scope, content, projectCwd?)`。
- [SkillListItem.tsx](../../../src/components/skills/SkillListItem.tsx)：`SkillItem` 加 `projectCwd`/`projectName`，徽章用每项自身 `projectName`。

### Phase 1（前端）
- [SkillsManager.tsx](../../../src/components/skills/SkillsManager.tsx)：`fetchSkills` 不再过滤 project；新增 `projectSkills` 分组 + PROJECT 分区；`projectName = basename(workingDirectory)`。
- [SkillListItem.tsx](../../../src/components/skills/SkillListItem.tsx)：`source==='project' && projectName` 时渲染项目名徽章；全局无徽章。

### Option C（项目级斜杠命令）
- [types/index.ts](../../../src/types/index.ts) `CommandBadge` 增加 `source`。
- [message-input-logic.ts](../../../src/lib/message-input-logic.ts)：`resolveItemSelection` 透传 `source`；新增纯函数 `expandSkillBody`（剥 frontmatter、替换 `$ARGUMENTS`、无占位符则追加用户输入）。
- [MessageInput.tsx](../../../src/components/chat/MessageInput.tsx)：`handleSubmit` 对单个 `slash_command` 且非 global/sdk/plugin/installed 的 badge，调用 `expandProjectSlashCommand` 取 `/api/skills/<name>?cwd=` 正文展开后作为 prompt 发送，`displayLabel` 仍为 `/名`，失败回退 `dispatchBadge`。
- [useSlashCommands.ts](../../../src/hooks/useSlashCommands.ts)：SDK init 白名单过滤豁免 `source==='project'`，使项目命令在托管下仍出现在 popover。

### 根治（codepilot-skill MCP）
- 新增 [skill-mcp.ts](../../../src/lib/skill-mcp.ts)：`createSkillMcpServer(cwd)` 暴露单个 `codepilot_skill` 工具（无参列出 / 传 `skill_name` 取正文执行），复用 [skill-discovery.ts](../../../src/lib/skill-discovery.ts) + [skill-executor.ts](../../../src/lib/skill-executor.ts)，仅 `<cwd>/.claude` 下的项目技能；`buildSkillSystemPrompt(cwd)` 生成系统提示词列出可用项目技能（无则返回 null → 不注册，零开销）。
- [claude-client.ts](../../../src/lib/claude-client.ts)：SDK 路径在 notify MCP 后注册 `codepilot-skill`（仅当有项目技能时），加入 `allowedTools`。

### Phase 3
- [CreateSkillDialog.tsx](../../../src/components/skills/CreateSkillDialog.tsx)：`hasProject=false` 时默认 global、禁用 project 按钮、提示文案；[SkillsManager.tsx](../../../src/components/skills/SkillsManager.tsx) 传 `hasProject={!!workingDirectory}`。

## 已知局限

- Option C 与 MCP 给的是「展开正文当 prompt / 工具返回正文」语义，非 Claude Code 原生 slash command / Agent Skill 的系统级执行；`$1..$9`、frontmatter allowed-tools、`` !`bash` ``、`@file` 等原生模板能力不替代（应用内创建的技能是纯提示词模板，不使用这些）。原生对齐属后续 Phase 4（Agent Skills/Slash Commands 彻底拆分 + SDK `skills` 选项），见 [tech-debt-tracker.md](../tech-debt-tracker.md)。
- 本地 dev 无登录体系，托管服务商的真实 agent 调用路径以单测 + 代码审查覆盖，CDP 验证渲染与数据链路。
