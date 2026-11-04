# 对话流空闲超时改造（按实质内容计时）

> 创建时间：2026-06-18
> 最后更新：2026-06-18
>
> 技术交接见 [docs/handover/stream-idle-timeout.md](../../handover/stream-idle-timeout.md)
> 产品思考见 [docs/insights/stream-idle-timeout.md](../../insights/stream-idle-timeout.md)
> 关联问题 issue-tracker **B-019** / GitHub [#499](https://github.com/op7418/CodePilot/issues/499)

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 止血：`STREAM_IDLE_TIMEOUT_MS` 330s → 990s | ✅ 已完成 | commit `c7888dc` |
| Phase 1 | 治本主体：客户端「按实质内容计时」+ 回调分类 + 权限暂停 + i18n 文案 + 单测 | ✅ 已完成 | commit `e9ddbc2` |
| Phase 2 | （可选）服务端 SDK runtime 首包「时间盒」keep_alive + 删 `claude-client.ts` 死代码 | ⏸ 暂缓 | UX/连接保活，**不改变**是否误杀；待用户决定 |
| Phase 3 | （可选）UI 首包久等提示（区别于工具级 stuck） | ⏸ 暂缓 | 待用户决定 |
| Phase 4 | 文档（本计划 + handover + insights）+ 更新 B-019 + 索引 | ✅ 已完成 | 本次 |

## 决策日志

- 2026-06-18：先 990s 止血（Phase 0），再治本。990s 仅推迟误杀、保留兜底。
- 2026-06-18：**否决 B-019 原「补 15s 无条件心跳」根治方向**。对抗性风险分析确认：无条件心跳会让客户端 idle 计时器永不触发，等于废掉唯一的卡死兜底（连着但永不产出时 UI 永久转圈）。根因——**心跳无法区分「合法慢等」与「卡死但连接还在」**，二者在可观测层面完全相同。
- 2026-06-18：治本改为**按「实质内容」计时**：只有真实模型/工具内容刷新掐断计时；keep_alive/纯状态只刷新「连接活性」。慢首包只要最终吐内容就不被误杀，真卡死仍在硬上限后兜住。
- 2026-06-18：超时阈值 `STREAM_NO_CONTENT_TIMEOUT_MS` 维持 **990s**（需 ≥ 最坏慢首包 + 压缩重试，且 > 权限 300s 自动拒绝）；待 B-019 实测最坏慢首包数据再调。
- 2026-06-18：`onToolProgress` 计入「实质」（工具确在运行，且单工具另受 300s 工具超时约束）；`onStatus` 不计入（"Connected/Compressing" 填充）。
- 2026-06-18：等待用户授权（`pendingPermission`）期间暂停计时——模型阻塞在用户侧，另有 300s 权限自动拒绝兜底。
- 2026-06-18：Phase 2/3 标记为可选。因客户端已不用 keep_alive 做掐断判据，补服务端心跳**不再影响误杀**，仅属连接保活/体验，故降为可选、暂缓。

## 详细设计

### 目标
慢首包 provider（如百炼 qwen3.x-plus，首包前 SDK runtime 无 keep_alive）不再被空闲超时误杀；同时保留对「连着但永不产出」真卡死的终极兜底；真断线仍由 SDK 进程 exit/error 即时报错。

### 技术方案（Phase 1，已落地）
- 判据从「距上次**任何** SSE 事件」改为「距上次**实质内容**事件」。
- 新增 `ActiveStream.lastSubstantiveEventTime`；新增 `markSubstantive()`（刷新两个时间戳），仅由 8 个实质回调调用：`onText / onThinking / onToolUse / onToolResult / onToolOutput / onToolProgress / onContextCompressed / onResult`。
- 其余 11 个回调（`onStatus / onKeepAlive / onPermissionRequest / onRateLimit / onContextUsage / onToolTimeout / onModeChanged / onTaskUpdate / onRewindPoint / onError / onInitMeta`）仍调 `markActive()`（只刷新 `lastEventTime`，代表连接活性，不参与掐断）。
- 超时常量与纯判定 `shouldAbortForNoContent()` 抽到 `src/lib/stream-timeout.ts`（脱离浏览器依赖，可单测）。
- 掐断时暂停条件：`pendingPermission` 存在则跳过。
- 超时错误文案接入 i18n：`streaming.noContentTimeout`（en/zh/zh-HK）。

### 涉及文件
- `src/lib/stream-timeout.ts`（新增：常量 + 纯判定）
- `src/lib/stream-session-manager.ts`（接口字段、两个 marker、计时器判据、8 回调分类、错误文案 i18n）
- `src/i18n/{en,zh,zh-HK}.ts`（新增 key）
- `src/__tests__/unit/stream-timeout.test.ts`（新增单测）

### 验收标准
- ✅ `npm run test` 通过（含新单测；1443 passed）
- ✅ `npm run test:smoke` 通过（各页正常加载，6 passed）
- 仅心跳持续 > 阈值 → 仍会掐断（兜底未废）；持续实质内容 → 永不掐断（不误杀）；权限等待期间 → 暂停。

### 依赖项 / 待办
- `STREAM_NO_CONTENT_TIMEOUT_MS` 终值待 **B-019 实测最坏慢首包时长** 校准。
- Phase 2/3 待用户决定是否实施。
