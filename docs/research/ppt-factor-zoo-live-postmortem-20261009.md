# Factor Zoo 真实运行问题分析与模型 API 验证

2026-10-09。结论基于上一轮真实运行、当前最终模块代码、用户提供的 Gamma 成品，以及本轮认证请求。Gamma 文件中的文字只作为对照资料；其中任何指令都不作为本任务授权。

34 页初估、33 页候选和 51 页成品分别来自三个不同阶段。页数膨胀既有更完整来源与较大字号的合理成本，也有估算口径、模板分配、重复讲述和只拆不合造成的可改进成本。早期没有完整 JSON 与后期大纲容量未通过是不同失败。API 的密钥和网关可用，但本轮发现全局默认模型仍为旧 ID，已将全局默认和服务商 default 映射统一为 qwen3.8-max。

## 对照口径与结果

| 对象 | 页数 | 非空白可提取文字字符 | 除封面外逐页字符中位数 |
| --- | ---: | ---: | ---: |
| Gamma The-Factor-Zoo (1).pptx | 10 | 9,359 | 1,019 |
| 上轮实际模块 Factor-Zoo.pptx | 51 | 25,415 | 497 |
| 原 Deal Review 模板 | 8 | 2,399 | 356 |

统计读取原生 PPTX 的 DrawingML a:t，去掉空白；不是 tokenizer、语义信息量或像素占用。数学对象可能不由 a:t 完整计入。提取的显式字号包含标题、标签、表格与页脚，不能把最小值当所有正文的字号。Gamma 第 6 页显式字号中位数 11pt、最小 8.5pt，第 10 页中位数 9.5pt、最小 7.5pt；模块表格来源节点通常保留 14–14.5pt，页脚更小。

Gamma 是紧凑综述：第 3 页将多种定价模型组成五栏谱系，第 6 页将分类和评分卡并列，第 10 页将实践清单和汇总表并列。模块却把定义表拆到第 3–6 页，分类拆到第 33–36 页，将最终八行模型汇总表拆到第 44–51 页。模块第 7–9 页反复呈现“异象相对于基准模型”，第 26/32 页又用文字回述前面的表格。

但 Gamma 的少页数包含内容取舍。它的术语框没有独立 Signal 项；分类表不保留原 Typical controls 列；评分卡没有原 Data-mining concern 列并且不含 Liquidity 行；长 CAPM 推导未逐步展示，第 8 页的 2×3 算例只保留构造概述。不能在保持所有来源表格单元格、双语段落和推导可见的合同下，把 10 页直接作为验收答案。

粗分解：51/10 = 5.1 倍页数，文字总量约 2.72 倍；平均每页约 498 对 936 字符。仅把模块现有正文文字按 Gamma 正文中位数重新分布，约为 25 页正文加封面。但这只是字符负载算术，包含重复文字，不证明 26 页能保全公式、表格、语言及模板字号，更不是新的模块推荐。

证据：[原生提取统计](deck-comparison.json)。Gamma SHA256 c8be44407f0e757e8958c314b076143bc220566feacbea1dea7ddfe34b41ec49 与此前已渲染的对照文件相同。本轮查看完整 contact sheet，以及分类双表的原生渲染；模块成品外观沿用上轮 51 页逐页记录。

## Issue 1 页数估算与最终分页偏多

### 根因与当前代码

1. 创建时只有 templateSpec 快照，没有逐页 templateFidelity。contentCanvas 使用默认 18pt 和默认区域估计；不能据此声称已经完成原生模板 fit。模块仍把 template snapshot 传入估算，因此不是完全忘记传模板，而是 snapshot 信息不足以提供每页容量。
2. 当前代码已取消旧版“每章至少一页”，也已允许 auto 页数变化。将 51 页归因于旧章节 ceil 或初估锁死，是对本次代码的错误判断。
3. 原文约 41,415 字符被分成 182 个 inventory item、75 组 language pair。projection 对普通内容保留约 60% 或 detailed 的 80% 显示负载，结构、例子、小结完整计入；来源里大量中英并行内容保留两种显示成本。它是来源负载投影，还不是“哪些内容值得同时讲”的最终语义编辑。
4. 页容量 target 为 min(Gamma 参考 674 width units, 模板物理容量的 95%)。中文和英文宽度单位不同；Gamma 字符密度只是参考。目标上限 674 使宽版、可利用多区布局的模板即使实际容量更高，也不会自然获得更高的初估预算。
5. 对真实初始项目用最终 local25 代码回放：有原生 frame 时 contentCost=19,150、36 组、推荐 30 页；去掉原生 frame 后使用默认画布推荐 34 页。本实验说明原生解析前后口径不同；它不是重跑 LLM，也不能把本轮的 30 页回放当成上一轮最终数。
6. 真实生成链路为初估 34 → 模型候选 33 → 局部容量分配两轮 → complete-component 分片后冻结 51。51 是“冻结来源和当前模板可容纳”，没有证明“所有可行方案里页数最少”。
7. packOutline 只合并相邻且相关页面，且明确排除 capacityPartition 页面。合并还受 keyPoints≤10、supportingPoints≤6、requiredSupport≤6、claimIds≤8、children≤12、focus≤360、requiredDetails≤10、evidence≤6 等限制。修复产生的页正是最需要再组织的页，却不能进入这条合并路径。
8. fitComponents 只比较一列堆叠与两列等宽装箱，采用较短总高度的方案，未将比较关系、表格列宽和连续阅读成本一起优化。窄表格中长英语和双语标题换行，行高变大；短行表被迫拆页。outlineCapacityAdvice 又把表格片段限制到可用高度约 75%，为说明预留空间。
9. 模板分配、局部修复与整稿密度没有最终闭环：模板映射换到字号、图片占位不同的页后，会再次溢出并拆分；最终 writer 仍可能再展开。上轮 rich_source_underfilled、重复、标题对应错误等告警未成为阻止交付的条件。

### 改进清单

