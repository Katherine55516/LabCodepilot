# PPT performance benchmark

2026-10-03 · Node v22.22.0 · macOS host · [审计](ppt_next_round_audit.md) · [实现与迁移](ppt_changes.md)

## Methodology / 不可混淆的口径

- 实际调用 `handlePpt`、页数估算、来源解析、规划、Run/DAG、质量门禁和 Python 原生 PPTX 导出。仅 LLM JSON 响应由确定性模拟器给出；不加假延时，不伪造完成状态，不跳过导出。Cowork 文件通道在本机以模块同一 Python 脚本替代，未测生产网络、容器冷启动和真实模型延迟。
- Before 为本轮修改前冻结的源码（HEAD f33b3c8 加上一轮 5 个相关未提交修复）；冻结差异见 `before/working-tree.patch.gz`。六页及十页 Before/After 使用完全相同 fixture 与模拟响应；22 页 After 为验证完整性还修改了模拟 writer 的 sourceArtifacts 引用，不能把全部差值归因于单一代码修改。相同旧响应的中间 storage/migration 隔离运行约32.256秒（单次、带profile），仅作归因佐证。
- 七入口每版本42次：每入口 cold×3、warm×3。cold 是新账号/状态，warm 是同账号/进程复用；内置模板无二进制解析，因此 warm 不是“上传模板解析缓存命中”。两者 OS 文件缓存都可能温热，不是清空磁盘缓存的实验。
- Fast Path 指10页简单生成工作负载，Deep指22页长来源/原生模板工作负载，不引入新用户步骤，不等同于标准/详细策略。Fast共18次/版本。22页每版本3次 fresh process/state，没有测3cold+3warm；原始12MB模板仅1次验收，不能给它报告分位数。
- E2E 从创建请求到真实PPTX完成（不含人类停留）；Generation 从确认生成到完成；TTFP 从确认生成到首张preview DAG完成。trace editor_ready 是服务端可交付时间，不能代替浏览器paint。更新场景计时从更新请求起，不把基稿创建混入；已重跑覆盖旧记录。
- 下表为 min / median / max，单位秒；改善百分比=(Before median−After median)/Before median。每组N=3，不报告p90/p95；小负改善属于待扩大样本的噪声，不能隐藏。
- 基准顺序执行且不与测试并发。另一次并发自检导致22页约70.5秒，保留为 `after/factor-timing-contended-excluded.json`，因环境争用不纳入。原始结果及13里程碑在 `outputs/ppt-next-round/`。

## Fixtures

| 工作负载 | 输入 / 模板 | 页数 |
|---|---|---|
| Short Prompt | 简短运营复盘要求 / 内置blue | 6；另测10 |
| Medium Rich Prompt | 约3.3k字符运营分析 / 内置blue | 6；另测10 |
| Paste | 557字符结构化正文 / 内置blue | 6；另测10 |
| Markdown Import | 同557字符Markdown文件 / 内置blue | 6 |
| PPTX Import | 脚本创建可编辑文本PPTX，走内容导入生成 / 内置blue | 6 |
| Template-first | 从内置blue模板创建同一prompt | 6 |
| Version Update | 已完成基稿+进展要求 / 内置blue | 6 |
| Factor Zoo对照 | 原文41416字符，normalize后41415；同一4,191,988-byte模板fixture | 估算22 |
| 原始模板验收 | 同原文；用户12,342,631-byte PPTX，无重采样 | 估算22 |

原始模板在Before超过8MiB旧限制，无法公平直接比较。因此速度A/B沿用上一轮4MB模板；另跑原始模板证明新链路真实可用。没有用压缩模板掩盖新入口限制。

## Before / After：七入口六页

