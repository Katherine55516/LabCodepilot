# PPT next-round audit

2026-10-03。事实源是本轮当前源码；要求来自用户明确采用的 `codex_prompt_ppt_next_round_with_gamma_content_benchmark.md`。本轮没有修改原型、创建步骤或产品入口。模型响应使用用户授权的确定性模拟；模板解析、API/DAG、状态存储、质量检查和 PPTX 导出实际执行。

## 1. Current Architecture / Current Workflow

### 1.1 边界与状态

`PptWorkspace / PptCreateWizard / PptM3` → 已登录 Next `/api/ppt/[...segments]` → Cowork `handlePpt` → Source/Planning/Run/DAG → Deck IR v3 → Render Tree（整数 EMU）→ SVG / PPTX / PDF。文件、项目、事件和发布快照属于服务端账号；客户端关闭监控不取消后台任务。模型给内容与语义选择，代码负责权限、页数、对象、几何、版本和发布。

创建状态：`ingesting → outlining → outline_ready → generating → completed`；错误分为 `failed` 与可编辑的 `quality_blocked`，另有取消/恢复和节点重试。局部编辑使用 proposal/intent、revision 与每页 epoch；候选预览不覆盖成稿，应用修改产生草稿，显式发布才更新可下载版本。

| 层 | 当前实现与入口 | 权威数据 / 约束 |
|---|---|---|
| 工作区 | `src/components/ppt/PptWorkspace.tsx`：startNew/startTemplate/startUpdate/confirmLlmGate/create | 创建方式、模型门、选中项目与脏状态 |
| 创建 | `create/PptCreateWizard.tsx`：draft/analyze/submit；`TemplateBrowser.tsx` | 模板先于 input；标准/详细、语言随来源；页数 touched 与估算请求序号隔离 |
| 模板/更新 | `PptM3.tsx`：uploadTemplate/prepareUpdate/createUpdate | 模板预览、用户模板管理、旧版+进展的更新 |
| 请求 | `src/app/api/ppt/[...segments]/route.ts`；`lib/ppt-api.mjs` | 账号守卫、路径白名单、body 限制、source/title/pages/model 验证 |
| 来源 | `ppt-source.mjs`；`ppt-semantic.mjs` | 原文段落引用不变；表格原子化、公式 fence、chunks、证据与 Inventory |
| 规划 | `ppt-planning.mjs`：build/rebuild planning；`ppt-prompt-contracts.mjs` | Brief、Story、每页问题/主张、Coverage v2、merge/split、角色/容量、逐页 source packet |
| 执行 | `ppt-api.mjs`：startIngest/startOutline/startGeneration；`ppt/run-service.mjs` | Source→Outline→每页 Source/Content/Layout/Preview/Quality→Review/Repair/Publish；内容并发上限3 |
| 修改 | `ppt/command-service.mjs`、`proposal-service.mjs`、`generation-edit-service.mjs`、`runtime.mjs` | 服务端候选、固定范围、幂等、revision/epoch、排队与失败恢复 |
| 存储 | `ppt-store.mjs`、`ppt/repository.mjs`、`event-store.mjs` | 账号 JSON/事件/修订；v2 快照引用不可变媒体；没有引入 SQL schema |
| 模板保真 | `ppt-template-fidelity.mjs`、`ppt/import-pptx.mjs` | 原包+shape ID；主题、master/layout、媒体通过原包保留；可编辑对象结构化，未知对象保守保留 |
| 发布 | `ppt/publish-service.mjs`、`ppt-render.mjs`、`ppt-pdf.mjs` | 发布 revision、独立 artifact 路径；QA/渲染失败不能冒充新发布成功 |

### 1.2 每条 workflow

以下 UI 文件均在 `src/components/ppt/`；服务文件均在 `apps/cowork-server/lib/`。

