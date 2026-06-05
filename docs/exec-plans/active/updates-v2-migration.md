# 自动更新迁移到研发平台 V2 API（updates-v2-migration）

> 创建时间：2026-06-05
> 最后更新：2026-06-05（v3：对照 Trae 方案补充——进程优雅退出 / 后台下载策略 / 重定向 / 签名）
> 状态：🔄 开发中 — Phase 0（方案+决策）✅、Phase 1（V2 检查链路）✅ 已实施并 dev-mock 验证；Phase 2–4 待续
> 关联接口文档：[文档/updates-v2-api.md](../../../文档/updates-v2-api.md)
> 关联登录体系：[docs/handover/login-system.md](../../handover/login-system.md)
> 安装/避免重下设计来源：姊妹项目「AI-Native-Lab / bsApp」的《自动更新-避免重下与自动安装设计》（外部文档，关键设计已**内联**到 §7，不留外部链接）
> 另对照参考：「Trae CN（Inno Setup + electron-updater）逆向方案」——技术栈不同，逐条取舍见 §13

---

## 0. 一句话目标

把现有「检查 GitHub `op7418/CodePilot` Releases → 弹窗 → 跳浏览器下载」的旧更新机制，整体改造为「调研发平台 **V2 API**（带登录 token 鉴权）→ 拿 CDN 直链 → 客户端自行下载 + SHA-256 校验 + 安装」的**真·应用内自动更新**，复用登录体系已有的 `getBackendBase()` + `apiRequest()`（Bearer 注入）基础设施。

---

## 1. 背景

- 旧更新机制只有**浏览器模式检查**这一条活路：渲染层挂载时请求本地 Next 路由 `/api/app/updates`，该路由去查 GitHub `op7418/CodePilot`（**上游原仓库**）的 latest release，比对版本后弹窗，用户点击跳浏览器下载。
- **两个既有问题**：
  1. 检查的仓库（`op7418/CodePilot`）与实际发布仓库（`electron-builder.yml` → `CmftAiLabs/LabCodepilot`）**对不上**，等于在拿上游的版本号和安装包提示本 fork 用户。
  2. 「原生 Electron 自动更新」(`electron/updater.ts`) 是**故意留的空壳 stub**，且**根本没接进 `electron/main.ts`**；`preload.ts` 也没有暴露 `updater` 桥 → `window.electronAPI.updater` 运行时为 `undefined`，`useUpdateChecker` 里整套 native 分支是**永不执行的死代码**。所以"完整自动更新（应用内下载+安装）"现状是**从未实现**。
- 当前该功能已被 `UPDATE_CHECK_DISABLED` 总开关整体隐藏（见 commit `6442226`），处于待改造状态。
- 现在服务端 V2 更新接口已就绪（base URL 同登录 / 模型配置下发地址，Authorization 复用登录 token），需要客户端配合改造。

---

## 2. 现状调研结论（全链路盘点）

| 层 | 文件 | 现状 | 处置 |
|---|---|---|---|
| 渲染 - 检查逻辑 | `src/hooks/useUpdateChecker.ts` | native + browser 双路径；当前被 `UPDATE_CHECK_DISABLED=true` 全 gate | **改造**：native 路径接真实主进程更新器；browser 路径作 dev/非 Electron 兜底；开闸 |
| 渲染 - Context/类型 | `src/hooks/useUpdate.ts` | `UpdateInfo` / `UpdateContextValue` | **扩展**：加 `mustUpgrade` 等字段 |
| 渲染 - 弹窗 | `src/components/layout/UpdateDialog.tsx` | 已支持 `isNativeUpdate`/`downloadProgress`/`readyToInstall`/进度条/重启安装按钮 | **小改**：加强制升级（禁止"稍后"）分支 |
| 渲染 - 横幅 | `src/components/layout/UpdateBanner.tsx` | ready-to-install / rosetta 横幅 | 基本复用 |
| 渲染 - 设置卡 | `src/components/settings/GeneralSection.tsx:221` | `<UpdateCard />` 已注释隐藏 | **反注释** + 手动检查接新通道 |
| 渲染 - 齿轮角标 | `src/components/layout/ChatListPanel.tsx:692` | `hasUpdate \|\| readyToInstall` 驱动蓝点 | 复用（数据源换成新 updateInfo 即自动恢复） |
| 服务端路由(本地) | `src/app/api/app/updates/route.ts` | 查 GitHub `op7418/CodePilot`，硬编码 `GITHUB_REPO` | **退役**（决策 #7：dev 跑 mock、不再需要该兜底路由） |
| 主进程 - 更新器 | `electron/updater.ts` | DISABLED 空壳，未接入 main | **重写**为 V2 自定义更新器（检查/下载/校验/安装） |
| 主进程 - 启动 | `electron/main.ts` | 无任何 updater 引用 | **新增** IPC handler + 启动后触发检查 |
| preload 桥 | `electron/preload.ts` | 有 `auth` 桥，无 `updater` 桥 | **新增** `updater` 桥（镜像 `auth.onChange` 模式） |
| 类型 | `src/types/electron.d.ts` | `UpdateStatusEvent`(:30)/`ElectronUpdaterAPI`(:47) 已定义 | **微扩展**（mustUpgrade） |
| 打包发布 | `electron-builder.yml:3-6` | publish → github `CmftAiLabs/LabCodepilot` | 该 publish 仅供 CI 上传产物；**更新 feed 改由 V2 API + CDN**，与 GitHub 解耦 |

