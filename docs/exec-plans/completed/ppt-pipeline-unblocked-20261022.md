# PPT 从大纲到页面内容畅通无阻：环境、测试与生成阶段门禁

> 创建时间：2026-10-22
> 最后更新：2026-10-22
> 前置：[ppt-outline-calls-titles-selection-20261022.md](ppt-outline-calls-titles-selection-20261022.md)（大纲阶段已收敛：同一输入 8 次真实运行全部到达 `page_plan_ready`）。
> 分支 `claude/ppt-outline-improve-20261022`。

目标定义：**同一份输入连续 5 次运行，每次都从"确认页面计划"走到"可发布"（或"可发布，有 N 项待复核"），中途不出现 `failed`，也不因为模型判断类问题停在 `quality_blocked`。**

## 状态

| 阶段 | 内容 | 状态 | 备注 |
|---|---|---|---|
| 1 | selftest 只在产品真的坏了时失败（1.1–1.6） | ✅ 1.2–1.6 已完成 | 1.1 装 LibreOffice 需要用户同意下载；1.6 的 gamma-http 是产品缺口，已按用户批准修复（超大关系图跨页拆分） |
| 2 | 导出校验区分"没法验"和"验不过" | ✅ 已完成 | 顺带发现并修复撤销/重做颜色修改报 400 |
| 3 | 生成阶段门禁分级（写手版 O1）+ 生成调用账本与预算 | ✅ 已完成 | 编辑器内标记、应用建议/忽略已补上（[ppt-editor-review-advisories-20261022](ppt-editor-review-advisories-20261022.md)，并修复 live 投影丢失提示）；任务卡计数、只重审改动页仍未做 |
| 4 | 写手回复先编译后校验 + 真实回复回放语料 | ✅ 已完成 | "节点内同句重复"无真实样本，未做；越页事实由 W1 负责 |
| 5 | （可选）O2 / O3 全量 / O4 | ⏸ 暂缓 | 看阶段 3 数据再定 |
| 验收 | 同一输入连续 5 次真实运行都到可发布 | ✅ 第 2 轮 5/5（71c277e4） | 第 1 轮 3/5，三个确定性根因已修，见第 5 节 |

## 1. 33 个 selftest 失败的根因

最新一轮（提交 `c9bddc72`，运行脚本 `scripts/ppt/run-quality-selftests.mjs` 的同等条件）33 个失败逐个分类，没有一个是产品逻辑本身出错：

| 根因 | 数量 | 例子 | 性质 |
|---|---|---|---|
| 本机没有 LibreOffice（`soffice`） | 27 | `selftest-ppt-density`、`-http-pipeline`、`-export-integrity`、`-hard-rules`… | 环境。这些测试都走到"发布 → PPTX 转 PDF 校验可见性"，`ppt-pdf.mjs` 调 `soffice --headless --convert-to pdf` 找不到可执行文件 |
| 测试用模型替身没有登记新的审查阶段 | 3 | `summary-edit`、`editorial-http`（`outline:semantic-summary-audit`）、`gamma-http`（`outline:editorial-coverage-audit`） | 测试维护欠账。run17 在大纲里新增了这两类审查，三个替身（`test/ppt-pipeline-model-fixture.mjs`、`ppt-editorial-model-fixture.mjs`、`ppt-gamma-model-fixture.mjs`）按旧阶段列表分派，未知阶段直接抛 `Unregistered … stage` |
| 需要输出目录环境变量 | 2 | `compression-benchmark`（`PPT_BENCH_OUTPUT`）、`native-paragraph-rich`（`PPT_PARAGRAPH_OUTPUT`） | 官方运行脚本会设置这两个变量；单独运行时 `fs.mkdirSync(undefined)` 在第 2 行崩 |
| 断言形状过期 | 1 | `edit-intent`：`snapshotTemplate()` 返回 `analysisVersion: undefined`（内置模板没有这个字段），经 JSON 往返后键消失，严格深比较失败 | 产品侧小问题：快照不应输出值为 undefined 的键 |

对产品真正有意义的只有一条：**导出校验把"工具不存在"当成了"稿件不合格"**（`ppt-export-integrity.mjs` 把任何异常都记为 `export_integrity_failed` → `quality_blocked`）。这也是真实运行里 after4/5/6-gen-1 停下的原因：内容检查全部通过，只差这一步。

