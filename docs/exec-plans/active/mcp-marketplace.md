# MCP 市场（一键浏览 + 安装配置外部 MCP 服务器）

> 创建时间：2026-06-23
> 最后更新：2026-06-23

对照「技能市场」（`/api/skills/marketplace/*`）做一个 MCP 市场：接入官方 MCP Registry（及兜底数据源），用户点击即可浏览、填表单、一键安装并连接外部 MCP 服务器，达到「点击即用」。

调研档案见对话内研究输出；POC 结论见项目记忆 `mcp-marketplace-poc`。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | POC：验证 server.json→MCPServerConfig 映射 + 内置二进制能拉起 | ✅ 已完成 | 脚本 `scripts/poc-mcp-marketplace.mjs`；挖出冷启动 prefetch 坑 |
| Phase 1 | MVP：搜索 / 详情 / 动态表单 / 安全确认 / prefetch 安装 / 卸载 | ✅ 已完成 | 两 tab（我的 MCP / MCP 市场），CDP 验证安装→卸载完整往返通过 |
| Phase 2 | 加固：信任分层 + 黑名单 + 危险模式扫描 + 分级摩擦（密钥落地/版本钉死已在 P1 提前做） | ✅ 已完成 | 纵深防御四层非 isSafe；CDP 三态验证；运行时预检/Glama 兜底转 Phase 2b |
| Phase 2b | 运行时预检（检测 npx/uvx/docker + 友好引导） | ✅ 已完成 | PATH 增强已存在(main.ts)无需重做；Glama 调研后暂缓（无命令字段不能一键装）；CDP 验证 |
| Phase 3 | 务实版：版本变更 rug-pull 复查（注册中心级，替代 live-TOFU）+ needs-auth UX | 🔄 进行中 | 调研后缩范围：OAuth 内置二进制已做不重造、live-TOFU 默认路径不可行 |
| Phase 4 | 可选增强：入站深链 / Smithery 托管 / mcp-scan 离线 / Docker 沙箱 / catalog 缓存同步 | 📋 待开始 | 任意顺序 |

## 决策日志

- 2026-06-23: **数据源定为「官方 Registry 为主 + Glama 兜底」**。官方 `registry.modelcontextprotocol.io/v0.1/servers` 公开免登录、返回标准 server.json（含完整安装元数据），是上游 single source of truth；Glama 无鉴权 + 40k+ 广度兜底。放弃 PulseMCP（下线/B2B 化）、mcp.so 等（无公开 API）。
- 2026-06-23: **server.json 定为内部归一化 schema**。所有数据源 adapter 都映射到它，将来换聚合器只是加 adapter。
- 2026-06-23: **安装走「直接写 `~/.claude.json`」而非 CLI/deeplink/.mcpb**。复用既有 `/api/plugins/mcp` 原子写 + `invalidateMcpCache` + `${...}` 解析链路，零新增地基。
- 2026-06-23: **POC 决定的硬约束——安装必须先 prefetch 预热包再判健康**。冷启动 `npx`/`uvx` 下载超过内置二进制健康检查超时窗（实测同配置暖缓存后 3/3 全连上），否则用户见「装好却连不上」假失败。安装流程复用技能市场 `InstallProgressDialog` 的 SSE 流式 UI 展示下载进度。
- 2026-06-23: **CORS**：官方接口无 `Access-Control-Allow-Origin`，所有 catalog 请求走 Next.js `/api` 服务端代理（与 skills/marketplace/search 同构）。
- 2026-06-23: **安全是必做项不是可选**。官方 Registry 只做命名空间验证、明确把安全扫描甩给下游（即本应用）；stdio 安装 = RCE。Phase 1 即落「安全确认屏障」，Phase 2 补黑名单/危险模式/信任分层。
- 2026-06-23: **OAuth 客户端注册 CIMD 优先、DCR 仅兜底**（依 2025-11-25 授权规范）。
- 2026-06-23: **mcp-scan 只用离线 `inspect`/`whitelist` 子命令**，绝不用默认 `scan`（会把工具描述发到美国 invariantlabs，违反「不向美国站点发数据」纪律）。
- 2026-06-23（Phase 2）: **不做 `isSafe` 二元判定**。stdio MCP = 任意代码执行，无可靠静态分析能证明无害。改为「已知恶意硬拦 + 信任分层 + 风险标记 + 知情同意」四层纵深，应用永不替用户判定「安全」，只摊开风险。
- 2026-06-23（Phase 2）: **黑名单这一版内置静态种子 JSON**（随版本更新），架构预留远程合并（后续接登录后端下发，呼应「自托管、不向美国站点发数据」与「官方 Registry 只人工下架、需自己快速止血」）。
- 2026-06-23（Phase 2）: **信任 tier 只陈述可验证来源事实**（official-reviewed 手维护白名单 / namespace-verified github|domain / community）；**不按下载量排信任**（可刷、仿冒涨得快）。Docker 签名因需 docker CLI 才能机验，本版作为 `oci-container` 信号而非自动 tier。
- 2026-06-23（Phase 2）: **风险扫描是启发式「提示」非判定**，对已映射的 command/args/env 跑纯函数；只挡显眼/懒的坏，挡不住有心人——明确写进 UI 与文档。

