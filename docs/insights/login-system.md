# 登录账号体系 — 为什么这么做

> 技术实现见 [docs/handover/login-system.md](../handover/login-system.md)

## 解决了什么问题

CodePilot 是 BYOK（Bring Your Own Key）桌面工具：用户自己配置 API key、base_url、provider type，本地落到 `api_providers` 表。这套机制非常灵活、用户掌控力强，但有两个真实的用户痛点：

1. **新用户上手门槛高**：要先去某个上游服务商注册 → 拿 API key → 复制到 CodePilot → 配 base_url（如果不是官方）→ 选模型。10 分钟没有跑起来第一个对话很常见
2. **多设备同步麻烦**：换机器要重新配一遍；团队场景里也没法统一下发"我们公司用 X 服务"

迁移过来的这套登录体系，解决的是同一类用户的另一种使用姿势：**SaaS 托管**。注册账号 → 一次浏览器登录 → 服务端把"已配好的 provider"推下来。用户在客户端看到的就是几个能直接用的模型，不需要碰 API key。

## 为什么是并存而不是替代

最直接的选项是"把 CodePilot 改造成 SaaS 客户端"：移除手动 ProviderManager，所有 provider 都来自登录账号。这是一个明确清晰的产品方向，但我们没选它。

理由：

- **存量用户已经配好了 BYOK**：换范式会让他们的现有配置消失或失效，体验是回退
- **BYOK 是 CodePilot 的差异化优势**：相比纯 SaaS 工具，能用任何服务商、自己控制 key、能离线（本地配置缓存）是 CodePilot 区别于其他客户端的核心特性
- **企业自部署**：有用户在私有网络部署上游服务（比如自托管 Claude 兼容代理），SaaS 路径走不通
- **混合使用是真实需求**：用户可能日常用托管账号，但偶尔切到一个自己的 OpenRouter key 跑某个特殊模型

所以决策是：**两种模式并存，UI 区分但底层 provider-resolver 不区分**。技术上做到这个的关键是把 `ModelConfig` 镜像到 `api_providers` 表 + 加一个 `source='managed'/'local'` 列。下游所有读 provider 的代码不用改 — 它们看到的就是统一的 ApiProvider，只是 UI 上 managed 行不让编辑。

## 为什么独立窗 + 独立 OAuth（而不复用现有的 OpenAI OAuth）

CodePilot 已经有一套 OpenAI OAuth（针对 ChatGPT Plus/Pro 用户用 Codex API），它是 PKCE 流程、token 存 SQLite、回调端口固定 1455。一个看起来"自然"的选项是扩展它支持新的服务端。

但 **OpenAI OAuth 解决的是"用 ChatGPT 账号去访问 OpenAI 的 Codex API"**，本质上是一种 provider 的认证方式（虚拟 provider）；**新登录系统解决的是"用 CodePilot 账号去取多个 provider 的配置"**，本质上是账号管理。把它们合并会得到一个概念混乱的系统：同一个"登录"按钮可能含义不同；同一个 token store 里可能有不同生命周期的 token；UI 上很难解释"用户已登录但 Codex 还没登录"这种状态。

所以决策是**完全隔离**：
- 不同的 token 存储（OpenAI 进 settings 表，新系统进文件）
- 不同的回调端口（1455 vs 随机）
- 不同的 UI 入口（OpenAI 在 ProviderManager 卡片内，新系统在 NavRail 底部 + Settings/Account 分区）
- 不同的代码命名前缀

代价是**重复代码**（OAuth callback server / 浏览器跳转逻辑各写一遍），但概念清晰带来的可维护性收益更大。两个系统都很简短，复用产生的耦合成本会超过省下的几十行代码。

## 为什么 token 存文件而不存数据库

OpenAI OAuth 的 token 存 SQLite `settings` 表。我们这套存文件 `~/.codepilot/anlcode/session_token`。差别是：

