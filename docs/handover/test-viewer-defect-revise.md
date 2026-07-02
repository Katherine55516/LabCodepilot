# 报告查看器 + 缺陷报告 + 对话式修订（第一批剩余三项）

> 产品思考见 [docs/insights/test-viewer-defect-revise.md](../insights/test-viewer-defect-revise.md)
> 上游方案见 [docs/research/framework-flow-test-integration.md](../research/framework-flow-test-integration.md) §四第一批 1.2 / 1.3 / 1.4

framework 集成方案第一批的剩余三项（1.1 用例编辑器 + Excel 导出已在 `60e68bc` 落地）。三项彼此解耦、都围绕「报告 / 产物的查看与后处理」：让报告能看证据图 / 录像、能产缺陷单给开发、能对话式精修产物。

## 一、三项各解决什么

1. **报告查看器（1.2）**：报告此前证据只显示文件名文本，看不到截图 / 录像。
2. **缺陷报告（1.3）**：测试报告是给测试侧的；缺陷单是给开发的第三交付物（只写期望行为 + 验收，守 QA 铁律）。
3. **对话式修订（1.4）**：此前 composer 只能「追加指令喂下一步」（submitNote），不能改当前产物。

## 二、改动清单

| 文件 | 改动 |
|---|---|
| `src/app/api/test/media/route.ts`（新） | 证据媒体服务：`GET ?projectPath&taskName&env&file` 流式返回证据图片 / 录像。**严格白名单**到项目 `AI_LabTest/report/_evidence/{task}-{env}/`，只取 basename 平铺查找（杜绝 `../` 穿越）；视频支持 HTTP Range（206 partial，<video> 可 seek）。移植 framework `ailab-media://` 协议思路 |
| `src/app/api/test/defect/route.ts`（新） | 缺陷报告：streamClaude 跑「缺陷报告员」prompt（铁律：只 status=fail 且应用 bug；只陈述事实；修复要求只写期望行为 + 验收，禁修复方案 / 优先级 / 指派）。读 run.json + cases.json，写 `report/{task}/{task}-{env}-缺陷报告.md`。移植 framework `defect-report.js` |
| `src/app/api/test/revise/route.ts`（新） | 对话式修订：streamClaude 跑「产物修订助手」prompt（读当前 step 产物 → 按指令精准改写 → 覆盖）。仅需求 / 用例两步（产物是稳定文件）；用例步给 JSON schema 约束。移植 framework `revise.js` |
| `src/app/api/test/reports/route.ts` | 透传 `defectMarkdown`（读 `{task}-{env}-缺陷报告.md`，供报告浏览展示） |
| `src/components/test/InlineTestingPanel.tsx` | ① `ReportView` 证据列：文件名文本 → 缩略图（点开 lightbox）+ 录像内联 `<video>`（src 指向 media route），加 `projectPath`/`env` props；② `ReportBrowser` 报告行展开区由二 tab（结果 / 对比历史）扩为三 tab（+ 缺陷报告）：缺陷 tab 显示 `defectMarkdown` + 「生成 / 重新生成缺陷报告」按钮（`defectGen` 流式跑 + reload）；③ `reviseStep`（复用 runStep 的 SSE 帧解析，改产物不动 stepStatus，用例改完重新拉取展示）+ composer「修订」按钮（仅需求 / 用例步、产物 done/review 时显示，区别于「发送」追加指令） |
| `src/i18n/{zh,en,zh-HK}.ts` | `test.revise.*`（action/btn/hint）+ `test.defect.*`（tab/gen/regen/generating/hint/empty）+ `test.media.video` |

## 三、数据流

