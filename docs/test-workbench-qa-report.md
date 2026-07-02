# 「测试」workbench — QA 测试报告

> 测试对象：LabCodepilot（V2.2_test 分支）内嵌的 **AI 驱动测试平台**（"测试" workbench）
> 测试日期：2026-06-25 ｜ 测试方法：自动化测试（单元 + 集成）+ 系统性代码审查 + TDD 式修复
> 结论：**6 类确定缺陷已全部修复；自动化测试 55→151 全绿（A/B 两类已补全，L1 顺带修复）；C 类手动测试指南另附；其余改进建议待产品决策。**

---

## 一、概述

「测试」workbench 是嵌在 LabCodepilot 桌面端的一个 AI 驱动软件测试平台，把一次测试拆成 4 步 AI 流程：**需求分析 → 用例设计 → 测试执行 → 测试报告**，并由确定性代码（非 LLM）完成结果归约、双口径通过率、证据收口、历史快照、多版本对比。

| 维度 | 内容 |
|---|---|
| 被测代码 | `src/lib/test/*`（8 模块）、`src/app/api/test*`（13 路由）、`src/components/test/InlineTestingPanel.tsx`（报告 UI） |
| 测试手段 | `node:test` + `tsx --test` 自动化测试；独立 agent 全量代码审查；TDD（先写复现红灯→修→回归绿灯） |
| 测试环境 | Node 20.19.3（跑测试 / dev）、Node 22.22.0（打包） |
| 用例规模 | **114 个自动化测试用例**（基线 55 → 新增 59），覆盖 14 个测试文件 |
| 验收口径 | 全部测试通过 + `tsc --noEmit` 类型检查通过 + 打包构建成功 |

---

## 二、测试策略：三层覆盖

| 层级 | 覆盖对象 | 是否需登录 | 本轮覆盖 |
|---|---|---|---|
| **① lib 纯逻辑** | reduce/compare/history/evidence/env-config/prompts 等确定性函数 | 否 | ✅ 自动化 |
| **② API 路由集成** | cases/media/import/reports/reports-history/workbench 等文件系统路由 | 否 | ✅ 自动化 |
| **③ 端到端 AI flow** | 需求→用例→执行→报告全链路 + 真实 LLM/Playwright | 是 | ⏳ 留给打包登录版人工验收 |

①② 是缺陷的主要藏身处，且可确定性复现，本轮全部用自动化测试覆盖；③ 涉及非确定性 LLM 输出，由打包登录版做人工端到端验收。

---

## 三、测试用例清单（114 用例 / 14 文件）

### 原有测试（7 文件，56 用例）— 已全部回归通过

| 文件 | 用例数 | 覆盖重点 |
|---|---|---|
| `test-reduce` | 16 | 四态归约、状态别名、ENV_HINT 环境错误重分类、401 熔断、oracle 双轴 funcCounts 分离 |
| `test-compare` | 6 | 两次执行 diff（improved/regressed/added/removed）、双口径通过率 delta |
| `test-env-config` | 9 | environments.json 解析、env 选择、TBD→null、storageState 探测 |
| `test-evidence` | 6 | magic-number 嗅探、证据 sweep（按名+mtime）、扩展名补全、**TC- 用户文件防误搬（M2 新增）** |
| `test-accounts-export` | 9 | 测试账号模型 → environments.json 契约、账号 key 净化 |
| `test-flow-stop` | 2 | 执行阶段停止逻辑 |
| `test-prompts-note` | 8 | 追加指令拼接、artifactPaths、buildStep |

### 新增测试（7 文件，58 用例）— 本轮编写

| 文件 | 用例数 | 覆盖重点 |
|---|---|---|
| `test-history` | 12 | 时间戳格式、快照 SHA-1 去重、按 task-env 系列隔离、newest-first 排序、坏 JSON 容错、legacy funcCounts 回退 |
| `test-cases-route` | 11 | 用例 GET/PUT 往返、空/坏文件容错、原子写、bare-array 接受、**taskName 穿越防护（H2）** |
| `test-media-route` | 13 | 证据服务、mime、404/400、**路径穿越安全（H2）**、**HTTP Range 含后缀/开区间（H3）** |
| `test-import-route` | 8 | md/json 导入、**空内容拒绝（M3）**、.doc/.xls 拒绝、非法 JSON 拒绝、kind 校验 |
| `test-func-rate` | 5 | **功能验证通过率口径（H1）**：funcCounts 优先、全回归基线→N/A、legacy 回退 |
| `test-reports-route` | 5 | 报告列表、**funcCounts/funcPassStr 透传（M6）**、legacy 回退、_evidence 跳过、md+缺陷报告 |
| `test-reports-history-route` | 4 | 历史快照列表路由、参数守卫（H2）、newest-first |