| Workflow / 操作 | Source / function | State / validation | Next | Back / failure |
|---|---|---|---|---|
| Prompt | Workspace.startNew → Wizard.submit；API POST projects | 先创建方式，再 LLM，再模板，再输入；prompt 非空、模型有效、模板 mapped | 估算→生成（内部 outline）→DAG | 返回模板保留同一 wizard 草稿；失败显示错误，不伪完成 |
| 粘贴文本 | Wizard.analyze；API startOutline | 完整 text 归一化；来源限制与补充图片校验 | Syllabus 可编辑→确认→生成 | 可回模板、重新规划；旧估算返回不能覆盖新输入 |
| 导入后生成 | Wizard.FileSource；API startIngest | `.md/.html/.docx/.pdf/.xlsx/.pptx` 等允许格式；源文件既有8MB限制 | 实际抽取→语义分块→估页→Syllabus→确认 | 无可提取内容/损坏/格式不支持明确失败 |
| PPTX 保真打开 | FileSource importMode=editable；importEditablePptx | 仍先经过入口模型门；导入页数按原 PPTX，不受小模板页数覆盖 | 原生 IR→可视化编辑 | 不冒充生成；保守锁定不可编辑对象，错误保留输入 |
| Template-first | Workspace.startTemplate；Wizard lockedTemplate | 先在库选模板，再创建方式→LLM；模板锁定后进入同一 wizard | 预览/确认→input→估算→Syllabus/生成 | 不额外创建第二份模板；重新开始清理模型/标题/页数状态 |
| 基于上一版更新 | Workspace.startUpdate；M3.prepareUpdate/createUpdate；API.handleUpdates | LLM门→旧项目/旧文件+进展→模板/页数→更新大纲；6–100页，旧页 ID 合法 | keep/rewrite/add→新项目DAG | 不改原项目；解析/旧页映射失败可更正重试 |
| 模型选择 | workspace/PptLlmGate.tsx | 未选模型不能继续；new/update 独立 modelKey | 同一入口的下一步 | 返回创建方式；重新开始清空该次 gate |
| Optional title | Wizard title；API deckTitle | 用户标题锁定与格式编译；模型标题单独来源标记 | 同步封面/列表 | 不因重规划覆盖用户标题 |
| Template Gallery/Preview | M3/TemplateBrowser；templatePreview | mapped 可用，reference-only 不可生成；page 范围验证 | 选择模板/翻页 | 错误页可重试；只读预览不写项目 revision |
| 页数估算 | Wizard estimate effect；planning.estimatePageRecommendation | 初始模板页数，输入后 loading；手动页数优先；压缩风险显式确认 | 使用建议或 +/- 后生成 | stale response 被丢弃；回退不丢用户页数 |
| Syllabus | Wizard.OutlineEditor；API outline | 标题/描述/顺序/增删；最终数量须匹配确认页数 | 确认→generate | 重新规划清理旧契约；小视口内容区可纵向滚动，底部按钮可达 |
| 渐进生成 | generation/PptGenerationMonitor.tsx；Run/DAG | 标题/正文/预览按真实节点状态到达；3个内容 worker | 已生成页面可查看，跟随或手动选页 | 已完成页不因浏览重新生成；失败节点保留诊断 |
| 修改生成要求 | GenerationEditDialog；generation-edit-service | 固定 current / 打开时尚未开始页 scope；服务端 intent、每页 epoch | 排队→应用/部分失败；生成结束转草稿修改 | 草稿分 scope 保存，关闭/重开保留；失败可定向重试 |
| 后台/Task Center | Workspace；workspace/PptTaskCenter | 监控视图与服务端运行分离 | 返回列表仍运行；重开恢复 | 不启动重复任务或客户端假计时器 |
| 失败/恢复 | API retry；run-service.recoverRun/runtime | 持久节点状态、命令日志、写前恢复标记 | 只重做失效/失败范围 | stale epoch/revision 冲突拒绝，不能覆盖较新内容 |
| Visual Editor | editor/StructuredPptEditor；canvas/PptCanvas；inspector/PptInspector | 统一16:9/原生尺寸与 EMU；对象 ID、geometry、能力约束 | 编辑命令→草稿 revision | undo/redo；未保存退出守卫；保留viewport |
| AI 局部优化 | StructuredPptEditor；proposal-service | 页面/对象范围，动作参数（扩写比例、翻译语言/方式/术语） | 服务端 proposal→前后预览→应用 | 取消不落 revision；候选过期拒绝；可撤回本次优化 |
| Annotation / AI Chat | editor + proposal/edit-context | 目标对象/页面上下文与 source/template 锁 | 定向候选或命令 | 不绕过版本、来源和发布门禁 |
| Version / Theme | history/PptHistory；command-service | 修订指纹、模板能力、旧版快照 | 预览/恢复/换主题→草稿 | 历史/发布版与草稿分离；失败保留旧导出 |
| Save / Publish | Editor；publish-service | 草稿同步与发布不同；QA硬错误阻断，警告可发布；editorialReady另由现有评审规则计算，不能代替人工复核 | 原生PPTX→发布快照 | render失败不更新publishedRevision；仍可导出上一发布版 |
| Present / Export | Workspace/editor；exporter/PDF | 从真实发布版或明确的演示视图读取 | PPTX/PDF/页面演示 | 无成功产物不显示虚假下载成功；字体仍取决于渲染环境 |

