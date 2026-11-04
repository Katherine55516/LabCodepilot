# 语音转文字输入 — 服务端实现文档（自建网关）

> 客户端实现见 [voice-input-client.md](./voice-input-client.md)
>
> 创建时间：2026-06-15 ｜ 状态：📋 待实现（百炼链路已全程实测验证）
>
> **本文是给「自建后端网关项目」（`code-agent.ai-native-lab.com`，与桌面端不在同一仓库）的独立实现说明，可脱离桌面端代码单独实施。** 桌面客户端会直连百炼传音频/收文字，服务端**只需新增一个接口：把真 key 换成短时临时 token 下发给已登录用户**。服务端**不经手任何音频**。

---

## 0. 背景与职责边界（必读）

AI Native Lab 桌面端要做"语音输入"：用户说话 → 实时转文字进输入框。识别用**阿里云百炼 `qwen3-asr-flash-realtime`**（WebSocket 实时 ASR）。

- 桌面端**直连百炼** WebSocket 传音频、收文字（音频不过你们服务器）。
- 但百炼 WS 握手要带 `Authorization: Bearer <key>`，而**真 `DASHSCOPE_API_KEY` 绝不能下发到 600+ 客户端**（会被扒出盗刷）。
- 解法（已实测可行）：百炼提供**临时鉴权 token**（用真 key 换，短时有效）。**你们要做的就是一个接口**：已登录用户来要 token → 你们用真 key 向百炼换一个 30 分钟的临时 token → 返回给客户端。客户端拿它直连百炼。

**你们要交付的全部内容 = 1 个接口 `POST /api/v1/asr/token`。** 就这一个。

```
桌面端(已登录) ──POST /api/v1/asr/token (带用户 bearer)──▶ 你们网关
                                                              │ 用真 DASHSCOPE_API_KEY
                                                              ▼
                              POST https://dashscope.aliyuncs.com/api/v1/tokens?expire_in_seconds=1800
                                                              │
                              ◀── {"token":"st-...","expires_at":<unix秒>} ──┘
桌面端 ◀── {"token":"st-...","expiresAt":<unix秒>} ── 你们网关
   │
   └─ 之后桌面端用这个 st- token 直连 wss://dashscope.aliyuncs.com/...（与你们无关）
```

---

## 1. 接口契约 `POST /api/v1/asr/token`

| 项 | 内容 |
|---|---|
| **Method / Path** | `POST /api/v1/asr/token` |
| **鉴权** | 复用现有用户体系：`Authorization: Bearer <用户 session token>`（与 `/api/v1/usage`、`/api/v1/me` 等同一套中间件）。未登录/失效 → `401` |
| **请求体** | 空（`{}` 或无）。预留可选 `{"ttl": <秒>}`，但**默认且建议固定 1800**，不开放客户端任意指定（防滥用） |
| **成功响应 200** | `{ "token": "st-xxx", "expiresAt": 1781512345, "model": "qwen3-asr-flash-realtime-2026-02-10", "wsUrl": "wss://dashscope.aliyuncs.com/api-ws/v1/realtime" }` |
| **`token`** | 百炼临时 token（`st-` 前缀字符串），原样透传 |
| **`expiresAt`** | **unix 秒**时间戳（绝对过期时刻）。把百炼返回的 `expires_at` 原样改名为 `expiresAt` 返回 |
| **`model`** | 百炼模型名，从**服务端配置**读取下发（客户端不硬编码——换模型不用发版客户端） |
| **`wsUrl`** | 百炼 realtime WS 基址（不含 query），从服务端配置读取下发。客户端连接时拼成 `${wsUrl}?model=${model}` |

**错误响应（建议带 HTTP status，便于客户端区分）：**
| status | 含义 | body 示例 |
|---|---|---|
| `401` | 用户未登录/token 失效 | `{ "error": "unauthorized" }` |
| `403` / `409` | 用户无该功能权限 / 配额用尽（可选，见 §4） | `{ "error": "quota_exceeded" }` |
| `429` | 触发本接口限流 | `{ "error": "rate_limited" }` |
| `502` / `503` | 百炼换 token 失败（上游错误） | `{ "error": "upstream_error", "detail": "..." }` |

> 客户端会缓存这个 token 到"距过期 <120s"才再来要，所以正常情况下**每个活跃用户约 30 分钟才请求一次本接口**，QPS 极低。

---

## 2. 内部实现：向百炼换 token

