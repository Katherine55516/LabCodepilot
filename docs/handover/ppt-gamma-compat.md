# PPT Gamma 兼容 API（Gamma 公共 API v1.0 子集）

> 产品思考见 [docs/insights/ppt-gamma-compat.md](../insights/ppt-gamma-compat.md) · Gamma 逆向调研见 [docs/research/gamma-reverse-engineering-20261105.md](../research/gamma-reverse-engineering-20261105.md)

用 Gamma 公共 API 的请求/响应形状驱动 AIMate 的 PPT 引擎：外部脚本、n8n、Agent 等已有的 Gamma 客户端，只要把 base URL 换成本机，就能生成 PPTX/PDF。

## 1. 目录结构

| 文件 | 作用 |
|---|---|
| `src/lib/ppt-gamma-compat.ts` | 纯函数：请求校验与映射、图片 URL 提取（Gamma 规则）、下一步引擎动作、状态投影、主题列表 |
| `src/lib/ppt-gamma-service.ts` | I/O：鉴权、路由分发、建任务、轮询推进、图片嵌入、签名下载；依赖全部注入 |
| `src/lib/ppt-gamma-image-fetch.ts` | 输入图片抓取：仅公网 HTTPS、拒绝重定向、≤512 KB、PNG/JPEG 魔数校验 |
| `src/app/api/ppt/gamma/v1.0/[...path]/route.ts` | 只导出 GET/POST，组装真实依赖（settings、db、上游 fetch） |
| `src/lib/db.ts` | `ppt_gamma_jobs` 表 + `insertPptGammaJob / getPptGammaJob / updatePptGammaJob`；`ppt_gamma_api_key` 加入 SENSITIVE_SETTINGS |
| `src/__tests__/unit/ppt-gamma-compat.test.ts` | 12 个用例：映射、拒绝/警告、作者大纲、Agent、步骤机、进度投影、主题、图片规则、私网拒绝、服务全流程（假引擎） |

## 2. API 路由

基址：`http://localhost:<port>/api/ppt/gamma/v1.0`。静态段 `gamma` 优先于既有的 `/api/ppt/[...segments]` 代理（已在 dev server 实测）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/generations` | Classic 创建 → `{generationId, warnings?}`（warnings 为字符串，同 Gamma） |
| GET | `/generations/{id}` | Classic 轮询：`pending / completed / failed`，顶层 `gammaId / gammaUrl / exportUrl` |
| POST | `/agent/generations` | Gamma 5 创建 → `{generationId, status:'pending', warnings:[{code,message}]}` |
| GET | `/agent/generations/{id}` | Gamma 5 轮询：`gamma{gammaId,gammaUrl}`、`progress{stages,done,total,percent}`、`result.summary`、`credits:{}` |
| GET | `/themes` | 引擎模板 → `{data:[{id,name,type,colorKeywords,toneKeywords}],hasMore:false,nextCursor:null}` |
| GET | `/files/{gen_id}.{pptx\|pdf}?expires&signature` | 签名下载（无需 key，7 天有效，HMAC-SHA256(key, `id.ext.expires`)） |

错误体统一为 Gamma 的 `{message, statusCode, code?}`。Classic 与 Agent 的 id 不能互查（404）。

## 3. 鉴权

- key 来源：setting `ppt_gamma_api_key`（密封落盘），或环境变量 `PPT_GAMMA_API_KEY`。都没有则 403 `api_disabled`（默认关闭）。
- 请求头 `X-API-KEY` 或 `Authorization: Bearer`，常量时间比较。
- 还需 AIMate 已登录（`getCurrentUserUid()`），任务绑定 uid，换账号后旧任务 404。
- 浏览器跨源调用会被预检拦住（自定义头、无 CORS 响应），防止网页 CSRF 驱动本机生成。
- 目前没有设置 key 的 UI（见技术债务）：开发/自用时用环境变量。

## 4. 数据流

```
POST /generations ──► parse*Generation（纯）──► embedImages（抓图）──► POST {cowork}/ppt/projects (readOnlyInput:true 或 author outline)
                                                                       └► ppt_gamma_jobs(phase=created)
GET  /generations/{id} ──► GET projects/{pid}?view=live
     └► nextEngineStep(phase, settings, project)
          input_ready  & created          → POST projects/{pid}/planning {command:'outline', contentMode, length, language}  → phase=planning
          outline_ready & created|planning → POST projects/{pid}/generate                                                   → phase=generating
          generate 409（需作者处理）        → phase=blocked（失败，带引擎原话 + 打开应用处理）
          5xx                             → 不变，下次轮询重试
     └► toGammaStatus（纯）
