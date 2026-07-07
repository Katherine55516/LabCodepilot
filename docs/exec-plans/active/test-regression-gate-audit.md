# 测试工作台:回归集标签 + 步骤门控 + 操作审计 实施计划

> 状态:**开发完成,待打包验收** | 分支:V3.0.1_dev | 创建:2026-07-06 | 完成:2026-07-07
> 交接文档:[docs/handover/test-regression-suite.md](../../handover/test-regression-suite.md)
> 三个需求:①生成用例打回归标签 ②步骤门控+记录用户操作 ③AI 推荐回归用例(生成时+存量)

## 0. 决策日志(已拍板)

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 回归标签是否进报告口径 | **进**。批次 A(打标)+ 批次 B(报告口径)都做 |
| 2 | 门控范围(2026-07-06 二次澄清) | **单任务流程在「用例设计」完成后停一次**——含「运行任务」一键模式(现状该入口自动批准直通,是真正缺口);批准后执行→报告自动连跑到底,执行后**不再停**;多任务批量**保持直通不动**,仅审计标注 |
| 3 | 操作记录存储 | **项目目录独立审计文件** `AI_LabTest/audit/{taskName}.jsonl`(可交付、删任务留痕) |
| 4 | 存量用例 AI 推荐 | **要做**(批次 B) |

## 1. 术语与命名约定(⚠️ 全程遵守,防口径污染)

系统中已存在两个正交的「回归」概念,**代码与文档必须严格区分**:

| 概念 | 判定依据 | 现有落点 | 本计划命名 |
|------|---------|---------|-----------|
| **回归基线**(oracle 双轴) | `verification === "回归基线"`:预期来自现状锁定,只锁现状不验对错,决定功能验证通过率口径 | reduce.ts `isRegression()`/`regressionTotal`、funcCounts/funcPassStr | 不动,保持原名 |
| **回归集**(本次新增口径) | `tags` 含 `"回归测试"`:**该用例不通过会阻塞系统运行**(发版必跑核心集) | GeneratedCase.tags(已有字段,现纯手动) | 代码统一用 **`suite`** 前缀:`suiteIds`/`suiteCounts`/`suitePassStr`,**禁止**复用 `isRegression`/`regression*` 命名 |

一条用例可以同时是「功能验证」+「回归集」(如登录主流程,预期来自 PRD 且挂了阻塞系统)。

**回归集判定标准**(写入 rules,供 AI 与人共用):该用例失败 ⇒ 系统核心功能不可用或主流程中断——登录/鉴权、核心业务主链路、数据写入与一致性、应用崩溃/白屏级问题。P0 优先级用例默认为候选,但以「失败后果」为最终判据,不与优先级划等号。

---

## 2. 批次 A:生成打标 + 执行门控 + 审计地基

### A1. AI 生成用例产出 tags(需求 1+3 生成侧)

**改动文件**:
- `src/lib/test/prompts.ts` `casesPrompt`(约 L190-215):
  - 第 3 步字段清单追加「用例标签 tags」;
  - 第 4 步(oracle 双轴)之后**新增第 4.5 条「回归集标签铁律」**:按 §1 判定标准打 `"回归测试"`;并明确「回归集(tags)与回归基线(verification)是两个正交维度,禁止互相推导」;
  - 落点 JSON 结构行(约 L211)的 schema 增加 `"tags":["回归测试"?]`;
  - 末尾总结句追加「其中回归集(发版必跑)N 条」。
- `src/app/api/test/revise/route.ts` `CASES_SCHEMA`(约 L24):同步加 `tags`,修订时不丢字段。
- `src/lib/test/rules/test-case-completeness.md`:新增一节「§回归集标签(tags)」——判定标准 + 与 §1.6 回归基线的正交区分表 + 反例(「不要把所有 P0 无脑打回归」「不要把回归基线自动当回归集」)。

**验收**:新建任务走生成流程,`{task}.cases.json` 内含 `tags`;用例表格「用例标签」列显示;对话修订用例后 tags 不丢。

### A2. 导入/导出补标签列(需求 1 数据链路闭环)

**改动文件**:
- `src/app/api/test/import/route.ts` `rowsToCases`(约 L53-98):加 `const tagsC = findCol(headers, /标签|tags?/i)`;值按 `、/,;` 拆成数组,仅保留非空项。
- `src/app/api/test/cases/export/route.ts`(约 L15-43):列定义加 `{ key:'tags', header:'用例标签' }`,值 `tags.join('、')`;空模板同步。

