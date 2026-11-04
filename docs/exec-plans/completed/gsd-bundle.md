# 内置打包 GSD（gsd-build/get-shit-done）

> 创建时间：2026-05-25
> 最后更新：2026-05-25
> 状态：✅ 已完成 — 详见 [docs/handover/gsd-bundle.md](../../handover/gsd-bundle.md) + [docs/insights/gsd-bundle.md](../../insights/gsd-bundle.md)
> Phase 4 的"本地 DMG / NSIS 试装"未在本次完成，标注为发版前手动验证项

把 [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done)（MIT, archived）作为内置插件随 AI Native Lab Windows / macOS 安装包发布，让用户装完即用 67 个 `/gsd-*` 斜杠命令，不依赖任何手动安装步骤。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 调研 + 决策 + 执行计划 | ✅ 已完成 | 本文档；6 个关键决策已锁定（见下方决策日志） |
| Phase 1 | Vendor GSD 源（直接复制） + 构建期转换脚本 + 校验 | ✅ 已完成 | 产出 `vendor/gsd-bundle/`（67 commands + 33 agents + plugin.json + VERSION） |
| Phase 2 | Electron 同步逻辑（首次启动 + 版本变化）+ extraResources 打包 | ✅ 已完成 | 同步到 `~/.claude/plugins/external_plugins/codepilot-gsd-vendor/`，agents 镜像到 `~/.claude/agents/`（hash 冲突时跳过） |
| Phase 3 | Settings UI（完整面板）+ IPC + 中英 i18n | ✅ 已完成 | 状态/版本/启用-禁用/重新同步/卸载 |
| Phase 4 | handover + insights 文档 + 打包验证 + 移至 completed/ | ✅ 已完成 | 含本地 DMG / NSIS 试装、CDP 截图 |

## 决策日志

