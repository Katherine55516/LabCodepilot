# ai-lab-test-framework 流程测试能力集成方案

> 创建时间：2026-06-24
> 调研对象：`/Users/jiah/AILab/ai-lab-test-framework`（`app/` 桌面应用 + `framework/` CLI 方法论）
> 目标载体：LabCodepilot 内嵌测试工作台（`src/components/test/InlineTestingPanel.tsx` + `src/app/api/test/*` + `src/lib/test/*`）
> 关联执行计划：[docs/exec-plans/active/test-framework-integration.md](../exec-plans/active/test-framework-integration.md)

## 一、目标

评估 ai-lab-test-framework 的流程测试能力，确定哪些值得集成进 LabCodepilot 现有的 4 步内嵌测试工作台，并给出每项的技术设计与分期路线。本文是方案蓝图，逐项落地时另开/更新 exec-plan。

## 二、认知校准（关键，别拿错参照系）

framework 仓库里有**两条产物线**：

1. **CLI 框架**（`framework/rules/` + `commands/`）：经典 6 步方法论 —— 代码分析 → 需求 → **需求评审** → 用例 → 执行 → 报告。是"权威方法论"，但交付形态是命令行。
2. **桌面 app**（`app/`）：**本身已是裁剪版** —— V0.3 删掉"脚本生成"（改 Playwright MCP 实时驱动浏览器）、把"代码分析"降级为只读、把"需求评审"内化进需求步。真正主干 = **需求 → 用例 → 执行 → 报告 四步**。

**结论：LabCodepilot 的 4 步内嵌版 ≈ app 的形态**（同为 Agent SDK + Playwright MCP）。集成的参照系应是 `app/`，不是 6 步 CLI。主干已搬齐，差的是 app 围绕主干长出来的一圈**工程能力**。

## 三、能力对照（framework app vs LabCodepilot 现状）

| 能力 | framework app | LabCodepilot 现状 | 结论 |
|---|---|---|---|
| 4 步主干 + human gate + 智能跳步 | ✅ | ✅ | 已对齐 |
| Playwright MCP 执行 / 四态归约 / 401 熔断 / 环境白名单 | ✅ | ✅ `reduce.ts`/`env-resolve.ts` | 已对齐 |
| 测试账号 + 环境(local/SIT) + 登录态捕获 | ✅ | ✅ `test-accounts` + `electron/test-auth-capture` | 已对齐 |
| 用例导入(xlsx/docx) | ✅ | ✅ `api/test/import` | 已对齐 |
| 用例**展示** | ✅ | ✅（2026-06 新增 `api/test/cases` + 详情卡） | 已对齐 |
| 用例 **Excel 导出 + 用例编辑器** | ✅ 双向 + 内联 CRUD | ❌ 只有导入 | **缺** |
| 报告查看器(证据图片灯箱 + **录像内联回放**) | ✅ `ailab-media://` 协议 | ⚠️ 有报告浏览，证据/录像回放弱 | **缺/弱** |
| **报告多版本对比**(逐用例 diff + 通过率变化) | ✅ | ❌ | **缺** |
| **缺陷报告**(第三交付物，给开发) | ✅ `defect-report.js` | ❌ | **缺** |
| **对话式定向修订产物** | ✅ `revise.js` 改当前产物 | ⚠️ 仅"追加指令喂下一步"(`submitNote`) | **缺/弱** |
| **需求评审覆盖矩阵 + oracle 双轴 + 双口径通过率** | ✅ | ❌ 规则只导入 4/9 | **缺（影响测试质量）** |
| 历史版本+行级diff / 多任务并发 / ETA / 增量复用 / 常驻会话 | ✅ | ❌ | 缺（编排/体验类） |
| 代码分析步 / embed 内嵌浏览器 / OAuth 托管配置 | ✅ | ❌ | **不建议搬**（见 §5） |

## 四、集成方案（分批）

### 第一批 · 自包含亮点（与主干解耦，增量加，低风险，建议优先）