### 2.1 百炼换 token 接口（实测确认）

| 项 | 值 |
|---|---|
| **URL** | `POST https://dashscope.aliyuncs.com/api/v1/tokens?expire_in_seconds=1800` |
| **Header** | `Authorization: Bearer ${DASHSCOPE_API_KEY}`、`Content-Type: application/json` |
| **Body** | 无需 body |
| **响应 200** | `{"token":"st-3f35903e...","expires_at":1781511824}` |

### 2.2 ⚠️ 致命坑：TTL 参数必须放 query string，放 body 会被忽略

实测对照（同一 key 连续请求，记录实际拿到的 TTL）：

| 写法 | 实际 TTL |
|---|---|
| **`?expire_in_seconds=1800`（query string）** | ✅ **1800s（满 30 分钟）** |
| body `{"expire_in_seconds":1800}` | ❌ 60s（被忽略，走默认） |
| body `{"expires_in":1800}` / `{"ttl":1800}` / `{"duration":1800}` | ❌ 60s |

**结论：TTL 一定要拼在 URL query 里**，否则只会拿到 60 秒 token，导致客户端每分钟都来换、服务器开销暴增。`expire_in_seconds` 取值范围 `[1, 1800]`，默认 60，**用 1800**。

### 2.3 参考实现（Node.js / Express —— 按你们实际技术栈改写）

> 这是参照实现，核心是那一个 `fetch`。你们若是 Go / Java，照 §1 契约 + §2.1/2.2 的百炼调用等价实现即可。

```js
// 假设已有：authMiddleware（校验用户 bearer，挂 req.user）、限流中间件
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY; // 真 key，仅服务端持有
const DASHSCOPE_TOKEN_URL = 'https://dashscope.aliyuncs.com/api/v1/tokens';
const ASR_TOKEN_TTL = 1800; // 秒；务必走 query string
// 下发给客户端的模型名 + WS 地址（客户端不硬编码；换模型/区域只改这里、不发版客户端）
const ASR_MODEL = process.env.ASR_MODEL || 'qwen3-asr-flash-realtime-2026-02-10';
const ASR_WS_URL = process.env.ASR_WS_URL || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';

app.post('/api/v1/asr/token', authMiddleware, rateLimit, async (req, res) => {
  try {
    // （可选）配额校验：超额返回 403/409，见 §4
    // if (await isOverQuota(req.user.id)) return res.status(409).json({ error: 'quota_exceeded' });

    const url = `${DASHSCOPE_TOKEN_URL}?expire_in_seconds=${ASR_TOKEN_TTL}`; // ★ query string
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('[asr-token] dashscope failed', upstream.status, detail);
      return res.status(502).json({ error: 'upstream_error' }); // 不要把上游细节/key 透给客户端
    }

    const data = await upstream.json(); // { token: "st-...", expires_at: <unix秒> }
    if (!data?.token) return res.status(502).json({ error: 'upstream_error' });

    // 审计日志：只记 userId + 过期时刻，绝不记 token
    // logAsrMint(req.user.id, data.expires_at);

    return res.json({
      token: data.token,
      expiresAt: data.expires_at,
      model: ASR_MODEL,   // ← 下发模型名（客户端不硬编码）
      wsUrl: ASR_WS_URL,  // ← 下发 WS 地址
    });
  } catch (e) {
    console.error('[asr-token] error', e);
    return res.status(503).json({ error: 'upstream_error' });
  }
});
```

---

## 3. 配置

| 配置 | 说明 |
|---|---|
| `DASHSCOPE_API_KEY` | 百炼真 key（`sk-` 前缀）。**仅服务端环境变量**，绝不进代码库/日志/响应 |
| 区域端点 | 默认**北京**：`dashscope.aliyuncs.com`。若百炼账号是**新加坡(国际)**区，换 token URL 用 `dashscope-intl.aliyuncs.com`，并把下面的 `ASR_WS_URL` 也改成国际区 —— 因 wsUrl 由服务端下发，客户端自动跟随，**无需单独通知客户端** |
| TTL | `1800`（秒），见 §2.2 |
| `ASR_MODEL` | 百炼模型名（默认 `qwen3-asr-flash-realtime-2026-02-10`），**随响应下发给客户端**。换模型只改这里，客户端无需发版 |
| `ASR_WS_URL` | 百炼 realtime WS 基址（默认 `wss://dashscope.aliyuncs.com/api-ws/v1/realtime`），**随响应下发**。换区域只改这里 |

