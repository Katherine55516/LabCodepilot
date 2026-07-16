# 回归脚本生成 · 轨迹锚点富化 + 逐条增量入队

> 创建时间：2026-07-16
> 最后更新：2026-07-16
> 关联：docs/handover/regression-script-generation.md（现状全貌）、docs/exec-plans/active/regression-script-replay.md（下游消费方）

## 背景与目标

真机使用暴露两类痛点（2026-07-16 用户反馈）：

1. **断言目标定位器被臆造**：执行轨迹只记录**被操作过**的元素（MCP 的 `### Ran Playwright code`
   已给出现成的 `getByRole('button', { name: '+ 新建学科' })` —— 对这些元素模型无需猜）。
   但断言常打在**只在页面快照里观察过、从未被点击**的元素上（「验证头像上传框可见」），
   这类元素在轨迹里没有任何代码，生成模型只能凭空捏造定位器 → 组件库内部 class
   （如 `.avatar-uploader`）→ 重放 `element(s) not found`。这是脚本首跑失败的最大来源。
2. **断流全丢**：脚本生成由【报告成功】门控。执行流被网络掐断（本环境跨境链路间歇丢包，
   已两次真机复现：82/93、29/93 处断流）→ 报告不跑 → 已通过用例的脚本一个都不沉淀，
   整轮 token 白烧。

两个改进（曾评估"执行时让智能体顺手生成脚本"方案并否决，见决策日志）：

- **Phase 1 快照元素清单富化**：MCP 的 tool_result 带 `### Snapshot` 节（aria 树 YAML，形如
  `- button "+ 新建学科" [ref=e12]`），列出页面上**所有**可访问元素的 role/name —— 包括从未被
  点击的断言目标。现在这一节被整个丢弃。改为按用例抽取去重的元素清单（`{role, name}[]`）记进
  轨迹 → 生成模型写断言时有"页面真实存在哪些元素"的词汇表，可写出
  `getByRole('button', { name: '上传头像', exact: true })` 而非臆造 CSS class。
- **Phase 2 逐条增量入队**：执行流里每落一条 pass 的 `@@RESULT`（且用例带「回归测试」标签），
  平台侧立即为该用例入队生成任务（生成是纯文本 SDK 调用，不碰被测系统，与执行并行安全）；
  真机重放**延后**到执行结束（避免与执行智能体并发操作同一被测系统）。执行中途断流，
  已 pass 部分的脚本已在手。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 1 | 快照元素清单富化（trace 记 observedElements → 生成 payload/prompt 消费） | 🔄 进行中 | 独立可交付，先行 |
| Phase 2 | 逐条增量入队 + 触发点前移（执行收口兜底入队 + 未执行守卫） | 📋 待开始 | 依赖 Phase 1 的 trace 结构落定 |

## 决策日志

- 2026-07-16: **否决"执行时由执行智能体直接生成脚本"**。理由：① 执行流已 60+ 分钟、
  两次被跨境网络掐断，再塞几十份脚本全文会加重断流概率与单次损失；② 执行 prompt 纪律
  （逐条执行/覆盖自检/@@RESULT 协议）已重，注意力摊薄两头质量都掉；③ 失去"单轮 JSON
  Schema + tools:[] + 平台原子落盘"的控制面；④ 真机重放本就只能事后跑，可见报错不会减少；
  ⑤ 拿不到 manifest 指纹状态，每轮全量烧 token。平台侧"锚点富化 + 增量入队"以低风险
  拿到同样两个收益。
