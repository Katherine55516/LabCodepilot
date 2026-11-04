# PPT 自定义 API 设置与本地模型执行桥接

更新：2026-10-09。实现处于本地开发环境；真实 Factor Zoo 整稿已在本机 x64 完成原生导出，远端真实账号部署及最终 ARM64 版本尚未验收。当前默认模型与多模型验证见下方最新记录。

## 最新配置验证与默认修复

2026-10-09 本轮认证目录同步成功，33 个 ID。检查发现开发 profile 的 provider default 映射为 deepseek-v4-flash，但 global_default_model 仍为旧 ID「ppt应用测试」；两者不一致。此前明确指定 DeepSeek 的实际生成不受全局默认影响，不能由该快照把所有历史失败归因于默认模型。

按用户指定，已将 provider default 和全局 default 统一为 qwen3.8-max。未向更新接口提交新 API key，现有 enc:v1: 加密保留。createModel() 无模型参数的实际解析为 qwen3.8-max，保存后生产 PPT worker 请求返回有效三页 JSON，设置 UI 默认也显示 qwen3.8-max。

真实连接探针与 production createModel/executeDesktopModelJob 的小型 JSON 验证：qwen3.8-max、claude-opus-5-5、claude-sonnet-5-5 全部成功；gpt-6.1-sol 不在当前网关目录，精确请求 HTTP 503、worker 502，未自动换型号。三页 JSON 测试使用内存诊断队列，不是部署账号 E2E，也不证明这些新模型的长 Factor Zoo 整稿合同已通过。

配置仍为 ~/.aimate-api-development，诊断服务端口 3115；不自动迁移至已安装 Electron profile。完整讨论、逐项建议和原始安全验证记录见 [真实运行问题分析](../research/ppt-factor-zoo-live-postmortem-20261009.md)。下方各运行与测试描述保留为历史记录。

## 逐页复核后的验证更新

默认仍为 qwen3.8-max。密钥/目录认证成功不等于长大纲生成成功：Qwen 的完整六组规划仅四组成功、两组 240 秒 transport 超时；Opus/Sonnet 各自 zh、en、zh-HK 三页 schema 均成功。Sonnet 六个 Factor Zoo 来源组完整成功，本轮用于后续正式 writer/critic/export 验证，没有修改默认模型。gpt-6.1-sol 当前授权目录缺失、精确请求 503，需网关上游/组权限，未配置假别名。

模块已加入版本2短 skeleton、完整来源 ID 编译、分组 checkpoint、受控 schema/JSON fallback、安全失败分类与 candidate 下载。计划 fit、schema、实际 PowerPoint 导出和人工外观验收分开记录。三语输出策略用于标题与新增说明；绑定原始表格/代码/公式/证据保留原文，界面明确披露。详细实施与待验收项见 [问题分析](../research/ppt-factor-zoo-live-postmortem-20261009.md)，不能沿用上方或历史章节的小探针结论宣称全部模型整稿通过。

## 本次配置与诊断

- 用户提供的服务商标识：`newapi_channel_conn`；Base URL 归一为 `https://newapi.ai-native-lab.com/v1`。
- 密钥由用户在 `http://127.0.0.1:3109/settings#providers` 密码框输入并保存；没有写入源码、报告或终端参数。开发配置为独立目录 `~/.aimate-api-development`，不等同于已安装应用的配置。
- `/v1/models` 用已保存密钥认证成功，返回 33 个 ID。该目录包含 embedding、rerank 等其他任务模型，列表发现不代表所有条目适用于 PPT 文本生成，也不代表每条上游均可用。
- 初始 ID `ppt应用测试` 不在授权目录，Chat Completions 返回 HTTP 503。仅凭 503 不能证明该名称的真实用途或密钥错误；实际证据是目录认证成功、该 ID 的生成失败。
- 用户随后选择 `deepseek-v4-flash`，已保存为 provider 默认模型；连接探针成功，实际返回模型为 `deepseek-v4-flash-0731`。
- 另外通过生产 `createModel`/AI SDK 发起同样的最小请求，约 12 秒返回可见文本、`stop`；因此同时验证了连接探针和实际 SDK 的 Chat Completions 传输，不仅是原始 HTTP 可达。
- 首次 16-token/30-second 探针超时；128-token 请求约 19 秒返回，包含 reasoning 与可见文本，总 completion 为 27 tokens。探针调整为 128 tokens/60 秒，不能把消耗隐藏推理预算导致的无可见文本误判为成功。
- 只读检查确认 API key 字段使用 `enc:v1:` 加密格式；未输出字段值。保存后的设置显示名以用户在 UI 中编辑的名称为准。

