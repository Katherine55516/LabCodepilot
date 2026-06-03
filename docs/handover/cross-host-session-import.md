# Cross-Host Session Import — 跨应用 Claude Code 会话导入

> 产品思考见 [docs/insights/cross-host-session-import.md](../insights/cross-host-session-import.md)

## 核心思路

CodePilot 的"从 Claude Code 导入会话"原本只扫 `~/.claude/projects/`，看不到其他基于 Claude Code 的桌面应用写出来的会话。本次改造让 parser 在多个 `projects/` 根目录之间合并扫描，**默认自动发现 bsApp（claude-bs-agent）的 shadow HOME**，所以用户能直接在 CodePilot 里导入 bsApp 生成的全部历史会话，零配置。

实现只动了一个文件（`claude-session-parser.ts`），对外暴露的列表/导入 API 行为不变 —— 多目录扫描对调用方完全透明。

## 背景：bsApp 的 "shadow HOME"

bsApp（`claude-bs-agent` Electron 应用）在主进程 spawn server 子进程时，把 `HOME` / `USERPROFILE` 改写到 `app.getPath('userData')/claude-home`，让内置 Claude CLI 看到的 `os.homedir()` 不再是用户的真实 home。目的：防止用户机器上现有的 `~/.claude/settings.json`（apiKeyHelper、OAuth token 等）污染 bsApp 自带的鉴权。