## 2. 真实流程现在停在哪

8 次真实生成（qwen3.8-max，同一输入）之后，大纲阶段不再是瓶颈（全部到达 `page_plan_ready`，19–25 次调用）。从确认计划到发布，剩下两类停点：

1. **导出校验**（环境）：见上。生产容器自带 LibreOffice，本机没有。
2. **整稿模型审查的判断**：`finalQualityReport` 把 `model_unsupported`、`model_conflict`、`model_repeated` 都记为 `error`，两轮 critic 修复（`maxQualityRepairs = 2`）后仍存在就 `quality_blocked`。after6-gen-2 停在：写手把"先路由到所属业务线的分片"写成"默认路由至…"，审查认为"默认"引入了例外。这是大纲阶段 O1 同一个问题在生成阶段的翻版：**模型判断被当作硬门禁，而且没有收敛机制**。

另有 3 次是确定性门禁或校验器的误判（`9.6万元` 读成 `6万`、覆盖审查回复重复 ID、图示正文重复标签），都已修。它们说明确定性检查需要一个真实回复的回放语料库。

## 3. 方案

### 阶段 1　让 selftest 只在产品真的坏了时失败

| 项 | 做法 | 验收 |
|---|---|---|
| 1.1 LibreOffice | 本机安装（下载需用户同意；`/Applications/LibreOffice.app` 也可由用户自行安装）。装好后 27 个测试真实跑通 | 27 个测试通过 |
| 1.2 没有 soffice 时的测试行为 | `test/ppt-tool-requirements.mjs` 的 `requireSoffice(name)`：探测 PATH 和 macOS 应用路径（找到应用路径时把它加进 PATH，Python 子进程才能用裸名 `soffice`）；不存在时打印 `SKIP <name>: soffice unavailable` 并以退出码 **77** 结束（automake 的 skip 约定）。`run-quality-selftests.mjs` 把 77 记为 `skipped`，不计入失败。CI 容器里有 soffice，不受影响 | 本机：27 个 SKIP，其余通过 |
| 1.3 三个模型替身 | 共用 `test/ppt-audit-double.mjs`：任何 `*-audit` / `*-precision` / `obligation-*` 阶段按 `jsonSchema` 生成"通过"的结论（ID 从 schema 的 enum 取）。替身在抛 `Unregistered` 之前先问它。要测拒绝行为的测试自己覆盖 | 3 个测试通过（或暴露出下一个真实问题） |
| 1.4 基准测试 | `PPT_BENCH_OUTPUT` / `PPT_PARAGRAPH_OUTPUT` 未设置时默认用临时目录 | 单独运行也能通过 |
| 1.5 `snapshotTemplate` | 只在有值时输出 `analysisVersion` | `edit-intent` 通过 |

### 阶段 2　导出校验区分"没法验"和"验不过"

- `ppt-export-integrity.mjs`：`soffice` 不存在（Python 的 `FileNotFoundError`）时记为 `nativeExport: {status:'unavailable', reason}`、`visualVerified:false`，**不**进入 `quality_blocked`；稿件 `completed`，任务卡和编辑器显示"未经导出校验"。真正的转换失败、页数不符、裁切仍然阻断。
- 产品决定：没有 LibreOffice 的环境允许发布但明确标注；生产环境不受影响。
- 测试：注入 `FileNotFoundError` 与注入"转换失败"两条路径。

### 阶段 3　生成阶段的门禁分级（O1 的写手版）

| 硬门禁（继续阻断） | 提示（一轮定向修复后不阻断） |
|---|---|
| 确定性检查：数值核对、锁定证据缺失、来源页引用、容量溢出、导出完整性 | `model_unsupported`、`model_conflict`、`model_repeated`、`model_missing` |
| 页面事实审查中"引用了不属于本页来源的事实"（有原文引证） | 同一来源内的措辞判断（"默认""显著"这类限定词） |

- 每个模型判断的发现最多一轮定向修复（现在是整轮 critic 修复 ×2，每轮重跑整稿审查）；之后转为编辑器提示：节点标黄，显示审查理由与来源引文，可一键接受修复建议或忽略。
- 发布状态 `completed`，`quality.status = passed_with_review`，任务卡显示"N 项待复核"。用户改完后重新发布，审查只重跑改动过的页。
- 生成阶段接入调用账本和总预算（写手、页面 QA、critic 轮、整稿审查），用尽后只保留硬门禁。
- 验收：向量检索输入连续 5 次都到可发布；记录每次调用数和提示数。