```
报告查看器：run.json tests[].evidence（文件名）→ ReportView 缩略图 <img src=media route> →
            点开 → lightbox 大图 / <video>；media route 白名单读 _evidence/{task}-{env}/
缺陷报告：报告浏览「缺陷报告」tab → 生成按钮 → POST /api/test/defect（streamClaude 读
          run.json+cases → 写 缺陷报告.md）→ 完成 reload reports → defectMarkdown 渲染
对话式修订：流程视图 composer 输入指令 + 点「修订」→ POST /api/test/revise（streamClaude
            读当前产物 → 改写覆盖）→ 流式进 convo；用例改完重新 GET cases 刷新展示
```

## 四、关键设计决策

1. **media route 而非自定义协议**。framework 用 Electron 的 `ailab-media://`；Next 环境改用 API route。安全靠 `path.basename(file)` 平铺查找 + `startsWith(evidenceRoot)` 双重校验，`../` 穿越被剥离（实测 `../../../../etc/passwd` → 404）。视频走 Node `createReadStream` + `Readable.toWeb` 支持 Range，不整段入内存。
2. **缺陷报告守 QA 铁律**：prompt 明确「修复要求只写期望行为 + 验收标准，禁修复方案 / 改哪行 / 优先级 / 指派」——缺陷单是给开发的事实 + 验收口径，不越界做开发 / 产品决策。接口信息字段：LabCodepilot 的 run.json 暂未抓 `tests[].api`，prompt 让 AI 写「—（未捕获接口 / 纯前端缺陷）」兜底。
3. **修订 vs 追加指令分清**：`submitNote`（追加指令）把文本存进 notes、喂**下一步** prompt，不改当前产物；`reviseStep`（修订）让 AI 改**当前**产物并覆盖。composer 两个动作并存，「修订」按钮仅在可修订步（需求 / 用例，产物已生成）出现，hint 文案说明区别。
4. **三 tab 复用同一展开区**：报告行展开 = 本次结果 / 对比历史（Phase3）/ 缺陷报告，`rowTab` 三态切换，互不干扰；缺陷生成后 `reloadTick` 触发 reports 重新拉取，自然拿到新写的 `defectMarkdown`。
5. **revise/defect 直接 streamClaude**（同 run/report route）：独立 sessionId、bypassPermissions、写入靠 prompt 约束在 `AI_LabTest/`，不碰聊天路径。

## 五、验证

- typecheck exit 0。
- **媒体（dev 实测）**：media route 200 + `image/png` + Content-Length；`../../etc/passwd` → 404（穿越防护）；ReportView 2 张证据缩略图经 media route 加载成功（complete / naturalWidth>0）；点缩略图 → lightbox overlay 出现 + 大图加载。
- **缺陷（dev 实测）**：reports route 透传 `defectMarkdown`；缺陷 tab 渲染完整缺陷单（缺陷编号 / 重现步骤 / 预期 / 实际 / 证据 / 接口信息 / 期望行为验收）+ 「重新生成」按钮 + QA 铁律说明。
- **修订（dev 实测）**：需求步 done 时 composer「修订」按钮渲染 + disabled 逻辑（空输入禁用）+ hint 显示。

## 六、已知局限

- **缺陷生成 / 对话修订的 AI 执行需真实模型**。dev 本地无 API credentials，`/api/test/defect`、`/api/test/revise` 的 AI 部分跑不通（同执行 / 报告步的边界）；其 prompt 逻辑 + 流式接入靠 typecheck + 复用 runStep/streamClaude 模式保证，效果需打包态 + 真实项目实测。
- **缺陷报告接口信息缺位**：run.json 未抓 `tests[].api`（失败用例的接口请求 / 响应），缺陷单接口字段只能写「未捕获」。补抓需改执行 prompt + reduce（记接口），属后续硬化项。
- **录像证据依赖执行真的产出 video**：media route 已支持 video + Range，但执行阶段是否落盘录像取决于 Playwright MCP 配置（当前以截图为主）。
- **修订仅需求 / 用例两步**：执行 / 报告产物（run.json / 报告 md）不走对话修订（run.json 是确定性归约产物、报告可重新生成），与 framework 一致。
