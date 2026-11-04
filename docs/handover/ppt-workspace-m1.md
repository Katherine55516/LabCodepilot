# PPT Workspace M1 交接

状态：2026-09-18 初版代码完成；尚未在真实 Cowork 服务器部署与端到端验收。M1 范围与未交付功能见 [执行计划](../exec-plans/active/ppt-workspace.md)。

## 核心链路

```text
办公侧栏 /ppt → PptWorkspace → /api/ppt/projects/* (Next 代理)
  → cowork-server /ppt/projects/* (HMAC uid 鉴权)
  → ppt-store: COWORK_STATE_DIR/ppt/<uid>/<projectId>.json
  → outline 模型节点 → 用户修改、确认
  → content[slideId] 逐页节点 → python-pptx 确定性渲染
  → 项目持久卷 /workspace/presentation.pptx → 授权导出
```

- Next 端只从本地 DB 读取当前 uid、`cowork_remote_url` 和 `cowork_remote_token`，再转发到远程服务器；浏览器拿不到远程 token。远程 HMAC token 决定真正的 uid。直接猜项目 ID 在其他账号下返回 404。
- Cowork 端项目 JSON 是跨设备事实源。项目独立容器与持久卷带 `cowork.kind=ppt`，`reconcile` 会排除它们，避免客户端会话列表对账删除 PPT。容器可被 idle reaper 停止，持久卷保留。
- 模型走现有账号凭证获取与 cred-proxy，调用在项目容器内部执行。PPT 模式通过 Claude CLI `--tools '' --disallowedTools 'mcp__*'` 禁掉内建和 MCP 工具；模型只能给大纲或单页文案 JSON，字段/页数/长度在服务端校验。页面位置、字体、主题和 PPTX 均由容器内 `python-pptx` 脚本确定。
- 状态：`outlining → outline_ready → generating → completed`，失败为 `failed` 并保留阶段。`nodes[slideId]` 记录逐页尝试与结果，成功页在服务重启或重试后跳过。逐页串行执行，因为同项目容器共享 Claude HOME 与凭证代理状态。服务端重启时扫描未完成项目恢复。
- 容器内（及本机测试）运行的内嵌 Python 脚本经 stdin 传入：参数用 `PYTHON_STDIN_ARGS`，输入用 `pythonStdinInput(script, input)`（`lib/ppt-python-stdin.mjs`），不要再写 `python3 -c SCRIPT`。Linux 单个命令行参数上限 128 KiB（宿主和容器都一样），导出脚本已 135,908 字节，渲染、读取脚本也接近上限；超过时 `docker exec` 直接 E2BIG。新增调用一律复用这个 helper，测试用 `test/ppt-local-runtime.mjs` 的 `spawnPythonSync`。
- 已完成项目的编辑保存带 `revision`，跨设备旧版提交返回 409；文件名和封面页标题分离。每次内容保存重渲染 PPTX，导出只对 `completed` 开放。

## 文件地图

| 文件 | 责任 |
|---|---|
| `src/components/layout/ChatListPanel.tsx` | 办公侧栏入口和 `/ppt` 深链激活办公 tab |
| `src/components/ppt/PptWorkspace.tsx` | 项目库、表单、大纲确认、进度、编辑、导出 |
| `src/app/api/ppt/[...segments]/route.ts` | 登录检查和远程 API 代理，下载流透传 |
| `apps/cowork-server/lib/ppt-api.mjs` | 项目状态机、逐页节点、失败重试、授权下载 |
| `apps/cowork-server/lib/ppt-store.mjs` | 按 uid 的原子 JSON 项目存储 |
| `apps/cowork-server/lib/ppt-render.mjs` | 在容器内从受限 IR 生成 PPTX |
| `apps/cowork-server/lib/ppt-python-stdin.mjs` | 内嵌 Python 脚本经 stdin 传入容器，避开 Linux 128 KiB 单参数上限 |
| `apps/cowork-server/lib/orchestrator.mjs` | `ppt` kind 与 reconcile 保护 |
| `apps/cowork-server/lib/routine-runner.mjs` | 复用沙箱模型凭证链，PPT 调用禁用工具 |

## 验证与部署

- `npm run test`：2799 通过、1 跳过；`npm run typecheck` 通过。`PPT_PYTHON=<python-with-python-pptx> node apps/cowork-server/selftest-ppt.mjs` 会生成并重新打开中文 PPTX，并走公开 API 验证创建、大纲、逐页失败后续跑、编辑、修订冲突、跨账号隔离和下载门槛。
- 开发浏览器已验证 `/ppt` 页面、创建表单和控制台；PPT 定向 Playwright 浏览器交互 1/1 通过，并检查具体模型 ID 与配置 ID 提交。全仓冒烟 13/17，失败的 4 项为既有 mention-picker、plugins/MCP/settings 测试。普通 `npm run build` 遇到现有 Turbopack/webpack 配置冲突；打包脚本采用的 `next build --webpack` 完整通过。未接真实远程模型与 Docker，故生成、重启恢复和实际下载仍需在 Cowork 部署环境验证。部署须同步更新 cowork-server 代码；现有镜像已有 `python-pptx` 与 Noto CJK 字体，无新镜像依赖。
- 需要在目标环境跑完整链路：创建 3/10/50 页 → 修改大纲 → 离开页面与重启服务 → 重新打开并导出 → 第二台设备同账号查看 → 异账号访问 404 → 编辑冲突 409 → PowerPoint/LibreOffice 打开 PPTX 检查中文与溢出。