## Phase 3 详细设计（务实版：版本变更复查 + needs-auth UX）

> 调研结论（决定缩范围，详见决策日志）：远程 OAuth 内置二进制/SDK 已处理（MCP SDK 自带
> `client/auth.js` + `OAuthClientProvider`，`mcpServerStatus()` 报 needs-auth），重造会冲突；
> live-TOFU 不可行——SDK 的 `McpServerStatus` 只暴露 `{name,status,serverInfo,error,config}`，
> **无工具描述**，默认路径上无处哈希工具定义。故改做注册中心级的版本变更复查。

### 决策

- 2026-06-24（Phase 3）: **不自建 OAuth**。内置二进制/SDK 已完整处理远程 server OAuth（auth.js/OAuthClientProvider），`claude auth` 管 Anthropic 账号、连接时自动跑 MCP OAuth；重造冲突且本地无远程 OAuth server/无登录，端到端测不了。
- 2026-06-24（Phase 3）: **放弃 live-TOFU**。SDK `McpServerStatus` 不含工具描述，默认路径拿不到工具定义无法哈希；Native runtime（fallback，少数用户）虽能 listTools 但覆盖面小，不值得。
- 2026-06-24（Phase 3）: **改做版本变更 rug-pull 复查**（注册中心级，默认路径有效、可测）。台账记装时版本，注册中心 latest 变了就提示复查——这是 TOFU「装时干净、之后变坏」意图的可落地替代（postmark 式：clean 15 版、v16 投毒 → 新版出现即提示复查 + 新版重新过信任/黑名单）。

### 实现

- 台账已有 `version`；`mcp-market-ledger.ts` 加 `getInstalledInfo()` 返回 serverName→{key,version}。
- DTO 加 `installedVersion?` + `updateAvailable?`（注册中心 latest > 台账版本，用 mcp-denylist 的 `compareVersions`）。search 路由标记时填充。
- **更新即复查**：已装 server 的 latest 重新过 `assessMcp`（信任/黑名单），UI 卡片/详情显示「有新版本 vX→vY，更新前复查」；点更新走安装对话框（含安全屏障/风险），install 路由对已在台账的 serverName **复用同 key 覆盖**（而非去重成 key-2）。
- needs-auth UX（My MCP）：`McpServerList` 的 needs-auth 分支加清晰文案 + helper（授权由内置二进制在使用/浏览器中完成），不假装一键 OAuth。
- 单测（compareVersions 已测；新增 updateAvailable 逻辑 + 同 key 覆盖）；CDP mock 旧版台账验证「有新版本」提示。

### Phase 3 验收

