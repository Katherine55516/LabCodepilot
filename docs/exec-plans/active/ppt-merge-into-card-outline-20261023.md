# PPT：把 outline-improve 分支并入卡片大纲分支（冲突处理方案）

> 状态：**方案已确认（用户 2026-10-23）**：以卡片分支为主线；保留本分支生成与导出侧，放弃旧大纲账本侧；在集成分支上 `git merge`。**等 "slides outline" 会话完成后执行。**
> 两条分支：本分支 `claude/ppt-outline-improve-20261022`（简称"本分支"）；卡片分支 `codex/ppt-report-completion-20261011`（run17 工作区，"slides outline" 会话在改）。
> 共同祖先 `f8f479cb`。分析时：本分支 24 个提交，卡片分支 43 个提交（约 +12k / −5k 行）。卡片分支会继续前进，执行前要按它的最终提交重算一遍（第 6 节第 1 步）。

## 1. 结论

- **以卡片分支为主线。** 卡片大纲在大输入上解决了旧流程的根本问题（3143 上旧流程 855 秒失败，卡片 101–117 秒）；本分支的大纲阶段改动大多改在它已删除的代码上。
- **本分支保留"生成与导出"这一侧**：审查提示分级、调用账本、回复规范化、被推翻结论的镜像修复、数值核对、眉题、关系图拆分、编辑器内提示、LibreOffice 不可用的处理、测试基础设施。这些改的文件卡片分支几乎没动，而且卡片分支里 `cardsFlow(p) = outlineFirst(p)`，本分支按 `outlineFirst` 判断的分级直接作用于卡片稿。
- **本分支放弃"旧大纲账本"那一侧**：治理器与预算（L1–L3）、覆盖审查复用（L2）、选择修正 S1–S8、标题保留 T1–T3、S6 关系图回退。卡片分支已删除这些代码所在的模块。
- **方式**：在卡片分支最终提交上新建集成分支，`git merge` 本分支，按第 3 节逐文件处理（不用 cherry-pick：`d4cd8183`、`a58ca499`、`71c277e4` 同时改了大纲和生成两侧，拆开挑反而更容易漏）。

## 2. 本分支 24 个提交的去留

| 提交 | 内容 | 去留 | 说明 |
|---|---|---|---|
| `c57c6957` | 万字前的小数按整数读 | 保留 | `ppt-evidence.mjs` 卡片侧未改，干净合入 |
| `c1d05b4f` | selftest 只在产品坏时失败（跳过码 77、审查替身、快照、输出目录） | 保留 | 会顺带修好卡片分支自己列出的旧失败（edit-intent、summary-edit、editorial-http） |
| `aa4a4827` | 没有 LibreOffice 时记"渲染未运行"并照常发布 | 保留 | 干净合入 |
| `4f1a7ea1` | 不能运行的 soffice 记为不可用 | 保留 | 干净合入 |
| `d4cd8183` | 生成阶段：模型判断类发现一轮修复后转提示；生成调用账本与预算 | 保留 | `ppt-quality.mjs` 需合并（第 3 节） |
| `71c277e4` | 被推翻结论的镜像残留；摘要表格的数值归属；眉题重复标题 | 保留 | 镜像修复在 `ppt-quality.mjs` 冲突段里，需合并 |
| `55318830` + 合并 | 编辑器内标记、应用建议、忽略 | 保留 | 新文件为主，干净合入；依赖上面的分级 |
| `2f031c9b` | HTTP 测试夹具不复用已关闭的连接 | 保留 | 干净合入 |
| `5f165d7c` | 超大关系图跨页拆分 | 保留（去掉一行） | 对 `ppt-editorial-repair.mjs` 的一行提示改动随该文件删除而丢弃 |
| `b7239de4` | 写手只看本页来源（W1） | 保留，需验证 | 干净合入；卡片页的写手以卡片要点为依据，要确认 owned 页仍正确收窄 |
| `bc2b4bb8` | 卡片依赖自身时代码修正 | 保留 | 卡片流程仍用语义大纲分主题（`outline:logical`），已干净合入 |
| `a58ca499` | 回复先规范化再校验（传输层）+ 真实回复语料 | 保留传输层；改两个测试 | 对 `ppt-editorial-coverage.mjs` 的导出随文件删除丢弃 |
| `1ea5598d` | S1–S5、T1–T3、L1–L3 | 放弃 | 物化/账本路径、治理器、覆盖审查已删 |
| `0585f6a5` | S6 关系图回退 | 放弃 | 修复环的回退已删（R7） |
| `ede403cf` | 覆盖审查回复重复 ID | 放弃 | 文件已删；同类问题由传输层规范化统一处理 |
| `3cca1afe`、`c9bddc72` | S8 图示正文重复标签 | 放弃 | 摘要图示已删（R6） |
| 文档提交 ×6 | 计划、交接、验收记录 | 保留为历史 | 交接文档里账本路径相关小节标注"已被卡片大纲取代" |

