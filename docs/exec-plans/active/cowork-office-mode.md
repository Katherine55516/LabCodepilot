# Cowork 办公模式 — 「研发 / 办公」双栏切换(P1-E 重定义)

> 创建时间:2026-07-13
> 最后更新:2026-07-13
> **取代** [cowork-vm-mode.md](./cowork-vm-mode.md) 中 P1-E「入口正式化」的原方案(原 P1-E 的四项内容全部吸收进本计划,见 §与原 P1-E 的关系)。
> 沙箱底层(P1-A~D,已完成)不动:转发桥 / vsock 通道 / VM 生命周期 / 产物落库,见 [docs/handover/cowork-vm-mode.md](../../handover/cowork-vm-mode.md)。

## 目标

参照 Claude 桌面版的「Home / Code」切换,在**对话记录列表上方**加两个切换栏:

- **研发**(现有的一切):按项目文件夹分组的会话、文件树 / Git / diff / worktree / 任务面板、宿主执行。**零改动、零回归。**
- **办公**(cowork + 沙箱):会话**不绑项目文件夹**、列表平铺;每条会话对应 VM 内一个独立路径(`/home/agent/sessions/<id>/workspace`,现状已如此);不同会话的沙箱产物互相隔离(现状已如此,`vm_artifacts_json` 按会话落库);agent 在 VM 内执行,真机文件零接触。

模式在**建会话时定死**(由所在 tab 决定),会话内不再提供沙箱开关 —— 原 POC 的输入条 SandboxToggle 移除。

## 与原 P1-E 的关系

| 原 P1-E 内容 | 去向 |
|---|---|
| 1. 能力边界透明化(外部 stdio MCP 禁用+提示) | 吸收进 **E1**(执行层守卫) |
| 2. 入口正式化(徽标/空态卡/设置开关) | 重定义为 **E3**(双 tab)+ **E5**(设置开关);「会话列表沙箱徽标」被 tab 分栏取代,不再需要 |
| 3. 真机零写入验收(fs_usage) | 保留,**E5** |
| 4. 双文档(handover 更新 + insights 新写) | 保留,**E5** |
| 待拍板 (a) 入口模型 | **已由本方案回答**:建会话时定死(tab 决定),移除会话内开关 |
| 待拍板 (b) 外部 stdio MCP | 本方案推荐:办公会话一律不加载外部 MCP + 明示(见 D4) |

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| E1 | **执行层守卫**(安全底座):沙箱硬失败不落宿主、native runtime 拒绝沙箱会话、外部 MCP 过滤 + 能力边界提示 | ✅ 已完成(2026-07-13) | 新增 cowork-guards.ts + 10 单测(1919 passed);dev+CDP 四场景全过:①cowork 关闭硬失败(错误+横幅+零文件+零进程+日志确认)②native 412 拒绝③正常办公回合(agent 报 VM workspace 路径=系统提示生效,产物卡片正常)④研发回归正常。剔除 MCP 的用户可见提示留 E4 UI 面做(本阶段 console.warn+系统提示已明示 agent) |
| E2 | **数据与创建流**:创建期指定 sandbox_enabled、办公会话宿主暂存目录、删除连带清理 | ✅ 已完成(2026-07-13) | 新增 cowork-staging.ts;createSession+POST 支持创建期沙箱(办公分支默认 full_access,已在 UI 权限按钮验证);dev 六项验证:创建字段/暂存目录、附件落 `<staging>/.codepilot-uploads` 并推 VM、agent 读改产附件产物(内容含 E2-OK)、DELETE 级联删暂存目录、遗留会话(真实项目 wd)删除不误删项目目录;+5 单测(1924 passed) |
| E3 | **侧边栏双 tab**:分段控件 + 按模式过滤 + 办公平铺列表 + 办公新建流 + 空态 | 📋 待开始 | |
| E4 | **办公会话 UI 面**:隐藏全部研发特性、移除 SandboxToggle、保留纯对话+文件收发 | 📋 待开始 | |
| E5 | **正式化收尾**:设置开关 + 状态 API + fs_usage 零写入验收 + 双文档 + 回归 | 📋 待开始 | |

