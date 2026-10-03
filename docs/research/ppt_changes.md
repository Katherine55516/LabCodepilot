# PPT changes, rollout and regression

2026-10-03 · [审计与问题登记](ppt_next_round_audit.md) · [性能基准](ppt_performance_benchmark.md)

## Scope and behavior

本轮按用户指定附件审计并修改生产 PPT 模块，没有重做 prototype、改变创建步骤、替换用户所选 LLM 或取消显式发布/局部编辑。Prompt / Paste / Import / Template-first / Version Update 沿用同一 API→Run/DAG→IR→Render Tree→QA→发布链路。模拟模型仅在验证 harness；生产 `modelCall` 不注入模拟响应。

本轮确认的 PPT P0 问题已修复且专项回归通过。**全应用 E2E 并非全绿**：52 passed、112 skipped、19 failed（Chat/Search）。这些组件不在本轮变更中，未做独立 Before 控制实验，不能断言均为原有故障。故附件“Regression 全通过”的全仓字面条件尚未满足；本轮不扩大为聊天模块重写，也不把失败隐藏为通过。

## Changed files and reasons

| 文件（相对仓库） | 修改 / 根因 / 影响 |
|---|---|
| `apps/cowork-server/lib/ppt-store.mjs` | snapshot v2 图片以账号内SHA引用，32MiB不可变媒体缓存，JSON原子写；兼容raw/v1；清理项目revision目录；模板IR/cover存储；离线安全GC。解决反复base64/gzip/JSON放大和孤立历史数据。 |
| `lib/ppt/migrations.mjs`（下列lib均位于cowork-server） | 已规范v3对象快速返回；不在每个read重复深拷贝，mutation边界仍校验。 |
| `lib/ppt-template-security.mjs`（新增） | 同源配置与Python ZIP/XML/图片安全校验；bytes/展开大小/条目/比例/页数/对象/像素/timeout/memory上限及明确错误。 |
| `lib/ppt-template.mjs` | 用配置替代8MiB硬编码；有界parser结果与timeout；managed目录读取；快照保留bytes/hash/kind，避免undefined污染规范JSON。 |
| `scripts/register-ppt-template.mjs`（cowork-server，新增） | operator离线登记，hash去重，安全分析+IR导入+共享SVG cover；不暴露HTTP登记权限；失败回收临时容器。 |
| `lib/ppt-api.mjs` | 原始二进制模板上传；兼容旧base64；账号内hash去重先于数量上限；预导入IR，managed模板目录只读/pin个人化；POTX保真；sourceArtifacts绑定；版本更新run/trace；阻止HTTP账号碰撞managed保留命名空间。 |
| `lib/ppt-template-fidelity.mjs` | runtime命中IR只复制原二进制；修复file writer需要Readable而非Buffer且必须使用返回的真实sandbox绝对路径；百分比不充当标题；保护宽PNG callout背景；typed对象替换后保留标题/省略授权校验。 |
| `lib/ppt/template-preview-service.mjs` | IR缓存、12条LRU、pending合并与managed cover；不重复导入。 |
| `lib/ppt-trace.mjs`（新增）、`lib/ppt/run-service.mjs` | trace ID与13里程碑、逐节点状态/起止/耗时/错误；metadata only，正文不进入生产trace。 |
| `lib/ppt-content-inventory.mjs`（新增） | 类型化source units、优先级、refs、关系；Coverage Map v2、尾部偏差与实际可见结构检查；topic groups记录planner/derived来源，不把默认分配冒充模型决策。 |
| `lib/ppt-semantic.mjs` | 来源表格原子保留、跨块公式围栏，不在600字符切片丢行；semantic版本3。 |
| `lib/ppt-planning.mjs`、`lib/ppt-prompt-contracts.mjs` | planning版本6；整篇inventory、关系与页级typed refs；writer选择sourceUnitId/rowStart/rowEnd，代码提供原始单元格；解释merge/split与容量，禁止只按heading一页一章。 |
| `lib/ppt-source-artifacts.mjs`（新增） | 服务端验证页级授权ID、最多2结构、合法行区间，重建可编辑表格/双语流程/清单/摘要；按字符宽度分配行列，容量不足显式要求split，不截断或缩字过关。 |
| `lib/ppt-source-text.mjs`（新增） | 共享Markdown/常见数学记号显示适配，原始文本不改；不支持的TeX保留，未实现OMML。 |
| `lib/ppt/render-tree.mjs`、`lib/ppt-render.mjs`、`lib/ppt/import-pptx.mjs` | 内置与原生模板都支持typed对象；native table保留全部cells、source shape names、行列权重、CJK字体；严格校验原shape−授权omissions+新增objects；图片/原生字体保真检查。 |
| `lib/ppt/exporters/preview.mjs` | HTML table的CSS px与EMU统一（9525比例）、加权行列/换行，修复预览字小及结构尺寸不一致。 |
| `lib/ppt-evidence.mjs`、`lib/ppt-content-qa.mjs`、`lib/ppt-quality.mjs` | 证据从真正可见对象取值；防chunk/segment ID误命中，常见Unicode/TeX等价；来源表格/关系/尾部、underfill/fragmentation诊断；完整紧凑流程不误判空白，原有hard gates保留。 |
| `src/components/ppt/PptM3.tsx` | 上传File直接发binary，不再在浏览器转base64。 |
| `src/app/api/ppt/[...segments]/route.ts` | 有界Uint8Array读取、保留Content-Type，超限413，避免UTF8破坏PPTX字节。 |
| `src/__tests__/e2e/ppt-workspace.spec.ts` | 实测新binary上传URL/bytes，保留既有UI流程断言。 |
| 三个新增 `selftest-ppt-{content-inventory,template-security,template-registry}.mjs` | 跨领域结构、真实builtin导出cells/font、安全恶意包/边界/timeout、managed全链路/cache/account隔离/Readable真实路径。 |
| `selftest-ppt-{evidence-quality,long-storage,semantic}.mjs` | 原有门禁、callout保护、快照v2/v1兼容、mutable隔离/GC、规划版本回归。 |
| `scripts/ppt/{benchmark-workflows,benchmark-content}.mjs` | 实际DAG/导出多场景时延和可见内容诊断；Gamma只作参考、源文才是真值。 |
| `scripts/ppt/verify-cdp.mts` | 开发态真实CDP连接、桌面与手机滚动/按钮、模板→输入→syllabus→生成聊天、table几何与console检查。 |
| `outputs/run-factor-zoo-next-round.mjs`及fixture plan | 可复现22页模拟模型输出，调用模块真实workflow与renderer；不在生产加入Factor Zoo专用逻辑。 |
| `docs/research/ppt_*.md`、文档索引、handover、exec-plan、ARCHITECTURE | 架构、问题、性能、部署/迁移/限制和本轮证据互链。 |

