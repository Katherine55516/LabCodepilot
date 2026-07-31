# 回归脚本 · 执行期断言取证（方案 A′）

> 创建时间：2026-07-27
> 最后更新：2026-07-27
> 技术背景见 [docs/handover/regression-script-generation.md](../../handover/regression-script-generation.md)
> 前序工作见 [completed/script-gen-trace-anchors-incremental.md](../completed/script-gen-trace-anchors-incremental.md)（快照元素清单 + 逐条增量沉淀）

## 状态

> ⚠️ **2026-07-27：Phase 0 已完成，触发计划自设的中止条件 → Phase 1-5 暂缓。**
> 取样结论见 [research/regression-assertion-evidence-sampling.md](../../research/regression-assertion-evidence-sampling.md)。
> 本文档保留为已论证的设计，等 UI 密集型项目的真机数据出现再评估重启（重启信号见下方 Phase 0 结论）。

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 真机取样与契约冻结 | ✅ 已完成 | **未跑新回归**——改为离线挖掘历史产物（17 脚本 / 3 轨迹 / 4 条真实修复记录），零模型调用。结论：中止 |
| Phase 1 | 标记契约 + 轨迹落盘（不动生成侧，纯旁路观察） | ⏸ 暂缓 | 待重启信号 |
| Phase 2 | 生成期消费：payload 加 `capturedEvidence`，断言事实来源重排序 | ⏸ 暂缓 | |
| Phase 3 | 覆盖度校验 + 恒真断言硬拒（防假绿） | ⏸ 暂缓 | **重启时必须与 Phase 2 同批**，理由见决策日志 |
| Phase 4 | 真机验收：打包态 + live SUT 跑两轮，对比 Phase 0 基线 | ⏸ 暂缓 | |
| Phase 5 | 回退开关 + 观测指标落 `test_stats_events` | ⏸ 暂缓 | |

## Phase 0 结论（2026-07-27）

| 指标 | 实测 | 判定 |
|---|---|---|
| 标记服从率（`@@CASE_START`） | **100%**（10/10） | 契约可靠，不是瓶颈 |
| 首轮 verified 率 | **93%**（14/15，唯一例外是 `ECONNREFUSED` 环境问题） | 生成侧无明显缺口 |
| 断言臆造率 | **4.7%**（6/127）——83% 的断言压根不涉及 DOM 定位 | **低于 15% 中止线** |

**根因诊断被推翻**：计划假设 `structural` 断言源于「aria 树给不出 role/name，模型只能臆造 CSS class」。真机数据显示是**用例设计阶段就把 Tailwind 实现类写进了 `expected`**（`颜色标识圆点（w-3 h-3 rounded-full）`、`卡片以 2 列响应式网格排列（md:grid-cols-2）`），生成模型是在忠实执行用例。4 条真实失败里 2 条由此而来，A′ 只能治其中 1 条。

**改投方向**（详见取样文档）：
- **P0** 用例 `expected` 禁写实现细节 — 治理点在 `rules/test-case-completeness.md` 与 cases 生成 prompt，不在脚本生成侧
- **P1** 唯一化测试数据（原「第一梯队」方案 J）

**重启信号**：出现 UI 密集型被测项目，且 `structural` + `semantic-unverifiable` 占断言总数 > 20%，其中多数**不能**追溯到用例 `expected` 里写死的实现细节。

## 决策日志

- **2026-07-27（Phase 0 后）：暂缓 Phase 1-5，改投用例设计侧治理。**
  取样触发了计划自设的中止条件（臆造率 4.7% < 15%），且更重要的是**根因诊断被推翻**——`structural` 断言不是模型臆造，是用例 `expected` 里写死的 Tailwind 类传导下来的。在源头没治的情况下做取证，等于给一条本就走偏的链路加固中段。
  另一条被数据修正的假设：计划默认回归用例以 UI 操作为主，实测 10 条执行用例里 8 条是接口测试、83% 的断言打在 HTTP 状态码与响应体字段上——`@@EVIDENCE` 记录「看到了哪个元素」对它们完全无关。这一条限定了 A′ 的天花板：**它的作用面等于「UI 断言占比」**，而这个比例是被测项目和用例设计决定的，不是脚本生成能改的。
  **Phase 0 的方法本身值得复用**：原计划写的是「现网跑 1 轮回归」，实际改为离线挖掘历史 manifest/trace/spec.ts，零模型调用、零环境依赖，且拿到了跨 3 个任务的历史广度。以后同类「先量化再动手」的 Phase 0 都应优先走这条路。

