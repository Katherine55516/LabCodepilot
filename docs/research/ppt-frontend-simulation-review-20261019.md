# PPT 前端按钮与工作流评审（模拟 LLM）

> 2026-10-19。前端模拟验收通过：全量71/71、另补充2/2，0失败、0跳过；类型检查及完整单测3005通过、0失败、1既有skip。生产v27构建、自身standalone启动及3143关键7/7冒烟均通过。计划见[前端模拟验收](../exec-plans/completed/ppt-frontend-simulation-acceptance-20261019.md)。

## 测试边界

实际工作树的React组件、实际Chrome/CDP、独立3147/3148认证环境。浏览器用例中API和模型结果采用显式fixture；版本更新读取边界另通过生产handlePpt和模拟modelCall验证。字体、画布、表格、公式、布局命令、按钮事件及请求参数均使用产品实现。没有真实模型请求，不更改3143真实项目，不使用3141。

本轮接口排查结论已纠正：现有接口和密钥有效，模型列表HTTP200，实际生成返回HTTP403及结构化码`insufficient_user_quota`。旧“授权失败”是泛化403造成的错误归因；不能继续以它要求更换密钥。暂不以额度不足阻断前端模拟测试。

## 发现与处理

| 编号 | 性质 | 问题与影响 | 处理与证据 |
|---|---|---|---|
| F01 | 产品缺陷 | 未验收稿导出只通过pointer-events禁鼠标，仍存在可键盘触发的下载href | StructuredPptEditor在未发布/质量阻塞/未保存时渲染原生disabled按钮；已发布版本保留真实链接。新浏览器反例先复现2个href，修复后正反例通过 |
| F02 | 工作流遗漏 | 版本更新在用户调整页数之前已生成整份大纲；更新API忽略readOnlyInput | API保存读取意图；PptM3先停input_ready，再在同ID确认页数/模板后生成大纲。生产API的Prompt/paste/file三种更新全部验证无提前planner调用 |
| F03 | 产品一致性 | 版本更新无三档详细度，保留前台“质量等级”，模板预览按钮仍叫选择质量等级 | 增加简洁/标准/详细；改变深度先重读；执行策略放折叠高级摘要；模板预览入口改为选择模型。更新页数下限统一3；标题元数据修改复用项目 |
| T01 | 测试维护 | 旧库用例按可见文字找卡片；真实封面和卡片标题同名，导致strict locator失败 | 按heading定位；收藏/搜索/移动/回收站原断言保留 |
| T02 | 测试维护 | 旧导航用例依赖装饰图标和计数拼接 | 使用实际aria-label的导航按钮；原拖动请求数和置顶分组保护断言保留 |
| T03 | 测试维护 | 新控件fixture使用派生元素ID，触发不可编辑保护；草稿本来不属于成品列表 | fixture改成真实原生对象id=nodeId，未验收稿从任务中心进入。未移除产品保护规则 |
| H01 | 测试配置 | 首个testMatch误匹配工作树路径中的ppt-build，包含非PPT用例 | 中止自有runner并保留exit130日志，改为文件名锚定；这一轮不计入PPT验收 |

## 已执行的覆盖

首轮已有PPT用例68项：65通过、3项旧定位器失败。覆盖新建三入口、API设置/模型列表、高级执行策略、读取/估算/页数、容量错误、三档深度、局部重组、模板固定对象、流式文字、重复快照、2/5/10次断流、同ID恢复、生成中AI范围、数学/表格/图表/代码、原生4:3、任务/成品分离、多选移动删除、版本记录、发布和退出。

新增控件三项在有效fixture及F01修复后通过：选标题/正文独立格式、字体字号与可读输入范围、已发布/未验收导出、演示前后翻页。实际桌面/窄屏截图保存在本工作树忽略目录`outputs/ppt-engine-integration-20261016/`。

## 完整复验与交付边界