## 决策日志

- 2026-07-13: **P1-E 重定义**。用户决定入口形态从「会话内开关」改为「侧边栏研发/办公双栏」,模式建会话时定死;办公会话不按项目分割。原 P1-E 四项内容全部吸收进本计划。
- 2026-07-13: **D1 模式判别字段 = 复用 `sandbox_enabled`,不加新列**。办公会话 ≡ 沙箱会话,一个字段同时驱动列表过滤、UI 压制、执行判定 —— 单一事实源,杜绝「列表显示办公、执行却落宿主」的漂移。现有 `mode` 列已被 agent 模式(code/plan/ask)占用不可复用(db.ts:421)。备选(未采纳):新增 `workspace_kind` 列,留待 P2/P3 若出现「办公但非本地 VM」(如云执行)的形态再引入,并与 cowork-poc.ts:9 预告的 `execution_target` 一并建模。
- 2026-07-13: **D2 办公会话宿主 cwd = 合成暂存目录 `~/.codepilot/cowork/<sessionId>/`,而非空串**。空串方案需逐点排雷(附件目录 `path.join('', '.codepilot-uploads')` 落进程 cwd、每回合 cwd 回退 warn、以及未知的空 wd 消费者);合成目录保住「每个会话都有有效宿主 wd」这一大量代码隐含依赖的不变量,附件链路零改动(`/api/uploads` 白名单是子串匹配 `.codepilot-uploads`,uploads/route.ts:38-39,任意前缀可服务)。目录在 POST 创建会话时生成。未来 uploads-storage-relocation 计划落地后可自然并入。
- 2026-07-13: **D3 办公会话默认全自动**:创建时 `permission_profile='full_access'`(复用现有机制,连带 skipPermissions),隐藏权限选择器。理由:VM 隔离本身就是权限故事,办公场景不应弹批准;这正是沙箱的产品卖点。备选(未采纳):保留 default+审批弹窗,交互噪音大。
- 2026-07-13: **D4 办公会话不加载任何外部 MCP**(stdio/SSE/HTTP 全部剔除),仅保留内置 in-process `codepilot-*`。stdio 在 VM 内没有 npx/uvx 必然静默失败;SSE/HTTP 理论可用但 P1 求语义简单诚实。配一次性能力提示。备选(未采纳):往镜像装 npx/uvx,成本大、把宿主 MCP 生态半透明搬进沙箱徒增混乱。
- 2026-07-13: **D5 两个调研新发现的安全缺口必须先修(E1 先行)**:① 沙箱回合 decideCowork 失败后代码继续走宿主执行(claude-client.ts:841-848 只发 vm_status failed 未终止)——POC 的"安全回退"在产品语义下是隔离违约;改硬失败。② native runtime(openai-oauth / cli_enabled=false / agent_runtime=native)完全不感知 sandbox_enabled,办公会话会静默落真机;在 /api/chat 分发前加拒绝守卫。
- 2026-07-13: **D6 tab 只过滤列表,不影响已打开的会话**。切 tab 不导航、不关当前会话;会话界面形态由会话自身的 sandbox_enabled 决定。办公 tab 仅在全局 `cowork_enabled==='true'` 时显示(内部试用门,经状态 API 下发)。
- 2026-07-13: **D7 i18n 纪律**:en/zh/zh-HK 三份**全部手工添加**;不跑 `gen-zh-hk.mjs`(它会回退 ~40 个港式术语,历史教训)。文案:研发/研發/Code,办公/辦公/Work(en 可再议)。

## 详细设计

### 产品交互规格

