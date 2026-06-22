# 测试账号设置（产品思考）

> 技术实现见 [docs/handover/test-account-settings.md](../handover/test-account-settings.md)

## 解决什么用户问题

用户用 CodePilot 驱动 AI_LabTest 做 UI 自动化测试。测试要登录被测系统，账号/环境配置散落在各处：AI_LabTest 桌面端有个「环境配置」弹窗写 `environments.json`，但**一个文件只能配一个系统**。实际工作里一个人要测多个系统（订单、用户中心、后台…），每个系统又有 local/SIT 两套环境、多个角色账号、不同登录方式。每开一个测试就手填一遍 URL + 账号，或在多个 AI_LabTest 工作区之间来回切，很累且易错。

诉求：在 CodePilot 设置里有**一个常驻的地方**，集中管理多个系统的测试账号，一键导出给 AI_LabTest 用。

## 为什么这样设计

### 多系统 = 多个 AI_LabTest 工作区，而不是一个大文件

核验 AI_LabTest 源码后发现：它是「单系统单 `environments.json`」，环境**硬白名单** `local` + `sit`，没有 systems 概念，连 UAT 都拒。所以 CodePilot 的「多系统」只能落成**多个工作区目录**，每个系统绑定一个 `projectRoot`，导出到各自的 `{projectRoot}/AI_LabTest/environments.json`。

这带来一个用户可见的设计点：**每个系统必须选一个项目目录**。这不是多余负担——它正是「这个系统的 AI_LabTest 在哪」的锚点，也是导出/抓取登录态能落到正确位置的前提。环境标签固定 local/SIT，不开放自定义，是为了和 AI_LabTest 白名单对齐（填了它也不认）。

### 常驻面板而非弹窗

参考的 AI_LabTest 是弹窗式「环境配置」。CodePilot 要管多个系统，弹窗装不下，所以做成设置页里的**常驻面板**（系统下拉切换 + 环境标签页），和 Providers/Bridge 等其他设置一致。

### 抓取归 CodePilot，重放归 AI_LabTest

「获取登录态」是这套里最复杂的能力：打开浏览器登录一次、抓 cookie+localStorage、之后免源码重放（SPA 最稳）。但「重放」是 per-site、易碎的活。核验发现 AI_LabTest 已经实现了重放（`--storage-state` 喂给 Playwright）。所以 CodePilot **只做抓取 + 按 Playwright storageState 格式写文件**，重放交给 AI_LabTest。这一刀切下去，让「v1 完整实现获取登录态」从「中-高风险」变成可控——我们只需保证**输出文件格式**和 AI_LabTest 期望的一字不差。

### 为什么用 Electron BrowserWindow 抓取，而不是 Playwright

AI_LabTest 自己用 Playwright Chromium 抓。但 CodePilot 打包不含 Playwright 浏览器（`@playwright/test` 只是 devDependency）。为抓登录态而打进一个 Chromium 太重。CodePilot 本就是 Electron，开一个 BrowserWindow 让用户登录、再用 `session.cookies` + `executeJavaScript` 读 localStorage，手工拼成 Playwright storageState 形状即可——零新增依赖。代价是要自己做 Electron→Playwright 的 cookie 字段映射，用单测兜住。

### 明文存储

参考的 AI_LabTest 把账号密码/token 明文写在 `environments.json`。CodePilot 数据库虽有现成的 seal/open 加密层（给 API 密钥用），但这次用户选了**明文存本地库**——和 AI_LabTest 行为一致、人可读可核对、且 DB 仅本机。这是一次有意识的取舍：测试账号通常是测试环境的弱口令，不是生产凭证；可读性 > 加密。（未来若要测真生产，可把 `environments_json` 接进 seal/open 层，改动很小。）

## 用户反馈驱动的决策（本次确认）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 获取登录态 | v1 完整实现 | 抓取侧由 AI_LabTest 重放兜底，风险可控 |
| 导航 | 系统下拉 + 环境标签页 | 多系统可扩展，贴近原弹窗的标签心智 |
| 数据去向 | 导出到 AI_LabTest/environments.json | 复用现成测试框架，文件系统对接零接口 |
| 密钥存储 | 明文存本地库 | 与 AI_LabTest 一致、可读、本机 |

设计阶段先出了**可点的 HTML 原型**（系统切换、三种登录方式、实时 environments.json 预览）让用户确认逻辑，再落真实代码——避免在多文件实现后才发现模型对不上。其中「实时导出预览」被保留进了正式面板（复用同一份 `toEnvironmentsJson`，预览=真导出，无漂移），让用户随时看清「点导出会写什么」。

## 已知局限与未来方向

- **环境固定 local/SIT**：受 AI_LabTest 白名单约束。若 AI_LabTest 将来支持更多环境，这里要同步放开。
- **登录态对账**：`captured` 标志不在每次加载时与磁盘对账（避免误标「未保存」），应用外删文件会让标志过期。未来可在选目录/切系统时做一次 status 同步。
- **抓取覆盖**：只抓 cookie + localStorage（80% 场景）。用 IndexedDB / Service Worker 存认证态的站点抓不到——与 AI_LabTest 同限制。
- **单向导出**：目前 CodePilot → AI_LabTest 单向写。未来可考虑反向读回（已有 environments.json 导入到面板），让两端不必各填一遍。
- **更紧耦合**：现在靠文件系统对接。若 CodePilot 内置测试编排，可直接读这些配置发起测试，省掉「导出」这一步。
