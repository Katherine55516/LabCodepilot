# 额度用量进度条（Usage Meter）

> 产品思考见 [docs/insights/usage-meter.md](../insights/usage-meter.md)
>
> 相关：[handover/login-system.md](./login-system.md)（账号体系 + 用户栏 UserMenu）、[handover/credential-encryption.md](./credential-encryption.md)（同一 token/apiRequest 链路）

登录后在左下角「用户栏」(UserMenu)弹出菜单里、"退出登录"上方展示当前用户在 LLM 网关的额度用量：**总/国内/国外三条「已用百分比」进度条**。对接 `GET /api/v1/usage`(文档 `文档/usage-api.md`)。

## 数据链路（主进程代理，token 不出主进程）

照搬 `auth:refresh-configs` 模式。renderer 点开菜单 → `window.electronAPI.auth.getUsage()` → IPC `auth:get-usage` → 主进程 `fetchUsage()`(`apiRequest('/api/v1/usage')`，Bearer 自动注入)→ 只把**用量数字**回传 renderer。

| 层 | 文件 | 关键 |
|----|------|------|
| 后端请求 | [electron/auth/client.ts](../../electron/auth/client.ts) `fetchUsage()` | `apiRequest<UsageInfo>('/api/v1/usage')`，空 body 抛错 |
| IPC handler | [electron/main.ts](../../electron/main.ts) `auth:get-usage` | `HttpError`→`status`(409/503)、`AuthExpiredError`→401、`NetworkError`→`kind:'network'` |
| preload | electron/preload.ts | `auth.getUsage` |
| 类型 | electron/auth/types.ts(`UsageInfo`/`UsageQuota`)+ src/types/electron.d.ts(renderer 镜像) | |
| hook | src/hooks/useAccount.ts `getUsage` | 照搬 `refreshConfigs` |
| UI | src/components/account/UserMenu.tsx | `onOpenChange` 触发、三条进度条、错误态 |
| 百分比 | src/lib/usage.ts `usedPercent`/`levelOf` | 纯函数，单测覆盖 |

## 关键设计

- **刷新时机**：仅 `<DropdownMenu onOpenChange>` open 时拉一次，不轮询；`usageLoading` 去重(同次打开不重复拉)，保留上次值避免闪烁。
- **百分比**：`usedPercent = round(used/renewal*100)`(优先服务器 `used`，缺失/NaN 用 `renewal-remaining` 兜底；`renewal<=0`→0；clamp 0–100)。**只显示百分比，不显示货币**(`quota_per_unit` 暂不用)。
- **配色**：`levelOf` 分档 normal(<75)/warning(≥75)/danger(≥90)→ design token `bg-primary`/`bg-status-warning`/`bg-destructive`(过 `lint:colors`，禁 raw 颜色)。
- **错误态**：409→未开通(联系管理员)、503→服务不可用、401/网络→无法获取；该区降级显示一行文案，不影响登出/刷新。
- **token 隔离**：renderer 只拿用量数字，Bearer 全程在主进程。

## 验证

- 单测 `src/__tests__/unit/usage.test.ts`(`usedPercent` 边界 + `levelOf` 阈值，5 例)。
- CDP(chrome-devtools MCP，dev 无登录)：`navigate_page` 用 `initScript` 注入 `window.electronAPI.auth`(含 `getUsage` mock)→ 点开用户栏验证三条进度条百分比/配色/位置/错误态、console 无报错。UserMenu 在 `!window.electronAPI?.auth` 时 `return null`。
- typecheck(root + `electron/tsconfig.json`)、`lint:colors`(Windows 下脚本 `!` 前缀报错，手动 grep 黑名单确认合规)。

## 不在范围

- 不显示货币金额、不做用量历史/趋势、不自动轮询。
