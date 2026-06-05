# 自动更新（研发平台 V2）

> 产品思考见 [docs/insights/updates-v2.md](../insights/updates-v2.md)
>
> 实施过程与决策日志见 [docs/exec-plans/active/updates-v2-migration.md](../exec-plans/active/updates-v2-migration.md)

把应用内自动更新从旧的「检查 GitHub `op7418/CodePilot` Releases → 跳浏览器下载」改造为「调研发平台 **V2 接口**（带登录 Bearer）→ 拿 CDN 直链 → 客户端下载 + SHA-256 校验 + 自动安装」。复用登录体系的 `getBackendBase()` + `apiRequest()` 做认证检查，下载/安装全在 Electron 主进程。

## 架构

```
渲染层 (useUpdateChecker)              主进程 (electron/updater/*)            研发平台 V2 + CDN
─────────────────────                ──────────────────────────          ──────────────────
window.electronAPI.updater
  .checkForUpdates() ──IPC updater:check──► checkForUpdates()
                                              └ apiRequest('/api/v1/updates/v2/check'
                                                  ?platform&arch&channel&current) ──► V2 /check (Bearer)
                              ◄─push updater:status── available{version,notes,mustUpgrade} / not-available / error
  .downloadUpdate() ─IPC updater:download─► downloadUpdate()
                                              └ ensureInstaller（三层避免重下 + sha256 + 进度）──► CDN 直链
                              ◄─push updater:status── downloading{percent} → downloaded
  .quitAndInstall() ─IPC updater:install─► quitAndInstall()
                                              └ installNow（win: shell.openPath / mac: hdiutil+ditto）
                                              └ 800ms → app.quit()（before-quit killServer taskkill /T 释放锁）
  .onStatus(cb)     ◄─webContents.send('updater:status')
```

**唯一真实链路是 native（打包后的 Electron）。** 非 Electron（`next dev` / 浏览器）下 `window.electronAPI` 为空，不发起检查；dev 用 CDP 注入 mock `window.electronAPI.updater` 验证渲染逻辑。

## 模块清单（electron/updater/）

| 文件 | 职责 |
|---|---|
| `client.ts` | `checkUpdateV2(params)` / `getLatestV2()` — 经 `apiRequest`（auth/http.ts）认证 GET V2，返回 `CheckResult`。Bearer + base URL 复用登录体系，token 不出主进程。 |
| `platform.ts` | `getUpdateQueryParams()` — `process.platform`→`windows`/`darwin`、`process.arch`→`x64`/`arm64`、`channel='stable'`、`current=app.getVersion()`。仅 win-x64 / mac-arm64。 |
| `version.ts` | `parseVersion`/`compareVersions`/`isNewerVersion` — 点分数字比较（纯函数，单测 `updater-version.test.ts`）。用于 pending 复用防降级、离线兜底。 |
| `downloader.ts` | 固定文件名落 `app.getPath('temp')`、三层避免重下、sha256 三处校验、`{final}.{pid}.tmp` 原子 rename、Electron `net` 流式下载（跟随 30x + session 代理）+ 进度 + 背压；`pending-update.json` 读写（落 `getAnlcodeDir()`）。 |
| `installer.ts` | `installNow()` — dev `showItemInFolder`；win `shell.openPath`(+`cmd start` 兜底)；darwin 委托 `installer-mac`。 |
| `installer-mac.ts` | `installMac()` — 写脱离进程 bash 脚本：等父进程退出 → `hdiutil attach` → `ditto` 覆盖原 bundle → `open` + 删 DMG + 自删；失败兜底 `open DMG`；防注入拒绝 `" \` $`。 |
| `index.ts` | 编排：状态机、`pushStatus`、`checkForUpdates`/`downloadUpdate`/`quitAndInstall`、缓存复用、`loadPendingFromDisk`、`registerUpdaterIpc`/`initUpdater`/`stopUpdater`、8h 周期检查(unref)。 |

## 数据流

