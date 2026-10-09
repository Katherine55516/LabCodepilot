# PPT BYOK 配套部署与 Apple Silicon 验收

更新：2026-10-09。GitHub 测试仓库：`Katherine516/LabCodepilot`（私有）；组织 origin 保留。本机 Intel，不把本地测试算成 arm64 验收。

## 推荐顺序与落实

先验证协议与包完整性，再在专用测试分支上跑 arm64 CI，然后部署独立沙箱，最后完成真实账号和真实模型的整稿验收。源码、服务可用、浏览器操作、模型内容质量分别留证据，不能互相代替。

1. **协议兼容检查，已实现。** `GET /ppt/capabilities` 受现有账号鉴权，返回 BYOK v1、desktop-model-jobs、密钥位置、输入/结果上限和 worker 超时要求。客户端 `requirePptByokCapabilities` 在输入分析和创建前检查完整契约，旧服务/错误版本明确阻止；托管模型路径保留。仅队列接口返回200已经不足以证明兼容。
2. **完整服务部署包，已实现。** `node scripts/ppt/package-cowork-release.mjs <archive>` 从当前源码生成 `cowork-release.tar.gz`、SHA256 和内部逐文件清单。包含生产 lib、image/container、根测试 helper 和 scripts；排除 `.env`/备份、node_modules、历史 outputs 和本机 API profile，保留无真凭证的 `.env.example` 模板。归档不是客户端安装包，不含用户 API key。
3. **现有 Linux 服务的有界升级，已实现脚本。** `deploy/apply-release.sh` 只接受明确的已有部署路径/服务。先校验包、服务 WorkingDirectory 和外置状态目录；复制新源、保留 `.env` 和审计记录、安装依赖；停服务后再次复制审计尾部，替换目录并重启。失败恢复原目录并启动旧服务。它不配置首次服务器、防火墙、TLS或账号后端；不会把一个未知主机自动当作生产。
4. **Apple Silicon 专项 CI，已实现 workflow。** 在现有 `build.yml` 的 `platform` 选择中新增 `ppt`，运行前先确认个人仓库默认分支已注册该 workflow，再通过 `--ref codex/ppt-byok-arm64-validation` 运行。新仓库首次推送时以该测试分支作为默认分支，不改动组织 main。`ppt-arm64` 使用 `macos-15`，强制实际 Darwin/arm64；保存 CPU/commit/Node 元数据，不宣称指定物理 M1 型号。只读仓库权限、Node22/Python3.12、独立假凭证 profile，运行全量单元/typecheck、全部可移植 PPT selftests、实际 PPT React/UI/CDP测试、部署包生成与解包核验。该模式不会构建或发布 release。
5. **真实远端 E2E，尚需环境。** 用户实际登录 → 账号后端配发 Cowork URL/token → 部署服务 → 已认证 capabilities v1 → 选择本地 deepseek provider → 模板/输入 → Agent 估算页数/大纲确认 → 内容生成/修复/审查 → 局部 AI 候选/应用/撤销 → PPTX/PDF导出并检查。仍需实际主机、服务账号、目录及登录；不能伪造生产用户或关闭认证达成“通过”。

## CI 命令与证据

在专用分支源码获得上传授权并推送后，使用已安装 `gh 2.102.0`：

```sh
gh workflow run build.yml -R Katherine516/LabCodepilot --ref <test-branch> -f platform=ppt
gh run list -R Katherine516/LabCodepilot --workflow build.yml --branch <test-branch> --event workflow_dispatch --json databaseId,headSha,status,conclusion,url
gh run view <run-id> -R Katherine516/LabCodepilot --json headSha,jobs,conclusion,url
gh run download <run-id> -R Katherine516/LabCodepilot --name ppt-arm64-validation --dir <local-evidence-dir>
```

必须核对 `headSha` 为批准上传的 commit，不能拿旧 main 构建结果证明本轮修改。失败只针对真实失败修复，不删除断言、强置 quality 通过或跳过失败项。`selftests.json` 显式记录 optional fixture 不存在时的 skip；没有原始本机长稿/模板的 CI 不声称这些样例已经校准。CI 不传真实用户 key、不做真实模型调用；原生导出/契约用确定性 fixture，具体测试的模拟边界沿用测试记录。

GitHub 当前账号有仓库 push 权限，没有管理 runner 权限（runner-list API 404）。GitHub-hosted runner 由 Actions调度；代码记录实际 arch/CPU。仓库规则要求用户主动授权 `git push`，不会通过 GitHub API 创建树/引用绕过该要求。

## 部署操作

1. 在明确的测试服务器上传归档和 `.sha256`，运行 `sha256sum -c`，解包到新的暂存目录。不要覆盖正在运行的部署目录。
2. `node <staged>/deploy/verify-release.mjs <staged>`；检查 Node≥20、Docker和现有容器镜像/办公字体、Python/LibreOffice及沙箱出网符合现有运维规范。
3. 先用 `deploy/verify-deployment.sh <host> <existing-dir>` 检查远端独有代码或漂移；未知漂移人工确认，不能盲覆盖。
4. 独立测试环境执行 `sudo bash <staged>/deploy/apply-release.sh <staged> <existing-dir> <service>`。保留返回的 backup 路径。
5. 真实用户 Bearer 请求 capabilities；普通账号不能访问别人的工作，错误 lease/重放失败；启动整稿验收。不要把 token 放到终端命令参数、报告或聊天，使用已登录本地代理请求。
6. 源码升级脚本服务 active 后仍需 API/渲染健康检查；服务 active 不能证明 Docker、模板、PDF、媒体或模型可用。首次安装仍参考部署 README/TLS指引及账号后端配发流程。

目前本机 SSH `cowork-prod` 不可解析；开发与默认 profile 均无远端 URL/token/登录。因此脚本未在真实 Linux 服务执行，真实整稿 E2E 未发生。先建立独立环境是当前的合理路径；不要求用户在聊天提供密钥。

## 本地验收记录

- `npm run test`：typecheck/vendor通过，2819单元通过、1skip、0fail。
- 可移植 `ppt-ci.mjs`：35项通过，原始本机49页输入/模板fixture不存在的1项明确skip，无失败。
- `npm run test:smoke -- --workers=2 --timeout=90000 --reporter=line`：41/41通过。新增 BYOK浏览器测试验证 protocol v2 不创建项目、v1 带正确 byok/model 创建项目；真实 CDP截屏/console无错误。
- 服务源归档187文件、约628KB；SHA256、逐文件清单、配置/依赖排除与篡改拒绝通过。目录打包动态取当前源码，所以报告数字与最终commit包可能随后续源码增减变化。
- `selftest-release-upgrade.mjs`：已有配置/自定义审计路径保留、成功升级保留备份、启动检查失败回滚、错误 WorkingDirectory在停服务前拒绝，全部通过。平台/root/systemd/npm使用隔离工具替身，真实Linux/root/npm/systemd未验收；没有操作远端服务。
- `gh`实际读取仓库/workflow/运行列表成功；当前看到的旧 file_fix运行不是本轮验收。新分支未上传前不调度旧main替代新代码测试。
- 用户已授权先推送到个人私有仓库 Katherine516/LabCodepilot 的 codex/ppt-byok-arm64-validation 分支；CI 尚未调度，远端主机与真实账号/沙箱仍未提供。

官方依据：[runner 选择/架构](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)、[gh workflow run 与 ref](https://cli.github.com/manual/gh_workflow_run)。