### 阶段 4　写手输出也"先编译、后校验"

- 统一的回复规范化层，在每个校验器之前运行：数组去重（重复 ID）、节点内同句重复、标签与正文重复、超长 `reason`、空白差异。
- 把真实回复固化为回放语料（图示标签重复、`[b_0020, b_0020]`、卡片自依赖、`9.6万元`、越页事实），每个确定性门禁在 CI 里对整个语料跑一遍；新门禁先过语料再合入。
- 验收：语料中每一条都不再触发修复轮或失败。

### 阶段 5　（可选）继续降调用

O2（大纲不写摘要正文）、O3 全量（主题内分页由代码切）、O4（覆盖审查只在语义大纲做一次）。不影响"畅通"，影响调用数和耗时；等阶段 3 数据再定。

## 4. 决策日志

- 2026-10-22：跳过用退出码 77 而不是 0——运行脚本能把"没跑"和"通过"分开统计；CI 有 soffice，不会出现 77。
- 2026-10-22：替身的通用兜底只对审查/义务类阶段生效，规划和写作阶段仍然必须显式登记，未知阶段照旧失败——否则测试会在替身"随便编"的内容上通过。
- 2026-10-22：`gamma-http` 不靠替身的图审计判"不等价"变绿。那样 b_0017、b_0061 会退回原文逐行，可以按行号分页；但 b_0017 的解析图与原 ASCII 逐框、逐分支、逐汇合一致，与事实相反的审查结论只是绕开容量的杠杆，正好掩盖这些 selftest 要发现的问题。
- 2026-10-22：用户批准产品改动：放不下一页的必选关系图按相邻行范围拆成多张部分图，跨页的边以延续卡片在两边都可见；"表格不能替代关系图"的门禁不放松。拆分只在整图放不下时允许，按与真实绑定相同的路径测量，避免两个门禁互相矛盾。

- 2026-10-22：阶段 3 的发布状态沿用已有的 `passed_with_warnings`，不新增 `passed_with_review`——前端、i18n、`publishEligible` 已经处理这个状态；提示用 `advisory:true` 和 `reviewAdvisories` 区分。
- 2026-10-22：页面事实审查（`claim_entailment_*`）整体保持阻断。计划表里"同一来源内的措辞判断"本应降为提示，但审查结论目前不区分"引用了别页事实"和"限定词措辞"，无法安全地只放过后者；等审查返回这个区分再拆。`claim_redundant`（重复陈述）属于判断类，降为提示。
- 2026-10-22：生成调用账本对所有项目记录，预算只对 outline-first 生效；预算用尽只停 critic 修复轮，不停写手和整稿审查——停审查会让发布状态变成 `not_evaluated` 而阻断，反而更不畅通。
- 2026-10-22：真实验收第 3 次被"页面事实"拦下后，曾考虑按"数字是否都在本页来源里"把页面事实审查也分级；查到真实原因是已推翻结论的镜像残留，就不做这个分级——真实的页面事实审查没有误拦，越页事实（W1 的案例）应继续阻断。
- 2026-10-22：阶段 4 的规范化放在传输边界（`modelCallTransport`），由各阶段自己的 response schema 驱动，而不是在每个校验器前各写一份：新阶段自动受益，规则只有一处。代价是测试替身不经过传输层，所以各阶段原有的局部处理保留，语料回放两条路径都测。规范化不改可见正文——正文变动必须有原文依据，格式规则不能决定。

## 5. 进展

### 阶段 1（2026-10-22）

