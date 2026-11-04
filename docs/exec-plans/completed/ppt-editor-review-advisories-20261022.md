# PPT 编辑器内的整稿审查提示：标记、应用建议、忽略

> 创建时间：2026-10-22
> 最后更新：2026-10-22
> 前置：[ppt-pipeline-unblocked-20261022.md](ppt-pipeline-unblocked-20261022.md) 阶段 3（outline-first 项目的模型判断类发现降为提示，`modelIssues[].advisory`）。该阶段推迟的"编辑器节点标黄、一键接受/忽略"在本计划完成。
> 分支 `claude/ppt-editor-advisories-20261022`（基于 `claude/ppt-outline-improve-20261022`）。

## 背景

阶段 3 之后，outline-first 项目发布时把 `model_missing / model_repeated / model_conflict / model_unsupported / claim_redundant` 记为 `modelIssues[]` 中 `advisory:true` 的条目，`quality.reviewAdvisories` 为条数。前端只在工作区质量面板列出前 5 条、在导出对话框显示条数。

调研发现两个前提问题：

1. **提示根本没到前端。** 客户端所有项目请求都带 `view=live`，`liveProjectView` 的 `quality` 投影不含 `modelIssues` 与 `reviewAdvisories`。阶段 3 的 e2e 通过，是因为夹具绕过了服务端投影。
2. **提示没有身份。** `modelIssues` 每次发布都由 `finalQualityReport` 重建，没有稳定 ID；`suggestedFix` 是审查器写的修改说明（"补入哪一项来源关系"），不是可直接写入的正文；模型审查条目通常只有 `slideIds`，没有 `nodeId`（只有 `claim_redundant` 带 `nodeId`，`unsupported` 可能带 `bulletIndexes`）。

## 方案

| 层 | 内容 |
|---|---|
| 服务端 `lib/ppt/review-advisories.mjs`（新） | 稳定 ID = 摘要(code, slideIds, nodeId, detail)；按页解析目标节点（审查给的 `nodeId` → 正文点名的节点 ID → `bulletIndexes` 对应的正文列表 → 正文引号内原文所在节点 → 无则整页）；决定账本 `project.reviewAdvisoryDecisions`；投影（每条带 `id / targets / review`，`reviewAdvisories` = 未处理条数） |
| 服务端 `project-view.mjs` | `quality` 投影加入提示条目（只含 advisory）与未处理/已处理条数 |
| 服务端 `api.mjs` | `POST /ppt/projects/:id/review-advisories/:advisoryId` `{status:'dismissed'|'open', baseRevision}`：校验版本（不符 409），写账本；`POST /ai-edit` 支持 `reviewAdvisoryId`：服务端按提示组装指令、选定目标节点与范围 |
| 服务端 `proposal-service.mjs` / `command-service.mjs` | 提案记住 `reviewAdvisoryId`；应用走 `applyCommand → commit`（版本校验、操作日志、撤销）。`commit` 在同一次写入里把提示记为 `applied`（带操作 ID）；撤销该操作 → 提示重新打开；重做 → 再次记为 `applied` |
| 代理白名单 `src/lib/ppt-proxy-path.ts` | 放行 `projects/:id/review-advisories/:advisoryId` |
| 编辑器 `StructuredPptEditor.tsx` / `PptCanvas.tsx` / `SelectionAiComposer.tsx` | 缩略图栏：有提示的页加琥珀色边框和"⚑ N"标记；画布：被标记节点琥珀色虚线框，悬停显示审查理由；选中被标记节点时，节点旁的内联 AI 面板顶部显示理由、建议和"应用建议/忽略"；页眉"N 项审查提示"在画布下方展开整页列表（选中时自动展开并突出对应条目）；"应用建议"→ 生成提案 → 内联预览前后对比 → "应用"；"忽略" → 写账本，计数下降；已处理列表可"恢复" |
| 工作区 / 导出对话框 | 计数改为未处理条数；面板只列未处理条目 |
| i18n | en / zh / zh-HK |

## 状态

| 阶段 | 内容 | 状态 | 备注 |
|---|---|---|---|
| 1 | 服务端：ID、目标解析、账本、投影、忽略路由、提案关联、撤销/重做联动 | ✅ 已完成 | |
| 2 | 前端：标记、悬停/选中显示理由、应用建议、忽略/恢复、计数 | ✅ 已完成 | |
| 3 | 测试：单元（服务端全流程、代理白名单）、e2e（标记、应用、忽略） | ✅ 已完成 | |
| 4 | 运行中的应用验证、提交 | ✅ 已完成 | 见"进展" |