| 场景 / 缓存 | Before E2E min/med/max | After E2E min/med/max | 中位节省秒 / % | TTFP Before→After | 完整Generation Before→After |
|---|---|---|---|---|---|
| Short Prompt / cold | 2.413 / 2.440 / 2.443 | 1.281 / 1.295 / 2.269 | 1.144 / 46.9% | 0.462→0.211 | 2.292→1.238 |
| Short Prompt / warm | 2.363 / 2.379 / 2.390 | 1.263 / 1.762 / 2.170 | 0.617 / 25.9% | 0.473→0.229 | 2.254→1.699 |
| Medium Rich Prompt / cold | 1.603 / 2.091 / 2.458 | 2.144 / 2.157 / 2.209 | -0.066 / -3.1% | 0.491→0.474 | 1.981→2.042 |
| Medium Rich Prompt / warm | 2.499 / 2.655 / 2.694 | 2.170 / 2.242 / 2.309 | 0.413 / 15.5% | 0.536→0.464 | 2.517→2.121 |
| Paste / cold | 2.273 / 2.500 / 2.581 | 2.206 / 2.212 / 2.224 | 0.289 / 11.6% | 0.492→0.470 | 2.373→2.087 |
| Paste / warm | 2.335 / 2.413 / 2.445 | 2.127 / 2.170 / 2.206 | 0.243 / 10.1% | 0.462→0.467 | 2.287→2.045 |
| Markdown Import / cold | 2.537 / 2.551 / 2.584 | 2.314 / 2.344 / 2.425 | 0.207 / 8.1% | 0.478→0.480 | 2.339→2.133 |
| Markdown Import / warm | 2.373 / 2.539 / 2.552 | 2.147 / 2.315 / 2.333 | 0.225 / 8.9% | 0.459→0.462 | 2.321→2.101 |
| PPTX Import / cold | 2.540 / 2.635 / 2.712 | 2.455 / 2.458 / 2.497 | 0.176 / 6.7% | 0.462→0.457 | 2.290→2.127 |
| PPTX Import / warm | 2.641 / 2.659 / 2.667 | 2.399 / 2.420 / 2.422 | 0.239 / 9.0% | 0.474→0.464 | 2.315→2.072 |
| Template-first / cold | 2.333 / 2.384 / 2.452 | 2.035 / 2.125 / 2.163 | 0.260 / 10.9% | 0.469→0.438 | 2.257→2.010 |
| Template-first / warm | 2.273 / 2.387 / 2.457 | 2.037 / 2.164 / 2.180 | 0.222 / 9.3% | 0.460→0.448 | 2.270→2.046 |
| Version Update / cold | 2.532 / 2.550 / 2.635 | 2.314 / 2.352 / 2.396 | 0.199 / 7.8% | 0.537→0.520 | 2.429→2.231 |
| Version Update / warm | 2.386 / 2.512 / 2.637 | 2.247 / 2.253 / 2.337 | 0.259 / 10.3% | 0.492→0.495 | 2.401→2.136 |

## Fast Path：十页

| 场景 / 缓存 | Before min/med/max | After min/med/max | 中位节省秒 / % | TTFP Before→After |
|---|---|---|---|---|
| Short Prompt / cold | 3.152 / 3.755 / 3.883 | 3.245 / 3.278 / 3.602 | 0.477 / 12.7% | 0.699→0.679 |
| Short Prompt / warm | 3.641 / 3.706 / 3.805 | 2.067 / 3.187 / 3.208 | 0.520 / 14.0% | 0.717→0.683 |
| Medium Rich Prompt / cold | 3.714 / 3.727 / 3.731 | 2.088 / 2.248 / 3.580 | 1.479 / 39.7% | 0.729→0.376 |
| Medium Rich Prompt / warm | 3.726 / 3.747 / 3.778 | 3.256 / 3.619 / 3.625 | 0.128 / 3.4% | 0.713→0.770 |
| Paste / cold | 3.746 / 3.770 / 3.795 | 3.329 / 3.350 / 3.376 | 0.420 / 11.1% | 0.713→0.704 |
| Paste / warm | 3.672 / 3.708 / 3.746 | 3.286 / 3.334 / 3.355 | 0.373 / 10.1% | 0.701→0.710 |

十页全部18次的合并中位数 3.739→3.307秒，减少 0.431秒（11.5%）。它不是单一场景的延迟分布。

## Deep workload：22页长来源

| 版本 | N | min / median / max 秒 |
|---|---|---|
| Before | 3 | 109.096 / 109.912 / 111.827 |
| After | 3 | 32.939 / 33.347 / 34.187 |

中位减少 **76.564秒（69.7%）**。原始12MB模板单次 **53.819秒**；这是模拟模型的本机完整运行时间，不能推断真实用户一定在60秒内完成。Before22页缺少首屏trace，不提供虚构的TTFP改善；其他入口TTFP可在上表比较。

### After阶段分解（相对输入接受，3次）

| Milestone | min / median / max 秒 |
|---|---|
| `t_input_accepted` | 0.000 / 0.000 / 0.000 |
| `t_template_ready` | 0.000 / 0.000 / 0.000 |
| `t_file_parse_done` | 0.088 / 0.091 / 0.105 |
| `t_semantic_parse_done` | 0.088 / 0.091 / 0.105 |
| `t_outline_ready` | 0.504 / 0.512 / 0.594 |
| `t_story_plan_done` | 0.504 / 0.512 / 0.594 |
| `t_generation_started` | 0.689 / 0.729 / 0.782 |
| `t_first_slide_ready` | 5.281 / 5.564 / 5.594 |
| `t_half_deck_ready` | 13.838 / 14.328 / 14.627 |
| `t_all_slide_content_ready` | 23.350 / 24.081 / 24.554 |
| `t_all_slide_rendered` | 23.997 / 24.704 / 25.297 |
| `t_export_ready` | 29.664 / 30.487 / 31.489 |
| `t_editor_ready` | 29.664 / 30.487 / 31.489 |

