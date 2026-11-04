# 执行计划：文生图模型「账号下发」— 客户端层

> 创建时间：2026-06-30
> 最后更新：2026-06-30
> 服务端接口契约见 [image-model-managed-delivery-server.md](./image-model-managed-delivery-server.md)
> 相关历史：[text-to-image-studio.md](./text-to-image-studio.md)（文生图模块本体）、[login-system.md](./login-system.md)（账号体系）

## 背景与问题

文生图（阿里云百炼 `qwen-image-2.0-pro`）当前的 API key 走**编译期注入**：
`next.config.ts` 把 `process.env.BAILIAN_IMAGE_API_KEY` 内联进 bundle，
`src/lib/bailian-image-config.ts` 首次读取时把它作为默认值 seed 进本地
`settings.bailian_image_config`（已纳入 `SENSITIVE_SETTINGS`，AES-256-GCM 加密落盘）。

**症状**：本地用 `BAILIAN_IMAGE_API_KEY=sk-... npm run electron:pack:mac` 打的包能用；
CI（`.github/workflows/build.yml` 未注入该 env）出的官方 release 包内联值为空字符串，
`getBailianImageConfig().apiKey === ''` → `text-to-image.ts:131` 抛 `NoImageProviderError`
→ 用户看到「未配置百炼API key」，且**无任何应用内界面可自救**
（`setBailianImageConfig()` 已实现但零调用）。

## 目标

1. 把百炼图片凭证（apiKey/workspaceId/model/region）改为**登录后由账号服务端下发**，
   复用现有 managed-account 登录链路（`getBackendBase` + `apiRequest` + token），
   彻底去掉编译期 key 注入。
2. 图片**可选模型列表**也由服务端下发，文生图页的模型下拉从下发数据渲染。
3. **硬约束**：下发的图片模型只出现在**文生图页**的模型切换位置，
   **绝不**出现在对话的模型下拉框里。
4. 未登录 / 离线 / 下发失败时有清晰降级与文案（从「未配置百炼API key」改为「请登录账号」）。

## 核心架构决策

| # | 决策 | 理由 |
|---|------|------|
| **D1** | 图片配置以**单条 `settings.bailian_image_config`** 形式下发落地，**绝不写入 `api_providers` 表** | 对话下拉框数据源是 `useManagedMultimodal` → `/api/providers` 过滤 `source==='managed'`（`ModelSelectorDropdown.tsx:60,144` / `useManagedMultimodal.ts:61`）。只要图片配置不进 `api_providers`，就**从结构上**不可能泄漏到对话下拉框——无需依赖 `route.ts:84` 的 `MEDIA_PROTOCOLS` 过滤（那是脆弱的事后兜底）。这是满足目标 3 的关键。 |
| **D2** | 复刻 ASR 的「服务端下发凭据」范式，而非 managed-provider 的「列表 + DB 行」范式 | 图片是「单凭据 + 模型名」，结构上等同 ASR token（`electron/asr/token-cache.ts`），不是 provider 列表。范式更贴切、改动面更小。 |
| **D3** | 凭据下发后由**主进程经 broker 推送写入嵌入式 Next 服务的 DB**，不直接给 renderer | `text-to-image.ts` 跑在嵌入式 Next 服务（server-side），apiKey 必须到达该进程的 SQLite；主进程不直接开 better-sqlite3（ABI 锁定），沿用 `broker.ts` 的 loopback POST 模式（同 managed-providers sync）。apiKey 永不进 renderer。 |
| **D4** | 复用 `bailian_image_config` 这个 settings key 不变，`getBailianImageConfig()` / `text-to-image.ts` **几乎零改动** | 下发只是换了「谁来写这行配置」：原来是 env seed，现在是 broker sync。读取侧完全不动，回归面最小。 |
| **D5** | 文生图页「可选模型列表」由新只读路由 `GET /api/image/config` 提供（**只回模型列表 + 当前默认，绝不回 apiKey**），`ImageStudio.tsx` 的 `MODELS` 常量改为 fetch | 让模型列表也账号驱动；apiKey 不下行到 renderer。 |
| **D6** | 编译期 `BAILIAN_IMAGE_API_KEY` 注入**保留为最后兜底**（dev/自测），但下发值优先级最高 | 本地 dev 无登录体系，保留 env 兜底可继续自测；打包 release 不再依赖它。 |
| **D7** | 登出 / 401 时 purge 下发的图片配置行（同 managed-providers 的 purge 纪律） | 账号切换 / 失效后不残留上一账号的凭证。 |