- 1.2：`test/ppt-tool-requirements.mjs` 的 `requireSoffice()`；30 个需要发布导出的 selftest 首行调用它（原 27 个，加上替身修好后才走到发布的 `summary-edit`、`editorial-http`、`native-paragraph-rich`）。`run-quality-selftests.mjs` 把退出码 77 记为 `skipped`，`results.json` 增加 `skipped` 计数。设置 `PPT_REQUIRE_SOFFICE=1` 时缺工具即失败（CI 用）。
- 1.3：`test/ppt-audit-double.mjs`，`pipeline` 和 `gamma` 替身在报 `Unregistered` 之前先问它（`editorial` 替身回落到 `pipeline`）。
- 1.4：两个基准测试未设置输出变量时用临时目录。
- 1.5：`snapshotTemplate()` 只在有值时输出 `analysisVersion`（产品代码的唯一改动）。
- 结果：本机 **140 通过、1 失败、30 跳过**（之前 138 通过、33 失败）。
- **1.6 `gamma-http`：产品缺口，不是夹具漂移（复查后更正，已修复）。** 替身修好后，大纲走到 run17 的编辑容量路径并请求 `editorial-capacity-window`。最初记为"大表放不进 light 模板、夹具需重排"；复查发现拦截原因是必选关系图放不下，其中两个（b_0017、b_0061）在 light 模板里没有任何合法放置，重排和容量窗口回复都无法解决。用户批准产品改动后，放不下一页的关系图可以按相邻行范围拆到相邻页。详见下文"1.6"。

### 阶段 2（2026-10-22）

- `lib/ppt/export-verifier-python.mjs`：重新打开 PPTX 的结构校验（节点映射、字体、关系路径等）照常执行并作为门禁；之后若 `shutil.which('soffice')` 为空，直接返回 `status:'passed'`，其中 `renderedVisibility: {status:'unavailable', reason}`、`visualEvidence: {status:'unavailable'}`，不生成"已校验 PDF"。有 soffice 但转换失败仍然抛错，发布照旧被拦下。
- `lib/ppt-export-integrity.mjs`：`acceptanceAxes.nativeExport.renderedVisibility` 记录 `passed | unavailable | not_evaluated`；`renderedTextVerified` 只在真正通过时为 true。
- 编辑器导出对话框：`renderedVisibility === 'unavailable'` 时显示"已校验 PPTX 结构；本机没有 LibreOffice，页面渲染校验（裁切、遮挡）没有运行。分享前请打开文件检查。"（en / zh / zh-HK）。e2e `ppt-frontend-controls.spec.ts` 覆盖显示与不显示两种情况。
- 新 selftest `selftest-ppt-export-visibility-unavailable.mjs`（任何主机都运行，会从 PATH 里隐藏真实 soffice）：没有引擎 → `completed`、`renderedVisibility: unavailable`、可下载；一个转换失败的假 soffice → `quality_blocked`。
- 结果：之前 30 个被跳过的测试里，22 个现在本机直接通过，只保留真正依赖 LibreOffice 的 7 个（4 个断言渲染可见性通过，3 个直接调用 soffice 渲染 PDF 或转换文档）。`relational-templates` 改为在缺少用户模板（`PPT_MATRIX_TEMPLATE_DIR`）时跳过（`requireInputs`）。本机 **163 通过、1 失败（gamma-http，1.6）、8 跳过**。
- **顺带发现的产品缺陷**（原先被导出失败掩盖）：编辑器里改文字颜色或下划线后撤销再重做，返回 400 "textStyleOverrides is invalid"。`setNodeStyle` 把 `color`、`textDecoration` 记进覆盖列表（渲染器也认），但命令校验的白名单只有 6 个键。改为 `command-schema.mjs` 导出的同一份 `TEXT_STYLE_OVERRIDE_KEYS`，`editor-template-language` 现在完整通过。

### 阶段 3（2026-10-22）