## 3. 12 个冲突文件的处理

| 文件 | 类型 | 处理 |
|---|---|---|
| `lib/ppt-outline-governor.mjs` | 卡片侧删除 | 接受删除 |
| `lib/ppt-editorial-coverage.mjs` | 卡片侧删除 | 接受删除（`coverageVerdictSchema` 等导出不再需要） |
| `lib/ppt-editorial-repair.mjs` | 卡片侧删除 | 接受删除 |
| `selftest-ppt-outline-governor.mjs`、`selftest-ppt-editorial-coverage.mjs`、`unit/ppt-outline-first-planner-render.test.ts` | 卡片侧删除 | 接受删除 |
| `lib/ppt-outline-first.mjs`（1 段） | 内容 | 取卡片侧（`topicPageQuotas` 取代 `acceptCapacityAllocation`）；本分支的 `settleSemanticDependencies` 在冲突段外，已保留 |
| `lib/ppt-outline-compile.mjs`（1 段） | 内容 | 取卡片侧（它自己的内部理由截短覆盖 S3）；不再调用 `salvageSelection`，删除 `ppt-selection-salvage.mjs` 及其单元测试 |
| `unit/ppt-outline-first.test.ts`、`selftest-ppt-outline-first-api.mjs` | 内容 | 取卡片侧；本分支新增的容量分配、治理器、预算用例随功能删除 |
| `lib/ppt-api.mjs`（12 段） | 内容 | 见下 |
| `lib/ppt-quality.mjs`（1 段） | 内容 | 两边合并，见下 |

### 3.1 `lib/ppt-api.mjs`

- 第 1–4 段（import）：取卡片侧，再加回本分支仍在用的：`normalizeReply`（传输层规范化）、`closingEvidenceSourceIds`（W1）。删掉指向已删模块的 import（治理器、编辑覆盖/修复、`relationGraphFallback`）。
- 第 5–10 段（大纲：治理器、`judged`/`reviewCall`、修复环回退、scoped 环、T2 命名）：全部取卡片侧。
- 第 11 段（大纲确认页的提示列表）：取卡片侧（卡片稿上冻结对象的问题只提示）。
- 第 12 段（最终整稿复审）：取卡片侧的 `rereviewOrKeep`（复审超时保留上一次结果），再把本分支的 `reportOptions` 传给 `finalQualityReport`：

```js
modelReview = await rereviewOrKeep(current, modelReview, 'review:deck:repair', repaired.repairs.map(r => r.slideId).filter(Boolean), (prompt, nodeKey) => deps.modelCall(current, prompt, activity, log, { nodeKey }));
current.quality = finalQualityReport(repairedReview, repaired.repairs, modelReview, { reviewMs: reviewDuration }, reportOptions);
```

- 冲突段以外已干净合入、需要保留的：`settleReply`（传输层规范化）、`JUDGED_CRITIC_CATEGORIES` 与"判断类只修一轮"、`generationCalls` 账本与 `PPT_GENERATION_CALL_BUDGET`、`deterministicGate` 的 `judgedAdvisory`。

