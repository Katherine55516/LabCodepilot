# PPT 模块：Claude Agent SDK 轮次评审与交接（给 Codex）

> 创建时间：2026-11-03
> 最后更新：2026-11-03
> 分支：`claude/ppt-hand-deck-cards-20261102` @ `e4acd6cf`，已 no-ff 合入 main `678151ba`（本地，未推送）；3186 已切到该 main
> 相关交接：[ppt-template-fill handover](../../handover/ppt-template-fill.md) · [insights](../../insights/ppt-template-fill.md)

## 1. 当前状态

| 项 | 状态 |
|---|---|
| PPT 模型调用通道 | Anthropic 协议服务商自动走 AIMate 的 Claude Agent SDK（`src/lib/ppt-desktop-model-worker.ts`，`generateTextViaSdk`）；其他协议仍直连（Vercel AI SDK）。带图片的任务固定直连；SDK 自身故障时该任务回退直连一次；SDK 并发上限 3；暂不支持流式草稿 |
| 验证用服务商 | 3197 上新增 “PPT Claude SDK”（anthropic，`https://newapi.ai-native-lab.com`，key 由用户填写）。网关上 Claude 与 qwen/glm/kimi/deepseek 均支持 `/v1/messages` |
| 本轮验收 | 3197，claude-sonnet-5-5 经 SDK 通道，7 个输入各配一个模板：全部 `completed`，0 个阻断错误 |
| selftest | 全套只剩 4 个已知基线失败（formula-representation、native-content-layout、relational-templates、table-min-rows）；`npm run test` 通过 |
| main / 3186 | 用户 2026-11-03 同意合并：用 qwen 跑完 7 输入验收后合入 main，并切换 3186（合并结果见文末决策日志） |

本轮验收项目（3197，`PPT_TEST_UID=ppt-baseline-opt`）：

| 模板 × 输入 | 项目 | 页数 | 原生填充页 | 备注 |
|---|---|---|---|---|
| Mood × JEPA pdf | 25c96133 | 22 | 1 | 图片读得清；模板小图槽不再选用 |
| Deal-Review × CodePilot docx | 96569bd9 | 21 | 8 | 上一轮被公式误拦，本轮正常完成 |
| Capabilities × MCP xlsx | 3027d03b | 13 | 7 | 短导语改为副标题（optimization 会话） |
| Portfolio × 09-MCP pdf | 8be4abbb | 8 | 2 | 封面改为 LLM 总结标题 “MCP能力调用全链路” |
| Performance × CodePilot pdf | a89b2d11 | 23 | 7 | |
| Process × demo-input.md | 0c3d1ca6 | 6 | 0 | |
| Deal-Review(1) × world_models pdf | 86cadec4 | 21 | 1 | |

对照（qwen3.8-max 直连，同输入）：Deal 1、Capabilities 4、Mood 2、Portfolio 3 页原生填充。

## 2. 本轮已完成（不要重做）

- Q1 公式写法等价：`\frac{a}{b}` ≡ `a/b`、`{x}_i` ≡ `x_i`、Unicode 上下标。纯文本公式与来源不一致时退回重写一次；仍不一致只标记该页，不再拦下整份。丢掉下标仍算不一致。
- Q2 标签的词能在所引来源中找到就保留（术语表页不再丢 MCP/SOP/URI/Schema）。
- Q3 大数字卡片只用于 ≥2 个、互不相同、且不是训练设置（epoch、batch、lr、维度等）的数字。
- Q4 中文要点夹带英文整句：退回重写一次，然后走语言改写调用，仍夹带则移到备注并给出 warning。
- Q7 封面标题放不下时降到 36/32/28pt，仍放不下则下移下方文字框，不再重叠。
- 封面主题（用户要求）：标题像文件名时（编号前缀、扩展名、括号版本说明、下划线、Sheet1 之类），由 LLM 根据整个输入的总结生成演示标题；封面和项目名都用新标题；作者自己定的标题不动。
- Q6(d) 模板图槽会把引用图缩到幻灯片面积 8% 以下时，不选这一页。
- Q6(b) 写作要求里加入导语长度范围；optimization 会话：导语不足 30% 时改为副标题并上移内容块，单行卡片行垂直居中（a01a04ff）。
- telemetry 记录 `agent_sdk` / `agent_sdk_schema` 输出模式。

