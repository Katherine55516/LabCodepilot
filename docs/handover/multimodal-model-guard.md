# 多模态模型标识 + 上传拦截

> 产品思考见 [docs/insights/multimodal-model-guard.md](../insights/multimodal-model-guard.md)

## 核心思路

服务端下发的 managed 模型里部分支持多模态、部分不支持。本功能做两件事：

1. **标识**：模型选择器列表中，多模态模型名后拼接「（多模态）」。
2. **拦截**：选中"确定非多模态"的 managed 模型时，用户上传图片/音频/视频等媒体附件 → 弹窗提示，并阻止该附件加入。

**判定规则**：server 的 `ModelConfig.description` 含「多模态」三字即认定多模态。该 description 已落到 provider 行的 `notes` 列，所以**无需改 DB / 后端 / electron 映射**——数据现成。

## 数据流（description 已就位）

```
登录后台 ModelConfig.description
   │  electron/auth/managed-providers.ts:69  notes: cfg.description ?? ''
   ▼
api_providers.notes（managed 行）
   │  /api/providers GET 返回 ApiProvider（api_key 脱敏、managed_extra_json 不下发）
   ▼
useManagedMultimodal()  ← 过滤 source==='managed'，notes 含「多模态」⇒ isMultimodal
   ├─► ModelSelectorDropdown：列表项渲染「（多模态）」后缀
   └─► MessageInput：构造 validateFile，喂给 PromptInput 拦截媒体上传
```

## 后续：这个 hook 现在也带模型倍率

`useManagedMultimodal` 已从"多模态判定"扩成 managed 模型**展示元数据**的统一来源，
条目上多一个 `multiplier: number | null`，供三处模型下拉在模型名后展示倍率
（如「Qwen3.8-Max 1.4x（多模态）」）。倍率排在「（多模态）」之前。

- 取值链路与 notes 不同：倍率来自服务端 `ModelConfig.model_multiplier`，落在
  `managed_extra_json.raw` 里，由 `/api/providers` GET 提到顶层 `model_multiplier`
  再交给本 hook。**渲染层不解析 `managed_extra_json`** —— 那份 JSON 里带着明文
  `auth_token`，为一个数字把密钥扩散到 UI 组件不划算；同理该字段现已不再下发。
- 缺失即不渲染，**不兜底 1.0x**：账号没下发倍率时兜一个默认值，等于替后端编一个
  用户会据此花钱的成本数字。判定与格式化收在 `src/lib/model-multiplier.ts`。
- 覆盖面比多模态多一处：办公与研发共用同一个 composer（本 hook 即可覆盖），
  定时任务是 `RoutinePanel`/`RoutineForm` 独立一套，单独接同一份 lib。

> 注：多模态判定至今仍是 `notes` 文本匹配。服务端后来已下发结构化的
> `is_multimodal`（同在 `managed_extra_json.raw`，与倍率同源），若要改判定口径，
> 照倍率这条路提到顶层即可，无需改 DB 或 electron 映射。

## 关键文件 / 改动点

| 文件 | 改动 |
|------|------|
| `src/lib/model-multimodal.ts`（新增） | 纯函数 `isMultimodalDescription(desc)`（含「多模态」）、`isMediaMimeType(mime)`（image/audio/video 前缀） |
| `src/hooks/useManagedMultimodal.ts`（新增） | fetch `/api/providers` 过滤 managed，构建含 `isMultimodal` 的列表；`isManagedNonMultimodal(id)`（**仅** managed 且非多模态才 true，未知放行）；监听 `provider-changed` 刷新 |
| `src/components/chat/ModelSelectorDropdown.tsx` | 用 hook 替换内部 `/api/providers` fetch；`flatItems` 带 `isMultimodal`；列表项追加 `t('composer.multimodalSuffix')` |
| `src/components/ai-elements/prompt-input.tsx` | 新增通用 prop `validateFile?:(File)=>string\|null`；`onError` code 联合加 `'rejected'`；`addLocal`/`addWithProviderValidation` 在 `withinSize` 后过滤被拒文件并触发 `onError({code:'rejected'})` |
| `src/components/chat/MessageInput.tsx` | 用 `useManagedMultimodal` 构造 `validateMediaFile`（非多模态 managed && 非 image-gen && 媒体类型⇒拦截）；传 `validateFile`+`onError` 给 PromptInput；受控 `AlertDialog` 展示提示 |
| `src/i18n/{zh,en}.ts` | `composer.multimodalSuffix`、`composer.nonMultimodalUploadTitle/Desc`、`common.gotIt` |
| `src/__tests__/unit/model-multimodal.test.ts`（新增） | 纯函数单测（6 例） |

## 拦截判定（MessageInput.validateMediaFile）

一个文件被拦截 ⟺ 三条同时成立：
1. `isManagedNonMultimodal(currentProviderIdValue)` —— 当前选中的是**已知 managed 且 description 不含「多模态」**的 provider。
2. `!imageGen.state.enabled` —— 不在图片生成模式（image-gen 模式的图片喂给图像模型，与对话模型多模态无关，故绕过）。
3. `isMediaMimeType(file.type)` —— image/audio/video。

被拦 → `validateFile` 返回文案 → PromptInput 过滤该文件并 `onError({code:'rejected'})` → MessageInput 打开 AlertDialog。**纯文本/代码/文档附件永远放行**（它们以文本注入，任何模型都能用）。

## 放行边界（重要）

- **未知多模态状态一律放行**：本地/BYOK provider、或本地开发无登录下发数据（notes 为空）时，`isManagedNonMultimodal` 返回 false，**不拦截**。只拦"能证明是非多模态的 managed 模型"，避免误伤。
- PromptInput 保持**业务无感**：只新增通用 `validateFile`，不认识"多模态"概念，policy 全部在 MessageInput 侧。

## 验证

- 单测：`npx tsx --test src/__tests__/unit/model-multimodal.test.ts`（6/6）。
- typecheck：`npx tsc --noEmit` 零 error。
- CDP（本地无 managed 数据，按 CLAUDE.md 用 initScript mock `/api/providers` + `/api/providers/models`）：
  - 列表「（多模态）」只出现在 description 含「多模态」的项；
  - 非多模态模型 + 图片 → 弹窗、未加入；+ .txt → 加入、无弹窗；
  - 多模态模型 + 图片 → 加入、无弹窗；
  - console 零报错。

## 不在范围 / 已知局限

- 不改 DB schema / sync 路由 / electron 映射（description 已落 notes）。
- 触发按钮折叠态暂不显示「（多模态）」后缀，仅列表项。
- 判定基于关键词「多模态」，依赖后台 description 文案规范；未来若后台提供结构化 capability 字段，应优先用之（见产品文档）。