## New configs and limits

服务端的合法配置值必须为正整数，超出硬上界直接报错，不能设成无限。单位bytes采用MiB=1024²。

| 环境变量 | 默认 | 允许上界 |
|---|---:|---:|
| `PPT_TEMPLATE_USER_MAX_BYTES` | 16MiB | 64MiB |
| `PPT_TEMPLATE_MANAGED_MAX_BYTES` | 64MiB | 128MiB |
| `PPT_TEMPLATE_MAX_UNCOMPRESSED_BYTES` | 128MiB | 512MiB |
| `PPT_TEMPLATE_MAX_ZIP_ENTRIES` | 5000 | 20000 |
| `PPT_TEMPLATE_MAX_COMPRESSION_RATIO` | 200 | 1000 |
| `PPT_TEMPLATE_MAX_SLIDES` | 100 | 100 |
| `PPT_TEMPLATE_MAX_IMAGE_PIXELS` | 40000000 | 100000000 |
| `PPT_TEMPLATE_MAX_OBJECTS` | 10000 | 50000 |
| `PPT_TEMPLATE_PARSE_TIMEOUT` | 30000ms | 120000ms |
| `PPT_TEMPLATE_PARSE_MEMORY_BUDGET` | 512MiB | 2GiB |

`PPT_TEMPLATE_USER_MAX_BYTES` 需要在Next与Cowork两侧一致配置；反向代理另行配置相容的body限制。没有修改外部部署的Nginx/Caddy。旧JSON端点24MB body上限仍在，提升用户binary上限不自动提升旧base64客户端承载能力。内容导入文件8MiB规则不变，用户模板与来源文件是两个产品入口。

RLIMIT_AS在支持的平台执行；不支持的平台仍有ZIP/输出/时间等限制，但不能声称有同等内存隔离。必须配合容器自身memory/CPU限制。PDF模板沿用reference路径，未声称Office ZIP检测能够覆盖PDF脚本攻击面。

## Managed template rollout

```sh
# 在部署Cowork且可用其Docker/file services的operator环境执行
COWORK_STATE_DIR=/path/to/state node apps/cowork-server/scripts/register-ppt-template.mjs /path/to/company-template.pptx
```

模板登记在内部`managed`所有者下，按hash去重，保存原始binary、版本1 metadata、parser版本`pptx-ir-2`的IR与同renderer的SVG cover。所有用户可读取目录，收藏存各自账号；HTTP不能覆盖/删除该目录。公司不同版本用新内容hash登记新模板ID；当前没有管理后台、S3直传或分布式catalog复制。本地自检用可执行依赖注入跑同一分析/导入脚本，真实远程operator部署仍须验收。

解析器升级应改变parserVersion；旧IR未命中时安全重建；binary不可因cache失配而直接忽略。runtime命中时复用IR，但仍需把opaque原模板复制到当前沙箱以便原生PPTX导出，这个I/O没有消失。

