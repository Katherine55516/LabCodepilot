# 本机 PPT 手动测试启动器

当前用户已授权的隔离入口为 http://127.0.0.1:3143/ppt（后端3142），保留另一工作目录的3141服务。双击 `/Users/dongli/Documents/ChatGPT/CodePilot/ppt-gamma-results-20261013/Start_PPT_Test_Isolated_3143.command` 可启动并打开本轮页面。此启动器用于当前Mac和现有隔离工作目录。

## 使用

在 Finder 中双击 `scripts/ppt/start-manual-test.command`，或在本工作目录运行：

```sh
./scripts/ppt/start-manual-test.command
```

仓库脚本不指定环境时沿用旧3140/3141配置。本轮应使用上述3143包装脚本，或设置`PPT_MANUAL_STATE_DIR=outputs/ppt-gamma-semantic-improvements-20261013/isolated-manual`再运行仓库脚本。它优先复用对应端口的健康服务；未运行时后台启动生产PPT API和已构建前端，并打开Google Chrome。终端退出不会停止后台服务。页面上的新建、输入/上传、模型选择、大纲确认、生成、编辑和导出均使用产品原有接口。

```sh
/Users/dongli/Documents/ChatGPT/CodePilot/ppt-gamma-results-20261013/Start_PPT_Test_Isolated_3143.command status
/Users/dongli/Documents/ChatGPT/CodePilot/ppt-gamma-results-20261013/Start_PPT_Test_Isolated_3143.command check-llm --no-open
/Users/dongli/Documents/ChatGPT/CodePilot/ppt-gamma-results-20261013/Start_PPT_Test_Isolated_3143.command stop
```

`check-llm` 发送一个最小真实模型请求，会使用已配置 API 的额度。`stop` 只停止此脚本启动的服务，不接管或停止其他已经运行的测试服务。生成时请保持网页打开，以便浏览器中的生产 BYOK worker 持续领取任务；可以返回本应用 Home 查看进度。

## 真实配置与持久化

- 本机非密启动配置：`outputs/ppt-manual-testing/launch-config.json`，文件权限 600，记录端口、运行目录与已构建前端位置。
- 现有凭据源：`~/.aimate-api-development`；主密钥读取已有 macOS 钥匙串项目 `AIMate API Development Master Key`。脚本不要求粘贴 API Key，也不把主密钥写入脚本或配置文件。
- 手动测试 profile/项目/文件继续使用既有 `PPT_IMPLEMENTATION_OUTPUT`，重新启动保留历史项目。API Key 经现有加密 DB 层读取，模型默认沿用已配置默认模型；本轮实测为 qwen3.8-max。
- 本轮配置为`outputs/ppt-gamma-semantic-improvements-20261013/isolated-manual/launch-config.json`。项目/加密profile使用`outputs/ppt-gamma-semantic-improvements-20261013/live`，前端读取当前工作树根目录的`.next-ppt-workflow-final-build`生产构建，后端读取同一工作树的生产实现；原复制前端和历史测试目录保留。服务沿用profile中已有认证token。
- 新服务入口 `scripts/ppt/manual-test-service.mjs` 使用生产 `handlePpt`、模型队列和真实 parser/exporter；本地测试只把容器文件 IO 映射到本机测试 workspace。没有伪造模型响应或关闭质量门禁。
- Node.js 22 从当前已安装 nvm 路径启动；可用 `PPT_NODE_BIN` 指定另一 Node.js 22+。前端使用已构建生产快照，不执行安装、重建或自动合并。
- 在页面的 API 设置修改当前测试 profile 的 provider/model 后，页面新项目按选择使用该配置。启动器读取 source 默认模型用于冷启动；重用已有服务时保留该服务的当前默认配置。

## 验证

- 启动器语法检查及从工作目录外执行 status 通过。
- 固定 3141 页面、生产项目 API 和既有真实 provider 连接测试通过。
- Google Chrome CDP 实际点击“新建 → 粘贴文本 → 确认 LLM”，qwen3.8-max 可选并进入创建向导；浏览器 pageerror 为 0。
- 新服务在独立 3160/3161 冷启动验证：创建独立测试 profile，生产 API 就绪、真实模型连接测试成功；随后只清理本轮独立服务，既有 3140/3141 保持运行。
- 证据位于 `outputs/ppt-manual-testing/`：`llm-check.json`、`cold-start-check.json`、`browser-check.json` 和截图。此验证证明可启动、可点击且真实 LLM 可调用，不代表任何完整 PPT 内容已通过质量验收。

如果端口被不兼容进程占用、钥匙串不可读或前端快照缺失，脚本明确退出并保留已有服务/数据。新服务日志为 `outputs/ppt-manual-testing/service.log`。

隔离测试可设置 `PPT_MANUAL_STATE_DIR` 指向另一个本地配置目录；其中 launch-config.json 应使用相互不同的 backendPort/frontendPort、对应的 http://127.0.0.1:<frontendPort>/ppt URL，env 的 PPT_BACKEND_PORT/PPT_FRONTEND_PORT 也保持一致。配置及凭据读取规则与默认一致，不写明文 key；每个目录各有自己的 managed-service.json。未设置时仍使用原 3140/3141 配置。本轮与另一个工作目录竞争端口后使用 outputs/ppt-gamma-semantic-improvements-20261013/isolated-manual 的 3142/3143 配置，恢复原项目状态。

