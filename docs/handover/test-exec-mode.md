# 测试执行方式（独立窗口可见 / 后台无头）+ 执行前确认弹窗

> 产品思考见 [docs/insights/test-exec-mode.md](../insights/test-exec-mode.md)

测试工作台「测试执行」节点新增**执行方式**选择：`独立窗口可见运行`（有头，弹出真实浏览器窗口）
与 `后台无头运行`（无头，默认、更快）。选择经由一个**执行前确认被测链接**弹窗收口——同时让
用户确认/改写被测前端地址、测试其可达性，再选模式开跑。

这是把 `vendor/ailab-source` 原框架 runner.js 早已支持、但桌面应用执行路由一直**写死
`--headless`** 而未暴露的能力补回来（规则文档 `src/lib/test/rules/test-execution.md §0.4
选执行模式` 早有定义）。

## 数据流

```
详情卡「运行/重跑」(focusStep==='execution')
  → setModal('execConfirm')
  → ExecConfirmModal（被测链接 / 执行方式 / 测试连接）
      └─「测试连接」→ POST /api/test/probe { url } → { reachable, status, latencyMs }
      └─「测试并执行」→ runExecutionConfirmed(baseUrl, headed)
            ├─ persistExecMode(visible|headless)   // localStorage: codepilot:test-exec-mode
            └─ runStep('execution', { headed, baseUrl })
                  → POST /api/test/run { ..., headed, baseUrl }
                        → baseUrl = overrideUrl || resolved.frontendBaseUrl   // 用户显式地址最高优先级
                        → buildPlaywrightMcp(proj, evid, storageState, { headed })
```

**非弹窗触发**（顶部「运行任务」全流水线、cases→execution 的 auto-chain 接力）**不弹窗**，
复用上次选择（`execModeRef`，默认 headless），不打断流水线、零回归。

## 关键设计：有头模式的浏览器二进制矩阵

`--browser` **始终 `chromium`**；差异只在 `--executable-path` 指谁 + 是否 `--headless`：

| | 无头（默认） | 有头（可见窗口） |
|---|---|---|
| **dev 态**（无 `AILAB_RESOURCES_PATH`） | 无 `--executable-path` + `--headless`（本机完整 chromium 无头） | 无 `--executable-path`，省略 `--headless`（本机完整 chromium 弹窗） |
| **打包态**（随包 `chrome-headless-shell`） | `--executable-path <随包 shell>` + `--headless` + `PLAYWRIGHT_BROWSERS_PATH` | **定位到系统/自定义 Chrome** → `--executable-path <Chrome>`，省略 `--headless`；**定位不到** → **自动回落无头**（= 无头那格 + 一条「已改无头」提示帧） |

**为什么打包态有头要靠系统 Chrome**：`scripts/bundle-chromium.mjs` 随包只装
`chromium_headless_shell`（仅无头，无法 headed），且**不**随包完整 chromium。所以打包态要弹真实
窗口，只能用系统已装的完整 Chrome。

**为什么直指 `--executable-path` 而不用 `--browser chrome` channel**：playwright-core 的 `chrome`
channel 只认**写死的标准安装路径**（mac `/Applications/Google Chrome.app/...`、Linux
`/opt/google/chrome/chrome`、Win `…\Google\Chrome\Application\chrome.exe`）——Linux 的
snap/flatpak/自定义前缀一律找不到，会在 MCP 子进程里抛 `Chromium distribution 'chrome' is not
found` 把整轮执行打崩。改为先用 `resolveSystemChrome()` 自己定位、再 `--executable-path` 直指，
既能 honor 自定义安装、又能**定位不到时自动回落无头**而不是崩。

**`resolveSystemChrome()` 解析顺序**：① `AILAB_CHROME_PATH` 环境变量覆盖（自定义安装 / 测试桩；
设为空或 `none` = 显式判定无 Chrome）→ ② 各平台标准路径。`willRunHeaded(headed)` 用同一逻辑预判
本次是否真有头，供路由决定要不要补「已改无头」提示。

`buildPlaywrightMcp` 内的判定：
- `systemChrome = headed && headlessShell ? resolveSystemChrome() : null`
- `effectiveHeaded = headed && (!headlessShell || !!systemChrome)` → 打包态有头但没 Chrome ⇒ false（回落）
- `executablePath = effectiveHeaded ? systemChrome : headlessShell`（dev 两态均为 null）
- `--headless` 仅在 `!effectiveHeaded` 时加；`PLAYWRIGHT_BROWSERS_PATH` 仅「无头 + 用随包 shell」时注入