**可直接复用的登录体系基建（关键）：**

| 能力 | 来源 | 说明 |
|---|---|---|
| Base URL 解析 | `electron/auth/config.ts → getBackendBase()` | prod `code-agent.ai-native-lab.com` / dev `localhost:8080` / `BACKEND_BASE` 覆盖；**与 V2 base URL 同源** ✅ |
| 鉴权 HTTP 客户端 | `electron/auth/http.ts → apiRequest<T>()` | 自动注入 `Authorization: Bearer <token>`、超时、401→`AuthExpiredError`、网络错→`NetworkError` |
| Token 存取 | `electron/auth/storage.ts → loadToken()` | 文件 `~/.codepilot/anlcode/session_token`（0600）；**token 永不过 IPC** |
| 认证调用范例 | `electron/auth/client.ts → fetchUsage()` + `main.ts:2036 ipcMain.handle('auth:get-usage')` | **V2 检查就是这套的克隆**：renderer→IPC→main `apiRequest` 认证 GET→回传 |
| 平台/架构/Rosetta | `src/lib/platform.ts → getRuntimeArchitectureInfo()` | 主进程可用 `process.platform/arch` + sysctl rosetta 检测；用 hostArch 选原生包 |

---

## 3. V2 接口理解摘要（对接要点）

- **Base URL**：同登录（`getBackendBase()`），路径前缀 `/api/v1`。
- **鉴权**：`Authorization: Bearer <anl_sess_…>`（登录下发的会话令牌）。401=重登，403=账号停用，422=参数错；错误体 `{"detail":"..."}`。
- **两个客户端接口**：
  - `GET /api/v1/updates/v2/check?platform=&arch=&channel=&current=` — 传当前版本，返回是否升级。
  - `GET /api/v1/updates/v2/latest/{platform}?arch=&channel=` — 无条件取最新元数据（手动"关于页检查"用）。
- **响应字段（CheckResult）**：`has_update`(bool)、`must_upgrade`(bool)、`latest_version`、`download_url`(**CDN 直链**)、`sha256`(64hex)、`file_size`(int)、`release_notes`、`released_at`(ISO8601)。
- **三条铁律**：
  1. **以 `has_update` 为准**判断要不要升级；`download_url` 即使非空也不代表要下载（"已是最新"也回带最新版元数据）。
  2. 版本比较是**字符串精确不等**（非 semver）→ `current` 必须与后台录入版本号**完全一致**；客户端再用 semver 兜底防误报/防降级。
  3. **下载后必须校验 `sha256` + `file_size`**，通过才安装；走 CDN 直链，下载/重试/断点由客户端负责。
- `must_upgrade=true` → 强制升级，阻断旧版继续使用。

---

## 4. 目标架构

**核心决策：把整个更新生命周期放进 Electron 主进程**，渲染层只负责展示 + 触发（复用既有 `ElectronUpdaterAPI` 契约）。

理由：① token 在主进程、`apiRequest()` 现成；② 下载落盘 + sha256 校验 + 拉起安装器 + 退出/重启**本来就只能在主进程做**；③ 渲染层的 `useUpdateChecker` native 分支 + `UpdateDialog` 进度/重启 UI 已为"主进程驱动"模型量身打造，改动最小。

```
渲染层 (useUpdateChecker)                主进程 (electron/updater/*)              研发平台 V2 + CDN
─────────────────────────               ──────────────────────────              ──────────────────
window.electronAPI.updater
  .checkForUpdates()  ──IPC──►  updater:check ──► apiRequest('/api/v1/updates/v2/check'
                                                    ?platform&arch&channel&current)  ──► V2 /check
                                ◄── 'available'{version,notes,mustUpgrade} ◄── CheckResult
  .downloadUpdate()   ──IPC──►  updater:download ─► 流式下载 download_url ──────────► CDN 直链
                                ◄── 'downloading'{percent}（按 file_size 算进度）
                                     下载完成 → crypto 算 sha256 + 比对 file_size
                                ◄── 'downloaded'（校验通过）/ 'error'（校验失败删文件）
  .quitAndInstall()   ──IPC──►  updater:install ─► 拉起平台安装器 + app.quit()
  .onStatus(cb)       ◄──push── webContents.send('updater:status', UpdateStatusEvent)
```

**单一真实路径（native）+ dev mock（决策 #7）：**
- **Packaged（有 Electron main）**：native 路径 → 真实检查 + 下载 + 校验 + 安装。**唯一真实链路。**
- **Dev / 非 Electron（`next dev`，`window.electronAPI` 为空）**：不发起任何真实检查；用 **CDP 注入 mock 的 `window.electronAPI.updater`** 驱动 `onStatus` 事件来验证 UI/判定逻辑。→ 旧 GitHub 路由与 `useUpdateChecker` 的 browser 兜底路径**一并退役**（§5.5），不再保留双路径。

