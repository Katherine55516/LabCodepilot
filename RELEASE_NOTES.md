## CodePilot v0.55.0

> Claude Code 现在随应用一同分发——用户安装应用即可获得完整 Claude Code 功能，无需再手动 `npm install -g @anthropic-ai/claude-code` 或下载 native installer。

### 新增功能

- **Claude Code 内置** — 应用安装包内已包含 Claude Code v2.1.141 原生二进制。配置好服务商即可立刻使用完整的 14 个内置工具（Bash / Glob / Grep / TodoWrite / Skill 等）、hooks、agents、plugins、skills 全套能力，无需任何额外安装步骤。Windows、macOS 一致体验，不再需要折腾 PATH、`.cmd` 包装器、Git Bash 等环境问题
- **Claude Code 升级到 v2.1.141** — 从 v0.54 的 v2.1.111 跨越 30 个 patch 版本，跟上上游 4 周的累积改进

### 修复问题

- **再也不会出现「找不到 Claude Code 可执行文件」** — 此前在 14 天内累计触发 ~247 起 Sentry 报错的问题彻底解决：应用自带 binary，spawn 路径在打包时确定，无 PATH 漂移
- **Windows 上 npm 包装器解析失败** — 不再依赖 npm 的 `.cmd` 包装器，因此「`spawn EINVAL`」「`shell:true` 兼容」一类报错消失
- **多版本 CLI 冲突警告** — 用户本地装了多版本 Claude Code 不再触发版本对照警告（应用使用自己内置的版本）

### 优化改进

- **首次启动到能发消息从 5-30 分钟降到 < 1 分钟** — Setup 流程从「配 provider + 装 CLI + 验证」三步简化为「配 provider」一步
- **Claude Code 启动速度从 ~500ms-1s 提升到 ~200ms** — 内置 binary 是 Bun 编译的 single-file executable（AOT 优化），比之前 Node 解析 cli.js 快 2-3 倍
- **应急 fallback 保留** — 设置页保留「使用内置 Claude Code」开关。关闭后退化到 AI SDK 引擎（直连 Anthropic API，功能受限）作为应急出路，给杀软拦截、企业 endpoint policy 等场景用

### 已知变化

- 安装包体积从 ~150MB 增加到 ~350MB（含 Claude Code 平台子包 ~230MB），与 VS Code（~300MB）/ Cursor（~400MB）同量级
- Claude Code 版本现跟随应用版本统一升级，不再支持 `claude update` 单独升级 CLI——如需新版 Claude Code，请在应用内更新 CodePilot

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.55.0/CodePilot-0.55.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.55.0/CodePilot-0.55.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.55.0/CodePilot.Setup.0.55.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- Claude Code 已内置，无需单独安装