## 数据流（端到端）

```
[账号服务端]  GET /api/v1/image/config/encrypted   (Bearer token)
      │        → { apiKey(密文), workspaceId, model, region, models[] }
      ▼
[Electron 主进程]  electron/auth/client.ts  fetchImageConfig()
      │   · apiRequest 注入 token（复用 http.ts）
      │   · decryptAuthToken() 解 apiKey 密文（复用 config-crypto.ts）
      │   · storage.saveImageConfig() 离线缓存（crypto-seal 落盘）
      ▼
[broker]  POST 127.0.0.1:<port> /api/auth/image-config/sync   { config }
      ▼
[嵌入式 Next 服务]  src/app/api/auth/image-config/sync/route.ts
      │   · setBailianImageConfig(config)  → settings.bailian_image_config（SENSITIVE，加密落盘）
      ▼
[文生图后端]  src/lib/text-to-image.ts  getBailianImageConfig()  ← 不变，自动拿到下发值
[文生图前端]  ImageStudio.tsx  ← GET /api/image/config 渲染模型下拉（不含 apiKey）
```

触发时机完全复用 managed configs 的现有节点（`electron/main.ts`）：
`bootAccountState`（启动/重启，每次必拉）、`postLoginSequence`（登录后）、poller 的
`onConfigsChanged`（每 10min tick，`electron/auth/poller.ts`）、`auth:refresh-configs`
（用户手动点账号面板「刷新配置」按钮，`main.ts:2156`）、`postLogoutSequence`（登出 purge）。
**不新增定时器、不新增按钮**——在已有节点里顺带拉图片配置即可。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 主进程下发链：types + client.fetchImageConfig + config-crypto 复用 + storage 离线缓存 | 📋 待开始 | 依赖服务端 Phase S1 接口可用 |
| Phase 1 | broker + 嵌入式 Next sync/purge 路由 → 写 `bailian_image_config` | 📋 待开始 | loopback-only，复刻 managed-providers/sync |
| Phase 2 | main.ts 接线：boot/login/poll/**手动刷新**/logout 五节点拉取 + 推送 + purge | 📋 待开始 | 手动刷新复用现有 `auth:refresh-configs` IPC |
| Phase 3 | 文生图前端：`/api/image/config` 只读路由 + `ImageStudio.tsx` 模型下拉改 fetch | 📋 待开始 | |
| Phase 4 | 降级与文案：未登录/离线/解密失败 → NoImageProviderError 文案改「请登录」；i18n 三语 | 📋 待开始 | |
| Phase 5 | 去编译期注入：`bailian-image-config.ts` 优先级调整，env 降为 dev 兜底；CI 不再需要 key | 📋 待开始 | |
| Phase 6 | 验证（CDP + 登录态 mock）+ 文档 + 回归 | 📋 待开始 | |

## 详细设计与触及文件

### Phase 0 — 主进程下发链

**新增** `ImageProviderConfig` 类型（`electron/auth/types.ts`）：
```ts
export interface ImageModelOption { id: string; label: string; default?: boolean; }
export interface ImageProviderConfig {
  apiKey: string;          // /encrypted 变体里为密文，解密后为 sk-...
  workspaceId: string;
  model: string;           // 默认模型
  region: string;
  models: ImageModelOption[]; // 文生图页可选列表
}
```

**新增** `fetchImageConfig()`（`electron/auth/client.ts`，紧邻 `getConfigs` / `fetchAsrToken`）：
- `apiRequest<ImageProviderConfig>('/api/v1/image/config/encrypted')`，503 回退
  `/api/v1/image/config`（明文，对齐 configs 的 encrypted→plaintext 降级）。
- 用 `decryptAuthToken(cfg.apiKey)`（`config-crypto.ts`，已存在，AES-256-GCM /
  SHA-256(口令) / `nonce‖ct‖tag` base64）解 apiKey；失败 fail-safe 置 `''` + warn，
  不 crash（复刻 `decryptConfigAuthTokens` 的容错）。
- 可选 hash 快路径 `GET /api/v1/image/config/hash`（对齐 `/configs/hash`），无则每轮全量。

