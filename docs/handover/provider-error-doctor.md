# Provider/Auth/Error 全链路修复 + Doctor 诊断中心

> 完成时间：2026-03-16 | 涉及 ~20 个文件 | P0 直接修复 + P1 诊断中心

## 概述

修复 API key 配置后发送消息报 `Claude Code process exited with code 1` 的全链路问题。根因不是单一 bug，而是 6 类问题被折叠成同一个泛化错误。同时新增 Provider Doctor 诊断中心，提供一键检测和修复。

## 架构

### 错误分类（P0-A4）

```
CLI 进程 crash/exit
  ↓
claude-client.ts catch 块
  ↓
classifyError(ctx) — 模式匹配 20 种类别
  ↓
结构化 JSON SSE error event
  { category, userMessage, actionHint, retryable }
  ↓
useSSEStream.ts / page.tsx 解析
  ↓
展示分类错误 + 修复建议 + 诊断引导
```

**错误类别枚举（`src/lib/error-classifier.ts`）：**

| 类别 | 触发模式 | 可重试 |
|------|---------|--------|
| CLI_NOT_FOUND | ENOENT, spawn, command not found | 否 |
| NO_CREDENTIALS | missing api key | 否 |
| AUTH_REJECTED | 401, invalid_api_key | 否 |
| AUTH_FORBIDDEN | 403, Forbidden | 否 |
| AUTH_STYLE_MISMATCH | x-api-key, bearer token | 否 |
| RATE_LIMITED | 429, rate limit | 是 |
| NETWORK_UNREACHABLE | ECONNREFUSED, fetch failed | 是 |
| ENDPOINT_NOT_FOUND | 404 | 否 |
| MODEL_NOT_AVAILABLE | model_not_found | 否 |
| CONTEXT_TOO_LONG | context_length | 否 |
| UNSUPPORTED_FEATURE | unknown option | 否 |
| CLI_VERSION_TOO_OLD | version, upgrade | 否 |
| MISSING_GIT_BASH | requires either Git for Windows / Git Bash was not found（CLI 致命启动文案，规则置顶） | 否 |
| CONTENT_BLOCKED | can't help with this / safeguards flagged this message / anthropic.com/legal/aup（规则第二位） | 否 |
| STREAM_DISCONNECTED | closed mid-response / closed mid-call / dropped mid-request（CLI 二进制原文） | 是 |
| RESUME_FAILED | resume failed | 否 |
| SESSION_STATE_ERROR | stale/corrupt session、sdk_session_id invalid | 是 |
| IMAGES_NOT_SUPPORTED | 带图请求被上游拒（快速通道） | 否 |
| PROCESS_CRASH | exit code N | 否 |
| UNKNOWN | 兜底 | 否 |

**stderr 缓冲兜底 + Windows 缺 shell 直诊（2026-07）：** SDK 抛出的 Error **没有 `stderr` 属性**，而内嵌 CLI 的致命启动原因只打在 stderr 流上（典型：Windows 未装 Git for Windows 时 `Claude Code on Windows requires either Git for Windows (for bash) or PowerShell`，exit 1）——此前分类器只见 `exited with code 1`，落入 PROCESS_CRASH，弹窗指向 API Key，真实案例误导排查两周。修复分三层：① 所有 SDK spawn 点用 `createStderrCollector()`（`sdk-subprocess-env.ts`，8KB 上限、头尾各半 + 截断标记、剥 ANSI）缓冲 stderr——`streamClaudeSdk`（含 resume fallback / PTL retry）在 catch 里读取，`generateTextViaSdk` / `streamTextViaSdk` 把 snapshot 附着到上抛 Error 的 `stderr` 属性，provider-doctor 原有 500 字符缓冲不变；② claude-client catch 采用**两段式分类**：先按 error 自带信息分类，**仅当结果落在 PROCESS_CRASH/UNKNOWN 兜底桶且 error.stderr 为空**时才带缓冲 stderr 重分类——避免 8KB 杂音里的宽松子串（'not found' 等）劫持 401/PTL 等已明确的分类；③ MISSING_GIT_BASH 规则**移到列表最前**（`Git Bash was not found` 含 'not found'，否则被 CLI_NOT_FOUND 吞掉）且只匹配 CLI 的致命文案（勿匹配非致命警告 `Git Bash not found; BashTool will be unavailable`——无 Git 但 PowerShell 可用时正常会话也会打这条），文案直说与 API Key 无关并给出 git-scm.com 下载链接 + `/settings#cli` 安装向导入口；同时 CLI_NOT_FOUND 的裸 `'not found'` 收紧为 `'command not found'`。i18n `errors.MISSING_GIT_BASH.*` 三语已同步（目前为预留键，运行时文案来自 classifier）。测试见 `src/__tests__/unit/error-classifier-missing-git-bash.test.ts` 与 `sdk-subprocess-env.test.ts` 的 collector 用例。

