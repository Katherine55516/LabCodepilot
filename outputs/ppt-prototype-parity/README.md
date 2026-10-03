# PPT 最新原型对齐：本地验收

2026-10-03；代码基线 de946f6。先更新外层实施计划，再修改 PPT 模块。原型文件没有改动。

## 结果与证据

| 门禁 | 结果 | 证据 |
|---|---|---|
| `npm test`（包含 TypeScript） | 2808 通过、1 跳过、0 失败 | [日志](npm-test.log) |
| 完整 `npm run test:smoke -- --workers=1 --reporter=line` | 33 通过 | [日志](smoke.log) |
| 最新 PPT 专项浏览器复验 | 5 通过；每项同时检查 pageerror / console.error，均为空 | [日志](ui-proof.log) |
| 新策略/参数/多轮范围服务端自测 | 通过 | [日志](server-prototype-parity.log) |
| 原 EditIntent / Proposal / 定向 Undo / epoch | 通过 | [日志](server-edit-intent.log) |
| Mutation / Runtime 十项回归 | 通过 | [日志](server-mutation-runtime.log) |
| 恢复与同步 | 通过 | [日志](server-recovery.log) |
| Prompt 深度契约 | 通过 | [日志](server-prompt-contracts.log) |
| 结构化编辑与实际 PPTX 尺寸回读 | 通过 | [日志](server-structured-size.log) |
| 内容深度与排版质量回归 | 通过 | [日志](server-content-depth.log) |
| 指定变更文件 ESLint / `git diff --check` | 通过 | [ESLint 日志（空表示无错误）](eslint.log) |

执行环境为 macOS、Node 22.22.0；仓库默认 Node 18 不用于这轮测试。原生 PPTX 导出自测使用已有 bundled Python 的 python-pptx。

## UI 覆盖与截图

浏览器测试运行真实 Next 开发页面和生产组件，API/模型采用隔离 fixture。以下截图是交互验收数据，不代表真实模型生成质量。

- [输入页桌面](input-desktop.png)：方式 → LLM → 模板 → 输入；估算等待时保留模板/上一结果，手动页数优先，清空和返回模板不丢输入；提交携带 detailed/source policy。
- [粘贴与 Syllabus，390×500](paste-short.png)：真实滚轮可滚到末页内容，编辑末页后确认提交；底部确认入口可见。
- [生成聊天桌面](chat-desktop.png)、[390×500 聊天](chat-short.png)：收起重开保留草稿，两轮使用续期后的固定范围；完成后转编辑器，继续输入不丢失，提交按钮可达。
- [局部 AI 参数和前后候选](local-ai-parameters.png)：法语/双语/地区/术语与扩写 2× 进入请求，显示实际 20 → 40 长度；discard/apply 操作完成。
- 专项同时验证 2 页模板不会限制原生可编辑 PPTX 的导入页数。完整冒烟覆盖原有文件解析、粘贴图片、版本更新、模板复用、编辑保存、质量门禁和其他工作台流程。

完整冒烟中的取消操作使用键盘 Enter，避开 Next 开发工具浮标对左下角点击区域的遮挡。专项导入断言使用 `expect.poll` 等待异步请求，避免把请求尚未发出误判为功能失效；没有修改产品行为来迎合测试。

## 服务端覆盖

`selftest-ppt-prototype-parity.mjs` 使用隔离临时状态目录和确定性 modelCall，检查：

- policy v1 校验、旧稿兼容、显式深度优先、稀疏输入来源规则、输入语言与局部翻译覆盖。
- 只读页数估算不创建项目；总页数与“第 12 页/slide42”区分。
- 参数错误在调用模型前拒绝，写作动作不能改 layout/data/structure；候选保持只读，实际长度不足或过量均反馈。
- 幂等包含参数和 conversation；两轮完成态编辑可继续；同 run/plan 下固定 ID 不漂移。
- 手动修改目标页后续期返回 409，显式重新选择允许新基线；旧 run/plan 拒绝。

`selftest-ppt-structured.mjs` 回读实际导出的 PPTX：新稿精确为 12192000 × 6858000 EMU；原生 4:3 原稿保持 9144000 × 6858000 EMU，媒体哈希保留。不是仅断言预览 CSS 比例。

## 复现

```sh
export PATH=/Users/dongli/.nvm/versions/node/v22.22.0/bin:$PATH
npm test
npm run test:smoke -- --workers=1 --reporter=line
npx playwright test src/__tests__/e2e/ppt-prototype-parity.spec.ts --workers=1 --reporter=line
node apps/cowork-server/selftest-ppt-prototype-parity.mjs
node apps/cowork-server/selftest-ppt-edit-intent.mjs
node apps/cowork-server/selftest-ppt-mutation-runtime.mjs
node apps/cowork-server/selftest-ppt-recovery-sync.mjs
node apps/cowork-server/selftest-ppt-prompt-contracts.mjs
node apps/cowork-server/selftest-ppt-structured.mjs
node apps/cowork-server/selftest-ppt-content-depth.mjs
```

浏览器测试按仓库 Playwright 配置使用或启动本地开发服务器。现有 structured 自测使用 `/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`；本机该路径存在，实际导出断言已执行。其他机器若缺少这个 runtime，当前自测会跳过 Python 导出部分，不能据此声称尺寸回读通过。

## 验收边界

chrome-devtools MCP 未提供。CUA 内置浏览器没有完成开发页客户端加载，独立 React 组件页也未执行脚本；该尝试不构成人工交互验收。实际 Chromium 交互证据来自仓库 Playwright 测试。`ui-proxy.ts` 仅为该尝试的本地 fixture 入口，非产品服务。

页数 API 是现有语义/容量规则估算，不调用真实 LLM。没有验证真实托管模型的内容质量、远端 Cowork、跨设备恢复或 Electron 安装包。完整 capacity report、文字选区、多版式候选、Visuals 和公式/代码 IR 保持后续路线图。

实现详见 [交接](../../docs/handover/ppt-prototype-policy-chat-parity.md) 与 [完成的执行计划](../../docs/exec-plans/completed/ppt-prototype-policy-chat-parity.md)。
