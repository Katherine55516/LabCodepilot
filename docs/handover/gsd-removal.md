# 内置 GSD 下线与残留清理

> 产品思考见 [docs/insights/gsd-removal.md](../insights/gsd-removal.md)
> 被下线的模块见 [docs/handover/gsd-bundle.md](./gsd-bundle.md)（已归档）

把内置 GSD 插件从应用中彻底移除，并在升级后自动清理历史版本写进用户 `~/.claude/` 的 399 个镜像文件——全程零用户操作。

## 为什么删代码不够

历史版本的 installer 不只把插件装进插件目录，还把命令、subagent、资源三类文件**镜像**进了用户的全局 `~/.claude/`：

| 落地位置 | 数量 | 谁在读 |
|---|---|---|
| `~/.claude/commands/gsd-*.md` | 67 | Claude Code 直接读盘（斜杠命令） |
| `~/.claude/agents/gsd-*.md` | 33 | Claude Code 直接读盘（subagent 解析） |
| `~/.claude/get-shit-done/**` | 299 | 命令正文的 `@~/.claude/get-shit-done/...` import |
| `…/external_plugins/codepilot-gsd-vendor/` | 404 | 应用独占 |

前三类由 Claude Code 从磁盘直接加载，**与应用是否还带这个插件无关**。只删应用代码，这 399 个文件会永久留在用户盘上，`/gsd-*` 继续占据斜杠菜单，命令与 agent 的 frontmatter description 继续进系统提示词（实测约 3,644 tokens 常驻开销）。因此下线版本必须带一次主动清理。

## 数据流

```
[构建期]                                    [运行时·首次启动]
vendor/gsd-purge-manifest.json         →    electron/gsd-purge.ts::purge()
  399 条 path → sha1（静态产物，随库提交）        ↓
       ↓ electron-builder extraResources          按四类目标分策略删除
  resources/gsd-purge-manifest.json              ↓
                                            ~/.codepilot/.gsd-purged（幂等标记）
```

`purge()` 在 `app.whenReady()` 里 fire-and-forget 调用（`electron/main.ts`），不阻塞窗口。

## 清理策略：四类目标，两种识别模式

这是本模块唯一需要理解的设计。核心矛盾是：**既要把老版本、被用户改过的文件也清干净，又不能误删用户自己安装的官方 GSD。**

| 目标 | 能否唯一识别为「我们的」 | 策略 |
|---|---|---|
| 插件目录 `codepilot-gsd-vendor/` | 能——`codepilot-` 前缀 | 无条件整目录删除 |
| `~/.claude/commands/gsd-*.md`（平铺） | 能——见下 | 无条件按名删除 |
| `~/.claude/agents/gsd-*.md` | 否——官方同名 | 无官方安装→按清单**路径**删；有→只删**哈希**精确匹配 |
| `~/.claude/get-shit-done/**` | 否——官方同路径 | 同上，删完自底向上递归清理空目录 |

**平铺命令为什么是唯一可识别的**：官方 GSD 的命令在源码里位于 `commands/gsd/*.md` 子目录，安装后是 `~/.claude/commands/gsd/`，命名空间为 `/gsd:x`（这一点在 GSD 自己的 installer 代码里以 `path.join('.claude','commands','gsd')` 形式确认过）。而本仓的 vendor 流水线把它们**拍平**成了 `gsd-x.md`，出 `/gsd-x`。平铺形态是我们独有的产物。

**为什么用路径成员而不是只用哈希**：vendor 流水线在 2026-05-26 09:44–14:04 这四小时二十分内连出了 v1/v2/v3 三代转换（`TRANSFORM_VERSION` 1→2→3）。而旧 installer 的 `applyFileMirror` 在哈希不匹配时**只记冲突、不覆写**——所以在那个窗口装机的用户，其文件内容至今仍停在 v1/v2，后续任何版本更新都没有纠正过。手动改过命令的用户同理。纯哈希匹配会把这两类永久留在盘上。

### 官方安装的判定信号

两条，都取自 GSD 自身代码，且都不是本仓流水线产物：

- `~/.claude/commands/gsd/` 是目录（官方命令命名空间）
- `~/.claude/get-shit-done/skills/` 是目录（官方独有子树；本仓 bundle 的 `get-shit-done/` 只含 `bin` `contexts` `references` `templates` `workflows`）

任一命中即降级为哈希精确删除。

## 关键实现细节

