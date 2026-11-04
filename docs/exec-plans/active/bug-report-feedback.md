# 问题反馈(Bug 上报)— 客户端反馈入口 + 服务端管理页

> 创建时间:2026-07-20
> 最后更新:2026-07-23 · 状态:**S/W/C 已完成,E 联调进行中(首轮暴露并修复线上 500,待重新部署收尾)**
> 跨仓库:客户端 = LabCodepilot,服务端 = codeagent-server(服务端章节批准后可拆副本至该仓库 docs/)

## 目标与范围

- **客户端**:设置新增「问题反馈」菜单 —— 文字描述 + 「附带应用日志」勾选 → 登录态一键上报到服务端。
- **服务端**:admin 管理台新增「用户反馈」页 —— 列表展示全部上报(用户/时间/内容/环境),日志文件可下载。
- 不做(一期):截图/附件、上报后的状态流转(已处理/回复用户)、客户端离线排队重发。

## 数据流总览

```
设置「问题反馈」页(renderer)
   │ IPC feedback:submit { message, includeLog }
   ▼
Electron 主进程 ── 读 main.log(仅当勾选;写入时已经过 scrubSecrets 脱敏,≤5MB)
   │ apiRequest POST /api/v1/feedback(multipart,带登录 Bearer)
   ▼
codeagent-server ── CurrentClaims 取权威身份(sub/username/email)
   │ 日志文件落盘 APP_FEEDBACK_STORAGE_DIR/<uuid>.log;元数据入表 user_feedback
   ▼
admin web「用户反馈」页(AdminClaims)── 列表/详情/日志下载
```

关键信任设计:**上报者身份一律以服务端 JWT claims 为准**(客户端不传、传了也不信),客户端只补充环境信息(app 版本 / 平台 / 系统版本)。

## 一、客户端设计(LabCodepilot)

### 1. 设置入口(复用 Section 注册机制)

`SettingsLayout.tsx`:`Section` 联合类型加 `"feedback"` + nav 数组加项(icon 用现有图标库的 ChatCenteredDots 类)+ render 分支 `<FeedbackSection />`。hash 路由(`#feedback`)随现有机制免费获得。

### 2. FeedbackSection 组件(新)

- 多行文字输入(必填,1–5000 字,带字数计),placeholder 引导写「操作步骤 + 预期 + 实际」。
- 「附带应用日志」checkbox,**默认不勾选**(用户决策:知情后主动选择,不默认上传运行日志),旁注说明:*勾选后附带应用日志(写入时已自动脱敏,API Key/Token 等不会出现),仅含应用运行记录,能显著加快问题定位*。
- 提交按钮:提交中 spinner;成功 toast + 清空表单;失败提示稍后再试(不排队)。
- 未登录态(`useAccountInfo` 无账号):禁用表单并提示「登录后可上报」。
- Web dev 环境(无 `window.electronAPI`):整节显示「仅桌面版可用」—— 与日志按钮同款探测(`GeneralSection` 的 `logsAvailable` 模式)。

### 3. IPC 与主进程(为什么走主进程:登录 token 与日志文件都只在主进程)

- `preload.ts`:`feedback.submit(payload) → ipcRenderer.invoke('feedback:submit', ...)`。
- `main.ts`:`ipcMain.handle('feedback:submit')`:
  1. 校验登录态(未登录返回结构化错误);
  2. `includeLog` 时读**当前 `main.log` 单文件**(logger 轮转保证 ≤5MB;**只传 main.log,不含 main.1-4.log 旧档 —— 用户已定,足够**);
  3. 组 multipart(`message` + 环境字段 + 可选 `log` 文件)经 `apiRequest` POST —— 复用既有超时/401 处理;
  4. 返回 `{ ok } | { ok:false, error }` 给 renderer。
- 隐私基线(现状即优势,方案不新增采集):`electron/logger.ts` 写入时 `scrubSecrets` 已过滤 env 值与 `*_API_KEY/_TOKEN/_SECRET` 形态字符串,auth 层日志本就 maskToken。上报**不读取**对话内容/DB,仅 main.log。