#### 1.1 用例编辑器 + Excel 双向
- **现状**：有导入（`api/test/import` xlsx→cases.json、docx→需求.md），用例只读展示（详情卡）。无导出、无编辑器。
- **framework**：`app/src/main/engine/xlsx-import.js`（柔性表头识别）+ `xlsx-cases.js`（导出 + 模板）+ `renderer/index.html` 的 `ce*` 系列（内联增删改查 + 字段筛选 + 批量删 + JSON 自愈）。
- **集成设计**：
  - API：扩 `api/test/cases/route.ts` 加 `PUT`（写回 `cases.json`，原子写，仿 `workbench` route）；新增 `api/test/cases/export`（用例→xlsx）+ `template`（空模板）。
  - UI：把详情卡的用例列表（已有只读）升级为可编辑——字段内联编辑、增删用例、"保存"(PUT)、"导出 Excel"、"下载模板"按钮。
  - 复用：`exceljs`（已是依赖 `^4.4.0`）；`GeneratedCase` 类型（已加）。
  - 工作量：**中**。 依赖：无。

#### 1.2 报告查看器（证据图片灯箱 + 录像内联回放）
- **现状**：`api/test/reports`（列报告）+ `evidence.ts`（采集），但报告视图以 md 为主，证据图片/录像回放弱。
- **framework**：报告查看器把 xlsx 渲染成表 + 逐用例证据；`ailab-media://` 自定义协议流式回放录像（白名单 `report/_evidence/`，支持 seek）。
- **集成设计**：
  - 媒体服务：Next 不走自定义协议，改加 `api/test/media/route.ts` —— 流式返回证据图片/录像，**严格白名单到项目的 `AI_LabTest/report/_evidence/`**，视频支持 HTTP Range（seek）。
  - UI：报告视图逐用例展示证据缩略图（点开 lightbox）+ `<video>` 内联播放（src 指向 media route）。
  - 数据：`run.json` 的 `tests[].evidence/video/attachments`（执行已产）。
  - 工作量：**中**。 依赖：执行阶段证据采集（已有）。

#### 1.3 缺陷报告（第三交付物）
- **现状**：report 阶段产报告 md + run.json，无独立缺陷单。
- **framework**：`defect-report.js` —— fresh 会话、只收 `status=failed 且确属应用 bug` 的用例、消费 `run.json` 的 `tests[].api`（失败用例抓的关键接口）、产开发可定位的缺陷单（只写期望行为 + 验收标准，禁写修复方案/优先级/指派，守 QA 铁律）。
- **集成设计**：
  - 后端：report 阶段后追加一个 defect 生成（独立 prompt，参考 `defect-report.js`），读 run.json 失败用例，产 `AI_LabTest/report/{task}/{task}-{env}-缺陷报告.md`。
  - UI：报告视图加"缺陷报告" tab/入口。
  - 工作量：**中**。 **依赖（待确认）**：执行阶段 fail 用例是否抓了接口信息（`run.json.tests[].api`）。LabCodepilot 当前执行 prompt/reduce 可能未抓 → 需在执行 prompt + `reduce.ts` 补 api 字段，否则缺陷单缺接口定位。

#### 1.4 对话式定向修订
- **现状**：`submitNote` 把"追加指令"存进 `notes`，喂给**下一步**的 prompt —— 不修改当前产物。
- **framework**：`revise.js` —— 读当前步产物 → AI 定向编辑 → 覆盖（用例步后做 JSON 自愈 + 复校）。
- **集成设计**：
  - 后端：新增 `api/test/revise/route.ts`（读当前 step 产物 + 用户指令 → AI 定向编辑 → 覆盖产物）。
  - UI：需求/用例阶段对话框加"修订"动作（区别于追加指令）：输入"把第 3 条用例的预期改成…"→ 改产物 → 刷新展示。
  - 工作量：**中**。 依赖：产物展示（需求 md / 用例 cases.json，后者已展示）。

### 第二批 · 测试质量（方法论，价值最高，需谨慎）

#### 2.1 需求评审覆盖矩阵 + oracle 双轴 + 双口径通过率
- **现状**：`src/lib/test/rules/` 只导入 4/9，缺 `requirement-review.md`/`requirement-completeness.md`。`test-case-completeness.md` 已导入（oracle 双轴的规则依据），但 `prompts.ts` 是否落实**待确认**。报告无双口径通过率。
- **framework**：
  - 需求评审（CLI Step3）：4 维评分（清晰度/完整度/可测试性/原子性）+ 6 路径覆盖矩阵 + 缺口强制交互。**app 的折中**：把自审内化进需求生成第二趟（`requirements.js:200-222`），不产独立 review.json。
  - **oracle 双轴**（`test-case-completeness.md:76-101`）：用例来源分"功能验证"（权威）vs"回归基线"（代码反推/照抄 UI 现状），防"代码反推的用例永远 pass 冒充验证通过"。
  - **双口径通过率**（`test-report.md:81`）：功能验证通过率（排除回归基线）vs 执行通过率；全为回归基线记 N/A，不得报"100% 通过"。