## API 合同

### `POST /api/test/run`（新增两个可选字段）
- `headed?: boolean` — `true`=有头。**仅「测试执行」步生效**（只有它注入 Playwright），其它步忽略。
- `baseUrl?: string` — 用户在弹窗确认/改写的被测链接。**显式给出时对本次运行最高优先级**
  （`overrideUrl || resolved.frontendBaseUrl`）。缺省回落 `environments.json` 解析值，
  其它步不传 → 行为不变。

### `POST /api/test/probe`（新增路由）
被测链接探活，服务端发起（避开浏览器端跨源限制）。探活本体在 `@/lib/test/probe`（`probeUrl`）。
- 入参 `{ url: string }`；只允许 `http/https`，否则 `{ reachable:false, error }`。
- 出参 `{ ok, reachable, status?, latencyMs?, error? }`。**任意 HTTP 响应（含 4xx/5xx）都算可达**
  ——服务在监听、握手成功即不该白跑一整轮（对齐执行规则 §0.3）。超时 6s → `reachable:false, error:'timeout'`。

### 执行步「可达性闸门」（防被测系统没起时 AI 无限 curl 探活）
`POST /api/test/run` 在 `step==='execution'` 且被测地址为 `http/https` 时，开跑前先用
`probeUrlWithRetry(baseUrl, { attempts:3, timeoutMs:5000, delayMs:800 })` 探活：
- **可达**（任一次成功）→ 正常进入执行（注入 Playwright + `streamClaude`）。
- **连续 3 次仍不可达** → **不启动 AI**，直接返回 `503 { error: '被测系统无法访问：已连续尝试 3 次…请检查…后再点「重跑」重试。' }`。
  前端 `runStep` 的 `!res.ok` 分支把它渲染成错误气泡并把该步标「失败」，用户排查好被测系统再「重跑」。
- 根因：此前无代码级探活闸门 + `bypassPermissions:true`，被测系统没起时 AI 会按规则 §0.3
  反复 `Bash("curl … %{http_code} … ")` 探活、**永不终止**（用户反馈的缺陷）。闸门 + §0.3
  的「探活 3 次上限」+ 执行 prompt 的「平台已探活、勿再反复探活」三处联防。
- 未配置地址 / 非 `http(s)` 地址不在此拦，仍交由 AI 按「地址不可达→blocked」处理（行为不变）。

### 执行步「非交互 + 登录墙」处置（防 AI 调 `AskUserQuestion` 卡死）
现象：被测系统跳转企业 SSO 登录页，AI 判断需要登录 → 调 `AskUserQuestion` 向用户要凭证。
但本步是**非交互 SSE 流**（`bypassPermissions:true`，无应答通道），问题弹不出来、执行**卡死**在
「→ AskUserQuestion」。
- 根因：框架规则 §0.1/§0.2 原文要求用 `AskUserQuestion` 选环境 / 补配置（交互式流程），移植到
  非交互执行步后成了「问了没人答」。执行 prompt 此前也未禁用提问。
- 修复（**纯 prompt/规则，运行时无关、不碰共享 chat 客户端**）：
  - 执行 prompt（`executionPrompt`）加**非交互横幅**：严禁 `AskUserQuestion` / 任何提问；目标环境由平台经
    `环境：${env}` 指定，不反问。
  - 执行 prompt 加**登录态处理块**：`buildStep` 新增 `hasLoginState`（由 run 路由按
    `!!resolved.storageStatePath` 传入）。遇登录页 / SSO / 401 → 判 `blocked`、注明「未检测到登录态」，
    整站需登录则立即停止逐条空跑，收尾**提示用户去「设置 · 测试账号」配置 / 重新捕获登录态**（项目环境配置）。
  - 规则 `test-execution.md` §0.1/§0.2 改写：环境由平台指定、缺项不提问、一律引导去「设置 · 测试账号」。