- 2026-07-16: **【设计修正】开工核查真实数据后推翻原 Phase 1 前提**。原以为"轨迹里是不可重放的
  ref、模型只能猜定位器"。实测 @playwright/mcp 0.0.76 的 tool_result `### Ran Playwright code`
  节**已经给出解析好的语义定位器**（真实轨迹：`await page.getByRole('button', { name: '+ 新建学科' }).click();`），
  被操作过的元素根本无需富化。真正的缺口是**只在快照里出现、从未被操作的元素**（断言目标）
  —— 轨迹对它们零记录，模型只能臆造（`.avatar-uploader` 即此类）。故 Phase 1 从"ref→锚点翻译"
  改为"抽取 `### Snapshot` 节的元素清单作为断言词汇表"。附带纠正：MCP 入参字段名是 `target`
  （可为 ref 或选择器）+ 可选 `element` 描述，并非原以为的 `ref`。
- 2026-07-16: **observedElements 不进 `normalizedTraceHash`**。它是生成增强信息，不改变"执行了
  什么"的语义。若计入 hash，升级当天所有存量脚本语义指纹漂移 → 全量重生成 churn。代价：存量
  脚本不自动享受质量提升，需用户对个别任务「重试缺口」（forceRefresh 已支持）。
- 2026-07-16: **增量任务跳过真机重放（deferReplay），统一由执行收口后的既有自动流水线补跑**。
  生成期重放会与执行智能体并发操作同一被测系统（数据互踩）。runAndRepairLoop 本就跑
  `verified|needs_review` 全集，延后重放零新增机制。
- 2026-07-16: **报告触发保留为幂等兜底，另在执行收口（wrapExecutionStream finally，run.json +
  trace 已落盘后）加一次入队**。同 runHash 会被 enqueueScriptJob 现有去重短路，健康轮次
  行为不变；断流轮次（报告不跑）也能收口一次完整 job（此时增量任务已把 pass 用例生成完，
  收口 job 走指纹复用，零模型消耗）。
- 2026-07-16: **「未执行」守卫**：中断轮次的 run.json 会把没跑到的用例补成
  blocked+NOT_EXECUTED_MSG。收口 job 对这类用例**保留 manifest 旧条目原样**（不标 stale）——
  它们不是"失去资格"，只是这轮没轮到；否则一次断流会把几十条 verified 脚本打成 stale。

## 详细设计

### Phase 1 快照元素清单富化

**事实依据**（开工核查 @playwright/mcp 0.0.76 + 真实 trace，见决策日志）：MCP 的 tool_result
是分节文本，`### Ran Playwright code`（```js 围栏）已给出**被操作元素**的语义定位器；
`### Snapshot` 节（```yaml 围栏）是整页 aria 树，行形如 `- button "+ 新建学科" [ref=e12] [cursor=pointer]`，
**涵盖所有可访问元素**（含从未被点击的断言目标）。`browser_click` 等 input 型工具也会
`setIncludeSnapshot()`，故快照不止出现在 `browser_snapshot` 的响应里。

**数据流**：`exec-stream` 已把 `tool_use`/`tool_result` 帧喂给 `ScriptTraceCollector`
（exec-stream.ts:241-244），收集器目前只从 content 抽 `### Ran Playwright code`，丢弃 Snapshot 节。

改动（全部在平台侧，不动执行 prompt）：

