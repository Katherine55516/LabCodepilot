# 内置 GSD（gsd-build/get-shit-done）

> 产品思考见 [docs/insights/gsd-bundle.md](../insights/gsd-bundle.md)

把 [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done)（MIT, archived 2026-05）作为 AI Native Lab 的"内置插件"随安装包发布：用户装完 → 启动 → 斜杠菜单立刻看到 67 个 `/gsd-*` 命令 + 33 个子 agent 可调用，零额外操作。

## 数据流

```
[源]                          [构建期]                       [运行时]
gsd-build/get-shit-done   →   scripts/vendor-gsd-prepare.js   →   resources/gsd-bundle/
@ commit 837114c1d0a4         平面化 + colon→hyphen 转换            (electron-builder extraResources)
vendor/gsd-source/            产出 vendor/gsd-bundle/
(直接复制快照)
                                                                         ↓ app.whenReady()
                                                                    electron/gsd-installer.ts
                                                                    版本戳对比 → 同步（异步非阻塞）
                                                                         ↓
                              ~/.claude/plugins/external_plugins/codepilot-gsd-vendor/
                              ├── commands/   gsd-debug.md ... (67 个 平面)
                              ├── agents/     gsd-debugger.md ... (33 个)
                              ├── plugin.json (元数据)
                              ├── VERSION     837114c1d0a4-v1
                              ├── LICENSE     (MIT)
                              ├── .conflicts.json (镜像冲突日志, 可选)
                              └── .disabled (标记, 用户禁用时存在)

                              + 并行镜像到 ~/.claude/agents/gsd-*.md
                                  (hash 不同 → 跳过 + 记 conflict)
                                                                         ↓
                              src/app/api/skills/route.ts:33-75 getPluginCommandsDirs
                              自动扫描插件 commands/ → 斜杠菜单出现 /gsd-debug 等
```

## 目录结构与关键文件

```
D:\CodePilot-main\
├── vendor/                                # 不入产物
│   ├── .gitignore                         # 忽略 gsd-bundle/
│   ├── gsd-source/                        # 固定快照（已入仓库）
│   │   ├── commands/gsd/*.md              # 67 个原始命令（colon 形式 frontmatter）
│   │   ├── agents/gsd-*.md                # 33 个原始子 agent
│   │   ├── LICENSE                        # MIT
│   │   └── SNAPSHOT.md                    # 来源 commit + 升级流程
│   └── gsd-bundle/                        # 构建期产物，不入库（vendor/.gitignore）
│       ├── commands/gsd-*.md              # 67 个平面 + hyphen 化
│       ├── agents/gsd-*.md                # 33 个 + 内容里 colon→hyphen
│       ├── plugin.json                    # 元数据 manifest
│       ├── VERSION                        # "<commit-short>-v<transformVersion>"
│       ├── LICENSE                        # 复制自 source
│       └── transform-report.json          # 构建调试日志（运行时不部署）
│
├── scripts/
│   ├── vendor-gsd-prepare.js              # 转换脚本（生成 vendor/gsd-bundle/）
│   └── vendor-gsd-verify.js               # 产物完整性校验
│
├── electron/
│   ├── gsd-installer.ts                   # 主进程同步逻辑 + IPC handler
│   ├── main.ts                            # app.whenReady() 内异步 install + registerGsdIpc
│   └── preload.ts                         # 暴露 window.electronAPI.gsd
│
├── electron-builder.yml                   # extraResources 加 vendor/gsd-bundle/ → resources/gsd-bundle/
│
├── src/
│   ├── app/api/skills/route.ts            # 顺手修复：frontmatter description 优先（普惠改进）
│   ├── components/settings/
│   │   ├── PluginsManager.tsx             # 新设的 Plugins tab 主容器
│   │   └── SettingsLayout.tsx             # 注册 "plugins" Section 和 sidebar
│   ├── types/electron.d.ts                # GsdInstallStatus + ElectronGsdAPI 类型
│   └── i18n/en.ts, zh.ts                  # settings.gsd.* + settings.plugins.* keys（双语）
│
├── src/__tests__/unit/
│   └── gsd-installer.test.ts              # 19 个测试用例
│
├── package.json                           # 新增 vendor:gsd / vendor:gsd:verify scripts
│
└── docs/
    ├── handover/gsd-bundle.md             # 本文件
    ├── insights/gsd-bundle.md
    └── exec-plans/completed/gsd-bundle.md
```