---

## 4. 配额 / 防滥用（建议）

因为客户端缓存 token、30 分钟才来一次，本接口本身 QPS 很低，但仍建议：

- **接口限流**：每用户对本接口限流（如 ≤10 次/分钟）即可，防异常刷。
- **配额校验（可选）**：若要控成本，在换 token 前查用户当日语音用量/套餐，超额返回 `409 quota_exceeded`，客户端会提示用户。
  - 注意：由于客户端缓存 30 分钟，配额是"发 token 时"这个粒度，不是逐句计量。要精确计量需用百炼用量/账单 API，本接口拿不到逐句时长。
- **TTL 取舍**：1800s 省服务器调用，但一个 token 泄露后最多可用 30 分钟做"音频→文字"（无敏感数据、且受百炼账号级限流）。本场景低敏感，1800s 可接受；要更保守可调短（如 300s，客户端会自动更频繁地来换）。
- **审计**：记录 `userId + 时间 + expiresAt`，**绝不记 token 本身**。

---

## 5. 与客户端的接口约定（联调对齐项）

客户端（桌面端）拿到 `{token, expiresAt, model, wsUrl}` 后会：
1. 缓存到内存（含 model/wsUrl），距 `expiresAt` <120s 才再来要新的（所以 `expiresAt` 必须是**绝对 unix 秒**，不是相对秒）。
2. 用下发的配置直连：`${wsUrl}?model=${model}`，握手头 `Authorization: Bearer <token>` + `OpenAI-Beta: realtime=v1`。**客户端不硬编码模型名/WS 地址，完全用你下发的。**
3. 若 WS 握手返回 401（token 边界过期），客户端会丢弃缓存、再调一次本接口换新、重试一次。
4. 若响应缺 `model` 或 `wsUrl`，客户端会直接报错（要求服务端必须下发这两项）。

**需要你们和客户端对齐的两件事：**
- **必须下发 `model` + `wsUrl`**：客户端已去掉硬编码、靠这两个字段连接。区域切换只改服务端的 `ASR_WS_URL`，客户端自动跟随、无需通知。
- **`expiresAt` 单位**：unix **秒**（百炼 `expires_at` 原样）。务必不要改成毫秒。

---

## 6. 自测（curl）

换 token 并核验真能拿到 30 分钟（部署后用你们网关地址替换，先用真 key 直测百炼确认链路）：

```bash
# ① 直测百炼（确认 key 有效 + query string 写法拿到 1800s）
curl -s -X POST "https://dashscope.aliyuncs.com/api/v1/tokens?expire_in_seconds=1800" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" | python3 -c \
  'import sys,json,time;d=json.load(sys.stdin);print("ttl=",d["expires_at"]-int(time.time()),"token=",d["token"][:12]+"...")'
# 期望输出 ttl≈1800

# ② 测你们的网关接口（带用户登录 bearer）
curl -s -X POST "https://code-agent.ai-native-lab.com/api/v1/asr/token" \
  -H "Authorization: Bearer <用户登录token>" | jq .
# 期望 {"token":"st-...","expiresAt":<unix秒>,"model":"qwen3-asr-flash-realtime-...","wsUrl":"wss://dashscope.aliyuncs.com/api-ws/v1/realtime"}
```

> 进阶（可选）端到端验证：用 ① 拿到的 token，按 §5 的 WS 地址 + header 连百炼、发 `session.update` 再推 PCM，能收到 `conversation.item.input_audio_transcription.completed`。该流程桌面端已实测通过，服务端无需实现，仅供联调参考。

---

## 7. 验收清单

- [ ] `POST /api/v1/asr/token` 上线，复用现有用户鉴权中间件（未登录 401）。
- [ ] 换 token 用 **query string** `?expire_in_seconds=1800`，实测返回 `expiresAt - now ≈ 1800`。
- [ ] 响应包含 `model` + `wsUrl`（从服务端配置读取下发；客户端不硬编码，缺这两项客户端会报错）。
- [ ] 真 `DASHSCOPE_API_KEY` 仅在服务端环境变量；响应/日志中无 key、无 token 明文。
- [ ] 上游失败映射为 502/503，不泄漏上游细节。
- [ ] （可选）接口限流 + 配额校验 + 审计日志（userId/时间/expiresAt）。
- [ ] 与客户端对齐：区域端点一致、`expiresAt` 为 unix 秒。
