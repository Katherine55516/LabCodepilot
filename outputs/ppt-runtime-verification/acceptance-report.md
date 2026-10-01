# PPT 优化验收报告

> 日期：2026-09-30；仓库：LabCodepilot-para；Node.js 22.22.0。
> 文本 LLM 保持用户所选 configId/model。验收使用确定性模型适配器验证领域逻辑，不代表真实供应商输出质量验收。

## 十项验收

| # | 验收目标 | 证据与结果 |
|---|---|---|
| 1 | 只缩短标题，不改正文/数据 | title transform 保持 bullets；已有深度约束后的新 title intent 仍只调用标题模型。通过 |
| 2 | 未开始页修改不影响已接受页 | 当前 render hash 接受保护，扩大范围自动排除 protected page；完成后内容 AI 在解锁前被拒绝。通过 |
| 3 | 并发范围准确 | remaining 仅冻结尚未开始页；following 包含后续 running/pending 页，任务开始后仍使用原 slideId 范围。通过 |
| 4 | 迟到 AI 不覆盖手动修改 | 旧 Proposal 409；AssetTask 旧 attempt 被拒；暂停中 Command 同步 node cache，旧排队 intent conflicted，恢复保留手动标题和正文。通过 |
| 5 | 媒体失败只重试媒体 | 同 AssetTask attempts 递增，失败不增草稿 revision，确认 asset proposal 才替换图片，正文不变。通过 |
| 6 | 重启恢复不重复提交 | checkpoint 复用版本/epoch 匹配的内容和真实预览，新 revision 不被旧 snapshot 覆盖；持久 Intent/Journal 幂等与 reload 通过 |
| 7 | 拆页内容和计划一致 | 每个原 point ID 恰好出现一次；pages/pageDecision/outline/contracts/story/页码一致；包含来源 atom 的拆页保留必要证据；Undo 和 snapshot 恢复预算。通过 |
| 8 | 内容变化使旧审查失效 | 内容后 reviewState=stale；仅样式复用；发布调用用户所选模型重评；chart values/unit 出现在 critic 输入。通过 |
| 9 | 额度不足排队 | FIFO 容量 1 场景按入队顺序运行，无空闲槽位不立即失败，所有释放后 active=0。通过 |
| 10 | 编辑/预览/导出一致 | publish 接收与当前 canonical preview 相同的 RenderTree hash；publishedRevision 与发布草稿一致。通过（export I/O 部分为适配器） |

主验收实现：[selftest-ppt-mutation-runtime.mjs](../../apps/cowork-server/selftest-ppt-mutation-runtime.mjs)。它输出 10 个验收分组，分组内另含来源拆页、canonical 数据审查、标题最小修改、暂停手动修改与延后结构确认用例。

## 回归结果

| 执行 | 结果 |
|---|---|
| 18 组 PPT selftest | 全部 exit 0 |
| npm run test | typecheck 通过；2807 tests：2806 pass、0 fail、1 skip |
| npm run test:smoke | 收尾版本 28 pass，31.5 秒 |
| scripts/verify-ppt-runtime-cdp.mjs | 13 项桌面/移动端检查通过；0 consoleErrors |
| scripts/verify-ppt-editing-cdp.mjs | 前一阶段 8 项真实 dev 页面交互通过；0 consoleErrors |

18 组覆盖：ppt、m2、m3、m4、m5、structured、semantic、content-depth、evidence-quality、template-fidelity、template-scheduler、report-qa、long-storage、long-limits、recovery-sync、requirements-parity、edit-intent、mutation-runtime。

历史 M3/M4/semantic/template-scheduler fixture 按现行发布、planning v5、来源媒体绑定和安全装饰替换协议修订；生产门禁未为迁就 fixture 而放宽。

## 浏览器验收

运行现有 `localhost:3000` dev app，通过 Playwright connectOverCDP 与 Runtime/Log/Emulation/Page 验证；当前环境没有可调用的 chrome-devtools MCP，因此使用相同 CDP 协议。API 进入真实服务模块，模型和 export I/O 用本地适配器。

[机器记录](runtime-browser/verification.json) 包含 13 项检查：预览不写 revision、服务端提案应用、定向撤回、标题保正文、样式类型化、保护/解锁、拆页子页面预览、范围独立草稿、生成结束/reload 保留未提交输入、完成后 intent 只改草稿、历史 reload、暂停恢复复用页面、模板翻页与移动布局。

已实际查看截图，并修复移动端暂停/恢复按钮与正文重叠。几何断言验证 header/main 不重叠及无水平溢出。

- [暂停状态：移动端](runtime-browser/paused-generation-mobile.png)
- [暂停状态：桌面](runtime-browser/paused-generation-desktop.png)
- [结构修改：桌面](runtime-browser/split-preview-desktop.png)
- [结构修改：移动端](runtime-browser/split-preview-mobile.png)
- [样式提案](runtime-browser/style-preview-desktop.png)
- [模板设置：移动端](runtime-browser/template-settings-mobile.png)

## 验收限制

- M2 宿主 PDF 输出分支因 matplotlib 不可用跳过；其 API、来源格式与身份隔离通过。
- 未调用真实外部文本/图片模型；远端 Cowork 导出、Electron 打包态与 Windows 未在本次本地验收中验证。
- 当前队列、JSON Journal 和 PID lease 是单服务部署口径，不构成多进程/跨主机事务验收。
- 结构生成中修改在整稿完成后提供确认提案；asset/data 通过完成后的具体对象入口，不宣称支持全部类型实时修改未完成页面。
- 语义 critic 是文本模型；未实现截图 VLM。来源数值/单位匹配不是完整事实证明。

实现、接口与后续部署条件见 [运行时交接](../../docs/handover/ppt-mutation-runtime-unification.md)。