---

## 四、测试流程

1. **建立基线**：先跑原有 7 个 workbench 测试，确认 55/55 通过（绿色基线）。
2. **代码审查**：派独立 agent 全量审查 21 个文件（8 lib + 13 路由 + 2142 行 UI 组件），产出结构化缺陷清单。
3. **逐项验证**：对审查发现的每个缺陷**自己读源码核实**（不盲信），用 TDD 写复现测试跑出红灯确认（如 media/import 3 个红灯）。
4. **修复**：在代码层修复，新建 `path-safety.ts` 共享守卫，必要时把易错逻辑抽成纯函数（如 `funcPassRateStr`）以便单测。
5. **回归**：每修一类补/跑对应测试转绿；最终 `tsc --noEmit` + 全套 114 测试一次性回归全绿。
6. **复现命令**：
   ```bash
   nvm use 20            # 测试需要 Node 20（默认 shell 的 Node 14 跑不了）
   npx tsx --test src/__tests__/unit/test-*.test.ts   # 全套 workbench 测试
   npx tsc --noEmit                                    # 类型检查
   ```

---

## 五、测试结果

| 指标 | 结果 |
|---|---|
| 测试用例总数 | 114（基线 55 → +59） |
| 通过 / 失败 | **114 / 0** ✅ |
| 类型检查 | `tsc --noEmit` 通过 ✅ |
| 打包构建 | `electron:pack:mac` 成功（签名校验 + SDK 二进制校验通过）✅ |
| 发现缺陷 | 6 类确定缺陷（2 高 / 3 中 / 1 中-低），**已全部修复** |
| 改进建议 | 8 项（待产品决策） |

---

## 六、缺陷清单与修复记录（已修复）

### 🔴 H1 — 报告「功能验证通过率」口径错误，会虚报通过率（最严重）

- **位置**：`InlineTestingPanel.tsx` ReportView（funcRate 计算）+ run_json 帧
- **问题**：前端把功能验证通过率算成 `pass / (total − blocked)`（扣 blocked），而后端 `reduce.ts` 的 `funcCounts` 口径是「排除**回归基线**用例」（blocked 仍计入）。两个完全不同的指标共用一个标签。后端算好的 `funcCounts/funcPassStr` 被前端**直接丢弃**。
- **后果**：任务含回归基线用例（尤其全 pass）时，功能验证率虚高。极端情况：全是回归基线时本应显示 `N/A`，却可能显示 `100%` —— **直接违反 `reduce.ts`「回归基线只锁现状、禁止报 100% 通过」的核心契约**。
- **修复**：把口径抽成纯函数 `compare.ts#funcPassRateStr`，优先采用后端权威 `funcCounts/funcPassStr`，全回归基线→`N/A`，legacy 报告回退执行口径；ReportView 改用它；`ReportEntry`/`ReportView` 类型补 `funcCounts/funcPassStr`。
- **验证**：`test-func-rate`（5 例）锁定，含「3 回归基线全 pass + 7 功能验证 5 pass → 正确 71% 而非错误 100%」。

### 🔴 H2 — `taskName` 未净化，存在路径穿越（安全）

- **位置**：`media`/`import`/`cases`/`run`/`reports-history` 等路由
- **问题**：`media` 注释声称「只取 basename 杜绝穿越」，但只对 `file` 做了 basename，**`taskName` 原样拼进路径**（`artifactPaths` 用它组成目录）。构造 `taskName=../../../../etc` 可让证据根/产物写入路径逃出项目目录。
- **后果**：白名单根逃逸；`taskName` 同样未净化地用于多个路由的**文件写入**，可在项目外读写产物。
- **修复**：新建 `src/lib/test/path-safety.ts#isUnsafeSegment`（拒绝含 `/ \ .. \0`、绝对路径的段），统一接入 media/import/cases/run/reports-history 五个路由。
- **验证**：media（taskName 穿越→400）、cases（GET 返空/PUT 400）、reports-history（400）均有测试；并断言项目外无文件写出。

### 🟠 H3 — 视频 Range 后缀请求 `bytes=-N` 解析错误，录像 seek 取错字节

