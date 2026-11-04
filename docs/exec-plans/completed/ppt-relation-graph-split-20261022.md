# PPT 超大关系图跨页拆分

> 创建时间：2026-10-22
> 最后更新：2026-10-22
> 来源：[ppt-pipeline-unblocked-20261022.md](ppt-pipeline-unblocked-20261022.md) 第 1.6 项。分支 `claude/ppt-gamma-http-fixture-20261022`。用户已批准这项产品改动。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| 1 | 关系图按行范围生成"部分图"（含跨页延续卡片） | ✅ 已完成 | `ppt-relational-diagram.mjs`；整图输出与改动前逐字节相同 |
| 2 | 覆盖校验接受部分图；大纲门禁：只有整图放不下才允许拆，且各部分在相邻页按行序排列 | ✅ 已完成 | `ppt-relational-diagram.mjs`、`ppt-outline-source-fit.mjs`，容量窗口提示词 |
| 3 | gamma 夹具按行拆分 b_0017、b_0061；单元/selftest 覆盖 | ✅ 已完成 | `test/ppt-gamma-model-fixture.mjs`、`selftest-ppt-editorial-relational.mjs`、新 selftest |
| 4 | 全量 selftest、`npm run test`、文档 | ✅ 已完成 | selftest 169 通过、8 跳过、0 失败；`npm run test` 3077 通过、1 跳过 |

## 问题

通过图审计的来源关系图会生成必选的 `source-relations` 媒体任务。`relationalComponent` 只在一页拥有整张表时才画图，be5cd92e 起表格退回会被大纲门禁拦下。gamma.md + light 模板里 b_0017（14pt 仍需 8.43 英寸）和 b_0061（16.2pt 下限需 5.11 英寸）超过 5.075 英寸正文区；两者不可省略，按行拆分又过不了门禁，大纲停在 `capacity_blocked`。

## 详细设计

**部分图。** 关系图表格的一个行范围 `[rowStart,rowEnd)` 画成一张关系图：

- 本部分拥有的节点：每个数据行对应一个节点（`semantic_graph_rows` 的投影顺序）。紧凑投影（表头只有 `Component / Next component`）不给叶子节点单独一行，叶子跟随它行号最小的父节点所在部分；没有父节点也没有行的节点归第一部分。
- 本部分拥有的节点之间的边照常画。
- 跨部分的边：另一端节点以一张"延续卡片"出现在本部分，边连到它。卡片标题就是那个节点的原文标签，在后面部分的写成 `→ 标签`，来自前面部分的写成 `标签 →`；条目带 `continuation:{direction:'next'|'previous'}`。同一个外部节点只出现一张卡片。
- 所以每条边在它端点所在的部分都可见：部分内的边出现一次，跨部分的边在两边各出现一次。每个节点只在自己的部分作为正式节点出现一次。
- 部分图本身仍是 `diagram.relational`，带 `relational.part = {version, rowStart, rowEnd, nodeIds, continuationNodeIds}`。渲染器、PPTX 导出和导出校验只看 `items` 与 `edges`，不需要改。
- 环形图和重叠窗口依赖完整节点集的布局，不拆（部分范围仍返回 null，退回表格并被门禁拦下）。

**门禁不放松。** `inspectFrozenOutlineSources` 对表格退回的拦截保持不变。部分图通过的前提是它本身就是关系图，且覆盖校验通过。

**覆盖校验。** `relationalCoverage` 对部分图按同一规则重建期望的部分图，逐项比对：节点与延续卡片的标签/正文、边（含原图边号）、节点顺序、行范围与 `sourceRows`。整图的校验不变。

**新增大纲门禁**（`inspectFrozenOutlineSources`，阻断，可修复）：

- `planned_source_graph_split_unneeded`：页面带有关系图的部分范围，但整图单独放在这一页、按实际绑定路径（含 bounded 字号）就能画成关系图。只有放不下才允许拆。
- `planned_source_graph_split_order`：同一张图的各部分必须按行序排在相邻页上。

**提示词。** 容量窗口提示词说明：放不下一页的关系图可以按相邻行范围拆到相邻页，每部分画成带延续连线的关系图；放得下的保持完整。

## 验收

- 以 b_0017、b_0061 形状的图做单元/selftest：所有节点、所有边可见；表格退回仍被拦；篡改部分图的覆盖校验失败；不必要的拆分和非相邻拆分被拦。
- `selftest-ppt-gamma-http` 通过；`npm run test` 通过；其余 selftest 结果不变（本机 167 通过、8 跳过的基线，另加新 selftest）。

## 决策日志

- 2026-10-22：延续卡片用原文标签加 `→`，不另写"见下一页"之类的说明文字。正文语言、来源事实检查都只认原文，新造的文字会引出更多检查问题；`→` 已在原文里出现，字体覆盖没有风险。
- 2026-10-22：测试 HTTP 夹具（`test/ppt-http-harness.mjs`）关闭服务端空闲超时（`keepAliveTimeout = 0`）。客户端和服务端在同一个事件循环里，大纲最后一段同步计算之后，服务端的 5 秒空闲超时和下一次请求会在同一轮触发，fetch 复用了刚被关闭的连接（`ECONNRESET`，请求根本没到服务端）。夹具结束时本来就关闭所有连接。
- 2026-10-22：拆分是否必要先用整张画布、最小允许字号做一次 `relationalPlan` 估算，溢出就直接判定放不下，不再走完整绑定；gamma 43 页的冻结来源检查从约 2 秒降到约 1 秒。
- 2026-10-22：拆分是否必要按"整图单独放这一页能否画成关系图"测量，走与真实绑定相同的 `fitSourceLayout`，避免两个门禁互相矛盾（一个说放得下、一个说放不下）。