这些是累计里程碑，不应相加；content页任务存在重叠。wall计时包括离线上传预处理，trace输入起点在登记模板后，故22页wall大于末里程碑。状态广播聚合节点可能只有end而无start，`duration:null`表示不可算，不是0秒；页content/review/publish节点记录实际开始结束。

## Critical path / Root cause / Fix

1. Before CPU profile 的热点是 zlib、JSON复制/序列化和 migration。项目快照反复携带图片base64，get/mutate/save在逐页DAG多次触发整对象膨胀与压缩。改为每账号SHA媒体文件+轻量引用、v3已迁移对象快速返回；仍在mutation边界验证，未缓存可变项目实例。
2. 模板重复分析/导入原生PPTX阻塞关键路径。上传或operator预登记完成安全校验、analyze和IR import，运行时按account/hash/parser版本复用IR；原始二进制只复制到当前workspace供保真导出。命中测试验证runtime import次数为0；未宣称离线analyze和IR import只解压一次。
3. 上传base64增加33%左右传输体积和JSON临时内存。新UI→Next→Cowork走有界二进制；保留旧base64客户端兼容。有界内存buffer还存在，不是对象存储直传。
4. Preview共用IR/Render Tree，12条LRU与pending合并；managed模板直接复用登记cover。最终PPTX仍真实导出并重新验证。
5. 模型只选择source unit ID/行区间，代码重建原表/流程；省去模型重写每个表格单元格的不确定性。没有改变用户模型、降低页数、关闭来源/模板门禁或省略实际任务。

## Gamma：公平比较与架构差别

Gamma官方公开指南将简单演示生成描述为30–60秒：[官方指南](https://gamma.app/cs/explore/content/guides/gamma-ai-instant-presentations)。这是公开体验口径，不是本任务现场计时或服务SLA。官方Agent说明复杂规划/研究可能比Classic慢：[Agent帮助](https://help.gamma.app/pt-BR/articles/15002203-como-eu-crio-com-agent-no-gamma)。官方导入帮助列出PPT/Word 200MB、PDF 100MB：[导入帮助](https://help.gamma.app/es/articles/11047840-como-puedo-importar-diapositivas-o-contenido-en-gamma)。页面语言不同不代表各套餐/所有路径限制完全相同。

| 维度 | 可证据支持 | 不能推断 |
|---|---|---|
| Gamma生成体验 | 卡片渐进可见、主题选择、局部AI编辑；参考成品10页 | 私有队列/模型路由/并行度/硬件与本机完全相同 |
| AIMate执行架构 | 持久Run/DAG、stable IDs、结构化IR、原生PPTX模板保真、发布QA与可恢复变更 | 模拟模型3秒意味着真实模型优于Gamma |
| 内容组织 | Gamma将定义/比较放同卡；AIMate22页更多细分页；新增typed关系/表格/流程 | 页少就是完整，字多就是深入，词面命中就是事实正确 |
| 时延口径 | 本机十页E2E约3.3秒；22页优化模板约33.3秒；原模板单次53.8秒 | 包含真实LLM、联网研究、容器冷启动、浏览器加载或生产p95 |

### Remaining gap

仍需真实选择模型+部署Cowork的cold/warm各≥3次、独立网络/容器/模型/first paint埋点、同任务Gamma实测，以及多用户负载后才能验收30–60秒产品目标。当前重要收益已由相同fixture和实际导出证实；模型延迟、远程存储、复杂媒体/长公式和Windows字体仍未测。不存在已证明的Gamma私有架构结论。

## Reproduce

```sh
node scripts/ppt/benchmark-workflows.mjs outputs/ppt-next-round/after/workflows.json
PPT_BENCH_PAGES=10 PPT_SCENARIOS='Short Prompt|Medium Rich Prompt|Paste' node scripts/ppt/benchmark-workflows.mjs outputs/ppt-next-round/after/fast10.json
PPT_MODULE_ROOT=/path/to/frozen/apps/cowork-server node scripts/ppt/benchmark-workflows.mjs /tmp/before.json
PPT_TEMPLATE_PATH=/path/to/original.pptx node outputs/run-factor-zoo-next-round.mjs
node scripts/ppt/benchmark-content.mjs /path/to/source.md /path/to/output.pptx /path/to/gamma.pptx /tmp/content.json
```

设置 `PPT_TEST_PYTHON` 指向带python-pptx/Pillow的解释器；22页harness同样使用该变量，并支持PPT_OUTPUT_PATH/PPT_REPORT_PATH。不要并行跑性能样本与测试。模拟fixture不等于生产模型质量评测。聚合明细见 `outputs/ppt-next-round/benchmark-summary.json`。