**验收**:导出→Excel 改标签→导入,roundtrip 标签保留;无标签列的旧 Excel 导入不受影响。

### A3. 「运行任务」模式的用例门控(需求 2 门控侧,2026-07-06 修订)

**目标行为**(单任务点「运行任务」):需求分析(自动批准)→ 用例设计 → **停「待批准」,用户点批准** → 测试执行 → 测试报告(自动连跑到底)。

**现状与缺口**:
- 单步手动运行:需求/用例本就停 review(`HUMAN_GATED`),**已满足,不动**;
- 「运行任务」`startRunAllFrom`(L1448-1468)与批量 `pumpQueue`(L451-490)都把任务放进 `autoRunIdsRef` → runStep finally(L1269-1280)对 autoRun 任务把 gated 步直接标 done 接力,**用例门控被跳过——这是本项要修的唯一缺口**。

**改法**:
- `HUMAN_GATED` **保持不变**(不加 execution;执行→报告维持 auto-chain);
- 新增批量来源标记(如 `batchIdsRef`,`pumpQueue` 出队提升 autoRun 时打标;「运行任务」按钮路径不打标);
- runStep finally:`step === "cases" && autoAll && 非批量` → 置 `review` **并从 `autoRunIdsRef` 移除**(流水线控制权交还用户;auto-chain 只推进 idle 步,不会越过 review);
- 用户点批准(approveStep,L1402)→ 现有逻辑自动 `runStep("execution")`,执行完 report 照旧接力;
- 批量任务(有 batch 标记)与 pumpQueue 自动批准分支(L469-482)行为不变,**直通保持**;
- 文案:`test.gate.auto`(zh.ts L242「批准后『测试执行 + 测试报告』自动连跑。」)在新行为下**依然准确,不改**;(可选)「运行任务」起跑 toast 提示「用例生成后将暂停等待批准」。

**验收**:
1. 「运行任务」(全新任务):需求→用例连跑不停,用例完成停「待批准」(琥珀);点批准 → 执行+报告自动到底;
2. 单步手动:与现在完全一致(需求、用例各停一次);
3. 多任务批量:全直通,与现在完全一致;
4. 停在用例 review 时重跑用例/修订/追加指令均正常;runStart modal 从「执行」起点起跑不受影响。

### A4. 操作审计地基(需求 2 记录侧)

**新增文件**:
- `src/lib/test/audit.ts`:
  ```ts
  interface AuditEvent {
    time: string;        // ISO
    taskId: string; taskName: string;
    step?: TestStep;
    action: 'approve' | 'run' | 'rerun' | 'revise' | 'chat-action' | 'stop'
          | 'auto-approve' | 'import' | 'edit-cases' | 'delete-task' | 'recommend-suite';
    mode: 'manual' | 'batch' | 'auto';   // 手动 / 批量自动批准 / auto-chain 接力
    detail?: string;     // 如修订指令摘要、推荐条数
  }
  ```
  `appendAudit()`:JSONL 单行追加到 `<projectPath>/AI_LabTest/audit/<taskName>.jsonl`(mkdir -p;append 原子;失败静默不阻塞主流程)。
- `src/app/api/test/audit/route.ts`:POST 追加(`isUnsafeSegment` 校验 taskName,复用 `path-safety.ts`);GET 读取返回事件数组(倒序),供批次 B 的 UI。

**前端埋点**(InlineTestingPanel.tsx,全部 fire-and-forget POST):
| 入口 | action / mode |
|------|--------------|
| `approveStep`(L1402) | approve / manual |
| `runStepManual`(L1412) | run / manual |
| @@ACTION 确认条点击(L1918-1926) | chat-action / manual |
| `reviseStep`(L508) | revise / manual(detail=指令前 80 字) |
| `stopStep`(L1323) | stop / manual |
| 批量 auto-approve(L469-482) | auto-approve / batch |
| auto-chain 接力起跑(L1493-1534) | run / auto |
| 导入需求/用例落盘后(postImport,L719 附近) | import / manual |
| `saveCases` 用例编辑保存(L968) | edit-cases / manual |
| `confirmDelete` 删除任务(L1340,**在删除动作前写**) | delete-task / manual |

