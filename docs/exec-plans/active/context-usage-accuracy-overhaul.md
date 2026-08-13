# 上下文用量计算正确性改造

> 创建时间：2026-08-13
> 最后更新：2026-08-13
>
> 输入材料：外部审计报告《LabCodepilot 与 Claude Desktop 架构、上下文和中断链路分析》
> 与《Claude Desktop UI 中上下文使用情况的获取逻辑》（用户提供，2026-08-13）。
> 本计划只覆盖其中"上下文计算"部分；停止链（P0-A）与 SessionActor（P0-B）不在本计划范围，
> 但第七节说明了衔接点。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 1 | 分子正确性 + 权威值交付链（sidechain 过滤、探针结果实时到达 UI） | 🔄 进行中 | 1A sidechain 过滤已完成（含单测 4 条）；1B/1C 待做 |
| Phase 2 | 分母统一 resolver（UI 与服务端压缩同源） | 📋 待开始 | 修 managed 1M 模型压缩误触发 |
| Phase 3 | 压缩权威二选一 + 预算边界修正 | 📋 待开始 | 修"估算的不是实际发送的上下文" |
| Phase 4 | 明细分类真实化 + 覆盖盲区补齐 + UI 诚实化 | 📋 待开始 | |
| Phase 5 | 回归测试 + 观测埋点 | 📋 待开始 | |

## 决策日志

- 2026-08-13: 立项。审计报告的结论逐条对照当前源码复核，全部成立；另发现两个报告未覆盖的问题（D0 背景）。
- 2026-08-13: **D1-D3 全部按推荐拍板**（用户确认）：D1 = live `modelUsage.contextWindow` 优先、静态表兜底；D2 = resume 路径停用应用侧 pre-compression，交 CLI auto-compact；D3 = cowork 本期只做"近似"徽标，volume 拉 transcript 另行立项。
- 2026-08-13: Phase 1A 实现细节：sidechain 过滤下沉到 `extractAssistantTurnUsage` 内部（`parent_tool_use_id != null` → 返回 null），而非调用点判断——函数语义即"提取可代表主链驻留上下文的单次 usage"，且导出后可直接单测（assistant-usage-sidechain.test.ts）。`parent_tool_use_id: string | null` 为 SDK 一等类型字段（sdk.d.ts:2879），子代理消息必带，已核实无需运行时探字段。
- 已拍板 D1（分母来源）：是否让 live `modelUsage[model].contextWindow` 优先于静态表（推翻 2026-06 的"分母始终静态表"决策）。**推荐：live 优先、静态表兜底**——6 月逐模型实测两者已一致（9 模型全对齐，Kimi 修正后），live 值可自动跟随后端窗口调整（Qwen 曾 200K→1M），维护成本归零；静态表保留为无 live 值时的回退，不删除。
- 已拍板 D2（压缩权威）：resume 主路径是否停用应用侧 pre-compression、交给 CLI auto-compact。**推荐：停用**（详见 Phase 3 理由）。
- 已拍板 D3（cowork 沙箱探针）：容器会话 transcript 在远端 volume，本地探针必然失败。**推荐：先接受 fallback + "近似"徽标（零成本），把"helper 从 volume 拉 transcript 本地跑探针"另行立项**，不阻塞主线。

## 一、问题定位（已逐条对照当前源码确认）

"卡片不准、跟真实差得很远"不是一个公式错误，而是**四类问题叠加**。按体感贡献排序：

### 1.1 权威分子到不了当前页面（交付链断裂）

- 回合结束时探针异步后补：`fireContextUsageProbe` 延迟 1.5s 启动（`src/lib/context-usage-probe.ts:40`），结果只 `patchLatestAssistantTokenUsage` 写 DB（`context-usage-probe.ts:144`）。
- UI 在 `completed` 事件时用 SSE result 里的 **fallback usage** 构造临时 assistant 消息（`src/hooks/useStreamSubscription.ts:106-116`），之后 `reconcileWithDb()` **只在消息窗口被裁剪过时才触发**（`src/components/chat/ChatView.tsx:551`）。
- 结果：**当前页面永远停留在 fallback 口径；重进会话才显示权威值**。同一会话两个数字来回跳 → 用户感知"不准"。
- 预留的 `context_usage` SSE 通道三处消费者（`useSSEStream.ts:293`、`stream-session-manager.ts:607`、`app/chat/page.tsx:838`）**没有任何生产者**，是死代码。

### 1.2 fallback 分子被子代理（sidechain）污染 ⚠️ 审计报告未覆盖的新发现

