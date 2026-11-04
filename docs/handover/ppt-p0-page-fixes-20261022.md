# PPT 页面 P0 修复与真实流程验收（2026-10-22）

> 依据：`ppt-gamma-results-20261013/PPT_Module_Page_Function_Review_20261021.md` 第 0 节 P0 小改动。
> 分支 `claude/ppt-p0-page-fixes-20261021`，基于 `claude/ppt-full-review-20261021`（f316157d）。第一个提交把主检出中未提交的 PPT 代码改动原样同步过来（真实读取输入依赖其中的引文定位），第二个提交是本文所列修复。

## 1. 页面修复

| 问题 | 修改 | 位置 |
|---|---|---|
| 窗口 < 1280px 时桌面导航栏仍内联显示 | 未分层 CSS 的 `display:flex` 盖过了 Tailwind `hidden`；改为只给 `:not(.hidden)` 和 xl 断点设置 `display` | `ppt-prototype.css` |
| 编辑器头部操作被工具栏挡住（1024px 实测） | 头部操作换行后高度被固定为 52px；改为 `height:auto` | `ppt-prototype.css` |
| 生成中“取消”无确认，大纲阶段无取消 | 两个阶段都用 `PptConfirmDialog`，文案说明取消后不能重试、可改用暂停 | `PptGenerationMonitor.tsx` |
| 跨页粘贴必然 404 | 剪贴板记录来源页；`nodes.duplicate` 新增可选 `sourceSlideId`（跨页保持原位置，模板原生对象拒绝跨页，冲突目标记在来源页） | `StructuredPptEditor.tsx`、`command-schema.mjs`、`command-service.mjs` |
| 点击其他页对象后又跳回原页 | 选区 AI 框卸载时只在焦点落到 body 时归还焦点，不再把焦点拉回旧对象触发旧页 `onFocus` | `SelectionAiComposer.tsx` |
| 退出确认框被选区 AI 框遮挡 | 退出确认框打开时暂不渲染选区 AI 框 | `StructuredPptEditor.tsx` |
| Esc 会提交内联编辑 | Esc 放弃修改 | `PptCanvas.tsx` |
| 列表超过 20 项被静默截断、条目 ID 按行号复用 | `src/lib/ppt-inline-list.ts`：按 LCS + 移动 + 原位编辑匹配条目 ID；超过服务端上限时保留编辑框并提示 | `PptCanvas.tsx`、`StructuredPptEditor.tsx` |
| Cmd+S 触发发布（模型审查 + 导出） | Cmd+S 只提示“已自动保存为草稿”；按钮改名“检查并发布”并说明会运行模型审查 | `StructuredPptEditor.tsx`、i18n |
| 大纲轮询不可取消、会串台 | `src/lib/ppt-outline-poll.ts` 支持 `AbortSignal`；向导在重读、输入变化、改页数和卸载时中止旧轮询 | `PptWorkspace.tsx`、`PptCreateWizard.tsx` |

## 2. 真实流程中发现并修复的问题

真实模型 qwen3.8-max，隔离服务（后端 3198 / 前端 3199，独立 profile），输入为约 2,000 字的技术复盘（含表格）。流程：粘贴 → 读取（建议 6 页）→ 大纲（6 页）→ 生成 → 审查 → 编辑 → 检查并发布。

| 问题 | 根因 | 修改 |
|---|---|---|
| 读取输入失败 `invalid exact UTF-16 evidence` | 模型无法给出精确偏移 | 主检出已有 `locateEvidence`（同步提交） |
| 总结页数字全部判为无来源 | 页面级数字核对只认本页绑定的原文，总结页没有绑定 | 无来源的 summary/closing/conclusion 页按本稿其他页引用的原文核对（不是整份输入） |
| “P99 降低 67%”判为符号不符 | 原文是 `-67%` | 数字前有“降低/下降/减少/reduced by…”时与原文同单位负值比对；“降至”不适用；同值正数（如 48 ms）不再遮蔽 `-48%` |
| “67%”判为归属不符 | 分词不收 `P99` 这类字母数字指标名 | 分词改为 `[a-z][a-z0-9_]+` |
| 拦截提示仍写“再次保存” | 按钮已改名 | 文案改为“检查并发布” |

最终修订：确定性检查 0 个错误，整稿模型审查 0 项发现（遗漏、重复、冲突、无依据均为 0）。总结页原文由模型写出、被审查正确拦截（漏掉“数据清洗”、把成效归于特定规模），经编辑器修改后通过。

## 3. 验收边界

