# Built-in Claude Code（内置 Claude Code）—— 产品思考

> 技术实现见 [docs/handover/builtin-claude-code.md](../handover/builtin-claude-code.md)
> 执行计划见 [docs/exec-plans/active/agent-sdk-0-2-141-upgrade.md](../exec-plans/active/agent-sdk-0-2-141-upgrade.md)

## 解决的用户问题

v0.54 之前的体验路径：

```
下载 CodePilot 安装 → 启动 → InstallWizard 弹出
  → "请安装 Claude Code CLI" → 用户去终端跑 npm install / curl 脚本
  → 装错版本 / PATH 问题 / npm 包装器需要 shell:true
  → 折腾 5-30 分钟 → 终于能用
```

实际数据（Sentry，v0.54 之前 14 天）：
- ~247 起 "Claude Code executable not found" 事件
- 大量「装了 CLI 但 CodePilot 找不到」工单（Windows `.cmd` 包装器、Bun global 路径、homebrew 自定义 prefix...）
- Setup 流程在「安装 CLI」步骤的流失率显著高于其他步骤

**根本问题**：把"装应用"和"装 CLI"分成两件事，本质上是把开发者环境的负担推给了用户。但 CodePilot 的用户画像并不全是熟练命令行用户——很多是希望桌面端图形界面的 PM、设计师、初学者。

## 为什么是「内置」而不是「自动安装」

考虑过三个方案：

### 方案 A：自动 install CLI（v0.54 走过，被废弃）

InstallWizard 帮用户跑 npm install / 下载 native installer。问题：

- npm 在中国大陆需要镜像，企业环境可能没 npm
- macOS 上 native installer 需要 sudo，UI 给不了
- 装出来的位置 PATH 不一定有，CodePilot 仍要做模糊探测（`getClaudeCandidatePaths` 有 6+ 候选路径）
- 升级路径割裂：用户系统的 CLI 跟 CodePilot 应用是独立升级周期，版本会漂移

### 方案 B：保留 CLI 但应用兜底（v0.50.3 → v0.54）

没装 CLI 时降级到 Native runtime（直连 Anthropic API）。Native runtime 用 `@ai-sdk/anthropic` 实现，但**缺少 CLI 的能力**：

- 没有 14 个内置工具（Bash / Glob / Grep / TodoWrite / Skill 等）
- 没有 hooks / agents / plugins / marketplace
- 没有项目搜索（ripgrep）、音频输入
- 没有 cc-switch、`~/.claude/` 配置体系

结果是用户感受到「功能不全」却不知道是因为没装 CLI。叙事失败。

### 方案 C：内置 CLI（v0.55 采用）

把 Anthropic 官方分发的 Claude Code native binary 直接打进安装包。安装即用，零外部依赖，功能与官方独立 CLI 100% 等价。

代价：
- 安装包从 ~150MB 涨到 ~350MB（VS Code/Cursor 同量级，用户接受）
- CLI 版本被锁定到应用版本，不能用户自己 `claude update`
- 法律上需要确认重新分发权（Anthropic 商务条款）

## 为什么这件事现在可以做了

技术上的关键解锁来自 Anthropic 自己：

- **v0.2.111 之前**：SDK 内置 `cli.js`（13.7MB Node 脚本），需要外部 Node runtime。Electron 应用打包后没有保证的 node 二进制。
- **v0.2.120+**：SDK 拆出 `@anthropic-ai/claude-agent-sdk-<platform>-<arch>` 平台子包，里面是 **Bun 编译的 self-contained native binary**——不需要 Node runtime，可以直接 spawn。

也就是说**官方在 SDK 层面就支持了「嵌入式分发」的需求**。CodePilot 只需要：(1) 让 npm install 装上对应平台子包、(2) 让 electron-builder 把子包打入安装包、(3) 删除「绕过 SDK 内置 cli 强制找用户本地 CLI」的代码。

整个改动是「**减法**」而非「加法」：删除约 200 行 CLI 探测代码、删除 InstallWizard 的装机步骤、删除版本对照警告...

## 用户体验对比

| 维度 | v0.54 | v0.55+ |
|---|---|---|
| 首次启动到能发消息 | 5-30 分钟（装 CLI）| < 1 分钟（仅需配 provider） |
| Setup 步骤数 | 3 步 (provider + 装 CLI + 验证) | 1 步 (provider) |
| 跨平台一致性 | 差（Windows `.cmd` / macOS sudo / Linux 包管理器） | 完全一致 |
| 升级路径 | CLI 自动检测 + 升级 + 应用升级（两条） | 应用升级一条 |
| Claude Code 版本 | 用户装哪个就哪个（碎片化） | 跟应用版本绑定（统一） |
| 启动速度 | ~500ms-1s（Node 解析 cli.js） | ~200ms（Bun AOT） |
| 安装包体积 | ~150MB | ~350MB (+200MB) |
| 功能完整度 | 装了 CLI = 100%，没装 = ~40%（Native runtime） | 100%（始终） |
| 弱网/无网用户 | 必须能联网装 CLI | 应用下载完即可工作（cli 不需要联网） |