**关键设计**:审计目录 `AI_LabTest/audit/` 独立于 `AI_LabTest/report/{task}/`——`reports/delete` 只删 report 目录与证据,**审计文件天然留痕**,无需改删除逻辑。

**验收**:上表每个入口操作一次,`audit/{task}.jsonl` 追加对应行(含 ISO 时间戳);删任务后审计文件仍在且含 delete-task 记录。

### A5. 单测 + i18n(批次 A 收尾)

- 单测:`audit.ts` 追加/读取;import 标签列映射(含无标签列向后兼容)。
- i18n:`src/i18n/en.ts`/`zh.ts` 同步新增文案(执行步批准文案、导出标签列头等)。
- `npm run test` 全绿(tsc + 单测)。

---

## 3. 批次 B:报告口径 + 存量 AI 推荐 + 审计 UI

### B1. reduce 回归集口径(数据层)

**改动文件**:
- `src/lib/test/reduce.ts`:
  - `reduceResults` opts 加 `suiteIds?: string[]`(tags 含「回归测试」的用例 id 集合);
  - `RunJson` 加**可选**字段:`suiteCounts?: RunCounts`、`suitePassStr?: string`(如 `"3/4"`;无回归集时两者缺省,旧 run.json 消费方不受影响);
  - 计算逻辑与 funcCounts 并列,注释写明「suite=回归集(tags 口径),与 regressionTotal(回归基线,oracle 口径)正交」。
- `src/app/api/test/run/route.ts`(L62-84):读 cases.json 循环中同时收集 `c.tags?.includes('回归测试')` → `suiteIds` 传入 reduce。

**单测**(`src/__tests__/unit/test-reduce.test.ts` 追加):混合场景(回归集内含 pass/fail)、回归集与回归基线交叉(一条用例同属两者,各口径独立计数)、无 suiteIds 时字段缺省、回归集用例未执行补 blocked 计入 suiteCounts。

### B2. 报告展示回归集口径(消费层)

**改动文件**:
- `src/app/api/test/reports/route.ts`:透传 `suiteCounts`/`suitePassStr` 到 ReportEntry。
- `src/components/test/InlineTestingPanel.tsx`:
  - `ReportEntry` 接口加对应可选字段;
  - ReportView(L2425 附近)与报告历史行:展示「回归集 N/M」;**回归集存在 fail/blocked → 红色警示条「⚠ 回归集未全过——存在阻塞级失败,不可发版」**;
  - 全过则绿色「回归集全过」。
- `src/app/api/test/report-xlsx/route.ts`:HEADER 加「用例标签」列(join cases.json 的 tags)。
- `src/lib/test/prompts.ts` `reportPrompt`(L278-281 附近)+ `src/lib/test/rules/test-report.md`:报告 md 增加「回归集」小节;**红线规则:回归集有挂 → 报告结论必须标「阻塞」,禁止表述为通过**。
- (可选)`src/app/api/test/defect/route.ts` prompt:回归集用例的缺陷标「阻塞级」。

**验收**:CDP 打开报告 tab 见回归集通过率与红/绿状态;导出 xlsx 含标签列;md 报告含回归集小节;旧 run.json(无 suite 字段)报告页正常渲染不报错。

### B3. 存量用例 AI 推荐(需求 3 存量侧)

**新增文件**:`src/app/api/test/cases/recommend/route.ts`
- **实现模式直接复制 `run/route.ts` 的流包装(wrapRunStream,L95-140)**:透传 streamClaude 的 SSE 流给前端(用户实时看到 AI 判定过程),同时 frameBuf 累积 `text` 帧;流结束时 harvest `@@RECOMMEND` 行 → merge 写盘 → 补发一帧 `{type:'cases_updated', changed:N}` 再 close。**不让 AI 写文件**(与 revise 的「AI 直接覆盖产物」模式相反):
  - prompt:Read `{task}.cases.json` + 需求文档 → 按 rules 回归集判定标准逐条判定 → 每条输出一行 `@@RECOMMEND {"id":"TC-001","suite":true,"reason":"登录主流程,失败阻塞全部功能"}`,只读不写;
  - 后端 harvest(仿 reduce.ts `harvestResults` L92-106)→ **代码 merge**:仅增删各条 `tags` 中的「回归测试」,其余字段原样 → 原子写回 cases.json(.tmp+rename,防 AI 重写整份丢字段)。
