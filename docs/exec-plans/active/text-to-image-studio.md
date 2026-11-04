# 执行计划：独立文生图模块（Text-to-Image Studio）

> 状态：进行中 ｜ 负责人：（本次）｜ 创建：2026-06-26

> **更新 2026-06-26（v2，已切换服务商）**：原方案用「下发 managed provider 的 base_url+key 调 OpenAI 兼容 `gpt-image-2`」，但该网关（newapi.ai-native-lab.com）的 gpt-image-2 渠道实测一直 `429 NO_PROVIDER_KEY_UNAVAILABLE`（用脚本原 key 直连也一样，确认是网关侧无可用渠道）。**改为阿里云百炼（DashScope）`qwen-image-2.0-pro`**：
> - 端点（已 POC 跑通 + CDP 出图验证）：`POST https://{workspaceId}.{region}.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`，同步返回，image URL 在 `output.choices[].message.content[].image`（OSS，24h 过期 → 下载落盘）。
> - 凭证（apiKey + workspaceId + model + region）以 JSON blob 存 `settings.bailian_image_config`，纳入 `SENSITIVE_SETTINGS` → 自动 AES-256-GCM 加密落盘；默认值在 `bailian-image-config.ts`（可被 `BAILIAN_IMAGE_*` 环境变量或 `setBailianImageConfig()` 覆盖）。
> - UI：模型下拉改 `qwen-image-2.0-pro`；比例映射到百炼固定分辨率（1:1=2048²、16:9=2688×1536 等），**去掉 1K/2K/4K 档**（百炼每个比例只有一种分辨率）；数量 1–6。
> - 下方「触及文件 / 决策」按原 gpt-image 方案记录，现以本节为准。

## 背景与目标

新增一个**独立的文生图模块**，不混入现有对话/Claude Code 流程：

- 用户在左侧栏「用户名 + 设置」那一排**上方**点击一个明显的入口按钮，右侧主区切换到独立的文生图页面。
- 页面以「输入提示词 → 生成图片」为核心，**直接调用图片 API，不经过 Claude Code**。
- 图片 API 的 baseURL 与 key **跟随用户体系下发的（managed）服务商**——即 `api_providers` 表中 `source='managed'` 的行（账号登录后由后端下发，`base_url`=网关、`api_key`=auth_token）。
- 图片模型先**写死 `gpt-image-2`**，但底部输入区保留一个「模型/服务商」下拉框（当前只有 `gpt-image-2` 一项），方便后续扩展。

## 关键调研结论（复用现有基础设施）

- 已存在完整的图片生成链路：`media_generations` 表、磁盘目录 `~/.codepilot/.codepilot-media/`、`/api/media/serve?path=` 流式读图、`/api/media/gallery` 列表、画廊 UI。
- 现有 `image-generator.ts` 已内置 **gpt-image-2 的尺寸约束计算** `mapAspectToOpenAISize()`（1K/2K/4K + 多比例），可直接复用。
- 现有 `generateSingleImage()` 仅接受 `provider_type ∈ {openai-image, gemini-image}` 的服务商；managed 下发的是 `provider_type='anthropic'`，因此**不能直接复用其 provider 选择逻辑**。
- 用户提供的可用 Python 脚本验证：端点为 `POST {base_url}/v1/images/generations`，body `{model, prompt, size, n}`，鉴权 `Authorization: Bearer <key>`，响应 `data[].b64_json`（部分网关返回 `data[].url`）。