- `claude-client.ts:1739-1740` 对**每一条** assistant 消息无条件取 `extractAssistantTurnUsage`，不过滤 `parent_tool_use_id`。
- 一个回合若以子代理请求收尾（Task 工具、子 agent），`lastAssistantUsage` = 子代理自己那条小上下文的 usage（可能只有几 K），不是主链驻留上下文（可能上百 K）。
- 卡片会在这种回合**骤降到严重偏低的值**——这是"跟真实差得很远"的最直接元凶之一，且 fallback 是当前页面的常驻口径（见 1.1），错误长期可见。

### 1.3 分母双轨分叉 → 压缩误触发 → 上下文被静默重置

- UI 分母：`getManagedContextWindowByName(provider_name) ?? model.contextWindow`（`ChatView.tsx:313`）→ managed 高阶模型 C48 = **1M** ✓。
- 服务端压缩分母：`getContextWindow(resolved.upstreamModel)` 走静态 catalog substring 匹配（`route.ts:464-471`）→ `claude-opus-4-8` 命中子串 `opus` → **200K** ✗。
- 后果链：1M 模型真实占用到 ~160K（= 80% × 200K）时 pre-compression 误触发（`route.ts:496`）→ `updateSdkSessionId(session_id, '')` 清掉 CLI transcript（`route.ts:560`）→ 换 summary + fresh query。**用户看到的卡片、模型实际拿到的上下文、DB 状态三者彻底脱节**，且这一切静默发生。

### 1.4 压缩分子口径与真实上下文无关（审计 §4.3）

- resume 路径下真实上下文 = CLI 自己的 transcript；而 `estimateContextTokens` 估的是 **DB 最近 200 条归一化历史 + 4B/token**（`route.ts:483-488`、`context-estimator.ts:22`），不含 CLI preset system prompt、内置工具 schemas、MCP schemas、skills、memory，也不知道 CLI 是否已 auto-compact。
- 两个方向都会错：tool/MCP 重时严重偏低（压缩过晚）；CLI 已 compact 而 DB 历史很长时偏高（提前抛弃 transcript）。

### 1.5 覆盖盲区长期停留在 fallback

| 场景 | 现状 | 证据 |
|---|---|---|
| Windows | 探针整体禁用 | `context-usage-probe.ts:87` |
| cowork 远程沙箱 | CLI 在容器内跑（forwarder），本地无 transcript → `fs.existsSync` 失败静默放弃 ⚠️ 新发现 | `context-usage-probe.ts:104` + `claude-client.ts:992` |
| 探针互斥/超时/slug 猜错 | 静默放弃，本轮无权威值 | `context-usage-probe.ts:88,104,108` |
| native runtime | 无探针链路 | — |

### 1.6 明细分类是装饰（审计 §4.6）

- `useContextUsage` 传 `compiler: undefined`（`useContextUsage.ts:122`）→ 卡片把全部残差记为 conversation/cache，不是 `/context` 同源分类。
- 而探针**已经拿到**完整 `ContextUsageResponse`（categories/memoryFiles/mcpTools/maxTokens/autoCompactThreshold），却只保存了 `totalTokens`（`context-usage-probe.ts:141-146`）。数据白白丢弃。

### 1.7 次要问题

- 60s freshness 依赖 `useMemo` 内 `Date.now()`，静止页面不会自行过期（`useContextUsage.ts:81`）；
- `fallbackTokenBudget` 可为负，但 `buildFallbackContext` 无条件抬到 10K floor（`claude-client.ts:316`），预算耗尽时反而硬塞 10K 历史，可能直接 prompt-too-long（审计 §4.5）；
- `estimatedNextTurn = used + output + 200` 是粗估，展示时未标注近似。

## 二、目标与非目标

**目标（验收标准）：**

1. 回合正常结束后 ≤8s，当前页面卡片显示权威值（= 探针 totalTokens，与 CLI `/context` 同源），与重进会话显示的数字一致。
2. 同一会话从任何入口（live 流、重进、首轮重定向）看到同一个数字；口径切换（近似→权威）对用户可见（source 徽标），不静默跳变。
3. 子代理收尾的回合，卡片不再骤降到子代理上下文。
4. managed 1M 模型长会话不再在 ~160K 处误触发应用压缩、不再静默清 `sdk_session_id`。
5. UI 与服务端压缩使用同一个分母 resolver，任何模型两处数值一致。
6. 探针可用时，明细分类与 CLI `/context` 分类一致；不可用时明确标注"近似"。
7. `npm run test` 全绿；探针对照回归 n≥5 样本（含 compact 后、多 MCP、managed 模型）。

**非目标：**

