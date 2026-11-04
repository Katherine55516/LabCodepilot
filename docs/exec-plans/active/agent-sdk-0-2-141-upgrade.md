# Claude Agent SDK 0.2.141 升级 + 内置 Claude Code

> 创建时间：2026-05-19
> 最后更新：2026-05-19
> 关联：[agent-sdk-0-2-111-adoption.md](./agent-sdk-0-2-111-adoption.md)（上次升级，0.2.62 → 0.2.111）
> 产品思考见 [docs/insights/builtin-claude-code.md](../../insights/builtin-claude-code.md)
> 技术交接见 [docs/handover/builtin-claude-code.md](../../handover/builtin-claude-code.md)

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | POC：Electron-as-Node spawn cli.js | ✅ 已完成 | 输出 `2.1.111 (Claude Code)`，无 GUI |
| Phase 0' | POC：SDK 自动发现 platform 子包 | ✅ 已完成 | 升 SDK 后无需 spawn hook |
| Phase 1 | 升级 SDK 0.2.111 → 0.2.141 | ✅ 已完成 | typecheck 全绿 |
| Phase 2 | spawn hook (sdk-spawn-hook.ts) | ✅ 已跳过 | 新架构 SDK 自动发现 binary，无需 hook |
| Phase 3 | claude-client.ts 清理 | ✅ 已完成 | 删除 `pathToClaudeCodeExecutable` 覆盖、`findClaudeBinary` 依赖 |
| Phase 4 | runtime registry / sdk-runtime / legacy 简化 | ✅ 已完成 | `isAvailable()` 永远 true；legacy 不再依赖 cliConnected |
| Phase 5 | 打包配置 | ✅ 已完成 | asarUnpack + next.config externals + after-pack 校验 + CI 跨架构 npm install |
| Phase 6 | UI + API 改造 | ✅ 已完成 | `/api/claude-status` 永远返回 connected:true；ClaudeCodeCard 重写；RuntimeBadge 文案更新 |
| Phase 7 | i18n 更新 | ✅ 已完成 | `setup.claude.*` 文案改「已内置」叙事 |
| Phase 8 | 测试 | ✅ 已完成 | runtime-selection + runtime-legacy 30/30 通过 |
| Phase 9 | provider-doctor 清理 | ✅ 已完成 | `runCliProbe` 改为「内置版本校验」；live probe 不再依赖 findClaudeBinary |
| Phase 10 | 文档 + RELEASE_NOTES | 🔄 进行中 | 本文档 + handover + insights + ARCHITECTURE 链接 |
| Phase 11 | E2E + 打包验证 | 📋 待开始 | POC-C 打包后 spawn 验证；CDP 验证 setup 流程 |

## 决策日志

- 2026-05-19: **走「最新版本 + 新架构」路径**，不回退到 0.2.115。
  - 触发：发现 0.2.120+ SDK 把 cli.js 从主包移到 8 个平台子包，每平台子包是 Bun 编译的 self-contained native binary（~230MB）。
  - 选择：用户确认接受 +200MB 安装包体积（VS Code/Cursor 同量级）。
  - 收益：拿到最新 Claude Code 2.1.141；spawn 链路更简单（直接 spawn binary，无 ELECTRON_RUN_AS_NODE，无 Node runtime 复杂度）；启动更快（Bun AOT ~200ms vs Node ~500ms-1s）。

- 2026-05-19: **完全移除「优先用户本地 CLI」逻辑**。
  - 触发：原方案保留高级用户开关，但用户决策为彻底简化。
  - 影响：`findClaudeBinary`、`findAllClaudeBinaries`、`classifyClaudePath`、`getClaudeCandidatePaths`、`getUpgradeCommand`、`isWingetInstall` 全部从运行时决策路径移除（保留在 platform.ts 作为死代码，待下次清理 PR 删除——见 tech-debt-tracker 第 12 条）。

- 2026-05-19: **保留 Native Runtime 作为 `cli_enabled=false` 应急 fallback**。
  - 触发：用户决策。
  - 适用场景：杀软拦截 spawn binary；企业 endpoint policy 禁止子进程；用户主动关闭 CLI。
  - 代码：`registry.ts` 的 Step 0 `cliDisabled` 检查保留。

- 2026-05-19: **InstallWizard / ConnectionStatus 装机引导分支保留为死代码**。
  - 触发：渐进式重构，避免一次性改动太多 UI 引入回归。
  - 机制：`/api/claude-status` 永远返回 `connected: true`，所有「未装」分支自然不被渲染。
  - 清理：tech-debt-tracker 第 12 条记录，下一次 cleanup PR 处理。

- 2026-05-19: **`/api/claude-upgrade` 和 `/api/claude-status/invalidate` 保留为 no-op stub**。
  - 触发：ConnectionStatus 和 CliSettingsSection 仍 fetch 这两个端点；改 route 比改所有调用方更安全。
  - 副作用：route 仍存在但永远返回友好 deprecation 提示。同样在 tech-debt-tracker 第 12 条标记。

## 详细设计

### 架构变化总览

**v0.54 之前（旧架构）**：
```
@anthropic-ai/claude-agent-sdk
├── sdk.mjs                  # 编程入口
├── cli.js (13.7 MB)         # Node 脚本（CLI 实现）
├── vendor/
│   ├── ripgrep/             # 6 平台二进制（每个 ~5MB）
│   └── audio-capture/       # 6 平台二进制
└── ...
```
AI Native Lab 通过 `pathToClaudeCodeExecutable = findClaudeBinary()` 强制走用户本地 CLI（npm/native installer/bun/homebrew），SDK 内置 cli.js 被「绕过」。没装 CLI 的用户被路由到功能受限的 Native runtime。