```
┌─ 侧边栏 ──────────────────┐
│ [新对话] [搜索]            │
│ ┌───────────┬───────────┐ │   ← 新增分段控件(复用 ui/tabs.tsx,
│ │  🏠 办公   │ </> 研发  │ │      仿 ModeIndicator.tsx 样板)
│ └───────────┴───────────┘ │
│ ── 办公 tab ──            │   ── 研发 tab ──
│  会话A   3分钟前           │    ▼ 项目Alpha
│  会话B   昨天              │       会话x
│  会话C   3天前             │       会话y
│  (平铺,updated_at 倒序)   │    ▼ 项目Beta …(现状不动)
└───────────────────────────┘
```

- **tab 状态**:localStorage `codepilot:workspace-tab`('dev'|'office',默认 'dev'),仿 `codepilot:collapsed-projects` 惯例(chat-list-utils.ts:5)。
- **列表过滤**:办公 = `sessions.filter(s => !!s.sandbox_enabled)` 平铺;研发 = 其余,走现有 `groupSessionsByProject`(chat-list-utils.ts:30)。存量 POC 沙箱会话(带真实项目路径)自动归入办公 tab,平铺展示,无需迁移。
- **新对话按钮跟随 tab**:研发 tab = 现有 `handleNewChat`(ChatListPanel.tsx:158);办公 tab = 办公创建流(见 E2/E3),不弹文件夹选择器。「新建项目」按钮(ChatListPanel.tsx:545)仅研发 tab 显示。
- **办公空态**:办公 tab 无会话时,列表区显示介绍卡(沙箱说明 + 「开始办公对话」按钮 + VM 镜像未预置时的提示)。
- **切 tab 不导航**(D6):只换列表,当前打开的会话不动。
- **办公 tab 可见性**:`cowork_enabled !== 'true'` 时整个分段控件隐藏(单 tab 无意义),应用回到现状外观 —— 未开启 cowork 的用户零感知。

### E1 执行层守卫(先做,安全底座)

1. **硬失败不落宿主**(claude-client.ts:841-848):`sess.sandbox_enabled && !decision.useSandbox` 时,发 `vm_status failed` + error SSE 后**终止本回合**(close stream,不进 SDK query)。错误文案按 `decision.reason` 区分(cowork 未开启 / 镜像未预置 / VM 启动失败)。前端 VmProvisioningBanner 的 failed 态已有(VmProvisioningBanner.tsx:21-29),补 error 消息展示即可。
2. **native runtime 守卫**:/api/chat 分发前,`session.sandbox_enabled && predictNativeRuntime(effectiveProviderId)`(runtime/registry.ts:100)→ 直接返回错误 SSE,不进任何 runtime。办公会话实际用 managed 模型(必走 SDK,见 managed-cli-alias 纪律),此守卫是纵深防御(防全局 `agent_runtime=native` / `cli_enabled=false` 误伤)。
3. **外部 MCP 过滤**(D4):claude-client cowork 分支内,`queryOptions.mcpServers` 只保留 in-process 内置 server(`codepilot-*`);同时 gate 掉 `.mcp.json` 项目级重注入(claude-client.ts:888-894)。被剔除的 server 名单发一次 SSE 提示(或并入 vm_status),前端在办公会话显示轻量说明(tooltip/一次性 chip)。
4. **能力边界系统提示**:coworkActive 时给 systemPrompt append 一小段(你在隔离 VM 内工作、工作目录为会话 workspace、宿主文件与外部 MCP 不可用、产物放 workspace 会自动出现在下载卡片)。
5. 单测:守卫分支(sandbox+native 拒绝、decideCowork 失败终止)、MCP 过滤纯函数。

### E2 数据与创建流

