# 导入需求：保留原文 + 需求分析节点二选一

> 产品思考见 [docs/insights/requirement-import-modes.md](../insights/requirement-import-modes.md)

AI 测试工作台「新建任务 → 导入需求」的改造：**保留用户原始文档**，并在需求分析节点让用户二选一——AI 生成需求分析 md，或直接用原文档生成用例。

## 背景：改造前的行为与硬伤

改造前，导入需求走的是「单文件」链路：

- `/api/test/import`（kind=requirement）把上传件解析成文本（docx→mammoth 抽文本 / md·txt 原样），**直接写入 `AI_LabTest/requirements/{任务}-需求.md`**——与 AI 需求分析的产物同一路径。
- 需求分析节点点「运行」→ `reuseImported=true` → AI 读 `{任务}-需求.md`、归一后**覆盖写回同一文件**。

硬伤：① 用户上传的**原始文档没有单独留存**，跑一次 AI 归一就被覆盖、找不回原文；② 「用 AI 归一」还是「直接用原文」两种意图**共享一个文件、没有显式选择入口**，全靠「跑不跑 AI」隐式区分。

## 改造后的文件模型

产物路径集中在 `src/lib/test/prompts.ts`：

| 文件（相对项目根） | 谁写 | 说明 |
|---|---|---|
| `AI_LabTest/requirements/{任务}-需求-原始.{ext}` | 导入路由 | **保留的原始上传件**（字节级，按原扩展名），永不被 AI 覆盖 |
| `AI_LabTest/requirements/.data/{任务}-导入原文.txt` | 导入路由（仅 docx） | docx 是二进制 ZIP，Agent SDK 的 `Read` 工具读不了 → mammoth 抽一份纯文本供 AI 读。md/txt 无此文件（原文即可 Read） |
| `AI_LabTest/requirements/{任务}-需求.md` | AI 需求分析（仅「生成 md」模式） | 结构化归一产物；用例设计默认读它 |

新增导出函数（`prompts.ts`）：`requirementOriginalPath(taskName, ext)`、`requirementImportedTextPath(taskName)`。

## 两种模式

需求分析节点在「导入需求且 `requirementMode` 未定」时进入 **待选择** 态，展示二选一卡片：

- **生成需求分析文档（generate-md）**：`requirementMode='generate-md'` → 跑需求步，AI **读保留的原文/抽取文本**、结构化归一后 **写 `{任务}-需求.md`**（原文只读、不覆盖）→ 待批准 → 批准 → 用例设计读 `{任务}-需求.md`。**原始 + md 两份都在。**
- **直接使用导入文档（use-original）**：`requirementMode='use-original'` → 需求步直接 `done`（不跑 AI）→ 用例设计**直接读原文/抽取文本**（不产 md）。

## 数据流

```
新建任务·导入需求
  → POST /api/test/import (kind=requirement)
      · 写 {任务}-需求-原始.{ext}（原始字节）
      · docx 额外写 .data/{任务}-导入原文.txt（mammoth 抽文本）
      · 不写 {任务}-需求.md
      · 返回 { ok, ext, originalPath, sourceTextPath?, path, preview }
  → addTask：stepStatus.requirement='review' + imported.requirement=true
             + requirementOriginal={filename,ext}，requirementMode 留空 → 待选择
  → 需求分析节点渲染二选一卡片
      ├─ 生成 md：runStep('requirement', {requirementModeOverride:'generate-md'})
      │     → POST /api/test/run 带 requirementMode + requirementOriginalExt
      │     → 后端算 requirementSourcePath=原文/抽取文本 → buildStep 读它、写 需求.md
      └─ 直接用原文：requirement→done + runStep('cases', {requirementModeOverride:'use-original'})
            → POST /api/test/run → requirementSourcePath=原文/抽取文本 → 用例读它
```

## 关键改动点（文件 → 改了什么）