- 不做 SessionActor / 长期 Query（审计 P0-B，独立大改造；本方案的抽象为它预留接口，见第七节）。
- 不动停止链（审计 P0-A，另行立项）。
- 不微调 4B/token、80% 等常数本身（审计 §八明确：输入集合不对，调常数治不了根因）。
- 不在聊天主进程带凭据调 `getContextUsage()`——82 次 count_tokens 网关风暴的教训不重走（memory: token-usage-card-cumulative-fix）。

## 三、Phase 1 — 分子正确性 + 权威值交付链

### 1A. sidechain 过滤（~10 行，收益极大）

`claude-client.ts` assistant 分支：仅当消息属于主链时才更新 `lastAssistantUsage`：

```ts
const isSidechain = !!(assistantMsg as { parent_tool_use_id?: string | null }).parent_tool_use_id;
if (!isSidechain) {
  const turnUsage = extractAssistantTurnUsage(assistantMsg);
  if (turnUsage) lastAssistantUsage = turnUsage;
}
```

注意：SDK 消息的 sidechain 标记字段以实际类型为准（`parent_tool_use_id` / `isSidechain`），实现时先打印几条真实子代理消息确认字段名，不要凭类型定义猜。单测：构造含子代理收尾的消息序列，断言 result 覆盖用的是最后一条**主链** usage。

### 1B. 权威值交付链：落库 + 回合末拉取（不阻塞流 close）

保持"探针 fire-and-forget + DB 后补"的既有决策（打包环境探针可能几十秒，绝不能等），新增**前端拉取**闭环：

1. **新端点** `GET /api/chat/sessions/:id/context-usage`：返回该会话最新一条 assistant 消息的 `token_usage` 中与上下文相关的字段（`context_used_tokens`、`context_window`、`context_accounting`、`input/output_tokens` 用于前端 match 防串扰）。纯 DB 读，无副作用。
2. **前端 hook**（建议 `useAuthoritativeContextUsage(sessionId)` 或并入现有流完成回调）：
   - `handleStreamCompleted(phase === 'completed')` 后按 2s / 6s / 12s 三次退避拉取；
   - 命中条件：返回的 `context_used_tokens > 0` 且 `input/output_tokens` 与本回合 result usage 一致（复用探针的 match 语义）；
   - 命中后把字段 patch 进内存里最后一条 assistant 消息的 `token_usage`（`setMessages` 局部更新）——`walkContextUsage` 的优先级（`context_used_tokens` 优先）自然生效，**不引入第二真相**；
   - 三次未命中即停（探针失败/超时/盲区场景），卡片保持 fallback + "近似"徽标（Phase 4）。
3. **首轮路径**（`app/chat/page.tsx` 新会话 → 重定向 ChatView）：ChatView 挂载时若最新 assistant 消息缺 `context_used_tokens` 且 `created_at` 距今 < 60s，同样触发上述拉取（探针 patch 可能晚于重定向后的初始加载）。
4. **删除死通道**：`context_usage` SSE 的三处消费者（`useSSEStream.ts:293`、`stream-session-manager.ts:605-608` + snapshot 字段、`page.tsx:838`、`RunCockpit` 的 `contextUsageSnapshot` prop 链）整体移除。理由：审计明确批评"死掉的 SSE 扩展点与实际 DB 后补方案并存"是三套口径的来源之一；新交付链走"落库 + 拉取"单链。若未来 SessionActor 提供推送，再按第七节恢复。

### 1C. freshness 语义修正

去掉 60s 魔数与 `useMemo` 里的 `Date.now()`。新语义（与 Desktop 文档 §7/§8 一致）：

- 权威值 = "截至上一回合结束"的快照，**一直有效**，直到下一回合流开始；
- 流进行中：卡片显示上一快照 + "进行中"状态（或 fallback 实时值 + 近似徽标），流结束后由 1B 拉取刷新；
- 不再让快照"静默过期回落到 fallback"——陈旧标注（显示采样时间）优于伪装实时。

**Phase 1 触及文件**：`claude-client.ts`（1A）、新 route `src/app/api/chat/sessions/[id]/context-usage/route.ts`、`ChatView.tsx` / `useStreamSubscription.ts` / 新 hook（1B）、`useContextUsage.ts`（1C）、删除死通道四处。

## 四、Phase 2 — 分母统一 resolver

### 2A. 落库 live 窗口

`extractTokenUsage`（`claude-client.ts:213`）新增：从 `resultMsg.modelUsage[connectedModel].contextWindow` 提取窗口，写入 `token_usage.context_window`。`walkContextUsage` 已支持读取该字段（`context-usage-walk.ts:89`），前端零改动即生效。managed 链路 `modelUsage` 键名与 connectedModel 的对应关系需实测确认（memory 记载 `iterations` 在 managed 链路为空数组，但 `modelUsage` 6 月实测有值且与静态表一致）。