- **2026-07-27：采用 A′（只取判定依据）而非 A（取可执行断言代码）。**
  A 让执行期智能体直接写出 `await expect(...)` 并当场自验，生成期原样搬运。看似更彻底，但它把取证升格成**不可推翻的权威**，打开两个新失败面：
  1. **取证误差被误报成产品缺陷**。修复红线现在是二分的——技术缺陷则修、断言如实失败则 `fixed=false` 判需人工。一条**抄错**的权威断言，在修复模型眼里与「页面行为 ≠ 用例预期」完全同形，会被 park 成需人工。测试人员将去追查一个不存在的 bug。要救它就得把红线改成三分（技术缺陷 / 取证误差 / 如实失败），而红线是这套系统最不该轻易动的东西。
  2. **恒真断言导致无声假绿**。执行智能体有结构性动机偏差：它刚判完 pass，现在要写一个「能通过」的断言，最省力的写法是 `expect(page.locator('body')).toBeVisible()`。而「当场自验通过」只能证明*此刻此页成立*，证明不了*这个断言在验用例该验的东西*。此后该用例每轮都绿、永不报警，回归对它实际已失效——比失败面 1 危险得多，因为没有任何信号。
  A′ 只让执行智能体**声明它看到了什么**（结构化观察，不是代码），断言代码仍由生成模型写、由校验器管、由修复模型自由改。**修复闭环语义零变化，红线维持二分。** 拿到最大的那部分收益（断言目标从「猜」变成「记录」），不引入上述两个失败面。
  A 降级为「A′ 真机验证有效后的可选加强」，届时再单独评估是否值得为它改红线。

- **2026-07-27：`@@EVIDENCE` 不进 `normalizedTraceHash`。**
  与 `elementsByCase` 同一条理由（见 completed/script-gen-trace-anchors-incremental.md）：进指纹会让升级当天全部存量脚本语义漂移、被判需重生成，一次性烧掉整个回归库的模型额度。旧读者按 `type === 'action'` 过滤天然忽略新行，无需 bump trace version。

- **2026-07-27：Phase 3 必须与 Phase 2 同批发版，不得拆开上线。**
  Phase 2 单独上线只补了「断言目标从哪来」，没堵「断言够不够强」。而取证一旦成为生成模型的第一事实来源，模型会更倾向于照抄那条观察、写出**只覆盖单个观察点**的弱断言——即在补洞的同时**扩大**了假绿面。覆盖度校验（每个 step 的 expected 至少被一条断言覆盖）与恒真断言硬拒是这次改动的安全带，不是后续优化。

- **2026-07-27：取证缺失必须静默降级，绝不影响执行判定。**
  `markers.ts` 模块头记录过真实事故：模型把 3 条 `@@RESULT` 全部加粗 → 平台一条没收割到 → 报告显示 0/3 全阻塞。标记是概率性输出，`@@EVIDENCE` 的服从率一定低于 `@@RESULT`（它不影响用例判定，模型动机更弱）。因此：无取证 = 回落到现有的「轨迹 + observedElements 推导」路径，与今天行为完全一致；取证只做增强，不做前置条件。

## 详细设计

### 问题

生成模型看不到 DOM，断言定位器只能从证据里重建。但现有两路证据都有洞：

- `executedPlaywrightCode`（MCP 的 `### Ran Playwright code`）**只覆盖被操作过的元素**。MCP 吐的已经是语义定位器（`page.getByRole('button', { name: '打开' }).click()`），操作路径照抄即可，不是问题所在。
- 断言经常打在**只出现、从未被点击**的元素上（「验证列表中出现新建的学科」）。这类元素在动作轨迹里零记录，模型只能猜 → 臆造组件库内部 class（`.avatar-uploader`）→ 重放 `element(s) not found`。
- `observedElements`（快照元素清单）补上了「页面上有哪些具名元素」这个**词汇表**，但它是**整条用例的并集**，回答不了「这条 expected 该断言哪一个」。模型仍在做匹配推断。

缺的是最后一环：**执行智能体判 pass 时，究竟是看到了什么才判的。** 那个信息此刻只存在于模型的推理里，从不落盘。

### 目标与非目标

**目标**：把「判定依据」从执行期的一次性推理变成落盘证据，作为生成期断言定位器的第一事实来源。

**非目标（明确不做）**：

