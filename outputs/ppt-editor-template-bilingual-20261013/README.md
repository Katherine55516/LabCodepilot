# PPT 本轮验收证据（2026-10-13）

本目录为本地实现验收。模型响应使用明确的 adapter；文件解析、模板绑定、命令服务、共享渲染和 PPTX 导出使用生产代码。这里没有真实在线模型长稿质量通过的结论。

## 当前工作区实测

| 检查 | 最终记录 | 结果 |
|---|---|---|
| TypeScript + 全量单元 | npm-test-final.log | 2820 项：2819 pass、1 skip、0 fail |
| 全站 smoke | smoke-verified.log + smoke-verified-retest.log | 41 pass；2 项导航超时，重测 2/2 pass；43 个场景最终通过 |
| 创建/暂停/完成编辑应用 CDP | editor-cdp-accepted.log、editor-cdp/verification.json | 9 项通过、errors=[] |
| 逐页/聊天/图片应用 CDP | progressive-cdp.log、progressive-cdp/verification.json | 5 项通过、errors=[] |
| 生产组件/原生 SVG CDP | component-cdp-accepted.log、component-cdp/production-component-cdp.json | 6 项通过、errors=[] |
| 完整生成服务与来源图片导出 | generation-input-contract-final.log | 补充 PNG、完整表格、逐页真实预览、末页感谢语；大于 512 KB 的直接 PNG 文件完整进入导出 |
| 模板内容隔离与原生编辑 | editor-template-language-final.log | 原模板不变；旧标题/数字/表/图/备注清理；暂停/完成编辑、原子性、撤销/重做/恢复及实际字体运行通过 |
| PNG/JPG/DOCX/XLSX/PDF/HTML | input-visuals-final.log | 六种真实解析通过；XLSX 原生图表和 HTML SVG 进入媒体目录 |
| 共用渲染与实际 PPTX/PDF | render-contract-final.log、render-contract/verification.json | 完整代码/表格、负数图表、字体/对齐、图像 fit/crop、PDF 字形通过 |
| 静态检查 | eslint-verified.log | 0 error、15 warning；git diff --check 通过 |

其余领域检查：topic-language、copy-media-integrity、balance-p0、density（21 组）、edit-intent、structured、recovery-sync、requirements-parity、template-fidelity、hard-rules、m2、prompt-contracts。与上表 4 个领域入口合计 16 个。M2 老脚本因宿主 Python 的检测跳过一个 PDF 子检查；实际 PDF 验证由 render-contract 和原生导出另行完成，未将跳过计为通过。

## 可直接查看的实际结果

- [生成与媒体/表格断言](generation-input-contract.json)：第一页内容已出现时第二页/未来预览尚未建立，完整表格中心与内容区中心相同。
- [四页实际服务导出](generation-input-contract.pptx)；[超过 512 KB 图片的实际导出](large-source-image-contract.pptx)。媒体哈希与输入一致。
- [原生模板编辑断言](native-edited-template.json)；[原生模板实际导出](native-edited-template.pptx)；[原生第二页 PDF 渲染](native-edited-template-page2.png)。Georgia、24pt、粗体/斜体/下划线可见。
- [短窗口下一步按钮](editor-cdp/prompt-actions-390.png)、[暂停后字体编辑](editor-cdp/paused-formatting.png)、[窄屏修改聊天](progressive-cdp/chat-390.png)。
- [实际导出的独立表格](generated-2.png)、[原生标题及媒体完整预览](component-cdp/production-native-preview.png)。

输出中的短稿和噪声图片是功能 fixture，用于验证完整链路，不用于证明真实长稿的内容质量。Gamma 附件是参考材料，其 LibreOffice 渲染存在原字体缺字，不作为本产品验收产物。

本目录历史失败日志保留用于追踪。只以以上最终日志/断言为验收结果。线上模型会话、远端部署和新安装包未验收。

## 独立提交快照

本轮开始前的其他未提交改动未纳入提交。`git checkout-index` 独立复制后重新执行：`index-npm-accepted.log` 为 2820 项、2819 pass / 1 skip / 0 fail；`index-domains-accepted.json` 为 16 个领域入口全部退出 0。最新格式修复再核查实际渲染、原生模板编辑、完整生成与 structured 命令。