mock 台账装了旧版 → 卡片/详情显示「有新版本，更新前复查」→ 点更新走安全屏障 → 覆盖同 key（不产生 key-2）；needs-auth 文案更清晰；typecheck + 单测通过；CDP 截图。

## Phase 2b 详细设计（运行时预检）

> 调研结论：**打包版 PATH 增强已存在**——`electron/main.ts` 已加载用户 shell 环境并构造 expanded
> PATH（`/opt/homebrew/bin`、`~/.local/bin`、`.npm-global/bin`、nvm 等），传给 Next 服务进程
> (line 731) 与内置二进制 (1258/1437)，`platform.ts:getExtraPathDirs()` 是现成的目录清单。
> 故 Phase 2b 不重做 PATH，只补**预检 CHECK + 友好引导**这个真正的缺口。

### 决策

- 2026-06-23（Phase 2b）: **不重造 PATH 增强**（main.ts 已做），只加运行时检测 + 引导。
- 2026-06-23（Phase 2b）: **Glama 暂缓**。实测其 API 只返回 `{name, repository.url, environmentVariablesJsonSchema, attributes}`，**无 packages/command/install 字段**，无法确定性拼出 `npx/uvx/docker` 命令 → 不能一键装，与「点击即用」核心目标冲突；官方 Registry 已有 1.5 万+ 可装 server。未来若做，只能「发现/广度 + 手动添加兜底」，不假装一键。
- 2026-06-23（Phase 2b）: **缺运行时是软警告不硬拦**。用户可能装完再补运行时；安装照写配置，仅在详情/对话框醒目提示「缺 {Node.js/uv/Docker}，连接前需先装好」+ 安装链接。

### 实现

- `src/lib/runtime-check.ts`（纯逻辑，可单测）：
  - `isCommandAvailable(command)`：解析二进制是否在 `process.env.PATH`（已 expanded）∪ `getExtraPathDirs()` 中；绝对路径直接 existsSync。
  - `checkRuntimeForConfig(config)`：由 `config.command` 映射运行时（npx/node→Node.js、uvx/uv→uv、docker→Docker、dnx→.NET），返回 `{kind, command, name, url, available}`；远程（无 command）返回 null。
- `detail` 路由响应增加 `runtime` 字段；详情组件存下并透传安装对话框。
- UI：详情 body + 安装对话框，`runtime && !runtime.available` 时显示琥珀警告 + 运行时名 + 安装链接（不禁用安装）。
- i18n 三语；`runtime-check.test.ts` 覆盖映射 + 解析逻辑。

### Phase 2b 验收

构造一个需 docker 的 server（或临时改 PATH），详情/对话框出现「缺 Docker」警告 + 链接；正常 npx server 无警告；typecheck + 单测通过；CDP 截图。

## Phase 2 详细设计（安全加固）

> 产品视角与「应用如何判断 MCP 是否安全」的讨论同对话；核心结论：**没有 `isSafe`**，是纵深防御 + 把人放回决策环。

### 纵深防御四层（+ 运行后）

| 层 | 作用 | 能否给「不安全」判定 | 落点 |
|----|------|------------------|------|
| ① 已知恶意拦截 denylist | 命中即硬拦 | ✅ 唯一高置信负判定 | `mcp-denylist.ts` + install 路由服务端强制 |
| ② 信任分层 trust tier | 陈述可验证来源事实 | ❌ 只是 provenance | `mcp-trust.ts` → DTO `trust.tier` |
| ③ 风险标记 risk scan | 危险模式启发式提示 | ❌ 提示非判定 | `mcp-trust.ts` 纯函数扫 config |
| ④ 知情同意 + 分级摩擦 | 人做最终决定 | —（决策权归人） | 复用 Phase 1 确认屏障 + friction |
| ＋运行后 工具定义 TOFU | 防装后变坏 rug-pull | 检测篡改 | Phase 3（`mcp-connection-manager` 拦 `tools/list`） |

### 数据模型（types/index.ts）