1. **创建期指定沙箱**:`CreateSessionRequest`(types/index.ts:415)+ `POST /api/chat/sessions`(sessions/route.ts:18)+ `createSession`(db.ts:1173)支持 `sandbox_enabled`(现状只能建后 PATCH)。
2. **办公暂存目录**(D2):POST 带 `sandbox_enabled:1` 且未给 `working_directory` 时,服务端生成 `~/.codepilot/cowork/<sessionId>/` 并 mkdir,作为 working_directory/sdk_cwd 落库(先建目录,再走现有存在性校验,route.ts:30-38 不必放宽)。附件沿现有链路落 `<暂存>/.codepilot-uploads/`(chat/route.ts:212-224 零改动),消息气泡预览走 /api/uploads 不变。
3. **权限**:办公创建时 `permission_profile='full_access'`(D3,createSession 已有该参数)。
4. **删除连带**:DELETE 已清 VM 目录(sessions/[id]/route.ts:124-131),补清宿主暂存目录。
5. **PATCH `sandbox_enabled` 保留 API 但下线 UI**(E4 移除 SandboxToggle);标注 internal/test-only。
6. 单测:办公创建(目录生成/字段落库)、删除级联。

### E3 侧边栏双 tab

1. **分段控件**:ChatListPanel 顶部动作条(~506)与分区标题(~541)之间插入;复用 `ui/tabs.tsx` 的 TabsList/TabsTrigger,样式仿 `ModeIndicator.tsx:14-38`。图标:办公=Home/Shield 系,研发=Code 系(现有 icon 集内选)。
2. **过滤与平铺**:见交互规格;办公列表复用 `SessionListItem`(本就不依赖分组,SessionListItem.tsx:51),跳过 ProjectGroupHeader。
3. **办公新建流**:办公 tab 的「新对话」→ 直接 POST(sandbox_enabled:1,无需选目录)→ `router.push('/chat/<id>')`,与研发 tab 的 handleNewChat 对称。
4. **办公空态卡** + 状态感知(镜像未预置 → 提示文案,数据来自 E5 状态 API;E3 阶段可先只做静态卡)。
5. **办公 tab 隐藏研发专属操作**:「新建项目」按钮、会话项菜单中的「分屏」。
6. i18n:`workspace.tab.office` / `workspace.tab.dev` / 空态文案等,三语手工添加(D7)。
7. 注意:`groupSessionsByProject` 还被 SkillsManager.tsx:60 复用 —— 不改其签名,过滤在调用侧做。

### E4 办公会话 UI 面

**信号源**:PanelContext(usePanel.ts)新增 `isOfficeSession`,由 `[id]/page.tsx` 载入会话时按 `session.sandbox_enabled` 设置(同 setWorkingDirectory 时机,[id]/page.tsx:40-58);ChatView 内继续用已有的 `sandboxEnabled` prop 链。

**隐藏矩阵**(★ = 已有 gate 叠加一个条件即可):

| UI 元素 | 位置 | 处置 |
|---|---|---|
| 整个 PanelZone(文件树/Git/todo/preview/dashboard/助理) | AppShell.tsx:637 ★ | `&& !isOfficeSession` 一处压制 |
| 顶栏 Git/文件树/任务/Dashboard 四按钮 | UnifiedTopBar.tsx:230-302 ★ | 办公隐藏 |
| 顶栏项目文件夹 chip(会显示暂存路径) | UnifiedTopBar.tsx:187-215 | 办公隐藏 |
| 会话首开强制打开文件树 | [id]/page.tsx:156 | 办公跳过 |
| ModeIndicator(code/plan) | ChatView.tsx:1189 | 办公隐藏(计划模式=研发流) |
| ChatPermissionSelector | ChatView.tsx:1192 | 办公隐藏(D3 全自动) |
| **SandboxToggle** | ChatView.tsx:1197-1202 | **彻底移除**(双 tab 取代;组件与 i18n key 一并清理) |
| DiffSummary | MessageItem.tsx:778 ★★ | 已按 sandboxEnabled 隐藏,不动 |
| RewindButton(checkpoint 回滚) | MessageList.tsx:315 | 办公隐藏(跨 VM 恢复语义未验证) |
| SlashCommandButton / CLI 工具按钮 | MessageInput.tsx:984,987 | 办公隐藏(技能/CLI 均宿主侧概念,VM 内不可用) |
| @ 文件引用触发 | MessageInput.tsx:366-411 | 办公禁用(引用的是宿主路径,对 VM 无意义;附件按钮才是办公的文件入口) |
| 会话项「分屏」菜单 | SessionListItem.tsx:125-177 | 办公隐藏 |