## 3. 待改进点（按优先级）

每条都附有证据（项目 id 与页码，可在 3197 上打开）、已知根因和建议方案。标 **[需决定]** 的条目请先找用户或 Fable 拍板，再动手。

### P0 媒体组件的应用（最重要）

**标准**：用户指定的“手工版”是媒体使用和内容切分的验收标准。它是 Claude 和 Fable 不经 PPT 模块、手工做的一份 deck：world_models.pdf 配 Copy-of-Mood-Board，共 15 页。

- 参考文件在 `.ppt-build/hand-deck-reference-20261102/`：`world-models-mood.pptx/.pdf`、`build.py`（把规则写成代码），以及 `hand-deck-logic.md`（19 条规则加 G1–G5 差距清单）。
- 任何媒体或内容切分的改动，都先读 `hand-deck-logic.md`。规则变化由 Fable 决定。
- 验收：在 Mood-Board 和 Portfolio 上对照手工版逐页看，再跑全部 7 个输入。

**已定规则**（都是用户或 Fable 已拍板的，实现时以此为准）：

1. **页面骨架**：每页一个断言式标题加一句导语；正文是 2–4 个“短标题 + 一句话”的块，块数对齐模板页的组件数 S。块数超过 S 的最大值就拆成下一张卡片，计作“· k/n”。导语写进模板的副标题槽；没有副标题槽、又放不下时，放进备注第一行。
2. **两类图槽**：
   - chrome 槽：贴着页面边缘、宽或高跨过 25% 以上的图片（色带、半出血面板、封面主图）。每种页型都保留一张经过认证的模板画面，从不留空。
   - 内容槽：位于内容区内的图片。只放本页引用的来源图，内容页上不放装饰画面；只有 frame 页可以放画面。
3. **借用、不重复**：纯文字的内容页可以借用一张没用过的已认证模板图片（先用同一槽位的原图，再找宽高比在 ±25% 内的，按 cover 方式裁切）。内容槽从不重复用同一张图。chrome 槽要等同尺寸的画面全部用过一遍，才能隔至少 2 页重复（2026-11-03 用户：重复画面，不再退化成纯色面板）。
4. **版式复用上限**：同一个模板页最多用于 max(2, floor(N/5)) 页，而且不能连续两页使用。所有能放下的版式都到上限时，改用主题页。
5. **图文同页**：引用的图片和解释它的要点放在同一页（同一 logicalCardId 内）。依次尝试并排、上下，都不行才单独做图页，图页必须记录原因（legibility/no_points/space/titles）。被引用的图片不能移进备注。OCR 读不出文字的图，并排时最多占 40% 宽度。
6. **按内容选组件，外观随模板**：
   - 并列要点用编号卡片，有步骤才用流程轨道。
   - 小型数字表做成指标卡行；3–8 个类别、同一单位的表做成原生柱状图。
   - 公式用公式卡；图片配一个图注标签（pill）。
   - 图标只用于 3–6 个点的网格卡，同一卡片内要么全有、要么全无；原生页上用编号标记（1、2、3），不保留模板自带的示例图标。
7. **表格**（用户 2026-11-02 定）：表格本身不画进页面；用 3–4 张对比卡片展示支撑结论的数字，整张表放进备注，每个数值都保留。
8. **带装饰的版式**（引语、带日期的时间线）只给内容类型相符的卡片用；否则改用主题页。
9. **可读性下限**：原生文字至少 12pt；图片内文字并排时至少 7pt；放不下就换页，不能硬缩。
10. **每个内容页都要有视觉元素**，封面主图保留。
11. **密图切分**（Fable 2026-11-03，用户授权她决定）：
    - 触发条件：整图最大尺寸下，文字中位高度低于 9pt，或长宽比大于 1.6。
    - 先放一页全图总览，再切 2–3 段，每段一页“· k/n”的放大图页。
    - 切割位置优先选空白行（目标边界 ±10% 范围内墨迹最少的一行）；找不到再等分，相邻两段重叠 8%。
    - 切段页不计入内容卡片配额。quick 档最多切 2 段，standard/full 最多 3 段。
    - 已有图页的来源图，不能再出现在任何模板图槽里（借用槽也不行）；空出的槽换一张没用过的模板图，没有就去掉这个槽，页面按纯文字重排。