- **递归清空目录**：旧 installer 的 `cleanupMirrorTree` 只对根目录尝试一次 `rmdir`，会留下 `get-shit-done/` 那 18 个目录（最深三层，如 `bin/lib/installer-migrations`）的空壳。`pruneEmptyDirs()` 自底向上删，实测清掉 17–18 个。
- **幂等标记写在最后，且只在零错误时写**：`~/.codepilot/.gsd-purged`。有错误就不写，下次启动自动重试。清单读不到时同样不写标记也不删任何东西——万一某个构建漏打包了清单，修好的版本仍会补做。
- **不在清单里的路径一律保留**：`get-shit-done/USER-PROFILE.md` 是 GSD 运行时产物（`/gsd-profile-user` 写的），属用户数据，不删。目录只清空壳。

## 故意不清理的东西

| 对象 | 理由 |
|---|---|
| 用户项目里的 `.planning/` | GSD 的逐项目产出，是用户数据，且不在 `~/.claude` 内 |
| `~/.claude.json` 的 `skillUsage.gsd-*` | Claude Code 自己的配置文件，由它并发写入；读改写有把无关状态写坏的风险。那几十字节是惰性计数，不进上下文也不进菜单 |
| 用户自装的官方 GSD | 见上文判定信号 |

## 移除清单

**代码**：`electron/gsd-installer.ts`（installer + 6 个 `gsd:*` IPC）、`src/i18n/gsd-command-descriptions.ts`（67 条中文描述）、`src/__tests__/unit/gsd-installer.test.ts`、`PluginsManager.tsx` 的 `GsdPluginCard`、`SlashCommandPopover.tsx` 的硬编码描述覆盖分支、`electron.d.ts` 的四个 GSD 类型、三份语言各 26 条 `settings.gsd.*`。

**构建链**：`scripts/vendor-gsd-prepare.js`、`scripts/vendor-gsd-verify.js`、`package.json` 的 `vendor:gsd` / `vendor:gsd:verify`（并从 `test` 与 `electron:build` 链上摘除）、`electron-builder.yml` 的 `vendor/gsd-bundle/` extraResources 条目、`vendor/gsd-source/`（401 文件 / 4.5 MB）、`vendor/.gitignore` 的 gsd-bundle 两行。

**共享基础设施保留未动**：`src/app/api/skills/route.ts` 的插件扫描、`useSlashCommands.ts` 的 `builtInPlugin` 豁免、`types/index.ts` 的 `builtInPlugin` 字段、`SettingsLayout.tsx` 的 plugins section——AI_LabTest 全部依赖它们。

## 两个顺序陷阱

1. **`PluginsManager.tsx` 的 `StatusBadge` 是 GSD 与 AI_LabTest 共用的组件，却引用 `settings.gsd.status.*`。** 必须先把它改指向 `settings.ailab.status.*`（三语已存在、此前无人使用），再删 GSD 卡片与 i18n 词条，否则 AI_LabTest 卡片的徽章会因缺 key 挂掉。
2. **`src/__tests__/unit/gsd-installer.test.ts` 必须与 vendor 脚本同批删除。** CI 跑的是 `test:unit` 而非 `test`，而该测试的 `before()` 会 `execFileSync` 自举调用 `vendor-gsd-prepare.js`。先删脚本会让 CI 与 `.husky/pre-commit` 同时变红。

另有一条不属顺序但同样静默：**`electron-builder.yml` 的 extraResources 对不存在的 `from` 是静默跳过，不报错**。清单路径写错不会有任何告警，只会让老用户永远清不干净。

## 清单文件

`vendor/gsd-purge-manifest.json`（30.9 KB，随库提交）由当时的 `vendor/gsd-bundle/transform-report.json` 一次性导出，含 67 命令 + 33 agent + 299 资源的 sha1。**GSD 源快照与转换流水线已随本次下线移除，此文件无法重新生成，请勿删除。**

## 验证

单测 `src/__tests__/unit/gsd-purge.test.ts`（19 例）覆盖四种用户形态、幂等、清单缺失、无关文件保护、`pruneEmptyDirs` 深度优先。

真实数据验证用备份出的 803 个真实落地文件跑了三轮：

| 场景 | 结果 |
|---|---|
| v3 正常用户 | 399/399 清除，17 个空目录清理，无关命令与 `USER-PROFILE.md` 保留 |
| v1/v2 + 手改用户（33 agent 全篡改 + 半数资源篡改） | 399/399 清除，18 个空目录清理，零残留 |
| 另装官方 GSD | 我们的 67 命令与插件目录清除；官方命名空间命令、skills 子树、33 个新版 agent 全部保留 |

## 未来

`purge()` 与清单合计约 120 行 + 30.9 KB，**建议保留 2–3 个版本再删**。否则从 4.2.0 直接跳到更高版本的用户永远清不掉残留。删除时连同 `vendor/gsd-purge-manifest.json`、`electron/gsd-purge.ts`、其单测和 `electron-builder.yml` 的 extraResources 条目一起移除。
