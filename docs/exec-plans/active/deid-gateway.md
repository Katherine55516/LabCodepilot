# 办公模式脱敏网关对接(deid-service)

> 创建时间:2026-07-31
> 最后更新:2026-07-31
> 对接文档:用户提供的《第三方系统脱敏功能交互设计》+ openapi.yaml(deid-service 1.0,无状态契约)
> 目标服务:`https://deid-api.ai-native-lab.com`(http 入口 301 → https,已实测;`/health` analyzer=ok)

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| P1-a | DB 列 + 类型 + 纯函数工具(deid-utils)+ 单测 | ✅ 已完成 | 16 条单测全过 |
| P1-b | 服务端:deid-client + /api/deid/* 三路由 + chat route(系统提示词追加 + 历史重脱敏) | ✅ 已完成 | |
| P1-c | 渲染端:开关 + 预览确认弹窗 + 发送门 + 渲染层还原 + unknownPlaceholders 告警 + i18n | ✅ 已完成 | |
| P1-d | 验证:npm run test + CDP 真实链路验证(真 deid 服务)| ✅ 已完成 | 13 项断言全过,console 干净 |
| P2 | 图片脱敏(/v1/deidentify/image + canvas 重绘)| 📋 待开始 | 本期不做,见边界 |

## 决策日志

- 2026-07-31 D1: **开关默认关、会话级持久**(`chat_sessions.deid_enabled`)。交互文档建议"生产默认开启不可关闭",但用户明确要求"用户可自行开关"→ 以用户需求为准;默认关保证存量办公会话零行为变化。研发会话不渲染开关、服务端逻辑全部 gate 在 `sandbox_enabled && deid_enabled`。
- 2026-07-31 D2: **展示/外发分离复用现成 `displayOverride` 机制**。renderer 把脱敏后文本作为 `content` 发送、原文作为 `displayOverride` → DB user 消息存原文(展示层天然显示原文),模型只见脱敏文。零新协议字段。
- 2026-07-31 D3: **历史回灌重脱敏(服务端)**。`/api/chat` 的 conversationHistory 从 DB 读的是原文(D2 的代价),SDK resume 失效/上下文压缩时会回灌给模型 → 在 route.ts 构建 historyMsgs 处,对 deid 会话用 mapping 做 反向替换(原文→占位符,长词优先)。用户在预览中"取消脱敏"的实体会被过度替换(安全方向的误差),接受。
- 2026-07-31 D4: **mapping/denyValues 存会话级 `deid_state_json`,由服务端在 /api/deid/text 成功后原子覆盖**(契约 §2/§9)。串行由预览弹窗 UI(一次一条)+ inFlight 守卫保证。会话删除随行删除;不复用跨会话。
- 2026-07-31 D5: **还原走渲染层单点**:`MessageResponse`(所有 markdown 文本的唯一渲染出口)内用 context 做占位符→原文替换;DB assistant 消息存服务端原样(含占位符)。回合完成后调 `/v1/reidentify` 仅用于 unknownPlaceholders 检测(toast 告警),不用于展示替换。thinking/tool 块保持原样 = 交互文档"模型原始返回"详情语义。
- 2026-07-31 D6: **附件不脱敏**(文本管道无法处理任意二进制;图片管道 P2)。预览弹窗在带附件时显示黄色提示。
- 2026-07-31 D7: **API key 服务端持有**:`DEID_API_URL`/`DEID_API_KEY` env > settings(`deid_api_url`/`deid_api_key`,进 ALLOWED_KEYS,无 UI)> 默认(`https://deid-api.ai-native-lab.com` / `cmwork-desktop`)。deid-service 密钥仅作调用方归因(任意非空即可),不属于高敏凭证,不进 SENSITIVE_SETTINGS。
- 2026-07-31 D8: **fail-closed**:脱敏接口失败(网络/401/502)→ 不发送、保留输入、提示"脱敏服务暂不可用,内容尚未发送";`llmError` 降级 → 黄条提示但允许继续(契约 §11)。
- 2026-07-31 D9: **recommendedSystemPrompt 服务端追加**:chat route 检测 deid 会话后,从 `/v1/meta`(内存缓存 10min)取推荐提示词拼进 systemPromptAppend;meta 不可达时用硬编码兜底副本(实测抓取的全文)。
- 2026-07-31 D10: 未检测到实体也弹轻量确认("将按原文发送",契约 §11);实体 `action!=='anonymized'`(kept/allowlisted/unlocated)只读展示不可勾选(契约 §5.2)。

## 详细设计

### 数据流(一次脱敏回合)

```
MessageInput.handleSubmit(办公 && 开关开 && 文本非空)
  → POST /api/deid/text {session_id, text, denyValues?}     [Next 服务端持 key 代理 deid-service,
      服务端读 deid_state_json 带上 mapping,成功后原子覆盖 mapping]
  → 预览弹窗:外发预览(蓝=占位符/黄=保留原文)+ 实体表(勾选/取消/新增)+ 降级黄条
      - 新增实体:denyValues += {text,entity_type} → 重新调 /api/deid/text 整体替换预览
      - 取消:关弹窗,输入框内容保留(gate 在 setInputValue('') 之前)
  → 确认:客户端按 normalizedText 偏移重建外发文本(buildOutbound,契约 §5.4)
  → onSend(outbound, files, systemPromptAppend, displayOverride=原文)
  → /api/chat:content=脱敏文(发模型+作为 sdk prompt),savedContent=原文(DB/展示)
      - deid 会话:systemPrompt 追加 recommendedSystemPrompt;historyMsgs 反向重脱敏(D3)
  → 回复流式渲染:MessageResponse 内 context 替换占位符→原文(D5)
  → completed:POST /api/deid/reidentify 检测 unknownPlaceholders → toast 告警
```

### 触点清单

- `src/lib/db.ts` — `deid_enabled`/`deid_state_json` 两列(safeAddColumn)+ get/set helpers
- `src/types/index.ts` — ChatSession 两字段;`src/types/deid.ts` 新建(实体/响应/状态类型)
- `src/lib/deid-utils.ts` 新建 — 纯函数:`buildOutbound`(§5.4 客户端重建)、`remaskText`(D3 反向替换)、`restoreText`(D5 还原);单测 `src/lib/__tests__/deid-utils.test.ts`
- `src/lib/deid-client.ts` 新建 — 服务端 fetch 封装 + meta 缓存 + 兜底提示词
- `src/app/api/deid/{text,reidentify,state}/route.ts` 新建 — 会话校验(isSessionVisibleToCurrentUser + sandbox gate)
- `src/app/api/chat/route.ts` — deid 会话:历史重脱敏 + systemPromptAppend 追加
- `src/app/api/settings/app/route.ts` — ALLOWED_KEYS += deid_api_url/deid_api_key
- `src/components/chat/DeidToggle.tsx` 新建 — 输入区工具排(effort 下拉右侧,红框位),仅 officeMode
- `src/components/chat/DeidPreviewDialog.tsx` 新建 — 预览确认弹窗
- `src/components/chat/MessageInput.tsx` — handleSubmit 主路径 + badge 路径过 deid gate(await,取消不清输入);imageGen 路径加 `!officeMode` 守卫
- `src/components/chat/ChatView.tsx` — deid 状态载入(GET /api/deid/state)/开关回写/RestoreProvider/完成后 unknown 检测
- `src/components/ai-elements/message.tsx` — MessageResponse 内 useDeidRestore()(context 默认恒等,memo 兼容:context 变更绕过 memo)
- `src/i18n/en.ts` + `zh.ts` + `zh-HK.ts`(手加,勿跑 gen 脚本)— `deid.*`

### 边界(本期不做,已知限制)

- 图片/附件内容不脱敏(P2:/v1/deidentify/image 与文本共用 mapping)
- NDJSON `?stream=1` 阶段进度不做,弹窗内 spinner 代替
- 桥接(微信)/ `/btw` 侧问 / autoTrigger 心跳不经过预览门(非 composer 路径);桥接消息进 deid 办公会话会绕过脱敏 —— 已在交接文档记录
- 会话标题占位符:deid 会话首条消息的即时标题取自脱敏文(占位符可见),异步真标题生成同样只见脱敏文(隐私正确,观感其次)
- 本地重放还原为精确串替换,不实现 /v1/meta 的别名/规范化同值判定(unknownPlaceholders 检测由服务端 reidentify 兜底)

### 验收标准(对照契约 §13,文本部分)

- [x] 未经二次确认不会调用外部模型(gate 在 onSend 之前;fail-closed)
- [x] 取消某实体后,外发文本该项为原文、其余仍为占位符(buildOutbound 单测)
- [x] 新增实体本轮重识别且后续轮次继续命中(denyValues 持久化)
- [x] 同一实体跨轮次复用同一占位符(mapping 随请求进出,服务端覆盖保存)
- [x] 模型回复展示前完成还原(渲染层),unknownPlaceholders 明确提示(toast)
- [x] 服务失败不把原文发给模型;同会话请求串行;mapping 不进日志/埋点
- [x] 研发模式对话无此功能、零行为变化