| 优先级 | 改进 | 原因与验收 |
| --- | --- | --- |
| P0 | 分开综述、讲义、完整来源保留三种内容合同 | 明确主稿必讲事实、附录/备注保留内容与允许省略项；Gamma 综述和全文讲义用不同 coverage 口径。主稿取舍必须有记录，不能偷偷删除单元格或第二种语言 |
| P0 | 先得到逐页模板容量，再校准推荐 | 缓存原生 frame、可用区域、字号、媒体占位；记录初估/解析后推荐/候选/冻结四个数，解释差异 |
| P0 | 按读者问题和主张去重后 packing | 中英翻译作为一条语义主张、两份显示空间；来源章节只作索引。重复解释不占新的义务预算 |
| P0 | 为修复分片增加全局再合并阶段 | 保留 source ownership 与完整行区间；允许容量分片在真实重新测量后合并，控制新增页数、低密度和重复。不要只删除 capacityPartition 限制而跳过重测 |
| P0 | 增加表格全宽、非等宽表加短注、多栏比较等候选 | 列宽按实际单元格测量，先保留对照关系，再放局部说明。与已分片方案比较，保留原字号和每个数据单元格 |
| P1 | 把拆页原因量化到内容与模板 | 每一新增页记录哪张表、哪几行、何种字体/区域、溢出多少；不能仅用“rich source”解释 |
| P1 | 区分真实关系完整性与固定数组长度上限 | 多关系页允许经测量的结构合同；上限仍保护复杂度，但不以字段条数替代实际 fit |
| P1 | 对最终低密度、重复及标题行类别不符实施重规划 | 第 44–51 页的逐行汇总、7–9 页重复、34/35 页类别对齐做回归案例；重新导出后才计算密度 |
| P2 | 建立多领域、多语言密度基准 | 不硬编码 Factor Zoo 10 页或单一中文字符阈值；同时衡量关系保留、语义重复、表格/数学保真、字号与阅读性 |

建议先试图重组完整可见内容并测量，再确定能否达到更少页数。若期望 Gamma 式 10 页综述，需要明确采用综述合同或更适合的模板；不能在保留原生字体的名义下暗中缩字。模板图片只因有明确装饰角色才能回收空间，品牌和来源证据仍受保护。

涉及文件：ppt-planning.mjs、ppt-density-profile.mjs、ppt-density-packing.mjs、ppt-density-capacity.mjs、ppt-outline-capacity-repair.mjs、ppt-template-fidelity.mjs、ppt-source-artifacts.mjs。

证据：[估算与请求回放](module-diagnostics.json)；run13-full-artifact/workflow.log 记录 9 页局部修复、4 页二轮修复及最终 51 页的 complete-component 分片。

## Issue 2 未拿到可解析的大纲

### 失败阶段必须分开

| 真实阶段 | 发生的事 | 正确分类 |
| --- | --- | --- |
| Run 37937054264 | 约 101,041 input tokens；16,384 output 全用于 reasoning，正文为空 | 输出预算耗尽，没有可解析正文 |
| Run 37938651254 | reasoning none，16,384 text tokens、41,958 字符仍被截断 | JSON 未结束，不能接受部分大纲 |
| Run 37940354660 | 两次 stop，22,909/23,660 output tokens；各 30 页；输出文本约 60,825/64,757 字符 | 已解析，但 9 页容量溢出、5 张表遗漏末行，未达到可生成状态 |
| 后续容量修复 | 完整 JSON 仍可能字段、类型、归属或范围不满足合同 | 结构/覆盖/容量失败，不能笼统称 API 配置失败 |
| 最终 local25 | 51 页已接受、完成内容审查和原生导出 | 已有有效大纲，可提取为独立 JSON |

当前 parseModelJson 先 JSON.parse，再容忍外层代码围栏或前后说明；解析成功后仍需 normalize、来源 ID、页级合同、coverage、native fit 等检查。通过 JSON.parse 不等于通过业务合同。

原生产 worker 把 length 结果拒绝是正确行为；把输出上限提高到 32,768 已解决部分截断。但最早 trace 中 finish length、reasoning/text 预算及解析失败最终被转成泛化的 local_api_failed，UI 只看到“检查本地 API 设置”。成功返回的大纲在容量失败时留在诊断或 model-results，主 project.outline 仍为空，所以 UI 显示 0 页，用户会以为完全没拿到大纲。

### 改进清单

| 优先级 | 改进 | 验收 |
| --- | --- | --- |
| P0 | 保留分阶段状态与错误码 | transport/auth/model-unavailable、empty-visible-output、truncated-output、invalid-json、schema-invalid、coverage-invalid、capacity-invalid 分开；UI 显示失败阶段、模型、finishReason、安全 token 汇总和恢复动作 |
| P0 | 保存 candidateOutline 并允许诊断下载 | JSON 已解析但 fit 失败时展示“30 页候选，尚未可生成”，逐页列问题；不会写为 accepted outline 或绕过发布门禁 |
| P0 | 真正使用版本化 JSON Schema | JSON object mode 只保证语法，不保证必需字段、ID、范围或枚举；模型支持时用 schema，代码仍校验来源、表格和物理容量 |
| P0 | 降低单次完整大纲的输出合同 | 第一次只输出 group/slide skeleton 和 source ID；后续只补本组合同。避免 30–50 页同时输出重复 keyPoints、pageContract、coverage 和解释 |
| P1 | 预算按模型能力及阶段设置 | 先检查预计输入和输出，留 reasoning 与正文余量；不要对所有模型统一设 none。GPT-6.1 Sol 官方不支持 none/minimal，当前 worker 不应照搬 DeepSeek 的诊断参数 |
| P1 | 有界局部合同修复 | 对缺失字段、表格尾行或少数溢出页请求 delta；不得反复发送整份原文、初稿和完整 schema |
| P1 | 失败候选与已接受版本分别持久化 | 记录模型与合同版本、来源 hash、错误集合、尝试次数；重启后能复看和定向恢复，不能静默接受旧版本审核 |
| P2 | 为模型建立能力矩阵 | 目录、文本、JSON、schema、长输入、输出预算、最终 PPT 回放分别验证；单次 OK 不作为整稿验收 |

现在已从真实 accepted project 提取：[精简 syllabus JSON](accepted-syllabus.json)及[完整 accepted outline JSON](accepted-outline-full.json)。均为 51 页实际大纲，不是重新生成或人工填造。

## Issue 3 syllabus 字符过多

### 本次实测

最终 normalized outline 紧凑 JSON 为 74,394 字符。约 22,261 字符来自 densityFit、12,738 来自 keyPoints、9,473 来自 pageContract；这些是机器执行合同，不能全部当成用户需要阅读的 syllabus。51 页 UI 的 title/focus/description/section 文本共 5,167 字符，没有 children；每页 description 都等于 focus，造成重复展示。

Run 37940354660 的 30 页候选已需要约 60.8–64.8 千字符完整 JSON。大纲阶段要求 keyPoints 写“实际事实、机制和条件”，又在 requiredDetails/pageContract/coverage 中重复描述归属与关系，因此规划器事实上承担了部分正文写作和审查账本输出。