## 关键设计决策

### 为什么选原始归档版而非 Redux

用户指定 `gsd-build/get-shit-done`。原始版用 `commands/*.md` + `agents/*.md` 双目录结构，与 AI Native Lab 扫描器的"plugins/*/commands/" 约定（[`src/app/api/skills/route.ts:33-75`](../../src/app/api/skills/route.ts)）完美契合，无需引入 SKILL.md 模式。Redux 用层级 skill 路由，需要更多胶水代码。

### 为什么文件名要平面化 + colon→hyphen 转换

AI Native Lab 扫描器看到子目录会拼成 colon 形式（`commands/gsd/debug.md` → `/gsd:debug`），但 GSD 在 Claude Code 上的官方命令是 hyphen 形式（`/gsd-debug`）。要让命令呈现一致，必须把所有 `.md` 文件平铺到 `commands/` 顶层并改名为 `gsd-<base>.md`。同时把文件内所有 `\bgsd:[a-z][a-z0-9-]*\b` 替换为 hyphen 形式（98 + 96 处替换），与 GSD 官方 installer 在 Claude Code 上的行为一致。

### 为什么 6 个 ns-* 文件按 frontmatter 重命名

GSD v1.40+ 引入了 6 个 namespace meta-skill router 文件，文件名是 `ns-context.md` 但 frontmatter `name: gsd-context`。GSD 设计意图是让用户输入 `/gsd-context`（按 frontmatter），不是 `/gsd-ns-context`（按文件名）。转换脚本读 frontmatter `name` 字段，若与默认推断（`gsd-<filestem>`）不同，按 frontmatter 重命名：

| 源文件 | bundle 文件 |
|---|---|
| `ns-context.md` | `gsd-context.md` |
| `ns-ideate.md` | `gsd-ideate.md` |
| `ns-manage.md` | `gsd-manage.md` |
| `ns-project.md` | `gsd-project.md` |
| `ns-review.md` | `gsd-quality.md` |
| `ns-workflow.md` | `gsd-workflow.md` |

校验脚本会断言所有命令文件的 frontmatter `name` 与文件名一致，防止再次出现 mismatch。

### 为什么 agents 要同时放两个位置

- **插件目录 `<install>/agents/`**：作为插件资产的一部分，方便卸载时整体清理。AI Native Lab 扫描器不读这个目录（它只看 `commands/`）。
- **`~/.claude/agents/gsd-*.md`（镜像）**：Claude Code 的 subagent 解析器的硬约定位置。命令文件里出现 `Spawn gsd-debugger agent` 时，Claude 的 Agent 工具查找名为 `gsd-debugger` 的 subagent，必须在 `~/.claude/agents/` 才能找到。

镜像采用 hash 比对策略：目标不存在 → 直接写；hash 相同 → 跳过；hash 不同 → 跳过 + 记 conflict（写到 `<install>/.conflicts.json` 持久化，Settings UI 可显示给用户）。这样用户已装的官方 GSD agent 文件或本地修改不会被覆盖。

### 为什么"两份都显示"的冲突策略

用户答 AskUserQuestion 时选择：和官方 GSD 共存。若用户手动装了官方 `~/.claude/commands/gsd-debug.md`，popover 会同时显示两条 `/gsd-debug`，分别带 `source: global` 和 `source: plugin`。Settings UI 在 conflict count > 0 时会显示警告条幅，提示用户检查。

### 同步时机

- **首次启动 + 版本变化时**：`electron/main.ts` 在 `app.whenReady()` 后 fire-and-forget 调用 `installGsdBundle()`。版本戳一致时直接返回，不阻塞主窗口。
- **手动**：Settings UI 的"立即重新同步"按钮调 `window.electronAPI.gsd.resync()`，强制全量同步。
- **禁用时**：写 `.disabled` 标记 + 将 `commands/` 重命名为 `commands.disabled/`（AI Native Lab 扫描器看不到，命令消失）。re-enable 时反操作并触发 sync。

## 关键 API

### 构建期

```bash
npm run vendor:gsd          # vendor/gsd-source/ → vendor/gsd-bundle/
npm run vendor:gsd:verify   # 校验 vendor/gsd-bundle/ 完整性
```

### 运行时（IPC）

通过 `window.electronAPI.gsd` 暴露：