- 版本更新：先读取、同ID改模板/页数/标题、深度重读、三档、480×800、确认大纲后生成，已全部通过。旧显式v1更新合同仍保留原下限，新v2更新与普通创建的3页下限一致。
- 浏览器全量71项与2项来源警告补充均通过；源码首尾指纹一致。完整npm包含类型检查与单测，3005pass/0fail/1既有skip；无测试断言放宽。
- 已实际查看批量选择操作条、普通创建短屏、大纲编辑短屏、更新页移动端、选中文字格式和草稿导出对话框截图。更新页窄屏移除冗余版本徽标，操作按钮未遮挡；确认/返回可达，未发现横向溢出。
- 生产构建与3143加载结果在末尾追加。本轮没有验证LLM提取/语义/媒体质量；历史失败记录仍可能显示旧的通用授权文案，`insufficient_user_quota`错误分类与旧记录处理放到模型链路下一阶段，不擅自改写旧任务原因或状态。

模拟结果只支持前端交互和确定性接口合同结论，不证明模型提取质量、大纲精炼、语义切割或Gamma同源成品质量。当前真实23页稿仍未验收，无本轮正式PPTX/PDF；尚未提交。


## 最终浏览器结果（2026-10-19）

本轮全量：71/71通过、0失败、0跳过；另补充来源警告正反例2/2。全量报告源码指纹检查一致，无测试期间产品源码变化。实际Chrome/CDP；模型响应为模拟。以下为本次全量用例，逐项结果来自Playwright报告：