## 2026-10-14语义规划回归

3143已加载全局问题组、代表字段行选择、局部元数据恢复、纯表格主题正文保护和表头保真修复。它们主要作用于新建的自动页数overview/notes项目；已确认的旧27/23/18页项目不会静默改动结构。不要以旧项目仍显示旧分页判断新规划没有接线，也不要给旧诊断稿补写发布状态。

新18页项目c6b0ff0ff4d4ee74c95a78792be97061真实生成完成但quality_blocked：旧表头混入摘要提示，且Workflow矩阵只进备注。源文和检查点保留。新保护会拒绝其旧selection，不能靠原地重试声称覆盖已修复。680c1b8c3536dfbad0937242756557af因Workflow代表行缺少修改、协作及交付类别，已按生产接口停止，不能作为成功样例。最新集成项目为3a3ba7771a889d2a70cf4a15c60f763d，使用同一gamma.md、Deal Review和真实qwen3.8-max，18页revision104当前rubric16真实复测以模型transport/timeout失败结束。证据和最终状态见同源研究文档第6节；完整回归102/102与TypeScript检查通过不代替真实语义发布验收。


## 2026-10-15 当前实现与重试边界

后端已接入真实全局问题组、合法字段/任务族选择、节选提示分离、完整原始备注与链接、当前可见标题/锁定对象保留、原始图引用、针对负面claim与自由finding的独立真实确认。rubric16不复用旧协议结果；claim/obligation未评估的缓存不能当作有效review。节点/证据合同或真实负面仍可阻断，不能根据“单元测试通过”写入发布状态。

真实测试保持网页打开，由现有AppShell BYOK worker领取队列；进度中review:deck:batch、claim_confirmation、findings_confirmation或critic重审均是真实模型阶段，可能比正文生成更慢。页面暂停后，测试监视器不自动恢复用户操作。只在明确初始恢复参数下恢复一次；最多两次传输重试，quality_blocked保留具体结论，不能无限重试。

当前结果入口：[简版评审与实施说明](../research/ppt-gamma-ai-review-delivery-20261015.md)、[完整同源证据与执行记录](../research/ppt-gamma-ai-same-input-review-20261014.md)。最新页面：http://127.0.0.1:3143/ppt?projectId=3a3ba7771a889d2a70cf4a15c60f763d 。正式终态与产物以这两份文档的终态记录为准。

2026-10-15补充：原生文字框在审查前统一准备，exporter隔离副本；自由finding确认使用独立schema与最多一次格式修复。错误包含无效字段，不能把格式失败视为语义通过。最后102项PPT回归结果和真实终态见上述简版/完整报告。

备注/选行审查证据：确认器使用与exportManifest同一编译器的notes manifest，summary也保存完整原件，不以缺少独立notes disposition推断备注缺失。实际PPTX备注仍须通过native verifier；模型输入提供原始rowIndex及精确值，避免位置误读。


## 2026-10-15终态

3143/3142已加载rubric16全部代码并保持可访问；3141未接管。最新Qwen18页revision104保留，正式发布0；真实审核与两次有界重试因transport/timeout失败。DeepSeek新同源项目01591ea1948939726a239697ae00dc12也在规划调用失败，未生成outline。102/102与TypeScript通过不代替真实审核。最新诊断PPTX/PDF和报告位于用户ppt-gamma-results-20261013目录，文件名含Reviewed_Diagnostic_18p_20261015。先检查已配置模型连接，再通过页面重试；已有输入、正文和成功批次保留。不要直接改store或给诊断文件补发布状态。


## 2026-10-15 后续 Gamma 工作流实现（验收进行中）

新计划见 [完整生成流程、23页对照与本轮执行记录](../exec-plans/active/ppt-gamma-workflow-20261015.md)。当前测试仍为前端3143/后端3142；本轮不接管3141。

- 新 overview/notes 自动规划采用 v2 核心消息/支持角色和真实整体编辑复核；纠错用字段 delta，正确分工不重写。
- 生成画面隐藏未启动页、显示真实文字、保持手动浏览；预绑定模板与草稿不再生成双画布。
- rubric17 自由负项按最多3项分批确认，完整source/witness/notes保留，完成批次可复用；未评估不放行。
- worker有界合并progress，保留最终片段；安全原因、实际阶段、首字/耗时、HTTP及queue/execution来源传到错误详情。
- Next TS配置使用兼容CommonJS的 PROJECT_ROOT，不能依赖 import.meta.dirname；watch忽略仅覆盖项目内产物，不能因祖先名含.ppt-build/outputs忽略源码。
- 启动检查包含真实模型执行 route 的无效ID探针：预期JSON400，不领取任务、不调用模型。页面与项目API可用不再等同LLM执行可用。