**这轮验收看到的差距**（需要 Codex 做的）：

- 模板图片使用率低、重复多：11-02 做 G2 时统计，24 张模板图只用了 2 张；这轮 Portfolio 仍在多页反复出现同一组城市照片，有 `template_picture_repeat` 警告（p4 那排三张照片是装饰，不是内容）。需要检查借用池的认证和尺寸分组，以及 chrome 槽的轮换。
- 同一张来源图出现两次：Portfolio p3 图页加 p5 竖长条，按上面第 11 条修。
- 密图读不清：Portfolio 的时序图，按上面第 11 条做切分。
- 装饰照片占了图位：Mood p13 消融表旁边那张。表格应按第 7 条做成对比卡片，照片不能当内容图。
- 照片撤掉后留下空槽：Portfolio t8 右半边。按第 3 条补一张未用图片，或换不带照片的版式。
- 图片裁剪带进论文正文：world_models p4、p7。裁剪要排除正文文字块（已定规则：裁剪不含正文和查看器图标）。
- 媒体覆盖率：Mood 有 `media_coverage_low`、`media_text_only_run` 警告（连续很多页只有文字）。对照第 10 条，检查主题页的面板代价（无视觉的主题页代价 250）是否生效。
- 视觉多样性：5 页以上的 deck 里，同一种卡片形状最多占 40%，不能连续三页相同。Process × demo 4 个内容页都是同一种 3 卡网格。
- 验收方法：对 Mood-Board、Portfolio 两个模板，和手工版逐页对照图槽使用、重复次数、图文配对和组件选择，再跑全部 7 个输入。

### P1 内容与准确性

1. **来源引用行被当作正文**：Deal × docx p5 “本手册解释什么 · 2/2” 整页只有 “代码依据 S/ppt-flow.mjs 3；…”。根因：docx 每节末尾的 “代码依据 …” 行被当作普通来源单元写进要点。建议：把这类定位行识别为元数据（类似 section-reference / locator），不进入卡片要点，可放进备注。
2. **拆分卡片的标题被切成不完整短语**：world_models p4–p6 “智能体由视觉、记忆 · 1/3”（原意为“由视觉、记忆与控制器组成”）。根因：拆分计数规则按短语边界截断，截在了顿号处。建议：截断点不能落在并列成分中间；放不下时改用卡片其他标题，或给出 flagged 标题（参见 memory “Split-card counters”）。
3. **重复标题**：Mood p10/p12 都叫 “预测器捕获位置不确定性”；Performance p6/p7 都叫 “项目以 Nodes 为规范数据”，且没有续页计数。建议：不同卡片同名时，送一次 retitle；同一卡片续页时补 “· k/n”。
4. **中文 deck 里的英文标题和标签**：Mood p11 图页标题 “Scaling”（取自图注）；p14 标签 “Batch-size Momentum”，正文还夹着 “.momentum value 为 0.996”。Q4 只检查要点正文，不检查图页标题和标签。建议：图页标题和标签也走 `foreignToDeck` / `mixedLatin` 检查。
5. **表格被写成点号串接的文字**：Mood p13 “multi-block · Block(0.15,0.2) · 4 · …”，旁边还配了一张模板装饰照片。建议：消融表按手工版做法处理成 3–4 张对比卡片，全表放进备注（memory “Document tables → comparison cards”）；装饰照片不能占图位。
6. **（已实现，用户 2026-11-03 选 A）写得太短的卡片退回补足**：版式符合、但不到页面文本框一半的卡片，会退回模型一次，只能用所引来源里的细节补足（不许凑字，数字必须来自来源），补足后重新匹配；仍不足的卡片保留原页（`fillExtendTask` / `acceptFillExtend`，节点 `outline:fill:<rev>:extend`）。待观察：补足后的内容有没有变得啰嗦。
7. **（已定）验收模型**：用户决定用 qwen3.8-max 做验收（直连 BYOK，服务商 “PPT verification”）；Claude 经 SDK 通道作为可选。

