# 办公模式脱敏网关(deid-gateway)— 技术交接文档

> 产品思考见 [docs/insights/deid-gateway.md](../insights/deid-gateway.md)
> 执行计划(决策日志 D1-D10):[docs/exec-plans/active/deid-gateway.md](../exec-plans/active/deid-gateway.md)
> 最后更新:2026-07-31

## 1. 这是什么

办公(沙箱)会话在把用户内容发给外部模型前,先经 **deid-service** 识别 PII,
弹「脱敏预览」让用户逐项确认,确认后模型只收到 `<PERSON_1>` 这类占位符;
模型回复中的占位符在**渲染前**还原为原文。**研发会话完全没有这条链路**
(不渲染开关、不发任何 deid 请求、`/api/deid/state` PUT 直接 400)。

开关在输入区工具排、推理力度下拉右侧,**会话级持久、默认关**。

**外部服务**:`https://deid-api.ai-native-lab.com`(http 入口 301→https)。
无状态契约:占位符字典(`mapping`)随请求进出,服务端不保存,由本应用按会话持久化。

## 2. 数据流(一次脱敏回合)

```
MessageInput.handleSubmit(officeMode && deidGate 存在 && 文本非空)
  └─ await deidGate(text, hasFiles)                          useDeidGate.ts
       └─ POST /api/deid/text {session_id, text, denyValues?}
            服务端读 chat_sessions.deid_state_json 带上 mapping
            → deid-service POST /v1/deidentify/text
            → 成功后 setSessionDeidState 原子覆盖 mapping(+denyValues)
       └─ DeidPreviewDialog:外发预览(蓝=占位符/黄=保留原文)+ 实体表 + 新增实体
       └─ 确认 → buildOutbound(normalizedText, entities, excluded)  deid-utils.ts
       └─ 取消/失败 → {ok:false} → 不发送、不清输入(fail-closed)
  └─ onSend(脱敏文, files, cliAppend, displayOverride=原文)
       → /api/chat:content=脱敏文(发模型),savedContent=原文(落库/展示)
            · deid 会话追加 recommendedSystemPrompt(/v1/meta,缓存 10min)
            · historyMsgs + summary 反向重脱敏(remaskText)
  └─ 回复渲染:MessageResponse 内 DeidRestoreContext 还原占位符→原文
  └─ 回合末:POST /api/deid/reidentify 检测 unknownPlaceholders → warning toast
```

## 3. 文件地图

**新增**

| 文件 | 作用 |
|---|---|
| `src/types/deid.ts` | 契约类型(Entity/TextResponse/DenyValue/SessionState/PreviewSegment) |
| `src/lib/deid-utils.ts` | 纯函数:`buildOutbound`(契约 §5.4)、`buildPreviewSegments`、`remaskText`、`restoreText`、`containsPlaceholder`、`parseDeidStateJson` |
| `src/lib/deid-client.ts` | 服务端 fetch 封装 + `DeidServiceError` + meta 缓存 + 兜底系统提示词 |
| `src/lib/deid-restore.ts` | `DeidRestoreContext` / `useDeidRestore`(渲染层还原,默认 null=恒等) |
| `src/app/api/deid/text/route.ts` | 文本脱敏代理(双 gate:办公会话 + 开关开) |
| `src/app/api/deid/reidentify/route.ts` | 还原代理(主用于 unknownPlaceholders 检测) |
| `src/app/api/deid/state/route.ts` | GET 会话状态 / PUT 开关(研发会话 400 `DEID_OFFICE_ONLY`) |
| `src/hooks/useDeidGate.ts` | 发送门 + 弹窗状态机 + 串行守卫 |
| `src/components/chat/DeidToggle.tsx` | 输入区开关(盾牌图标,开启时 primary 色 + 「· 开」) |
| `src/components/chat/DeidPreviewDialog.tsx` | 预览确认弹窗 |
| `src/__tests__/unit/deid-utils.test.ts` | 16 条纯函数单测 |

**改动**