## 关键决策的思考

### 「为什么不让用户选择是否要内置 CLI 版」

理论上可以发两版安装包：
- 完整版（含 CLI）~350MB
- 轻量版（仅 Native runtime）~150MB

但这等于把"是否要 CLI"的决策推给用户，违背了"消除环境配置负担"的初衷。多数用户面对这个选择会困惑——"我需要 CLI 吗？"是一个需要先理解 Claude Code 是什么、Native runtime 缺什么才能回答的问题。

退一步：用户真不想要 CLI 时，可以在 Settings 关闭 `cli_enabled` 开关 → 应用退化到 Native runtime（仍然占用 ~350MB 但不再 spawn binary）。这个出口足够了。

### 「为什么保留 Native runtime 作为应急 fallback」

三个场景下用户**会**需要：
1. 杀软（特别是企业 endpoint protection）拦截 spawn 一个 230MB 的未知 binary
2. macOS Gatekeeper 偶发的签名验证失败（虽然有签名）
3. 用户本地有 `claude` CLI 且偏好用自己装的版本（高级用户 / 早期采用者）

Native runtime 的代码本身不大（< 1000 行），保留下来的边际成本接近零，但能救场。

### 「为什么不打包独立 Node 二进制」

这是 v0.55 早期 POC 阶段考虑过的备选方案。优劣对比：

| 方案 | 增加体积 | 复杂度 | 跨平台 |
|---|---|---|---|
| 内置 SDK 平台子包（最终选择） | ~230MB | 低（SDK 已经做好） | 自动 |
| 内置独立 Node + 用 SDK 旧版 cli.js | ~50MB | 中（PATH 注入 / spawn 配置） | 需自己解决 |
| Electron-as-Node（POC-A 验证过可行）| 0MB | 高（依赖 ELECTRON_RUN_AS_NODE + spawn hook） | 仍需 cli.js 在主包 |

后两个方案的"省体积"优势在 SDK 升级到 0.2.120+ 后失去意义——SDK 已经不带 cli.js 了。

## 风险与未来方向

### 法律风险

最大的不确定性：Anthropic 是否允许重新分发 Claude Code native binary。当前合规状态：

- SDK 主包许可证：`SEE LICENSE IN README.md`（指向 https://code.claude.com/docs/en/legal-and-compliance）
- 当前打包行为：v0.54 已经在分发 SDK 主包（含 sdk.mjs 等），新方案只是顺势把对应平台的 native binary 也打入
- 性质判断：CodePilot 通过 SDK API（`query()`）使用 Claude Code，**没有作为独立可执行入口暴露给用户**（用户不会在终端里直接跑 `claude` 命令——cli.js 不在 PATH 里）

但这个"性质判断"需要 Anthropic 的商务/法务签字确认才能上线。**Phase 11 之前必须 must-do**。

### 未来方向

- **Delta updates**：~230MB 的 binary 每次升级整体下载浪费带宽。electron-updater 支持 differential download，需要确认对 binary 的兼容性
- **轻量版分发**：如果用户反馈"我只想要 Native runtime，能不能给我 150MB 版本"高频，可以做双轨发布
- **跟随 Claude Code 上游**：当前 SDK 升级靠 weekly 手动 bump，未来可以做 Dependabot 之类自动 PR
- **Bridge 远程 CLI**：未来如果 CodePilot Cloud / Bridge 模式需要在远端跑 Claude Code，可以反向用 SDK 0.2.111 时代的"用户本地 CLI"路径——把那段代码标 deprecated 而不是彻底删除

## 参考

- [`docs/exec-plans/active/agent-sdk-0-2-111-adoption.md`](../exec-plans/active/agent-sdk-0-2-111-adoption.md) — 上次 SDK 升级的完整产品/技术思考（49 版本跨度的能力采纳）
- [`docs/insights/decouple-native-runtime.md`](./decouple-native-runtime.md) — Native runtime 抽象层的设计思考（当时是为「没装 CLI 时仍可用」准备的）
- [Anthropic SDK v0.2.141 release notes](https://github.com/anthropics/claude-agent-sdk-typescript/releases) — 30 个 patch 版本的累积变更
- [VS Code 嵌入 Node 的做法](https://github.com/microsoft/vscode/blob/main/src/bootstrap-node.ts) — Electron-as-Node 模式的开源样板