## 设计决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 新建独立后端 `src/lib/text-to-image.ts`，**不改** `image-generator.ts` 的 provider 选择 | 隔离风险，避免回归现有 in-chat/MCP/批量图片流程；满足「独立模块」诉求 |
| D2 | 后端用**原生 fetch** 复刻用户脚本（而非 `@ai-sdk/openai`） | 完全可控，同时兼容 `b64_json` 与 `url` 两种网关返回；不依赖 SDK 的 baseURL 拼接行为 |
| D3 | 复用 `mapAspectToOpenAISize()` 生成尺寸串 | 已对 gpt-image-2 的边长/像素约束做过详尽处理并有单测 |
| D4 | baseURL 规范化：末尾确保 `/v1` 再拼 `/images/generations` | managed 网关 `base_url` 可能含或不含 `/v1`；脚本证实需要 `/v1` |
| D5 | provider 解析优先级：显式 id → active(若 managed) → default(若 managed) → 首个 managed → 任意有 key 的 active/default（本地 dev 兜底） | 「跟随下发 provider」；本地无登录时仍可用 seeded 本地 provider 自测 |
| D6 | 历史**复用 `media_generations`**，每张图一行；页内显示历史，画廊也可见 | 用户选择「复用 media_generations，页内也显示历史」；单 `local_path` 列限制 → 一图一行最干净 |
| D7 | 导航**路由式**：新路由页 `/image`，左栏入口 `<Link href="/image">` | 与项目现有 App Router 导航约定一致（gallery/settings 等均为路由） |
| D8 | 模型下拉当前仅 `gpt-image-2`（写死），保留扩展位 | 用户明确要求 |

## 触及文件

新增：
- `src/lib/text-to-image.ts` — provider 解析 + 调用 `/v1/images/generations` + 落盘 + 写 `media_generations`
- `src/app/api/image/generate/route.ts` — `POST` 路由
- `src/app/image/page.tsx` — 路由页（渲染 Studio）
- `src/components/image-studio/ImageStudio.tsx` — 主 UI（提示词输入、控制项、结果区、历史区）

修改：
- `src/components/layout/ChatListPanel.tsx` — 在底部账号行上方加入口按钮（import `Sparkle`）
- `src/i18n/en.ts` / `src/i18n/zh.ts` — 新增 `nav.imageStudio` + `imageStudio.*`

无需改动：`db.ts`（`media_generations` 现有列已满足，含 `favorited`）、`types/index.ts`（请求/响应类型内聚在 lib）。

## 阶段

- [x] P0 调研（provider/image/layout/api/media/conventions，多 agent 并行 + 一手核对）
- [ ] P1 后端：`text-to-image.ts` + `/api/image/generate`
- [ ] P2 前端：`ImageStudio.tsx` + `/image` 页 + i18n
- [ ] P3 导航：左栏入口按钮
- [ ] P4 验证：`npm run test`；dev + CDP 渲染验证（本地无登录 → managed 为空，用 mock/seeded provider 验证逻辑与渲染）
- [ ] P5 文档：交接 `docs/handover/text-to-image-studio.md` + 产品思考 `docs/insights/text-to-image-studio.md`（互相反向链接）

## 决策日志

- 2026-06-26：用户确认——模型写死 gpt-image-2 + 保留下拉扩展位；参数参考其 Python 脚本自行决定（采用 prompt + 比例 + 尺寸档 + 数量）；历史复用 media_generations 且页内显示。
- 2026-06-26（v2）：原 newapi 网关 gpt-image-2 渠道不可用（429 NO_PROVIDER_KEY_UNAVAILABLE，直连验证为网关侧问题），用户决定改用阿里云百炼 `qwen-image-2.0-pro`。先写 POC 脚本跑通百炼 multimodal-generation 同步端点（确认 endpoint=workspace 子域、响应 image URL 路径、需下载 OSS），再改应用代码。凭证按用户要求加密存 sqlite（settings.bailian_image_config，纳入 SENSITIVE_SETTINGS 自动 seal）。CDP 在 dev 出图验证通过（柴犬宇航员）。

## 已知局限 / 技术债

- managed 网关是否在同一 `base_url` 暴露 `/v1/images/generations`，依赖后端；本地 dev 无下发数据，端到端真连需登录版或 seeded provider。
- `media_generations.local_path` 单列 → 多图采用一图一行；若未来要把「一次生成 N 图」聚合为一条记录，需要 schema 调整（记入 tech-debt）。
