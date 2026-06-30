# 实施文档：文生图模型「账号下发」— 服务端层

> 创建时间：2026-06-30
> 最后更新：2026-06-30
> 客户端实施计划见 [image-model-managed-delivery-client.md](./image-model-managed-delivery-client.md)
> 目标读者：账号后端（`code-agent.ai-native-lab.com`）开发者

## 背景

桌面客户端的文生图（阿里云百炼 `qwen-image-2.0-pro`）凭证此前为**编译期注入**，
导致 CI 出的官方包内联值为空、用户报「未配置百炼API key」。现改为**登录后由账号服务端下发**，
复用现有 managed-account 下发链路（与 `GET /api/v1/configs` 同一套鉴权与加密体系）。

客户端侧的下发凭据范式参照已有的 **ASR token**（`POST /api/v1/asr/token`）与
**模型配置**（`GET /api/v1/configs/encrypted`）。本文档定义服务端需**新增**的接口契约。

## 客户端既有约定（服务端必须对齐）

| 项 | 值 | 来源 |
|----|----|------|
| Base URL（生产） | `https://code-agent.ai-native-lab.com` | `electron/auth/config.ts:14` |
| Base URL（dev） | `http://localhost:8080`，可被 `BACKEND_BASE` env 覆盖 | `electron/auth/config.ts:15-21` |
| 鉴权 | `Authorization: Bearer <session_token>`（登录时浏览器 OAuth 下发，客户端密封存盘） | `electron/auth/http.ts:43-46` |
| 错误语义 | 401→AuthExpired、503→降级到明文变体、≥400→HttpError、304→用缓存 | `electron/auth/http.ts:74-81` |
| 缓存协商 | 支持 `If-None-Match`/ETag → 304；可选 `/hash` 快路径 | `electron/auth/client.ts:140,164` |

## 需新增的接口

### 1. `GET /api/v1/image/config/encrypted` （主接口）

返回当前登录用户可用的百炼图片配置。**`apiKey` 字段为密文**（见下方加密契约），
其余字段明文。

**请求**
```
GET /api/v1/image/config/encrypted
Authorization: Bearer <session_token>
If-None-Match: "<hash>"        # 可选，命中则回 304
```

**响应 200**（`Content-Type: application/json`）
```jsonc
{
  "apiKey": "BASE64(nonce‖ciphertext‖tag)",   // 密文，见「加密契约」
  "workspaceId": "ws-10a6dp04so0g3te6",
  "model": "qwen-image-2.0-pro",               // 默认模型
  "region": "cn-beijing",
  "models": [                                   // 文生图页可选模型列表
    { "id": "qwen-image-2.0-pro", "label": "通义万相 2.0 Pro", "default": true }
  ]
}
```

**字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `apiKey` | string(密文) | 是 | 百炼 DashScope key（image scope，`sk-...`）。`/encrypted` 变体里为密文。**本期全局一份**，对所有登录用户返回同一个 key |
| `workspaceId` | string | 是 | 百炼工作空间 id（`ws-...`），用作端点子域 |
| `model` | string | 是 | 默认模型 id，落到文生图页的初始选中项 |
| `region` | string | 是 | DashScope MaaS region，如 `cn-beijing`（端点：`https://{workspaceId}.{region}.maas.aliyuncs.com/...`） |
| `models` | ImageModelOption[] | 是 | 文生图页下拉的可选模型；至少一项；`default:true` 的项作为默认（与顶层 `model` 一致） |

> 🔌 **字段命名兼容**：客户端 `normalizeImageConfig` 同时接受 camelCase（`apiKey`/`workspaceId`）与
> snake_case（`api_key`/`workspace_id`），两种都能连上——服务端按现有 managed API 的 snake_case 习惯返回也可。
> `model`/`region`/`models` 无下划线变体，按上表原样。`models[]` 每项 `{ id, label, default? }`。

**响应码**

| 码 | 含义 | 客户端行为 |
|----|------|-----------|
| 200 | 正常 | 解密 apiKey → 推送写入本地，渲染模型下拉 |
| 304 | 配置未变（ETag 命中） | 用本地缓存 |
| 401 | token 失效 / 未登录 | 触发重新登录；purge 本地图片配置 |
| 503 | 加密服务不可用 | 降级请求明文变体 `/api/v1/image/config`（见 §2） |

### 2. `GET /api/v1/image/config` （明文降级变体）

与 §1 结构完全相同，但 **`apiKey` 为明文**。仅当 `/encrypted` 返回 503 时由客户端调用
（对齐 `client.ts:164-177` 中 configs 的 encrypted→plaintext 降级）。生产环境应优先保证
`/encrypted` 可用；本变体作为兜底，建议受 TLS + 同源鉴权保护，并可按需关闭（返回 503）。

### 3. `GET /api/v1/image/config/hash` （可选，轮询快路径）

返回当前用户图片配置的内容哈希，供客户端轮询时先比对、命中则免全量传输
（对齐 `GET /api/v1/configs/hash`）。

**响应 200**
```json
{ "hash": "<sha256-hex>" }
```
`hash` 应在 `apiKey`（明文）/ `workspaceId` / `model` / `region` / `models` 任一变化时改变。
客户端将其与本地缓存 hash 比对，相等则跳过 §1 全量拉取。

> 若实现成本高，可暂不提供 `/hash`；客户端将退化为每轮（10 分钟）全量拉取 §1，功能不受影响。

## 加密契约（apiKey 字段）

`apiKey` 的加密**必须**与现有 `GET /api/v1/configs/encrypted` 的 `auth_token` 字段**完全一致**，
以复用客户端既有解密器 `electron/auth/config-crypto.ts:decryptAuthToken()`：