| 文件 | 改动 |
|------|------|
| `src/lib/test/script-trace.ts` | ① 新增 `extractAriaSnapshot(content)`：取 `### Snapshot` 后的 ```yaml 围栏内容（文件链接形态 `- [Snapshot](path)` → 返回空，不读盘）；② 新增 `parseSnapshotElements(yaml)`：逐行匹配 `- <role> "<name>" [ref=…]`，产出 `{role, name}`（name 走 YAML 转义还原：`\"`→`"`；role 取 `- ` 后首个 token；无 name 的行跳过——无名元素对断言无价值）；③ `feedToolResult` 对每个 result 解析快照并把元素并入 `elementsByCase[activeCaseId]`（Map<caseId, Map<role+name, {role,name}>> 去重，**按用例并集**而非按快照代际——它是"这条用例执行期间页面上存在过的元素"词汇表）；④ 上限：单用例 120 个、name 截断 100 字符（防大页面 aria 树撑爆 trace）；⑤ 元素文本过 `redactTraceText`；⑥ 新增 `finishElements(): Record<caseId, ObservedElement[]>`；⑦ `normalizedTraceHash` **保持现口径**（不含 observedElements，见决策日志） |
| `src/lib/test/script-trace.ts`（落盘） | `writeTraceFile` 增参 `elementsByCase`，以新行类型 `{type:'elements', caseId, items:[{role,name}]}` 落 JSONL；`readTraceFile` 解析该类型进 `ScriptTraceFile.elementsByCase`（旧文件无此行 → 空 Map，向后兼容；`readTraceFile` 现有 `type==='action'` 过滤天然忽略未知行） |
| `src/lib/test/script-generator.ts` | ① `EligibleScriptCase` 增 `observedElements: ObservedElement[]`；`selectEligibleCases` 增参 `elementsByCase` 并按 caseId 取（`retargetLibraryCandidates` 原样透传）；② payload 增 `observedElements`；③ system prompt 增段：`observedElements 是执行当时从页面可访问性树观察到的真实元素（role + name），是断言定位器的事实来源。断言只能用 executedPlaywrightCode 里出现过的定位器，或 observedElements 里的元素（写成 getByRole(role, { name, exact: true })）。【严禁】臆造 CSS class/结构选择器（如 .avatar-uploader）——清单里没有的元素不要断言它存在`；④ repair prompt 同步该规则并在 payload 附 observedElements |
| `src/lib/test/script-job-manager.ts` | `currentInputs` 读 trace 时一并取 `elementsByCase` 并传入 `selectEligibleCases`；repair 路径构造候选时同样带上 |
| `src/lib/test/script-artifacts.ts` | `SCRIPT_GENERATOR_VERSION`/`SCRIPT_TEMPLATE_VERSION` **均不动**（不改变模板语义，且不得触发存量指纹漂移）；trace 文件 version 仍为 1（新增行类型向后兼容） |
| `src/__tests__/unit/script-trace-elements.test.ts`（新） | Snapshot 节抽取（```yaml 围栏 / 文件链接形态 / 无 Snapshot 节）；元素行解析（中文 name、转义引号、多级缩进、`[cursor=pointer]` 等尾随属性、无 name 行跳过、`- text:` 行跳过）；按用例并集去重与 120 条上限；脱敏；**observedElements 不影响 `normalizedTraceHash`**（指纹稳定契约）；JSONL 往返（write→read）与旧文件兼容 |
| `src/__tests__/unit/test-script-generation.test.ts` | payload 含 observedElements 的断言补充 |

**边界**：
- Snapshot 节可能是文件链接形态（`_includeSnapshotFileName` 配置下）→ 不读盘、当作无快照（best-effort）；
- 快照可能被 MCP 输出预算截断 → 解析到多少算多少；
- 元素并集跨页面/状态（一条用例内导航多页）→ 清单是**词汇表提示**而非"断言时一定在场"，prompt 措辞需据实说明；
- 无 name 的元素（`- generic [ref=e1]`）不入清单：对断言无价值且量大。

**验收**：
- `npm run test` 全过；
- 真机一轮功能测试后抽查 trace.jsonl：`elements` 行存在，role/name 与页面真实元素一致，
  且包含从未被点击的元素（断言目标）；
- 用带 observedElements 的轨迹重生成 1-2 条脚本，确认断言定位器取自清单/轨迹而非臆造 class。

### Phase 2 逐条增量入队 + 触发点前移

**数据流**：执行流中 `@@RESULT` pass + 用例带「回归测试」标签 → 立即入队该用例的生成任务
（内存直传轨迹切片，不等 trace 文件）；执行收口后由既有链路统一重放/修复/对账。