副作用是：bsApp 写出来的所有 jsonl 历史进了 `<userData>/claude-home/.claude/projects/`，与 CodePilot 读的 `~/.claude/projects/` 是两棵完全不同的目录树。详细分析见 [docs/insights/cross-host-session-import.md](../insights/cross-host-session-import.md#为什么底层接同一份-cli-却各跑各的)。

## 数据流

```
UI: ImportSessionDialog
    ↓ fetch /api/claude-sessions
src/app/api/claude-sessions/route.ts
    ↓ listClaudeSessions()
src/lib/claude-session-parser.ts
    ↓ getClaudeProjectsRoots()  ← 多根目录在这一层注入
        ├─ { source: 'main',  path: os.homedir()/.claude/projects }
        └─ { source: 'bsApp', path: <userData>/claude-home/.claude/projects }
    ↓ for each existing root → readdirSync → extractSessionInfo
    ↓ dedup by sessionId（main 优先）→ sort by updatedAt desc
返回扁平 ClaudeSessionInfo[]，UI 不感知来源差异

UI 点 "导入" → POST /api/claude-sessions/import { sessionId }
src/app/api/claude-sessions/import/route.ts
    ↓ parseClaudeSession(sessionId)
    ↓ 同样的 getClaudeProjectsRoots() 遍历，定位 jsonl
    ↓ createSession + updateSdkSessionId + addMessage*N
返回新的 CodePilot session.id，前端 router.push 进会话
```

## 关键函数 — `src/lib/claude-session-parser.ts`

| 函数 | 职责 |
|------|------|
| `getBsAppShadowHome()` | 按平台返回 `<userData>/claude-home` 候选路径（不检查是否存在） |
| `getClaudeProjectsRoots()` | 返回所有 `projects/` 根 + 来源标签；main 永远在第一位 |
| `getClaudeProjectsDir()` | 旧 API，等价于 `getClaudeProjectsRoots()[0].path`；保留供测试和不关心多源的调用方 |
| `listClaudeSessions()` | 遍历所有根目录，按 sessionId 跨根去重（main 优先），按 updatedAt 倒序 |
| `parseClaudeSession(sessionId)` | 在所有根目录里查找 `<sessionId>.jsonl`，按 root 顺序短路 |

### shadow HOME 路径计算

```ts
// productName = "claude-bs-agent" (来自 bsApp/package.json)
if (process.platform === 'win32') {
  return path.join(process.env.APPDATA, 'claude-bs-agent', 'claude-home');
}
if (process.platform === 'darwin') {
  return path.join(os.homedir(), 'Library', 'Application Support', 'claude-bs-agent', 'claude-home');
}
// linux:
return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'claude-bs-agent', 'claude-home');
```

这个公式必须与 bsApp `desktop/main.ts:31` 的 `claudeHome = path.join(app.getPath('userData'), 'claude-home')` 保持一致；Electron 的 `app.getPath('userData')` 的平台默认值就是上面三个分支。

## 关键设计决策

### 1. 不引入用户可配置的额外目录列表

最早考虑过在 Settings 里加"额外的 Claude projects 目录"输入框。最终选写死 bsApp 路径：

- **设计目标是"导入 bsApp 历史"，不是"通用第三方目录支持"** — 没有第二个已知的目标对象
- 写死的代码加上一个文件 + 测试就够；做成可配置要 settings UI + 持久化 + i18n + 测试矩阵
- 一旦未来出现第二个类似 sibling 应用，再扩展 `getClaudeProjectsRoots()` 增加 case；这是预期的演化路径

### 2. 跨根 sessionId 去重，main 优先

sessionId 是 UUID，理论上跨应用碰撞概率近乎为零。但仍然显式去重，原因：

- 防御性：万一用户从 bsApp 把 jsonl 复制到了主目录（或反向），列表里会出现两条相同 sessionId 的记录，UI 体验差
- 优先级原则：用户真实 `~/.claude/projects/` 是 Claude Code CLI 默认产物，承载 BYOK 工作流；它永远是 canonical，bsApp 副本只在主目录缺失时显示

实现：`listClaudeSessions()` 维护一个 `seenIds: Set<string>`，按 root 顺序遍历，已经收进列表的 sessionId 不再追加；`parseClaudeSession()` 也按相同顺序 break。

### 3. 不在 UI 上区分来源

ClaudeSessionInfo 不带 `source` 字段，导入弹窗看起来跟之前一样。理由（详见 [insights 文档](../insights/cross-host-session-import.md#不加来源-badge-的取舍)）：

- 用户的心智模型是"这是一条 Claude Code 会话"，不是"这是 bsApp 的会话"
- cwd / projectName 已经隐含了来源（用户在 bsApp 选过什么目录他自己清楚）
- 加 badge 引入额外 i18n、UI 翻译、设计 review 成本，收益不成比例

如果未来真要加，往 `ClaudeSessionInfo` 加一个可选 `source` 字段，从 `getClaudeProjectsRoots()` 透传过来即可，是开放的扩展点。

### 4. parser 路径计算不缓存

`getClaudeProjectsRoots()` 每次调用都重算 —— 因为它依赖 `process.env.APPDATA` 等环境变量；测试用 `before/after` 切环境时不会出现"第一次 import 后路径就锁死"的问题。生产环境下这些 env 永远不变，重算成本可忽略。

## 文件清单

| 文件 | 改动 |
|------|------|
| [src/lib/claude-session-parser.ts](../../src/lib/claude-session-parser.ts) | 新增 `ClaudeProjectsSource`/`ClaudeProjectsRoot`/`getBsAppShadowHome`/`getClaudeProjectsRoots`；`listClaudeSessions` 与 `parseClaudeSession` 改为多 root 扫描 + 跨 root 去重；`getClaudeProjectsDir` 保留为 legacy 别名 |
| [src/\_\_tests\_\_/unit/claude-session-parser.test.ts](../../src/__tests__/unit/claude-session-parser.test.ts) | mock 范围从 `HOME` 扩到 `HOME`/`USERPROFILE`/`APPDATA`/`XDG_CONFIG_HOME`；用 `pathToFileURL` 修 Windows ESM 动态 import；新增 5 个用例（bsApp 列出、bsApp 解析、跨 root 冲突优先、`getClaudeProjectsRoots` 顺序与组成） |

**未改动**（因为不需要）：

- `src/app/api/claude-sessions/route.ts` — 直接走 `listClaudeSessions`
- `src/app/api/claude-sessions/import/route.ts` — 直接走 `parseClaudeSession`
- `src/components/layout/ImportSessionDialog.tsx` — 列表结构未变
- `src/i18n/en.ts` / `zh.ts` — 没有新文案

## 测试覆盖

`src/__tests__/unit/claude-session-parser.test.ts`：

- 既有 17 个用例继续通过（确认无回归）
- 新增 5 个用例：
  - `should list sessions written under the bsApp shadow home`
  - `should parse a session from the bsApp shadow home`
  - `should prefer the main projects root when a session id collides`
  - `should always include the main root first`
  - `should include the bsApp shadow root on win32/darwin/linux`

跑法：`npm run test`（typecheck + 单测）。本地实测 22/22 通过。

端到端验证（已用 chrome-devtools MCP 走通）：

1. `npm run dev` 启 dev server
2. 浏览器打开 `/settings`，切到 "Claude Code" tab，点 "从 Claude Code 导入"
3. 列表里同时出现真实 `~/.claude/projects/` 和 bsApp shadow home 的会话（实测 108 条会话中 56 条来自 bsApp）
4. 点任一条 "导入" → POST `/api/claude-sessions/import` 返回 201 → 跳转到新建会话页

## 已知边界

- **只读**：CodePilot 不会往 bsApp 的 shadow home 写任何东西，bsApp 的会话被 import 后写到 CodePilot 自己的 SQLite，原 jsonl 不动
- **Resume 走 SDK**：import 时把 `sessionId` 存到 `sessions.sdk_session_id`；之后 resume 时 CodePilot SDK 会用真实 `os.homedir()` 解析 jsonl 位置 —— 也就是说，**resume 一条 bsApp 来源的会话需要先把对应 jsonl 复制到 `~/.claude/projects/<encoded-cwd>/` 下**，否则 SDK 找不到。这是 SDK 的硬约束，本次改动不解决；用户场景里主要是浏览/迁移历史而非继续对话，所以暂可接受
- **未来需要扩展**：若出现第三个类似 sibling 应用，复制 `getBsAppShadowHome()` 的模式新增一个 `getXxxShadowHome()` 并塞进 `getClaudeProjectsRoots()` 即可
