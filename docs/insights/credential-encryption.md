# 凭证本地加密 — 产品思考

> 技术实现见 [docs/handover/credential-encryption.md](../handover/credential-encryption.md)
>
> 相关：[insights/login-system.md](./login-system.md)（用户体系下发的 BYOK vs SaaS 托管决策）

## 解决什么用户问题

CodePilot 是多模型桌面客户端，用户的 API 凭证有两类来源：

1. **用户体系下发的 managed 凭证**——登录后公司后端下发 `ModelConfig[]`（含 `auth_token`），镜像进 `api_providers`（`source='managed'`）。这是**公司花钱买的网关额度**，泄露＝直接经济损失 + 可能波及整个团队。
2. **用户自带的 BYOK key**——用户在设置里填的 Anthropic / OpenAI / 第三方网关 key。

加密前，这些凭证以**明文**散落在 `~/.codepilot/`（SQLite + anlcode 文件）。威胁是真实且日常的：

- 同事路过翻 `%APPDATA%` / `~/.codepilot` 就能 cat 出 token；
- OneDrive / 坚果云等把用户目录自动同步上云，云端留明文；
- 误把整个数据目录打包发人、被恶意软件扫盘。

对"公司下发凭证"这条线，泄露不是用户自己担后果，而是公司和团队，所以**这是 SaaS 化登录体系必须补的一环**——下发了凭证就有义务保护好它落地后的存储。

## 为什么这样设计，而不是别的方案

### 选 safeStorage + 应用层列加密，而非 SQLCipher 全库加密

SQLCipher / better-sqlite3-multiple-ciphers 能一把锁住整个 DB 文件，看似更省心。但：

- **需要原生模块编译**。本项目铁律是零原生编译（CLAUDE.md），且 better-sqlite3 已经要靠 `after-pack.js` 重编 Electron ABI，再叠一个 cipher 原生层会显著抬高打包脆弱性和跨平台风险。
- **粒度过粗**。全库加密把聊天记录、设置、任务全锁了，但真正敏感的只有几列凭证；为保护 5 列而给整库上锁，性能与复杂度不成比例。
- **密钥还是得自己管**。SQLCipher 也需要一个 key，绕不开"key 存哪"——最终还是要 safeStorage。

应用层列加密只锁该锁的几列，零新依赖（Node 内置 `crypto` + Electron 内置 `safeStorage`），且**密文天然进 WAL**，反而比"全库加密但 WAL 配置稍有差池就漏明文"更稳。

### 选 safeStorage，而非 keytar

keytar 需要 `@electron/rebuild`、macOS 首次访问弹钥匙串授权框、维护停滞。safeStorage 是 Electron 官方内置、三平台一致、无弹窗、零新依赖。本场景是"应用整体一把凭证"，不需要 keytar 那种"按账户名管多条"的能力。这套取舍直接沿用了参考文档（bsApp 的 `claude-配置加密-迁移指南.md`）的结论。

### 一把主密钥 + AES，而非每文件直接 safeStorage

参考文档（bsApp）的世界里一切都在 Electron 主进程，可以每个文件直接 `safeStorage.encryptString`。但 CodePilot 是**双进程**：凭证的真正消费方（provider-resolver → SDK env）和 SQLite 读写都在 Next.js standalone server（`utilityProcess` 子进程），而 **safeStorage 在子进程不可用**。

于是设计成：safeStorage 只守护一把 32 字节主密钥，主进程解封后通过环境变量把 hex 传给子进程，两侧都用同一把 key 做 AES-256-GCM。这把"safeStorage 不能跨进程"的硬约束，转化成了"safeStorage 守一把 key、key 经 env 过河"的统一模型——副作用是 anlcode 文件和 SQLite 列用的是同一套 `crypto-seal`，心智负担更低，也更好测（测试设个 env 就能跑真加密）。

### 加密只覆盖磁盘，内存/env 明文是设计内的

这是最容易被误解的边界。内置 Claude Code / SDK 子进程必须拿到**明文** token 才能拼 `Authorization: Bearer`，所以内存和子进程 env 里一定有明文。本方案**只攻"磁盘上不要有明文"这一项**——这恰好覆盖了上面列举的所有日常威胁（翻盘、同步、扫盘、拷贝外发），而"内存 dump / 看子进程 env"这类进程级威胁需要改 Claude CLI 自身的凭证读取协议，不在单方面能做的范围。把边界讲清楚，比假装"全加密"更诚实。

## 用户感知

理想状态是**用户零感知**：

- 老用户升级后第一次启动，明文 token / configs / DB 列被静默迁移成密文，**不要求重新登录**。
- 平时登录、切模型、发消息，全程和以前一样——因为加密只在 db.ts / storage.ts 的存储边界，调用方签名没动。
- 唯一会"感知"的是异常路径：换了电脑 / 重装系统 / 重置钥匙串后，本机密钥失效，managed 凭证会自动重新登录拉回，BYOK key 则需要重输——这正是"凭证绑定本机、不可平移"的预期表现。

## 已知局限与未来方向

- **BYOK 丢钥不可逆**：没有 escrow / 云端备份，换机即丢。这是"凭证不出本机"的代价，可接受;若未来要做"跨设备同步 BYOK"需另设端到端加密的同步层。
- **Bridge 机器人 token 暂未覆盖**：`weixin_accounts.token`、`channel_configs.config_json` 同样明文在库，属另一类凭证，本次按用户要求聚焦"API/下发凭证"。同库同 `crypto-seal` 机制可平滑扩展，列入后续。
- **Linux 退化**：无 libsecret 时 safeStorage 退化为 `basic_text`（伪加密），启动会 WARN。当前主力是 Win/Mac；若拓 Linux 需文档要求装 `libsecret-tools`。
- **进程级威胁**：内存/env 明文不防。若未来要更强隔离，方向是改成按需 named pipe / socket 取凭证而非 env 注入——但那需要内置 Claude Code 配合，超出本期。