- `ppt-quality.mjs` `finalQualityReport(..., { judgedAdvisory })`：outline-first 项目的 `model_missing / model_repeated / model_conflict / model_unsupported / claim_redundant` 从 error 改为 warning + `advisory` + `requiresReview`，报告新增 `reviewAdvisories`。`claim_entailment_*`、义务、确定性错误、未评估的审查仍阻断。三处生成报告的地方（生成结束、`deterministicGate`、`publish-service`）都传同一开关。
- `ppt-api.mjs` critic 循环：本轮目标页的发现全部是模型判断类时只修一轮（原来 `maxQualityRepairs` 默认 2 轮，每轮重跑整稿审查）。
- 生成调用账本 `project.generationCalls`（`total`、`byFamily`、`budget`），`PPT_GENERATION_CALL_BUDGET` 默认 160；outline-first 项目用尽后不再开修复轮，`criticRepair.stoppedReason = 'call_budget'`。
- 前端：工作区质量面板列出提示数和前 5 条理由；导出对话框显示"整稿审查有 N 项提示未阻断发布（已做过一轮定向修复）。展示或分享前请复核。"（en / zh / zh-HK）。
- 测试：`selftest-ppt-judged-advisory.mjs`（分级规则）；`selftest-ppt-judged-review-generation.mjs`（HTTP 全流程：outline-first 项目的审查一直报一条无依据 → 1 轮修复、`completed`、1 条提示、调用按族记账 `{content:4, content:critic:1, review:deck:1, review:deck:findings_confirmation:2}`；预算设为 1 → 0 轮、`call_budget`、仍发布；旧流程同样审查 → 2 轮后 `quality_blocked`）；e2e 新增提示显示/不显示两个用例。
- 与计划的差异：编辑器里节点标黄、一键接受/忽略修复建议、任务卡"N 项待复核"、重新发布只重审改动页，这几项没做，记为后续。
- 结果：本机 selftest **165 通过、1 失败（gamma-http，1.6）、8 跳过**（新增 2 个全部通过）；`npm run test` 3067 通过、1 跳过；e2e `ppt-frontend-controls` 6/6（单 worker；多 worker 并行时 webpack 开发服务器首编译超时）；`ppt-workspace` 单 worker 跑两次各有 2–3 个用例超时（创建、粘贴流程的 `fill` 等待，与质量面板无关），单独重跑通过，检查质量面板的 M4 用例通过。

### 阶段 4（2026-10-22）

- 规范化层 `lib/ppt-reply-normalize.mjs` `normalizeReply(value, schema)`，接在 `modelCallTransport` 的两条返回路径上（`settleReply`），所有阶段的回复在校验器之前先过一遍。只按该阶段自己的 schema 处理，不改可见正文：ID 列表去重、枚举值去空白、超长 `reason` 按边界截短（S3 的截短函数移到这里共用）。
- 覆盖审查导出 `coverageVerdictSchema` / `acceptedCoverageVerdict`，审查和精确复核共用，回放也用同一份。
- 回放语料 `test/fixtures/ppt-vector-search-real-replies.json`：真实运行输入原文 + 13 条真实回复（重复 ID ×4、卡片自依赖 ×3、图示正文重复标签 ×4、摘要里数字紧贴汉字 `从9.6万元` ×2）。`selftest-ppt-real-reply-corpus.mjs` 逐条送进生产编译和校验器，全部不触发修复轮；每条都先断言回复里确实还带着那个失误，并确认没有修复时会失败（自依赖被 `acceptSemantic` 拒绝、ID 不唯一、修复前的数值解析在 `6万` 上失败）。
- 新增 `selftest-ppt-reply-settle-transport.mjs`：经真实桌面任务队列返回的覆盖审查回复在调用方拿到之前已去重并打日志；没有 schema 的回复原样返回。单元测试 `ppt-reply-normalize.test.ts` 覆盖四条规则。
- 与计划的差异：计划里的"节点内同句重复"没有真实回复样本，没做——规范化层不改正文，等有真实样本再加，避免误删。越页事实是模型行为，不能确定性回放，由 W1 的提示词范围收窄和它的单元测试负责。
- 结果：本机 selftest **167 通过、1 失败（gamma-http，1.6，原因不变）、8 跳过**（新增 2 个通过）；`npm run test` 3071 通过、1 跳过（新增 4 个单元测试）。

### 真实模型验收 第 1 轮（2026-10-22，a58ca499，qwen3.8-max，向量检索复盘输入）

`outputs/ppt-outline-improve-20261022/final-gen-{1..5}-summary.json`（不入库）。每次：读入 → 语义大纲 → 展开 → 确认 → 生成。本机无 LibreOffice，发布时渲染校验记为"未运行"。

| 次 | 大纲调用 | 大纲分钟 | 生成结果 | 提示 | critic 轮 | 生成调用 | 生成分钟 | 阻断原因 |
|---|---|---|---|---|---|---|---|---|
| 1 | 17 | 2.7 | ✅ completed | 1（眉题与标题重复） | 0 | 12 | 4.2 | — |
| 2 | 23 | 3.8 | ✅ completed | 1（逐字原文后又复述同一机制） | 1 | 14 | 4.2 | — |
| 3 | 20 | 3.3 | ❌ quality_blocked | 1 | 1 | 13 | 4.6 | 已被推翻的页面事实结论残留 |
| 4 | 21 | 3.5 | ✅ completed | 0 | 1 | 14 | 4.5 | — |
| 5 | 20 | 3.1 | ❌ quality_blocked | 0 | 2 | 13 | 4.1 | 数值归属误报 |