### P2 版式与媒体

8. **（Fable 已定，见 P0 第 11 条）一张又高又密的图读不清**：Portfolio p3 的时序图是 2448×3168 的竖图，已占约 60% 页高，接近上限。该图还在 p5 重复出现了一次。工作量中等：空白行检测、切段图页、图槽排除，并在 replay 里加入 Portfolio × MCP 用例。
9. **页面过空或只用半页**：
   - Portfolio p6：3 个要点，下半页空着。
   - Performance p3：3 个短条目。
   - Mood p17/p18：一句话占一页。
   - Deal × docx p4/p6：3×2 网格，字号约 8–9pt，留白很大。

   这些页的现有规则（C1 主题页铺开、字号放大；稀疏卡片合并）没有生效。建议按 Fable Q6(c) 做：半页列表改成两栏或通栏，≤2 个要点的卡片合并；同时确认 C1 的放大字号在这些页上确实生效。
10. **原生图槽空了，导致半页空白**：Portfolio t8 一类页面，右半边的模板照片被撤掉后没有内容补位。建议：撤掉照片时用其他未用照片补上（G2 borrow），或换一个不带照片的版式。
11. **图片裁剪带进了论文正文**：world_models p4 第一张图顶部带着 “function p(z) instead of a deterministic prediction of z.”；p7 的图也带着正文。根因在 PDF 图片抽取的裁剪框。建议：裁剪时去掉与正文文字块相交的边缘区域。
12. **标题与图片贴边或重叠**：world_models p2 的两行标题 “世界模型让小控制器 / 学会任务”，第二行在 LibreOffice 渲染下与图片顶部相碰（标题框底 0.301，图片顶 0.303）。建议：图片顶边与渲染后的标题墨迹之间至少留 0.1in。
13. **窄卡片里字很挤**：Process p3 的 3 张卡片每行只有 4–5 个字，旁边还有一张照片。建议：卡片宽度低于约 1.6in 时改用纵向列表，或去掉装饰照片。
14. **（optimization 会话发现）**：
    - Capabilities 标题里的拉丁文用了衬线体（Tool、MCP 共同接口），有没有这次改动都存在；
    - Mood p12 的卡片图标在浅色背景上太淡。

### P3 已约定的后续轮次

15. **事先分配**（下一轮第 6 项）：在写作前就把卡片分配到模板页，按页面容量写，减少 Deal-Review 这类上限很紧的模板出现 `body_over_cap`。
16. **弹性页数**（第 4 项，需 Fable）：页数随原生页容量弹性调整。
17. **SDK 通道的流式草稿**：Fable 之前的 Q4 决定是先不做，单独立项。
18. **main 合并与 3186 切换**：等用户确认。合并前按 memory “Merge acceptance: all 7 inputs” 重跑 7 个输入。

## 4. 代码位置与新环境准备

- 代码：GitHub `Katherine55516/LabCodepilot` 的 `main`。这是 main `335fb8b3` 的单提交快照，不带历史，因为旧历史里有超过 100MB 的测试视频；完整历史在公司 origin 和本地仓库。
- 2026-11-04 在全新 clone 上实测过：`npm ci`（约 2 分钟，Claude Agent SDK 本机二进制随依赖装好）→ `npm run test`（3181 通过）→ PPT selftest（只有 4 个基线失败）→ `npm run build`（干净 clone 用默认构建即可）→ 用 Claude SDK 生成 JEPA × Mood-Board，20 页，completed，38 次调用全是 `agent_sdk_schema`。
- 新机器需要准备：
  - Node 22；
  - AIMate 设置 → 服务商里添加一个 Anthropic 协议服务商（填 key，PPT 会自动走 SDK）；验收用的 qwen 走 openai-compatible 直连；
  - Python，用 `PPT_PYTHON` 指定解释器（跑 selftest 时用 `PPT_TEST_PYTHON`），需要装 `pdfplumber pypdfium2 pillow lxml python-docx openpyxl python-pptx`；
  - LibreOffice，用于导出检查和页面渲染；
  - 上传自定义模板（模板和测试项目不在仓库里）；
  - 在浏览器里跑 PPT 时，`/ppt` 页面要保持打开，模型调用由它发起。