### 4. i18n / 测试

- `zh.ts` / `en.ts` / `zh-HK.ts`(HK 手工加,勿跑 regen)约 10 个 key。
- 单测:IPC handler 的登录态分支与 multipart 组装(mock apiRequest);CDP mock 验证 UI 三态(可交互 / 未登录 / 非桌面)。

## 二、服务端设计(codeagent-server)

### 1. DB(alembic migration 新表 `user_feedback`)

| 列 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | 服务端生成 |
| user_sub / username / email | str | 取自 claims(权威) |
| message | Text | 1–5000 字(服务端复验) |
| app_version / platform / os_version | str | 客户端环境字段 |
| log_path | str nullable | 相对存储根的文件名(`<uuid>.log`);空 = 未附日志 |
| log_size | int | 字节数 |
| created_at | datetime | |

### 2. 日志文件存储

服务器本地目录 `APP_FEEDBACK_STORAGE_DIR`(默认 `./data/feedback-logs/`),文件名 = 记录 UUID(**不用用户提供的文件名,杜绝路径注入**)。不入 DB blob(5MB×N 撑库),不上 OSS(一期从简)。上限:`log ≤ 6MB`(客户端 5MB 轮转上限 + 余量),`message ≤ 5000 字`,超限 413/422。

### 3. API(app/feedback/ 新模块,照 image/cowork 模块结构)

| 端点 | 鉴权 | 说明 |
|---|---|---|
| `POST /api/v1/feedback` | CurrentClaims | multipart/form-data:`message`(必填)+ `app_version`/`platform`/`os_version` + `log`(可选文件)→ 201 `{id}`。**需引入 `python-multipart` 依赖**(FastAPI 表单标准解析,仓库首个上传端点) |
| `GET /api/v1/admin/feedback` | AdminClaims | 分页列表(page/page_size,时间倒序),支持按 username 过滤 |
| `GET /api/v1/admin/feedback/{id}/log` | AdminClaims | FileResponse 下载,`Content-Disposition: attachment; filename="<username>-<日期>.log"`;无日志 404 |
| `DELETE /api/v1/admin/feedback/{id}` | AdminClaims | 删记录+日志文件(管理页操作列) |

防滥用:每用户每小时 ≤ 10 条(内存计数即可,一期不引 redis 结构)。

### 4. admin web(web/src/pages/Feedback.tsx,照 TestUsage 列表页模板)

- 路由 `/feedback` + 侧栏菜单「用户反馈」。
- antd Table:时间 / 用户(username+email)/ 内容摘要(展开抽屉看全文)/ 版本 / 平台 / 日志(大小 + 下载按钮;无日志显示「—」)/ 删除。
- 下载经带 token 的 axios blob(与现有 admin 请求封装一致)。

### 5. 服务端测试

组件级:未登录 401 / 非 admin 403 / multipart 落库+文件落盘 / 超限 413 / message 复验 / 下载往返字节一致 / 删除联动删文件 / 路径注入防护(文件名与请求参数无关)。集成级:真 JWT → claims 身份落库正确(复用 cowork 集成测试的 conftest 基建)。

## 三、实施顺序与验收

| Phase | 内容 | 验收 | 状态 |
|---|---|---|---|
| S(服务端 API) | migration + 模块 + 测试 | pytest 全绿;curl multipart 手测 201 + 文件落盘 | ✅ 2026-07-23(codeagent-server feat/user-feedback 547612d;82 passed;本地 PG+假 JWKS 真服务 curl 六项全过:401/201+UUID 落盘/403/列表/下载字节一致/删除联动) |
| W(admin web) | Feedback 页 + 菜单 | 本地起 web,列表/下载/删除可用 | ✅ 2026-07-23(4258b70;tsc+vite build 过;浏览器实测列表/抽屉/下载 200/删除 204/过滤) |
| C(客户端) | Section UI + IPC + 主进程上传 + i18n | 单测全绿;CDP mock 三态;`npm run test` 零回归 | ✅ 2026-07-23(LabCodepilot para;feedback-core 9 单测;全量 1929 pass;浏览器 mock 三态 + 提交 payload/清空验证,console 零报错) |
| E(联调) | 真实客户端上报 → admin 页看到并下载日志比对字节 | 端到端闭环 | 🔄 进行中(2026-07-23 首轮暴露线上 500,已修并在真实镜像上验证;待生产重新部署后收尾) |

