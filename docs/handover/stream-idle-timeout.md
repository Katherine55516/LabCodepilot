# 对话流空闲超时 — 按实质内容计时

> 产品思考见 [docs/insights/stream-idle-timeout.md](../insights/stream-idle-timeout.md)
> 执行计划见 [docs/exec-plans/active/stream-idle-timeout-rework.md](../exec-plans/active/stream-idle-timeout-rework.md)

## 一句话

客户端对话流的空闲超时从「距上次**任何** SSE 事件」改为「距上次**实质内容**事件」——keep_alive / 纯状态心跳不再重置掐断计时，根治慢首包 provider 被误杀（B-019），同时保留对真卡死的兜底。

## 背景与根因

- 计时器在客户端（renderer）单例 `src/lib/stream-session-manager.ts`，是对话流**唯一**的整体卡死兜底（`ActiveStream` 只有时间戳，无总时长/无 reader 级超时）。
- 旧逻辑：`markActive()` 被所有 ~19 个 SSE 回调无差别调用刷新 `lastEventTime`；`setInterval(10s)` 检查 `now - lastEventTime >= 阈值` 即 `abortController.abort()`。
- B-019：SDK runtime 路径首包前不发 keep_alive（`agent-loop.ts:119` 的 native 路径每 15s 发，SDK 路径无），慢首包 provider 静默撞阈值被误杀。
- **关键洞察**：心跳无法区分「合法慢等」与「卡死但连接还在」——同一个开着的 socket、零字节流动，可观测层面完全相同。因此「补无条件心跳」会让计时器永不触发，废掉唯一兜底。详见 insights。

## 数据流

```
SSE event (/api/chat)
  → useSSEStream.ts consumeSSEStream/handleSSEEvent  (按 event.type 分发)
  → stream-session-manager.ts 回调
       ├─ 实质内容回调 → markSubstantive()  → 刷新 lastEventTime + lastSubstantiveEventTime
       └─ 心跳/状态回调 → markActive()       → 只刷新 lastEventTime（连接活性）
  → idleCheckTimer(每 10s): shouldAbortForNoContent(now, lastSubstantiveEventTime, ceiling, hasPendingPermission)
       → true 时 abort，走 AbortError/isIdleTimeout 善后（写错误块、phase='error'、清空 sdk_session_id、GC）
```

## 核心代码

### `src/lib/stream-timeout.ts`（单一真相 + 纯判定，可脱离浏览器单测）
- `STREAM_NO_CONTENT_TIMEOUT_MS = 990_000`（16.5min）。取值约束：≥ 各路径最长合法「无实质内容间隙」（最坏慢首包 + 压缩/重试），且 > 权限 300s 自动拒绝。
- `shouldAbortForNoContent(now, lastSubstantiveEventTime, ceilingMs, hasPendingPermission)`：`hasPendingPermission` 为真直接返回 false（暂停）；否则 `now - lastSubstantiveEventTime >= ceilingMs`。

### `src/lib/stream-session-manager.ts`
- `ActiveStream` 新增 `lastSubstantiveEventTime: number`（两处初始化均设为 `Date.now()`）。
- `markActive()`：只刷新 `lastEventTime`。`markSubstantive()`：刷新两者。
- `idleCheckTimer` 调 `shouldAbortForNoContent(...)`，入参 `!!stream.snapshot.pendingPermission`。
- 善后分支文案：`translate(locale, 'streaming.noContentTimeout', { secs })`，`locale` 取自 `document.documentElement.lang`（I18nProvider 同步）。

### 回调分类（实质 vs 非实质）

| 计入实质（→ markSubstantive） | 不计入（→ markActive，仅连接活性） |
|---|---|
| onText, onThinking, onToolUse, onToolResult, onToolOutput, onToolProgress, onContextCompressed, onResult | onStatus, **onKeepAlive**, onPermissionRequest, onRateLimit, onContextUsage, onToolTimeout, onModeChanged, onTaskUpdate, onRewindPoint, onError, onInitMeta |

要点：真卡死时**只有** keep_alive 会流动，故只要 keep_alive 不计入实质，兜底就成立。`onToolProgress` 计入实质（工具确在跑，且单工具另受 300s 工具超时约束）；`onPermissionRequest` 期间由计时器暂停额外保护。

## 与相邻机制的关系

- **工具级超时**（`claude-client.ts:1396`，默认 300s）：单个工具跑太久 abort 整条流，与本「无内容」超时正交。
- **真断线**：SDK 子进程 exit/error → `claude-client` 的 `for await` 抛错 → 流即时带错误收尾，与心跳/本计时无关。
- **`claude-client.ts:1475`** 的 keep_alive 转发是**死代码**（SDK `Query.readMessages` 用 `continue` 吞掉 keep_alive，永不 yield）。Phase 2 若实施再清理。

## 验证

- 单测 `src/__tests__/unit/stream-timeout.test.ts`：阈值边界（`>=`）、权限暂停、「仅心跳终会掐断 / 持续实质内容永不掐断」。`npm run test` 1443 passed。
- 冒烟 `npm run test:smoke` 6 passed（各页正常加载，无 bundle 回归）。
- 本地无登录/managed provider，真实 990s 慢首包需线上 provider 复现；逻辑由单测 + typecheck 覆盖。

## 待办 / 已知边界

- `STREAM_NO_CONTENT_TIMEOUT_MS` 终值待 B-019 实测最坏慢首包校准。
- Phase 2（服务端首包 keep_alive，连接保活/UX）与 Phase 3（UI 首包久等提示）为可选，暂缓。
- 「连着但永不产出」的真卡死仍会等满 990s 才报错——这是「不误杀」与「快速兜底」的固有权衡（见 insights）。