---

## 5. 详细改造点清单

### 5.1 主进程：新建 V2 更新器（核心工作量）

新增目录 `electron/updater/`（替代当前 stub `electron/updater.ts`）：

| 文件 | 职责 |
|---|---|
| `client.ts` | `checkUpdateV2(params): Promise<CheckResult>` — 克隆 `fetchUsage()`：`apiRequest<CheckResult>('/api/v1/updates/v2/check', { query })`。再加 `getLatestV2(platform,…)` 备用。 |
| `platform.ts` | 主进程版平台映射：`process.platform`(`win32`→`windows` / `darwin`→`darwin`)、`process.arch`(仅 `x64`/`arm64`)；`current=app.getVersion()`；`channel='stable'` 固定（决策 #3/#4）。 |
| `downloader.ts` | 固定文件名落 temp + **三层避免重下** + **sha256 三处校验**（API 给的是 sha256/64hex，非 Trae 的 sha512）+ `{final}.{pid}.tmp` 原子 rename + 按 `file_size` 推 `downloading` 进度 + **跟随 CDN 30x 重定向**（对照 Trae 补充）（见 §7.1）。 |
| `installer.ts` | 安装执行（见 §7.2–7.4）：Win `shell.openPath`+`cmd start` 兜底；mac bash 脚本 `hdiutil`+`ditto`；dev `showItemInFolder` 不真装；`install()` ok → 800ms `app.quit()`。 |
| `index.ts` | `initUpdater(win)` / 状态机（checking/available/not-available/downloading/downloaded/installing/error）/ `pending-update.json` 落盘与 `loadPendingFromDisk()` 跨会话复用 / `handleUpdateInfo()` 防重入 / `webContents.send('updater:status', …)`。 |

- **触发时机**：①启动登录 gate 完成后（`bootAccountState` 成功分支）后台静默检查一次；②手动（设置页按钮 / 关于页）；③定时（复用 `electron/auth/poller.ts` 的 10 分钟节拍挂一个 update 检查，或独立 8h 间隔）。> 注：登录体系当初决定"不轮询 updates，交给 electron-updater"——而 electron-updater 是空壳，本次正好补上这条。
- **下载策略（已定：检查只提示、点击才下）**：检查只负责**提示**，**不自动下载**；用户在弹窗点"下载并安装"才触发 `downloadUpdate()` 下载（用户决策，避免移动网络/流量自动下大包）。`pending` 跨会话复用**仍保留**——上次已点过下载但没装完的包，重开时复用、不重下。强制升级（`must_upgrade`）下载仍需用户点"立即升级"触发，但弹窗不可关、只能升级或退出。

### 5.2 主进程：`electron/main.ts` 接线

- import `initUpdater` 并在创建主窗后调用（拿到 `mainWindow` 推状态）。
- 新增 IPC：`ipcMain.handle('updater:check' | 'updater:download' | 'updater:install', …)`，错误按 `HttpError`/`AuthExpiredError`/`NetworkError` 归类回传（照抄 `auth:get-usage` handler 模式）。

### 5.3 preload：新增 `updater` 桥

`electron/preload.ts` 在 `contextBridge` 暴露（镜像 `auth.onChange`）：
```ts
updater: {
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  quitAndInstall: () => ipcRenderer.invoke('updater:install'),
  onStatus: (cb) => { const l=(_e,d)=>cb(d); ipcRenderer.on('updater:status', l);
                      return () => ipcRenderer.removeListener('updater:status', l); },
}
```

### 5.4 渲染层

- `src/hooks/useUpdateChecker.ts`：`UPDATE_CHECK_DISABLED` → `false` 开闸；native 分支已就绪（`window.electronAPI.updater` 现在真实存在）；移除 browser 路径。`current` 由主进程 `app.getVersion()` 填（渲染层不传）。
- `src/hooks/useUpdate.ts`：`UpdateInfo` 加 `mustUpgrade: boolean`；映射 V2 字段。
- `src/components/layout/UpdateDialog.tsx`：`mustUpgrade=true` 时隐藏/禁用"稍后"、`onOpenChange` 不允许关闭，文案改"必须升级"。
- `src/components/settings/GeneralSection.tsx:221`：反注释 `<UpdateCard />`。
- `ChatListPanel` 齿轮蓝点：无需改（数据源恢复后自动亮）。

### 5.5 本地路由（退役）

- 决策 #7：dev 只跑 mock、真链路打包自验 → **不再**需要 `/api/app/updates` 作 dev 兜底。
- `src/app/api/app/updates/route.ts`（查 GitHub `op7418/CodePilot`）**退役**：删除该路由及 `src/lib/update-release.ts`（仅其引用），`getRuntimeArchitectureInfo` 等仍被他处引用的保留。
- `useUpdateChecker` 的 browser 路径相应**移除**（非 Electron 下不再发起检查）；dev 用 CDP 注入 mock `updater.onStatus` 事件来验证 UI/判定逻辑（不经路由）。
- `src/__tests__/helpers.ts` 的 `disableUpdateDialog`（stub `/api/app/updates`）随路由移除而**删除/改为 no-op**——native 路径在测试环境（无 `window.electronAPI`）本就不触发，弹窗默认不出现。