1. **检查**：渲染 `useUpdateChecker` 挂载即 `checkForUpdates()`（监听先注册，无竞态）；主进程 `apiRequest` V2 `/check` → `metaFromCheck` → 推 `available`(含 `mustUpgrade`) / `not-available` / `error`。8h 周期 + 设置页手动按钮也触发。
2. **下载**（check-only：仅用户点击）：`downloadUpdate()` → `ensureInstaller`：① 同名文件 sha256 命中即复用 ② 否则下到 `{final}.{pid}.tmp`、校验 sha256+size、原子 rename → `writePending` + 推 `downloading`(percent)/`downloaded`。
3. **安装**：`quitAndInstall()` → `installNow(filePath)` 拉起独立安装进程 → 成功后 `setTimeout(800) → app.quit()`；`before-quit` 的 `killServer()` 在 Windows `taskkill /T /F` 连根杀 server 进程树（含 `claude.exe` SDK 子进程），释放安装目录文件锁 → 安装器覆盖。
4. **跨会话复用**：启动 `loadPendingFromDisk()` 校验 `pending-update.json`（版本 > 当前 + 文件在 + sha256 匹配）→ 设为缓存；下次 `checkForUpdates` 若服务端 latest 与缓存版本一致，直接推 `downloaded`，不重下。网络异常时用有效缓存离线兜底。

## IPC 与状态事件

| Channel | 方向 | 说明 |
|---|---|---|
| `updater:check` / `:download` / `:install` | renderer→main `invoke` | 触发检查 / 下载 / 安装 |
| `updater:status` | main→renderer `send` | 推 `UpdateStatusEvent`：`checking`/`available`/`not-available`/`downloading`/`downloaded`/`error`，`info.mustUpgrade` 标记强制升级 |
| `app:quit` | renderer→main `invoke` | 强制升级弹窗「退出应用」用 |

preload 暴露 `window.electronAPI.updater`(check/download/install/onStatus) + `window.electronAPI.app.quit`。

## 字段映射（V2 CheckResult → UI）

`has_update`→事件 `available`/`not-available`（**升级判定以此为准**）；`must_upgrade`→`info.mustUpgrade`→`UpdateInfo.mustUpgrade`；`latest_version`→`info.version`；`release_notes`→`info.releaseNotes`；`released_at`→`info.releaseDate`；`download_url`/`sha256`/`file_size`→主进程下载/校验内部用。`current` 由主进程 `app.getVersion()` 填；渲染层 `currentVersion` 取 `NEXT_PUBLIC_APP_VERSION` 仅用于弹窗展示。

## 强制升级（must_upgrade）

`UpdateDialog`：`mustUpgrade=true` 时隐藏关闭 X（`showCloseButton={false}`）、`onEscapeKeyDown`/`onInteractOutside` preventDefault、隐藏「稍后」、显示必须升级提示，按钮为「立即升级」+「退出应用」（`app:quit`）。Radix 模态遮罩本身阻断主界面交互 → 满足"不升级不能用、只能退出"。局限：启动到首检返回前的数秒窗口内可操作（未在 boot gate 层硬阻断）。

## 配置 / 鉴权（复用登录体系）

- Base URL：`electron/auth/config.ts getBackendBase()`（prod `code-agent.ai-native-lab.com` / dev `localhost:8080` / `BACKEND_BASE` 覆盖），与登录/模型配置下发同源。
- Token：`electron/auth/storage.ts loadToken()` 读 `~/.codepilot/anlcode/session_token`，由 `apiRequest` 自动注入 `Authorization: Bearer`。401→`AuthExpiredError`（归类为 `auth-expired`）。
- `pending-update.json` 落 `getAnlcodeDir()`（与 token/configs 同目录）。

## Kill-switch / 回滚

`src/hooks/useUpdateChecker.ts` 的 `UPDATE_CHECK_DISABLED`（默认 `false`）改回 `true` → 整体隐藏所有更新 UI（弹窗/横幅/会话列表角标/设置卡），一键回滚到隐藏态。主进程模块独立，不影响其它功能。

## 退役的旧实现

删除：`electron/updater.ts`(旧 DISABLED stub，且与新 `updater/` 目录模块解析冲突)、`src/app/api/app/updates/route.ts`(查 op7418 的旧 Next 路由)、`src/lib/update-release.ts`(+单测，仅旧路由用)；`useUpdateChecker` 移除 browser 兜底路径。

## 验证边界

- **dev（CDP mock）**：注入 mock `window.electronAPI.updater` 验证 available→弹窗、下载→进度→downloaded→「重启以更新」、mustUpgrade 隐藏 X/「稍后」+「立即升级」/「退出应用」/提示、齿轮蓝点、设置卡。`tsc` + `updater-version.test.ts`(11 例) 通过。
- **真实链路（用户打包后验证）**：真实 `BACKEND_BASE` + 登录态 + 后台录入版本 → 检查/下载/校验/安装/重启；关掉重开不重下；sha256 改坏拦截；401 重登；win 原路径覆盖 / mac ditto 覆盖。dev 无 Electron 主进程，下载/安装无法在 dev 跑。