**print 模式后台任务收尾上限（2026-08）：** CLI 在 print 模式下发出本轮 result 之后**不会立刻退出** —— 它进入 wind-down，等still-running 的后台任务，到上限才强杀并以非 0 退出。上限默认 **600s**（内嵌二进制里 `Kuf()` 返回 `env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS ?? 600000`）。于是任何**自己不会退出**的后台任务（dev server、Playwright 浏览器、`tail -f`）每次都要烧满 10 分钟。**现场案例**（打包版 v4.2.0 main.log，2026-08-17）：回合 07:21:32 发起 → **07:23:19 result 已正常返回**（`fireContextUsageProbe` 在 `case 'result'` 里，日志 07:23:20 的 ctx-probe 即为证据）→ 应用因为迭代器未结束一直不发 `done`，前端「生成中」又转了 10 分钟 → 07:33:19 进程 exit 1，落 PROCESS_CRASH 弹出「检查 API Key / Base URL」，并且**出错路径清空了 `sdk_session_id`**，把下一轮推上「历史当纯文本重发」的路。注意 SDK 报的是 `process exited with code 1` 而非 `returned an error result`，按 SDK 的 `lastErrorResultText` 逻辑，这只在收到的 result 是 `is_error: false` 时才可能 —— 即**答案当时已完整交付**，用户看到的报错纯属收尾误报。

修法：`prepareSdkSubprocessEnv()` 统一给所有 SDK spawn 点注入 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=60000`（仅在未设置时注入，用户自己 export 的值优先）。**不要设 0** —— CLI 的 stderr 提示写着 `=0 to wait indefinitely`，而上限检查是 `dr > 0` 门控的，0 的语义是**永远等**，比默认值更糟。选 60s 是取舍：有限任务（一次 install、一次构建）还能跑完并被记录，无界任务把损害封顶在 1 分钟；能自己跑完的任务根本碰不到上限。**注意这只压缩等待窗口，不消除 exit 1** —— 600s 那次 sweep 已经执行过、进程照样 exit 1，所以降上限只是把同一个失败提前。要让报错彻底消失还需要「本轮已收到 `is_error:false` 的 result 时，后续进程退出错误只记日志、不发 error SSE、不清 `sdk_session_id`」的守卫（**未做**，见 [tech-debt-tracker.md](../exec-plans/tech-debt-tracker.md)）。测试见 `sdk-subprocess-env.test.ts` 的 ceiling 用例。

**上游 message 优先（2026-06）：** `classifyError` 是 `classifyErrorCore`（原分类逻辑）的包装——分类后用 `extractUpstreamMessage()` 从原始错误文本（rawMessage + stderr + cause）里提取上游网关返回的可读 `message`。**覆盖两种形态**：① JSON `{"error":{"message":"…"}}`；② SDK 已把 HTTP body 解析成的**纯文本** `API Error: <status> <可读文本>`（**实际线上就是这种**，如 `… API Error: 403 用户高阶模型额度不足, 剩余: ¥-0.024640 (request id: …)`，已不是 JSON）；纯 HTTP 状态短语（Forbidden/Unauthorized 等）信息量低则不覆盖、回退通用分类。提取到则覆盖 `userMessage` 为该 message（去掉尾部 request id），并清空 `actionHint`/`recoveryActions`，让聊天里只显示这一行人话；提取不到则保持上表分类不变。`category`/`rawMessage`/Sentry 上报均不受影响（完整原文含 request id 仍留在 `rawMessage` 供排查）。前端零改动：`userMessage` 直接展示、`actionHint===''` 时不渲染「What to do」。测试见 `src/__tests__/unit/error-classifier-upstream.test.ts`。

**上游安全策略拦截 CONTENT_BLOCKED（2026-08）：** 上游把内容策略拦截作为 `stop_reason: "refusal"` 的合成消息 + `invalid_request` 返回，SDK 再包成 `Claude Code returned an error result: API Error: …`。内嵌 CLI（`claude-agent-sdk-<platform>-<arch>/claude`）里核实出三种文案：① `<Model> can't help with this. Start a new session to continue.\n\nLearn more: https://www.anthropic.com/legal/aup`；② `<Model>'s safeguards flagged this message (…/legal/aup). … Claude Code can't respond to this message with <Model>.`；③ cyber 类 `… flagged this message for a cybersecurity topic … Cyber Verification Program …`（无 aup 链接，走自己的帮助中心链接）。**现场案例**：打包版 v4.2.0 的 main.log 在 2026-08-13～08-17 记录 4 次形态①，此前一条规则都不匹配 → 落 UNKNOWN「发生未知错误，去跑 Provider Doctor」，用户于是去排查一个本来正常的服务商，同时反复输入「继续」——而「继续」会把被拦的历史前缀原样重发（出错路径清空 `sdk_session_id`，下一轮走 `buildFallbackContext` 把历史当纯文本塞进 user 消息），于是必然再次被拦，形成死循环。