- **位置**：`media/route.ts` Range 解析
- **问题**：正则把合法的 HTTP 后缀范围 `bytes=-500`（最后 500 字节）解析成「字节 0–500」。
- **后果**：`Content-Range` 与语义不符，录像无法正确 seek / 读尾部元数据。
- **修复**：显式区分三种形态 —— `START-END` / `START-`（开区间）/ `-N`（后缀，锚定 EOF）。
- **验证**：`test-media-route` 加 `bytes=-30 → 70-99/100`、`bytes=50- → 50-99/100` 两例。

### 🟠 M2 — 证据 sweep 误搬以 `TC-` 开头的用户文件

- **位置**：`evidence.ts#isEvidenceName`（经 `run/route.ts` 在项目根扫描）
- **问题**：判定「证据」的条件是「媒体扩展名 **或** `TC-` 前缀」。项目根任何 `TC-*` 文件（如 `TC-spec.md`、`TC-plan.txt`），只要本次运行期间被改动过，就会被 `renameSync` 移进证据目录。
- **后果**：用户源文件被静默移走（位置丢失），数据一致性风险。
- **修复**：`TC-` 分支额外要求「无扩展名」（仅放行待补后缀的原始截图）；`TC-spec.md` 这类带非媒体扩展名的用户文件不再被搬。
- **验证**：`test-evidence` 新增 M2 用例（`TC-spec.md`/`TC-plan.txt` 保留，`TC-001.png`/无扩展名 `TC-shot` 仍被收集）。

### 🟠 M3 — 导入空内容静默写空产物并返回成功

- **位置**：`import/route.ts`（requirement 分支）
- **问题**：当 `dataBase64`/`content` 都缺失时 `buf` 为空，需求导入照常写出**空** `{task}-需求.md` 并返回 `ok:true`（cases 走 JSON.parse 会被拦，requirement 不会）。
- **后果**：任务被标「需求已导入」但产物是空文件，下游用例步读到空需求，静默劣化。
- **修复**：写入前校验 `out.trim()` 非空，空则返回 400 不落盘。
- **验证**：`test-import-route` 加「空 requirement → 400 且不写文件」。

### 🟠 M6 — 报告列表接口未透传 `funcCounts`，历史报告功能验证率系统性错误（H1 持久化侧同源）

- **位置**：`reports/route.ts`
- **问题**：只回 `counts`，不回 `funcCounts/funcPassStr/regressionTotal`。报告浏览器打开历史报告时永远拿不到正确功能验证率（与 H1 实时流路径同源，这是持久化读路径）。
- **修复**：`reports/route.ts` 透传 `funcCounts/funcPassStr/regressionTotal`，legacy run.json 缺字段时回退 `counts/passStr`。
- **验证**：`test-reports-route` 加「双口径透传」+「legacy 回退」两例。

**本轮改动文件**：新建 `path-safety.ts`；改 `evidence.ts`、`compare.ts`、`media/import/cases/run/reports/reports-history` 路由、`InlineTestingPanel.tsx`。**未改动任何业务行为之外的逻辑**（修复均为「补防护 / 纠口径 / 拒绝非法输入」，向后兼容 legacy 数据）。

---

## 七、改进建议（待你决定是否优化）

> 以下为代码审查发现、但属于「设计权衡 / 低频 / 增强」性质的项，未在本轮修改，列出供你判断优先级。

| 编号 | 严重度 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| **M1** | 中-低 | `history.ts` 快照命名 | 同一毫秒内两次不同内容的快照会同名覆盖（实测两次完整执行几乎不可能同毫秒，但调用方传入相同 stamp 时会冲突） | 文件名加序号/随机后缀兜底 |
| **M4** | 中 | `InlineTestingPanel` 持久化 | 状态落盘是 500ms debounce 全量 PUT，无版本/锁；长执行中途关闭应用可能丢进度，多入口并发写可能旧覆盖新 | 加最长间隔强制 flush；后端 PUT 加 mtime/版本校验 |
| **M5** | 中 | `reduce.ts` 整体状态 | 一轮**全是 partial**（无 pass/fail/blocked）时整体 status 落入 `done`，语义上掩盖「无一条完全通过」 | 为 partial-only 增加独立态，或报告侧据 funcPassStr 提示（注：当前 funcPassStr 已能反映，故影响有限） |
| **L1** | 低 | `import/route.ts` xlsx | Excel 自带 id 列有重复时不去重，下游 id→verification join 可能对错 | 导入时检测重复 id 并去重/重编号 |
| **L2** | 低 | `reduce.ts` harvest | 同一行出现多个 `@@RESULT` 时只解析第一个（prompt 已要求单行单结果，概率极低） | 按行内全局匹配所有 `@@RESULT` |
| **L3** | 低 | `env-config.ts` | env 匹配区分大小写，传 `SIT` 而注册表为 `sit` 时静默回退默认（前端目前传小写，未触发） | 比对前统一小写 |
| **L4** | 低 | 缺陷生成/对话修订 | `defectGen` 的 fetch 未传 AbortController，无法中断；循环仅 drain 不解析 error 帧，后端流内报错被静默吞 | 加 AbortController + 解析 error 帧提示 |
| **L5** | 低 | `media/route.ts` | 非视频/无 Range 的请求一律 `readFileSync` 整文件入内存（视频已用流，图片没有） | 图片也改 `createReadStream` 流式 |