3/5 到可发布，未达验收。两次阻断和一次提示都追到了确定性的根因：

1. **第 3 次：被推翻的结论残留在 `unsupported` 里。** 页面事实审查先判"该机制按业务线拆分为 4 个分片"为 contradicted，审查结果规范化时把它镜像进 `unsupported`；独立复核随后改判为 entailed（"与 b_0009 原文一致"），`claimAudit` 更新了，镜像没删；发现复核又确认了这条残留，发布被拦。另外，阶段 3 的分级按问题码判断，而这条镜像带着自己的码 `claim_entailment_contradicted`，所以也没被降为提示。修复：`withClaimAuditFindings(review, claimAudit)`（`ppt-claim-semantics.mjs`）按当前审查结果重建镜像（带 `origin:'claim_audit'`），复核和规范化都用它；`finalQualityReport` 跳过镜像（只从审查结果计一次，原来会重复计两次），整稿审查的发现按它来自哪个列表分级，不看问题码。
2. **第 5 次：被选为摘要的表格，数值核对按散文读。** `ppt-source-numbers.mjs` 只把 `TableBlock` 当表格；表格被选为摘要后是 `SummaryTableBlock`，单元格被当成逐行散文，每个数的上下文取的是下一行——P50 延迟的 -49% 被归到"每月 GPU 成本"。逐字照搬的原表格被判"归属不符"，critic 两轮改不动（本来就没错）。修复：两种表格类型都按行列读取，并同时读原始清单里的表格。
3. **第 1 次的提示：眉题重复标题。** 只有一页的大纲卡片，章节名就是页标题；正文规范化清掉了重复眉题，但最终修复又重新推导出来。修复：`normalizeDeckEyebrows` 里整个标签就是页标题的眉题不显示；带章节编号的标签保留（编号仍有定位作用，原有测试依赖这一设计）。

第 2 次的提示（写手在逐字原文后又复述一遍机制）是模型判断类，按设计列为提示。

回归测试：`ppt-source-numbers-tables.test.ts`（真实表格，修复前失败）、`ppt-eyebrow-title.test.ts`（修复前失败）、语料新增第 3 次的整稿审查记录（`stale_claim_mirror`，修复前的报告为 blocked）。用修复后的代码在第 1、5 次的真实项目上重跑：数值问题 0 个，第 6 页眉题为空。

### 真实模型验收 第 2 轮（2026-10-22，71c277e4）——通过

`outputs/ppt-outline-improve-20261022/final2-gen-{1..5}-summary.json`，PPTX 在 `final2/workspace/*/published-1-*.pptx`（不入库）。

| 次 | 大纲调用 | 大纲分钟 | 生成结果 | 提示 | critic 轮 | 生成调用 | 生成分钟 | 导出校验 |
|---|---|---|---|---|---|---|---|---|
| 1 | 25 | 3.5 | ✅ completed | 0 | 0 | 8 | 1.5 | 结构通过，7 页 |
| 2 | 21 | 3.4 | ✅ completed | 0 | 0 | 8 | 1.4 | 结构通过，7 页 |
| 3 | 23 | 3.5 | ✅ completed | 0 | 0 | 8 | 1.4 | 结构通过，7 页 |
| 4 | 23 | 3.9 | ✅ completed | 0 | 0 | 9 | 2.6 | 结构通过，7 页 |
| 5 | 17 | 2.8 | ✅ completed | 0 | 1 | 14 | 6.7 | 结构通过，7 页 |

- 5/5 到可发布，无阻断，无剩余提示；每次从读入到发布约 5–10 分钟（第 1 轮 7–8 分钟且 2 次被拦）。
- 质量状态都是 `passed_with_warnings`：确定性检查的密度类提示（`point_too_long`、`visible_content_sparse`、`artificial_density`、`gamma_density_*`），不阻断，和本计划无关。
- 渲染校验：本机没有 LibreOffice，五次都记为"未运行"（阶段 2 的行为），导出对话框会提示。可见性（裁切、遮挡）这一项仍需装 LibreOffice（1.1）或在 CI 容器里验证。
- 抽查第 1 次的 PPTX 文本：7 页，原文的四项根因、指标表（6×4）、遗留风险和计划完整，数值与原文一致。