## 决策日志

- 2026-10-22：**"应用建议"走 AI 提案，不直接写正文。** `suggestedFix` 是修改说明而不是替换文本，直接 `node.setContent` 会把审查器的话写进幻灯片。提案由服务端按存储的提示组装指令（客户端只传提示 ID 和当前页），应用时经 `/proposals/:id/apply → applyCommand → commit`，与编辑器里其他 AI 修改同一条路径：版本校验、操作日志、撤销/重做都生效，用户先看前后对比再应用。
- 2026-10-22：**处理决定存在账本里，不只是条目上的标记。** 每次发布都会重建 `modelIssues`，条目上的标记会丢。账本按提示 ID 记录：`dismissed` 跨报告保留（同一条发现原文再次出现仍视为已复核）；`applied` 只对产生它的那份报告有效（记录 `quality.checkedAt`），修改后重新审查若仍报同一条，说明没修好，重新打开。
- 2026-10-22：**忽略不推进 `revision`。** 与"接受本页"（`setPageAccepted`）同一先例：校验 `baseRevision`（不符返回 409），但不改版本号。提示不在 PPTX 里；推进版本号会让已发布的稿件显示"有未保存修改"，退出时要求重新发布并重新导出，只为一条复核记录不值得。应用建议是内容修改，照常推进版本号。
- 2026-10-22：**多页提示按当前页处理。** `repeated`/`conflicts` 常涉及两页，每页各自标记；在哪一页点"应用建议"，就只改那一页。
- 2026-10-22：**选中时理由显示在节点旁，整页列表放在画布下方。** 第一版把列表放在画布上方，选中节点时列表出现会把幻灯片往下推；改到画布下方后，在 1280×720 视口里列表在首屏之外，所以选中被标记节点时，理由和操作直接显示在已有的内联 AI 面板顶部（点击对象本来就会打开它）。

## 进展

### 2026-10-22

- 服务端：`lib/ppt/review-advisories.mjs`（新）；`command-service.mjs` `commit()` 调 `recordAdvisoryOperation`；`proposal-service.mjs` 提案记 `reviewAdvisoryId`、应用时传给 `applyCommand`；`api.mjs` 新路由与 `ai-edit` 的 `reviewAdvisoryId` 分支；`project-view.mjs` live 投影带上提示。
- 代理白名单 `src/lib/ppt-proxy-path.ts`；前端 `StructuredPptEditor.tsx`、`PptCanvas.tsx`、`SelectionAiComposer.tsx`、`PptWorkspace.tsx`、`types.ts`；i18n `ppt.advisory.*` 21 个键（en / zh / zh-HK）。
- 测试：`src/__tests__/unit/ppt-review-advisories.test.ts` 4 个用例（目标解析五种依据；账本规则；live 投影 + 提案 → 命令 → 撤销 → 重做 → 撤销；接口 409/404/400、幂等、不改版本号、已忽略不能再应用）；`ppt-proxy-path.test.ts` 新增 1 个；e2e `ppt-frontend-controls.spec.ts` 新增「review advisories are flagged…」（缩略图标记、节点虚线框与悬停理由、选中显示、从节点旁应用建议、忽略、恢复、导出计数、480 宽无横向溢出）。
- 验证：`next dev --webpack -p 3417`，单 worker 跑 `ppt-frontend-controls` **7/7 通过**（截图：标记、应用预览、已处理、窄屏）。本机负载约 73（其他会话的 Python 进程池和 selftest），冷启动后第一个用例的页面加载会超过默认 30 秒，用 `--timeout=120000` 跑整份 7/7；预热后默认超时也 7/7 通过过一次。
- `npm run test`（Node 22）：3083 个用例，3082 通过、1 跳过、0 失败。
- 相关 selftest：`proposal-targets`、`structured`、`mutation-runtime`、`edit-intent`、`live-page-edit`、`judged-advisory`、`native-duplicate` 通过；`judged-review-generation`、`summary-edit` 在 PATH 上没有 `soffice` 时通过。本机 10:24 新装了 LibreOffice（`/usr/local/bin/soffice`），有它时这两个测试走真实 PDF 转换并失败（"exported visibility conversion failed"），与本改动无关，记为后续（阶段 1.1 的延续）。
- 环境备注：worktree 共用的 `node_modules` 里 `better-sqlite3` 按 Node 22 编译；系统默认 Node 18 跑 `npm run test` 会有 28 组数据库相关失败（ABI 不符），用 `~/.nvm/versions/node/v22.22.0` 运行全部通过。