```ts
type McpTrustTier = 'official-reviewed' | 'namespace-verified' | 'community';
interface McpRiskFlag { code: string; detail: string; severity: 'warn' | 'high'; }
interface McpTrustAssessment {
  tier: McpTrustTier;
  signals: string[];                 // 'github-verified'|'domain-verified'|'has-repo'|'version-pinned'|'oci-container'
  risks: McpRiskFlag[];
  blocked: boolean; blockReason?: string;
  friction: 'normal' | 'extra-confirm' | 'blocked';
}
// MarketplaceMcpServer 增加 trust?: McpTrustAssessment
```

### 风险扫描规则（对已映射 MCPServerConfig）

- `shell-exec`(high): command 为 bash/sh/zsh/cmd/powershell + `-c`，或 args 跑脚本
- `dangerous-command`(high): `sudo` / `rm -rf` / `chmod +x` / `mkfs` / `dd`
- `network-fetch-exec`(high): `curl`/`wget` 且管道入 shell（`| sh`/`| bash`）
- `sensitive-path`(warn): `~/.ssh` `~/.aws` `~/.config` `/etc` `id_rsa`
- `unpinned-version`(warn): stdio 包无钉版本（latest/缺失）→ 可静默变更
- `no-repository`(warn): server.repository 缺失
- `secret-injected`(warn): 存在 isSecret env（把密钥交给第三方代码，信息性提示）

### friction 决策

`blocked` → 安装禁用（设置里可 override，带二次警告）；任一 `high` 风险 → `extra-confirm`（红字 + 「我已理解会运行未受信代码」勾选才解锁）；否则 `normal`。tier 只调徽章不放宽。

### Phase 2 任务拆分

| # | 任务 | 文件 | 验收 |
|---|------|------|------|
| 1 | 黑名单（种子 + 版本区间匹配 + 预留远程合并） | `src/lib/mcp-denylist.ts` | 单测 |
| 2 | 信任评估（tier + 风险扫描，纯函数） | `src/lib/mcp-trust.ts` | 单测覆盖每条规则 |
| 3 | 类型 | `src/types/index.ts` | typecheck |
| 4 | 灌进 DTO（search 批量 tier+blocked，detail 全量 risks） | search/detail 路由 | 真实数据 |
| 5 | 服务端强制拦截 | install 路由 | blocked → 422 |
| 6 | UI：卡片 tier/blocked 徽章 + 详情风险列 + 对话框分级摩擦 | 市场组件 | CDP 验证 |
| 7 | i18n 三语 | `i18n/{en,zh,zh-HK}.ts` | typecheck |

**Phase 2 验收**：denylist 命中的包卡片置灰且服务端拒装；含 high 风险的 server 安装对话框出现红字 + 强制勾选才能装；普通 server 不受影响；单测覆盖每条风险规则；CDP 截图确认。

### 诚实局限（写入 UI/文档）

命令扫描可被绕过（包跑起来想干啥干啥）；verified≠safe（postmark 是合法已验证发布者后来变坏）；下载量可刷；唯一真隔离是沙箱（Docker）。整套是「让风险可见 + 拦已知坏 + 能隔离就隔离 + 人拍板」。

## 详细设计（Phase 1）

### 核心数据流（一键安装）

```
浏览市场(官方 Registry, /api 代理)
  → 选服务器 → 拉 server.json(version=latest)
  → 生成安装表单(按 inputs 的 isRequired/isSecret/default/choices)
  → ⚠️ 安全确认屏障(展示完整 command·args·env)
  → 写入凭证(密钥→钥匙串, env/headers 仅存 ${KEY} 占位符)
  → prefetch 预热包(SSE 进度) → 写 ~/.claude.json(复用 /api/plugins/mcp) → 连接并列出工具
```

### server.json → MCPServerConfig 映射（已 POC 验证）