- **算法**：AES-256-GCM，无 AAD
- **密钥**：`key = SHA-256(UTF-8(口令))` → 32 字节
- **口令**：与 configs 同一口令（客户端默认 `'ZJH2026'`，可由 `ANLCODE_CONFIG_SECRET` env 覆盖；
  正式打包注入的口令需与服务端一致）
- **密文封装**：`BASE64( nonce(12B) ‖ ciphertext ‖ tag(16B) )`
- **空值约定**：apiKey 为空时**不加密**，直接回空字符串 `""`（客户端解密器对空串原样返回）

> 详见客户端注释 `electron/auth/config-crypto.ts:1-17` 与既有后端文档
> `文档/config-delivery-api.md §4`（与 configs 共用同一节）。
> 客户端单条解密失败会 fail-safe 置空 + warn，不 crash——但服务端应保证密文正确，
> 否则该用户文生图将整体无凭证。

## 凭证来源与下发策略

- **全局单份 key（本期确定方案）**：服务端只配置**一份**百炼凭证
  （apiKey + workspaceId + region），**给所有登录用户下发的内容完全相同**。
  无需按账号/套餐区分、无需 per-user 存储——所有已登录用户拿到同一份配置。
  - 实现上：可存为一份全局配置（环境变量 / 配置文件 / 单行配置表均可，服务端自行决定），
    `/api/v1/image/config(/encrypted)` 对任意合法 token 的用户返回这同一份。
  - 鉴权仍需校验 token 合法（用于「未登录→401」），但**不做** per-user 差异化。
- 图片凭证与对话模型的 managed provider 凭证**分离管理**（不同服务商、不同 scope、不同接口）。
- `models[]` 由服务端配置驱动（同样是全局一份），便于后续上线新图片模型
  （如 qwen-image 新版本）**无需客户端发版**：改服务端返回即生效（客户端文生图下拉读 `models`）。
- 未登录或 token 失效：返回 401（客户端据此提示「请登录」）。
- **配额/计费**（可选，非本期阻塞）：图片生成走 `https://{workspaceId}.{region}.maas.aliyuncs.com`
  由客户端**直连百炼**（同一份 apiKey 下发到所有端）。若后端日后需统计/限额，再评估「token 短时下发 +
  服务端代理」方案（对齐 ASR `POST /api/v1/asr/token` 的短时 token 范式）；本期先用全局长期 key 下发，
  与现有 managed auth_token 同等模型。

> 📌 **本期一句话定调**：服务端配一份固定的百炼 key，所有用户下发的都是这一份。
> 不分用户、不分套餐。后续若要按账号区分，再单独立项扩展，本计划不含。

## 与现有接口的关系

| 现有接口 | 本期是否改动 | 说明 |
|----------|--------------|------|
| `GET /api/v1/configs[/encrypted][/hash]` | **不改** | 对话模型配置，独立。图片配置**不**塞进 configs（客户端据此保证图片模型不进对话下拉框） |
| `POST /api/v1/asr/token` | 不改 | 范式参考对象 |
| `GET /api/v1/me` / `/usage` | 不改 | |

> ⚠️ **请勿**把图片模型作为一条 `ModelConfig`（configs 列表项）下发。客户端会把 configs 列表项
> 映射成 `api_providers`（`source='managed'`）并渲染进**对话**模型下拉框。图片模型必须走本文档
> 的独立 `/api/v1/image/config` 接口，才能只出现在文生图页。

## 联调与验收

1. **联调**：客户端可用 `BACKEND_BASE=http://localhost:8080`（或 mock）指向服务端联调；
   `ANLCODE_CONFIG_SECRET` 两端口令需一致。
2. **加密自测**：服务端用约定口令加密一个测试 key，客户端 `decryptAuthToken` 能解出明文
   （可用 `node` 直接调 `config-crypto.ts` 单测）。
3. **验收清单**：
   - 任意已登录用户：200 返回有效密文 apiKey + models（**所有用户同一份**），客户端登录后文生图可出图。
   - 未登录（无 token / token 失效）：401，客户端提示「请登录」。
   - `models[]` 改服务端返回 → 客户端文生图下拉随之变化（无需客户端发版）。
   - 503 时客户端能降级到 `/api/v1/image/config` 明文变体。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| S1 | 新增 `GET /api/v1/image/config(/encrypted)`，apiKey 复用 configs 加密口令 | 📋 待开始 | 客户端 Phase 0 的前置依赖 |
| S2 | 全局单份 apiKey/workspaceId/region 凭证保管（所有用户同一份，不分账号/套餐） | 📋 待开始 | |
| S3 | `models[]` 配置化（支持运行时新增图片模型） | 📋 待开始 | |
| S4 | （可选）`GET /api/v1/image/config/hash` 轮询快路径 | 📋 待开始 | 不做则客户端全量轮询，功能不受影响 |
| S5 | （可选/后续）短时 token + 服务端代理以做配额计费 | ⏸ 暂缓 | 本期用长期 key 下发，与 managed auth_token 同模型 |

## 决策日志

- 2026-06-30：图片配置独立接口下发，**不复用 configs 列表**——避免客户端把它映射成
  managed provider 渲染进对话下拉框（客户端硬约束 D1）。
- 2026-06-30：apiKey 加密复用 configs 的 `auth_token` 同一 AES-256-GCM 口令，
  客户端零新增解密代码。
- 2026-06-30：本期采用全局单份长期 key 下发——服务端配一份固定百炼凭证，所有用户下发同一份，
  不分账号/套餐；配额计费的短时 token 代理方案暂缓。