### 5.6 类型 / i18n / 文档

- `src/types/electron.d.ts`：`UpdateStatusEvent.info` 加 `mustUpgrade?: boolean`（或单独字段）。
- `src/i18n/en.ts` + `zh.ts`：新增 `update.mustUpgrade` / `update.verifyFailed` / `update.downloadFailed` / `update.installNow` 等 key（两份同步）。
- 开发完成后补 `docs/handover/updates-v2.md`（交接）+ `docs/insights/updates-v2.md`（产品思考），互相反向链接（CLAUDE.md 规定）。

### 5.7 无需改动

- **DB schema**：无需变更（"已忽略版本"沿用 localStorage `codepilot_dismissed_update_version`；强制升级不可忽略；下载临时文件用临时目录，无需持久化）。

---

## 6. 字段映射（V2 CheckResult → 现有 UI 模型）

| V2 字段 | → UpdateInfo / UpdateStatusEvent | 备注 |
|---|---|---|
| `has_update` | `updateAvailable` / 事件 `available`\|`not-available` | **判断升级以此为准** |
| `must_upgrade` | `mustUpgrade`（新增）/ `info.mustUpgrade` | 强制升级 UX |
| `latest_version` | `latestVersion` / `info.version` | semver 兜底比对本地版本 |
| `release_notes` | `releaseNotes` / `info.releaseNotes` | 弹窗 Markdown 渲染（已支持） |
| `released_at` | `publishedAt` / `info.releaseDate` | |
| `download_url` | 主进程内部下载用（CDN，无需鉴权） | 不再用于"跳浏览器" |
| `sha256` | 主进程内部校验用 | **必校验** |
| `file_size` | 进度计算 + 二次校验 | |
| current（请求参数） | `app.getVersion()` | 必须与后台录入版本号字符串完全一致 |

---

## 7. 下载 / 避免重下 / 安装设计（内联自姊妹项目方案）

> 来源：「AI-Native-Lab / bsApp」《自动更新-避免重下与自动安装设计》。该项目与本应用同源（同为 AI Native Lab、同用 `anlcode` 目录约定），设计经实战验证，本节按 CodePilot 的路径与目录做了映射。落点：下载器 `electron/updater/downloader.ts`、编排 `electron/updater/index.ts`、安装 `electron/updater/installer.ts`。

### 7.1 落地路径与避免重复下载（跨平台共用，sha256 为基石）

**固定文件名**（落到临时目录，同版本永远同路径，是复用前提）：

| 平台 | 本地安装包文件名 | 落地目录 |
|---|---|---|
| Windows | `AI-Native-Lab-Setup-{version}.exe` | `app.getPath('temp')` |
| macOS | `AI-Native-Lab-Update-{version}.dmg` | `app.getPath('temp')` |

> 注：本地文件名只需稳定可辨识；CDN `download_url` 文件名（如 `windows-x64.exe`）由服务端控制，二者无需一致。

**三层复用（从同一次运行内 → 跨会话逐层兜底）：**

1. **固定文件名**：同版本同路径 → "是否下过" = 查这一个路径是否存在。
2. **同名文件 hash 复用**：真正下载前若目标文件已存在 → 重算 sha256：与服务端 `sha256` 一致 → **直接复用、跳过下载、回报 100%**；不一致（坏档/被改）→ 删除后重下。下载写入用 `{final}.{pid}.tmp` 临时文件，**sha256 通过才原子 `rename`** 成正式名——半截文件永不会被当成"已下好"。
3. **`pending-update.json` 跨会话复用（核心：关掉重开不重下整包）**：
   - 下载成功后落盘 `pending-update.json`，记录 `version / 文件路径 / sha256 / file_size / mustUpgrade / download_url`。
   - **位置**：`getAnlcodeDir()/pending-update.json`（即 `~/.codepilot/anlcode/`，与登录体系 `session_token`/`configs.json` **同目录**；区别于姊妹项目的 `userData/anlcode`，本应用对齐到既有 anlcode 目录，复用 `electron/auth/paths.ts`）。
   - 下次启动 `loadPendingFromDisk()` 三项核验全过才进 `downloaded`：① 记录版本 **> 当前版本**（否则说明已手动装过新版）→ 否则删包清记录；② 安装包文件仍在 → 否则清记录；③ **重算 sha256 比对** → 否则删包清记录。全过 → UI 启动即弹"准备就绪"，**完全跳过下载**。

**sha256 三处校验**（保证复用的绝不是坏档/篡改包）：① 下载边下边算、收尾比对；② 复用已存在同名文件前；③ 启动加载 pending 包前。

