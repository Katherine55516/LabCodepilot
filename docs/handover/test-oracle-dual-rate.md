# 测试质量：需求自审内化 + oracle 双轴 + 双口径通过率

> 产品思考见 [docs/insights/test-oracle-dual-rate.md](../insights/test-oracle-dual-rate.md)
> 上游方案见 [docs/research/framework-flow-test-integration.md](../research/framework-flow-test-integration.md) §2.1（第二批·测试质量）

ai-lab-test-framework 集成方案的第二批落地。目标：把 framework 的「测试质量方法论」补进 LabCodepilot 4 步内嵌测试流程——**让用例能区分「验对错」还是「锁现状」，让报告通过率不被回归基线用例虚高，让需求在进入用例设计前先自审一遍**。

## 一、解决的问题

LabCodepilot 之前已导入 `test-case-completeness.md` / `test-report.md` 规则（已含 oracle 双轴 / 双口径定义），但**落实层有三个缺口**：

1. **需求阶段无自审**：缺 `requirement-review.md` / `requirement-completeness.md`，需求生成后不复查可测试性/完整性。
2. **用例无 oracle 双轴字段**：`casesPrompt` 字段清单 + cases.json schema 都没有「oracle 来源 / 验证性质」→ AI 不产出 → 无法区分功能验证用例与回归基线用例。
3. **报告单口径**：`reportPrompt` 只说「通过率」，`reduce.ts` 只算 `pass/total`。代码反推的回归基线用例永远 pass，会把通过率虚抬成「100% 通过」，掩盖「从未验证过对错」。

## 二、改动清单

| 文件 | 改动 |
|---|---|
| `src/lib/test/rules/requirement-review.md`（新） | 从 `framework/rules/` 原样复制（4 维评分 + 覆盖矩阵 + 判定表/状态迁移 + oracle 映射） |
| `src/lib/test/rules/requirement-completeness.md`（新） | 同上（6 路径覆盖矩阵 + 闭环逻辑 + 缺口严重度） |
| `src/lib/test/prompts.ts` · `requirementPrompt` | 末尾加「生成后自审」块：加载上面两规则，生成初稿后对照自查 4 维度 + 6 路径覆盖，**直接修订需求文档本身**（非交互、不产 review.json、不加评审小节）。落点约束从「只写一次」放宽为「先初稿后自审覆盖同一文件」 |
| `src/lib/test/prompts.ts` · `casesPrompt` | 字段清单 + JSON schema 加 `oracle` / `verification`；新增「oracle 双轴」执行点（映射铁律：USER/PROJECT_DOC→功能验证；REVERSE_ENGINEERED→回归基线）；总结要求报功能验证/回归基线计数 + 全回归基线提示 |
| `src/lib/test/prompts.ts` · `reportPrompt` | 概要改「双口径通过率」；新增执行点：功能验证通过率（回归基线不计入）vs 执行通过率（参考），优先采用 run.json 预聚合的 `funcCounts`/`funcPassStr`，全回归基线记 N/A |
| `src/lib/test/reduce.ts` | `RunJson` 加 `funcCounts`/`funcPassStr`/`regressionTotal`；`reduceResults`/`reduceFromText` 加可选参 `verificationById`，按 id join 验证性质，回归基线排除出功能验证四态 |
| `src/lib/test/exec-stream.ts` · `wrapExecutionStream`（由 `api/test/run/route.ts` 调用）| 归约前读 cases.json 提取 `id→verification` 映射传入 reduce（best-effort，缺失则退化单口径） |
| `src/components/test/InlineTestingPanel.tsx` | `GeneratedCase` 加 `oracle`/`verification`；只读用例卡加验证性质标签（功能验证=绿 status-success / 回归基线=灰 muted，附 oracle 来源）；编辑器加两个 `<select>`（验证性质 2 项 / oracle 5 项） |
| `src/app/api/test/cases/export/route.ts` | COLUMNS + caseRow + EXAMPLE 加「oracle来源」「验证性质」两列 |
| `src/i18n/{zh,en,zh-HK}.ts` | 加 `test.cases.verification` / `test.cases.oracle`（标签；option 值是与 prompt 一致的中文数据值，不翻译） |
| `src/__tests__/unit/test-reduce.test.ts` | 加 dual-rate describe 块（退化单口径 / 排除回归基线 / 全回归基线 N/A / id 缺失默认功能验证）4 例 |

## 三、数据流（oracle 双轴贯穿四步）