## 服务商设置与传输

`src/lib/provider-catalog.ts` 恢复明确的 OpenAI-compatible preset；Settings 显示 Providers 页签。用户输入 Base URL、密钥、精确模型 ID；可同步 API 目录或手动添加 ID。同步采用 upsert，保留手工模型，不替换默认模型。列表变化发出 `provider-changed`，PPT selector 随之刷新。

`src/lib/db.ts` 撤销每次启动删除 OpenAI-compatible provider 的旧迁移。已有密钥加密层保持；编辑时空密码框表示不更新已保存密钥，测试可通过 providerId 在服务端读取密钥。

`src/lib/openai-compatible-api.ts` 将根 URL 归一到 `/v1`，已有路径保持；拒绝 userinfo、query、hash；Bearer 请求到明确 URL，拒绝重定向。连接测试使用 `/chat/completions`，发现使用 `/models`。错误只报告 HTTP 状态，不回传网关可能含密钥的响应正文。401、403、429、5xx、无文本和超时分别给出排查方向。

`src/lib/ai-provider.ts` 对普通 OpenAI-compatible 显式使用 SDK `.chat(model)`，避免 SDK 默认选择 Responses 接口；OAuth Responses、Google、Anthropic 的原传输路径保留。`runtime/registry.ts` 和 `claude-client.ts` 使非 Anthropic 协议进入 Native runtime，避免传给只支持 Anthropic 协议的 Claude Code。

一个平台密钥能选择该平台授权且兼容相应生成接口的模型；其他官方平台需要单独的 provider 和密钥。不会自动猜模型 ID、跨服务商回退或替换用户选择。

## PPT 工作流如何接入

创建方式 → 选择模型 → 模板 → 输入与要求 → 估算/大纲确认 → 生成 → 局部编辑/检查/导出，现有步骤不变。LLM gate 保持显式选择；本地模型使用 `byok:<providerId>` 引用，不把密钥放入 PPT 项目或沙箱。

1. Cowork `ppt-api.mjs` 继续构造原有 outline、writer、repair 和 review prompt，并执行原有验证。托管模型仍走原调用链。
2. 本地 provider 分支将完整 prompt 放入 `ppt-model-jobs.mjs` 瞬时队列。工作按 UID 隔离，最多 12 个/账号、1000 个全局；领取时返回随机 lease，完成必须 UID 与 lease 均一致。重复领取/完成拒绝，暂停或取消移除工作；超时五分钟。
3. PPT 页面 `usePptDesktopModelWorker` 从账号已认证的代理列出工作，最多并行三个。浏览器调用本地 `/api/ppt/model-jobs/run` 只传 job ID。
4. Next route 检查当前登录、已配发 Cowork URL/token，在服务端领取该账号工作。`ppt-desktop-model-worker.ts` 读取本机加密 provider，用所选模型调用 AI SDK，不接受 renderer 提供 prompt、URL 或密钥；仅回传结果文本和 lease。
5. 沙箱解析原有 JSON，继续归一化、内容范围检查、页面契约、媒体/渲染门禁和后续节点。模型错误不回传原始 SDK 内容；截断结果失败。模型执行上限四分钟、32768 output tokens，无自动重试，由现有 PPT 重试入口接管。