**同会话防重入/防抖**（`handleUpdateInfo()` 在"触发下载"层再挡一道，避免定时轮询抖动重复拉起）：同版本已 downloading/downloaded/installing → 跳过；已有下载任务锁（`downloadingTask`）→ 跳过；本会话点过"稍后"（`dismissedVersions`）且**非强制升级** → 跳过。

**装完清理差异**：Windows 不主动删，留 temp，下次启动 `loadPendingFromDisk` 发现版本不再更新时删；macOS 安装脚本装完即 `rm -f` 删 DMG（省体积）。

### 7.2 自动安装：通用约定

- `install()` 返回 `ok:true` **只代表"安装器/脚本已作为独立进程拉起"**，随后由 `installNow()` 退主程序：**`install() ok → setTimeout 800ms → app.quit()`**。原因：**程序无法替换正在运行的自己**，必须让安装器脱离主进程独立运行、主程序退出后接管覆盖安装。
- **⚠️ 安装前进程优雅退出（对照 Trae 补充，见 §13）——Windows 头号坑**：覆盖安装要写安装目录，若**子进程仍持有文件句柄**会导致覆盖失败 / 半装。本应用进程树重：bundled Next 服务（`utilityProcess`）、其派生的 **claude SDK 子进程（asarUnpack 的 `claude.exe` ~230MB，在安装目录里）**、MCP / bridge / PTY。现有 `app.on('before-quit')`（`main.ts:2169`）已 `killServer()` + 杀 PTY/installProcess——但需**确认 `utilityProcess` 子进程树在 Windows 上被连根杀掉**（`utilityProcess.fork` 的孙子进程不随父死，可能要 job object / `taskkill /T /F`）。要求：`installNow()` 退出前**先 await 完整 teardown**（server + SDK 子进程 + MCP + bridge + PTY + DB 句柄），再拉起安装器 / `app.quit()`，避免 NSIS 覆盖 `claude.exe` 时被锁。
- **Dev 模式（`!app.isPackaged`）永不真装**，只 `shell.showItemInFolder` 打开下载目录供自查 → 满足"dev 跑 mock"。
- 安装日志用 Node `fs` 直接写文件（不依赖外部进程）：Win `app.getPath('logs')/update-win-{ts}.log`、mac `app.getPath('logs')/update-{ts}.log`。

### 7.3 Windows（NSIS，符合用户明确要求）

下载安装包 → 放 temp → 退出应用 → 命令拉起安装器 → NSIS 在"安装进度条那一步"按**原路径覆盖安装**：

1. **主路径 `shell.openPath(setupExe)`**：内部走 Win32 ShellExecute，**等价用户双击 setup.exe**，正常弹 NSIS 向导 / UAC / SmartScreen；**不传 `/S` 静默**，让用户看向导点完（这正是"有安装进度条的那一步"）。NSIS 记住既有安装路径 → 原路径覆盖。
2. **兜底 `cmd.exe /c start "" "<path>"`**：当 `openPath` 返回非空错误串时启用；cmd 是系统组件，杀软几乎不拦。
3. 时序：`shell.openPath` 拉起 → 返回 ok → 800ms 后 `app.quit()` → setup.exe（NSIS 模板 nsProcess 检查）检测主程序已退出 → 卸旧装新 → 启动新版。

> 历史教训（已内化，勿走回头路）：`spawn(setup, ['/S'])` 会被 CreateProcess 拒绝提权导致"半删"；PowerShell bootstrap 会被国内杀软拦。`shell.openPath` 是验证可行的方案。
> 构建侧注意：当前 `electron-builder.yml` `nsis.allowToChangeInstallationDirectory: true` 会显示选路径页；为保证"原路径覆盖"体验顺滑，开发时确认 NSIS 对既有安装的路径记忆行为（必要时评估该选项），属构建配置微调。

### 7.4 macOS（DMG，arm64，参考姊妹项目）

DMG 无静默协议、不能边运行边替换自身 → 写一段 bash 脚本到 temp，`spawn` 为脱离进程（detached + unref）后立即退主程序。脚本逻辑：