### 3.2 `lib/ppt-quality.mjs`

两边各加了不冲突的规则，合并成一个：

- 卡片侧：卡片稿上义务缺失只提示；作者改过的页上的页面事实问题只提示；复审不可用时保留上一次结论，改过的页标为"未复核"（`keepReviewAfterUnavailable`、`model_review_unverified`）。
- 本分支：页面事实镜像只从 `claimAudit` 计一次（`isClaimAuditMirror`）；整稿审查的发现按来源列表判为模型判断，一轮修复后在 outline-first（= 卡片）稿上转提示。

```js
export function finalQualityReport(deterministic, repairs, modelReview, timings = {}, { judgedAdvisory = false } = {}) {
  const reviewed = list => (list || []).filter(item => !isClaimAuditMirror(item));
  const modelIssues = [], judged = [];
  const add = (items, isJudged) => { for (const item of items) { modelIssues.push(item); judged.push(isJudged(item)); } };
  add(obligationFailures(modelReview.obligationAudit).map(item => deterministic.cardOutline ? { ...item, severity: 'warning' } : item), () => false);
  add(claimAuditFailures(modelReview.claimAudit).map(item => item.slideIds?.some(id => deterministic.authorEditedSlideIds?.includes(id)) ? { ...item, severity: 'warning', authorEdited: true } : item), item => JUDGED_REVIEW_CODES.includes(item.code));
  add(reviewed(modelReview.missing).map(item => ({ code: 'model_missing', severity: deterministic.strictCoverage ? 'error' : 'warning', ...item })), () => true);
  add(reviewed(modelReview.repeated).map(item => ({ code: 'model_repeated', severity: 'error', ...item })), () => true);
  add(reviewed(modelReview.conflicts).map(item => titleScopeOnly(item) ? { code: 'model_title_scope', severity: 'warning', ...item } : { code: 'model_conflict', severity: 'error', ...item }), () => true);
  add(reviewed(modelReview.unsupported).map(item => ({ code: 'model_unsupported', severity: 'error', ...item })), () => true);
  add((modelReview.unverified || []).map(item => ({ ...item, findingCode: item.code, code: 'model_review_unverified', severity: 'warning' })), () => false);
  modelIssues.splice(0, modelIssues.length, ...annotateIssues(modelIssues).map((item, i) => judgedAdvisory && item.severity === 'error' && judged[i] ? { ...item, severity: 'warning', advisory: true, requiresReview: true } : item));
  // …其余与两边相同
}
```

`keepReviewAfterUnavailable` 返回的复审结果里也带着镜像，`reviewed()` 同样会跳过，不会重复计。

## 4. 不报文字冲突、但合入后会坏的地方

| 位置 | 问题 | 处理 |
|---|---|---|
| `selftest-ppt-reply-settle-transport.mjs`、`selftest-ppt-real-reply-corpus.mjs` | import 已删除的 `coverageVerdictSchema` | 改成测试内联的 schema（规范化本身与覆盖审查无关）；语料里 S8 图示的 4 条随功能删除 |
| `selftest-ppt-judged-review-generation.mjs` | 用替身走 semantic → expand（容量、物化），卡片流程不再调用这些阶段 | 改为走卡片流程（语义大纲 + 每主题写卡片的替身），断言不变：一轮修复、发布、1 条提示、旧流程仍阻断 |
| `unit/ppt-selection-salvage.test.ts`、`unit/ppt-outline-titles.test.ts` | 测的是已放弃的 S1–S8、T1–T3 | 随功能删除（`ppt-partition-intent.mjs` 合并后若无调用方，一并删除） |
| `unit/ppt-writer-page-scope.test.ts` | W1 在卡片页上是否仍生效 | 增加一个卡片页用例 |
| `test/ppt-pipeline-model-fixture.mjs`、`ppt-audit-double.mjs` | 卡片流程有新的模型阶段（每主题写卡片等） | 替身登记卡片阶段（不放进通用兜底） |
| `docs/handover/ppt-outline-convergence.md` | L1–L3、S1–S8、T1–T3、L2 小节描述的是已删的路径 | 标注"已被卡片大纲取代"，保留生成侧小节 |
| 环境变量 | `PPT_OUTLINE_REPAIR_BUDGET`、`PPT_OUTLINE_CALL_BUDGET` 失效 | 从交接文档的配置表删除；`PPT_GENERATION_CALL_BUDGET` 保留 |

