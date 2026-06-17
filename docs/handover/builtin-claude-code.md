# Built-in Claude Code（内置 Claude Code）—— 技术交接

> 产品思考见 [docs/insights/builtin-claude-code.md](../insights/builtin-claude-code.md)
> 执行计划见 [docs/exec-plans/active/agent-sdk-0-2-141-upgrade.md](../exec-plans/active/agent-sdk-0-2-141-upgrade.md)

## 总览

v0.55 起 AI Native Lab 把 Claude Code 原生二进制内置到安装包，用户安装应用即可使用完整功能，不再需要单独 `npm install -g @anthropic-ai/claude-code` 或 `curl install.sh | bash`。

技术机制：`@anthropic-ai/claude-agent-sdk` 0.2.120 起采用**主包 + 8 个平台子包**架构（同 esbuild / sharp 模式）。`npm install` 时按 `os` × `cpu` 自动装当前平台对应的 `@anthropic-ai/claude-agent-sdk-<platform>-<arch>` optional dependency，子包内含 ~230MB 的 Bun-编译 self-contained native binary（`claude` / `claude.exe`）。SDK 主包内部通过 `require.resolve('@anthropic-ai/claude-agent-sdk-<platform>-<arch>')` 自动发现 binary 并 spawn。AI Native Lab 不再覆盖 `pathToClaudeCodeExecutable`，SDK 默认行为接管。

## 关键文件

### 运行时
- **`src/lib/claude-client.ts`** — SDK 调用入口。删除了 `findClaudeBinary` 体系、`resolveScriptFromCmd`、`pathToClaudeCodeExecutable` 覆盖逻辑。`invalidateClaudeClientCache()` 保留为 no-op 兼容 API route 调用方
- **`src/lib/runtime/registry.ts`** — `resolveRuntime()` 简化：`cli_enabled=false` → native（应急），其他全部 → SDK runtime。`predictNativeRuntime()` 同步简化
- **`src/lib/runtime/sdk-runtime.ts`** — `isAvailable()` 永远 true
- **`src/lib/runtime/legacy.ts`** — `resolveLegacyRuntimeForDisplay()` 不再依赖 `cliConnected`，legacy `auto` / null / unknown 全部 → `claude-code-sdk`
- **`src/lib/provider-doctor.ts`** — `runCliProbe()` 改为读 SDK package.json 的 `claudeCodeVersion` 字段做内置版本校验；live probe 不再设 `pathToClaudeCodeExecutable`

### API 路由
- **`src/app/api/claude-status/route.ts`** — 永远返回 `{ connected: true, bundled: true, version: '2.1.X (Claude Code, bundled)', ... }`。保留旧字段（`binaryPath`、`installType`、`otherInstalls`、`features`...）以兼容旧 UI
- **`src/app/api/claude-status/invalidate/route.ts`** — no-op，返回 `{ ok: true, deprecated: true }`
- **`src/app/api/claude-upgrade/route.ts`** — no-op stub，返回 `{ success: false, deprecated: true, message: '...use in-app updater' }`

### 打包
- **`electron-builder.yml`** — `asarUnpack` 增加 `**/@anthropic-ai/claude-agent-sdk-*/**`。原因：binary 必须从磁盘 spawn，asar 包内的文件不可执行
- **`scripts/after-pack.js`** — 在 better-sqlite3 处理之后新增 Step 4：递归找 platform 子包目录、chmod 755（macOS/Linux）、fail-fast 报错防止架构错装
- **`next.config.ts`** — `serverExternalPackages` 显式列出 8 个 platform 子包名（防止 Next.js bundle 时漏拷）
- **`.github/workflows/build.yml`** — macOS / Windows 在 `npm ci` 后增加跨架构子包安装步骤：
  - macOS (arm64 runner) 显式 `--force --os=darwin --cpu=x64` 装 darwin-x64 子包
  - Windows (x64 runner) 显式 `--force --os=win32 --cpu=arm64` 装 win32-arm64 子包

### UI
- **`src/components/setup/ClaudeCodeCard.tsx`** — 简化为「永远内置就绪」版本，移除冲突警告 / 卸载命令 / 重新检测 UI
- **`src/components/chat/RuntimeBadge.tsx`** — 不再 fetch `/api/claude-status` 判断 `cliConnected`；文案改为「内置原生二进制，开箱即用」
- **`src/i18n/{en,zh}.ts`** — `setup.claude.title` 去掉「(可选)」；`description` 改为「已随应用一同发布」；新增 `setup.claude.bundled` key