| 文件 | 改了什么 |
|---|---|
| `src/lib/db.ts` | 两列迁移 `deid_enabled` / `deid_state_json` + `updateSessionDeidEnabled` / `getSessionDeidState` / `setSessionDeidState` |
| `src/types/index.ts` | `ChatSession` 两字段 |
| `src/app/api/chat/route.ts` | deid 会话:历史/摘要 `remaskText` + `systemPromptAppend` 追加推荐提示词 |
| `src/app/api/settings/app/route.ts` | ALLOWED_KEYS += `deid_api_url` / `deid_api_key` |
| `src/components/chat/MessageInput.tsx` | 三个 prop(`deidEnabled`/`onDeidToggle`/`deidGate`)、主路径与 badge 路径过门、开关渲染、办公会话不进图像 Agent 分支 |
| `src/components/chat/ChatView.tsx` | 状态载入/翻转、`DeidRestoreContext.Provider`、unknownPlaceholders 检测、弹窗挂载 |
| `src/components/ai-elements/message.tsx` | `MessageResponse` 消费还原 context(单点) |
| `src/i18n/{en,zh,zh-HK}.ts` | `deid.*` 32 键(zh-HK 手加,勿跑 gen 脚本) |

## 4. DB schema

```sql
ALTER TABLE chat_sessions ADD COLUMN deid_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN deid_state_json TEXT NOT NULL DEFAULT '';
-- deid_state_json = {"mapping":{"<PERSON_1>":"张伟",...},"denyValues":[{"text":"登月项目","entity_type":"PROJECT"}]}
```

`deid_state_json` **含明文 PII**,敏感级别等同 `messages.content`(同库同暴露面,
未额外加密 —— 与消息正文同级即可,不做不对称保护)。会话删除随行删除。

## 5. 配置

| 项 | 优先级 | 默认 |
|---|---|---|
| 服务地址 | `DEID_API_URL` env > settings `deid_api_url` > 内置 | `https://deid-api.ai-native-lab.com` |
| 调用密钥 | `DEID_API_KEY` env > settings `deid_api_key` > 内置 | `cmwork-desktop` |

两个 setting 在 ALLOWED_KEYS 里但**无设置 UI**(运维/调试用)。密钥仅作调用方
归因(deid-service 接受任意非空值,日志只存 SHA-256 短指纹),故不进
`SENSITIVE_SETTINGS`;renderer 永不接触密钥,一律走 `/api/deid/*` 代理。

## 6. 关键设计决策(为什么这么做)

**展示原文 / 外发脱敏的分离,复用现成 `displayOverride`。** renderer 把脱敏文作
`content`、原文作 `displayOverride` 传下去。`/api/chat` 本来就用 displayOverride
落库,于是 DB 的 user 消息天然是原文,用户气泡显示原文,而 SDK prompt 是脱敏文。
零新协议字段。

**代价与补偿:历史回灌重脱敏。** 因为 DB 存原文,SDK resume 失效或上下文压缩时,
`conversationHistory` / `context_summary` 会从 DB 回灌给外部模型 —— 那是原文。
所以 `/api/chat` 在构建 `historyMsgs` 后对 deid 会话做 `remaskText`(mapping 反向
替换,长原文优先防「张伟丽」被「张伟」截断)。**已知误差**:用户当初"取消脱敏"
的实体在历史回灌中也会被替换成占位符 —— 安全方向的过度替换,接受。

**还原放渲染层单点,不改存储。** DB 里 assistant 消息保存服务端原样(含占位符),
`MessageResponse`(所有 markdown 文本的唯一渲染出口)消费 `DeidRestoreContext` 做
还原。好处:流式与历史消息共用一条路径,不需要在 SSE 增量里做替换;context 变更
天然绕过 `MessageResponse` 的 memo(memo 只比较 children,而 context 更新不受 memo
拦截),mapping 更新后历史消息立即用上新字典。thinking / tool_use 块**不还原** ——
正是交互文档说的「模型原始返回」详情语义。

**fail-closed。** 脱敏接口任何失败(网络/401/502)都不发送,弹窗只有「取消」按钮,
输入框内容保留。只有 `llmError`(LLM 层降级但规则/NER 结果可用)显示黄条并允许继续。

