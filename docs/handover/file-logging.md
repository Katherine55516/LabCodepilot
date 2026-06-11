# 主进程文件日志（file logging）

> 产品思考见 [docs/insights/file-logging.md](../insights/file-logging.md)
>
> 相关：[handover/sentry-error-reporting.md](./sentry-error-reporting.md)（匿名崩溃上报，本系统的崩溃捕获需与其 `uncaughtException` 集成共存）、[handover/provider-error-doctor.md](./provider-error-doctor.md)（`runtime-log.ts` 服务端 console 环形缓冲 + 脱敏，本系统借鉴其脱敏思路）、[handover/builtin-claude-code.md](./builtin-claude-code.md)（被记录的 Claude Code 子进程 stderr 的来源）

把**主进程 + 捆绑 Next 服务 + 渲染进程**的日志统一落盘到 `app.getPath('logs')`，写盘前对每行**脱敏密钥**。此前应用不写任何日志文件：捆绑的 Next 服务以 `utilityProcess` 运行，其 stdout/stderr 只被主进程 `console.log`，而打包版主进程没有终端接管 = 直接丢弃。结果是 Claude Code 子进程崩溃时真实退出码 / stderr 不可恢复，用户只看到 `error-classifier.ts` 的固定兜底文案「Claude Code process exited with an error」，无法定位根因。

## 1. 拓扑：为什么汇聚在主进程

```
渲染进程 (BrowserWindow)
   │  console.* → webContents 'console-message'(仅 warn/error)
   ▼
主进程 (electron/main.ts)  ←── console.* 被 logger 包裹（tee）
   ▲
   │  stdout/stderr 管道（utilityProcess.fork, stdio:'pipe'）
   │  主进程在 startServer 里 re-console.log 这些行（[server] / [server:err]）
捆绑 Next 服务 (utilityProcess)  → API 路由 / claude-client stderr / [claude-client] Stream error
```

主进程是天然的**单一汇聚点**：它本来就把服务端管道输出 re-`console.log`。因此只要在主进程**包裹 `console.*`**，就同时捕获了：(a) 主进程自身日志（启动、登录、更新、服务生命周期、IPC 错误），(b) 整个 Next 服务进程的输出（无需改服务端代码）。渲染进程则通过 `webContents.on('console-message')` 单独捕获。文件写入只在主进程一处发生，脱敏也只在这一个咽喉点做。

## 2. 模块与文件

| 文件 | 角色 |
|------|------|
| `electron/logger.ts` | 主进程文件日志器：滚动文件写入、`console.*` tee、崩溃捕获、`registerKnownSecretsFromEnv`、`openLogsFolder`/`getLogDir`、`logRendererConsole` |
| `electron/log-scrub.ts` | **纯函数**密钥脱敏 `scrubSecrets(text, knownSecrets[])`（不依赖 electron，便于单测） |
| `src/__tests__/unit/log-scrub.test.ts` | 脱敏单测（17 例：精确值 / 各形态 / 不过度脱敏） |
| `electron/main.ts` | 接线：`whenReady` 首行 `initFileLogger()`；`startServer` 内 `registerKnownSecretsFromEnv(env)` + 按完整行缓冲管道；`logs:*` IPC；`console-message` 监听 |
| `electron/preload.ts` + `src/types/electron.d.ts` | `window.electronAPI.logs.{openFolder,getPath}` |
| `src/components/settings/GeneralSection.tsx` + `src/i18n/{en,zh,zh-HK}.ts` | 设置页「打开日志目录」按钮 |

`electron/logger.ts` 被 `main.ts` import，经 `scripts/build-electron.mjs` 的 esbuild（`bundle:true`）自动打进 `dist-electron/main.js`，无需改构建配置；放在 `electron/` 顶层以匹配 `electron/tsconfig.json` 的 `include: ["*.ts", ...]` 而被 typecheck 覆盖。

## 3. 日志落盘