### 测试
- **`src/__tests__/unit/runtime-selection.test.ts`** — 期望从「auto + 没装 CLI → native」改为「auto → SDK（永远可用）」
- **`src/__tests__/unit/runtime-legacy.test.ts`** — `resolveLegacyRuntimeForDisplay('auto', false)` 期望从 `native` 改为 `claude-code-sdk`

## spawn 机制详解

SDK 默认 `executable: 'node'`，但**新架构下 SDK 内部根本不 spawn node**——它直接 spawn 平台子包的 native binary。验证方法：

```js
import { query } from '@anthropic-ai/claude-agent-sdk';
const iter = query({ prompt: 'hello', options: { /* no spawn override */ } });
for await (const msg of iter) { console.log(msg.type); break; }
```

子进程是 `claude.exe`（Windows）/ `claude`（mac/linux），不是 Node。原因：Bun 编译的 single-file executable 已经内置 Node-compat runtime。

## 跨架构打包

| 目标平台 | runner 架构 | 自动装 | 显式额外装 |
|---|---|---|---|
| macOS arm64 DMG | macos-latest (arm64) | `darwin-arm64` | — |
| macOS x64 DMG | macos-latest (arm64) | `darwin-arm64` | `darwin-x64` (CI workflow 显式) |
| Windows x64 NSIS | windows-latest (x64) | `win32-x64` | — |
| Windows arm64 NSIS | windows-latest (x64) | `win32-x64` | `win32-arm64` (CI workflow 显式) |
| Linux x64 | ubuntu-latest (x64) | `linux-x64` + `linux-x64-musl` | — |
| Linux arm64 | ubuntu-24.04-arm | `linux-arm64` + `linux-arm64-musl` | — |

`after-pack.js` 在 archived 写入时验证 binary 存在；如果对应架构子包没装会 throw `[afterPack] FATAL: No Claude Code native binary found for ...`，CI fail-fast 防止发布出残缺包。

## 版本管理

SDK 和 Claude Code 强耦合发版：`@anthropic-ai/claude-agent-sdk@0.2.X` ↔ `claudeCodeVersion: 2.1.X`（X 始终相等）。升级一行：

```bash
npm install @anthropic-ai/claude-agent-sdk@^0.2.X
npm run typecheck && npm run test
```

新版本会自动通过 lock 关系拉对应的 platform 子包。CI 上 `npm ci` 装当前架构子包，其他架构通过 workflow 的显式 install 步骤补齐。

## 应急 fallback：Native runtime

`cli_enabled=false` 时绕过 SDK 走 Native runtime（直连 Anthropic API，功能受限但不依赖 spawn）：

- 入口：Settings → Claude Code 卡片 → 关闭开关
- 适用：杀软拦截 spawn、企业 endpoint policy 禁子进程、用户偏好

Native runtime 自身代码完全保留（`src/lib/runtime/native-runtime.ts`），未删除。

## 已知技术债务（v0.55 引入）

见 [tech-debt-tracker.md](../exec-plans/tech-debt-tracker.md) 第 11、12 条：

1. **TodoWrite → Task tools 迁移**：SDK 0.2.136 起 deprecated，未来 0.3.x 切换。当前 11 个文件按 TodoWrite 事件解析，需要在升级前同时识别两套
2. **死代码清理**：`InstallWizard`、`ConnectionStatus` 的装机分支、`platform.ts` 的 `findClaudeBinary` 体系等约 200 行代码运行时永远走不到，待下一次清理 PR 删除

## 常见问题排查

**Q: 用户报「打开应用后无法发消息，CLI 找不到」**
A: 跑 `/api/claude-status` 看返回。如果不是 `connected: true, bundled: true`，说明 platform 子包没被打入安装包。检查 after-pack.js 输出有没有 `FATAL: No Claude Code native binary found`。

**Q: 用户的 macOS 用 Rosetta 跑应用，spawn 失败**
A: 检查 binary 架构是否匹配。`file /Applications/AI Native Lab.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-{arm64,x64}/claude` 看 Mach-O 架构是否对。

**Q: Windows 用户报杀软拦截**
A: 临时方案：用户在 Settings 关闭「使用内置 Claude Code」开关 → 降级到 Native runtime。长期方案：申请 EV cert 签名 + 提交 Microsoft Defender SmartScreen 报白。

**Q: 安装包从 ~150MB 暴涨到 ~350MB，用户能不能选择不带 CLI 的轻量版？**
A: 当前不支持。可以将其作为未来探索：CI 产出额外的 `lightweight.exe`（不含 platform 子包），强制 `cli_enabled=false`，UI 隐藏 SDK runtime 选项。