**串行。** 契约要求同会话请求串行(并发会产生占位符编号冲突)。预览弹窗天然一次
一条,`useDeidGate` 另有 `pendingRef` 守卫拒绝并发 gate。

## 7. 已知边界(本期不做)

- **附件/图片不脱敏**。文本管道处理不了二进制;图片管道(`/v1/deidentify/image`
  + canvas 重绘)是 P2。预览弹窗在带附件时显示黄色提示。
- **非 composer 路径不过门**:桥接(微信)消息、`/btw` 侧问、autoTrigger 心跳。
  桥接消息进 deid 办公会话会绕过脱敏 —— 若要覆盖,门必须下沉到 `/api/chat` 服务端
  (但那样就没有"用户逐项确认"这一步了,是产品取舍不是技术障碍)。
- **会话标题**:deid 会话首条消息的即时标题与异步真标题都只见脱敏文(隐私正确,
  观感其次 —— 标题里会出现占位符)。
- **本地还原是精确串替换**,不实现 `/v1/meta` 的别名/NFKC 同值判定;
  unknownPlaceholders 由服务端 `/v1/reidentify` 权威检测。
- NDJSON `?stream=1` 阶段进度未接,弹窗内用 spinner 代替。

## 8. 验证记录(2026-07-31,dev + 真实 deid 服务)

**单测** 16 条(`deid-utils`)全过;全量 `npm run test:unit` 无新增失败
(既有 15 条 `claude-home-shadow` 失败与本改动无关 —— 暂存全部改动后同样失败)。

**真实链路 13 项**(dev server + `https://deid-api.ai-native-lab.com`):

| # | 断言 | 结果 |
|---|---|---|
| 1 | 新办公会话默认 `enabled:false`,mapping/denyValues 为空 | ✅ |
| 2 | 开关未开时 `/api/deid/text` → 400 `DEID_NOT_ENABLED` | ✅ |
| 3 | 真实脱敏:张伟/李娜/13800138000 → `<PERSON_1>/<PERSON_2>/<PHONE_NUMBER_1>` | ✅ |
| 4 | mapping 落库持久 | ✅ |
| 5 | 跨轮复用:第二轮「张伟」仍是 `<PERSON_1>` | ✅ |
| 6 | denyValues 生效:「登月项目」→ `<PROJECT_1>` 且持久化 | ✅ |
| 7 | UI 预览蓝/黄双色 + 取消勾选后按钮变「确认发送(1 项保留原文)」 | ✅ |
| 8 | 新增实体「下午开会」→ 重跑得 `<CUSTOM_1>` | ✅ |
| 9 | 确认发送后 `[chat API] content` 收到的是脱敏文,气泡显示原文 | ✅ |
| 10 | 渲染层还原:含占位符的 assistant 消息显示为原文,未知占位符原样保留 | ✅ |
| 11 | unknownPlaceholders → warning toast(DOM 实测文案正确) | ✅ |
| 12 | 研发会话:无开关按钮、零 deid 请求、PUT 开关 400 `DEID_OFFICE_ONLY` | ✅ |
| 13 | fail-closed:地址指向不可达端口 → 502,弹窗提示「内容尚未发送」,消息列表零新增、输入框内容保留 | ✅ |

console 全程无 error/warn。测试会话与临时 setting 已清理。

## 9. 排障

- **开关点了没反应**:`PUT /api/deid/state` 失败会静默回滚开关态。看 Network;
  400 `DEID_OFFICE_ONLY` = 会话不是办公会话。
- **预览弹窗一直转圈**:`/api/deid/text` 上游慢(LLM 层实测 ~0.7s,超时 30s)。
  `/health` 的 `llm` 字段若为 `unreachable`,响应会带 `llmError` 并降级。
- **模型回复里占位符没还原**:检查 `GET /api/deid/state` 的 mapping 是否非空 ——
  还原只看 mapping,与开关当前状态无关(关掉开关后历史仍应还原)。
- **模型乱改占位符**:看 `/v1/meta` 的 `recommendedSystemPrompt` 是否被追加
  (deid 会话必追加;meta 不可达时用 `deid-client.ts` 的 `FALLBACK_...` 兜底副本)。