- 运行器兜底：`npm→npx`、`pypi→uvx`、`oci→docker`、`nuget→dnx`（`runtimeHint` 常缺失，仅作 override）。
- stdio：`command=runner`；`args=[...runtimeArguments, packageSpec(identifier@version), ...packageArguments]`；npx 自注入 `-y`。
- oci：`docker run -i --rm [-e NAME ...] <image-with-tag>`。
- 远程：`type=streamable-http→'http' / sse→'sse'`；`url`（处理 `{var}` 模板）；`headers`。
- 密钥（`isSecret`）→ `${mcp_<slug>_<NAME>}` 占位符，明文走 settings 加密列 + crypto-seal，由 `mcp-loader` spawn 时解析。

### Phase 1 任务拆分（MVP）

| # | 任务 | 文件 | 验收 |
|---|------|------|------|
| 1 | 晋升映射器 + 单测（覆盖 npm/pypi/oci/remote/remote+headers 5 类） | `src/lib/server-json-mapper.ts`、`src/__tests__/unit/server-json-mapper.test.ts` | `npm run test` 通过 |
| 2 | Registry 客户端：拉取/分页/`isLatest` 去重/归一化 DTO | `src/lib/mcp-registry-client.ts` | 单测 + 真实拉取 |
| 3 | 搜索 API（代理 + 标记已安装） | `src/app/api/plugins/mcp/marketplace/search/route.ts` | 返回 DTO，已装项打标 |
| 4 | 详情 API（version=latest，返回表单 spec） | `.../marketplace/[serverName]/route.ts` | 返回 inputs 声明 |
| 5 | 安装 API（SSE：prefetch→进度→写 `~/.claude.json`→连接） | `.../marketplace/install/route.ts` | 真实装 npm server 成功连接 |
| 6 | 前端：marketplace tab + 浏览/卡片/详情 + 安装对话框（表单 + 确认屏障 + 进度） | `McpManager.tsx`、`McpMarketplace*.tsx`、`McpInstallDialog.tsx` | CDP 截图验证 |
| 7 | 卸载：复用 `DELETE /api/plugins/mcp/[name]` + 清密钥 | 既有路由 + 小改 | 卸载干净 |
| 8 | 类型 + 三语 i18n | `src/types/index.ts`、`src/i18n/{en,zh,zh-HK}.ts` | typecheck 通过 |

**Phase 1 验收标准**：从官方 Registry 装一个真实 npm server → 看到下载进度 → `status` 显示 `connected` → 卸载干净；`npm run test` + `npm run test:smoke` 通过；CDP 截图确认 UI 渲染与无 console 报错。

### 复用的既有地基（无需新造）

- 写入真源 `~/.claude.json` + 原子写 + `invalidateMcpCache`：`src/lib/mcp-loader.ts`、`/api/plugins/mcp`。
- `${SETTING_KEY}` 密钥间接引用解析：`mcp-loader.ts`。
- 加密钥匙串：`src/lib/crypto-seal.ts`、`electron/auth/secret-key.ts`。
- 运行期连接池 + `status`(`needs-auth`)/`reconnect`/`toggle`：`mcp-connection-manager.ts` + 对应路由。
- SSE 流式安装进度 UI 范式：`src/components/skills/InstallProgressDialog.tsx`。
- registry 包裹格式解析：`McpServerEditor.tsx`。

### 依赖与节奏

```
Phase 1 (MVP, 可发布) → Phase 2 (加固) → Phase 3 (远程/OAuth)
                                       └→ Phase 4 (增强, 任意顺序)
```

### 待验证（后续 POC）

- OAuth 2.1 环回流程与内置二进制自带 OAuth/钥匙串是否冲突。
- 打包版 macOS 最小 PATH 下 npx/uvx/docker 检测 + 子进程 PATH 增强。
- uvx 的 `pkg@version` 语法是否被接受（Part A 已产出未实跑）。
- 信任分层数据来源（Docker 签名可机验；Anthropic 目录无 API → 手维护白名单）。

### 文档产出（功能完成后）

- 技术交接：`docs/handover/mcp-marketplace.md`
- 产品思考：`docs/insights/mcp-marketplace.md`
- 两份互相反链。
