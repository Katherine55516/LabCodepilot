# PPT 本地 API key 与自由模型选择

创建：2026-10-09

## 状态

| 阶段 | 工作 | 状态 |
|---|---|---|
| A | 核查 New API、恢复 OpenAI-compatible provider 持久化/设置/连接探针 | 本地完成 |
| B | PPT 列出本地服务商的模型；桌面执行模型请求，沙箱保留现有工作流 | 本地实现/生产路由 selftest 完成，远端未部署 |
| C | 无真 key 回归、UI 验证；准备加密的本地设置环境 | typecheck/2818单元通过；smoke首轮40通过+1超时，原样独立复验通过；实际 CDP 验证通过 |
| D | 用户输入 key、查询模型与最小连接验证 | 已保存加密 key，目录认证成功，用户所选 deepseek-v4-flash 连接成功 |
| E | 远端部署、真实账号 PPT 端到端与安装包验收 | 未执行，保留为后续验收 |
| E1 | 版本化 BYOK capability、客户端预检、公开 HTTP/worker 集成验证 | 完成，生产HTTP/单元/CDP通过 |
| E2 | 排除凭证/历史输出的完整服务部署包、清单校验、备份回滚 | 包/脚本与隔离升级回滚测试通过；目标 SSH 未提供 |
| E3 | 现有 Actions 增加 PPT-only arm64 验收、gh 调度与结果下载 | 已完成：M1 Virtual原生arm64 CI；2819单元/35PPT专项/24浏览器通过，见handover实跑记录 |
| E4 | 真实登录配发、远端部署、真实模型整稿/局部编辑/导出 | 等待实际主机及登录；不得以 CI mock 验证替代 |

## 决策

- 用户指定 newapi_channel_conn，Base URL https://newapi.ai-native-lab.com/v1。认证目录返回 33 项，初始 `ppt应用测试` 不在目录且生成 503；用户随后明确选择 `deepseek-v4-flash`，探针成功返回 `deepseek-v4-flash-0731`，已更新 provider 默认模型。
- 不把 key 写入源文件、聊天、日志或 PPT project。沿用 Electron safeStorage/AES-GCM 凭证库。
- 撤销每次启动删除 OpenAI-compatible 配置的旧迁移；新增正确协议的设置入口/探针，不伪装成 Anthropic。
- 本地 key 的 PPT 请求采用按账号隔离的模型工作队列：沙箱生成 prompt 与验证结果；客户端从同一账号领取工作，在 Next 服务端读取已加密的 provider，向指定模型调用；renderer 只传 job ID，不获得 key。
- 托管模型继续原调用链。BYOK 需要客户端 PPT 页面保持打开；沙箱不接收真 key。工作有领取令牌、超时和限量；不得接受 renderer 自由传入 prompt 或 Base URL。
- 模型列表允许手动模型 ID 与 /v1/models 的授权结果；不承诺一个 key 能访问所有厂商/全部模型。
- 远端沙箱需要部署本轮队列接口后才能使用 BYOK PPT；本机代码完成不能替代部署与真实调用验收。
- 本机无可用 Electron 二进制，使用 macOS Keychain 保护独立开发 profile 的 AES-GCM 主密钥；不迁移或覆盖安装包配置。连接探针因 reasoning 消耗预算调整为128 tokens/60秒，仍要求可见文本才成功。

实现说明与部署检查见 `docs/handover/ppt-byok-api-setup.md`。

## 2026-10-09 部署与 CI 执行决策

- GitHub 仓库为 CmftAiLabs/LabCodepilot，只有 build.yml。用户授权实施并使用 gh 测试；本地当前 codex/ppt-structured-artifact 尚不存在远端，保留原工作区及全部此前修改。
- macOS 专项任务沿用既有 workflow_dispatch，新增 ppt 输入；不发布安装包或 release。runner 运行时强制 Darwin/arm64，报告实际 CPU，不把 arm64 标签当作特定 M1 硬件证据。
- capability 明确协议版本及客户端 worker 要求；单靠 model-jobs 返回200不能证明客户端/服务端契约相容。
- 部署包从 git tracked 加入新服务源码生成；不打包 .env、node_modules、输出、密钥或本机开发配置。原部署 install.sh 未复制 scripts 和根目录测试 helper，部署自检不完整；生产核心渲染代码位于 lib。完整源包同时保留这些验收依赖。
- 本机 cowork-prod 不可解析，两套本地profile没有远端URL/token或登录。继续本地和CI准备，实际部署不能猜主机、伪造账号或关闭认证。

## 验收

配置重启保留；正确 Bearer + /chat/completions；不因列表失败清除手工 ID；模型 selector 更新；队列跨账号隔离、领取并发/重放/超时；本地执行不读 renderer 凭证；旧托管链路不变。单元/typecheck、PPT selftests、真实设置 UI。真 key 输入前只用 mock API，不消费实际额度。

## 2026-10-09 个人仓库推送

- 用户明确要求先推送到 Katherine516；目的仓库为个人私有 `Katherine516/LabCodepilot`，测试分支 `codex/ppt-byok-arm64-validation`。保留 CmftAiLabs 的 origin，不推送组织仓库，不合并或发布。
- 本地仓库目录已由 `LabCodepilot-para` 移至 `LabCodepilot`，Git HEAD 和本轮源码改动保持一致。
- 提交范围为 PPT 确定性基础、BYOK/API 设置、协议预检、部署/CI源码、文档和测试。未跟踪的历史输出、node_modules、缓存、审计日志与本地凭证不提交。
- 本次先完成推送；GitHub arm64 CI、实际部署及真实整稿验收仍分别待执行。

## 2026-10-09 GitHub arm64 验收结果

- 修复job级runner.temp上下文、补齐实际Office/PDF/字体环境、统一语义测试输入后，个人仓库[运行37931244082](https://github.com/Katherine516/LabCodepilot/actions/runs/37931244082)成功。
- 被测源码commit为08727be；实际Apple M1 (Virtual)/Darwin arm64，2819单元、35专项、24浏览器通过，单元1skip及历史fixture1skip明确保留；部署包187文件重新核验通过。失败轮次、根因、证据和边界详见handover/ppt-byok-deployment-ci.md。
- E3完成；E4保持待实际主机与登录，禁止用CI fixture/本地连接探针替代真实远端整稿验收。