- 通过：API setup saves explicit protocol, synchronizes models and exposes them in PPT
- 通过：editing input after a blocked wizard outline permits a fresh analysis
- 通过：blocking source capacity is translated and cannot be confirmed unchanged
- 通过：local capacity diagnostics separate successful call telemetry and explain the actual template constraint
- 通过：streaming native draft grows, queued templates stay hidden, and other-page revisions preserve the completed canvas
- 通过：first writer displays growing text before a render tree is available, even with a pre-bound native preview
- 通过：quality changes retain parsed input and confirmed outline while updating future policy
- 通过：fifty streaming topics keep wizard actions reachable at short and zoom-equivalent viewports
- 通过：a failed project list does not block creation and its retry recovers independently
- 通过：standalone PPT uses one navigation and search shortcut keeps the creation draft
- 通过：a single project keeps a readable card width at desktop sizes
- 通过：an old template retry cannot restore the previous account after an account change
- 通过：desktop PPT retains the host navigation
- 通过：unavailable role models block creation and recover after the model catalog refresh
- 通过：folder retry cannot invalidate an in-flight project response and optional defaults do not block models
- 通过：fixed template objects can be selected visually across pages and only chosen IDs enter creation
- 通过：model catalog loading is visible inside the quality gate without claiming models are unconfigured
- 通过：failed model catalog reload inside the quality gate preserves input and quality
- 通过：text toolbar edits template fonts, size and emphasis only on the selected text
- 通过：unaccepted draft export has no keyboard-activatable download target
- 通过：published export and presentation navigation keep the object commands untouched
- 通过：PPT live follow moves the canvas to the earliest unfinished page in page order and repeated snapshots preserve scroll
- 通过：PPT render snapshot restores live canvas while remembered manual browsing stays selected
- 通过：Home can start a fresh quality retry without removing the retained PPT checkpoint
- 通过：PPT canvas shows completed pages and the current real draft; future titles stay in the plan
- 通过：Home task strip shows the user-facing deck stage and current page, never internal node IDs
- 通过：Retired template images are listed with page and reason and need an explicit user confirmation
- 通过：A retry started from another tab reconnects a retained failed detail to the live editor
- 通过：A failed later stage retains the verified editor and disables AI only on pending pages
- 通过：An automatic outline that outgrew its page budget waits for confirmation and shows the concision metrics
- 通过：PPT pre-bound native objects do not hide the current text stream
- 通过：PPT failure details show the actual model step and bounded transport diagnostics
- 通过：PPT editor renders semantic math and strips active content
- 通过：click and double click select/edit without submitting a geometry mutation
- 通过：advanced execution is collapsed and Home preserves input until explicit leave
- 通过：task center retains successful tasks and deleting the task keeps its file
- 通过：depth changes retain edits and scoped reorganization requires applying a preview
- 通过：manual reading pauses before outline and depth review reuses the same task
- 通过：a saved reading checkpoint resumes from the task center
- 通过：PPT offline components share canvas geometry and preserve navigation
- 通过：PPT planning assumptions are disclosed and the code choice re-estimates
- 通过：Prompt carries pasted/selected images through analyze and generation
- 通过：Progressive canvas hides future templates and keeps chat actions in short windows
- 通过：PPT template-first creation keeps manual pages, handles estimate races and sends policy
- 通过：PPT paste syllabus and composer remain reachable at 390 by 500
- 通过：PPT generation dock preserves draft through close and supports two fixed-scope turns
- 通过：PPT local translate and expand send parameters and review real proposal metrics
- 通过：PPT source table editor uses measured column/row weights and readable header
- 通过：PPT editable import keeps native page count independent of a small selected template
- 通过：PPT auto estimate remains provisional until syllabus confirmation
- 通过：PPT template capacity changes invalidate provisional syllabus and estimate
- 通过：Switching a failed fixed-page outline back to module estimation starts the matching contract
- 通过：PPT default uses primary-language topics and body; keeping both body languages is explicit
- 通过：PPT shared contracts render signed charts, crops, code and tables
- 通过：Round 7 selection hit targets, Shift range, sticky inline actions, move/delete and Esc
- 通过：Chat Ctrl+Enter sends, Enter adds a line and history scrolls to its new status
- 通过：Round 7 native-template draft grows as one page without clipping, and manual scroll pauses follow
- 通过：Round 7 2 temporary outline read failures keep the same project and reach explicit confirmation
- 通过：Round 7 5 temporary outline read failures keep the same project and reach explicit confirmation
- 通过：Round 7 10 temporary outline read failures keep the same project and reach explicit confirmation
- 通过：user page selection and module estimate take priority over template length
- 通过：ten-page uploaded template accepts an explicit 100-page target
- 通过：PPT M5 blocked quality gate stays editable and publishes only after repair
- 通过：PPT M4 visual blocks, undo, template switch and one-slide AI
- 通过：PPT M1 creation, outline approval, editing and export entry
- 通过：PPT structured editor persists object commands, history, AI edits and publish
- 通过：PPT M2 library folders, favorites, search and trash
- 通过：PPT M2 paste and file inputs reach source aware outlines
- 通过：PPTX fidelity import selects a model before opening the file
- 通过：PPT manual ordering persists and keeps pin groups separate
- 通过：PPT M3 template compatibility and version update workflow


## 生产页面验证与最终状态

v27构建exit0/sourceUnchanged=true，实际完整编译、TypeScript、164页静态生成、trace与standalone完成；自身依赖及3157 HTTP探测通过。3143已更新，随后实际npm run test:smoke对新构建进行7项关键流程复验，7/7通过（50.4秒），包含手动读取/同ID深度复核、普通新建/确认、版本更新、选区字体/字号/格式、未验收导出禁用、已发布入口与演示。模型/API响应仍为显式模拟；没有真实LLM质量验收或正式PPTX/PDF成品。

3141与原23页项目保留，既有DeepSeek接口配置保留。未commit/push，继续遵守原“真实整稿通过后提交”的条件。完整证据索引：本工作树outputs/ppt-engine-integration-20261016/frontend-acceptance-oct19.json；浏览器总报告frontend-sim-oct19-final.json；生产回归frontend-production-oct19-v27.log；类型/单测npm-oct19-frontend-result.json；构建build-v27-frontend-simulation-webpack-result.json；standalone-v27-verification.json。旧失败/中止记录保留，不计入最终通过统计。