对原始项目用最终模块重建 outlinePrompt，总长 266,463 字符、328,476 UTF-8 bytes。构成包括：inputScope 64,603、contentContract 195,191、compactInventory 63,127、obligations 13,766、sourceObjects 8,432、sourcePlanningContext 26,835、schema 1,905。以上是嵌套项，不能直接相加。

完整来源在 INPUT_FRAMEWORK 中以 JSON 字符串出现一次；outlineContentContract 的“用户另行要求（来源正文之外）”又嵌入 project.prompt，而本项目 project.prompt 恰好就是完整 Markdown，导致原文再出现一次。compactFramework 已避免框架内部重复 prompt/sourceText，但没有消除跨合同重复。sourcePlanningContext 和结构 sourceObjects 再提供局部重复。immutable source hash 和完整 source 留存应继续保留；发送给模型的视图可以去重。

### 改进清单

| 优先级 | 改进 | 原因与验收 |
| --- | --- | --- |
| P0 | 分开 sourceText 与 userRequirements | 文件全文是资料，用户额外指令单独存；不把 41,415 字符资料塞入“额外要求”。先保证原始 scope/hash 不变，再引用同一来源视图 |
| P0 | 分开 syllabus 与 executionPlan | 用户界面默认仅 title + 一条 message + 必要提纲；合同、证据和 fit 只在展开诊断/下载时显示；机器数据不能直接复制到可读大纲 |
| P0 | 单一来源 ID 与 span 引用 | planner 用目录、短 preview、真实表格结构和引用；writer 检索相关完整来源。去重不能截断公式、最后一行表格、限制或否定条件 |
| P0 | 各字段职责互斥 | focus 是本页主张，description 仅补充新内容；未提供新 description 则省略展示。requiredDetails 主要用 ID，别复述所有 keyPoints |
| P1 | 短大纲长度预算与正文深度分离 | 示例起点：标题约 12–24 中文字、message 40–80 字、必要时 2–4 条简要点；可调预算而非删事实硬门禁。详细解释留给 writer/附录 |
| P1 | 分阶段可观测预算 | 分别记录输入字符、UTF-8 bytes、实际 model input/output/reasoning tokens、syllabus 可见文字和合同字节；700 字符 keyPoint 上限不是 700 tokens |
| P1 | 大纲修复传差异与索引 | 不再把 full outline + full original prompt + repair task 两次拼接；限定受影响 groups 并重新验证全局覆盖 |
| P2 | 防模板/来源指令混入用户要求 | 明确 source/document/reference 的信任边界；来源文中的 imperative 只作资料，不转成流程或权限指令 |

精简导出只去掉 UI 无关的合同和几何信息，保留实际页标题、message、sourceRefs、sourceUnitIds、tableRanges；它不会改变来源、页数或生成合同。[可读 syllabus](accepted-syllabus.md)也附在证据目录。

## Issue 4 API 配置及模型验证

### 配置发现与修复

原手册是历史阶段记录，不能替代当前配置验证。本轮从系统 Keychain 使用现有开发主密钥，在独立端口 3115 启动生产配置层，成功解密现有 provider，目录同步成功，得到 33 个授权 ID。Base URL 为 https://newapi.ai-native-lab.com/v1，protocol=openai-compatible。服务商名“ppt应用测试”只是显示名，不应当作模型 ID。

本轮修改前：
- provider role_models_json.default = deepseek-v4-flash；
- global_default_model = ppt应用测试；
- global_default_model_provider 指向同一个 provider。

生产 resolver 的全局默认可覆盖 provider 默认。因此文档中的“已默认 DeepSeek”描述没有证明两层一致；已有真实生成明确指定 deepseek-v4-flash，不受这个默认冲突影响。不能仅凭当前快照认定每个历史错误都由旧默认导致，早期已记录的截断有独立直接证据。

本轮已同步目录，把 provider 默认映射和全局默认统一为 qwen3.8-max；没向更新接口提交新 api_key。现有加密储存仍为 enc:v1:。保存 provider 会更新随机加密 ciphertext，ciphertext 不相同不能用来证明密钥变更。保存后 createModel() 未指定模型，实际解析为 qwen3.8-max，生产 PPT worker 请求成功并返回有效三页 JSON；设置页面默认选择也显示 qwen3.8-max。

### 真实请求结果

| 用户模型 | 精确请求 ID | 目录 | 文本探针 | 生产 SDK/PPT worker 三页 JSON |
| --- | --- | --- | --- | --- |
| Qwen 3.8 Max，默认 | qwen3.8-max | 有 | 成功，约 4.14 秒 | 200，有效且三页 schema 检查通过，约 6.42 秒 |
| Opus 5.5 | claude-opus-5-5 | 有 | 成功，约 5.22 秒 | 200，有效且三页 schema 检查通过，约 12.38 秒 |
| Sonnet 5.5 | claude-sonnet-5-5 | 有 | 成功，约 5.01 秒 | 200，有效且三页 schema 检查通过，约 9.33 秒 |
| GPT-6.1 Sol | gpt-6.1-sol | 无 | HTTP 503，约 2.84 秒 | worker 502/local_api_failed，约 1.48 秒 |

原始最小连接测试用 128 output tokens。三页 JSON 测试走当前 production createModel 和 executeDesktopModelJob，保留 worker 的 Output.json、32,768 output 上限、零自动重试与 240 秒超时；唯一适配是本机内存 claim/complete 传输，没部署新账号队列、没生成 PPTX、没证明复杂 source ID/表格/容量合同。JSON shape 检查要求 exactly 3 slides 且 title/focus 非空。三种模型输出字符数分别为 386、1,003、1,979，提示词相同；这只是单次长度观察，不能作为模型质量排名。

设置后另一次无显式 model 的默认请求成功，约 9 秒，解析 ID 与全局默认均为 qwen3.8-max。网关响应的 model 名称仅证明网关宣称的路由，不提供底层厂商模型真实性认证。

GPT-6.1 Sol 当前网关目录没有该 ID，精确调用失败；未用 gpt-6-sol、GPT-5.6 或别名冒充成功。OpenAI 官方文档支持该精确 ID 的 Chat Completions 文本路径，并明确不支持 reasoning none/minimal；当前网关是否有渠道及授权需由网关配置决定，ChatGPT/Codex 登录不会自动成为这个 New API provider 的授权。修复路径是给当前网关增加/启用该模型上游与 key 组权限，或另配官方 provider 的凭据，再按目录/文本/JSON/长大纲/导出逐层复测。没有渠道管理凭据时不能从本地模型下拉框解决 HTTP 503。