### 1.3 文档漂移

早期 M1–M5 交接文档中的“只映射颜色”“模板8MB”“只写标题+要点”“一次 critic 后只做确定性修复”是历史实现，不能当作当前事实。早期 CDP 脚本也曾按 LLM→入口→input→template 点击，已落后于最新 mode→LLM→template→input 顺序。本轮新增 `scripts/ppt/verify-cdp.mts` 使用最新流程。原生 PPTX/POTX 和 managed 模板现在共用预解析 IR；旧 palette builtin 仍存在。本轮补充以本报告、`ppt_changes.md`、最新 prototype-policy 交接为准。

## 2. Full Issue Registry

优先级按影响判定：P0=数据/来源或发布完整性；P1=主流程、容量、性能、安全边界；P2=诊断、表现和运维。下面包含重现的问题、历史问题的回归确认，以及仍需环境验证的边界。已通过不代表真实模型和生产环境已验收。

| ID / Workflow | Severity | Reproduction / Expected → Actual | Root cause / Source | Fix / Regression |
|---|---|---|---|---|
| R01 全生成 | P1 | 同源22页应及时可编辑→Before约110秒 | ppt-store 每次读写重复压缩、恢复媒体；migrations每读整份clone/stringify | 账号内容寻址媒体、轻量v3 guard；3次Before/After、long-storage |
| R02 Template | P1 | 原模板12.34MB应有明确可配置策略→8MB固定拒绝 | frontend base64 / validateTemplate /旧parser多层不一致 | binary upload、16MiB用户/64MiBmanaged；security边界测试 |
| R03 Template | P1 | 注册一次、运行复用→预览/创建重复import | 没有持久versioned parsed IR | shared IR、checksum/parserVersion、preview复用；registry parse计数测试 |
| R04 Template | P0 | 大包可控失败→缺图像像素/对象/活动资源统一门 | archive分析与editable import分散 | shared ZIP/XML/image/resource validator；攻击fixture拒绝 |
| R05 Template | P0 | cache hit应复制可导出原包→开发复核发现Buffer/路径假设错误 | files.writeFile要求Readable且仅basename | 使用流+返回路径；registry读取流并断言字节/长度/owner/path |
| R06 Storage | P0 | 永久删除应清理修订→保留projects/id历史目录 | 原remove只删顶层snapshot | 删除项目历史；离线GC保留被其他快照引用的资产 |
| R07 Evidence | P0 | 按本页chunk取事实→宽segment范围混入相邻事实 | selectEvidenceForSlide refs优先级 | chunk优先、segment仅fallback；evidence-quality |
| R08 Evidence | P1 | Unicode公式与TeX同义表达不应误报 | 逐字符串公式判定 | 常见记号归一化，来源数值约束不关闭；evidence-quality |
| R09 Content | P0 | 表格应保留全列/全行→原22页0原生表格 | table被splitLongUnit切头；slot合同把matrix降为短句 | 表格原子块、typed引用/行段、原生表格；5源表→7对象，跨域原生导出 |
| R10 Content | P0 | Summary/末尾模型表不能静默消失→旧稿只留清单 | 只有topic引用，无structure/end-section账本 | Inventory/Coverage v2/end QA；最终摘要、末尾表、双语清单实际可见 |
| R11 Content | P1 | 公式整体引用→fence与正文碎裂 | 逐行分块缺跨segment math状态 | 完整公式block；保留原来源refs；semantic测试 |
| R12 Content | P1 | 相关定义/模型关系可聚合→过度micro-slide | 规划易按heading分配，容量只看短点 | source inventory、many-to-one/one-to-many、显式reason与capacity诊断；跨域merge/split测试 |
| R13 QA | P0 | 只统计实际导出文本→隐藏slot/factSynthesis冒充覆盖 | preserve与legacy copy重复表示 | visibleSlideText读取native/sourceArtifact节点；清掉被替换body |
| R14 QA | P1 | 表格/完整流程应被识别→误判空白/文字不足 | 旧QA只数bullets/blocks/chars | source节点、真实行/步骤计数；quality与content-inventory |
| R15 QA | P0 | sourceArtifact仍须验证标题及省略授权→早期实现过早return | inspectTemplateSlotDraft bypass整页 | 仅跳过已替换正文的旧容量；标题、section、omission继续检查 |
| R16 Native template | P1 | 横幅白字底色保留→语义图片替换破坏对比度 | 未区分overlay callout与独立照片 | PNG横幅几何+文字覆盖保护；evidence-quality/native图片hash检查 |
| R17 Native template | P1 | 百分比样例应可替换→大号35%被选作标题 | slot标题仅按字号面积 | percentage metric排除标题候选；native槽位回归 |
| R18 Preview | P1 | 表格预览应与PPT同尺寸→CSS像素放进EMU后极小 | preview.table单位不一致 | HTML子树scale9525、加权行列、wrap；CDP实际尺寸和溢出检查 |
| R19 Export | P1 | 中文可见→本机LO缺等线字体时空白 | 本机headless字体搜索路径，不是文本丢失 | QA字体映射到系统Heiti；重渲染双语页；生产Docker已有Noto CJK，仍需部署验收 |
| R20 Source notation | P2 | 表中变量可读→原始$与常见TeX残留 | source对象直通字符串 | sourceDisplayText适配常见符号/分式，未知命令保留；明确尚非OMML |
| R21 Upload proxy | P0 | 原二进制应完整透传→request.text会破坏字节 | Next仅JSON请求假设 | bounded Uint8Array、content-type保留；binary上传fixture |
| R22 Cache/storage | P1 | parser升级/跨账号不复用错误IR | 需要version/hash/namespace失效 | pptx-ir-2+sha+uid；registry isolation/hash测试 |
| R23 Trace | P2 | Update有完整stage计时→早期run在中途创建 | handleUpdates缺startRun | 提前run、13 milestone、per-node start/end/duration/error；更新计时重新测量 |
| R24 Regression | P2 | snapshot往返一致→undefined新增字段断言失败 | metadata optional字段无条件插入 | 有值才写；M3/structured回归 |
| R25 Regression | P1 | 临时状态目录隔离→模块静态import早于环境设置 | fidelity静态引用store ROOT | 延迟import store；全部PPT selftest |
| R26 Security | P1 | 内部SVG渐变合法→过宽url正则误拒绝 | 正则回溯/未decode XML属性 | 解析后属性检验，允许#引用、拒绝外链/脚本；safe_svg及真实fixture |
| R27 Creation | P1 | mode/LLM/template/input、回退/滚动/页数保持 | 历史原型和旧脚本顺序不一致 | 本轮保留当前实现；parity桌面/390×500、LLM与页数race回归确认 |
| R28 Generation edit | P1 | current/remaining范围固定，草稿不丢，epoch防覆盖 | 历史scope、完成时聊天窗口与stale候选风险 | mutation/runtime/edit-intent/recovery自检；UI两轮提交、关闭/重开确认 |
| R29 Publish/history | P0 | failed publish不替换旧artifact，跨revision隔离 | 历史草稿/发布混用风险 | structured/mutation-runtime/M5回归确认；未放宽发布门禁 |
| R30 Titles/copy | P1 | 长标题/章节、断句、缺空格、双语、Markdown、抄写应被检查 | 历史slot-only/通用3 bullets | title compiler、writing/depth/evidence既有规则回归；source结构扩展不关闭它们 |
| R31 Source depth | P1 | sparse prompt合理规划、rich input保留细节、页数冲突显式处理 | 历史机械页数与source不足/压缩 | semantic/content-depth/visible-depth/prompt-contracts；本轮不偷偷减少页数 |
| R32 Template edge cases | P1 | 空/单页/超100页、near/over limit、损坏、重复均有边界 | parser/resource/registry分散 | security、template-scheduler、M3、template-reuse UI；重复hash在30模板配额判断前返回 |
| R33 泛化 | P1 | 非金融内容也可保留结构 | 防止硬编码Factor/SMB/22页 | Research/Business/Architecture/Sparse四域fixture；新模块无因子名称分支；样例模型仅在outputs harness |
| R34 Renderer一致性 | P1 | builtin同样支持source结构→仅native分支完整处理 | 通用render tree遗漏额外list/timeline，表格旧固定字号 | 两条模板路径用相同source IR；通用PPTX加权行列、字号与结构标记；真实原生表格回读 |
| R35 可观测性 | P2 | 不以映射率冒充完整性 | title/chunk匹配缺少关系和列诊断 | topic/detail/table cell/relationship/end/underfill/fragmentation；警告保留可见 |
| R36 实际内容差距 | P1 | 全文语义完全等价尚未达到 | 22页固定模板与模拟写作取舍；词法/结构判定有限 | 本轮恢复结构、增加可审查账本；剩余公式推导、thin pages和语义判断列为限制，未伪称100% |
| R37 生产性能 | P1 | 真实LLM+远端容器满足目标尚未验证 | 本机无Cowork镜像/真实模型授权调用环境 | 本机精确脚本+模拟模型；生产Fast/Deep和多租户p95另验，非已解决 |
| R38 全应用E2E | P2 | 全仓浏览器回归全部通过→19项Chat/Search测试失败 | 失败文件及对应聊天/搜索代码不在本轮diff；旧选择器/流式测试环境需另行基线核验 | 52通过、112跳过；PPT与33smoke通过。保留完整失败日志，不扩大到聊天模块修改 |