```ts
type GsdInstallStatus = {
  enabled: boolean;
  installed: boolean;
  bundledVersion: string | null;
  installedVersion: string | null;
  needsSync: boolean;
  manifest: PluginManifest | null;
  installPath: string;
  agentsMirrorPath: string;
  conflicts: { agentName: string; reason: 'hash-mismatch'; targetPath: string }[];
  lastError?: string;
};

window.electronAPI.gsd.getStatus():  Promise<GsdInstallStatus>
window.electronAPI.gsd.install():    Promise<GsdInstallStatus>  // 只在版本不一致时同步
window.electronAPI.gsd.resync():     Promise<GsdInstallStatus>  // 强制同步
window.electronAPI.gsd.enable():     Promise<GsdInstallStatus>
window.electronAPI.gsd.disable():    Promise<GsdInstallStatus>
window.electronAPI.gsd.uninstall():  Promise<GsdInstallStatus>
```

IPC channel 命名空间：`gsd:status` / `gsd:install` / `gsd:resync` / `gsd:enable` / `gsd:disable` / `gsd:uninstall`。

## 顺手修复的扫描器普惠改进

[`src/app/api/skills/route.ts:scanDirectory`](../../src/app/api/skills/route.ts) 原本只把 `.md` 文件第一行作为 description。对于带 YAML frontmatter 的命令（GSD 和大多数现代 Claude Code 命令），第一行是 `---`，会显示为无意义的分隔符。修复后：
1. 优先读 frontmatter `description:` 字段
2. 否则去掉 frontmatter 块后取首个非空行
3. 否则 fallback 占位符

对所有带 frontmatter 的 .md 命令（不限 GSD）都是普惠改进。

## 测试覆盖

`src/__tests__/unit/gsd-installer.test.ts` — 19 用例，8 个 suite：
- bundle metadata（manifest + VERSION 读取）
- 首次 install（创建目录、文件计数 67/33、ns 重命名、agent 镜像）
- 版本幂等性（一致时无写入、resync 强制覆盖、mismatch 触发同步）
- extras 保留（用户在 `extras/` 加的文件不被同步覆盖）
- agents 镜像冲突（hash 匹配跳过、不同记 conflict、用户改动不被覆盖）
- disable / enable（commands → commands.disabled、`.disabled` 标记、install no-op）
- uninstall（删插件目录、删 hash 匹配的镜像 agent、保留用户改过的）
- getStatus（installed/needsSync/enabled 推断）

运行：`npx tsx --test src/__tests__/unit/gsd-installer.test.ts`

## API 端到端验证

dev 模式（手动 mirror 后 `npx next dev`）+ `curl http://localhost:3055/api/skills`：返回 67 个 `gsd-*` 命令，`source: plugin`, `kind: slash_command`，description 字段是真实的命令说明（修复后）。

## 升级 GSD 源的流程

1. `git clone --depth=1 https://github.com/gsd-build/get-shit-done.git /tmp/gsd-clone`
2. 删 `vendor/gsd-source/commands/gsd/`、`vendor/gsd-source/agents/`
3. 复制最新 `commands/gsd/` 和 `agents/` 到 `vendor/gsd-source/`
4. 复制最新 `LICENSE`
5. 更新 `vendor/gsd-source/SNAPSHOT.md` 的 Commit + Date
6. `npm run vendor:gsd && npm run vendor:gsd:verify`
7. `npm run test`
8. CDP 验证 dev 模式
9. commit + （由维护者人工决定）发版

## 已知限制

- **冲突日志只在 sync 时更新**：若用户手动改了 `~/.claude/agents/gsd-debugger.md` 但没触发 sync，UI 不会看到新的 conflict——直到下一次 install/resync 才检测到。
- **没有自动升级 GSD**：依赖 AI Native Lab 主程序发版时一并 bump。GSD 官方仓库已归档，预期变化不频繁，可接受。
- **打包验证未做**：本次开发未在本地实际打 DMG/NSIS（耗时较高）。CI 上的 electron-builder 流程未变（只是新增了 extraResources），破坏面有限，但首次发版需人工验证一次。

## 与其他模块的边界

- **不修改 Claude Agent SDK**：复用其默认的 `~/.claude/agents/` subagent 解析约定
- **不修改命令扫描器主体**：仅做 description 解析的小改进
- **不修改 Settings 持久化**：插件状态完全靠文件系统状态（`.disabled`/`VERSION`/`.conflicts.json`）推断
- **不影响打包大小重要**：vendor/gsd-bundle ~1.9MB，打包后增量类似