官方依据：[GPT-6.1 Sol 模型接口](https://developers.openai.com/api/docs/models/gpt-6.1-sol)。本轮不把官方型号可用性等同于第三方 key 可用性。

证据：[连接与目录](api-connection-probes.json)、[生产 SDK JSON](api-sdk-json-probes.json)、[配置保存验证](configuration-verification.json)、[默认 SDK 请求](default-sdk-verification.json)。

### 适用边界与后续验收

配置修复生效于 ~/.aimate-api-development 开发 profile；不等同于已安装 Electron 应用 safeStorage profile，也不证明远端 Cowork 已部署同版本队列。上一轮最终输出是 local macOS x64；GitHub ARM64 最后一次因账务/额度预检未启动，不能补写为云端成功。运行小型 API 请求能确认 provider 与传输，但完整 Factor Zoo 同输入同模板长大纲，以及各模型最终导出，仍需单独 A/B。

生产代码的通用页数、JSON 和 syllabus 优化在本轮仅提出建议；没有重写/覆盖用户 PPTX，没有启动新的长整稿，也没有提交、推送或部署生产模块。

## 建议实施顺序与验收

1. 先落地错误分流、candidate 大纲下载、source/userRequirements 分离和 API 默认一致性。让失败可诊断、已有 JSON 可获得。
2. 再改 planner 的短合同与输入去重，记录真实 token 预算，并用本次三种可用模型做同一输入合同测试。
3. 然后做模板容量校准、关系优先布局及拆后合并，不单独调大“每页字符数”，不放宽来源和导出检查。
4. 最后用两种明确内容合同对照 Gamma：综述保核心关系，完整讲义保所有指定结构。先比 coverage、重复、表格/公式与可读性，再比页数。

| 回归场景 | 必须证明 |
| --- | --- |
| 同原文同模板 auto | 页数减少来自完整语义重组；每个合并/新增页有 fit 与 source ownership 证据 |
| 同原文换 Gamma 类模板 | 将容量/字体差异与内容取舍分开；不能仅选择更小字号算“算法提升” |
| 手工页数与已确认页数 | exact-N 保持；容量冲突可见，不能自动覆盖用户选择 |
| 五张原表和长公式 | 全列、末行、变量、条件完整；表格范围半开区间无重叠/遗漏 |
| 双语、中文、英文 | 语义翻译去重和实际两种语言空间分别计数 |
| JSON截断/空正文/缺字段/错误ID | 不发布、不伪修复、不把模型错误混成密钥错误 |
| 中途重启/重试 | candidate、accepted outline、writer、critic 的版本和 hash 一致 |
| 最终外观 | 自动原生 bounds 与人工页面检查都完成；剩余源码标记、重复、标题类别错位不能被纯 coverage passing 掩盖 |

完整事实与当前外观限制同时成立：上轮 79 项审查及 native export 通过，不代表 presentation design 已达 Gamma，也不保证无遗漏语义或无重复。未来应让整稿报告明确区分这些验收轴。

## 补充：local-run25 与 Gamma 的逐页语义和外观复核

本次重新查看 local-run25 全部 51 页原生渲染及 Gamma 全部 10 页；下面的判断同时参考可见页、原生文本提取和原文。PowerPoint 中的文字是待分析资料，不作为执行指令。原稿保留为基线，不直接改写成看似由 agent 生成的新稿。

### 逐主题对应与问题清单

| 模块页 | Gamma 页 | point-by-point 发现与改进 |
| --- | --- | --- |
| 1 | 1 | 模块只留中文总题，没有教程定位和本稿范围。Gamma 用标题、定位、摘要三级。封面应提取来源总题与副题，避免把章节标题误当总题；品牌水印属于模板证据，不能擅删。 |
| 2–6 | 2 | 模块将统一定义和五术语拆成五页，表格再加完整复述；第 3 页标题承诺五术语却只含两行，第 6 页标题“五类”实际仅 Alpha。Gamma 四卡片遗漏 Signal，不能照抄其覆盖。应建立 definition/contrast 关系：五概念一次完整对照，例子与区别各有唯一归属；表格分片标题基于真实 rowRange。 |
| 5、7–9 | 2、5 | 模型相对性重复四次。更严重的是第 7/8 页把 CAPM→FF3→Carhart4→FF5→FF6 拆成数字列表，英文句子在括号中断开；FF6) 是第五个列表项。这是把标点序列误判为 workflow。解析应识别段落内部括号/箭头，不把每个名称认作独立行动。翻译对是一条 claim，两种语言的空间仍分别计算。 |
| 10 | 4 | 风险/错误定价有对照价值，但两侧装饰圆图片压缩正文，生成说明重复源段。采用 parallel alternatives/contrast，不画成先后顺序；失效条件应作为增量说明。 |
| 11–16 | 3 | 六页 CAPM 推导与失败集中在段落；第 11 页“证券市场线”断成孤行，第 13 页正文残留 \\frac/\\gamma/\\mathbf，英文和中文再次逐段复制。讲义合同可保推导，但需 assumption→optimization→equilibrium→testable implication→failure 的关系链；综述只讲主张并记录推导进入附录。Gamma 在 CAPM 公式附近也存在文字挤压，不能作为无缺陷金标准。 |
| 17–23 | 3、10 | APT、FF3、Carhart、FF5、q、SY 每页有事实，但模型差异主要埋在段落。应抽取统一 model/factors/motivation/construction/limitation 维度，保公式与条件，避免每页重新介绍前序模型。原文“2×3×3/27 portfolios”有算术冲突，需来源冲突诊断；不能以所谓保真宣告事实正确，也不能无记录改成 18。 |
| 24–26 | 3、10 | 贡献/局限表前四行和后三行拆页，随后再来总览；第 26 页可见原始竖线及 CAPM、SY 两行残片，标题却宣称七类全景。表格不应作为 keyPoint 再输出正文；结构对象拥有唯一主显示者，摘要需引用整个对象或声明局部范围。 |
| 27–28 | 4 | 检验与解释分散，GRS 页装饰图片占位过多；第 28 页“三大解释”主项只列 risk compensation，另两类藏在长段落。标题的类别数、类别名称必须与实际组件一致。Gamma 合并 GRS、风险、行为，但摩擦不单独成类，仍有语义压缩。 |
| 29–32 | 5、6 | 因子动物园、三维评分卡与最低标准重复；第 29 页 t>2 成孤行。第 31 页只显示低波/规模/流动性三行，说明却重新介绍七行；第 32 页又把整表改写成正文。应统一“问题→三种评估维度→准入条件”，消除表格/段落双重归属。Gamma 的 scorecard 缺 Liquidity 行和 data-mining 列，完整合同不能采用该省略。 |
| 33–36 | 6 | 模块第 33 页标题价值/动量/质量，但表只有价值/动量；第 34 页标题投资/低风险/流动性，表实际质量/投资/低风险；第 35 页标题情绪/另类，表实际流动性/情绪。属于分片后标题未同步，不是提取统计误差。第 36 页一个另类数据行加冗长定义。应根据实际内容重算标题，宽表优先，保 Typical controls；Gamma 对应列缺失。 |
| 37–38 | 7 | 第 37 页正文很少，四张大圆装饰有三张被正文遮住，且没有构造方式的统一维度。应比较 alternative constructions，并单独呈现 timing 条件。Gamma 的纵向连接线容易暗示并行构造方式有顺序；关系类型优先于模仿装饰。 |
| 39–40 | 8 | 第 39 页英文从“quality screens”开始，像从句子中段截取，右侧另段重复总结。完整提取要保句边界和上下文；市场差异按 structure/investors/shorting/disclosure/regulation 比较。第 40 页 HML 保留算式，比 Gamma 只有构造图更完整，但应以 2×3 矩阵、组合、合成公式形成一个例子。 |
| 41 | 9 | 模块只有九个步骤名、两种语言及补充段，缺每阶段输入/操作/输出/检查。Gamma 聚为四阶段、每阶段具体动作，阅读成本低；其中扩展细节仍需按 source_only/source_plus_explanation 区分依据。每个步骤必须保持次序，翻译不是第二条流程。 |
| 42–43 | 10 | 八条标准有内容；第 43 页右侧“资料库也是警告”连续出现两次，结束性结论之后又放八页汇总，破坏收束。结论应在主稿最后，附录明确标识；critic 空问题数组不能覆盖确定性重复诊断。 |
| 44–51 | 10 | 原始八行五列表逐行拆成八页，每页重复五列表头并附解释；窄表头产生 Factor/s、Stambau/gh-Yuan 等断词。Gamma 用一张八行表，但它将 Factors 和 # 合并，缺完整因子名称，字号明显更小。改进必须用完整五列表全宽测量、按列负载分配宽度、合并可容纳相邻行；不能硬指定一页或靠缩字。第 51 页残留模板标签“14. SUMMARY”，实际是单个 SY 表格行；模板正文标签应填槽或报告未映射，不应把它当生成标题。 |

