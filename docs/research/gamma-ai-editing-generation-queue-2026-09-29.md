# Gamma 生成中改动与成稿后 AI 局部优化：实机拆解

调研日期：2026-09-29（America/New_York）。本次在已登录的 Gamma 工作区中分别观察了 **Gamma Classic 的旧稿编辑器**与 **Gamma 5 Beta 的新建、生成和编辑流程**。Gamma 5 的实验稿为私人文档：[What Is a Cohort?](https://gamma.app/docs/yfg53w0a4owuwt6)；Classic 对照稿为此前生成的私人文档：[Tutorial 12](https://gamma.app/docs/Tutorial-12-hxzavwevd291vtr?mode=doc)。

## 1. 取证范围与结论等级

| 标记 | 含义 | 本文例子 |
| --- | --- | --- |
| **实测** | 在当前账号的 Gamma 页面亲自操作并看到结果 | 生成中消息进入 `Queued`，成稿后第 2 页自动补上“示例数据”说明；单段落 AI 改写只改变该段 |
| **官方说明** | Gamma 帮助中心写明，本文未逐一复现 | 默认流式页面高度、固定比例选项、Original/Modified 的恢复语义 |
| **推断/建议** | 根据界面行为提出的产品或工程解释 | 将生成中输入实现为任务队列，比直接热改正在执行的页面更容易保证一致性 |

本次只用了我编写的低敏感度示例提示词，没有上传本地文件或修改账号中原有的量化研究稿。没有检查 Gamma 的内部 API、网络请求、导出 PPTX，也没有独立操作 Kimi；“参考 Kimi”在本文仅作为**生成中可继续提出修改**这一体验目标，不能据此声称两者的执行机制相同。

## 2. Gamma 5 的实际生成链路

实验提示词要求 **4 页**：解释 cohort、给出 Month 0–3 留存表、判断留存问题、提出 3 个 PM 决策，并要求事实性说法有引用。创建页支持选择 `Presentation`、输入提示词、添加文件/连接来源、设置 effort、浏览或上传模板。账号显示免费套餐与“积分即将用完”提示，本次仍可生成。

| 阶段 | 实测界面与动作 | 可观察到的系统行为 |
| --- | --- | --- |
| 创建 | 从 Gamma 5 首页进入 `Presentation`，提交提示词 | 进入 Agent 会话，先显示 `Setting up`，再写出简短任务理解 |
| 规划 | Agent 创建 `Plan`，提供 `Show Plan` | Plan 直接展示可编辑大纲、模板预览、图片来源、逐页 `Add slide` 与 `Merge`，生成前需要点击 `Generate` |
| 大纲稳定 | 早期加载时曾短暂出现 5 项，其中留存表的两条阅读方法成为独立第 3 项；页面完成加载后归并为预期的 4 页 | Plan 会渐进更新；不可把过渡状态当作最终页数。最终大纲确为 4 页 |
| 执行 | 点击 `Generate` 后跳到文档编辑画布 | Agent 显示 `Creating “What Is a Cohort?”…` 等进度；画布逐页出现内容，随后显示 `Polishing presentation… 3/4`，最终停在可编辑成稿 |
| 成稿 | Agent 回报四页摘要并附文档卡片 | 同一会话继续接受修订，成稿也可手动编辑；没有强制重新生成整稿 |

Gamma 的[官方 Agent 创建说明](https://help.gamma.app/en/articles/15002203-how-do-i-create-with-agent-in-gamma)也把流程分为提问、审阅计划、生成、对话式修订。但本次提示词足够具体，未出现额外澄清问题；因此“每次都会提问”不能作为实现假设。

### 2.1 生成期间追加指令：排队，之后执行

当 Agent 正在创建第 1 页时，我在聊天输入框提交：`On slide 2, label the retention-table numbers as illustrative examples.`。界面立即将其显示为 **`Queued`**，并提供 `Edit queued message`、`Remove queued message`。生成阶段输入框的右下角是 `Stop` 控件；页面继续显示逐页生成与 polishing。四页成稿出现后，Agent 才开始执行队列消息，画布第 2 页先显示 `Editing…`、`Checking…`，最后在留存表介绍后加上 `The figures below are illustrative examples.`。

随后 Agent 给出修改回执，附第 2 页的 **Original / Modified** 两张缩略图。点击 `Compare before & after` 打开左右对比：Before 和 After 分栏，底部有 `Restore all edits` 与 `Continue with selection`。本轮后者选中的修改保留在稿件中。Gamma 的[AI 编辑帮助](https://help.gamma.app/en/articles/8033284-how-do-i-edit-my-content-with-ai)说明一次请求涉及的更改会作为一组接受或恢复，不能逐条挑选；聊天记录会保留。

**结论边界：**这次实测证明生成期间可以**提交并管理排队修订**，且队列会在当前生成任务后自动处理；并未证明 Agent 能中断正在写的卡片、实时修改尚未完成的大纲或并行合并冲突指令。官方帮助也明确写明，AI 在内容生成期间不会立即响应，应等当前生成完成。若要对标 Kimi 式“生成时改动”，产品规格须明确区分“修改当前生成任务”与“排队执行下一次编辑”。

## 3. 成稿后的 AI 局部优化

### 3.1 Gamma Classic：单页快捷指令与整稿 Agent

在旧版 `Tutorial 12` 的任一页左上角点击 `Edit with Agent`，弹层标题是 `Edit this slide`，上方有自定义指令输入和文件附件；下方快捷操作按目的分组：

| 组 | 实测出现的入口 |
| --- | --- |
| 版式 | `Try new layout` |
| 文字 | `Improve writing`、`Fix spelling & grammar`、`Translate`、`Make longer`、`Make shorter`、`Simplify language`、`Be more specific` |
| 可视化 | `Make this more visual`、`Add an image`、`Add a chart` |

右上角的 `Edit all slides with AI` 打开整稿聊天面板，其 `Quick edits` 分为 Research、Refine、Restyle：包括联网补证据、找反面数据和案例、检查薄弱论证、加执行摘要、加两页、全局排版和主题建议。这是**界面入口观察**，本次没有逐个运行快捷指令。旧版与 Gamma 5 的入口和权限可能不同，不能把 Classic 的按钮清单直接视为 Gamma 5 的稳定 API。

### 3.2 Gamma 5：范围先行的 AI 编辑

Gamma 5 桌面尺寸下，左侧为 Agent 对话，右侧为卡片画布。工具栏提供**手动编辑 / AI 编辑**切换；聊天底部也有 `Select area`。启用 AI 编辑后，画布提示 `Choose a card or element to edit · Esc to cancel`。我点选了第 4 页 `Prune ineffective acquisition channels` 下的**一个正文段落**，选中的段落显示蓝色边框；段落旁出现 `Paragraph · “Reallocate spend and growth…”` 标签和 `What should change?` 小输入框，聊天输入区同步显示相同的选择范围。用户在发出指令前能看清 AI 将处理的是哪一个对象。

实测指令：`Make this one concise action sentence. Keep the meaning and do not add new facts.`。原段落从较长的预算重分配描述缩为 `Shift spend and growth efforts from high-volume, low-retention traffic sources to resilient segments.`。页面其它两项决策、第 1–3 页文字保持原样。编辑后聊天再次给出该页 Original / Modified 和对比入口。**注意：聊天回执所引用的改写句子与画布中的实际句子措辞并非完全一致；审稿应以最终渲染对象为准。**

Gamma [官方文档](https://help.gamma.app/en/articles/8033284-how-do-i-edit-my-content-with-ai)列出的选择层级是整稿、单页、单个元素，也支持选择文字后用格式工具栏的 AI 入口、`Cmd/Ctrl+E`、编辑后对比和恢复。本次只实际执行了**单段落**选择；整稿多页修订只观察入口，没有执行。

## 4. 可视化编辑器：内容对象与设计对象如何交互

| 控件/行为 | 实测观察 | 设计含义与边界 |
| --- | --- | --- |
| 文档式画布与 filmstrip | 四张卡片纵向排列，可展开左侧页缩略图；页与页之间有 `Insert slide` | 内容编辑以卡片/块为中心，filmstrip 用于定位和页级操作 |
| 直接手动编辑 | 页面在 `Manual editing` 模式下为可编辑文本对象；点选后工具栏出现字体、字号、列表等格式控件 | 细小改动无需调用 AI。当前实验没有验证手动插入后的多点重排算法 |
| `Add block` | 分类有 Blocks、Images、Shapes、Layouts、Diagrams、Charts、Videos、Embeds、Forms；可插标题、正文、表格、提示框、列、时间线、漏斗、图表和外部嵌入 | 块库先给语义组件，用户再填内容；适合构建可编辑图表而非把所有东西铺成一张图 |
| `Layouts` | 标准版式有 No/Top/Left/Right/Background；随后出现 `Suggested layouts`，用当前内容的缩略预览呈现多个命名方案 | 建议版式是**保留内容、尝试重新布置**的交互；本次只看预览，没有提交某个候选 |
| `Freeform` | 菜单提供 `Convert Heading to freeform`、`Convert slide to freeform`、`Convert all slides to freeform…` | Gamma 区分结构化块排版与更自由的对象布局；本次没有实际转换或测试往返损失 |
| `Styles` | 整稿面板可设置 Themes、Fonts、Colors、Logo、Button Design、Charts、Images、Custom styling | 风格层与内容层分离；单页版式和整稿主题有不同入口 |
| 页级入口 | 当前卡片有 `Edit with Agent`、`View speaker notes`；Classic 有页左上角单页快捷 AI | 页是默认的设计/修订单位，元素选择提供更细粒度 |
| 版本回看 | Agent 会话卡片附 Original/Modified，点开是可视对比，能恢复本次编辑 | 应展示实际改动范围，而不只给自然语言“已完成”回执 |

Gamma [帮助中心](https://help.gamma.app/en/articles/11016396-what-are-slides-in-gamma-and-how-do-they-work)称卡片默认可随内容调整高度，可在 Page Setup 选固定比例；[页面设置说明](https://help.gamma.app/en/articles/11029115-how-do-i-control-slide-sizes-and-adjust-page-setups)解释固定比例及导出相关设置。本实验没有实际增加一个 point 来量化字号、卡高或栏宽的变化，所以**不能**由这个样本推导“每多一点必然等比例缩小”。当采用固定比例导出时，仍须额外检查可读性和溢出；[Gamma 导出说明](https://help.gamma.app/en/articles/15939201-why-doesn-t-my-exported-pdf-or-powerpoint-match-what-i-see-in-gamma)也提醒编辑视图与导出/演示视图可能不同。

## 5. 本次四页成稿的内容、分布与缺陷

| 页 | 最终呈现 | 可视结构 | 审稿意见 |
| --- | --- | --- | --- |
| 1. What Is a Cohort? | 一句 cohort 定义，另有一句说明它帮助分离产品/营销效果与用户规模增长 | 蓝底封面、大标题、人物与日历插画、底部强调线 | Plan 含 acquisition/behavioral 两类及例子，Agent 的成稿回执也声称对比两类；实际卡片没有呈现这些区别，存在**计划、回执、画布不一致** |
| 2. Reading the Retention Table | 三个 2026 月份 cohort，Month 0–3 留存表；另有横向读同 cohort、纵向比同生命周期两个方法；排队修订后补上“数字为示例” | 原生表格 + 双块阅读说明 | 数值在生成时被编造；初稿未标明模拟，直到人工追加才补。表格没有来源 |
| 3. Spotting a Retention Problem | 早期陡降、持续下滑、新 cohort 变差三种信号，各一段解释 | 三个并列警示模块与颜色标签 | “Month 0→1 流失 >60–70%”被写成一般阈值，缺行业/产品口径，也无引用；应视为示意而非通用诊断标准 |
| 4. Three High-Impact PM Decisions | 优化激活、淘汰低留存获客渠道、调查流失拐点；局部 AI 缩短了第二项 | 三段编号/彩色纵向流程 | 方向可读，但未把第 2 页具体差异映射成行动优先级或量化决策规则 |

第 2 页表格的实际样例值如下；**这些是 Gamma 生成的演示数据，不是真实产品数据**：

| Cohort | Users | M0 | M1 | M2 | M3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jan 2026 | 10,000 | 100% | 42% | 34% | 31% |
| Feb 2026 | 12,500 | 100% | 38% | 29% | 25% |
| Mar 2026 | 14,000 | 100% | 45% | 38% | 35% |

总体内容组织遵循“定义 → 可操作的表格 → 问题信号 → 决策”，每页核心对象不同，较容易讲述。四页都可在画布中编辑；表格和第 4 页流程不是纯截图。第 1 页有插画，第 2–4 页主要用表格、三栏警示和纵向流程组织信息；仅凭画布无法判断第 1 页插画是模板素材还是本次新生成图像。**本次生成没有满足提示词中的“事实性主张附引用”要求**：成稿可见文本未出现资料来源或脚注，特别是第 3 页的阈值与因果解释。

## 6. 对本项目 PPT 模块的可迁移设计

1. **明确生成阶段的两种改动语义。**计划审阅期允许改大纲、增减页、换模板；点击 Generate 后，后续指令应显示 `Queued`、目标范围、可编辑/可移除状态。若支持真正中断和重规划，须另设显式动作，不能混称“实时修改”。
2. **AI 编辑先选范围再写要求。**整稿、页、块、文本选区需要统一的选择模型与可见 chip。对话回执要附结构化 diff，指出实际改了哪些对象；仅靠语言回执会遗漏本次观察到的措辞偏差。
3. **编辑结果保留版本。**每次 Agent 修改形成原稿/修改稿快照，可对比与整组恢复；用户手动编辑与 AI 修订都不应无声覆盖此前状态。
4. **内容计划与成稿做一致性校验。**本次第 1 页丢掉了 Plan 中的两类 cohort 例子；发布前应核查每页计划中的必保留事实/对象是否真的出现在渲染稿，而不是信任 Agent 自述。
5. **示例数据与外部事实分开标记。**模型编造的表格必须在首稿自动标为示例；来源请求若未满足，应在质量门禁中显式报告。通用阈值须有口径和出处，否则改写为条件性提示。
6. **编辑器以语义块优先、自由对象为补充。**块库、上下文建议版式、主题面板、单页样式、filmstrip、页面插入和备注可以并存；对固定比例 PPTX 导出另设可读性、溢出与实际渲染检查。

以上是产品交互与质量控制建议，并非对 Gamma 内部实现的逆向结论。本次没有更改本项目 PPT 代码。

## 7. 参考来源

- 实测 Gamma 5 实验稿：[What Is a Cohort?](https://gamma.app/docs/yfg53w0a4owuwt6)（私人文档，需当前工作区权限）。
- 实测 Gamma Classic 对照稿：[Tutorial 12](https://gamma.app/docs/Tutorial-12-hxzavwevd291vtr?mode=doc)（私人文档，需当前工作区权限）。
- Gamma Help：[Create with Agent](https://help.gamma.app/en/articles/15002203-how-do-i-create-with-agent-in-gamma)；[Edit content with AI](https://help.gamma.app/en/articles/8033284-how-do-i-edit-my-content-with-ai)；[Slides and dynamic sizing](https://help.gamma.app/en/articles/11016396-what-are-slides-in-gamma-and-how-do-they-work)。
- Gamma Help：[Text editing](https://help.gamma.app/en/articles/11028318-how-do-i-add-edit-and-style-text-in-gamma)；[Smart layouts](https://help.gamma.app/en/articles/11029130-what-s-the-fastest-way-to-transform-content-and-layouts)；[Slide styling](https://help.gamma.app/en/articles/11969695-how-do-i-style-slides-and-adjust-layout-settings-in-my-gamma)；[Page setup](https://help.gamma.app/en/articles/11029115-how-do-i-control-slide-sizes-and-adjust-page-setups)；[Export differences](https://help.gamma.app/en/articles/15939201-why-doesn-t-my-exported-pdf-or-powerpoint-match-what-i-see-in-gamma)。