### 1.6：gamma-http 的根因与修复——超大关系图跨页拆分（2026-10-22）

**根因（产品缺口，不是夹具漂移）**

- 拦截原因不是大表，而是 `planned_source_media_layout`（"plain table 不能替代被要求的关系图"）。gamma.md 里有 6 个来源带已通过图审计的关系图（b_0017、b_0033、b_0049、b_0053、b_0061、b_0079），每个都会生成一个 required 的 `source-relations` 媒体任务（`ppt-source-media-tasks.mjs`）。be5cd92e 起，该任务退回表格时 `inspectFrozenOutlineSources` 阻断该页。
- 行切分必然失败：`relationalComponent` 原先只在一页拥有整张表时才画图，任何行范围都退回表格，被上述门禁拦下。旧夹具把 b_0017 切成 4 页、b_0049 切成 2 页，b_0061 与 b_0060、b_0062 同页，这 7 页全部被拦。
- 重排夹具（整图整页）后 **b_0049 放得下，该页诊断消失**；仍放不下的两个（关系图所需高度；light 正文区 11.6 × 5.075 英寸，`repairNative` 也找不到更高的版式）：

| 来源 | 18pt | 16.2pt（bounded 下限） | 14pt | 可用高度 |
|---|---|---|---|---|
| b_0017（17 节点、19 边） | 14.78 in | 11.60 in | 8.43 in | 5.075 in |
| b_0061（10 节点、9 边） | 5.59 in | 5.11 in | 4.55 in | 5.075 in |

  b_0017 在 14pt 仍需 8.4 英寸，任何 16:9 页面都画不下；b_0061 在允许的最小字号下仍差 0.035 英寸（`fitSourceLayout` 在表格能放下时直接返回 `componentFallbacks`，不先尝试 bounded 缩字号；即使尝试也不够）。
- 容量窗口回复也救不了：两者的来源规则都是 `allowedDestinations: ["slides"]`、`canBeOmitted: false`，`outline:editorial-capacity-window` 的 schema 对它们只允许 `slides`（可带行范围）。整页放不下，行切分又被门禁拦；不减少阻断数的窗口回复会被拒（`capacity_no_progress`），大纲停在 `capacity_blocked`，`POST /generate` 返回 409。真实模型在 gamma.md + light 上会走进同一个死胡同。

**修复（用户批准的产品改动，计划见 [ppt-relation-graph-split-20261022.md](ppt-relation-graph-split-20261022.md)）**