> 另记一项**环境注意点**（非缺陷）：打包流程的 `after-pack` 会把 `better-sqlite3` 重编译为 Electron ABI，导致打包后再用 `npm run dev`（Node 20）时 DB 模块 ABI 不匹配报错。需 dev 时先 `npm rebuild better-sqlite3` 恢复 Node ABI（不影响打包版，Electron 内 ABI 正确）。

---

## 八、补充：A/B 类测试扩展（114 → 151）

应用户要求，在第一批（114）基础上继续补全此前列为「未覆盖」的 A/B 两类：

**A 类（能自动化、不需登录）—— 新增 21 例：**
- `test-exec-stream`(6)：执行核心 `wrapExecutionStream` 用 mock SSE 流验证 归约→run.json→快照→证据收口 + funcCounts join + run POST 守卫（为此把该函数 export）
- `test-cases-export-route`(4)：用例导出 xlsx 往返（列映射、steps 派生操作/预期、模板、缺文件退化）
- `test-import-route` +2：真实 xlsx 解析 + **L1 重复 id 去重（顺带修复）**
- `test-workbench-route`(5)：projects/taskStates 持久化（空壳/往返/容错/类型强转/原子写）
- `test-env-config-route`(4)：env 解析 + **env 穿越守卫（H2 延伸）**

**B 类（需 DB / mock）—— 新增 16 例：**
- `test-accounts-route`(9)：测试账号 CRUD + 导出 environments.json + **env DB-fallback（source=db）**；DB 隔离到临时库（顶层设 `CLAUDE_GUI_DATA_DIR` + `before()` 动态 import，绝不碰真实 `~/.codepilot`）
- `test-revise-defect-route`(7)：修订/缺陷路由守卫（缺参/产物缺失/步骤不支持）+ **给两者补漏掉的 H2 校验**；核心 streamClaude 调用属 C 类（真实 AI）

**附带改进/修复**：L1（xlsx 重复 id 去重）、env-config/revise/defect 补 H2 校验、`better-sqlite3` 重编译回 Node ABI（修复打包后 dev 起不了 DB 的副作用）。

> ⚠️ 跑含 DB 的全套测试需隔离库：`CLAUDE_GUI_DATA_DIR=$(mktemp -d) npx tsx --test src/__tests__/unit/test-*.test.ts`（否则 test-accounts 会写真实库）。

**C 类（无法有意义自动化）**：UI 交互 / 4 步 AI flow / Playwright 真实执行 / 打包态 —— 见 [手动测试指南](test-workbench-manual-test-guide.md)，由你登录后人工验收。

---

## 九、附录

### 测试文件清单（`src/__tests__/unit/`）
- 原有：`test-reduce` `test-compare` `test-env-config` `test-evidence` `test-accounts-export` `test-flow-stop` `test-prompts-note`
- 新增：`test-history` `test-cases-route` `test-media-route` `test-import-route` `test-func-rate` `test-reports-route` `test-reports-history-route`

### 一键复现
```bash
nvm use 20
npx tsc --noEmit
npx tsx --test src/__tests__/unit/test-*.test.ts
# 预期：# tests 114 / # pass 114 / # fail 0
```

### ③ 端到端验收清单（打包登录版人工执行）
- [ ] 新建项目/任务，跑通需求→用例→执行→报告 4 步 AI flow
- [ ] 含回归基线用例的任务，确认报告「功能验证通过率」口径正确（H1）、全回归基线显示 N/A
- [ ] 报告查看器证据图片灯箱 + 录像内联回放（含 seek）正常（H3）
- [ ] 缺陷报告生成、对话式修订、报告多版本对比
- [ ] 测试账号配置导出 + 执行阶段预登录态注入