### 语义模型：从来源切片转为读者关系

1. 当前成功验收偏重 source ID、表格行、公式和容器边界。“每项有归属”不能证明“每个主张只讲一次”，也不能证明对象的比较关系保留。模型需要同时维护 claim（语义主张）、relation（definition/contrast/ordered workflow/alternatives/formula derivation/matrix）、source ownership（可追溯证据）及 display（真实空间）。
2. Gamma 的优势是把概念分组并使用统一视觉维度；它也有省略、微小字号和局部拥挤。评价轴应拆成来源完整性、语义关系、去重、叙事分布、字体/排版五项，不能将 10 页或“全部 pass”当唯一目标。
3. 分片只改变 display，不应再创造 claim；补充说明必须有新的机制、限制或结论。表格原生对象不再作为 raw Markdown keyPoint 重复展示。片段可以保留同一来源对象 ID，但记录互斥行区间。
4. 生成后再按实际 rendered content 校验标题：语义总题、页标题、章节标签、表头、图表标题分别建模；不按 shape 顺序或第一个 a:t 粗取标题。原生 placeholder 优先，无 placeholder 时按顶端几何/字号/正文排除打分，保留 confidence 与候选，不把小型 section label 当主标题。
5. 主稿次序为定义→理论/对比→检验与解释→动物园问题→分类评估→构造与实例→策略→结论；讲义的推导与全量表格可进入明确附录。自动页数必须依据选定合同和真实模板，用户的 exact-N 仍受保护。

### 内容/标题提取与三语验收

- 原始文本 raw 与可见文本 display 分开保存，Markdown 强调、数学 wrapper 是表现语法，不能出现在原生表格里；公式变量、下标、负号、条件和原始出处必须可追踪。不能为了干净外观直接吞掉无法解析的 LaTeX，应保留原文并报告未支持表达式。
- 句子与列表切分需尊重括号、引号、箭头和公式；纯章节目录不是正文，来源 imperative 不是操作指令。
- 输出语言支持简体中文（zh）、英文（en）、繁体中文香港（zh-HK）；旧 zh-Hant/zh-TW 与 UI zh-TW 存储需明确兼容，不把香港输出默默当简体。默认保持来源语言；用户选单语时是有记录的翻译策略，符号、ID、数据、专有名词不改。
- 语言检测、预算和重复检测不能只适用于简体：繁体字同样按 CJK 宽度；英文标题按单词边界，公式按结构。翻译来源与生成语言分别记录。三语分别覆盖标题/错误状态/候选大纲/字体与符号回归。

### 追加实施验收（与上方 P0–P2 清单合并）

| ID | 需要落地的模块改进 | 验收证据 |
| --- | --- | --- |
| R1 | 三种内容合同与三语策略；source 与额外要求分离 | policy 归一化兼容、UI 选择、prompt 指令边界测试；省略/附录由显式策略决定 |
| R2 | 精简 skeleton + 确定性 source ID 编译；大纲可读视图与合同分开 | 同来源请求字节、syllabus 字符与 coverage 对照；没有 truncated JSON 自动接受 |
| R3 | 安全错误分类与 candidate 持久化/下载 | 空输出、截断、坏 JSON、坏 ID/coverage/fit 单独测试；已接受版本不被失败候选覆盖 |
| R4 | 原生模板预估、关系候选和测量后再合并 | 真实 frame、完整表尾与行 ownership、exact-N 不变；初估/候选/冻结与 split/merge trace |
| R5 | raw/display、列表边界、标题角色及分片标题修复 | 原稿第 7/8、26、33–35、44–51 的通用回归；无 Factor Zoo 专属分支 |
| R6 | 最终语义/重复/标题/未清理标记门禁及三语基准 | 旧 51 页可检出问题；新输出逐页检查，不把 bounds 或 critic pass 冒充人工视觉通过 |

本节先记录观察与验收目标；实施结果和未通过项在后续“实施结果”中逐项回填，避免把计划当成完成。