规则要点：**置于列表第二位**（紧随 MISSING_GIT_BASH）——本规则四个模式全是 CLI 精确原文、不会劫持任何分类，而后面若干规则足够宽松（CLI_VERSION_TOO_OLD 匹配裸 `'version'`、UNSUPPORTED_FEATURE 匹配 `'not supported'`），顺序一变就可能把 refusal 吞掉。文案中文优先，直说与 API Key/额度/Base URL/网络无关，并点明「继续」会复发、要**新建会话**；cyber 类额外追加 Cyber Verification Program 一句。`retryable: false`，recoveryActions 只给「新建会话」+「查看内容政策」，**刻意不给 retry / Open Settings**（这两个误导正是本分类存在的理由）。

**该分类不参与上游 message 覆盖**：`classifyError` 在 CONTENT_BLOCKED 上提前 return。否则网关把 refusal 包成 JSON（`{"error":{"message":"… can't help with this …"}}`）时，`extractUpstreamMessage()` 会把那一句原文提上来并清空 `actionHint`/`recoveryActions`，恰好丢掉用户唯一需要知道的信息。原文仍在 `rawMessage`（前端「Original error」）里可查。测试见 `src/__tests__/unit/error-classifier-refusal.test.ts`。

**分类对了、但用户看不见：错误文案被有序块渲染吞掉（2026-09）：** 上面这些分类做得再准，也得先送到屏幕上。**现场案例**（打包版 v4.2.0 用户反馈日志，2026-08-04～09-08）：托管网关 + `qwen3.8-max[1m]` 的回合在 09-07 14:43（UTC 06:43:15）被网关中途断流，`STREAM_DISCONNECTED` 正常命中、结构化 error SSE 也正常下发 —— 但用户侧只看到回答断在半句「💡 选 20VU 而非」，外加一个语义为零的灰橙 chip，**没有任何报错**。105 个回合里 12 次断流，全部如此。

根因是**投递链路**，不是分类：`useSSEStream` 的 `case 'error'` 把文案追加到扁平的 `accumulated` 文本，而最终消息由 `stream-session-manager.ts` 的 `buildFinalContentFromBlocks()` 从 `orderedBlocks` 重建 —— `accumulated` 只在 **orderedBlocks 全空**时才作为兜底使用。于是只要这一轮出现过 thinking / 工具调用 / 多段文本（本应用几乎每轮都有），错误文案就被丢弃。直播态同理：`StreamingMessage.tsx` 的 `if (blocks.length > 0) return segmentsFromBlocks(blocks)` 让它连一闪而过都没有。**正确写法当时就在隔壁** —— abort / 空转超时路径的 `buildFinalContent(note)` 是把提示 `push` 进 blocks 的，所以「用户手动停止」一直显示正常，唯独真正的错误看不见。服务端同样漏：`api/chat/route.ts` 的 tee 在 `event.type === 'error'` 分支只置 `hasError`/`errorMessage`，**从不写进 `contentBlocks`**，所以 DB 里那行 assistant 消息也没有任何出错痕迹，刷新后依旧是半句话。