最新真实项目 ec1e976515de53c51ff1421b6472858a 仍保留完整gamma.md与全局分工，正在从metadata失败处继续。最终状态以该计划最新验收记录为准，不把前述18页诊断稿当作新轮正式输出。新 root 编译配置的生产构建、最终整稿与commit尚在验证。


## 2026-10-15 本轮最新验证入口

当前前端来自当前工作树根目录`.next-ppt-workflow-final-build`，production模式；3143/3142、真实qwen3.8-max、并发上限3。本轮不接管3141。启动器的invalid-ID模型执行探针必须返回JSON400。完整生产构建及164个静态页成功；所有NFT中无本轮outputs/.ppt-build目录，standalone未包含测试profile/状态。

全量npm test已通过2924项（2923pass/1skip/0fail）；当前12项工作流/合同回归及生产modelCall→实际HTTP claim的schema传递验证通过。Chrome生产UI此前26/26，最终同构建重跑记录见本轮执行计划。

新项目479fb17642aacba3748abd5af42bbd5d从失败候选继续，经实际schema生成和整体编辑复核形成9组、69来源归属，正在生成并拟合大纲；旧ec1e976515de53c51ff1421b6472858a保留20完成页，因结构/语义问题仍需整稿审查，不能当正式成功。最新状态及交付文件以本轮执行计划最后记录为准。


最新补充：完整回归2925项（2924pass/1skip），新增冻结字段示例授权回归，避免把来源Brief中的“length:10slides”误当主稿义务。新18页项目所有writer已完成；近期传输失败与人工运维暂停均有检查点，最终正式发布仍以本轮计划最新记录为准。新增需求的详细方案见[页数预算/三档/角色/媒体](../exec-plans/active/ppt-page-budget-depth-template-media-20261015.md)，该部分为待实施设计，当前页面尚只有标准/详细两档及原细节去向控件。


## 最新真实终态与新设计边界（本轮最终记录）

完整npm test2926项（2925通过/1跳过），Chrome生产UI26/26，生产构建164静态页及输出追踪检查通过。finding确认protocol4/rubric18采用单一quoteId绑定，真实Qwen已验证；失败/不确定负项不被删除。

当前18页项目479fb17642aacba3748abd5af42bbd5d与20页项目ec1e976515de53c51ff1421b6472858a均quality_blocked、publishedRevision=0，已完成writer保留。18页有媒体68%低于70%门禁、IR限定及跳选行标题问题；20页Brief机制与次级标签局部修复未成功。均未自动无限重试，没有正式新PPTX。只读诊断文件有原生导出验证与完整联系表，但不改变发布状态。3143服务保留真实配置且可手工点击，3141未接管。

最新[页数/三档/模板角色/媒体方案](../exec-plans/active/ppt-page-budget-depth-template-media-20261015.md)完整记录原因、代码与prompt、阶段A–G、兼容与double-check；属于待实施设计，页面尚未删除“完整细节去向”，也尚未新增concise。不得对用户声称全部方案已经上线或已确保正式整稿顺畅。


## 2026-10-19 PPT 卡片入口与选择控件

点击成品 PPT 卡片或列表中的打开入口直接进入 visual editor，不再先显示项目详情侧栏；编辑器返回操作回到 PPT 列表。进行中、待确认大纲及失败任务仍保留其任务流程和质量门禁。

桌面勾选框默认透明且不接收指针事件，仅在对应卡片悬停、键盘焦点进入该卡片或卡片已被选中时显示；移开鼠标后已选项保持可见。键盘 Tab/Space 和无悬停的触屏设备仍可选择。勾选为独立控件，不触发打开编辑器，批量移动/删除保留。

此项按用户新请求单独提交；此前整稿真实 LLM/PPTX 的待验收改动不因本次提交而被判定通过。

验证：实际 Chrome/CDP 开发环境相关回归29/29，3143生产页面三项新交互3/3；类型检查、完整单测3005通过/0失败/1既有跳过。v29生产构建成功（164静态页、源码指纹一致），3143/3142已安全更新，保留3141。生产测试通过浏览器fixture模拟API，不发送真实LLM请求。证据位于工作树忽略目录`outputs/ppt-card-interactions-20261019/`。


## 2026-10-19 任务中心悬停多选与批量删除

任务行的选择框在悬停、键盘可见焦点或已选中时显示；未选中且鼠标移出时隐藏，取消勾选后的鼠标焦点不会让控件滞留。触屏保留直接选择。支持选择计数、取消选择、确认后批量删除；运行中的任务不可选，切换筛选清空选择，列表更新剔除失效选项。

单条及批量删除复用task-record接口；只删除成功的记录，失败的可删除任务保持选中并显示原因。原PPT和来源保留；账号切换会停止继续操作旧账号，局部失败可仅重试剩余记录。实际后端临时状态selftest、相关12项交互（含一次冷启动定向复验）、完整单测3005和v30生产构建通过，3143生产7/7。3141不变，LLM仅在浏览器用例中模拟，未操作用户真实记录。

详细边界与证据见[任务中心选择方案](../exec-plans/completed/ppt-task-selection-20261019.md)。