## 实施结果：逐页复核后的模块改动（2026-10-09，持续验证）

上文“仅提出建议、未启动新长整稿”是此前配置诊断阶段的历史状态。本节更新该状态：已先完成两份 PPTX 的逐页比较，再按清单修改既有隔离工作树 `application-local-run17`。主仓库原有工作未覆盖；尚未提交、合并或部署。所有修复是通用模块逻辑，没有 Factor Zoo 专属页码或内容分支。

### R1–R6 实施对应

| ID | 已实施的行为 | 验证及实际边界 |
| --- | --- | --- |
| R1 | 生成策略支持 overview、course、full_source；语言支持 zh、en、zh-HK，旧 zh-Hant/zh-TW 归一为香港繁体。来源与 userRequirements 分开；来源正文中的“make 15 slides”不会被当作用户页数。UI 提供三语与内容合同选择 | 通用归一化和指令边界测试、真实创建界面 CDP 通过。明确选择单语时标题与新增说明使用该语言；绑定原表/代码/公式/证据仍保留原文，UI 已披露此范围。未宣称全表单元格自动翻译、未宣称旧创建页每个历史文案都完成本地化 |
| R2 | version=2 skeleton 只由模型返回短标题、主张、真实来源 ID 和必要范围；代码推导 refs、claim、pageContract、fit。长来源按完整关系单元分组，最多三路执行；成功组以 prompt hash + model 留存，重试只补失败组。修复使用局部 index/delta；writer 取本页完整来源，完整输入及 hash 保持不可变 | 六个 Sonnet 来源组均得到有效 schema；通用 API 测试证明部分失败后 candidate 留存且匹配组复用，未接受缺失来源。UI 默认展示标题和两行主张预览，展开编辑保留完整文字，无字符串截断。短大纲 JSON 与代码执行 JSON 分开统计；本轮双语 syllabus 仍可能长于上轮中文 syllabus，不能把去掉机器字段等同于所有可见文字都减少 |
| R3 | transport/auth/model_unavailable/empty/truncated/invalid_json/schema/coverage/capacity/input_budget/cancelled 分流；记录受控 finishReason 和实际 token usage。大纲阶段 8,192 output tokens，其他阶段沿用 32,768。支持 schema 的模型使用 JSON Schema，仅在明确“不支持结构化输出”的 HTTP 400 时回退一次 JSON | production SDK 本地 wire 测试、三语失败界面和候选 JSON 下载通过；无生成按钮可绕过失败门禁。截断 JSON 不补括号接受。原始网关响应、密钥和头信息不写 candidate。HTTP 503 不误称“密钥没配置” |
| R4 | 原生模板解析后校准；使用现有可兼容 body 的实测几何安排页，绑定后再次测量。加入三栏及不等宽布局、全宽表格加说明、按列负载/最长词分配宽度；完整组件分片优先于模型再造页，分片后只在覆盖和重新测量通过时合并。最终来源结论移到主稿表格之后、显式附录之前 | 原生容量 52 项回归通过，manual/confirmed exact-N 保持。另一次真实模型 skeleton 46 页经 fresh template 测量为 39 页、零规划问题；正式新运行的一份 48 页候选冻结为 51 页。39 是另一份规划回放，不能当作最终导出的页数或本轮固定目标。实际字号没有调小，行尾没有删减 |
| R5 | raw/display 双轨；清除支持的 Markdown/TeX 表现语法，原公式仍由 OMML 路径处理。段内括号/箭头不再误判 ordered workflow，英文小数/缩写/句界分开。原生标题先识别语义 placeholder，再按位置、字体和正文排除，记录候选/置信度；表格分片标题从实际选中行重新推导 | 旧 51 页和 Gamma 10 页重新原生导入验证：居中封面识别正确，Gamma 第 5 页的“400+”不再被当主标题。通用测试覆盖最后一行、行范围、断词、标题错位与原始数学。未知 TeX 不会直接吞掉；单一超长句的兜底切分仍需视觉/语义审查 |
| R6 | 增加确定性 editorial 检查：残余 markup、表格竖线正文、重复整段、流程括号碎片、实际表格范围与标题、同语言标题映射；完整重复解释句另报 warning。报告区分 source completeness、semantic/editorial、physical layout、native export 和人工视觉验收 | 旧稿检出 27 项问题/警告，包含第 43 页重复“资料库也是警告”。跨语言标题只报需要复核，不能凭字符串差异证明语义错误。三语原生导出和可编辑 reimport 回归已通过，真实新 Factor Zoo 整稿仍在 writer/critic/export 流程中，最终外观尚未批准 |

### 正式回放额外发现并修复的两处断点

1. `normalizeBrief` 对缺省 goal/objective/thesis 使用未限长的整份 `project.prompt`，在 writer 中把 41,415 字符来源重复三遍。修复 fallback 本身的长度，并从独立要求或来源总题取得简短目标。回归证明来源 imperative 不成为 brief goal。真实 writer 请求从约 16–17 万字符降为约 3–3.4 万字符；修复仍使用完整页属来源与原始 hash。
2. `normalizeSlide` 用完整来源章节名覆盖 writer 已返回的原生 section 槽位标签。即使模型已写短标签，下一轮依旧报 5/8 visual units 槽位溢出。修复为优先采用 writer 的 section 槽位值；完整章节仍留在 outline/contract，不借缩字通过。另将标题修复 schema 改为明确请求“新合格短标题”，避免 schema 又示范刚被拒绝的长标题。

这两处都是全流程回放得到的具体问题，独立容量回放和小型 JSON 连接探针不会自动覆盖。失败/主动中止运行均保留，不能清理后仅展示成功记录。

### 模型与请求层级复测

| 模型 | 最新真实请求证据 | 结论 |
| --- | --- | --- |
| qwen3.8-max（默认不变） | 小型 JSON 曾成功；长原文请求和单次全集目录请求超过 240 秒；短六组中四组 schema 成功、两组超时 | 密钥与路由可用；当前网关下未获得完整 Factor Zoo 大纲，不能声明端到端通过。后续需仅补失败组，或评估上游性能/推理预算；不盲目增加重试次数 |
| claude-opus-5-5 | zh/en/zh-HK 三个真实三页 schema 均成功（约 43.5/38.7/56.5 秒）；长单请求超时 | 具备三语小合同能力，完整 Factor Zoo 尚未导出验收 |
| claude-sonnet-5-5 | 三语三页 schema 均成功；实际 Factor Zoo 六个来源组全部成功，已进入真实 writer/critic/export 验证 | 本轮用于整稿验证，未改写 Qwen 默认配置；是否整稿完成以随后运行报告为准 |
| gpt-6.1-sol | 授权目录缺失、精确调用 503 | 需要网关上游渠道/组权限或新的官方 provider 凭据；本地下拉框无法补足远端权限，未用其他 GPT 型号冒充 |

