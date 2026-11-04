# 内置 AI_LabTest（qitianersheng/ai-lab-test-agent）

> 产品思考见 [docs/insights/ailab-plugin.md](../insights/ailab-plugin.md)

把 [qitianersheng/ai-lab-test-agent](https://github.com/qitianersheng/ai-lab-test-agent)（插件 `ai-lab-test` v0.14.0, MIT）作为 CodePilot 的"内置插件"随安装包发布。形态参照 [内置 GSD](./gsd-bundle.md) 的 vendor 流水线，但因插件结构不同有若干关键差异（命名空间、资产路径占位符、默认关闭、Playwright MCP）。

用户在 **设置 → 插件** 看到一张 AI_LabTest 卡片,**默认关闭**;拨动开关启用后,选择器立刻出现 `ai-lab-test:*` 6 个命令 + `test-workflow` 技能,且 `playwright` MCP 自动注册,`ai-lab-test:execute` 可直接驱动浏览器。

## 数据流

```
[源]                              [构建期]                          [运行时]
qitianersheng/ai-lab-test-agent → scripts/vendor-ailab-prepare.js → resources/ailab-bundle/
@ commit bab7b0dcccee              逐字拷贝(不平面化/不改写)            (electron-builder extraResources)
插件根 ai-lab-test/                生成 plugin.json(builtIn:true)            │
  vendor/ailab-source/(提交快照)   VERSION / LICENSE                         ▼
                                   ↓                              electron/ailab-installer.ts (开机 fire-and-forget)
                                   vendor/ailab-bundle/(gitignore)   ├─ 插件目录全量同步(owns)
                                   npm run vendor:ailab[:verify]      │   ~/.claude/plugins/external_plugins/codepilot-ailab-vendor/
                                                                     ├─ [启用时] 命令镜像 → ~/.claude/commands/ai-lab-test/<stem>.md
                                                                     └─ [启用时] 技能镜像 → ~/.claude/skills/test-workflow/SKILL.md
                                                                         (镜像时把 ${CLAUDE_PLUGIN_ROOT} 改写为插件目录绝对路径)
```

## 与 GSD 的关键差异

> GSD 内置插件已于 v4.3.0 下线（见 [gsd-removal.md](./gsd-removal.md)）。下表保留为设计理据：
> AI_LabTest 的这些选择正是对照 GSD 做出的，其中「默认关闭」「停用真删」两条事后被证明更经得起检验。


| 维度 | GSD | AI_LabTest |
|------|-----|-----------|
| 命名空间 | 平面化 `commands/gsd/x.md` → `gsd-x.md`,出 `/gsd-x` | **不平面化**:命令镜像进 `~/.claude/commands/ai-lab-test/` **子目录**,扫描器以 `<subdir>:<stem>` 命名 → `ai-lab-test:cases` |
| 文本改写 | 全文 `gsd:` → `gsd-`(冒号→连字符) | **`${CLAUDE_PLUGIN_ROOT}` → 插件目录绝对路径**(见下),在 installer 镜像时做,不在 prepare 做 |
| 资产 | `get-shit-done/` 镜像到 `~/.claude/get-shit-done/`,命令用 `@~/.claude/...` 引用 | 资产(`rules/`/`templates/`/`site-patterns/`)只放在插件目录,命令/技能用 `${CLAUDE_PLUGIN_ROOT}/rules/...` 引用 → 镜像时改写为该目录绝对路径 |
| 默认状态 | 默认**开启**(开机即镜像) | 默认**关闭**(首装写 `.disabled`,用户手动启用) |
| 停用 | 仅 rename 插件内 `commands/` → `commands.disabled/`,**全局镜像保留** | **rmrf 全局命名空间目录**(`commands/ai-lab-test/` + `skills/test-workflow/`),命令/技能真正消失 |
| 子 agent | 镜像 `agents/*.md` → `~/.claude/agents/` | 无 agents |
| MCP | 无 | 启用时由前端卡片注册 `playwright` MCP(见下) |

### 为什么必须改写 `${CLAUDE_PLUGIN_ROOT}`

命令/技能正文用 `用 Read 工具读取 ${CLAUDE_PLUGIN_ROOT}/rules/test-execution.md` 这种**祈使式**引用(非 `@`-import)。`${CLAUDE_PLUGIN_ROOT}` 仅在插件被 SDK 真正加载时由运行时注入;而本仓库用的是"全局镜像"策略(命令以 `source='global'` 写入 `~/.claude/commands/`,绕过 provider 作用域的 SDK 能力缓存,见 [gsd-bundle.md](./gsd-bundle.md) 同款原因),镜像副本没有 plugin root。

因此 `electron/ailab-installer.ts` 在**镜像时**把 `${CLAUDE_PLUGIN_ROOT}` 整体替换为本机插件目录绝对路径(`os.homedir()` 安装时已知,可移植):
`${CLAUDE_PLUGIN_ROOT}/rules/x.md` → `<home>/.claude/plugins/external_plugins/codepilot-ailab-vendor/rules/x.md`。
资产随插件目录全量同步,改写后的绝对路径在磁盘上真实存在,模型 Read 即得。插件目录内的命令副本**保留** `${CLAUDE_PLUGIN_ROOT}` 原文(若将来被 SDK 原生加载仍可解析)。

## 安装生命周期(`electron/ailab-installer.ts`)

状态从磁盘派生:`enabled = installed && !exists(.disabled)`。

- **install(opts)**(开机 fire-and-forget 调用):
  - 已安装且 `.disabled` 且非 `enableOnInstall` → 短路,并防御性 rmrf 命名空间目录(确保停用即消失)。
  - **首次安装**(目录不存在)且非 `enableOnInstall` → 同步插件目录 + 写 `VERSION/plugin.json/LICENSE` + 写 `.disabled` + 不镜像 → **默认关闭**。
  - 已启用 → 版本漂移/force 时同步插件目录;每次启动(幂等)重建命名空间镜像(rmrf + 重写)。
- **enable(opts)** = `install({enableOnInstall:true})`:绕过默认关闭与 disabled 短路,删 `.disabled`,(重)建命令子目录 + 技能目录镜像。
- **disable(opts)**:写 `.disabled` + **rmrf** `~/.claude/commands/ai-lab-test/` 和 `~/.claude/skills/test-workflow/`(命名空间目录由 installer 独占,整目录删最干净)。**不**动 `playwright` MCP。
- **uninstall(opts)**:rmrf 插件目录 + 两个命名空间目录。

镜像采用 rmrf+重建(非 GSD 的 hash 保留),原因:命名空间子目录由 installer 独占,且能干净覆盖旧的 symlink 调试态(避免写穿软链改到源仓库)。

## 镜像目标

| 用途 | 路径 |
|------|------|
| 插件目录(独占,全量同步,`${CLAUDE_PLUGIN_ROOT}` 指向此处) | `~/.claude/plugins/external_plugins/codepilot-ailab-vendor/` |
| 命令镜像(命名空间) | `~/.claude/commands/ai-lab-test/{cases,execute,init,knowledge-map,report,status}.md` |
| 技能镜像(真实目录) | `~/.claude/skills/test-workflow/SKILL.md` |

`builtIn:true` 让 `/api/skills` 扫描器:① 把命令视为已加载、在弹窗常驻(绕过 `useSlashCommands.ts` 的 SDK 白名单);② 跳过插件目录自身的 `commands/`,避免与全局镜像重复列出(选择器条目来自全局子目录镜像)。

## Playwright MCP 接线

`.mcp.json`(`npx -y @playwright/mcp@latest --browser chromium`)随 bundle 携带,但**全局镜像不会自启 `.mcp.json`**。改由**前端卡片**在启用时注册:

`src/components/settings/PluginsManager.tsx` 的 `AilabPluginCard.handleToggle(true)`:
1. `await window.electronAPI.ailab.enable()`(IPC → 镜像命令/技能)
2. `ensurePlaywrightMcp()` → `POST /api/plugins/mcp`,body `{name:'playwright', server:{command:'npx', args:['-y','@playwright/mcp@latest','--browser','chromium'], type:'stdio'}}`(幂等:409 视为成功)。该 API 原子写 `~/.claude.json` 并 `invalidateMcpCache()`,即时生效。

服务名**必须**是 `playwright`:`src/lib/claude-client.ts` 把 `mcp__playwright` 硬编码进 `allowedTools` 自动批准,shadow-HOME 的 npx/缓存镜像(commit `4005415`/`51b79a7`)也按此名生效。停用时**不**删 MCP(通用、可能被别处用、空转无害);注册失败仅弹非阻断告警,命令仍可用。

## 关键文件

**新增**:`vendor/ailab-source/**`(提交快照)、`scripts/vendor-ailab-prepare.js`、`scripts/vendor-ailab-verify.js`、`electron/ailab-installer.ts`、`vendor/ailab-bundle/**`(gitignore 产物)。
**改动**:`package.json`(`vendor:ailab[:verify]` + 接进 `test`/`electron:build`)、`electron-builder.yml`(`from: vendor/ailab-bundle/ → to: ailab-bundle/`)、`electron/main.ts`(import + 开机块 + `registerAilabIpc`)、`electron/preload.ts`(`ailab` 桥)、`src/types/electron.d.ts`(`AilabInstallStatus`/`AilabPluginManifest`/`ElectronAilabAPI` + `ailab?`)、`src/components/settings/PluginsManager.tsx`(`AilabPluginCard` + `ensurePlaywrightMcp`)、`src/i18n/{en,zh,zh-HK}.ts`(`settings.ailab.*`)、`vendor/.gitignore`。

## IPC 通道

`ailab:status` / `ailab:install` / `ailab:resync` / `ailab:enable` / `ailab:disable` / `ailab:uninstall`(`registerAilabIpc`,`electron/main.ts` 开机注册;`electron/preload.ts` 经 `window.electronAPI.ailab` 暴露)。

## 自检 / 验证

- `npm run vendor:ailab && npm run vendor:ailab:verify` — 生成并校验 bundle(命令 stem、技能、rules×5、templates×5、`.mcp.json` 含 playwright、`plugin.json` builtIn/commandPrefix、VERSION 格式、LICENSE)。
- `npm run test` 已含 `vendor:ailab`;`electron:build` 已含 `vendor:ailab:verify`。
- installer 纯 `fs`,可用临时 HOME 跑全生命周期自测(install 默认关闭 → enable 建镜像 + 校验 `${CLAUDE_PLUGIN_ROOT}` 改写落地 → disable rmrf → uninstall)。
- UI:`PluginsManager` 卡片读 `window.electronAPI.ailab`(仅 Electron 有);浏览器 `npm run dev` 下注入 mock `electronAPI.ailab` + 拦截 `/api/plugins/mcp` 后,可经 CDP 验证两态渲染与开关交互(本仓库 worktree 下 Turbopack 误判 workspace root,用 `next dev --webpack` 起 dev)。

## 已知边界

- 旧的 symlink 调试态(`~/.claude/commands/ai-lab-test/` 软链 + `~/.claude/skills/test-workflow/` 软链,见 [debug-third-party-plugin](../../README.md) 记忆)会被首启的 installer rmrf 覆盖为真实文件(软链只删链不动源)。
- Playwright 浏览器冷启:shadow-HOME 仅**保留**已存在的 `~/.npm` 与 `ms-playwright` 缓存,首次冷机仍可能触发 npx 下载/`playwright install chromium`;若 `execute` 报 "Browser is not installed",需预热一次。