**新增** 离线缓存（`electron/auth/storage.ts`，复刻 `saveConfigs/loadConfigs`）：
`saveImageConfig` / `loadImageConfig`，写 `{dataDir}/anlcode/imageConfig`，crypto-seal 密封。
网络失败时降级用缓存（同 configs 的离线策略）。

### Phase 1 — broker + 嵌入式 Next 写入路由

**新增** broker 方法（`electron/auth/broker.ts`）：
- `syncImageConfigToServer(config)` → `POST /api/auth/image-config/sync` `{ config }`
- `purgeImageConfigOnServer()` → `POST /api/auth/image-config/purge`

**新增路由**（loopback-only，复刻 `src/app/api/auth/managed-providers/sync/route.ts`
的「绑定 127.0.0.1 故不鉴权」约定）：
- `src/app/api/auth/image-config/sync/route.ts` → 校验字段后调
  `setBailianImageConfig(config)`（`bailian-image-config.ts:71`，已存在，自动 SENSITIVE 加密）。
  同时把 `models[]` 持久化（见下）。
- `src/app/api/auth/image-config/purge/route.ts` → 清空 `bailian_image_config`
  （置回空 apiKey 或删 settings 行）。

**`bailian-image-config.ts` 扩展**：`BailianImageConfig` 增 `models?: ImageModelOption[]`
字段；`getBailianImageConfig()` 读取时回填默认（保持「部分覆盖不致不可用」的现有语义）。

### Phase 2 — main.ts 接线

在 `electron/main.ts` 现有节点顺带处理（**不新增定时器**）：
- `bootAccountState`（`main.ts:910` 附近，紧跟 `getConfigs({force:true})`）：
  `const img = await fetchImageConfig(); await syncImageConfigToServer(img);`，try/catch + warn。
- `postLoginSequence`（`main.ts:933`）：同上。
- poller 的 `onConfigsChanged`（`main.ts:914-922`）：在回调里同步刷新图片配置。
- **手动刷新**：账号面板已有「刷新配置」按钮（`AccountSection.tsx:102` → `useAccount.refreshConfigs()`
  → IPC `auth:refresh-configs`，`main.ts:2156`，内部 `getConfigs({force:true})`）。在该 handler 里
  **紧跟** managed configs 刷新之后，顺带 `const img = await fetchImageConfig(); await syncImageConfigToServer(img);`，
  使同一个按钮同时刷新对话模型配置与图片配置，try/catch + warn 不阻断原刷新结果。
- `postLogoutSequence`（`main.ts:961`）：`await purgeImageConfigOnServer()`，与
  `purgeManagedProvidersOnServer()` 并列。
- 401 路径（`main.ts:2169` 附近 `tryUseCachedToken` 失效）：一并 purge。

> 触发点汇总：**启动/重启**（`bootAccountState`，每次启动必拉）、**登录后**（`postLoginSequence`）、
> **10min 轮询**（poller）、**手动点「刷新配置」按钮**（`auth:refresh-configs`）、**登出/401**（purge）。
> 满足「每次启动重新拉 + 手动刷新也重新拉」的要求；前四者均走 `fetchImageConfig` 全量（带 hash 快路径时自动免传），
> 启动与手动刷新对应 `force:true` 语义（不吃 hash 短路，确保拿到最新）。

### Phase 3 — 文生图前端模型列表账号化

**新增只读路由** `src/app/api/image/config/route.ts`：
`GET` 返回 `{ model, models }`（从 `getBailianImageConfig()` 取，**剔除 apiKey/workspaceId**）。
未配置时返回 `{ model: '', models: [] }`（前端据此显示「请登录」态）。

**改 `src/components/image-studio/ImageStudio.tsx`**：
- 删除 `MODELS` 写死常量（`:27`），改为 `useEffect` fetch `/api/image/config` 填充
  `models` state + 默认 `model`。
- 列表为空时下拉 disabled，生成按钮 disabled，提示「请登录账号以使用文生图」。
- `STUDIO_MODEL_PREFIXES`（`:31`）按下发模型 id 前缀维护（如新增非 `qwen-image` 模型时）。

> ⚠️ 反向确认：本 Phase **只**改文生图页与 `/api/image/*`，**不碰** `api_providers` /
> `/api/providers` / `useManagedMultimodal` / `ModelSelectorDropdown`。对话下拉框零改动 →
> 新图片模型不可能泄漏进对话（满足目标 3）。