## 3. Template limit audit

| Layer | Before / evidence | Problem | New design / config |
|---|---|---|---|
| Browser File | PptM3.toBase64，8MB源文件helper兼用 | 模板被源文件限制且base64扩大1/3 | 模板POST原始File；源文档既有8MB策略保留 |
| Next request/proxy | route.ts request.text | binary字节损坏、额外字符串复制 | 读取有界Uint8Array；`PPT_TEMPLATE_USER_MAX_BYTES`，默认16MiB，硬上限64MiB |
| Cowork HTTP | ppt-api.body 24,000,000；decodeFile旧11,200,000字符 | JSON与binary限制互相覆盖 | 新octet-stream上限16MiB；旧JSON仍24MB兼容，base64按用户配置推导；超过约18MB应使用binary |
| Sandbox file API | files.writeFile/helper 64KiB分块、expectedSize、basename | 无模板专属上限；不能传Buffer/假定子目录 | intake先验证，Readable写入，返回真实path；helper无网络/降权 |
| Reverse proxy | deploy/Caddyfile.example仅reverse_proxy | 无repo层body cap；真实网关可能另有限制 | 本轮未部署，不能声称生产网关已调大；运维须对齐16MiB/超时 |
| RPC / model | runPython stdin；routine modelCall传语义prompt | 大binary不能进入模型JSON/命令行argv | binary→文件；IR媒体→资产引用；模型仅见source文本/IDs/容量，不含模板binary |
| Database / blob | 文件账号目录，无PPT SQL blob | 同媒体随每个snapshot重复gzip | storage v2 + sha256资产；32MiB有界不可变内存缓存；旧raw/v1可读 |
| Object storage | 本地server模板.bin，无S3 | 不能假称有云对象库 | managed namespace+id/version/hash；CLI可运行；迁移S3/签名URL仍是后续部署选择 |
| Registry | 只有builtin palette+用户模板 | 公司模板需每次上传/parse | operator-only离线注册；shared IR、封面SVG、metadata/fonts/hash；用户不能写managed |
| Parser / ZIP | 旧约80MB解包/1500 entries固定值 | 只有加大上传仍可能zip bomb | 默认128MiB展开、5000 entries、ratio200、100slides、10000objects |
| Images / XML | 限制分散 | 巨图、XML实体、活动链接 | 单图40MP；PIL verify；DOCTYPE/ENTITY、macro/OLE/ActiveX、路径逃逸、SVG脚本/外链拒绝；仅惰性http(s) hyperlink允许 |
| Memory/time | parser输出旧固定12MB，无统一resource policy | manifest过大/执行悬挂 | 解析30s、512MiB RLIMIT_AS；IR stdout min(managedBytes×2,memory/4)，renderer120s；Linux容器仍需整体quota |
| Cache | 预览进程缓存，创建重复parse | 冷启动/复用成本重复 | 账号+template_id+sha256+`pptx-ir-2`；持久IR，最多12预览project，32MiB媒体cache |
| Renderer/export | 保真重新打开原始PPTX | 导出必须保留原package，无法零I/O | runtime不重新“分析模板”；PPTX发布仍必须读原包并校验shape/font/media，这是必要导出步骤 |