- `ppt-relational-diagram.mjs`：关系图表格的一个行范围画成一张"部分图"。每个节点归拥有它那一行的部分（紧凑投影里没有行的叶子跟随行号最小的父节点）；部分内的边照常画；跨部分的边连到一张延续卡片，卡片标题是另一端节点的原文标签，在后面部分写成 `→ 标签`、来自前面部分写成 `标签 →`。部分图仍是 `diagram.relational`（带 `relational.part`），渲染器、PPTX 导出和导出校验不用改。环形图、重叠窗口不拆。整图的输出与以前逐字节相同。
- `relationalCoverage`：部分图按同一规则重建后逐项比对（节点与延续卡片、边及原图边号、节点顺序、行范围）。整图校验不变。
- `ppt-outline-source-fit.mjs`：表格退回门禁不变；新增两个阻断问题：`planned_source_graph_split_unneeded`（整图单独放这一页、按真实绑定路径能画成关系图时不许拆）、`planned_source_graph_split_order`（各部分必须按行序排在相邻页）。媒体布局错误信息和容量窗口提示词说明了这个拆分选项。
- 夹具：b_0017 拆成 5 部分（行 [1,5) [5,7) [7,11) [11,14) [14,18)，每部分 18pt 下最高 4.66 英寸；任何 4 部分拆法都有一部分要 5.07 英寸，太紧；b_0018 与最后一部分同页），b_0061 拆成 2 部分（[1,5) [5,6)，最高 3.35 英寸；b_0060、b_0062 与第一部分同页），b_0049 整页。共 41 页（原 40 页）。夹具卡片的行范围改为作用于该卡片里的表格来源。
- 测试 HTTP 夹具 `test/ppt-http-harness.mjs` 关闭服务端空闲超时（`keepAliveTimeout = 0`）：客户端和服务端共用一个事件循环，大纲最后一段同步计算之后，服务端 5 秒空闲超时和 `POST /generate` 在同一轮触发，fetch 复用了刚关闭的连接，请求没到服务端就 `ECONNRESET`。gamma 以前从没走到生成，所以没暴露。
- 测试：新 `selftest-ppt-relation-graph-split.mjs`（b_0017、b_0061 形状的图：每个节点只归一个部分、每条边都可见——部分内一次、跨部分两边各一次——延续卡片标签与方向准确；篡改被拒；部分环形图仍返回 null；整图放不下照样被拦；相邻必要拆分通过；乱序和不必要的拆分被拦；部分画成表格时媒体任务不算完成；对象完整性、渲染树连线和原生 PPTX 导出校验都通过）。`selftest-ppt-editorial-relational.mjs` 原有断言"部分图保留表格"按新行为改为"行范围画成部分图且覆盖完整"。
- 结果：`selftest-ppt-gamma-http` 通过；本机 selftest **169 通过、0 失败、8 跳过**（共 177 个：原 167 个通过 + gamma-http + 新增的 relation-graph-split；跳过的仍是缺 LibreOffice 或用户模板的 8 个；运行时用 PATH 屏蔽了 `/usr/local/bin/soffice` 这个指向已删除 LibreOffice.app 的残留包装脚本，否则这些测试会以为有 soffice 而在转换时失败）；`npm run test` 3077 通过、1 跳过。生成一份 41 页的稿件在本机约 4.5 分钟，测试给生成的上限是 300 秒；本机负载高时（load average 约 75，其他会话的进程）余量很小，曾两次超时，测试未改。

**仍开放：** 1.1（LibreOffice：已按用户同意用 Homebrew 安装，但首次启动即被结束、应用随后被移除，疑为 Avast 拦截；残留的 `soffice` 包装会让每次发布的渲染转换失败，已卸载清理，本机恢复为"未安装"）、阶段 5（可选降调用）、任务卡"N 项待复核"与重新发布只重审改动页。编辑器内提示交互已在 `claude/ppt-editor-advisories-20261022` 完成并合入。

### 合并（2026-10-22，8b6e8ff6）

- 合入 `claude/ppt-gamma-http-fixture-20261022`（1.6：超大关系图跨页拆分）和 `claude/ppt-editor-advisories-20261022`（编辑器内的审查提示）。代码无冲突；`docs/exec-plans/README.md` 和产品思考文档的"局限"列表有文字冲突，两边都保留，删去已被编辑器分支完成的那条"未做"。
- 结果：`npm run test` 3082 通过、1 跳过；selftest **169 通过、8 跳过、0 失败**。gamma-http 单独运行 177 秒通过；本机批量脚本给每个测试 240 秒上限，机器繁忙时会截断它，官方运行器（`run-quality-selftests.mjs`）上限是 900 秒。

### 后续加固：不能运行的 soffice 记为"不可用"（2026-10-22）

- 起因：本机 LibreOffice 被杀毒软件移除后，Homebrew 留下的 `soffice` 启动器还在 PATH 上。阶段 2 只用 `shutil.which` 判断有没有渲染引擎，于是每次发布都去转换、都失败、都被拦下。
- 修复（`lib/ppt/export-verifier-python.mjs`）：先跑 `soffice --headless --version`（60 秒超时）。启动不了、退出码非 0、没有版本输出或超时，都记为 `renderedVisibility: unavailable` 并写明原因，照常发布；探测通过后转换失败仍阻断（阶段 2 的原则不变）。版本号直接取自探测，不再在末尾重复调用。
- 测试：`selftest-ppt-export-visibility-unavailable` 增加两种真实出现过的情况——指向已删除应用的启动器（退出码 127）、启动即被结束（-9）；"能运行但转换失败"的替身现在会回答版本探测，确保它测的仍是阻断路径。用修复前的校验器跑，启动器那一项按预期失败（被拦下）。
- 导出对话框：文字从"本机没有 LibreOffice"改为"本机的 LibreOffice 不可用（未安装或无法运行）"（en / zh / zh-HK），e2e 断言同步。