队列未持久化。服务重启时在途工作失败，项目按现有 checkpoint 恢复；未领取工作依赖 PPT 页面保持打开，离开页面停止轮询，已发出的请求继续完成。用户本地 key 模式不承诺关客户端后台生成。

## 开发环境与部署边界

macOS 启动：用 Node 22 执行 `PORT=3109 node scripts/dev-secure-api-keychain.cjs`。该脚本从系统 Keychain 读取开发主密钥，仅注入 Next 子进程内存；DB 采用现有 AES-GCM。已有 DB 而 Keychain 项不存在、Keychain 锁定或格式异常时失败，不替换主密钥或重建配置。脚本只支持 macOS；安装包继续使用现有 Electron safeStorage。

真实 PPT BYOK 需要同步部署客户端和 `apps/cowork-server` 的队列接口，并通过真实账号登录、配发沙箱。创建/解析前现已预检版本化 `/ppt/capabilities`；旧服务或协议不兼容时明确阻止操作。完成本机配置不代表服务器已部署，也不代表已安装应用自动拥有该独立开发配置。部署包、回滚脚本与 Apple Silicon CI 见 `ppt-byok-deployment-ci.md`。

## 验收与下一步

- 最后 `npm run test`：typecheck、vendor 准备通过，2818 单元测试通过、1 skip、0 fail。针对 API/worker/preset 的 96 项独立回归通过。
- `npm run test:smoke -- --workers=2`：40/41 首轮通过；模板容量重估用例在“返回模板”点击时达到 30 秒整项时限，单独原样重跑通过（29.2 秒）。没有为此修改产品逻辑或放宽断言；需保留该测试在冷启动/高负载环境中的时间稳定性观察。
- 类型检查/全量单元测试；provider 原样模型、URL、Bearer、状态分流、无文本失败；加密存储、重开 DB 保留配置；真实 AI SDK 调用本地 mock Chat Completions。
- `selftest-ppt-model-jobs.mjs` 使用生产 `defaultDeps.modelCall` 与公开 HTTP 路由验证领取、跨账号拒绝、JSON 解析、重放、暂停取消、超时/容量；既有 PPT 主工作流与原型对齐 selftests 通过。
- `ppt-byok-setup.spec.ts` 用假密钥和 API mock，在真实浏览器测试设置连接/保存/编辑、空密码框保持、目录同步/手工 ID，以及 PPT 中模型选择；CDP 截图与 console 检查。当前会话无 chrome-devtools MCP，使用 Playwright `newCDPSession` 作为实际 CDP 验证替代。截图查看通过。
- 真密钥只用于授权目录查询与所选模型最小请求，没有生成整稿。
- 待验收：部署后用真实账号跑输入→大纲→生成→局部 AI→审查→导出，验证暂停/重试、关闭页面提示、模型不可用时用户可见错误；完整 deck JSON 和复杂输出质量需单独 baseline。安装包凭证迁移/打包验收未执行。