**v0.55+（新架构）**：
```
@anthropic-ai/claude-agent-sdk           # 主包（仅 JS 入口）
├── sdk.mjs
└── ... (no cli.js anymore)

@anthropic-ai/claude-agent-sdk-<platform>-<arch>   # 平台子包（optional dependency）
├── claude / claude.exe (~230 MB)        # Bun 编译的 self-contained native binary
└── package.json (os/cpu fields)
```
8 个平台子包：`darwin-arm64` / `darwin-x64` / `linux-arm64` / `linux-arm64-musl` / `linux-x64` / `linux-x64-musl` / `win32-arm64` / `win32-x64`。npm install 时只装当前 OS/arch 匹配的子包。

AI Native Lab **不再覆盖** `pathToClaudeCodeExecutable`，SDK 自动通过 `require.resolve('@anthropic-ai/claude-agent-sdk-<platform>-<arch>')` 找到内置 binary 并 spawn。

### 触及文件清单（17 个）

**新增（5）**：
- `scripts/poc-spawn-cli.mjs` — POC-A 验证（可删除）
- `scripts/poc-spawn-hook.mjs` — POC-B 验证（可删除）
- `docs/exec-plans/active/agent-sdk-0-2-141-upgrade.md` — 本文档
- `docs/handover/builtin-claude-code.md`
- `docs/insights/builtin-claude-code.md`

**修改（12）**：
- `package.json` — SDK `^0.2.111` → `^0.2.141`
- `next.config.ts` — 8 个 platform 子包加到 `serverExternalPackages`
- `electron-builder.yml` — `asarUnpack` 增加 `**/@anthropic-ai/claude-agent-sdk-*/**`
- `scripts/after-pack.js` — 校验+chmod 平台子包 binary，fail fast 防错装
- `.github/workflows/build.yml` — macOS / Windows job 增加跨架构子包安装步骤
- `src/lib/claude-client.ts` — 删除 `pathToClaudeCodeExecutable` 覆盖（2 处）和 `findClaudeBinary` import
- `src/lib/runtime/registry.ts` — `resolveRuntime` 永远走 SDK；`predictNativeRuntime` 简化
- `src/lib/runtime/sdk-runtime.ts` — `isAvailable()` 永远 true；删 `findClaudeBinary` import
- `src/lib/runtime/legacy.ts` — `resolveLegacyRuntimeForDisplay` 不再依赖 `cliConnected`
- `src/lib/provider-doctor.ts` — `runCliProbe` 改为内置版本校验；live probe 不再设 `pathToClaudeCodeExecutable`
- `src/app/api/claude-status/route.ts` — 简化为永远返回 `connected: true, bundled: true, version: ...`
- `src/app/api/claude-status/invalidate/route.ts` — no-op stub
- `src/app/api/claude-upgrade/route.ts` — no-op stub，返回 deprecation 提示
- `src/components/setup/ClaudeCodeCard.tsx` — 重写为「内置就绪」版本
- `src/components/chat/RuntimeBadge.tsx` — 文案 + 不再依赖 cliConnected
- `src/i18n/en.ts` + `src/i18n/zh.ts` — `setup.claude.title/description/bundled`
- `src/__tests__/unit/runtime-selection.test.ts` + `runtime-legacy.test.ts` — 期望更新到新世界

### 验收标准

阶段 11 验证清单：

- [ ] `npm run test` 全绿（typecheck + unit）
- [ ] `npm run test:smoke` 全绿（CDP 验证基础页面）
- [ ] CDP 手动验证：新建临时数据目录启动 → 配置 provider → 发消息 → 看 SSE 流、TodoWrite 渲染、MCP 工具、permission 弹窗
- [ ] 设置页：ClaudeCodeCard 显示「✓ Claude Code v2.1.141 (内置)」
- [ ] Windows pack：`npm run electron:pack:win` 成功；NSIS 包能装到没有 node、没有 claude CLI 的虚拟机；发消息正常
- [ ] macOS pack：DMG arm64 + x64 都成功；在干净 macOS 装上能发消息
- [ ] Process Explorer / Activity Monitor 确认 spawn 的是 `<install>/resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude(.exe)`
- [ ] 安装包总大小：Windows EXE ~280-350 MB；macOS DMG ~350-400 MB（含 SDK 平台子包 ~230 MB）

### 风险与缓解（实际落地后）

| 风险 | 状态 | 缓解 |
|---|---|---|
| 法律/重新分发权 | ⚠️ 上线前必须确认 | SDK 包当前已分发；新架构本质上是把 Anthropic 已分发的 native binary 一起带上。需找 Anthropic 商务/法务签字 |
| 跨架构 vendor 错装 | ✅ 已缓解 | `after-pack.js` 加 fail-fast 校验 + CI workflow 加跨架构 `npm install --force --os/cpu` |
| 杀软误报 spawn 230MB binary | 🟡 监控 | 保留 `cli_enabled=false` → Native runtime 应急；macOS notarize + Win EV cert |
| 内置版本滞后 | 🟢 接受 | 跟 SDK 升级 1-2 周节奏；用户可在 ClaudeCodeCard 看到具体版本号 |
| 安装包 +200MB 用户流失 | 🟢 接受 | 用户确认对标 VS Code/Cursor 同量级 |

## 下一步

完成 Phase 11 后将本文档移至 `completed/`。