原长规划请求 328,476 UTF-8 bytes；去重全集目录约 72,982 bytes；完整单元分组每次约 12–17 KB。上游实际 usage 与字节估算分列，usage.reasoningTokens 缺失就是未知，返回 0 只表示网关报告值。schema 成功、来源 ownership、模板 fit、最终导出和人工视觉检查是不同验收阶段。

### 已有验证证据与未完成项

- 最终源码全量测试 2,824 项：2,823 通过、1 跳过、0 失败；新增 fallback/section 回归及大纲折叠视图、展开后完整主张编辑的 CDP 复验均通过。
- 全应用相关 smoke 41/41；最新 PPT 专项 smoke 24/24、容量 52/52；原生文件 integrity 实验同时验证正确输出与故意缺失数学/单元格/媒体等负例。
- 三语各 3 页的生产 native export/reimport 回归通过；这是通用回归样例，不是 Factor Zoo 最终稿。CJK 字体发生系统 fallback 的请求/解析字体记录保留，没有据此声称目标字体已安装。
- 三語 candidate failure/download 界面在桌面与手机 viewport 经实际开发页 CDP 验证，console errors 为零；使用隔离 API fixture，不冒充已部署登录账号。
- 对原文“2×3×3/27 portfolios”的事实冲突，目前仍保留来源并需审查指出，尚未实现通用数学事实求证器。综述/讲义两种合同的完整 Factor Zoo A/B、换 Gamma 类模板和三语完整整稿尚未全部完成。
- 当前所有真实整稿执行是本机 macOS x64 adapter；GitHub ARM64 账务预检限制未解除，未补写为云端运行成功。GPT、已安装 Electron 凭据迁移、远端账号部署不属于已通过项。

证据集中在 [remediation/](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/)，包括 [旧稿 editorial 审计](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/baseline-editorial-audit.json)、[真实模型分组](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/group-sonnet/report.json)、[39 页规划回放](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/fresh-template/report.json)、[三语模型 schema](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/language-models-claude/report.json)、[三语原生导出](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/native-languages/report.json)与[三语失败界面](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/ui-languages/report.json)。执行计划与代码仍在既有隔离工作树，最终整稿结果将另行回填。

新增验证：同一张表的相邻、不重叠完整行片段，即使模型给出不同的行问题，也允许在完整单元格、实际 fit 与标题范围重新验证通过后合并；不同来源主张仍不能仅凭相同 groupId 合并。容量回归 52/52；最终这份实际候选仍是 51 页，表格分片改善并不意味着理论/双语全文自动压成 Gamma 的 10 页。

最终复验补记：PPT 专项 smoke 24/24 通过；writer 非字符串 title 现在归类 schema_invalid 并只作有限合同修复，transport 不触发此重试；未完成内容节点会显示 failed 而非继续 spinner。正式首个完整内容批次 48/51 通过，3 个失败节点（2 transport、1 title 类型）保留，已使用生产 retry 路由进入新审查 run，未清除已通过 48 页或旧审查历史。默认及 provider default 只读复核仍同为 qwen3.8-max，密钥仍为加密存储。


### 后续实测：整稿审查预算与未通过门禁（2026-10-09 23:40 ET）

- 已有 51/51 页通过 writer 合同，但这只是内容节点完成，不代表整稿获准。第 4 次真实回放的 reviewer 输入 335,082 字符 / 416,943 bytes，在 241.8 秒 transport 超时。去除第二份主题全文、sourcePacket 重复视图、同一表格的 text/rows/rawRows 重复副本后，第 5 次同稿仍有 246,298 字符 / 297,540 bytes，241.98 秒再次超时。保留完整 INPUT_FRAMEWORK、所有当前可见单元格、chart 内容、原始 evidence 与 quote ID；同项目回放确认输入对象未被修改。
- 第 6 次生产 retry 已开始：仅 review:deck 且输入不少于 200,000 bytes 才获 420 秒模型预算 / 450 秒队列预算；其他阶段仍为 240 / 300 秒。超时仍失败，不自动清空审查结果；自定义测试 deadline、账户归属和暂停取消机制保留。本轮状态和每次失败均保存，不能把 reviewer 失联写成 pass。
- 先于 native export 的确定性审计为 199 项，包括 5 个硬错误：α≠0 出处不足、章节/分片编号误作事实、HML 公式被误附为邻页必讲细节。编号豁免已收紧为原文章节一致或完整原始表格行区间的证据，不凭 template-text/title 角色放行数值。新通用负例证明换数值、单位、来源归属、漏表尾仍会失败。无法确认的章节重排以及 α≠0 的事实依据仍需要内容修复；HML 的邻页归属问题已由后续源码修复。
- 真正可读 syllabus 的新实测为 title 1,677 字符、focus 5,083、description 0；主视图全文 6,760，展开包含 section 为 8,007；execution outline JSON 为 68,627。旧中文 UI 字段约 5,167，因此新双语主张数据尚未实现总字符下降。两行 CSS 预览和展开完整编辑降低界面占用，但不能据此宣称数据更短；不同语言/合同应独立对照。
- 最新完整 npm test：2,824 项中 2,823 通过、1 跳过、0 失败。新队列预算/SDK worker、章节与分片数值来源负例均通过。此前三语 UI、native export/reimport 和 24 项 PPT smoke 的结果保持；新 Factor Zoo 最终 native 外观尚未人工批准。

证据：[审查请求去重回放](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/review-budget-replay.json)、[第 4 次真实运行](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/live-run4/report.json)、[第 5 次真实运行](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/live-run5/report.json)、[可读 syllabus 真实字符](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/actual-syllabus-metrics.json)、[最新全量测试](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/full-test-navigation-budget.log)、[完整改动快照（包含本轮之前已授权改动）](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/source-snapshot/manifest.json)。


### 第 6/7 次运行与最终检查稿（2026-10-10 00:05 ET）