所有环境变量定义及上界见 `ppt-template-security.mjs`。`PPT_TEMPLATE_MANAGED_MAX_BYTES=67108864` 默认只适用于离线CLI；浏览器不能切换为managed提升额度。配置非法会失败，不解释为无限制。

## 4. Gamma 同源内容分析（不是Gamma私有实现逆向结论）

输入41,416字符（归一化41,415）、新60语义chunks；模板Process Improvement Proposal原8页；模块估算22页（建议范围18–26）；Gamma参考`The-Factor-Zoo (1).pptx`为10页。统一统计原生文本框+表格、去空白字符，Before 9,823/中位433，Gamma 9,409/中位1,019。附件的字符值口径不同，不能混算百分比。最新After数据在性能报告与content.json。

| 原文章节 / 关系 | Gamma 页 | Before AIMate 页 | 本轮处理与仍有的限制 |
|---|---|---|---|
| §1 Characteristic/Factor/Signal/Anomaly/Alpha | 3页集中说明相关概念 | 2 Factor vs Alpha + 3 Anomaly Is Relative | 定义表全部3列保留为原生对象，两页重复表头。仍按估算22页保留；并未自动证明两页优于一页。merge/capacity决策与underfill作为真实诊断暴露 |
| §2 lineage：CAPM/APT/FF3/Carhart/FF5/q/SY | 4页展示谱系与新增维度 | 4–12分别拆模型与测试 | 第6页恢复模型summary矩阵，第11–12页恢复末尾年表。单模型页可提供机制，但“页更多=关系更清楚”不成立 |
| §6 scorecard / §7 taxonomy | 5/7的卡片或矩阵 | 15/16主要标签+短解释 | 第15/16页恢复风险/错误定价/挖掘疑点，以及家族/信号/控制列；Alternative data不因Gamma省略而删除 |
| §12 workflow / §13 checklist | 9/10分组表达 | 21/22过度压缩 | 21双语完整九步，22双语八条检查；source-typed对象直接从源重建，模型不能改写单元格来“过QA” |
| §14 Summary / 末尾模型年表 | 10把清单/总结/模型表合页 | 22只留简短清单 | 摘要和年表置于11–12，结束页仍是清单；位置可以变，内容不能静默遗漏。Summary/Checklist诊断均1.0 |
| §2 equations / 推导条件 | Gamma有所压缩 | 各模型散落式子 | EquationBlock、常见TeX显示适配、coverage可检查；并非全部推导都完整可见，也尚非OMML数学编辑器 |

