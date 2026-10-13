# Claude 第五轮后的 PPT 核验与真实生成

> 2026-10-11；用户已授权等待 Claude 完成后补齐改进，并上传私有执行仓库、使用 Actions Secret 进行真实生成。主应用仓库不提交、不推送。

## 状态

| 阶段 | 工作 | 状态 |
| --- | --- | --- |
| 0 | 核实 Claude 完成及保护已有更改 | 完成：09:19 UTC 第五轮最终报告；当前 run17 保留所有未提交改动 |
| 1 | 两份分析文档及实际生成根因逐项核验 | 完成：18组问题对照追加至三份指定文档，保留历史 |
| 2 | 补齐媒体保留、流式协议、模板骨架及相关缺项 | 主要P0已实施；官方对象语义提交、竞态E2E、目录/收束/排布等未关闭，详见报告 |
| 3 | 回归门禁、三语、真实 UI/CDP/录屏与 GitHub ARM64 尝试 | 本地完成：2879通过/1跳过，48 smoke；云端因billing在runner分配前失败 |
| 4 | 逐页外观检查、报告、PowerPoint、证据 manifest | 完成：21页revision16，逐页检查和真实视频交付；附未关闭项，不宣称全部无误 |

## 已发现的核验差异

- 使用 writer delta schema 时，worker 的 `!supportsSchema` 分支阻止 writer 流式输出；需要保留 schema 并同样 stream，显式处理流内错误。
- 草稿只由项目和页 ID 索引；repair 节点后缀混入 slide ID，缺少运行/epoch/序号隔离，过期草稿可能污染新运行。
- 当前骨架是通用文字卡，没有实际原生模板媒体、几何与背景；需输出非权威模板骨架并与正式渲染隔离。
- 原设计有效媒体守恒 0.7 和连续纯文字页三页需门禁，第五轮改为 0.5 硬门禁、其余警告；不得把较弱门禁描述成完成原要求。
- 保留媒体分栏是全部成功或全部失败，未尝试最大可行子集；大篇幅仍会整页丢失装饰图。保留完整来源、字号和 exact-N。

## 验收与约束

- 使用 `10_alpha_mining.md` 完整原文、`Copy-of-Deal-Review (1).pptx`，生产模块自行估算及校准页数。
- 真实 API、真实 SSE、schema/来源/容量/原生导出门禁；不制造模型结果或动画进度，不自动确认退役媒体。
- full editor 连续录屏与 Home 往返分段验证；桌面与移动端 CDP；每页高分辨率外观检查。
- 保存新独立 `outputs/ppt-alpha-mining-live-20261011`，保留 Claude 重放与之前产物。
- 若 GitHub 仍因 billing 未分配 runner，报告真实云端阻挡并完成可行本地验收，不能宣称 ARM64 已通过。
- 未关闭项必须逐项注明，不用模拟测试代替真实模型证据。

## 最终检查点

- 真实项目 `5b6866ab04df548ef92ad2049c0c984b`，revision/publishedRevision 16，状态 completed，quality passed_with_warnings，64来源对象逐字/hash不变。
- 主交付：[报告](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-alpha-mining-live-20261011/report.md)、[改进核验](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-alpha-mining-live-20261011/improvement-audit.md)、[manifest](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-alpha-mining-live-20261011/manifest.json)。
- GitHub run38134907858：runner_id0、steps[]，付款/spending limit；最新私有快照4c46efb61c72bdabb7e96ff213990af412b49387准备完毕但未重复dispatch。没有ARM64通过证据。
- 本轮服务器关闭，临时tsconfig恢复；不影响此前3115服务器。主应用未提交/推送/合并/部署。
- 最终交付后按用户指令暂停小时检查；不重复生成。未关闭项在报告列明，后续为单独工作，不能把本轮局部修复写成全清单完成。