New API 接口参考：[API 使用指南](https://docs.newapi.pro/zh/docs/guide/feature-guide/user/api)、[Chat Completions 文档](https://docs.newapi.pro/zh/docs/api/ai-model/chat/openai/createchatcompletion)。本次可用性结论来自实际已认证请求，文档不作为模型授权证据。

## Factor Zoo 真实模型 ARM64 运行诊断（2026-10-09）

用户授权私有仓库 `Katherine516/ppt-factor-zoo-live-20261009`，输入 Markdown 原文作为 prompt，Deal Review PPTX 为模板。原始模块自动估算 34 页（最终页数须由模板容量与大纲规划确定）。CI 为 macOS arm64，保留原规划、模型队列、模板导入、生成、审查和导出门禁；仅以主机 IO 适配替代 Docker，不代表真实账号部署验收。

- Run 37937054264：101041 input tokens，16384 reasoning tokens，正文为空；输出截断导致大纲失败。
- Run 37938651254：同一 deepseek-v4-flash 设置 reasoning_effort=none，100962 input tokens，16384 text tokens / 41958 字符，仍被输出上限截断。
- 本地 worker 输出上限改为 32768；真实 SDK fixture 验证传出的 max_tokens，以及截断时不提交部分正文。私有 workflow 应用该单一补丁，harness 从 worker 源码读取上限；原始 prompt、页数决策和门禁不变。完整整稿结果以该仓库后续运行报告为准，失败时不强制发布 PowerPoint。

- Run 37940354660：两次完整输出（22909 / 23660 tokens），大纲候选 30 页；9 个模板容量溢出、5 张表遗漏末行，原门禁正确阻止后续生成。浏览器最终失败页已目视检查，pageerror=0。用户随后明确授权修复大纲合同并重跑。新增表格 dataRowRange 半开区间、缺失行和原生内容矩形/字体/溢出诊断；全量单元 2819 通过、1 跳过，30 项容量审计与 prompt 合同通过。

- Runs 37942888517 / 37946083653 / 37948767757：完整输出后仍为容量失败；表格末行合同已正确，整稿修复仍不可靠。增加最多三轮局部容量分配，仅让模型重新分配原来源、表格行及内容承诺索引；代码拒绝遗漏/重复/越界，并按最终原生模板分配重测。页数不手工指定，原质量门禁继续决定是否可导出。该补丁尚待真实 CI 完整生成验收。

Run 37968706171 froze 51 pages, completed 39 content nodes and failed 12. All 119 model calls completed; no HTTP 429 occurred. Nine cached completed pages still have hard native title/slot errors. The next run restores the genuine compressed production checkpoint and verified content-addressed media, validates identical full prompt/template/model, relocates only the original template file for host IO, and calls the original POST /retry route. The module reopens only cached pages with current hard native errors; valid/accepted content remains intact. Writer corrections now expose exact selected source rows, type/count/physical-height errors and native title capacity. Both initial JSON contract correction and local copy correction are bounded; invalid or worse rewrites are rejected, final hard copy issues cannot be marked completed, and all original whole-deck/quality/export gates still apply. No deck text, page count or successful status is supplied by the harness. Local full suite: 2819 passed/1 skipped; 47 density/contract/recovery audit checks passed.

- Run 37980104821 已启动，私有执行提交 45f5785。源码补丁已验证可应用到固定 08727bea，并逐文件与本机测试代码完全相同。全量 2820 / 2819 pass / 1 skip / 0 fail；50 项审计与 prompt/evidence 专项通过。真实小范围诊断：封面、导航、CAPM 与 q 模型硬性错误为零（保留软性深度提示），只证明单页合同，不证明整稿或导出。绑定来源 ID 由模块原样编译到可见节点，不用模型翻译替代锁定原句；实际字体、容量、来源、critic、导出门禁全部保留。原始 51 页大纲不变，恢复验证为 38 页不变、13 页重试。


## 2026-10-10 实测状态补记

本次配置复核针对 `.aimate-api-development` 开发配置：global default 与 provider default 均为 `qwen3.8-max`，provider 为 OpenAI-compatible 网关，密钥仍加密保存；三个已授权模型 Qwen/Opus/Sonnet 的短请求成功，Opus/Sonnet 三语 JSON Schema 通过。GPT-6.1 Sol 不在该账户模型目录且请求返回503，不能因 Codex 账号可选该名称就认定网关有上游权限。Qwen 长稿部分超时；最新 Sonnet 51页内容全部完成，但整稿 reviewer 在240/420秒预算下仍 transport失败，不能声明整个PPT工作流通过。

逐页比较、源码改进、实际 token/字节/字符、模型能力与未完成项见 `/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/analysis.md`。模块改动位于既有 `application-local-run17` 隔离工作树，尚未合并/部署；开发配置有效不等于已安装 Electron 的另一 profile 已迁移。检查稿仅有原生文件完整性/人工复核证据，仍未获最终语义/外观批准。