```
需求阶段：requirementPrompt 生成需求 → 自审趟修订 → 需求标 USER/PROJECT_DOC/REVERSE_ENGINEERED 来源
   ↓（来源决定默认 oracle）
用例阶段：casesPrompt 按映射铁律给每条用例标 oracle + verification → 写入 cases.json
   ↓                                          ↓（UI 读 cases.json 展示标签 + 编辑器可改）
执行阶段：AI 逐条 @@RESULT(id,status)        api/test/cases (GET/PUT 透传)
   ↓
归约：wrapExecutionStream 读 cases.json 得 id→verification → reduceResults 按 id join
      → run.json：counts（全部四态）+ funcCounts（功能验证四态，排除回归基线）+ funcPassStr + regressionTotal
   ↓
报告阶段：reportPrompt 读 run.json，优先采用 funcCounts/funcPassStr 产「双口径通过率」
```

## 四、关键设计决策

1. **走 app 内化路线，不新增独立「需求评审」步**。framework CLI 是 6 步（含独立 Step3 评审 + review.json + 强制用户交互）；app（`requirements.js`）把评审内化为需求生成第二趟自审。LabCodepilot 非交互运行，跟 app 一致：自审直接改文档，不产 review.json、不向用户提问。

2. **规则原样导入 + prompt 约束行为**。`requirement-review.md` 含 §7.2/7.4/7.5（强制交互/用户门控/review.json 产物）这些 CLI 独有内容；不裁剪规则文件（保持与 framework 权威原文一致、便于 upgrade 同步），而在 `requirementPrompt` 自审块里显式声明「本平台非交互——这些步骤一律跳过」，把行为差异锁在 prompt 层。

3. **双口径在 reduce 层确定性计算，不靠 LLM**。沿用既有「四态计数由代码算、不由 LLM 汇总」的原则：`reduceResults` 按 cases.json 的 verification join 出 `funcCounts`，报告 prompt 只是呈现。

4. **向后兼容优雅退化**。`verificationById` 可选：无 cases 映射（旧 run、导入用例无 verification 字段）时所有用例默认功能验证 → `funcCounts === counts`、`funcPassStr === passStr`，旧消费方无感。id 不在映射里的单条用例也默认功能验证（lineage-safe，不把未知误判为回归基线）。

5. **oracle/verification 取值用中文数据值**（功能验证/回归基线/PRD/现状锁定…），与 prompt 产出、规则定义、reduce 正则（`/回归基线|regression/`）一致；UI 只读标签直接显示该值，select option 也是中文值，仅 placeholder/label 走 i18n。

## 五、验证

- **reduce 双口径**：`npx tsx --test src/__tests__/unit/test-reduce.test.ts` → 16/16（含 4 个新双口径例）。typecheck 通过。
- **UI（dev 3001 实测）**：mock 一份带 oracle 双轴的 cases.json（1 功能验证 + 1 回归基线），进用例阶段实测——GET cases 正确透传 oracle/verification；只读卡渲染「功能验证 · PRD」(绿 `bg-status-success-muted`) / 「回归基线 · 现状锁定」(灰 `bg-muted`)；编辑器 select 选项齐全、当前值正确回填。

## 六、已知局限

- **prompt 效果需真实项目实测**。需求自审、用例 oracle 标注、报告双口径都是 prompt/方法论改造，dev 本地无 API credentials 跑不通真实 4 步流程；其「AI 是否标对 oracle、是否如实算双口径」需在有模型的打包态 + 真实项目验证。
- **打包态规则 fallback**。`loadRule` 在 dev 读 `src/lib/test/rules/*.md`，打包 standalone 态 `outputFileTracingExcludes` 会剥掉 `**/*.md` → 退回 prompt 内置精简规则。新导入的两规则同此约束（与既有 4 规则一致），打包态带全量规则属既有技术债。
- **id join 是 best-effort**。双口径靠 `@@RESULT.id` 与 cases.json `id` 一致；执行 prompt 已要求用 cases 的 id，但若 AI 写歪，对不上的用例默认计入功能验证（偏严，不会把回归基线漏算成「未验证」，但极端情况可能把回归基线误计入功能验证）。报告 prompt 的 oracle 一致性校验（ORACLE_UNVERIFIED）作为兜底。
- **cases 导入未解析 oracle 列**。导出 xlsx 已含两列，但 `api/test/import`（xlsx→cases.json）暂未反向解析这两列；导入的用例需在编辑器补标，或后续补 import 解析。
