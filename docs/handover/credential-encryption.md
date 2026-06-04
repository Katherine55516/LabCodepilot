# 凭证本地加密落盘（at-rest encryption）

> 产品思考见 [docs/insights/credential-encryption.md](../insights/credential-encryption.md)
>
> 相关：[handover/login-system.md](./login-system.md)（用户体系下发 + managed providers）、[handover/builtin-claude-code.md](./builtin-claude-code.md)（内置 Claude Code 读取 env 凭证）

把 CodePilot 落盘的 API 凭证从**明文**改为 **AES-256-GCM 密文**，信任根是 Electron `safeStorage`（Windows DPAPI / macOS Keychain / Linux libsecret）。加密只覆盖磁盘持久化层，**不改任何调用方签名**——所有读函数返回明文，写函数接收明文。

## 1. 威胁模型边界

| 类别 | 能防 / 不防 |
|------|------------|
| **In scope（防）** | 偷硬盘跨机读取、同事翻 `~/.codepilot`、OneDrive 等备份同步上云、恶意软件扫盘 → 全是 `enc:v1:` 密文，密钥绑本机 OS 用户 |
| **Out of scope（不防）** | 同用户上下文恶意进程调 safeStorage、dump 进程内存、`ps` 看子进程 env、被信任 CA 的 MITM。**内存/env 明文是 SDK 拼 HTTP 请求所必需，无法避免** |

**明确保持明文（必须）**：`~/.claude.json`(mcpServers env)、`~/.claude/settings.json`、`~/.claude/.credentials` —— 由内置 Claude Code 二进制自己读取，加密会弄坏 CLI。`device_id` / `configs.hash` / `selected_config_id` 无敏感。`api_providers.base_url`（中等敏感，诊断/UI 需显示）。

## 2. 架构：safeStorage 守护一把主密钥