- 为什么不在 SDK 层 `disallowedTools` 硬禁：运行时（native / SDK）由 provider/设置决定，native 无工具限制
  机制，且本 worktree 因 better-sqlite3 ABI 无法起真机验证；prompt/规则修复运行时无关、零回归面，已足够。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/lib/test/prompts.ts` | `buildPlaywrightMcp` 增 `opts?: { headed }`；按上表条件拼 `--browser`/`--executable-path`/`--headless`/`PLAYWRIGHT_BROWSERS_PATH` |
| `src/app/api/test/run/route.ts` | 读 `body.headed`；`baseUrl` 改为 `overrideUrl || resolved.frontendBaseUrl`；透传 `{ headed }` 给 `buildPlaywrightMcp`；**执行步开跑前加「可达性闸门」**（`probeUrlWithRetry` 3 次，不可达→503，不启动 AI） |
| `src/app/api/test/probe/route.ts` | **新增** 探活路由；探活本体抽到 `@/lib/test/probe`（与执行步闸门共用） |
| `src/lib/test/probe.ts` | **新增** 共享可达性探测：`probeUrl`（单次）+ `probeUrlWithRetry`（带重试，供执行步闸门） |
| `src/lib/test/prompts.ts`（执行 prompt） | 被测地址分支加提示：平台已探活、勿再反复 `curl` 探活；中途遇不可达最多探 3 次即停 |
| `src/lib/test/rules/test-execution.md`（§0.3） | 加「探活 3 次上限、禁止无限重试」；修正「引擎会自动探活」的误导注释 |
| `src/lib/test/prompts.ts`（执行 prompt + `BuildStepOptions`） | `executionPrompt` 增 `hasLoginState` 参数 + 非交互横幅（禁 `AskUserQuestion`）+ 登录墙处置块；`BuildStepOptions.hasLoginState` 透传 |
| `src/app/api/test/run/route.ts`（登录态提示） | 传 `hasLoginState = !!resolved.storageStatePath` 给 `buildStep` |
| `src/lib/test/rules/test-execution.md`（§0.1/§0.2） | 去掉 `AskUserQuestion` 强制；环境由平台指定、缺项不提问、引导去「设置 · 测试账号」 |
| `src/__tests__/unit/test-probe.test.ts` | **新增** 覆盖 `probeUrl`/`probeUrlWithRetry`（含 3 次封顶）+ 执行步 503 闸门 |
| `src/__tests__/unit/test-prompts-note.test.ts` | 加 4 例：执行 prompt 禁 `AskUserQuestion` + 登录态处置（`hasLoginState` 真/假） |
| `src/components/test/InlineTestingPanel.tsx` | `ExecMode` 类型 + `execMode`/`execModeRef`/`persistExecMode` 状态；`runStep(step, opts?)` 透传 `headed`/`baseUrl`；`handleRunFocusStep`（execution→弹窗）+ `runExecutionConfirmed`；详情卡模式 chip；`ExecConfirmModal` 组件 |
| `src/i18n/{en,zh,zh-HK}.ts` | `test.execConfirm.*` 文案（en 为类型源） |
| `src/__tests__/unit/test-playwright-mcp-headed.test.ts` | **新增** 6 例覆盖 dev/打包 × 有头/无头的旗标矩阵 |

## 持久化 & 状态

- 执行方式存 `localStorage: codepilot:test-exec-mode`（`visible|headless`，默认 `headless`），
  跨面板卸载 / 重启保留。用 `execModeRef` 给 `runStep`/auto-chain effect 读最新值，避免闭包旧值。
- 被测链接覆盖**不持久化**——是「执行前确认」的一次性语义；弹窗每次以 `envCfg.frontendBaseUrl` 预填。

## 已知限制

- **打包态有头依赖系统 Google Chrome**（随包只有 headless_shell）。未装 Chrome → 有头运行失败，
  无头不受影响。后续可在弹窗里探测 Chrome 是否可用并给提示，或随包完整 chromium（体积权衡）。
- 弹窗只在**直接运行「测试执行」节点**时出现；「运行任务」全流水线用上次选择，不二次确认。
- `probe` 不追 3xx 跳转（`redirect:'manual'`），拿到首个响应即判可达——对 SPA dev server 足够。

## 验证

- `npx tsc --noEmit` 通过（同时校验三语言 i18n 键完整）。
- `npx tsx --test src/__tests__/unit/test-playwright-mcp-headed.test.ts` 6/6 通过。
- UI 经 chrome-devtools MCP 验证弹窗渲染、模式切换、测试连接、控制台无报错。