- ❌ 不让执行智能体写可执行断言代码（方案 A，见决策日志）
- ❌ 不改测试流程四节点（requirement → cases → execution → report）
- ❌ 不改修复红线的二分语义
- ❌ 不改 manifest 既有字段语义，不改 trace version，不进语义指纹
- ❌ 不改脚本重放优先（`script-regression.ts`）的任何逻辑

### 契约：`@@EVIDENCE`

执行智能体在**每条用例的 `@@RESULT` 之前**，为该用例的每个关键检查点输出一行：

```
@@EVIDENCE {"id":"TC-001","stepIndex":2,"observed":{"role":"cell","name":"数学"},"note":"列表中出现新建的学科"}
```

| 字段 | 含义 | 必填 |
|------|------|:---:|
| `id` | 用例 id，须与 `cases.json` 完全一致 | ✅ |
| `stepIndex` | 覆盖的是 `steps[]` 的第几条（0-based）。用例结构是 `steps:[{content,expected}]`，**每个 step 配且仅配一条 expected**，故 step 下标即 expected 的天然引用 | ✅ |
| `observed.role` / `observed.name` | 判定所依据的元素，取自当时 aria 快照，`name` 逐字照抄 | ✅ |
| `observed.text` | 若判定依据是整页文本而非具名元素（统计数字跨 DOM 元素拼接的情形），给出被检查的确切子串 | ⭕ 二选一 |
| `note` | 一句话说明「我据此判 pass」 | ⭕ |

写法约束沿用 `@@RESULT` 的既有铁律：裸写、单行严格 JSON、不加粗、不套反引号。

### 分阶段

#### Phase 0 — 真机取样与契约冻结

没有基线就无法证明这次改动有效。先在现网跑一轮真实回归（建议用已有踩坑最多的 `mealAllowance` 或学科管理任务），量化三个数：

1. **断言臆造率** — 生成期重放失败中 `element(s) not found` / `strict mode violation` 的占比
2. **首轮 verified 率** — 生成后未经修复即 `verified` 的用例占比
3. **标记服从率基线** — `@@CASE_START` 的实际输出率（`@@EVIDENCE` 的服从率不会高于它）

产出：`docs/research/` 下一份取样记录 + 冻结后的 `@@EVIDENCE` schema。

**若臆造率本就很低（< 15%），本计划应当中止**——说明快照元素清单已经吃掉了大部分收益，不值得再加执行期负担。

#### Phase 1 — 标记契约 + 轨迹落盘（纯旁路，可独立发版）

| 文件 | 改动 |
|------|------|
| `src/lib/test/prompts.ts:300` | 执行 prompt 第 4 条追加 `@@EVIDENCE` 约定。**必须明确它不参与覆盖自检**——第 8 条数的是 `@@RESULT` 行数，绝不能让模型误以为 EVIDENCE 也要凑数 |
| `src/lib/test/markers.ts` | **零改动**。`harvestMarkerObjects(text, 'EVIDENCE')` 直接可用——这正是当初把解析器收敛成唯一实现的红利 |
| `src/lib/test/script-trace.ts:192` | `ScriptTraceCollector` 增 `evidenceByCase`；沿用 `elementsByCase` 的模式：按用例聚合、封顶（建议 40 条/用例）、`name`/`text` 截断到 100 字符、**单独脱敏**（解析走未脱敏原文，理由同 elements） |
| 同上 | 落 trace 的 `{"type":"evidence"}` 行；`ScriptTraceFile` 加 `evidenceByCase` 字段，`version` **不 bump** |
| `src/lib/test/script-generator.ts:66` | **确认 `normalizedTraceHash(actions)` 只吃 actions**，evidence 不得渗入 |