### 2B. 单一 resolver

新建 `src/lib/context-window-resolver.ts`，UI 与服务端共用：

```
resolveContextWindow(输入: {
  runtimeModelName,        // token_usage.model，含 [1m] 标记
  liveWindow,              // token_usage.context_window（2A 落库值）
  managedDisplayName,      // session 的 provider 展示名
  providerModelsWindow,    // /api/providers/models 下发值
  aliasModel, upstreamModel, context1m,
})
优先级: [1m] 标记 → liveWindow → managed 展示名表 → providerModelsWindow
        → 静态 catalog（含 upstream 消歧）→ null
```

- `useContextUsage` 的窗口优先级链替换为调用 resolver（行为对齐，snapshot.maxTokens 分支随死通道删除）；
- **服务端压缩**（`route.ts:464-471`）改用 resolver：从 DB 取该会话最近一条 `token_usage` 的 `context_window` 与 `model`，加上 session 的 provider 展示名——修掉 `claude-opus-4-8` → substring `opus` → 200K 的错配；仍无法解析时兜底 200K 并打日志（可观测，不再静默）。
- D1 拍板"维持静态表优先"时，resolver 内调换 liveWindow 与静态表的顺序即可，结构不变。

**Phase 2 触及文件**：`claude-client.ts`、新 `context-window-resolver.ts`、`useContextUsage.ts`、`route.ts`、`model-context.ts`（表保留，入口收敛到 resolver）。

## 五、Phase 3 — 压缩权威二选一 + 预算边界

### 3A. resume 路径停用 pre-compression（D2）

- `route.ts` 压缩检查块加 gate：`streamSdkSessionId` 存在（即将 resume CLI transcript）时**跳过** pre-compression 与 `needsCompression` 判断——该 transcript 的压缩权威是 CLI 自己的 auto-compact；
- 保留既有 reactive 链（CONTEXT_TOO_LONG 重试 + 会中 compact，`route.ts:104` 一带与 PTL retry 路径）作为兜底——它触发时基于**真实的** prompt-too-long 信号，不是估算；
- pre-compression（estimator 口径）仅在 **fresh/fallback 路径**（无 `sdk_session_id`）保留——此时 DB 历史就是真实要发送的内容，estimator 的输入集合是对的，口径成立；
- 可选（低成本）：resume 路径当权威分子 `context_used_tokens ≥ 90% × resolver 窗口` 时打日志/UI 预警，但**不主动清 transcript**。

理由（审计 §4.3/§4.4）：现状是"用 DB 微压缩历史的 4B/token 粗估，去决定何时抛弃一个内容完全不同的 CLI transcript"，且 80% raw window 与 CLI auto-compact 的 effective window 触发点天然不同——双权威分叉只能二选一。CLI transcript 是 resume 路径的执行真相，选它。

### 3B. 10K floor 修正

`buildFallbackContext`（`claude-client.ts:316`）：`effectiveBudget = Math.max(tokenBudget, 0)`；预算为 0 时只发 summary + prompt，按消息原子边界能塞多少塞多少，不再无条件抬 10K。

### 3C. 文档连带

`docs/handover/` 中涉及压缩触发条件的交接文档同步更新（自查清单第 4 条）。

**Phase 3 触及文件**：`route.ts`、`claude-client.ts`、`context-compressor.ts`（needsCompression 调用方语义）、相关 handover 文档。

## 六、Phase 4 — 明细真实化 + 覆盖补齐 + UI 诚实化

### 4A. 探针持久化完整分类

`context-usage-probe.ts` 把 `ContextUsageResponse` 映射后随 patch 落库：

- `categories`（system/tools/messages/memory/mcp/…）→ `token_usage.context_accounting`，字段对齐 `ContextBreakdownCompiler`（system_prompt/tools/mcp/memory/skills）；`walkContextUsage` 已捕获 `context_accounting`（`context-usage-walk.ts:105`），`useContextUsage` 把它接到 `buildContextUsageBreakdown` 的 `compiler` 入参（现为 `undefined`）；
- `maxTokens` / `autoCompactThreshold` 一并存档：**仅用于展示**（auto-compact 提示线），分母仍走 resolver（探针跑在 CLI 默认模型下，其 maxTokens 不代表会话模型——既有注释的判断保留）；
- 宽松解析：核心字段（totalTokens）严格，分类明细容错（Desktop 文档 §10——SDK 演进不应打断主链）。