- **2026-05-25**: **GSD 版本** = `gsd-build/get-shit-done`（原始归档版，非 Redux）。理由：用户指定，且原始版命令文件结构（commands/gsd/*.md + agents/gsd-*.md）与 AI Native Lab 现有扫描器最契合，无需引入 SKILL.md 模式。
- **2026-05-25**: **Vendor 方式** = 直接复制源文件到 `vendor/gsd-source/`，不使用 git submodule。理由：用户偏好；clone 项目无需 `--recursive`；体积可控（~1MB）。升级 GSD 时由维护者手动重新拉一遍。
- **2026-05-25**: **安装位置** = `~/.claude/plugins/external_plugins/codepilot-gsd-vendor/`，目录名带 `-vendor` 后缀避免和用户手装的官方 GSD 混淆；命令文件名保持 hyphen 形式（`gsd-debug.md`），最终命令呈现 `/gsd-debug` 与 GSD 官方在 Claude Code 上的行为一致。
- **2026-05-25**: **命名转换** = 构建期跑 `gsd:` → `gsd-` 替换（文件名、frontmatter `name:` 字段、命令体内的引用），与 GSD 官方 installer 在 Claude Code 上的行为一致。理由：AI Native Lab 扫描器（src/app/api/skills/route.ts:266-275）的子目录会拼成 colon 形式，必须平面化才能得到 hyphen 命令名。
- **2026-05-25**: **冲突策略** = 与用户已装的官方 GSD 共存，popover 同时显示两份（global + plugin），description 里标注来源；agents 镜像到 `~/.claude/agents/` 时，若目标已存在且 hash 不同则跳过 + 写警告日志，尊重用户改动。
- **2026-05-25**: **同步时机** = 首次启动 + 版本变化时，后台异步（不阻塞主窗口加载）。版本戳 = `<gsd-source-snapshot-tag>-<transform-script-version>`。
- **2026-05-25**: **Settings UI** = 完整面板（状态、版本、启用/禁用、重新同步、卸载），中英双语。
- **2026-05-25**: **Subagent 同步策略** = 同时同步到插件目录的 `agents/` 和 `~/.claude/agents/` 两个位置。理由：Claude Code 的 subagent 约定位置是 `~/.claude/agents/`，AI Native Lab 跑的 Claude Agent SDK 也基于该约定查找；若仅放在插件目录子目录，`Agent` 工具调用子 agent 会失败。

## 详细设计

### 整体数据流

```
[源]                          [构建期]                       [运行时]
gsd-build/get-shit-done   →   scripts/vendor-gsd-prepare.js   →   resources/gsd-bundle/
(vendor/gsd-source/ 固定         平面化 commands/gsd/*.md         (electron-builder extraResources)
 快照, 维护者手动更新)            → vendor/gsd-bundle/commands/
                                colon→hyphen 内容转换
                                                                         ↓ app.whenReady()
                                                                    electron/gsd-installer.ts
                                                                    版本戳对比 → 同步
                                                                         ↓
                              ~/.claude/plugins/external_plugins/codepilot-gsd-vendor/
                              ├── commands/   gsd-debug.md ... (67 个 平面)
                              ├── agents/     gsd-debugger.md ... (33 个)
                              ├── plugin.json (元数据)
                              ├── VERSION
                              └── LICENSE (MIT 原文)

                              + 镜像到 ~/.claude/agents/gsd-*.md (hash 冲突时跳过)
                                                                         ↓
                              AI Native Lab 扫描器 (src/app/api/skills/route.ts:33-75 getPluginCommandsDirs)
                              自动识别 → 斜杠菜单出现 /gsd-debug 等
```

### Phase 1: Vendor + 转换脚本

**新增文件**：

```
vendor/
├── .gitignore                          # 忽略 gsd-bundle/ 产物
├── gsd-source/                         # 原始归档版固定快照（直接复制）
│   ├── commands/gsd/                   # 67 个 .md（colon 形式）
│   ├── agents/                         # 33 个 .md
│   ├── LICENSE
│   └── SNAPSHOT.md                     # 记录来源 commit + 拉取日期
└── gsd-bundle/                         # 构建产物（不入库）

scripts/
├── vendor-gsd-prepare.js               # 主转换脚本
└── vendor-gsd-verify.js                # 产物校验（67+33+LICENSE）
```

**`scripts/vendor-gsd-prepare.js` 行为**：
1. 读 `vendor/gsd-source/commands/gsd/*.md`，对每个文件：
   - `baseName`（如 `debug`）作为新命令名后缀
   - 文件内容替换：
     - frontmatter `name: gsd:debug` → `name: gsd-debug`
     - 正文内 `/gsd:xxx` → `/gsd-xxx`（命令引用）
     - 正文内 `\bgsd:[a-z][a-z0-9-]*\b` → `gsd-...`（agent 名引用、配置 key 等）
   - 输出到 `vendor/gsd-bundle/commands/gsd-<baseName>.md`
2. 读 `vendor/gsd-source/agents/*.md`，对每个文件：
   - 文件名已是 hyphen，原样复制到 `vendor/gsd-bundle/agents/`
   - 内容做相同的 `gsd:` → `gsd-` 替换
3. 写 `vendor/gsd-bundle/plugin.json`：
   ```json
   {
     "name": "codepilot-gsd-vendor",
     "source": "gsd-build/get-shit-done",
     "sourceSnapshot": "<commit-or-tag>",
     "transformVersion": 1,
     "commandCount": 67,
     "agentCount": 33,
     "license": "MIT"
   }
   ```
4. 写 `vendor/gsd-bundle/VERSION`：`<sourceSnapshot>-v<transformVersion>`
5. 复制 `vendor/gsd-source/LICENSE` → `vendor/gsd-bundle/LICENSE`
6. 写 `vendor/gsd-bundle/transform-report.json` 记录每个文件的改动行数（debug 用）

**`scripts/vendor-gsd-verify.js`** 校验：
- `commands/` 下恰好 67 个 `gsd-*.md`，每个都通过 YAML frontmatter 解析
- `agents/` 下恰好 33 个 `gsd-*.md`
- `LICENSE` 内含 "MIT License"
- `plugin.json` 字段齐全
- 任意命令文件不含 `gsd:` 字面量（除非在转义的代码块里，会单独白名单）

**修改文件**：
- `package.json` scripts 增加：
  ```json
  "vendor:gsd": "node scripts/vendor-gsd-prepare.js",
  "vendor:gsd:verify": "node scripts/vendor-gsd-verify.js",
  ```
- 不在 `prebuild` 自动跑，避免每次开发都跑（产物已落到 `vendor/gsd-bundle/` 不入库）。但在 CI 构建脚本 / 本地 `npm run build` 前必须显式跑一次。

**验收**：
- `npm run vendor:gsd` 幂等，重复跑产物 byte-identical（除时间戳外）
- `npm run vendor:gsd:verify` 通过
- `vendor/gsd-bundle/commands/gsd-debug.md` 的 frontmatter 是 `name: gsd-debug`，正文内无残留 `gsd:debug`

### Phase 2: Electron 同步 + 打包

**新增文件**：

```
electron/
├── gsd-installer.ts                    # 主进程同步模块（核心）
└── __tests__/
    └── gsd-installer.test.ts           # 单测（mock fs）
```

**`electron/gsd-installer.ts` 接口**：

```ts
export interface GsdInstallStatus {
  enabled: boolean;
  installedVersion: string | null;   // ~/.claude/plugins/.../VERSION
  bundledVersion: string;            // resources/gsd-bundle/VERSION
  commandCount: number;
  agentCount: number;
  installPath: string;
  conflicts: { agentName: string; reason: 'hash-mismatch' }[];
}

export async function install(): Promise<GsdInstallStatus>;  // 启动时调用
export async function resync(force = true): Promise<GsdInstallStatus>;
export async function enable(): Promise<void>;
export async function disable(): Promise<void>;
export async function uninstall(): Promise<void>;
export async function getStatus(): Promise<GsdInstallStatus>;
```

**install() 流程**：
1. 若 disabled 标记存在 → 返回（什么都不做）
2. 读 `process.resourcesPath/gsd-bundle/VERSION`（打包内）
3. 读 `<installPath>/VERSION`（用户磁盘）
4. 一致 → 返回 status
5. 不一致或目录不存在：
   1. 备份用户在 `<installPath>/extras/` 的自定义文件（如果有）
   2. 删 `<installPath>/commands/` 和 `<installPath>/agents/`
   3. 从 `resources/gsd-bundle/` 复制全部到 `<installPath>/`
   4. 还原 extras
   5. 镜像 `<installPath>/agents/*.md` → `~/.claude/agents/`：
      - 目标不存在 → 直接写入
      - 目标存在且内容 hash 一致 → 跳过
      - 目标存在且 hash 不同 → 跳过 + 在 conflicts 记录
6. 返回 status，所有异常 catch + 写日志，不抛

**修改文件**：

`electron-builder.yml`（参考 [`electron-builder.yml`](electron-builder.yml) 的 `extraResources` 段）：
```yaml
extraResources:
  - from: vendor/gsd-bundle/
    to: gsd-bundle/
  # 既有的 standalone / login / build 字段保留
```

`electron/main.ts` 在 `app.whenReady()` 完成后追加：
```ts
import { install as installGsd } from './gsd-installer';
// 主窗口加载后异步触发，不阻塞 UI
mainWindow.webContents.once('did-finish-load', () => {
  installGsd().catch((err) => log.error('[gsd-installer] failed', err));
});
```

**单测覆盖**：
- VERSION 一致时无 fs 写入
- VERSION 不一致时复制全部文件
- extras 保留
- agents 镜像：目标存在 hash 一致 → 跳过；不存在 → 写入；hash 不同 → 记录 conflict 不覆盖
- disabled 标记存在时 install() 提前返回

**验收**：
- `npm run electron:dev` → 删 `~/.claude/plugins/external_plugins/codepilot-gsd-vendor/` → 重启 → 文件回来
- 主窗口输入 `/gsd` 出现 dropdown 至少 10 条 `/gsd-*` 命令
- CDP 截图存档

### Phase 3: Settings UI + IPC

**新增文件**：

```
src/app/api/gsd/route.ts                # Next.js API：转发到 Electron IPC
src/components/settings/GsdPlugin.tsx   # 完整面板
electron/ipc/gsd.ts                     # IPC 桥接（status / resync / enable / disable / uninstall）
```

**UI 草图**（中文）：

```
┌─ 内置插件 ─────────────────────────────┐
│                                        │
│ ┌─ GSD (Get-Shit-Done) ──────────┐     │
│ │ 状态     ● 已启用              │     │
│ │ 版本     v1.x (基于 a1b2c3d)   │     │
│ │ 命令数   67  · 子 agent  33    │     │
│ │ 来源     gsd-build/get-shit-done│    │
│ │ 路径     ~/.claude/plugins/... │     │
│ │                                │     │
│ │ ⚠️ 检测到 N 个 agent 与本地修改 │     │
│ │   冲突，已跳过                  │     │
│ │                                │     │
│ │ [立即重新同步] [禁用] [打开目录]│     │
│ │                                │     │
│ │ 说明：基于 MIT 协议的开源项目  │     │
│ │ gsd-build/get-shit-done...     │     │
│ └────────────────────────────────┘     │
└────────────────────────────────────────┘
```

**i18n 新增 key**（src/i18n/en.ts + zh.ts 双语保持同步）：
- `settings.gsd.title`
- `settings.gsd.subtitle`
- `settings.gsd.status.enabled` / `disabled`
- `settings.gsd.version`
- `settings.gsd.commandCount`
- `settings.gsd.agentCount`
- `settings.gsd.source`
- `settings.gsd.path`
- `settings.gsd.conflicts` （带参数 N）
- `settings.gsd.actions.resync`
- `settings.gsd.actions.enable` / `disable`
- `settings.gsd.actions.openDir`
- `settings.gsd.actions.uninstall`
- `settings.gsd.description`

**验收**：
- CDP 验证：状态 / 版本 / 命令数 / agent 数 显示正确
- 点禁用 → 斜杠菜单的 `/gsd-*` 消失（AI Native Lab 扫描器看到 disabled 标记不扫该目录）
- 点启用 → 命令再次出现
- 点重新同步 → 进度反馈 + 状态更新
- 点卸载 → 二次确认弹窗 → 删除目录

### Phase 4: 文档 + 打包验证

**新增文件**：

```
docs/handover/gsd-bundle.md             # 技术交接：架构、数据流、设计决策、关键文件
docs/insights/gsd-bundle.md             # 产品思考：为什么内置、为什么是 GSD、未来方向
```

**两份文档反向链接**（CLAUDE.md 要求）：
- handover 开头：`> 产品思考见 [docs/insights/gsd-bundle.md](../insights/gsd-bundle.md)`
- insights 开头：`> 技术实现见 [docs/handover/gsd-bundle.md](../handover/gsd-bundle.md)`

**修改文件**：
- `docs/handover/README.md` 索引追加
- `docs/insights/README.md` 索引追加
- `docs/exec-plans/README.md` 索引：把本文件标记为完成
- 本文档 Phase 0-4 全部标 ✅

**打包验证**：
1. `npm run vendor:gsd`
2. `npm run build`（先清理 `.next/` `release/`）
3. macOS 本地打 DMG（如果在 mac 机器）/ Windows 打 NSIS
4. 装到全新位置（最好是新建 Windows 用户 / 删除 `~/.claude/plugins/external_plugins/codepilot-gsd-vendor/` 后启动）
5. 验证：
   - 首次启动后 `~/.claude/plugins/external_plugins/codepilot-gsd-vendor/` 出现
   - 斜杠菜单出现 `/gsd-help` 等
   - 调用 `/gsd-help` 收到合理响应（GSD 自带的帮助文本）
6. CDP 截图存档到 `docs/handover/gsd-bundle.md` 附图

## 依赖项

- 不引入新 npm 依赖（fs / path / crypto 都用 Node 内置）
- 不改 db schema
- 不改 `src/types/index.ts`（PopoverItem 现有字段 `source: 'plugin'` 已够用）

## 风险与缓解（汇总）

| 风险 | 缓解 |
|---|---|
| 转换脚本误伤代码块里的 `gsd:` 字面量 | 用 word boundary 正则 + 单测覆盖典型文件 + transform-report 人工核对 |
| Claude Agent SDK 不扫 `~/.claude/agents/` | Phase 2 验证 dev 模式 Agent 工具能否调用 `gsd-debugger`；若不行，fallback：把 agent 内容内联到调用它的 command prompt（脚本生成） |
| 用户已装官方 GSD 命令重复 | popover 同时显示，description 区分来源；冲突分析见 docs/handover |
| 用户改了 `~/.claude/agents/gsd-debugger.md` | hash 比对 → 跳过 + 警告日志 + Settings 显示冲突数 |
| Windows / macOS 路径大小写差异 | hash 用 file content 不用路径；路径全用 path.join + 小写化 |
| 打包体积膨胀 | 67 + 33 个 .md 估算 < 1MB，可接受；如膨胀严重再考虑 tar.gz |
| GSD MIT 合规 | 保留 LICENSE 文件 + Settings UI 显示来源和协议 |
| 升级 GSD 时如何重拉源 | 维护者跑 `node scripts/vendor-gsd-fetch.js`（Phase 1 内附带），更新 `vendor/gsd-source/SNAPSHOT.md` |

## 验收清单

- [ ] `npm run vendor:gsd && npm run vendor:gsd:verify` 通过
- [ ] `npm run test` 含 gsd-installer 单测全绿
- [ ] `npm run test:smoke` 通过
- [ ] dev 模式（`npm run electron:dev`）首次启动后命令出现，CDP 截图归档
- [ ] 本地打包（macOS DMG 或 Windows NSIS）→ 干净环境安装 → 命令出现
- [ ] handover + insights 文档双向链接齐全
- [ ] 三个 README 索引同步
- [ ] commit 信息按 conventional commits + 按文件分组说明