单测（新建 `script-trace-evidence.test.ts`）：解析/聚合/封顶/脱敏/**指纹隔离**（加了 evidence 后 `semanticFingerprint` 必须逐字不变——这条是防存量 churn 的守卫）。

⚠️ fixture 必须取自**真机 SSE 原文**。历史教训：快照元素清单初版拿自造数据单测全绿，真机 elements 收到 0 条。

#### Phase 2 — 生成期消费

| 文件 | 改动 |
|------|------|
| `src/lib/test/script-generator.ts:236` | `payload` 每条加 `capturedEvidence: [{stepIndex, observed, note}]` |
| 同上 · system prompt | 断言事实来源**重排序**：① `capturedEvidence`（执行期实测记录，最高优先）② `executedPlaywrightCode`（真实跑过的定位器）③ `observedElements`（词汇表）。现有「严禁臆造 CSS class」「`toContainText` vs `getByText`」等规则全部保留 |
| 同上 | 新增一条：`capturedEvidence` 里 `stepIndex` 覆盖到的 step，其断言**必须**用该条记录的 `observed`；`observed.text` 形态一律走 `locator("body").toContainText(...)`（已有踩坑规则，此处只是绑定到取证） |
| `src/lib/test/script-generator.ts:397` | 修复 prompt 同步：`capturedEvidence` 一并喂给修复模型。**措辞必须是「参考」不是「权威」**——修复模型有权判定取证抄偏并改断言，红线维持二分 |

#### Phase 3 — 覆盖度校验 + 恒真断言硬拒（与 Phase 2 同批）

`src/lib/test/script-validator.ts` 增两类确定性校验：

**a) 恒真断言硬拒**（→ `errors`，直接判不合规，走已有的 `resolveStaticValidContent` 静态自纠闭环）

- `body` / `html` / `page` 上不带 name/text 的 `toBeVisible()` / `toBeAttached()`
- `expect(true)` / `expect(1).toBe(1)` / 无参 `toBeDefined()`
- 断言目标是纯 `page` 级且不含任何文本或 role 约束

**b) 断言出处校验**（→ `warnings` + 不给 `verified`，落 `needs_review`）

- 脚本里出现的断言文本 / `name` 值，必须能在 `capturedEvidence` ∪ `executedPlaywrightCode` ∪ `observedElements` 里找到出处；找不到即「疑似臆造」
- **覆盖度**：用例每个 `steps[i].expected` 至少被一条断言覆盖（有 `capturedEvidence` 时按 `stepIndex` 对齐，无取证时退化为「断言数 ≥ 1」的现状口径）

这是把「断言够不够」从模型自觉变成平台可判定——也是唯一能在 Phase 2 引入取证后**不扩大假绿面**的手段。

#### Phase 4 — 真机验收

打包态 + live SUT 跑两轮，对比 Phase 0 基线：

| 指标 | 期望 |
|------|------|
| 断言臆造率 | 显著下降（目标砍半） |
| 首轮 verified 率 | 上升 |
| `@@EVIDENCE` 输出率 | ≥ 70%，低于此说明 prompt 约定没被服从，需回炉 |
| **执行本身的质量** | **不劣化** — 用例 pass 率、漏跑率与基线持平。执行 prompt 变长可能挤占模型注意力，这是本方案最实际的成本，必须实测 |
| 存量脚本 churn | **必须为 0** — 升级后首轮不得触发任何非预期重生成 |

#### Phase 5 — 回退开关与观测

- 任务级或环境变量开关，一键关掉取证回到现状（沿用 `depositScripts` 的开关范式）
- 指标进 `test_stats_events`：取证输出率、覆盖度校验命中率、臆造拦截数

### 依赖项

- 无 DB schema 变更
- 无新第三方依赖
- 不改 manifest / trace 版本号，与存量产物完全兼容
- i18n：Phase 3 的校验 warning 文案需同步 `en.ts` / `zh.ts` / `zh-HK.ts`

### 验收标准

1. `npm run test` 全绿；新增单测覆盖：解析、聚合、脱敏、**指纹隔离**、覆盖度校验、恒真断言拒绝
2. Phase 4 的五项真机指标全部达标，尤其「执行质量不劣化」与「存量 churn 为 0」
3. 取证缺失路径与今日行为逐字一致（可通过关闭开关跑一轮回归对拍验证）
4. 交接文档更新 `docs/handover/regression-script-generation.md`；产品思考更新 `docs/insights/regression-script-generation.md`

### 风险与边界

| 风险 | 缓解 |
|------|------|
| 执行智能体不服从标记约定 | 静默降级到现状；Phase 4 用输出率把关，< 70% 则回炉而非硬上 |
| 执行 prompt 变长挤占注意力，拉低执行质量 | Phase 4 显式对比执行质量指标；Phase 5 开关可秒退 |
| 取证被模型写偏 | 修复 prompt 措辞是「参考」不是「权威」，修复模型有权推翻并改断言；红线不动 |
| 弱断言假绿面扩大 | Phase 3 同批交付，恒真硬拒 + 覆盖度校验 |
| 存量脚本全量 churn | evidence 不进 `normalizedTraceHash`，单测守卫 |
| **纯视觉结构断言仍无解** | aria 树里是无名 `generic`，取证给不出 role/name。**边界内**：这类用例只能靠被测端补 `data-testid`。可做的是把这类断言点汇总成清单反哺前端团队（本计划不含，另立） |