| 文件 | 改动 |
|---|---|
| `src/lib/test/prompts.ts` | 加 `requirementOriginalPath`/`requirementImportedTextPath`；`BuildStepOptions` 加 `requirementMode` + `requirementSourcePath`；`requirementPrompt` 读 `sourcePath`（缺省回退 需求.md）、写 需求.md、强调原文只读；`casesPrompt` 读可变 `requirementSourcePath`，非 需求.md 时追加 `USER_UPLOAD` raw-source 提示（就地编 REQ-NNN） |
| `src/app/api/test/import/route.ts` | requirement 分支先算文本、空则 400 不落盘；写原始件 + docx 抽取文本；**不再写 需求.md**；返回 `ext`/`originalPath`/`sourceTextPath`/`path` |
| `src/app/api/test/run/route.ts` | 读 `requirementMode` + `requirementOriginalExt`；按 步骤 + 模式算 `requirementSourcePath`（requirement·generate-md 或 cases·use-original 才指向原文）；透传 `buildStep` |
| `src/components/test/InlineTestingPanel.tsx` | `TaskState` 加 `requirementMode` + `requirementOriginal`；`addTask` 存原文信息、mode 留空；`runStep` 透传 mode+ext（`requirementModeOverride` 规避 setState 异步）；`chooseGenerateReqMd`/`chooseUseOriginalReq` 二选一处理；节点渲染待选择卡片 + 预览原始文档；`pumpQueue` 待选择时不自动批准（Q3：批量也停下等选）；`openRequirementPreview('md'\|'original')`；加载时旧任务回填 `use-original` |
| `src/i18n/{en,zh,zh-HK}.ts` | 新增 `test.requirement.{previewOriginal,chooseTitle,chooseHint,genMd,genMdDesc,useOriginal,useOriginalDesc}`；更新 `newTaskModal.importHint` |
| `src/lib/test/rules/test-case-completeness.md` | §1.6 需求来源→oracle 映射表加 `USER_UPLOAD` 行 + 就地编 REQ-ID 说明 |

## 「待选择」闸门与批量

- 待选择态：`imported.requirement && !requirementMode && stepStatus.requirement==='review'`。此时隐藏底部「批准」条，改由节点内二选一卡片驱动。
- 批量「运行任务」无人值守时，`pumpQueue` 的 review→done 自动批准**跳过**待选择的需求步（Q3 决策：停下来等用户选），不擅自替用户选模式。选择即退出 autoRun（人工接管）。

## 向后兼容

旧「导入需求」任务只有旧 `{任务}-需求.md`、无 `requirementOriginal`/`requirementMode`。加载 workbench 时回填 `requirementMode='use-original'`，跳过待选择闸门、行为不变（继续读旧 需求.md）。无 DB/schema 迁移（测试工作台数据是 `test-workbench.json`，非 SQLite）。

## docx 为什么必经一次抽取

需求/用例步由 Claude Agent SDK 驱动，靠内置 `Read` 工具读本地文件。`Read` 支持 text/PDF/图片，但 `.docx` 是 OOXML（二进制 ZIP）读不了——所以导入路由用 `mammoth` 抽一份文本给 AI 读，原始 `.docx` 仍字节级保留。这与聊天产品「上传 docx 能分析」不同：那是服务端文档抽取管线，不是本地 Read 工具。

## 测试

- `src/__tests__/unit/test-import-route.test.ts`：md 保留为原始件、不写 需求.md、空件 400 不落盘。
- `src/__tests__/unit/test-prompts-note.test.ts`：requirement·generate-md 读原文写 需求.md、原文只读；cases·use-original 读原文不读 需求.md + raw-source 提示；cases·generate-md 默认读 需求.md。
- 手工验证（CDP + HTTP）：docx 导入原始件字节级一致（1186B）+ 抽取文本正确、md 导入不写 需求.md、空件 400；需求分析节点二选一卡片渲染、`use-original` 转 done 并推进。dev 环境 better-sqlite3 ABI 不匹配导致执行步 500 属已知限制（需 Electron ABI）。