**保留**:MessageList/MessageInput 主体、AttachFileButton(文件"发")、VoiceInputButton ★、ModelSelectorDropdown(managed-only,正交)、EffortSelectorDropdown ★、RunCockpit(上下文用量,非研发专属)、VmArtifactsCard ★(文件"收")、VmProvisioningBanner ★、QuickActions 记忆 chips。

**CDP 验证**:办公会话逐项截图确认隐藏矩阵;研发会话截图确认零变化。

### E5 正式化收尾

1. **状态 API**:`GET /api/cowork/status` → `{ enabled, imageProvisioned, vmPhase }`(读 getSetting + isImageProvisioned + getStatus),供 tab 可见性与办公空态用。
2. **设置开关**:设置页新增「Cowork 沙箱(实验性)」区,开关写 `cowork_enabled`(现状只能手写 DB,db.ts:1653 setSetting 已有)。
3. **fs_usage 真机零写入验收**:一次完整办公回合(上传→agent 改建→下载)期间 `fs_usage -w -f filesys` 监控 next-server + 转发器进程树,证明除 `~/.codepilot/`(DB/暂存)与用户主动下载落点外零写入;产出记录存档到 handover 文档。
4. **回归**:`npm run test` 全绿 + `test:smoke`;研发模式行为零回归(cowork_enabled 关闭时新代码不可达,现状外观)。
5. **双文档**:更新 [handover/cowork-vm-mode.md](../../handover/cowork-vm-mode.md)(§7 未完成改双栏方案、§2 文件地图补新文件);新写 [insights/cowork-vm-mode.md](../../insights/cowork-vm-mode.md)(为什么双栏而非开关、拷贝语义 vs 官方挂载、能力边界取舍),互链。
6. 打包 DMG 交付用户实测;push 待用户指示。

## 验收标准(整体)

1. 研发 tab = 现状零回归(分组/新建/全部研发面板);`cowork_enabled` 关闭时看不到任何新 UI。
2. 办公 tab:新建即聊(不选文件夹)→ 附件进 VM → 产物卡片下载;两条办公会话的产物/工作区互不可见(sessionId 隔离)。
3. 隔离刚性:VM 不可用时办公回合**硬失败**(横幅+错误),绝不落宿主;native runtime 组合被拒;外部 MCP 不加载且有明示。
4. fs_usage 零写入记录在案。
5. `npm run test` 全绿,新增单测覆盖:守卫分支、MCP 过滤、办公创建/删除级联、列表过滤。

## 风险与开放问题

- **内置 in-process MCP(memory 等)在沙箱回合的可用性**:工具执行在宿主 SDK 进程、经 stream-json 控制通道过河,理论可用但未专项验证 —— E1 加一条验证项;memory 写宿主 assistant workspace 属产品特性(app 数据面),在 insights 文档中作为能力边界明示。
- ~~**en 文案**~~:已定(2026-07-13 用户确认):办公=**Work**,研发=**Code**;zh「办公/研发」,zh-HK「辦公/研發」。
- **办公会话的 SDK cwd 传给 VM 内 claude**:与现状 POC 会话相同(宿主路径在 VM 内不存在,daemon 已 cd 到 workspace,P0-P1 E2E 均通过),无新增风险。
- **PATCH sandbox_enabled 遗留 API**:UI 移除后成为 internal;若担心误用可在 E5 顺手加 guard(已建会话禁改),暂不强制。