- 本机没有 LibreOffice，发布与草稿导出的可见性校验（PPTX → PDF）都会因 `soffice` 不存在而失败，项目停在 `quality_blocked`（原因 `export`）。渲染器在校验前已写出 PPTX，本轮检查了该文件：6 页，表格 6×4 完整，文字与原文一致。完整发布需在带 LibreOffice 的环境复核。
- 仍存在的质量问题（本轮未改，属于大纲命名重构 O3 的范围）：编译器为补全归属而合并页面时，用章节名拼接替换模型标题（如“背景 / 根因分析”“结果”）；第 3 页方案正文缺少原文中的“第一步：分层索引”等小标题。
- 第一次点击其他页的对象仍可能选不中：按下时当前页切换，备注栏从旧页移到新页，页面在按下与松开之间位移。备注栏放在哪里需要产品决定。

## 4. 测试

- 单元：`src/__tests__/unit/ppt-p0-page-fixes.test.ts`（跨页粘贴、列表 ID、轮询中止、数字符号与总结页范围，共 12 项）。
- E2E：`src/__tests__/e2e/ppt-p0-page-fixes.spec.ts`（导航栏、取消确认 ×2、Cmd+S、跨页粘贴、Esc 与列表上限）。同时修正与现有界面不一致的旧用例：历史时间线显示翻译后的命令名、局部优化需经“高级设置”进入完整面板、窄屏任务中心经抽屉进入。

## 5. 草稿签名拆分与编辑器命令队列（2.1 / 4.1）

依据同一评审文档的 2.1、4.1。

### 5.1 草稿签名与孤儿项目

| 变化 | 行为 | 位置 |
|---|---|---|
| 改标题、改模型 | 不再属于草稿签名：大纲保留，同一项目上 `PATCH` 标题或 `configId/model`（模型只能在生成前改，否则 409） | `src/lib/ppt-draft-keys.ts`、`PptWorkspace.syncDraftMeta`、`ppt-api.mjs` setMetadata |
| 改输入（文本、文件、图片、固定模板对象） | 草稿标记为过期（`ppt-draft-stale`），大纲仍显示；改回原输入即恢复。再次读取时先调用 `POST /projects/:id/discard` 作废旧草稿（运行中的读取或大纲会被取消），再新建项目 | `PptCreateWizard`、`ppt-api.mjs` discard |
| 改模板或除深度外的生成策略（代码、语言等） | 影响容量：清空临时大纲和页数估算，同一草稿重新读取，不新建项目 | `draftEstimateKey`、向导 `estimateKey` effect |
| 改深度（detail） | 保留大纲，确认前在同一草稿上重新规划 | `draftChange().needsReplan` |
| 读取进行中 | 输入框、文件、图片、语言、内容和知识选项锁定 | `PptCreateWizard` |

作废的草稿：`status/stage = cancelled`，写 `taskDeletedAt`、`discardedAt`，不计入成品配额。只有未确认、未发布的草稿可以作废。

### 5.2 编辑器命令队列

`src/lib/ppt-command-queue.ts`（`PptCommandQueue`）：

- 串行发送，每条命令带上一条成功后的 `baseRevision`；
- 乐观更新：几何、旋转、文字先叠加在画布上（`overlay()` + `withOptimistic`），失败时回滚；
- 等待中的同一对象几何命令合并（连续方向键只发最后的位置）；
- 错误码：`revision_conflict` 丢弃排队命令并提示重新加载；`node_locked` 只回滚并说明原因，不提示重新加载。服务端在错误响应中返回 `code`（`command-service.mjs`、`ppt/api.mjs`）。

### 5.3 测试

- 单元：`src/__tests__/unit/ppt-draft-and-commands.test.ts`（草稿键、页数估算键、模型 PATCH、作废状态、代理路由、错误码、队列 4 项）。
- E2E：`src/__tests__/e2e/ppt-draft-and-commands.spec.ts`（改标题/模型保留大纲、输入过期与作废、慢服务器下连续微移、锁定对象回滚）。
- 回归中发现并修复：模板和代码选项变化原本会清空临时大纲与估算（`ppt-prototype-parity` "template capacity changes"、`ppt-planning-assumptions`），第一版把它们并入"同一草稿重规划"后丢了这个行为，已恢复。两个 `ppt-workspace` 用例的接口 mock 没有返回 `configId/model`（真实接口会返回），已补上。
- 已知不稳定：`ppt-editorial-composer:4`、`ppt-experience-quality:104` 在本分支提交前后都会失败（与本次改动无关）；`ppt-round7:77`、`ppt-template-reuse` 在机器负载高时会因 5 秒加载超时失败，空闲时通过。