核心约束：**`safeStorage` 仅 Electron 主进程可用，`utilityProcess.fork()` 子进程不可用**（[electron#42869](https://github.com/electron/electron/issues/42869)）。而 SQLite 读写 + 凭证消费跑在 Next.js standalone server（utility 子进程）。所以不能让 server 直接调 safeStorage。

解法：

```
Electron 主进程  app.whenReady → initMasterKey()
  读 ~/.codepilot/secret.key.enc → safeStorage.decryptString → 32B 主密钥(内存)
  （不存在则 randomBytes(32) → safeStorage.encryptString 封存写盘，0600）
  → process.env.CLAUDE_GUI_SECRET_KEY = hex(主密钥)   // 供主进程自身模块
        │  startServer() fork 时显式注入同一 env
        ▼
Next.js server   crypto-seal.getKey() = hex→Buffer(process.env.CLAUDE_GUI_SECRET_KEY)
   db.ts 读写 api_providers / settings 时 seal()/open() 透明加解密敏感列
```

- **唯一 safeStorage 调用点**＝封存/解封那把 32 字节主密钥。其余一切（anlcode 文件 + SQLite 列）都用 AES-256-GCM + 主密钥。
- 主密钥放数据目录根 `~/.codepilot/secret.key.enc`（**不放 anlcode/**）——它要在登出/`clearAll` 清空 anlcode 后存活，且它还保护 local BYOK key。
- 无主密钥（dev `npm run dev` 无 Electron 注入、或 safeStorage 不可用）→ `getKey()` 返回 null → seal/open **透明直通明文**，行为与加密前一致。

## 3. 文件清单

| 文件 | 角色 |
|------|------|
| `src/lib/crypto-seal.ts` | **新建** 加密原语：`seal`/`open`/`isSealed`/`getKey`（server 侧，env 取 key） |
| `electron/auth/crypto-seal.ts` | **新建** 镜像（同 `paths.ts` 约定，不跨 electron/↔src/ 互引），主进程侧 |
| `electron/auth/secret-key.ts` | **新建** 主密钥生命周期：`initMasterKey`/`getMasterKeyHex`/`logSafeStorageStatus` |
| `electron/main.ts` | **改** whenReady 内 `checkNativeModuleABI()` 后调 `initMasterKey()`；fork env 注入 `CLAUDE_GUI_SECRET_KEY` |
| `electron/auth/storage.ts` | **改** Layer 1：`saveToken/loadToken/saveConfigs/loadConfigs` seal/open + 静默迁移 |
| `src/lib/db.ts` | **改** Layer 2：敏感列 seal/hydrate + settings allowlist + 迁移重封 |
| `src/lib/image-generator.ts` | **改** `pickImageProvider` 裸 SQL → `getAllProviders()`（关键绕过修复） |

## 4. 加密原语 `crypto-seal`

- 格式：`enc:v1:` + base64(iv[12] ‖ authTag[16] ‖ ciphertext)，AES-256-GCM。
- `seal(plaintext, key)`：`key` 为 null 或 `plaintext === ''` → 原样返回（空串永不加密，保留 `api_key != ''` 与脱敏判空语义）。
- `open(value, key)`：不以 `enc:v1:` 开头 → 老明文原样返回（**静默迁移探测器**）；密文 + 无 key → `''`（fail-safe）；密文 + GCM 校验失败 → `''` + 告警一次。**任何情况不把密文当明文返回**。
- `isSealed(value)`：前缀判断，供幂等重封迁移用。
- `getKey()`：读 `process.env.CLAUDE_GUI_SECRET_KEY`（64 hex），缺失/格式错 → null；仅 env 变化时重解析（测试可中途设置 env）。

明文 token（`sk-…`/`anl_…`/`ya29…`）绝不以 `enc:v1:` 开头，判别零碰撞。

## 5. Layer 1 — Electron 侧文件（`electron/auth/storage.ts`）

| 文件 | 处理 |
|------|------|
| `anlcode/session_token` | `seal`/`open`，read 静默迁移老明文、解密失败返回 null（触发重登） |
| `anlcode/configs.json` | 同上（每条含 auth_token + base_url，整体加密） |
| `anlcode/device_id` / `configs.hash` / `selected_config_id` | 保持明文 |

`clearAuthState`/`clearAll` 逻辑不变（清 anlcode/）；`secret.key.enc` 在根目录得以存活。

## 6. Layer 2 — SQLite 列加密（`src/lib/db.ts`）

**加密列**：`SENSITIVE_PROVIDER_COLS = [api_key, managed_extra_json, headers_json, env_overrides_json, extra_env]`（base_url 明文）。
**敏感 settings**：`SENSITIVE_SETTINGS = {anthropic_auth_token, openai_oauth_access_token, openai_oauth_refresh_token, openai_oauth_id_token}`。

| 方向 | 函数（咽喉点） | 处理 |
|------|--------------|------|
| 读 | `getAllProviders` / `getProvider` / `getActiveProvider` / `getProvidersBySource` | `hydrateProvider(row)` 解密敏感列 |
| 读 | `getSetting` / `getAllSettings` | 敏感 key `open()` |
| 写 | `createProvider` / `updateProvider` / `setManagedProviders` | 敏感列 `seal()` |
| 写 | `setSetting` | 敏感 key `seal()` |

**关键正确性约束**：`api_providers` 的 api_key 任何读取都必须经上述 hydrate 出口。已修复唯一绕过点 `image-generator.ts:pickImageProvider`（原裸 `SELECT ... api_key ... FROM api_providers`，列加密后会拿到密文 → 图片生成崩）。其余 `FROM api_providers` 裸 SQL 仅存在于 db.ts 内部迁移代码。

列加密天然覆盖 WAL（`codepilot.db-wal`）——写进 WAL 的就是密文，无需对 DB 文件整体加密（也避免引入 SQLCipher 原生模块）。

## 7. 迁移（幂等重封，`migrateDb` 末尾 `reSealSensitiveColumns`）

- 仅 `getKey() != null` 时执行；在 `withMigrationLock` 内（多 Next worker 并发安全）。
- 读裸列值，对每个 `if (!isSealed(v) && v !== '') update(seal(v))`。`isSealed` 守护保证**可重入、自愈半迁移、杜绝 `enc:v1:enc:v1:` 双封**。
- Layer 1 静默迁移在 read 时机会性重写：`loadToken`/`loadConfigs` 读到老明文 → 返回并重写为密文。
- 老明文库首次启动即静默升级，无需用户重登。

## 8. 数据流（启动 → 内置 Claude Code）

```
app.whenReady → initMasterKey()（解封主密钥 + 写 process.env）
  → startServer() fork（env 注入 CLAUDE_GUI_SECRET_KEY）
  → [managed 登录] electron/auth：loadToken（解密）→ getConfigs → broker POST
       → server setManagedProviders（api_key 等 seal 入库）
  → [发起对话] provider-resolver.toClaudeCodeEnv
       → getActiveProvider/getProvider（hydrate 解密 api_key）
       → env.ANTHROPIC_AUTH_TOKEN/API_KEY = 明文 api_key
       → query()（@anthropic-ai/claude-agent-sdk）子进程 env 拿明文 → 拼 HTTPS 请求
```

内置 Claude Code 完全不知下层做了加密，仍只认 `ANTHROPIC_AUTH_TOKEN` 等 env，与加密前行为一致。

## 9. fail-safe / 密钥丢失

| 场景 | 行为 |
|------|------|
| 跨机迁移 / 重装 OS / keychain 重置 | 旧 `secret.key.enc` 解封失败 → 旋转新密钥；旧密文 `open()` → `''` |
| managed 行密钥丢失 | api_key 解不出 → 空 → 重新登录自动重灌（无损） |
| **local BYOK 行密钥丢失** | **永久丢失，需用户在设置里重输**（无托管副本，既定代价） |
| Linux safeStorage 退化 `basic_text` | 密钥文件仅混淆非真加密 → 启动 WARN，不阻塞 |
| dev / 无 key | seal/open 透明直通明文，与加密前一致 |

## 10. 测试

| 测试 | 覆盖 |
|------|------|
| `src/__tests__/unit/crypto-seal.test.ts` | 往返、老明文直通、null key→''、篡改/错 key→GCM 失败→''、`isSealed`、空串短路、`getKey` env 解析（13 例） |
| `src/__tests__/unit/auth-storage.test.ts` | 新增"encryption at rest"：on-disk 密文断言、loadToken 解密、静默迁移、错 key fail-safe（4 例）；原有 keyless 用例验证直通 |
| `src/__tests__/unit/db-encryption.test.ts` | migrateDb 重封、createProvider/updateProvider/setManagedProviders on-disk 密文 + 读解密、空 key 不封、legacy 行读、settings allowlist（8 例） |

`npm run test`（typecheck + unit）通过；全量 1330 pass、0 回归（4 个失败为既有 Windows 路径分隔符问题，与本改动无关）。

**打包验证（手动，dev 无 safeStorage 拿不到真实下发数据）**：登录后查 `secret.key.enc`/`session_token.enc`/`configs.json.enc` 为密文、临时 sqlite 读 `api_providers.api_key` 为 `enc:v1:`；加 BYOK provider 重启仍可用；Provider Doctor 绿；生成一张图（验 `pickImageProvider`）；把 `.enc` 拷到另一台机器应解不开（验 DPAPI 绑定）。

## 11. 已知局限

- 主密钥与解密后凭证存在于 server/SDK 子进程 env（out-of-scope，本方案只攻"磁盘无明文"）。
- BYOK 丢钥不可逆（无 escrow）。
- Bridge 机器人 token（`weixin_accounts.token`、`channel_configs.config_json`）本次**未覆盖**，属另一类凭证，留后续迭代（同库同机制可平滑扩展）。

## 12. 下发传输加密（与本地落盘正交，2026-06）

本文档讲**落盘**加密（crypto-seal/safeStorage）。另有一层独立的**下发传输**加密：服务器把"用户体系下发配置"接口的 `auth_token` 用 AES-256-GCM 加密，客户端走 `GET /api/v1/configs/encrypted` 取回后解密。

- 对接规格：`文档/config-delivery-api.md`；密钥 = `SHA-256(口令)`，口令默认 `ZJH2026`、支持 env `ANLCODE_CONFIG_SECRET` 覆盖。密文 = `nonce(12B) ‖ ciphertext ‖ tag(16B)` base64。
- 解密实现：[`electron/auth/config-crypto.ts`](../../electron/auth/config-crypto.ts)（`decryptAuthToken` / `decryptConfigAuthTokens`）。改造点：[`getConfigs()`](../../electron/auth/client.ts) 全量 GET 改加密端点、`HttpError(503)` 退回明文版 `/api/v1/configs`、解密后下游消费明文。
- **两层正交**：下发解密 → 明文 `auth_token` → crypto-seal 再加密落盘（`configs.json.enc` / SQLite `api_key`）→ 消费时解密注入 SDK env。互不感知。
- fail-safe：单条解密失败置空（降级无凭证）；`503` 自动退明文版；网络失败仍走 `NetworkError` 缓存降级。hash/ETag 基于明文负载、两端点共用，304 协商不变。
- 测试：`src/__tests__/unit/config-crypto.test.ts`（round-trip 验证与服务器算法兼容、env 覆盖、空串、篡改抛错、单条 fail-safe，7 例）。
- 安全注意：对称口令进 bundle、逆向可提取（`SHA-256(短口令)` 未加盐，仅受控场景）；更强需服务器侧每用户密钥/加盐 KDF。`文档/config-delivery-api.md` 含明文口令，注意是否纳入 git。