- **集成设计（走 app 轻量路线，不新增独立步）**：
  - 导入缺失规则到 `src/lib/test/rules/`：`requirement-review.md` + `requirement-completeness.md`。
  - 需求阶段：prompt 加"自审趟"（内化评审）+ 可选产覆盖矩阵小节。
  - 用例阶段：prompt 落实 oracle 双轴 —— `cases.json` 每条加"来源/oracle 类型"字段。
  - 报告阶段：`report` prompt + `reduce.ts` 计算双口径通过率。
  - 工作量：**中-大**（prompt/规则工程 + reduce 双口径 + cases.json 字段）。
  - **风险**：纯 prompt/方法论改造，效果需实测；触及测试质量核心，要专门一轮 + 真实项目验证，不可草率。
  - **✅ 已落地（2026-06-24）**：见 [handover/test-oracle-dual-rate.md](../handover/test-oracle-dual-rate.md) / [insights/test-oracle-dual-rate.md](../insights/test-oracle-dual-rate.md)。规则已导入、prompts/reduce/UI/导出已改、reduce 双口径单测 16/16、UI dev 实测通过；prompt 方法论效果待真实项目（有模型）实测校准。

### 第三批 · 回归与体验（锦上添花，按需）

| 功能 | framework 依据 | 集成要点 | 工作量 |
|---|---|---|---|
| 报告多版本对比（逐用例 diff + 通过率变化） | `renderer renderCompare` + `history.js` | 需先有产物历史快照（`.history/`，SHA-1 去重）+ compare UI | 中 |
| 产物历史版本 + 行级 diff | `history.js` + `renderUnifiedDiff` | 每次生成存快照 + diff 面板 | 中 |
| 每步 ETA + 实际耗时 | `STEP_ETA` 表 + 引擎计时 | 流水线/详情卡显示预估与实际耗时 | 小 |
| 多任务并发 + 队列 + 并发上限 | `AUTO_QUEUE`/`dispatchQueue` | 编排改造；内嵌单任务形态按需 | 中 |

## 五、不建议搬（及理由）

- **代码分析步**：app 已把它降级为只读目录、不再是流程入口（改由"新建任务"发起）。LabCodepilot 用"选项目 + 导入需求/用例"发起，无需正式做这一步。
- **embed 内嵌浏览器**（`embed-browser.js`）：执行已外置为独立 Playwright 浏览器（spike 证实复用内嵌视图会误暴露 app 自身窗口），`shouldShowEmbed` 恒 false，仅演示用。
- **OAuth 托管配置整套**（`app/src/main/auth/*`）：LabCodepilot 已有自己的登录/账号体系，不需要 framework 这套。
- **CLI 框架那条线**（`framework/` + `commands/` + `install.sh`）：与内嵌工作台是不同交付形态，无关。

## 六、分期路线建议

- **Phase 1（第一批，自包含亮点）**：用例编辑器+导出 → 报告查看器(证据/录像) → 缺陷报告 → 对话式修订。四项彼此解耦、不动主干编排，可独立增量交付，用户直接可感知。
- **Phase 2（第二批，测试质量）✅ 已落地（2026-06-24）**：需求自审 + oracle 双轴 + 双口径通过率。价值最高但偏 prompt/方法论，单独一轮 + 真实项目实测。实现见 [handover/test-oracle-dual-rate.md](../handover/test-oracle-dual-rate.md)。
- **Phase 3（第三批，按需）**：报告多版本对比、历史版本、ETA、并发。

## 七、落地前待确认清单

1. `run.json.tests[]` 是否含失败用例的接口信息（`api` 字段）—— 决定缺陷报告能否定位接口（1.3）。
2. `prompts.ts` 的用例/报告 prompt 是否已落实 oracle 双轴与双口径口径（2.1）。
3. 报告视图当前对证据/录像的展示程度（1.2 的增量边界）。
4. 打包态下 media route 读 `AI_LabTest/report/_evidence/` 的路径解析（与 `cases` route 一致，用 projectPath 拼）。