## Migration and rollback

- 项目存储是文件schema，不改SQLite。raw JSON、旧media-v1快照仍可读；下次save写media-v2引用格式。原始输入、source text、stable node IDs、journal/revisions语义不变。
- 升级前备份完整`COWORK_STATE_DIR`，尤其项目文件、模板binary/IR、账号assets和历史revision；只备份JSON不再足够。
- v2媒体是账号内不可变SHA文件，读缓存仅缓存immutable string，不缓存可变项目；账号不共享媒体缓存key。丢失blob应报错，不能静默空图。
- 回滚旧代码不能保证读取v2；必须恢复升级前完整备份或先用新代码导出/迁回旧格式。本轮没有提供在线downgrade命令。
- `collectUnusedMedia(uid,{dryRun:true})` 默认只报告候选，24小时grace并扫描模板/当前快照/保留revision。**应先停止相关账号写入再实际执行GC**；grace不是跨进程锁。元数据损坏则fail closed。不会因删一个项目直接删共享blob。
- 多worker并发JSON写入/registry事务问题仍在债务列表；单进程的本轮优化不能宣称解决分布式一致性。

## Regression and artifact evidence

| 验证 | 最终结果 | 证据 |
|---|---|---|
| `npm run test` | typecheck通过；2808 passed / 1 skipped / 0 failed | `outputs/ppt-next-round/npm-test-final.log` |
| `for t in apps/cowork-server/selftest-ppt*.mjs; do node "$t"; done` | 25个脚本全部exit0 | `selftests-final.log` |
| `npm run test:smoke` | 33 passed | `smoke.log` |
| PPT UI专项 | 独立14 passed；完整E2E另含2条template-reuse，共16条PPT均通过 | `ui-latest.log`、`e2e-full.log` |
| 全应用E2E | 52 passed、112 skipped、19 failed，Chat/Search失败未解决 | `e2e-full.log` |
| CDP桌面/手机 | 实际开发页面、点击/输入/滚动和截图；console errors=0；原生table全部cell无溢出 | `ui/cdp.json`及5张截图 |
| 模板边界 | 小/4MB/近16MiB/近64MiB accepted；超限与恶意包拒绝；timeout受控 | `selftests-final.log` |
| 22页实际原始模板 | 估算22页；PPTX原生导出、0 hard errors、29 deterministic issues，status=`passed_with_warnings` | `after/original-template-workflow.json`及PPTX |
| 渲染核验 | 原始模板成品全部22页LibreOffice→PDF→PNG，抽查密集定义/年度表/末页清单、汇总contact sheet | `rendered-final/` |
| 语义/结构 | 源文5张表分成7个原生表格，单元格规范化匹配均100%；priority lexical recall54.84%→83.87% | `before/content.json`、`after/content.json` |

chrome-devtools MCP在本环境没有可用工具，因此用Playwright `connectOverCDP` 连接Chrome实施同类验证；没有声称调用了不存在的MCP。UI后端route使用fixture验证交互，生产后端另由API/selftests/真实模块导出验证；没有冒充完整远程GUI端到端。

LibreOffice内置fontconfig起初未发现系统CJK字体，QA配置补充macOS字体目录并将等线fallback到Heiti SC后重新渲染。最终PPTX保留字体声明，未把文字截图替换进文件；目标PowerPoint字体替换、Windows/安装包尚未验证。模板原图和Gamma标识沿用用户模板，不另作去水印修改。

## Content limits and interpretation

真实最终文件的可见字符10,295（22页，中位460），Before9,823（22页，中位433），Gamma9,409（10页，中位1019）；统一排除空白，不能直接对比历史包含空格的字数。word/character/paragraph计数只是密度诊断；`visibleContentUnits`不是经LLM验证的语义单元。lexical recall不是语义蕴含。Gamma未标记source unit的普通文本会导致结构追溯指标低估，不应据`structureRecall=0`说Gamma没有表格（其实际有3张）。

当前产物`editorialReady=true`来自既有门禁与模拟critic的空问题响应，**不是人工/真实模型认可**；status仍为passed_with_warnings，29个确定性问题保留在报告。没有实现完整公式OMML；部分公式细节未保留、原文双语并非逐句全部展示、页间概念碎片和尾部偏差仍存在。source表格/清单更完整，但完整度没有达到100%。白色typed内容区可覆盖部分模板装饰，未出现抽查的文字裁切，但视觉融合仍不及人工排版。

## Remaining validation

真实LLM同源A/B（包括非本样例内容）、远端Cowork冷启动/文件通道、Gamma同任务计时、生产并发p95、Windows/PowerPoint实机、大型复杂公式/未知图形仍待环境验收。全应用19条失败需独立Before基线定位。详见tech-debt-tracker与审计R38。无生产部署、推送、自动发版或真实模型质量完成声明。