修法三处，文案统一由新模块 `src/lib/sse-error-format.ts` 渲染（客户端直播态、客户端落库态、服务端 tee 三个消费方必须逐字一致，否则回合中读到的提示和刷新后的不一样）：① `onError` 回调签名扩为 `(accumulated, note?, category?)`，把孤立的 note 单独传出来 —— 调用方无法从 `accumulated` 里反解它；② `buildFinalContentFromBlocks(stream, fallback, note)` 把 note 作为末尾 text 块拼进块数组；③ 服务端 tee 调 `pushErrorNoteBlock()`（先 flush 待落的 `currentText` 保证顺序，并自带 `\n\n` 分隔符 —— 纯文本回合是用 `join('')` 落库的，不带分隔符会把提示黏在断句尾巴上）。

**断流不再清 `sdk_session_id`（2026-09）：** 同一份日志里 12 次断流 = 12 次会话重置（`claude-client.ts` 原本对**所有** stream error 一律 `updateSdkSessionId(sessionId, '')`）。断流场景下 CLI 侧会话本身是健康的，被切的只是网关的 HTTP body；清掉等于扔掉 CLI 侧已压缩的 transcript、todo 和已读文件，逼下一轮把 DB 全量历史重放 —— 更慢、更贵，也**更容易再撞上同一个断流**。现改为仅在 `classified.category === 'STREAM_DISCONNECTED'` 时保留。安全性来自 resume 路径本就有的三向兜底（抛错 / 零消息 / 挂住 → 清 id 并不带 resume 重跑），所以一个事后证明不可用的 session id 只多花一次尝试，不会把会话卡死。注意这**不等于** tech-debt-tracker 里记的那条更宽的守卫（「本轮已收到 `is_error:false` 的 result 后，进程退出错误只记日志」）—— 那条仍未做。

**结束态 chip 的重试按钮按 category 收窄（2026-09）：** SDK 的 `terminal_reason` 把两件性质相反的事都归到 `api_error` —— 上游内容拦截（重试 = 把被拦前缀原样重发，必然复发，正是上面 CONTENT_BLOCKED 段描述的死循环）和网关中途断流（重试 = 通常就好了）。chip 本身分不出来，因此 `TerminalReasonChip` 新增 `errorCategory` 入参，只有 `RETRYABLE_API_ERROR_CATEGORIES`（当前仅 `STREAM_DISCONNECTED`）才挂 `retry_simple`。category 经 `SessionStreamSnapshot.errorCategory` 从 error 帧带到 chip —— 该字段必须同时登记进 `buildSnapshot()` 的**字段白名单**，否则每次 emit 都会被静默丢掉。测试见 `src/__tests__/unit/sse-error-note.test.ts` 与 `terminal-reason-chip-render.test.ts`。

### Provider 生效修复（P0-A1）

```
chat/page.tsx 初始化
  ↓
useState(() => localStorage.getItem('codepilot:last-provider-id'))
  ↓ (不再硬编码 'sonnet' / '')
provider-changed 事件 → 同步 localStorage
  ↓
onProviderModelChange → 写入 localStorage
```

**全局默认模型机制：**
- 不再有独立的"默认服务商"概念，改为使用全局默认模型（`global_default_model` + `global_default_model_provider`）决定新对话的 provider 和 model
- 首个 provider → 自动设为全局默认模型的 provider
- 已有 provider → `confirm()` 询问是否切换
- 写入 DB (`set-default` API) + localStorage

### Auth Style 自动分流（P0-A2）

- 非 thirdparty preset：从 `extra_env` 自动检测 auth style，不显示选择器
- thirdparty preset：根据 base_url 模糊匹配 VENDOR_PRESETS hostname 智能推荐
- 显示只读 badge（`Authorization: Bearer ...` 或 `X-Api-Key: ...`）

### Model Upstream 映射（P0-A3）

`provider-resolver.ts` `buildResolution()` 中：当 `opts.model`（如 `sonnet`）通过 catalog 查到不同的 `upstreamModelId` 时，更新 `roleModels.default` 为 upstream ID，确保 `toClaudeCodeEnv()` 设置正确的 `ANTHROPIC_MODEL`。

### Resume 静默回退（P0-A6）

resume fallback 的 status event 标记为 `_internal: true`。`useSSEStream.ts` 过滤掉 `_internal` 事件。用户无感知。

### Doctor 诊断中心（P1）