| 文件 | 改动 |
|------|------|
| `src/lib/test/script-trace.ts` | `ScriptTraceCollector` 增 `drainCase(caseId): ScriptTraceAction[]`——返回该用例已收集的 actions 快照（不清空，finish() 口径不变） |
| `src/lib/test/exec-stream.ts` | ① 开流即读 cases.json（现在是收口才读），建 `id → { body, isRegression }`；② 行缓冲里检出 `@@RESULT` pass 且 isRegression → `enqueueIncrementalScriptCase({ projectPath, taskName, env, caseBody, traceActions: collector.drainCase(id), model, providerId })`（fire-and-forget，失败仅 console.warn，不得影响执行流）；③ finally（run.json + trace 落盘后）追加 `enqueueScriptJob({ ..., runHash, runPipeline: true })` 兜底收口（同 hash 由现有去重短路） |
| `src/lib/test/script-job-manager.ts` | ① 新导出 `enqueueIncrementalScriptCase`：包装成 `forceCaseIds:[id]` + `inlineInputs`（直传 caseBody/traceActions，`currentInputs` 优先取之）+ `deferReplay: true` + 临时 runHash（`incr-${runStartMs}`；**不更新 manifest.latestRunHash**——权威 hash 只属于收口 job）的队列条目，复用现有单并发队列与 `.generation.lock`；② `validateAndPublish` 支持 `deferReplay`：跳过真机重放，落 `needs_review` + warning「重放延后至执行结束，由自动跑通统一验证」（collect 校验照做）；③ `executeJob` 收口对账加「未执行守卫」：previous 条目对应的本轮结果 error 含 `NOT_EXECUTED_MSG` → 原样保留（不 stale、不重生成）——需要 reduce 侧把该常量导出或在 run.json 结果上带 `notExecuted: true` 标记（取后者，见下） |
| `src/lib/test/reduce.ts` | 兜底补全的未执行条目加 `notExecuted: true`（ReducedTest 可选字段，向后兼容） |
| `src/lib/test/script-regression.ts` | 重放资格判定无需改（needs_review 无 lastRunError 本就可重放）；确认 deferReplay 产生的条目走现有口径即可 |
| `src/__tests__/unit/script-incremental.test.ts`（新） | pass+回归标签才入队（fail/无标签/重复 RESULT 不入队）；inlineInputs 优先于文件读取；deferReplay 跳过重放且 warning 到位；临时 hash 不污染 latestRunHash；收口 job 对 notExecuted 条目保留原状（不 stale）；断流模拟：增量已生成 + 无收口 job → manifest 条目存在且可被下轮指纹复用 |

**边界与风险**：
- 增量生成与执行并行共用企业网络出口——生成失败照旧走瞬时错误退避 + outdated 保留，
  不影响执行流本身；
- 同一执行流重复输出同 id 的 `@@RESULT`（模型违规）→ 只入队第一条（Set 去重）；
- 增量任务在 manifest 上产生的中间态（jobStatus running/partial 交替）会被脚本卡 2s 轮询
  看到——属预期（用户可见"边测边沉淀"），不做 UI 改动；
- 回归用例库轮次（脚本重放优先）：阶段 A 的 `via:'script'` 结果不入队（已有防 churn 短路
  口径一致——增量入队同样跳过 `via === 'script'` 的 RESULT）。

**验收**：
- `npm run test` 全过；
- 真机：功能测试轮执行中途 kill 掉执行流 → 已 pass 的回归用例脚本已生成落盘（manifest
  可见、文件存在），报告未跑；恢复后下一轮全量执行收口 job 指纹复用、零模型消耗；
- 真机：健康完整轮 → 行为与现状等价（报告触发被去重短路，产物/状态一致），且执行结束后
  自动流水线统一补跑重放;
- 真机：中断轮收口后,manifest 里未执行用例的旧 verified 条目未被打成 stale。

## 依赖与顺序

Phase 1 先行（独立交付,trace 新字段落定后 Phase 2 的 inlineInputs 才有稳定形状）。
两 Phase 均不改 DB schema、不改执行 prompt、不改 i18n(manifest warnings 现状即中文明文)。
完成后更新 docs/handover/regression-script-generation.md(数据流/字段/触发点三节)。