```

**依赖**：模型调用仍走桌面端 model worker（`PptBackgroundTasks` 挂在 AppShell），所以 AIMate 窗口必须开着；轮询本身只推进状态。

## 5. 映射规则（`ppt-gamma-compat.ts`）

| Gamma | 引擎 |
|---|---|
| `textMode: generate`（默认） | `inputKind:'prompt'`，knowledge `source_plus_explanation`；超过 80k 字符自动转 paste |
| `textMode: condense` | `inputKind:'paste'`，content `overview`，knowledge `source_only` |
| `textMode: preserve` | `inputKind:'paste'`，content `full_source` |
| `textOptions.amount` brief/medium/detailed/extensive | contentMode concise/standard/detailed/detailed（extensive 警告 `amount_adjusted`） |
| `tone` / `audience` | 写进需求文字（仅 generate；否则警告 `ignored_text_options`） |
| `textOptions.language` | en/en-gb/en-in→en，zh-cn→zh，zh-tw→zh-Hant；其他 400 `unsupported_language` |
| `numCards` | 规划 `length.exact`，夹到 6–40（警告 `num_cards_adjusted`）；Classic 缺省 10，Agent 缺省 standard 预设 |
| `cardSplit: inputTextBreaks` | 按 `\n---\n` 切成作者大纲（首个标题作标题、其余行作要点）；首段有正文则前置封面；不足 3 / 超过 100 张退回 auto（`card_split_fallback`） |
| `themeId` / `templateId` | `template`（只接受 violet/blue/light/marketing/education/32 位 hex）；Agent 两者同传 400 |
| `exportAs` pptx/pdf | 签名下载链接；png 400 `unsupported_export` |
| `format` ≠ presentation、`pages`、`sourceUrls`、`files` | 400 |
| `imageOptions.source` 非 noImages/themeAccent/placeholder，`model/style`，`cardOptions.dimensions≠16x9`，`headerFooter`，`folderId`，`sharingOptions`，`quality≠standard`，`publish` | 接受并给出具名警告 |
| Agent 未知字段 / Classic 未知字段 | 400 `unknown_field` |

### 图片 URL（Gamma 规则 + 引擎约束）

- Gamma：只用空白分隔的裸 `https://…{jpg,png,gif,webp,svg,heic,heif,avif}`，抓取后转存，失败静默跳过；Markdown/`<img>` 包裹的不处理。
- 引擎：任何无法嵌入的图片引用都会成为**必需**来源警告并在 generate 时 409 阻断。
- 因此兼容层把所有远程图片引用移出正文：裸 https 图片 URL 去抓取；Markdown/`<img>` 远程图换成 alt 文字；`http://…png/jpg` 直接移除。抓到的 PNG/JPEG（≤512 KB）作为 `images` 附件、`required:false`、caption 取文件名；其余合并为一条 `image_urls_skipped` 警告。最多 20 张。
- 抓取安全：DNS 全部地址都须是公网（拒绝 loopback/私网/链路本地/CGNAT/组播/ULA/IPv4 映射），`redirect:'error'`，10 s 超时，按字节截断。残余风险：DNS 解析与连接之间的重绑定（本机单用户、调用方持 key，可接受）。

### 进度与状态

- `progress.stages` 由 `generationStages.pages` 映射：waiting→queued；retrieving/writing/binding→writing；rendering/layout/previewing→imaging；reviewing/validating→checking；repairing→polishing；ready→done；failed→failed。`percent` 0–99。
- completed/quality_blocked 且有 `publishedRevision` → completed（quality_blocked 加 `quality_review` 警告）；没有发布版本 → failed。
- failed/cancelled/blocked → failed，Agent 的 `error.reason` 固定 `generation_failed`（保持在 Gamma 枚举内），`statusCode:422`。

## 6. DB schema

```sql
CREATE TABLE IF NOT EXISTS ppt_gamma_jobs (
  id TEXT PRIMARY KEY,            -- gen_<24 hex>
  uid TEXT NOT NULL,              -- 账号绑定
  project_id TEXT NOT NULL,       -- 引擎项目 id
  flavor TEXT NOT NULL,           -- classic | agent
  settings TEXT NOT NULL DEFAULT '{}',   -- GammaJobSettings JSON
  warnings TEXT NOT NULL DEFAULT '[]',
  phase TEXT NOT NULL DEFAULT 'created', -- created | planning | generating | blocked
  phase_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

仅新增表，`CREATE TABLE IF NOT EXISTS`，无需迁移旧数据。

## 7. 关键设计决策

1. **轮询驱动、无后台 worker**：Gamma 本身就是 create→poll，没有 webhook；每次轮询最多推进一步且推进后才改 phase，所以重复轮询幂等，Next 进程重启不丢任务。
2. **不改 cowork-server**：引擎已有 `readOnlyInput`、planning `outline` 命令和 author outline，兼容层只调用既有接口。
3. **只承诺引擎真做得到的**：不能做的要么 400、要么具名警告，绝不静默假装支持（例如 60 种语言只开放 4 种）。
4. **引擎审阅停顿 → failed + gammaUrl**：API 无法回答“先编辑这些要点”，与其卡在 pending，不如返回引擎原话并给出打开项目的链接（Gamma 的 failed 响应同样可带 `gamma`）。
5. **下载链接签名而非携带 key**：对齐 Gamma 的 `exportUrl` 语义（持链接即可下载、约一周过期），同时不把 key 暴露在 URL 里。

## 8. 验证

- `npx tsx --test src/__tests__/unit/ppt-gamma-compat.test.ts`：12/12 通过。
- `npm run test`：3191 个，除 `test-playwright-mcp-headed`（容器环境变量 `PLAYWRIGHT_BROWSERS_PATH`，去掉该变量后 7/7 通过，与本改动无关）外全部通过。
- dev server（3011 端口）实测：401 无 key / 错 key，未登录 401 `not_signed_in`，伪造签名 403，静态路由优先于代理。本地 dev 无登录体系，**真实引擎端到端未跑**：完整流程由假引擎单测覆盖，需在打包登录版上实跑确认。

## 9. 调用示例

```bash
export AIMATE=http://localhost:3000/api/ppt/gamma/v1.0
curl -s -X POST $AIMATE/agent/generations -H "X-API-KEY: $PPT_GAMMA_API_KEY" -H 'content-type: application/json' \
  -d '{"prompt":"Q3 update for the board: ...","numCards":10,"exportAs":"pptx"}'
curl -s $AIMATE/agent/generations/gen_xxx -H "X-API-KEY: $PPT_GAMMA_API_KEY"   # 每 5 秒一次，直到 completed/failed
```