```
设置 → 服务商 → 运行诊断
  ↓
GET /api/doctor → runDiagnosis()
  ↓
5 个探针并行执行
  ├── CLI: findClaudeBinary + version + 多安装冲突 + Git Bash
  ├── Auth: env/DB/provider 凭据 + resolved provider + 双 key 冲突
  ├── Provider: 数量 + 默认 + 解析路径
  ├── Features: thinking/context1m 兼容性 + stale sdk_session_id
  └── Network: HEAD 请求所有 provider base_url (5s 超时)
  ↓
附加修复动作到 findings (attachRepairsToFindings)
  ↓
前端渲染诊断结果 + 修复按钮 + GitHub Issue 引导
```

**修复动作（POST /api/doctor/repair）：**

| 动作 | 触发条件 | 效果 |
|------|---------|------|
| set-default-provider | provider.no-default | 设置第一个 provider 为默认；同时写入 `default_provider_id` 和 `global_default_model_provider`，并清空 `global_default_model`（旧 model 不再有效） |
| apply-provider-to-session | auth.resolved-no-creds | 将默认 provider 赋给无 provider 的 session |
| clear-stale-resume | features.stale-session-id | 清理所有 stale sdk_session_id |
| switch-auth-style | auth.style-mismatch | 在 provider extra_env 中切换 API_KEY ↔ AUTH_TOKEN |
| reimport-env-config | auth.no-credentials | 从 env 导入 AUTH_TOKEN + BASE_URL 到 DB |

**脱敏规则（导出日志）：**
- API key/token → `{ exists: true, last4: "xxxx" }`
- URL → 仅 hostname（已知 vendor 保留完整）
- 文件路径 → `~` 替换 homedir
- runtime-log 消息在写入时即 scrub（正则替换 key/token/path）

### Runtime Log（P1）

`src/lib/runtime-log.ts` — 200 条环形缓冲区。通过 `src/instrumentation.ts` 的 Next.js instrumentation hook 在服务端启动时自动调用 `initRuntimeLog()`。拦截 `console.error` / `console.warn`，写入前做 `scrubMessage()` 脱敏。

### CI 构建修复

- Linux arm64 使用原生 `ubuntu-24.04-arm` runner，不做交叉编译
- 三平台均生成 SHA-256 checksum，合并为 `SHA256SUMS.txt` 上传到 Release
- Linux 产物校验 AppImage（ELF arch）、deb（dpkg-deb）、rpm（rpm -qp）架构

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/lib/error-classifier.ts` | 20 类错误模式匹配 + 结构化输出 |
| `src/lib/sse-error-format.ts` | error SSE 帧 → 用户可读文案（客户端/服务端共用，保证逐字一致）+ `pushErrorNoteBlock()` |
| `src/lib/provider-doctor.ts` | 5 探针诊断引擎 + 修复动作 |
| `src/lib/runtime-log.ts` | console 环形缓冲 + 脱敏 |
| `src/instrumentation.ts` | 服务端启动 hook（initRuntimeLog） |
| `src/app/api/doctor/route.ts` | 诊断 API |
| `src/app/api/doctor/repair/route.ts` | 修复 API（5 种动作） |
| `src/app/api/doctor/export/route.ts` | 脱敏日志导出 |
| `src/app/api/providers/set-default/route.ts` | 设置默认 provider |
| `src/lib/db.ts` | `getDefaultProviderId()` / `setDefaultProviderId()` — 默认服务商读写 |
| `src/components/settings/ProviderDoctorDialog.tsx` | 诊断 UI |
| `src/components/settings/ProviderManager.tsx` | 诊断入口（设置项样式） |

## 设计决策

1. **错误分类放在服务端** — classifier 在 `claude-client.ts` catch 块中调用，SSE 发送结构化 JSON，前端向后兼容纯文本
2. **修复动作挂在 finding 上** — 不是顶层 repairs 数组，而是每个 finding 的 `repairActions[]`，前端可以直接渲染
3. **stale resume 批量清理** — 不从截断的 detail 文本提取 session ID，使用无参模式 `UPDATE ... WHERE sdk_session_id != ''`
4. **switch-auth-style 只处理 provider 级冲突** — env 变量冲突（both-styles-set）不提供修复按钮，只给手动建议
5. **reimport-env-config 不混用 key 类型** — 只导入 AUTH_TOKEN 和 BASE_URL 到对应 DB setting，API_KEY 由 resolver 直接从 process.env 读取
6. **arm64 不做交叉编译** — 使用 GitHub 原生 arm64 runner，避免 Ubuntu 版本变更导致 sources.list 路径不一致
