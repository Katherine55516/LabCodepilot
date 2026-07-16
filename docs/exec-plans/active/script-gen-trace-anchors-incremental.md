# 回归脚本生成 · 轨迹锚点富化 + 逐条增量入队

> 创建时间：2026-07-16
> 最后更新：2026-07-16
> 关联：docs/handover/regression-script-generation.md（现状全貌）、docs/exec-plans/active/regression-script-replay.md（下游消费方）

## 背景与目标

真机使用暴露两类痛点（2026-07-16 用户反馈）：

1. **定位器"盲翻译"误差**：生成模型看不到真实 DOM，只能从执行轨迹的代码片段和用例文字里
   "猜"一个可重放定位器。被测前端缺少 testid/aria 锚点时，模型退化到组件库内部 class
   （如 `.avatar-uploader`），重放时 `element(s) not found` —— 这是同类项目里脚本
   首跑失败的最大来源。
2. **断流全丢**：脚本生成由【报告成功】门控。执行流被网络掐断（本环境跨境链路间歇丢包，
   已两次真机复现：82/93、29/93 处断流）→ 报告不跑 → 已通过用例的脚本一个都不沉淀，
   整轮 token 白烧。

两个改进（曾评估"执行时让智能体顺手生成脚本"方案并否决，见决策日志）：

- **Phase 1 轨迹锚点富化**：MCP 每次工具调用的 tool_use.input 携带 `ref` + `element` 描述，
  tool_result 的 content 携带页面 aria 快照（`- button "新建学科" [ref=e12]`）。现在这两样
  都被丢弃。把"ref 对应元素的真实语义属性（role/name/testid/文本）"记进轨迹 → 生成模型拿到
  "这个元素真实长什么样"的铁证，多数场景可确定性地写出 `getByRole(..., { name, exact: true })`。
- **Phase 2 逐条增量入队**：执行流里每落一条 pass 的 `@@RESULT`（且用例带「回归测试」标签），
  平台侧立即为该用例入队生成任务（生成是纯文本 SDK 调用，不碰被测系统，与执行并行安全）；
  真机重放**延后**到执行结束（避免与执行智能体并发操作同一被测系统）。执行中途断流，
  已 pass 部分的脚本已在手。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 1 | 轨迹锚点富化（trace 记锚点 → 生成 payload/prompt 消费） | 📋 待开始 | 独立可交付，先行 |
| Phase 2 | 逐条增量入队 + 触发点前移（执行收口兜底入队 + 未执行守卫） | 📋 待开始 | 依赖 Phase 1 的 trace 结构落定 |

## 决策日志

- 2026-07-16: **否决"执行时由执行智能体直接生成脚本"**。理由：① 执行流已 60+ 分钟、
  两次被跨境网络掐断，再塞几十份脚本全文会加重断流概率与单次损失；② 执行 prompt 纪律
  （逐条执行/覆盖自检/@@RESULT 协议）已重，注意力摊薄两头质量都掉；③ 失去"单轮 JSON
  Schema + tools:[] + 平台原子落盘"的控制面；④ 真机重放本就只能事后跑，可见报错不会减少；
  ⑤ 拿不到 manifest 指纹状态，每轮全量烧 token。平台侧"锚点富化 + 增量入队"以低风险
  拿到同样两个收益。
- 2026-07-16: **锚点不进 `normalizedTraceHash`**。锚点是生成增强信息，不改变"执行了什么"
  的语义。若计入 hash，升级当天所有存量脚本语义指纹漂移 → 全量重生成 churn。代价：存量
  脚本不自动享受锚点质量提升，需用户对个别任务「重试缺口」（forceRefresh 已支持）。
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

### Phase 1 轨迹锚点富化

**数据流**：`exec-stream` 已把 `tool_use`/`tool_result` 帧喂给 `ScriptTraceCollector`
（exec-stream.ts:241-244），只是收集器丢弃了输入参数与快照。

改动（全部在平台侧，不动执行 prompt）：

| 文件 | 改动 |
|------|------|
| `src/lib/test/script-trace.ts` | ① `feedToolUse` 增读 `value.input`：提取 `ref`（string）与 `element`（人类描述），存进 PendingTool；② 维护「最近一次快照的 ref → 元素语义」映射：`feedToolResult` 的 content 里凡出现 aria 快照区段（行形如 `- role "name" [ref=eN]`，含 `[ref=` 即触发解析），整表替换（ref 按快照代际失效，不能跨快照累积）；③ action 落盘时若 pending 带 ref，从映射查出 `{ role, name, testid? }`，与 `element` 描述一起写进新字段 `anchor?: { ref: string; element?: string; role?: string; name?: string; testid?: string }`；④ 锚点文本过 `redactTraceText` 脱敏；⑤ `normalizedTraceHash` **保持现口径**（不含 anchor，见决策日志） |
| `src/lib/test/script-generator.ts` | ① payload 的 `executedPlaywrightCode[]` 每项附 `anchor`（有则带）；② system prompt 增一段：`anchor 是执行当时该元素在页面可访问性树里的真实属性（role/name/testid），是定位器的第一事实来源：有 testid 用 getByTestId；否则用 getByRole(role, { name, exact: true })。禁止用 CSS class/结构选择器替代 anchor 已给出的语义定位。轨迹代码里的 aria-ref/eN 引用一律用 anchor 翻译，不得照抄`；③ repair prompt 同步该规则（修复输入的 testCase 旁附该用例轨迹锚点摘要） |
| `src/lib/test/script-artifacts.ts` | `SCRIPT_TEMPLATE_VERSION` **不动**（锚点不改变模板语义）；trace 文件 version 仍为 1（新字段向后兼容，旧读者忽略） |
| `src/__tests__/unit/script-trace-anchors.test.ts`（新） | 快照 ref 表解析（含中文 name/引号转义/多级缩进）；跨快照代际替换（旧 ref 不残留）；anchor 附着到对应 action；**anchor 不影响 normalizedTraceHash**（指纹稳定契约）；脱敏覆盖 anchor 字段 |
| `src/__tests__/unit/test-script-generation.test.ts` | payload 含 anchor 的断言补充 |

**边界**：
- 快照区段可能被 tool_result 截断/缺失 → 查不到 ref 就只落 `element` 描述，anchor 字段可部分缺省；
- `browser_snapshot` 之外，导航/点击类 result 也可能带快照——统一按"content 含 `[ref=` 就解析"处理；
- testid 提取依赖快照文本是否暴露（aria 树通常不含 testid）→ testid 为 best-effort，主力是 role+name。

**验收**：
- `npm run test` 全过；
- 真机一轮功能测试后抽查 trace.jsonl：ref 式操作的 action 带 anchor 且 role/name 与页面一致；
- 用带 anchor 的轨迹重生成 1-2 条脚本，确认定位器采用 getByRole/getByTestId 且与 anchor 一致。

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
