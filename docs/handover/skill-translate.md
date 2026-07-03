# 技能市场「AI 翻译简介」

> 产品思考见 [docs/insights/skill-translate.md](../insights/skill-translate.md)
> 原执行计划见 [docs/exec-plans/completed/marketplace-skill-translate.md](../exec-plans/completed/marketplace-skill-translate.md)

设置 → Skills → 技能市场详情页的一键翻译:把第三方技能的英文 README 翻译成当前应用语言,可在译文/原文间来回切换。

## 文件清单

| 文件 | 职责 |
|---|---|
| [src/lib/skill-translate.ts](../../src/lib/skill-translate.ts) | 纯函数:系统提示词构建、30K 截断、截断提示行、managed 模型挑选。**零 db/claude-client 依赖**,单测可直接跑 |
| [src/app/api/skills/marketplace/translate/route.ts](../../src/app/api/skills/marketplace/translate/route.ts) | POST route:参数校验 → 模型挑选 → `generateTextViaSdk` 单轮调用 |
| [src/components/skills/MarketplaceSkillDetail.tsx](../../src/components/skills/MarketplaceSkillDetail.tsx) | 按钮 + 状态机 + 模块级译文缓存 |
| src/i18n/{zh,en,zh-HK}.ts | 6 个 `skills.*` 键(zh-HK 手工添加,勿跑 gen 脚本) |
| src/__tests__/unit/skill-translate.test.ts | 14 条单测(提示词/截断/模型挑选) |

## 数据流

```
点击「AI翻译简介」
  → POST /api/skills/marketplace/translate { content: displayContent, targetLocale: locale }
    → buildTranslateSystemPrompt(targetLocale)   // null → 400
    → pickFirstManagedModel(getProvidersBySource('managed'), getModelsForProvider)
        // 空列表 → 409 no_managed_provider
        // 模型优先级: role_models_json.default → provider_models[0] → undefined(交给 provider env)
    → truncateForTranslate(content)              // >30K 截断,译文尾部由代码追加提示行
    → generateTextViaSdk({ providerId, model, system, prompt })
        // SDK 子进程单轮:无会话/无工具/无 MCP,60s 超时,凭证不出服务端
  → 200 { translated } / 502 translate_failed
→ 前端写模块级 Map 缓存(key=`${source}/${skillId}::${locale}`),setShowTranslation(true)
```

- `content` 由前端传**当前渲染的 `displayContent`**(已剥 frontmatter),不在服务端重拉——翻译的就是用户看到的。
- 走 `generateTextViaSdk` 而非 @ai-sdk 直连:**managed 模型 id 可能是 CLI 别名**(如 `claude-opus-4-7[1m]`),直连 503(/btw 已踩坑迁移,本功能同构复用)。

## 前端状态机(MarketplaceSkillDetail)

| 条件 | 按钮 | 正文 |
|---|---|---|
| `locale === 'en'` | 不渲染 | — |
| README 加载中 / 无内容 / 翻译中 | disabled(翻译中显 spinner+「翻译中…」) | 原文 |
| 有译文 + showTranslation | 「显示原文」 | 译文 |
| 有译文 + !showTranslation | 「显示译文」 | 原文 |
| 失败 | 恢复「AI翻译简介」可重试 + error toast(409→无模型文案,其余→翻译失败) | 原文 |

- 缓存命中(含切走再切回)时点击为纯切换,零请求。
- 切技能/语言:`cacheKey` 变化 → effect 重置三态并从缓存恢复译文;`cacheKeyRef` 守卫迟到响应不写错技能的 state(缓存写入本身按请求 key,恒安全)。
- 译文与原文走**同一个** `ReactMarkdown + remarkGfm` 渲染管线。

## 系统提示词契约(skill-translate.ts)

11 条规则四组:完整性(逐段对应、禁省略/添加)/ Markdown+HTML 结构保留(代码块、URL、表格分隔行原样)/ 不译清单(命令、路径、环境变量、品牌名、无通用译名术语)/ 纯净输出(无前言、不包围栏)。第 11 条为**提示注入防线**:README 是不可信第三方内容,指令性语句照译不执行;内容走 user 消息不拼 system;调用本身无工具、单轮,注入最坏后果=译文错误。

## 验证结论(2026-07-03)

- `npm run test` 1829 过(typecheck+单测);`test:smoke` 6/6;console 无报错。
- CDP 实测(本地 dev):置灰→就绪流转、mock 成功态全状态机(译文替换/来回切换/切技能复位/缓存零请求)、`locale=en` 按钮隐藏、502 分支真实触发(toast 文案正确)。
- **验证前提**:本地 DB 有 managed 残留行但无登录态,真实链路验证到「模型挑选成功 → SDK 子进程被调起 → Not logged in 502」为止;409 分支由单测覆盖(空列表→null)。**完整成功链路需打包登录后人工点一次确认**。

## 已知局限

- `generateTextViaSdk` 固定 60s 超时:接近 30K 的输入可能贴边,若实测超时给它加可选 `timeoutMs`(向后兼容)。
- 30K 字符截断;无流式;缓存仅页面会话内存级。