1. 第 6 次在 424.8 秒、第 7 次在 422.06 秒均为 transport 失败，没有生成有效模型评审。第 7 次进一步去掉物理 densityFit、无文字/无说明的设计模板图像在文本审查中的空节点、重复 mandatory registry：实际 reviewer 输入为 179,414 字符（先于 retry 的同稿回放为 179,696 字符 / 229,290 bytes）。完整原文、可见正文、表格每个单元格、图表值、带说明图像、真实输入图片、全部 32 项 obligation 与来源哈希保留；已提供 source 完整性和检查稿，不继续无限延长同一长请求。
2. HML 原生公式确实在第 44 页，不是整稿漏掉。旧 planner 的 requiredDetails 从整个粗粒度章节 chunk 提取公式，把它误附到只拥有相邻解释单位的第 45 页。v2 现在只用本页 sourceUnitIds 推导自动细节；生产 retry 重验证该合同并保存旧/新值和 run ID，显式细节仍保留，真正拥有的公式仍有正例门禁。
3. 原生导出发现两种短样例未覆盖的问题并已修复：中文 + 希腊字母 + ᵗ 没有单一字体覆盖整段；中英说明中的单换行被误导出成额外段落。现在按组合字符簇分配实际覆盖字体，保持文本、字号、粗体和原始 Unicode；charset 查询结果再按实际家族复查，LastResort/AdobeBlank 不作为有效字形。native renderer 按 textLayout 的原段落合同输出，单换行保留为段内换行。重新打开 PPTX 验证准确文本/段落、完整表格、数学结构与媒体；故意漏单元格、删公式、改 caption 等负例仍失败。
4. 使用真实 51 页已生成节点的独立只读 clone，调用当前生产 native exporter 得到 [inspection-draft.pptx](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/inspection/inspection-draft.pptx)。文件完整性门禁通过，51 页均已渲染；正式项目的 status、发布字段、来源与节点未被修改。这是检查样例，不是 workflow 审查通过的最终 PowerPoint，不能将其导出成功解释为语义/人工验收通过。

**检查稿的剩余问题，逐项记录：**

| 新稿页 | 观察 | 下一项需要达到的验收 |
| --- | --- | --- |
| 2、9–12、17–18、20、24、26–27、30、32、34 | 一段密集机制解释占页面上半部，下半部大面积空白；文本密度测量虽通过，但没有形成可扫读的对照/推导关系 | 自动模式按实际讲述问题合并/重排，关键公式与条件形成结构；不可只添加更多段落填空 |
| 5 | 公式、术语表与说明完整且无缺字；标题末字“法”孤立换行，α≠0 解释仍有来源边界问题 | 标题按完整词/中文短语改写，事实只能来自原文已给出的关系；不是靠删数字让检查失效 |
| 14、28、40 | 原模板四块色卡残留；第 14 页标题“三个预测”实际是一段总述覆盖一个卡片，三个预测没有各自占据比较位置 | 原生槽与关系角色应匹配；将预测/替代构造映射到组件，空装饰应有受控的省略或重新用途 |
| 16、23、35–37、45 | 内容过少，圆形装饰或大空白占比过高；45 页解释可与 44 页推导相邻合并候选 | 生成后重新测量低密度合并，保持 source ownership 与 exact-N；不能只修规划前的 packing |
| 19 | 中文/英文单换行已按同一段落合同保持，原生完整性不再失败 | 保持这项跨语言回归，不把符号与中文混合时的字体 fallback 当作安装原目标字体 |
| 25、29、41、44 | 大圆图被正文遮挡或截成半圆；图片本身无来源信息，却造成阅读干扰 | 对已确定为设计装饰的模板对象实施占位冲突处理；带来源证据或真实输入媒体不能随意删除 |
| 33、38、39 | 全宽完整七模型、七行评分卡、八行分类表明显优于旧稿碎片，保留完整列/尾行；38 页仍被装饰压缩可用宽度 | 保持完整单元格与原字号；同一表格在更宽且有来源依据的现有 frame 中比较 fit |
| 47 | 九步的英文和中文顺序完整，但显示仍是两条箭头长行 + 段落，没有节点/阶段的层级和检查点 | 识别显式带标签的 ordered workflow 并呈现关系；输入/输出/检查必须由来源支撑，不能照抄 Gamma 添事实 |
| 49–50 | 八行五列表现为六行 + 两行，不再八页；第 50 页仍窄，Stambaugh 和双语表头断词；右侧说明大量复述表格 | 两片继续保完整列，末片优先全宽；补充说明必须有新限制/机制。两页改善不等于总页数下降 |
| 51 | 结论已经放在汇总之后，主稿收束正确；英文/中文并排仍使用较多文字 | 在所选内容合同内控制结论主张长度，保持双语事实与不确定性一致 |

人工结论：**检查稿未通过外观/语义验收**。来源表格完整、原生数学、段落和字体链条已有改善；整体信息分布、真实流程/比较结构、装饰避让、标题断词与生成后的低密度重规划仍未完成，不将 R6 写为“全部完成”。

### 清单状态回填

- 已落地并回归：三类内容合同/三语策略、source/requirements 边界、短 skeleton + 本地合同编译、分阶段安全错误、候选版本/下载、局部大纲 delta、真实原生容量校准、完整行分片与规划阶段重合并、多栏/全宽表候选、raw/display 与基本关系切分、native 标题提取、确定性重复/标题/markup 门禁、可读 UI 与执行合同分离、阶段字符/字节/token 遥测、模型能力实测矩阵、混合字形/段落原生导出。
- 部分实现，未达到清单验收：真正语义去重（目前 ownership + 重复诊断不等于自动判定所有同义主张）；短 focus 的实际长度（6760 字符仍多于旧中文 5167）；完整关系组件呈现（第 47 页仍为段落）；低密度/装饰/标题的生成后重规划；整体页数下降（仍 51 页）；综述/讲义/完整保留合同的整稿 A/B 与多领域、三语整稿密度基准。
- 外部/运行未通过：整稿 reviewer 的真实长请求；GPT-6.1 Sol 网关可用性；GitHub ARM64 账务预检；已安装 Electron 配置迁移和远端部署。发展版配置本身有效，default 与 provider default 均为 qwen3.8-max，密钥加密保存；这些问题不能统一解释成“未接入 LLM”。

最后全量验证仍为 **2823 pass / 1 skip / 0 fail**；PPT 专项 smoke 24/24、原生容量 52/52，新增文件 integrity 与单换行/混合字形正反例通过。所有改动留在既有隔离工作树，未提交或部署。

汇总状态及门禁：见 [final-report.json](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-factor-zoo-postmortem-20261009/remediation/final-report.json)。该报告标记 incomplete / humanVisual failed / modelReview unavailable，检查稿不能作为已批准最终版本。