### Phase 4 — 降级与文案

- `NoImageProviderError` 默认文案（`text-to-image.ts:77`）按登录态区分：
  未登录 → 「请登录账号以使用文生图」；已登录但下发为空 → 「图片服务暂不可用，请稍后重试」。
- `/api/image/generate/route.ts:42` 的 412 响应体携带 `reason: 'not_logged_in' | 'unavailable'`，
  前端 `ImageStudio.tsx:148` 据此渲染不同提示（含「去登录」按钮，触发 `auth:trigger-login` IPC）。
- i18n：`src/i18n/{en,zh,zh-HK}.ts` 新增 `imageStudio.loginRequired` /
  `imageStudio.unavailable`；并复核 `imageStudio.subtitle` 写死的 `qwen-image-2.0-pro`
  改为通用文案或读默认模型（`en.ts:25` / `zh.ts:22` / `zh-HK.ts:31`）。
  > zh-HK 手动加键，**勿**跑 gen-zh-hk.mjs（会回退约 40 个 HK 术语）。

### Phase 5 — 去编译期注入

- `bailian-image-config.ts:38-44`：`BAILIAN_IMAGE_DEFAULTS.apiKey` 仍读 env，
  但 `getBailianImageConfig()` 的优先级保证「下发写入的 settings 值 > env 兜底」
  （现状 settings 已优先于默认，无需改逻辑——下发写入后即覆盖；env 只在「从未下发过」时兜底）。
- `next.config.ts:47` 的 `BAILIAN_IMAGE_API_KEY` 内联**保留**（dev/自测兜底），
  但在文档与 README 注明：**release 不再依赖**，CI 无需配置该 secret。
- 验证：不带 env 打包 + 登录 → 文生图可用；不登录 → 明确「请登录」。

### Phase 6 — 验证

- `npm run test`（typecheck + unit）必过；涉及 UI 跑 `npm run test:smoke`。
- CDP 验证（`npm run dev` → `http://localhost:3000` 文生图页）：
  - 登录态用 mock（CDP 注入 fetch 拦截 `/api/image/config` 返回模拟下发数据）验证下拉渲染。
  - 未登录态验证「请登录」降级文案与禁用态。
  - **关键回归**：打开对话模型下拉框，确认**无**图片模型混入。
- 提交前关闭 dev server（端口 3000），勿全杀 node。

## 依赖与风险

- **依赖服务端 Phase S1**：`/api/v1/image/config(/encrypted|/hash)` 接口可用、apiKey 用
  与 `auth_token` 相同的 AES-256-GCM 口令加密（见服务端文档 §加密契约）。在服务端就绪前，
  客户端可用 `BACKEND_BASE` 指向 mock 服务联调。
- **风险**：apiKey 经对称口令（`ZJH2026` / `ANLCODE_CONFIG_SECRET`）加密，口令进 bundle
  可逆向提取——与现有 managed auth_token 同等强度，属受控场景可接受；更强隔离需服务端改
  每用户密钥（沿用 login-system 既有取舍，本计划不扩大范围）。
- **不向美国第三方发任何数据**：下发只走自有 `code-agent.ai-native-lab.com`，无遥测。

## 验收标准

1. 不带 `BAILIAN_IMAGE_API_KEY` 打包的包，**登录后**文生图可正常出图。
2. 同事装官方 release 包，登录后即可用（无需重新打包注入 key）。
3. 未登录时文生图页显示「请登录」并提供登录入口，不再显示「未配置百炼API key」。
4. 登出后下发凭证被 purge，再次生成提示需登录。
5. 对话模型下拉框中**不出现**任何图片模型（CDP 实测）。
6. 文生图页模型下拉由服务端下发数据渲染（改 server 返回 → 前端随之变化）。

## 决策日志

- 2026-06-30：确立 D1（settings 行下发，不进 api_providers），从结构上隔离对话下拉框，
  避免依赖 `MEDIA_PROTOCOLS` 脆弱过滤。
- 2026-06-30：选 ASR 范式（D2）而非 managed-provider 范式——图片是单凭据非列表。
- 2026-06-30：apiKey 只在主进程 + 嵌入式 Next 服务流转（D3/D5），renderer 永不接触。