1. **跨进程共享**：CodePilot 是 Electron（main 进程）+ Next.js standalone（utility 进程）双进程架构。文件天然两边都能读；DB 共享 better-sqlite3 实例需要复杂的进程协调
2. **bsApp 原方案**：迁移文档里就规定了文件路径和 0600 权限。直接对齐方便未来在两个项目间复用调试经验
3. **更接近 Unix 习惯**：bearer token 落到 `~/.config/app/` 类似目录是常见做法（参考 npm `.npmrc`、aws CLI 等）

代价是 Windows 上 0600 没意义（chmod 是 no-op），但文件不在公共目录、只有本机其他进程能读，与 DB token 的实际暴露面差异不大。

## 为什么启动时不强制登录

迁移文档原方案是"启动时如果没 token 就弹独立登录窗，关窗 = app.quit"。我们改成了"启动时不弹，用户主动从 UserMenu / Settings 点击登录"。

这是并存模式下的必然取舍：

- 强制登录意味着 BYOK 路径必须自带"跳过登录"出口，否则存量用户进不来
- 那么加了跳过按钮后，登录窗的强制性就名存实亡 — 仍然有 50% 用户会跳过
- 既然如此，不如默认就不弹，把入口暴露在更显眼但不打扰的位置（UserMenu 头像图标）

实际效果是新用户和老用户路径分化得很自然：
- **完全新用户**：什么都没配 → SetupCenter 弹引导 → 看到 Provider 卡片要他们配，也可以走 NavRail 的 UserMenu 登录账号
- **存量 BYOK 用户**：完全无感，UserMenu 是一个新图标在角落里，点开能登录
- **已登录用户**：UserMenu 显示头像，点开看到管理选项

## 为什么不接 `/api/v1/updates/check` 轮询

迁移文档要求 6h 轮询应用更新。我们不做。

原因：CodePilot 已经用 `electron-updater` 接 GitHub Releases。两个更新通道并存会让用户困惑（哪个版本号是真的？哪个通知是有效的？），也增加误报概率。

如果未来后端有 CodePilot 自己专属的更新分发能力（比如非官方版本、企业内部分发），再单独评估这条通道。

## 设计来源

迁移文档来自一个相邻项目 bsApp（同样是 Electron 桌面应用，相似的"账号 + 配置下发"模式）。它的方案完整、详尽、Production 验证过，所以我们的客户端代码骨架几乎一比一对齐 — 包括变量名、文件路径、错误处理矩阵。这让两个项目未来的协同维护成本最小。

唯一显著偏离的地方：
- bsApp 是单 main 进程（OAuth + token + 调上游 API 全在一个进程），CodePilot 是 main + Next.js 双进程。我们多了一层 broker.ts 做 main ↔ server 的 HTTP 通信
- bsApp 不需要兼容现有 provider 体系（它整个系统就是按托管设计的），CodePilot 要做映射层 managed-providers.ts

## 已知局限

- 服务端 endpoint 协议固定。如果 bsApp 后端后续演进（比如 `/api/v1/configs` 加新字段），CodePilot 客户端会忽略未识别字段。`managed_extra_json.raw` 保留了原始 ModelConfig，足够后续做向前兼容
- 离线场景下"我现在登录的是谁"通过 me_json 缓存 — 但当前实现没有把 me 写文件（只在内存）。重启 + 离线会丢用户信息显示（但 token 仍有效，重新联网会恢复）。后续 polish 可以加 me 落文件
- managedConfigCount 只在 sync 时更新到内存，UI 显示可能与 DB 实际行数延迟。理论上可以让 UserMenu / AccountSection 主动调 `/api/auth/managed-providers/count` 做校准，但实际影响小，没做

## 未来可能的方向

- **统一身份**：如果 OpenAI OAuth 也由同一个账号体系下发（而不是直接对接 OpenAI），那两套登录系统可以在概念上合并 — 用户只看到"登录 CodePilot 账号"一个入口
- **企业 SSO**：增加 SAML / OIDC 流派支持，让企业部署可以接现有 IDP
- **多账号切换**：当前 token 文件是单个 session_token，要加多账号需要扩展为 `accounts/{id}/session_token`
- **更细粒度的下发**：不仅下发 provider，还下发 system prompt / skills / MCP 配置等