### E 首轮结果(2026-07-23)

**跑法**(比"必须打包版"更轻,且覆盖同样的真实链路):隔离数据目录
(`CLAUDE_GUI_DATA_DIR` 指向 DB 快照 + token 副本,避免污染日常环境)+
`BACKEND_BASE=https://code-agent.ai-native-lab.com` 启动 electron,
`--remote-debugging-port` 挂 CDP 直接调 `window.electronAPI.feedback.submit`。
与打包版的差异仅剩 `app.isPackaged` 分支与版本号。

结果:
- ✅ 不带日志 → 201(`bbd75a7b-…`,生产库有记录)
- ❌ 带日志 → **500**。二分定位:未鉴权 3MB 请求体能穿过反代返回 401 →
  排除反代限制,问题在应用层。
- **根因**:镜像 `COPY --from=builder /app /app` 产物属 root,容器以非 root 的
  `app` 用户运行,而 `APP_FEEDBACK_STORAGE_DIR` 默认相对路径落在 `/app` 下 →
  `mkdir` PermissionError → 未捕获 → 裸 500。已用同构容器复现
  (`uid=999`,`/app` 属 root → `PermissionError: 'data'`)。
- **修复**(codeagent-server `d554918`):镜像预建 `/data/feedback-logs` 并
  chown;compose 显式配 `APP_FEEDBACK_STORAGE_DIR=/data/feedback-logs` + 挂
  named volume(继承镜像属主,免宿主机 chown);落盘失败改抛
  `FeedbackStorageError` → 503 + 带 `storage_dir` 的错误日志。
- **修复验证**(在**真实生产镜像**上,非宿主机 uvicorn):3MB 带日志上报 201 →
  卷内文件属 `app:app`/3145728 字节 → admin 下载 200 且**字节完全一致** →
  删除 204 且文件联动清除;另起一个故意不配变量的实例,确认降级为 503 +
  日志含 `Permission denied: 'data'`,且不带日志的上报仍 201。

**待收尾**:生产 `docker compose up -d --build backend` 后,重跑一次带日志上报,
并在 admin「用户反馈」页确认记录 + 下载日志。

## 四、已定决策(用户拍板,2026-07-20)

1. **日志默认不勾选** —— 用户知情后主动选择是否上传运行日志,不默认采集。
2. **上报数据不自动清理** —— 不设 TTL/定时任务;由 admin 在管理页手动删除。日志文件随记录删除一并清。
3. **只传当前 main.log** —— 不做「含旧日志档 main.1-4.log」选项。更早的问题若已轮转出 main.log 则本期取不到,遇到再评估,不预留 UI。

## 决策日志

- 2026-07-23(E 联调):落盘目录的**部署契约**补齐 —— 需要写盘的数据一律放
  `/data`(镜像内 chown 给运行用户),不放 `COPY` 进来的只读 `/app`;compose 用
  named volume 而非 bind mount,理由是前者创建时继承镜像内属主,不需要在宿主机
  上按容器 uid 手工 chown(代价:`docker compose down -v` 会清空,运维流程需避开
  `-v`)。同时确立一条口径:**部署配置问题不许表现为裸 500** —— 落盘失败一律
  转成 503 + 带 `storage_dir` 的结构化错误日志,否则线上只能看到没有上下文的
  500,定位成本极高。

- 2026-07-20:方案成文并经用户拍板三项(见上「已定决策」)。架构决策:上报者身份以服务端 JWT claims 为准(客户端不传身份)/ 日志走 Electron 主进程读取并 multipart 上传(token 与文件都只在主进程)/ 日志文件服务端落盘不入 DB / 存储文件名用服务端 UUID(防路径注入)。