## 5. 如何复现与验证

- 3197 启动与重启：
  ```bash
  cd .ppt-build/claude-baseline-opt-20261030
  PPT_MANUAL_STATE_DIR=$PWD/outputs/claude-baseline-opt/manual-state node --import tsx scripts/ppt/manual-test-launcher.mjs stop
  PPT_MANUAL_STATE_DIR=$PWD/outputs/claude-baseline-opt/manual-state node --import tsx scripts/ppt/manual-test-launcher.mjs start --no-open
  ```
  后端只在启动时加载一次 `apps/cowork-server/lib`，改完必须重启。模型 worker 需要一个打开着的 `http://127.0.0.1:3197/ppt` 标签页。项目库上限 50，旧项目移到 `outputs/claude-baseline-opt/parked-projects-20261102/`（移动，不删除）。
- 走 SDK 通道：项目的 `configId` 用 `byok:d5bfcb32920fd961e681ca2c4483f799`，`model` 用 `claude-sonnet-5-5` 或 `qwen3.8-max`。确认方式：next-server 下面出现 `claude-agent-sdk-*/claude` 子进程；项目 telemetry 的 `outputMode` 为 `agent_sdk_schema`。
- selftest：`apps/cowork-server/selftest-ppt-*.mjs`，可以并发跑；m2/m3/requirements-parity 等在并发时会超时，失败的单独串行重跑即可。另需设置 `PPT_TEST_PYTHON`（python 需带 pdfplumber 等依赖）。
- 页面渲染评审：用 LibreOffice 把导出的 PPTX 转成 PDF，再用 pypdfium2 拼缩略图，逐页查看。不要只看编辑器预览：编辑器里的圆角矩形渲染有已知偏差（A2）。
- 测试输入：轮换使用 `/Users/dongli/Documents/ChatGPT/CodePilot/testing_input` 里的 7 个文件，搭配 `/Users/dongli/Documents/ChatGPT/CodePilot/templates` 里的不同模板，不要只用 world_models。

## 6. 决策日志（本轮）

| 日期 | 决策 | 来源 |
|---|---|---|
| 2026-11-03 | PPT 调用改走 AIMate 的 Claude Agent SDK；Anthropic 协议自动启用；图片任务直连；SDK 故障回退直连一次；不做流式；并发 3 | 用户 + Fable Q1–Q6 |
| 2026-11-03 | 公式：写法等价 + 退回一次 + 页面标记；丢下标不算等价 | Fable Q1 |
| 2026-11-03 | 标签可取自所引来源；大数字只用于测得的结果；中英夹杂退回或移到备注 | Fable Q2–Q4 |
| 2026-11-03 | 封面：不重叠；文件名式标题由 LLM 总结整个输入生成 | Fable Q7 + 用户 |
| 2026-11-03 | 版式分工：框收缩居中、导语改副标题归 optimization；半页列表、图片宽度归 Claude（这部分现交接 Codex） | Fable Q6 |
| 2026-11-03 | 第 1 项：写得太短的卡片退回补足一次（e4acd6cf）；第 2 项：密图切分由 Fable 决定（见 P0 第 11 条）；第 3 项：验收用 qwen；第 4 项：合并 | 用户 |
| 2026-11-03 | qwen 7 个输入验收全部完成、0 个阻断；合入 main `678151ba`，3186 重新构建前端（webpack）后切换 | Claude |
