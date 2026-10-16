# PPT 本轮代表性视觉证据

这些图片只证明各自标注的场景，不表示整份执行计划已完成验收。

| 图片 | 实际检查与范围 |
|---|---|
| [短窗口创建](short-wizard.png) | 390×360，50 项形成中大纲，正文滚动、底部动作仍在窗口内；生产组件＋夹具 API，CDP 截图 |
| [单项目工作区](workspace-1440.png) | 1440×900，单卡不会拉伸为巨幅缩略图；生产组件＋夹具 API，CDP 截图 |
| [固定模板对象](fixed-template-objects.png) | 点击预览对象、跨页保留选择，旧背景未被自动保留；生产组件＋夹具 API，CDP 截图 |
| [手机聊天](chat-mobile.png) | 390×500，长历史单独滚动、输入框及提交按钮完整可达；生产组件＋夹具 API，CDP 截图 |
| [暂停时实际改字体](paused-format-real.png) | 真实模型项目暂停后选已完成页，将标题改为 Arial 32pt；读取持久化样式、恢复生成和实际 PPTX/PDF 检查通过。过程分段录制，原客户端连接失败保留 |
| [实际双语来源页](bilingual-source-real.png) | 实际 PDF 第 5 页，中文与英文按相关主题同页；原始路径/全量权限条件保留，补齐生产 Noto CJK 依赖后字形正常 |
| [完整来源合并页](merged-source-page.png) | 真实模型生成并实际导出的 PDF 第 2 页，经 pdftoppm 渲染；两段来源完整显示，未见裁切 |

前四张的源组件快照为 `e096be173c44dad14a3bc3810fe5e613cad34ce7902d45de03ed0a53018095c3`。测试夹具与真实模型结果严格区分。源快照的测试文件在修复夹具后另有版本，不据测试文件 hash 冒称修改了界面组件。

最后一张对应项目 `caef655f55e9502d21a35bcbde25d6e8`、后端 `a730568b48a1fda82efc56d7518beaba704b2f1dfd32bc1120e984acc750e713`、PDF SHA256 `35221d6a200202c900db795b754c9d04ee00c7006efc84bed79332bf3abdc8c5`。四页均已逐页查看，完整来源保留；第 3 页主题可以更明确提及后续复查，已记录为编辑建议。没有宣称在 PowerPoint 桌面应用中打开过文件。

完整日志、源和模板 hash、PPTX/PDF、原始失败、重跑及逐页 PNG 在本地 `outputs/ppt-experience-quality-20261014/`，该目录按仓库规则忽略入库。当前真实矩阵及长稿状态见[执行计划](../../../exec-plans/active/ppt-experience-quality-routing-20261014.md)。

新增实际证据：`bc17d95e8a066be81717e3a717b0a296` 的标题样式在已完成原生 PPTX 中为 Arial 32pt，4 页实际 PDF 已逐页查看；PDF hash `7564a7aeb828b65ee4b6a0de406843b7f11665859f051d1abdefeb3bb725be93`，PPTX hash `220ee1acca0c09c289116d34007c31068a255af54ef611d8fc2e01de1b587ba4`。后端为 `a59ef69e…`，前端仍是上述同一组件快照。`ui-live-current2/4/5` 保存创建/暂停、手改恢复、完成再打开三段记录；不是一次无中断通过。

双语图来自 `27bc0afb18b321a8d39875e5868ad1ad`，PDF hash `e1b25ceae41526cd7ea48961b44a0186640cfa4b314f627160d19edcbc94144b`；8 页实际 PNG 均已查看。此版本的合并标题偏长另有后续修复，不代表原始长稿验收。


[实际刷新后的暂停编辑](paused-format-reload-real.png)：项目4e90e0d1e251ddd582d1a7485c860075，实际CDP重新加载后Arial32pt保留，完成页与待生成页区分。前端产品hash3a783bc5…、后端8740a8df…；73/73 PPT与15/15通用冒烟通过，实际4页PPTX/PDF已查看。这张图不证明后续68fe后端的全组UI复测。


- [实际组合居中修复](gamma-column-group-real.png)：Gamma项目2241e9a1123d497ef1c42199db9fa85b，第26页，原先右栏两段独立居中重叠，修复后整组居中保留间距；来源和18pt不变。48页实际PDF全部查看，PDF799d0e5f…，PPTX0e004208…，后端b267。
- [实际严格阈值](strict-threshold-real.png)：项目cf351eede4e2baf39f8346dcf58a314a，第2页，Daily/Monthly两处`> 0.05`保持，3页实际导出已查看；后端68fe。初始传输失败及第4次超时保留，第5次规划后生成成功，不算首轮成功。