### 4B. source 徽标（UI 诚实化，Desktop 文档 §8 回退序）

`ContextUsageData.source` 扩展为 `exact | approx | none`，popover 明确标注：

- `exact`：`context_used_tokens` 命中（显示"截至上回合结束"）；
- `approx`：fallback API usage 推导（win32 / cowork / 探针失败 / native / 流进行中）；
- `none`：渲染 "—"，**永不渲染 0%**。

### 4C. 覆盖盲区

- **win32**：实测 CLI 在 Windows 的 transcript slug 规则（盘符/反斜杠），通过对照后放开 `context-usage-probe.ts:87` 的平台闸；实测不通过则维持禁用 + approx 徽标（诚实降级）。
- **cowork 沙箱**：按 D3 推荐，本期只做 approx 徽标；"helper 直读 volume 拉 transcript → 本地跑探针"另行立项（R 系列文件通道已具备直读能力，技术上可行）。
- **native runtime**：estimator 口径 + approx 徽标，不新增链路。

### 4D. i18n 连带

新增徽标/提示文案同步 `src/i18n/en.ts`、`zh.ts`（及 zh-HK **手工添加**，勿跑 gen-zh-hk 脚本——memory: zh-hk-regen-regresses）。

**Phase 4 触及文件**：`context-usage-probe.ts`、`useContextUsage.ts`、`context-breakdown.ts`（如需字段）、`RunCockpitPopoverContent.tsx`、i18n 三份。

## 七、与 SessionActor（审计 P0-B）的衔接

本方案不依赖 SessionActor，但预留接口：

- 把"取一次权威快照"抽象为单一入口（探针模块对外只暴露 `requestExactSnapshot(sessionId)` 语义）。SessionActor 落地后，实现可替换为活 Query 的 `query.getContextUsage()` + session event 推送，DB/前端链路（Phase 1B 的端点与 patch 语义）不变。
- ⚠️ 长期注意：即使有了活 Query，**带凭据的 getContextUsage 在公司网关下仍会触发 count_tokens 串行风暴**（82 请求/次的实测记录）。届时要么继续用无凭据探针口径，要么确认网关侧 count_tokens 延迟可接受后再切换——这是环境约束，不随架构升级自动消失。
- 探针是版本敏感的旁路估算（审计 §4.1 第 3 点）：`@anthropic-ai/claude-agent-sdk` 每次升级，回归清单必须包含探针对照（见 Phase 5）。

## 八、Phase 5 — 回归与观测

**单测（`npm run test` 门槛）：**

1. sidechain 过滤：子代理收尾回合取主链末次 usage；
2. resolver 优先级全链 + `claude-opus-4-8` 不再命中 200K；
3. 压缩 gating：resume 路径跳过 pre-compression / fresh 路径保留 / reactive 链不受影响；
4. 10K floor：预算 0 时历史为空；
5. context-usage 端点 + 前端 match 防串扰（探针晚到、用户已进下一回合时不误 patch）。

**探针对照回归（SDK 升级必跑，记录到 docs/research/context-usage-from-claude-code.md）：**

- n≥5 样本：短会话 / 长会话（>100K）/ CLI compact 后 / 多 MCP / managed 模型，对照探针 totalTokens 与带凭据 `getContextUsage().totalTokens`（一次性验证环境）。

**观测（本地日志，不外发——no-data-to-US 纪律）：**

- 探针成功率 / 时延 / 放弃原因（互斥、超时、transcript 缺失、win32）；
- exact 与 fallback 的偏差分布（命中时顺手记录 `|exact - fallback| / exact`）——为未来判断 fallback 可信度提供数据。

**验证方法：**

- dev 侧 managed 真实调用：`CLAUDE_GUI_SECRET_KEY=<hex> npm run dev`（memory: dev-managed-verification）；
- UI 改动 CDP 截图验证（CLAUDE.md 纪律）；卡片数字与打包版 CLI `/context` 输出人工对照 ≥3 会话。

## 九、工作量与顺序

| Phase | 预估 | 依赖 |
|---|---|---|
| 1 | ~1 天 | 无；1A 可单独先行提交（10 行，立即止血） |
| 2 | ~0.5-1 天 | 无（与 1 可并行） |
| 3 | ~1 天 | Phase 2（需要统一分母做预警阈值） |
| 4 | ~1-2 天 | Phase 1（交付链先通） |
| 5 | ~1 天 | 贯穿各 Phase |

建议提交粒度：1A 单独一个 commit（独立可验证的止血修复）→ 1B+1C → 2 → 3 → 4 → 5，每步 `npm run test` + 冒烟。