- **路径**：`app.getPath('logs')/main.log`
  - macOS `~/Library/Logs/AI Native Lab/`、Windows `%APPDATA%\AI Native Lab\logs\`、Linux `~/.config/AI Native Lab/logs/`（目录名取自 electron-builder `productName`）。
- **滚动**：`main.log` 满 5 MB → 重命名链 `main.log→main.1.log→…→main.4.log`，最旧丢弃；共 5 份 ≈ 25 MB 上限。`currentBytes` 仅在重命名**成功后**归零（失败则保留计数，下次写入重试滚动，避免静默超限）。
- **单行上限** 16 KB（超出截断并标记），防止一条巨型 blob 触发滚动抖动 / 评估 CPU 飙升。
- **写入用 `fs.appendFileSync`**：同步=立即落盘，保证「崩溃前的行」一定在磁盘上（这是整个功能的目的）。基准 ~0.02ms/次，常见场景不卡 UI；高吞吐批量化列为未来优化（见 §7）。
- **格式**：`<ISO 时间> [LEVEL] <脱敏后的消息>`，`LEVEL ∈ {INFO,WARN,ERROR,DEBUG,FATAL,RENDERER}`。每次启动写一行 `=== … started — pid … — platform/arch — electron/node … ===` 分隔。
- **不变量**：日志器**绝不抛异常**——所有写/滚动/脱敏路径都 `try/catch`；`console.*` tee 即使原始 `console`（如 EPIPE）抛错也照常写文件。

## 4. 密钥脱敏（两层，写盘前）

`logLine()` 对每行先 `scrubSecrets()` 再写。**只脱敏密钥，保留文件路径与 host**（诊断「binary not found」「base_url 配错」必需），并保留 40 位小写 git SHA。

1. **精确值层**：逐字替换已知密钥值（最高置信、零误伤）。来源：
   - `initFileLogger` 启动时扫 `process.env`；
   - `startServer` 调 `registerKnownSecretsFromEnv(env)`，从**注入服务端的合并 env** 收集——这一步至关重要,因为 **master key 与用户 BYOK 密钥都不在主进程 `process.env`**（master key 由 `initMasterKey` 写入、BYOK 经 `loadUserShellEnv` 注入服务端），只有合并 env 里才有。收集规则：显式名单（`CLAUDE_GUI_SECRET_KEY`/`ANTHROPIC_*`/`AWS_*`/`GEMINI_API_KEY`/…，≥8 字符）+ 名字含 `KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL` 的 env（≥12 字符）。
2. **形态层**：`Bearer …`、`authorization`/`x-api-key` 头值、`sk-`/`sk-ant-`/`anthropic-`/`key-`、`AKIA/ASIA`、`AIza`/`ya29.`/`gsk_`/`xai-`/GitHub token、URL 内嵌凭证 `://user:pass@`、`?token=`/`&api_key=` query、**40+ 混合大小写+数字的高熵 token**（base64 兜底，避开普通单词与小写 git SHA）、**48+ hex**（master key 兜底，48 而非 32 以保留 40 位 git SHA）。

**按完整行脱敏**：`startServer` 的管道处理器按 `\n` 缓冲、只在收到完整行后才 `console.log`（再被 tee 脱敏）。否则一个密钥跨两个 pipe `data` chunk 拆分会让两半都匹配不到 → 绕过脱敏。64 KB 守卫防止无换行的长行无限堆积。

## 5. 崩溃捕获 + Sentry 交互

- `process.on('uncaughtExceptionMonitor', …)` 记 `FATAL`——**故意用 monitor 变体而非 `uncaughtException`**：它不改 Node 退出语义、**不计入 `listenerCount('uncaughtException')`**。这点关键：Sentry 的 `OnUncaughtException` 集成只在该计数 `<= 2` 时弹原生崩溃框；若注册真正的 handler 会把计数顶到 3、**静默吞掉 Sentry 崩溃框**并让 app 带病存活。monitor 变体规避了这一回归。
- `process.on('unhandledRejection', …)` 记 `WARN`（Sentry 已在 warn 模式、不终止进程，故标 WARN 而非 FATAL）。

## 6. 用户入口

| IPC | preload 暴露 | 行为 |
|-----|------------|------|
| `logs:open-folder` | `window.electronAPI.logs.openFolder()` | `shell.openPath(getLogDir())`，成功返回 `''`、失败返回错误串 |
| `logs:get-path` | `window.electronAPI.logs.getPath()` | 返回日志目录绝对路径 |

两个 handler **均不接收 renderer 参数**（路径只来自 `app.getPath('logs')`），无路径注入面。`openLogsFolder` 在打开前 `mkdirSync(recursive)`，目录不存在也能打开。设置页 GeneralSection 的「打开日志目录」按钮经 `useState+useEffect` 检测 `window.electronAPI?.logs` 后才渲染（仅桌面版显示，Web dev 不显示，规避 hydration 不一致）。

## 7. 验证边界与已知局限

- **已验证**：根 + electron `tsc`、eslint、esbuild 打包（确认新逻辑进 `main.js`）、1399 单测（含 17 个脱敏单测）。脱敏这块安全关键逻辑是纯函数、单测覆盖。
- **未验证（运行时）**：「打包后在用户机器上真的写出文件」需一次打包或 `electron:dev` 实跑确认；本次只做了静态 + 单测层面的验证。
- **已知局限（待后续）**：「按请求注入 SDK 子进程」的 provider 密钥原值主进程拿不到（不在合并 env、只在每次请求时注入子进程），仅靠**形态层**兜底；若某密钥为**无前缀、非 hex、低熵**的串且出现在上游 stderr，可能漏脱敏。彻底方案是在服务端 `runtime-log.ts` 源头、用当前 provider 密钥做精确脱敏后再输出（让密钥在过管道前就消失）。
- **未做**：高吞吐路径的异步批量化（保留同步 `appendFileSync` 以换崩溃安全）；渲染进程只记 warn/error（丢弃 info/verbose 噪音）。