1. `kill -0` 轮询等父进程退出（最多 60×0.5s）+ 再等 1s 释放文件句柄；
2. `hdiutil attach` 挂载 DMG 到 `/tmp/anlcode-update-mount-{pid}`；
3. 挂载点内找 `.app`；
4. `rm -rf` 旧 bundle，用 **`ditto`**（非 `cp -R`，保留扩展属性/资源 fork/**代码签名**）把新 `.app` 覆盖到原位（经 `process.execPath` 上溯三级定位当前 bundle）；
5. `hdiutil detach` 卸载 + `rm -f` 删 DMG；
6. `open` 启动新版；
7. 脚本 `rm -f "$0"` 自删。
- **健壮性**：任一步失败（挂载/找不到 .app/ditto 失败）→ 兜底 `open DMG` 让用户手动拖进 Applications；路径含双引号 `"` 直接拒绝执行（防注入）。
- 时序：写脚本 + spawn → 返回 ok → 800ms `app.quit()` → 脚本等父进程退出 → 挂载 → ditto 覆盖 → detach + 删 DMG → open 新版 → 脚本自删。

> 公证/Gatekeeper 说明：本设计用 `ditto` 保签名 + 脚本就地覆盖，不依赖"公证机制本身"。当前 `notarize:false`、Developer ID 签名；真实 Gatekeeper 行为由用户**打包后自行验证**（决策 #2/#7）。若验证遇 quarantine 拦截，再评估去 quarantine 或开公证（不在本期范围）。

### 7.5 强制升级阻断（决策 #5）

`must_upgrade=true` 时**阻断主界面、不升级不能用、只能升级或退出**：

- **会话内**：渲染层弹**不可关闭**的全屏阻断层（`UpdateDialog` mustUpgrade 分支：去掉"稍后"、`onOpenChange` 拒绝关闭、ESC/点遮罩无效），仅"立即升级"（触发下载→安装）与"退出应用"（IPC `app:quit`）。
- **启动即强制**：若启动检查就发现 `must_upgrade`，复用登录 gate 思路——主窗推迟 / 覆盖阻断层，未升级不放行进入应用。
- 非强制升级（`must_upgrade=false`）维持可"稍后"的普通弹窗。

---

## 8. 分阶段交付

| Phase | 内容 | 状态 | 验收 |
|---|---|---|---|
| Phase 0 | 本实施文档 + 决策确认 | ✅ 已完成 | 用户已批准开发（含 check-only 决策） |
| Phase 1 | 主进程 V2 检查（`client.ts`/`platform.ts`）+ IPC（`updater:check`）+ preload `updater` 桥 + 渲染开闸（`UPDATE_CHECK_DISABLED=false`）+ 反注释 `<UpdateCard/>` + 字段映射 + `mustUpgrade` + **退役旧 GitHub 路由/browser 路径**；**仅检查与提示**（下载按钮 Phase 2 接真实下载） | ✅ 已完成 | dev-mock CDP 验证通过：available→弹窗渲染 release notes/版本、下载点击→进度→downloaded→"重启以更新"、mustUpgrade 隐藏"稍后"且不可关、齿轮蓝点恢复、设置卡渲染、console 无报错；typecheck 通过 |
| Phase 2 | **下载器 `downloader.ts`**：固定文件名 + 三层避免重下 + sha256 三校验 + 原子 rename + 进度；`pending-update.json` 落盘/`loadPendingFromDisk`；**Windows 安装 `installer.ts`**：`shell.openPath`+`cmd start` 兜底 + 800ms `app.quit()` | 📋 | 用户打包：Win 端到端升级成功（含关掉重开不重下、原路径覆盖）；sha256 失败拦截 |
| Phase 3 | **macOS 安装**：bash 脚本 `hdiutil attach`+`ditto` 覆盖 + `open` + 删 DMG + 自删脚本 + 失败兜底 `open DMG`；mac 侧避免重下复用同一套 | 📋 | 用户打包：mac(arm64) 端到端升级成功 |
| Phase 4 | **强制升级阻断**（`must_upgrade` 全屏不可关 + 仅升级/退出 + 启动即强制）+ 手动检查（设置/关于页）+ i18n 收尾（en/zh）+ 主进程单测（平台映射/sha256/pending 校验纯函数）+ 交接/产品文档 | 📋 | 强制升级不可跳过、只能升级/退出；手动检查可用 |

---

## 9. 决策日志

- 2026-06-05：更新器放**主进程**而非 Next 路由——token 在主进程、下载/校验/安装只能在主进程；渲染层契约已就绪。
- 2026-06-05：放弃 `electron-updater`——V2 返回 CDN 直链 + sha256，**不是** electron-updater 的 `latest.yml`/blockmap feed 格式，自定义下载安装更贴合且可控。
- 2026-06-05：复用 `apiRequest()`/`getBackendBase()`/`loadToken()`，不新造鉴权/HTTP 代码路径。
- 2026-06-05（用户审核）：① 版本号与服务端对齐、以 `has_update` 为准；② mac 按姊妹项目 `ditto` 脚本方案；③ 不服务 Intel mac；④ 只做 `stable`；⑤ 强制升级阻断主界面、只能升级/退出；⑥ 服务端上传/登记由用户手动，客户端只按接口判定+下载安装；⑦ dev 跑 mock、真链路用户打包自验 → 旧 GitHub 路由直接退役。
- 2026-06-05（用户补充）：避免重下（固定文件名 + 同 hash 复用 + `pending-update.json` 跨会话）与自动安装（Win `shell.openPath`、mac `hdiutil`+`ditto`、先拉起独立进程再 800ms `app.quit()`）按姊妹项目实战方案内联到 §7，win/mac 共用。
- 2026-06-05（用户最终决策）：下载策略取 **check-only**——检查只提示、用户点击才下载（避免移动网络自动下大包）；`pending` 跨会话复用仍保留。
- 2026-06-05（实施）：Phase 1 落地——新建 `electron/updater/{client,platform,index}.ts`（克隆 `fetchUsage` 调 V2 /check）+ `main.ts` 接 `registerUpdaterIpc`/`initUpdater`/`stopUpdater` + `preload` 暴露 `updater` 桥 + `electron.d.ts` 加 `mustUpgrade`；渲染 `useUpdateChecker` 改主进程单路径（移除 browser 兜底、`UPDATE_CHECK_DISABLED=false` 保留为 kill-switch）+ `useUpdate` 加 `mustUpgrade` + `UpdateDialog` 强制升级守卫 + 反注释 `UpdateCard`；退役并删除 `electron/updater.ts`(旧 stub，避免与新目录模块解析冲突)/`src/app/api/app/updates/route.ts`/`src/lib/update-release.ts`(+其单测)。dev-mock CDP 验证通过。

---

## 10. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 后台录入版本号与 `app.getVersion()` 不一致 → 字符串比较误报 | 决策 #1 与后台对齐格式；`pending` 复用额外要求"记录版本 > 当前版本"防降级/防重装旧版 |
| macOS quarantine / Gatekeeper 拦截下载包启动 | `ditto` 保留代码签名就地覆盖；任一步失败兜底 `open DMG`；真实行为由用户打包自验（决策 #2/#7），必要时再评估去 quarantine / 公证 |
| 下载中断 / CDN 坏档 / 被篡改 | sha256（三处）+ file_size 强校验；`{final}.{pid}.tmp` 原子 rename，半截文件不复用；校验失败删文件可重试，**绝不安装未校验包** |
| 重复下载大包（270MB 级） | 三层避免重下 + `pending-update.json` 跨会话复用，关掉重开不重下 |
| Windows 杀软拦截拉起安装器 | `shell.openPath`（ShellExecute，杀软一般不拦）+ `cmd start` 兜底；不用 `/S` spawn、不用 PowerShell（历史教训） |
| Windows 安装包未签名 → SmartScreen 拦截 / 不信任（对照 Trae §13） | `electron-builder.yml` 暂无 Windows 签名配置；建议补 Windows 代码签名证书（打磨项，影响升级顺滑度，不阻断功能） |
| 安装时子进程锁住安装目录文件（尤其 `claude.exe`）→ 覆盖失败 | 安装前 await 完整进程 teardown（§7.2）；确认 `utilityProcess` 子进程树在 Win 上连根杀 |
| 强制升级误配阻断所有人 | `must_upgrade` 由后台精确控制（用户手动登记）；阻断层提供"退出应用"出口，不至于卡死无法退出 |
| **回滚** | 改造均在 `UPDATE_CHECK_DISABLED` 总闸后 + 主进程独立 `electron/updater/` 模块；出问题把开关置 `true` 即可瞬间回到当前隐藏状态 |

---

## 11. 已确认决策（2026-06-05 用户审核）

| # | 议题 | 决策 |
|---|---|---|
| 1 | 版本号格式 | 客户端 `current` 传**与服务端下发完全一致**的版本号；以接口 `has_update`（字符串精确比较）为准。客户端仅保留极轻的"`latest_version` 须 > 本地版本"作为**重下复用有效性**与防降级兜底（见 §7 pending 校验），不改变升级判定逻辑。 |
| 2 | macOS 安装 | **参考姊妹项目设计**（§7.4）：下载 DMG → `hdiutil attach` → `ditto` 覆盖原 bundle → `open` 新版；不依赖公证机制本身（ditto 保签名），失败兜底 `open DMG` 手动拖入。真链路由用户自行打包验证。 |
| 3 | Intel mac | **不考虑**。只服务 `darwin-arm64`；维持当前仅构建 arm64。 |
| 4 | channel | **只做 `stable`**。请求固定带 `channel=stable`；预留参数位，beta/alpha 暂不接 UI。 |
| 5 | 强制升级 UX | `must_upgrade=true` 时**阻断主界面**：不可关闭、不可"稍后"，**不升级不能使用，只能"立即升级"或"退出应用"**。 |
| 6 | 产物上传 + 版本登记 | **用户手动负责**（上传 CDN + 调 admin 接口登记 sha256/size）。客户端**只按接口返回判断是否升级 + 下载安装**，不碰服务端。 |
| 7 | dev 联调 | **dev 只跑 mock**（CDP 注入 / mock V2 响应验证 UI 与判定逻辑）；**真实链路由用户打包后自行验证**。→ 因此**不再**需要把 `/api/app/updates` 路由重指向 V2 做兜底；该路由直接**退役**（见 §5.5 调整）。 |

### 补充：Windows 安装细节（用户明确）

下载得到的是一个**安装包**，放**临时目录**；下载完成后**退出应用**，再**通过命令拉起安装程序**，到"有安装进度条的那一步"**自动按原路径覆盖安装**。与 §7.3 姊妹项目方案一致（`shell.openPath(setup.exe)` 拉起 NSIS 向导 → 800ms 后 `app.quit()` → 安装器检测主程序退出后覆盖安装）。

---

## 12. 验证方案

- **dev（逻辑层，本期主力）**：dev 无 Electron 主进程，用 CDP 注入 mock `window.electronAPI.updater`（按示例 A/B/C 推 `available`/`not-available` 与进度事件）验证 `has_update` 判定、弹窗渲染、强制升级阻断分支、齿轮蓝点恢复、401 归类——**不经真实后台/路由**。
- **packaged（端到端，由用户打包后自验）**：真实 `BACKEND_BASE` + 已登录 token + 用户手动登记一条高版本 → 启动检查 → 下载 → sha256/size 校验 → 安装 → 重启验证版本号变化；**关掉应用再开验证不重下**（pending 复用）；故意改坏 sha256 验证拦截；401（篡改 token）验证重登；`must_upgrade` 验证阻断只能升级/退出。
- 自检（开发阶段）：`npm run test`（typecheck+unit）；涉及渲染 UI 用 `npm run test:smoke` + CDP；主进程更新器加单测（平台映射、版本比较、sha256/pending 校验等**纯函数**部分；下载/安装的进程交互不进单测，靠打包自验）。

---

## 13. 对照 Trae 方案：补充与取舍

> 来源：《Windows 桌面应用自动更新实现指南》（Trae CN 逆向：Electron + Inno Setup + electron-updater generic feed）。Trae 与本方案**技术栈不同**（Inno Setup vs NSIS、generic feed vs 自定义 V2 一步式 JSON、sha512 vs sha256），不照搬；逐条取舍如下。

| Trae 做法 | 与本方案对照 | 取舍 |
|---|---|---|
| electron-updater + generic provider 读 `latest.yml` feed | 本 V2 是**一步式**自定义 JSON（`/check` 直接回 `download_url+sha256+file_size`），非 generic feed 格式 | **不采纳** electron-updater，维持主进程自定义更新器（§4 已定） |
| Inno Setup `/VERYSILENT` 无感静默安装 | 本应用是 **NSIS**；姊妹项目实证 NSIS `/S` spawn 被拒提权 + 杀软拦，改 `shell.openPath` 非静默 | **不采纳静默**，维持 §7.3。注：真要"无感静默"需换 Inno Setup（大改），暂不做 |
| feedURL 二跳（check→CDN feed JSON） | 本 V2 一跳直接给直链+校验 | 本方案更简，无需补 |
| SHA-512（Base64） | 本 V2 用 **SHA-256（64 hex）** | 按 API 用 sha256（已定） |
| **优雅退出：逐个关子系统再退 + `willRestart` 标记** | 本应用进程树**更重**（bundled Next 服务 + claude SDK 子进程 ~230MB + MCP + bridge + PTY），Windows 覆盖安装会被未退子进程**锁文件** | **采纳并加固**（头号补充）→ §7.2 已写：退出前 await 完整 teardown，确认 `utilityProcess` 子进程树连根杀 |
| 启动后台即下，只提示"重启更新" | 本方案触发时机原未写下载策略 | **部分采纳**：用户最终选**检查只提示、点击才下**（避免移动网络自动下大包）；`pending` 跨会话复用仍保留（§5.1） |
| CDN 301/302 重定向处理 | 下载器原未写明 | **采纳** → §5.1 `downloader.ts` 已加"跟随 30x 重定向" |
| 双版本号（appVersion semver + buildVersion 单调递增） | 本 V2 单 `version` 字符串精确比较（决策 #1） | 维持单版本；`pending`">当前版本"假定 version 可 semver 解析，**不可解析时退化为"≠"判断**（实现注意） |
| 代码签名免 SmartScreen | Windows 侧 `electron-builder.yml` **未见签名配置** → `shell.openPath` 拉起未签名 exe 会触发 SmartScreen | **记为风险/协调项**：Windows 代码签名（打磨项，影响升级体验顺滑度，见 §10） |
| 回滚机制（装前备份旧目录，失败回滚） | 姊妹项目 + 本方案均未做 | **记为未来加固**，本期不做（NSIS 就地覆盖；失败兜底靠重新下载安装） |
| 增量 / 差量更新（bsdiff/delta） | V2 返回**全量**直链，无 delta | 超出本期，需服务端支持，未来评估 |
| 安装日志 `/LOG` | 姊妹项目已用 Node `fs` 写日志（§7.2） | 已覆盖 |
| 静默安装后 `CurStepChanged(ssPostInstall)` 自启 | NSIS 非静默向导 `runAfterFinish` 默认自启 | 已覆盖（§7.3 时序末"启动新版"） |

**结论**：Trae 方案在"安装器静默化 / electron-updater feed"上与本方案路线不同（因技术栈与 V2 接口形态不同），不采纳；但它的**进程优雅退出**、**后台预下载策略**、**重定向处理**、**Windows 签名**四点对本方案是有效补充，已分别落到 §7.2 / §5.1 / §10。无遗漏的硬缺口。

---

> 本文档仅为**实施方案**，等待审核。批准后按 Phase 0→4 推进，每 Phase 完成更新本表状态与决策日志；功能整体完成后补 `docs/handover/updates-v2.md` 与 `docs/insights/updates-v2.md`。