Gamma不是ground truth：旧同源研究已发现Gamma表格曾漏Alternative data，原文q模型的2×3×3与“27组合”也存在内在不一致。本轮不造数据、不自动修正研究结论。源文疑点和模型解释质量应单独评审。

## 5. Generalizable content design

Inventory把源段落识别为Definition/Mechanism/Comparison/Table/Equation/Process/Checklist/Summary等类型，记录priority/source_ref/chunkRefs/must_preserve_structure。Coverage v2逐source unit给目的页、representation、压缩/省略与reason，并单列topic/detail/structure/relationship。topicGroups保存模型给出的merge/split理由；缺省只标`derived_allocation`，不会把推导的分配关系伪称模型已做语义判断。容量估计不是排版证明；真正装箱仍由layout和native validator负责。

writer通过`sourceArtifacts[{sourceUnitId,rowStart,rowEnd}]`选择本页允许的源对象；表格rowStart从1起、rowEnd不含结束行、表头由代码重复。相同ID可分到多页，每页最多两个对象；列关系、行内容来自source，不来自LLM复述。确定性布局支持加权table/matrix、并列双语process/checklist、summary/公式文本。原生与builtin模板使用相同source对象，既有多卡/对比/谱系layout继续可用。容量不足明确失败并要求拆分，绝不减字号/截单元格过门禁。

