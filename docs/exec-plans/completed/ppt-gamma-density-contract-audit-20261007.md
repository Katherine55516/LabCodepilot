# PPT Gamma 密度交接核对与修复

> 2026-10-07；依据 `docs/handover/ppt-gamma-density-packing.md`。保留上轮未提交改动，不重做已实现功能，不修改产品workflow或prototype。

## 梳理结果与执行项

| 部分 | 当前问题 | 本轮改动 | 状态 |
|---|---|---|---|
| 语义packing | 相同groupId优先于不同明确question；标题锁别名与requiredSupport未保全 | question冲突优先；两种标题锁；保全requiredSupport及范围并集；按输出页序测量 | 已实施 |
| 库存/表格分片 | 非表格也可传row ranges，重复/重叠范围及非数组类型未严格检查 | 集中校验真实ID、唯一ownership、表格类型、整数范围和重叠 | 已实施 |
| 预拟合 | SummaryBlock可实际绑定但未计入预拟合；最终模板调度后fit可能过期 | 统一允许结构判定；最终调度后重测并进入既有有界修订/门禁 | 已实施 |
| 原生写作prompt | slotTexts唯一正文命令与sourceArtifacts/sourceCommentary冲突 | 区分原生槽位写作与来源结构替换，不重复填将被省略的正文 | 已实施 |
| repair prompt | 未携带来源对象/分片/解释，修复易丢结构 | 从实际节点恢复sourceArtifacts和sourceCommentary；保留来源与保护要求 | 已实施 |
| 可读容量 | 原生x/width/height仍由通用比例代替；大字号可被18pt上限隐式降低 | 使用有效正文几何、标题/页脚保留区、保持既有可读字号；解析预测限制保留 | 已实施 |
| 可见QA | opacity=0计入正文；合并不看现有字号；低密度分母包含豁免页；证据/覆盖漏解释或计入隐藏结构 | visibleNodes统一密度/证据/库存/critic；实际解释进入证据；合并保持字号；角色统一统计；可见性使评审失效 | 已实施 |
| 结构重绑定 | 重复绑定来源节点可留下旧结构/解释 | 按source-owned身份替换，保持节点ID/顺序唯一 | 已实施 |

## 验收与范围

- 先新增能复现问题的测试，再落实代码；引用现有解析/字形估计器、模板调度和修订调用，不新增服务依赖。
- 兼容已确认/明确数量、旧模型大纲及保真导入；不得强制10页，不能以缩字或删来源换密度。
- 运行密度、prompt、模板/调度、覆盖/结构、版本/编辑专项及全仓typecheck/单测；后端返回若影响浏览器流程，再做PPT浏览器回归。
- 记录模拟模型与真实导出/渲染的验证界限；真实LLM、桌面PowerPoint和远端发布不在本轮验收声明内。
- 不提交、不推送、不发版。

## 已落实的文件

- `ppt-density-capacity.mjs`：有效正文几何/页脚/标题、原生字体下限、空拟合、SummaryBlock与分片校验共用入口。
- `ppt-density-packing.mjs`：问题优先、标题锁别名、职责保全、完整表/分片并集、输出页序、最终fit重测。
- `ppt-api.mjs`：隔离候选assessment，最终模板调度→fit→既有一次修订→保存相同映射。
- `ppt-template-fidelity.mjs` / `ppt-prompt-contracts.mjs`：slot与source两种实际正文；repair保留来源、范围和解释；critic仅取可见结构。
- `ppt-source-artifacts.mjs`：共享校验；再次绑定替换旧source-owned节点。
- `ppt-visible-content.mjs` / `ppt-evidence.mjs` / `ppt-content-inventory.mjs` / `ppt-density-qa.mjs`：共享可见性；实际解释/表格/原生文本共同验证；hidden、透明和omission不得证明保留。
- `ppt-generation-policy.mjs` / `ppt-planning.mjs` / `ppt/versioning.mjs`：prompt4、planning8、rubric4；当前契约与可见性进入缓存键，保留历史版本来源。
- `selftest-ppt-density-audit.mjs` / `package.json`：27项专项与npm复跑命令；`selftest-ppt-semantic.mjs`同步规划版本断言。

## 验证记录

- 新audit：27/27。新增断言先复现20个失败条件；修复后全通过，另7项验证关联保护/最终调度/有界修订。
- 原density：21场景组通过，实际Python PowerPoint导出和原生保真导出核验，模型响应模拟。
- PPT专项覆盖：prompt-contracts、semantic、template-fidelity、template-scheduler、structured、real-fixture、prototype-parity、report-qa、visible-depth、mutation-runtime、edit-intent、requirements-parity、evidence-quality、m2/m3/m4/m5、long-limits、long-storage、recovery-sync、template-registry、template-security、content-depth、content-inventory；受最终可见性/缓存改动影响的专项再次通过。
- `npm run test`：typecheck + 2809测试（2808通过、1跳过、0失败）。
- Playwright既有PPT19项通过：独立开发端口3017、Chromium CDP、页面/交互/移动端滚动、相关console/pageerror检查；业务API为fixture，不作为真实LLM验收。
- `git diff --check`通过。
- M2的默认本地Python无matplotlib导致其PDF检查跳过；真实LLM、远端、安装包、桌面PowerPoint和Gamma长稿对比不纳入通过声明。上轮产物、UI改动及其他未提交文件保留。

复跑：

```bash
npm run test
npm run selftest:ppt-density-audit --prefix apps/cowork-server
PPT_TEST_PYTHON=/path/to/python-with-python-pptx npm run selftest:ppt-density --prefix apps/cowork-server
PORT=3017 npx playwright test src/__tests__/e2e/ppt-prototype-parity.spec.ts src/__tests__/e2e/ppt-workspace.spec.ts src/__tests__/e2e/ppt-template-reuse.spec.ts --workers=2 --reporter=list
```

本轮不改变workflow、prototype、UI或模型选择；不新增依赖、迁移数据库、commit/push或发版。当前阶段为本地代码与模拟链路验收完成。