- 前端(InlineTestingPanel.tsx):用例阶段详情卡 + 用例表格弹窗加「AI 推荐回归集」按钮 → SSE 进度展示 → 完成刷新 `casesPreview` + 提示「已标记 N 条回归用例(原 M 条)」;埋审计 `recommend-suite`(detail=变更条数)。
- i18n 同步。

**验收**:对一个已有用例集(含导入来源)点击推荐,tags 更新、其余字段逐字段无损(diff 验证);reason 在 SSE 流中可见;audit 有记录。

### B4. 操作记录查看 UI

- InlineTestingPanel.tsx:任务详情区加「操作记录」入口(按钮/图标)→ 弹窗列表(GET `/api/test/audit`),时间倒序,列:时间(fmtCnDateTime 本地化)/ 步骤 / 动作 / 方式(手动·批量·自动)/ 详情。
- i18n 同步。

**验收**:CDP 打开弹窗截图,记录与实际操作一致。

---

## 4. 验证与交付纪律

1. **每批完成**:`npm run test`(tsc+单测)→ CDP 全链路实测(dev 起 next;⚠️ preview_start 实际读**父目录** `/Users/jiah/AILab/.claude/launch.json`,勿改错文件)。
2. **门控/报告/推荐均为 UI 行为,必须打包验收**(mac + Windows);用工作台 header 的 BUILD_ID 构建标记核对包版本,反「已修未打包」误判。
3. push 前 `git fetch + rebase`(与同事并行分支纪律)。
4. 全部完成后按 CLAUDE.md 输出两份文档:`docs/handover/test-regression-suite.md` + `docs/insights/test-regression-suite.md`(互相反链)。

## 5. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 「回归集」与「回归基线」口径被 AI/后人混淆 | §1 命名约定 + rules 正交区分表 + reduce 注释;代码禁用 regression* 命名新概念 |
| RunJson schema 扩展破坏旧报告 | suite 字段全可选,消费方可选链兜底;旧 run.json 不含即不显示 |
| 「运行任务」流程新增一次停顿(用例后) | 需求本意(用户确认门控点);执行→报告仍自动连跑;批量直通不变 |
| AI tags 产出非枚举值/漂移 | rules 钉死判定标准与取值;merge 侧只认「回归测试」字符串 |
| recommend 大用例集输出超长 | @@RECOMMEND 行协议逐条输出,harvest 容错;>100 条时 prompt 要求只输出 suite=true 的条目+显式条数自检 |
| 审计写盘失败影响主流程 | appendAudit 静默失败,fire-and-forget |
| 回滚 | 各工作项独立 commit,可单独 revert;HUMAN_GATED 回退一行即恢复旧门控 |

## 6. 进度跟踪

| 项 | 状态 | commit |
|----|------|--------|
| A1 生成打标(prompts/rules/revise schema) | ✅ 完成 | 09f10d8 |
| A2 导入/导出标签列 | ✅ 完成 | debd834 |
| A3 「运行任务」用例门控 | ✅ 完成 | 273d3ea |
| A4 审计地基(lib+API+12埋点) | ✅ 完成 | 3179e33 |
| A5 单测+i18n+CDP mock 全链路验证 | ✅ 完成 | 2541164 |
| B1 reduce 回归集口径+单测 | ✅ 完成 | 949f124 |
| B2 报告展示口径(UI/xlsx/prompt/rules) | ✅ 完成 | c8ec748 |
| B3 存量 AI 推荐(API+按钮+单测) | ✅ 完成 | c11f519 |
| B4 操作记录 UI + 批次B CDP 验证 | ✅ 完成 | eef5a96 |
| 打包验收(mac+Win) | ⏳ 待用户发起 | |

**验证记录(2026-07-07)**:单测 1828 pass / 1 fail(project-mcp-injection 预存环境问题);
CDP mock 全链路(真实数据零接触):门控停批→批准→接力→审计链 4 条完整;SuiteBanner
红线横幅两处渲染;操作记录弹窗 i18n 映射正确;console 零错误。better-sqlite3 已
rebuild 为 Node ABI(dev 用;打包 after-pack 自动改回),原 109 个 db 预存失败一并恢复。