## 5. 需要用户决定

1. 主线用卡片分支。✅ 已确认（2026-10-23）
2. 合并方式：集成分支上 `git merge`。✅ 已确认（2026-10-23）
3. 旧的非卡片流程（只剩老项目会走）不再保留 S1–S8 这类修正。✅ 随"放弃旧大纲账本侧"一并确认（2026-10-23）

## 6. 执行步骤与验收（slides outline 完成后）

1. 按卡片分支最终提交重算冲突（`git merge-tree --write-tree <卡片分支> claude/ppt-outline-improve-20261022`），核对本表是否仍适用。
2. 在新工作区从卡片分支末端建集成分支，`git merge` 本分支，按第 3 节解决，再按第 4 节修测试和文档。
3. 验证：`npm run test`；全量 selftest（`PPT_PYTHON` 和 `PPT_TEST_PYTHON` 都指向带 python-pptx 的解释器，见第 7 节）；PPT e2e（单 worker）；真实模型：3143 上 10_alpha_mining（卡片分支的验收）+ 向量检索复盘连续 5 次（本分支的验收）。
4. 用户确认后再合入目标分支。

估计：合并与解决 1–2 小时；测试适配 1–2 小时；真实验证约 1.5 小时。

## 7. 测试依赖（2026-10-23）

- PPT selftest 需要 python-pptx、pdfplumber、python-docx、openpyxl、pypdf、pandas、pillow、lxml；生产镜像 `apps/cowork-server/image/Dockerfile` 另装 matplotlib、xlsxwriter、requests、tabulate。
- 本机默认 `python3`（`/usr/local/bin`，3.9.7）缺 pptx、pdfplumber、docx、openpyxl，不设变量时约 35 个测试跑不了。
- **测试用解释器**：`~/.cache/labcodepilot/ppt-python/bin/python`（Python 3.13，与生产 `python:3-slim` 一致，约 211 MB），按 Dockerfile 清单装齐，另加只在测试里用的 reportlab（用来生成 PDF 输入样本，生产不需要）。用它跑全量 selftest：169 通过、8 跳过、0 失败。跑测试时把 `PPT_PYTHON` 和 `PPT_TEST_PYTHON` 都设成它。
- 重建方法：`/usr/local/bin/python3.13 -m venv ~/.cache/labcodepilot/ppt-python`，再 `uv pip install --python ~/.cache/labcodepilot/ppt-python/bin/python "cryptography<47" pandas openpyxl xlsxwriter python-docx python-pptx pdfplumber pypdf matplotlib pillow requests tabulate "reportlab>=4.4,<5"`。
  - `cryptography<47`：本机是 Intel Mac，cryptography 50.x 只发 Apple Silicon 的 macOS 安装包，不钉版本就会尝试从源码编译（需要 Rust）并卡住；46.x 有 Intel 安装包，满足 pdfminer.six 的要求（≥36）。
  - 用 uv 不用 pip：本机经 VPN 访问 PyPI 约 125 KB/s，pip 曾卡在被服务器关闭的连接上；uv 会重试。
- 备用：`/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`（3.12，除 matplotlib 外齐全）也能跑全部 selftest。
- 磁盘：安装前数据盘一度只剩 0.8 GB（`.ppt-build` 下 140 GB，主要是 run17 与 ppt-title-graph 的 `outputs/` 和多份 `.next-*` 构建缓存）。本会话清掉了自己工作区里的构建缓存；其余属于其他会话，由用户决定。
