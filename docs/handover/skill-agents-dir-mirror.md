# Skill 目录镜像（`~/.agents/skills/` → `~/.claude/skills/`）—— 技术交接

> 产品思考见 [docs/insights/skill-agents-dir-mirror.md](../insights/skill-agents-dir-mirror.md)
> 相关：内置 Claude Code 架构见 [builtin-claude-code.md](./builtin-claude-code.md)；同类问题的 MCP 修复见 commit `46caccd` + [mcp-loader.ts](../../src/lib/mcp-loader.ts) 底部说明

## 解决的问题

内置 Claude Code 二进制发现 user-scope 技能**只扫 `~/.claude/skills/`**（+ 项目 `.claude/skills/` + 插件）。但 `skills` CLI（skills.sh / vercel-labs）可能把技能装进 agent-中立的 `~/.agents/skills/`。

后果：AI Native Lab 自己的发现层（[skill-discovery.ts](../../src/lib/skill-discovery.ts)、[api/skills/route.ts](../../src/app/api/skills/route.ts)）同时扫两个目录，所以斜杠面板**能列出**该技能；但 agent 实际是内置 Claude Code，加载不到 `~/.agents/skills/`，于是报"找不到该 skill"。

> 这与已修复的 MCP 问题（`46caccd`）**是同一类**：AI Native Lab UI 读的是位置超集，内置 binary 只读其中一个规范位置，导致"UI 显示已配置/已安装，但 agent 用不了"。

## 核心机制

[skill-reconcile.ts](../../src/lib/skill-reconcile.ts) 把 `~/.agents/skills/<name>/` **复制**进 `~/.claude/skills/<name>/`，让内置 binary 原生加载（渐进披露、Skill 工具、系统提示技能清单全部自动生效）。

**复制而非搬移**（与 MCP 迁移的唯一不同）：`~/.agents/skills/` 是外部 `skills` CLI 的合法安装位，由 `~/.agents/.skill-lock.json` 跟踪。搬移会让该 CLI 的 lock 与磁盘失配，破坏 `skills update/remove`。所以保留源，并给副本打标记以便后续刷新/清理时绝不误伤外部技能。

### 标记与冲突策略

每个镜像目录写入 `.codepilot-mirror.json`（dotfile，两侧扫描器都忽略），记录源文件夹哈希：

```json
{ "source": "agents", "sourceHash": "<sha1>", "mirroredAt": "<iso>" }
```

每次 reconcile 对每个 `~/.agents/skills/<name>`：

| dst（`~/.claude/skills/<name>`）状态 | 动作 | 结果字段 |
|---|---|---|
| 不存在 | 复制 + 写标记 | `mirrored` |
| 有**我们的**标记，源哈希变了 | 重新复制 | `refreshed` |
| 有**我们的**标记，源哈希一致 | 跳过 | —（no-op） |
| 无标记（外部/直接 `--agent claude-code` 装的/用户自建） | 不动，`~/.claude/skills/` 胜 | `skipped` |
| 有**我们的**标记但源已删除 | 删除孤儿镜像 | `removed` |

- **源文件夹哈希**：递归对所有文件（路径 + 内容 sha1，排序，排除标记本身）求哈希，所以改 SKILL.md **或**任意资源文件都会触发 refresh。
- **冲突时 `~/.claude/skills/` 胜**（对齐 MCP 的"`.claude.json` 胜"）：无标记的同名技能永不被覆盖。
- **原子写**：复制到 `claudeDir/.<name>.codepilot-tmp-<pid>-<ts>` → 写标记 → 删旧 dst → rename。失败清理 temp 并保留现状，等下次重试。
- **孤儿清理只动带我们标记的目录**，外部技能即使源不存在也绝不删除。

## API

```ts
// 核心：未缓存、幂等、可重入。测试直接调它。
reconcileAgentsSkillsToClaudeSkills(): SkillReconcileResult
// 热路径用：15s TTL 缓存包装
reconcileSkillsCached(): SkillReconcileResult
// 强制下次 cached 调用穿透（安装/卸载后调用）
invalidateSkillReconcileCache(): void
```

`SkillReconcileResult = { mirrored, refreshed, removed, skipped: string[]; changed: boolean; error? }`。`changed` 为真时会调用 `invalidateSkillCache()`（[skill-discovery.ts](../../src/lib/skill-discovery.ts)）让原生 Skill 工具的缓存也刷新。

## 调用点

| 位置 | 调用 | 目的 |
|---|---|---|
| [instrumentation.ts](../../src/instrumentation.ts) `register()` | `reconcileAgentsSkillsToClaudeSkills()` | 冷启动一次，任何会话前修好历史孤儿 |
| [claude-client.ts](../../src/lib/claude-client.ts) `streamClaudeSdk()`（query 前） | `reconcileSkillsCached()` | 保证 agent 每轮都看到已 reconcile 的技能 |
| [api/skills/route.ts](../../src/app/api/skills/route.ts) `GET` | `reconcileSkillsCached()` | UI 列表与 agent 可加载集保持一致 |
| [marketplace/install/route.ts](../../src/app/api/skills/marketplace/install/route.ts) 成功 close | invalidate + `reconcile…()` | 市场装完无需重启即可用 |
| [marketplace/remove/route.ts](../../src/app/api/skills/marketplace/remove/route.ts) 成功 close | invalidate + `reconcile…()` | 卸载后同步删除镜像 |

均为动态 import + try/catch 包裹，失败不影响主流程（避免循环依赖、降级安全）。

## 测试

[skill-reconcile.test.ts](../../src/__tests__/unit/skill-reconcile.test.ts)（10 例，全过）：复制/源保留/标记、可重入 no-op、SKILL.md 变更刷新、资源文件变更刷新、无标记同名跳过、孤儿删除、外部技能永不删、自动建 `~/.claude/skills/`、忽略无 SKILL.md 的目录、`~/.agents/skills/` 不存在时 no-op。结构对照 [mcp-settings-migration.test.ts](../../src/__tests__/unit/mcp-settings-migration.test.ts)（temp HOME + USERPROFILE override）。

## 已知局限

- 用户在 AI Native Lab 技能编辑器里**直接改镜像副本**而源未变时，副本编辑保留；但若源随后变更，refresh 会覆盖该编辑（源是事实源）。属罕见路径。
- 仅哈希文件内容，不跟踪文件权限位（chmod）；技能脚本可执行位在 Windows 上无意义，在 mac/linux 上由 SKILL.md 调用方式决定，目前未发现问题。
