# Skill 目录镜像 —— 产品思考

> 技术实现见 [docs/handover/skill-agents-dir-mirror.md](../handover/skill-agents-dir-mirror.md)

## 用户碰到的问题

用户从技能市场（skills.sh）装好一个技能，斜杠面板里能看到、能选，但一发给 agent 就被告知"没有这个 skill"。表现上"装了却用不了"，非常困惑——因为 UI 明明显示它在。

## 根因：位置契约不一致

AI Native Lab 有两套技能发现面：

- **UI / 发现层**（斜杠面板、技能管理器、原生 Skill 工具）同时扫 `~/.claude/skills/` 和 `~/.agents/skills/`。
- **内置 Claude Code 二进制**只认 `~/.claude/skills/`（+ 项目 + 插件）。

`skills` CLI 把部分技能装进了 agent-中立的 `~/.agents/skills/`。于是 UI 把 agent 加载不了的技能也展示成"可用"，斜杠选中后系统给 agent 发的是"请使用 X 技能"——让 agent 自己按名解析，而它的技能表里根本没有。

## 为什么和之前的 MCP 问题是同一类

这正是已修复的 MCP bug（commit `46caccd`）的翻版：

| | MCP（已修） | Skill（本次） |
|---|---|---|
| binary 只读 | `~/.claude.json.mcpServers` | `~/.claude/skills/` |
| AI Native Lab 还多读了 | `~/.claude/settings.json.mcpServers`（死字段） | `~/.agents/skills/` |
| 症状 | UI 显示已配置，agent 调不到 | 面板能列出，agent 报找不到 |

抽象成一句话：**内置 binary 暴露了"UI 读取位置 ⊋ binary 读取位置"的裂缝。** 自托管/原生 runtime 时代，AI Native Lab 自己的 Skill 工具会去 `~/.agents/skills/` 兜底；切到内置 Claude Code 后这座桥没了，裂缝才显形。用户的直觉（"是不是打包导致的"）方向正确。

## 为什么选"复制到 `~/.claude/skills/`"而不是别的方案

- **不改 dispatch 去注入技能正文**：那样能绕开位置问题，但会丢掉 Claude Code 原生的渐进披露、`allowed-tools`/fork 沙箱语义，且正文里的资源引用还要另接文件系统。既然我们特意内置了 Claude Code，就该让技能活在它设计的地方，白拿这些能力。
- **复制而非搬移**：`~/.agents/skills/` 是外部 `skills` CLI 的合法地盘（有自己的 lock）。搬移会破坏它的 `update/remove`。复制 + 打标记，是"既让 agent 看得到、又不破坏外部工具"的最小代价。
- **对齐 MCP 修复的成熟范式**：幂等、原子、冲突时规范位置胜、失败保留重试——直接复用经过验证的形状，只把"搬 JSON 字段"换成"拷技能目录 + 哈希刷新"。

## 已知局限与未来方向

- 当前是单向镜像（agents → claude）。若用户在 AI Native Lab 里直接编辑镜像副本，源未变时保留、源再变则被覆盖。可接受，因为源（外部 CLI 装的）才是事实源。
- 更彻底的方向：未来若把市场安装统一收口到只写 `~/.claude/skills/`（或让内置 binary 也扫 `~/.agents/skills/`），镜像层就能退役。在 `skills` CLI 行为稳定前，镜像是最稳妥的兼容层。
- 这类"UI 读取面 ⊋ 内置 binary 读取面"的裂缝可能还会在别处出现（插件、agents、hooks 等）。值得有一个统一的"reconcile 到规范位置"心智模型，而不是每类配置各修一遍。