质量检查以实际可见对象为准。结构标记写到导出PPTX shape name以便benchmark回读；仅有引用不等于呈现。sourceUtilization、内容单元、underfill、邻页重复、fragmentation、后四分之一recall都作为诊断；词法重叠不是语义蕴含，未标记的Gamma结构recall只能算可验证下界。不能用每页>1000字符作为目标，也不能把0个短字符micro-slide候选当成完全没有概念碎片化。

## 6. Security / migration / remaining boundary

缓存只缓存不可变媒体与版本化模板IR，项目读取得到独立mutable对象；跨账号测试与hash/parser失效测试通过。存量raw JSON及v1嵌入asset格式读取兼容，下次save转v2。回滚前需要整套备份`ppt/<uid>`（包含assets、模板IR、项目修订），不能只拷贝顶层JSON。GC默认dry-run，只能在停止写入的维护窗口运行；grace不是多进程事务锁。当前项目队列与JSON原子rename仍以单控制面实例为部署前提。

原生包复杂对象保持opaque，未知对象不能任意AI重排。managed registry是可运行的离线骨架，未部署公司模板、S3或生产网关。真实LLM、远端Docker、跨设备、多租户内存、Windows及Microsoft PowerPoint实际打开属于未验证项。25组PPT自检、PPT UI/CDP、33项smoke通过；全应用E2E有19项Chat/Search失败，详情见日志。最终样例是`passed_with_warnings`，必须连同警告交付，不能标成“内容无遗漏/全环境通过”。
