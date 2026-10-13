# Factor Zoo 真实模型 ARM64 PPT 验收

创建/更新：2026-10-09。

## 状态

| Phase | 内容 | 状态 |
|---|---|---|
| 0 | 私有 Actions 仓库、原文 prompt、PPTX 模板与浏览器证据 | 已完成 |
| 1 | 真实请求诊断：输出截断；预算修正与全量回归 | 已完成 |
| 2 | 大纲表格范围合同与实际模板容量修复反馈 | 进行中 |
| 3 | 真实模型重跑、逐页视觉检查、报告及最终 PPTX | 待通过原门禁 |

## 决策日志

- 用户授权私有仓库与 Actions Secret，指定 deepseek-v4-flash。
- 原模型 16384-token 上限不足；非推理模式仍截断。worker 改为 32768，保留超时/截断失败行为。
- Run 37940354660：两次完整模型返回，30 页候选仍有 9 个容量溢出和 5 个表格末行遗漏。大纲阶段缺少 writer 已有的半开区间说明。
- 用户明确授权修复大纲提示词并重跑；保留自动页数、所有质量门禁和原模板原生导出。

## 设计与验收

只补充实际合同与测量诊断：库存给出表格 [1, rows.length) 范围，大纲说明 rowEnd 不包含；修复反馈包含原生内容矩形、字体、溢出测量、所有权与缺失行。禁止手工大纲、正文、指定页数或门禁绕过。测试验证最后一行确实缺失时被拦截，并检查反馈可指导真实修复。CI 应用记录哈希的源码补丁。最终完成必须包含通过原导出门禁的 PPTX、实际幻灯片渲染审阅和过程报告。主机 IO 适配不代表账号登录/Docker E2E 验收。

- Run 37942888517：表格末行全部保留，候选 39 页；仍有 7 个容量溢出，修复候选未改变这些分配。补充各组件英寸高度与实际可容纳的连续表格分片建议，修复任务置于长来源上下文前后；只提供模型选择依据，不自动改大纲，仍走原拟合/范围门禁。31 项容量审计和全量回归通过。

- Run 37946083653：初稿 34 页，修复 38 页，修复重复来源归属并分片 2 张表；仍有 5 个容量问题。明确单个组件无法放下时必须真实分片，不能只缩短 keyPoints；全部双语内容保留，用户/来源没有同页要求时允许连续页面，避免模型自行添加不可能的邻接约束。回归保持通过。

- Run 37948767757：初稿 30 页 6 个溢出；整稿修订 37 页反而 11 个溢出，被原选择规则拒绝。完整长上下文修订不能可靠完成物理分片。新增最多三轮局部容量分配：模型只选择原来源、表格行及原 keyPoint 索引，代码保留原文字并拒绝行遗漏/重复、越界来源、事实承诺索引遗漏；每批重新绑定模板并保留全部门禁。按所有原生正文版式测量分片建议，避免新增页重排后失效。

- Run 37952989696：初稿 37 页 / 修订 48 页，均 9 个容量溢出和 b_0222、b_0223 两个重复主讲来源；修订未采用。局部容量分配要求只有溢出，因此未执行。扩展到连通的重复主讲范围；同一失败表格的重叠主讲范围合并修复，保留每个不同来源行一次，原内容承诺仍全量索引保留。新增 API 回归证明只有归属重复、没有溢出时也进入有界修复，并验证不混合不重叠分片。36 项容量审计通过。

- Run 37955377619：原稿 37 页 / 7 个容量问题；整稿修订 JSON 无效。实际执行局部 3 轮（7→6→4 个范围），但模型重复或遗漏原索引/表格行，仍被门禁阻止。加入每个局部请求一次合同纠错，反馈精确 missing/duplicates/expected、各原生版式拟合；不把初稿模型发明的双语同页关系当用户约束。真实小范围诊断达到 61 页、余 2 个容量问题。
- 容量回退是代码保守分片：仅使用原完整组件与原 keyPoints，按所有实际原生正文版式测量组合，完整表格行/列和全部原内容不变，不能拆坏不可分割来源对象。最多 3 次原生重新分配，最多 100 页；禁止在较宽的临时版式重新合并这些分片。原门禁仍决定是否可确认/发布。本地真实候选回放：61→65→66，0 个容量/来源问题；仅诊断，不算 PPTX 生成验收。38 项容量审计通过。

容量 API 最后回归还验证模型连续丢弃原内容/表格行时，在固定模型请求上限后采用完整测量分片，再次检验全行与原内容保留；39 项容量审计通过。

- Run 37960627241 已启动；私有执行提交 9304053，包含合同纠错与完整组件实测分片。提交前全量 2820 项（2819 通过、1 跳过）、39 项容量审计及提示合同通过。最终 PPTX 仍待真实生成与逐页视觉验收。

- Run 37960627241：两次完整响应；采用 31 页候选，8 个溢出与遗漏中文 SummaryBlock b_0223；局部修复被遗漏门禁阻止。模块增加完整必保留来源补全（表格仅补缺行），使用原章节标题，不编写新正文；随后仍重新测量、分片与执行原门禁。该真实候选诊断回放 32→51 页、零容量/来源问题，诊断不算导出。40 项容量审计通过。

- Run 37962165601 已启动，执行提交 5a892c1；提交前 2820 项全量测试（2819 通过、1 跳过）、40 项容量审计与提示合同通过。

- Run 37962165601 在模型调用前取消：npm ci 已完成，字体已下载，LibreOffice 下载停滞超过 10 分钟。完整安装日志保存；非模块生成失败。CI 将安装分成独立步骤，每项 5 分钟超时。Run 37963786437 已启动，执行提交 f5bef80，生产模块补丁不变，报告校正未验证页数的标记。

- Run 37963786437 passed the original outline gate and froze 52 pages, but writer contract errors and 34 HTTP 429 responses prevented completion. The next recorded source patch gives exact per-page source selections, typed visible native/source copy, measured commentary capacity, frozen page-job precedence, and template title diagnostics. The prompt view losslessly deduplicates an identical material.prompt/sourceText pair; immutable source, hashes and all facts remain complete. CI spaces real model starts by 8 seconds and applies a 60-second cooldown after 429; SDK automatic retries remain disabled. Original content, review and export gates remain authoritative.

- Run 37968706171 已启动，私有执行提交 4a14921；提交前全量 2820 项（2819 通过、1 跳过）、43 项容量审计和提示合同通过。根仓库无提交/推送。

Run 37968706171 froze 51 pages, completed 39 content nodes and failed 12. All 119 model calls completed; no HTTP 429 occurred. Nine cached completed pages still have hard native title/slot errors. The next run restores the genuine compressed production checkpoint and verified content-addressed media, validates identical full prompt/template/model, relocates only the original template file for host IO, and calls the original POST /retry route. The module reopens only cached pages with current hard native errors; valid/accepted content remains intact. Writer corrections now expose exact selected source rows, type/count/physical-height errors and native title capacity. Both initial JSON contract correction and local copy correction are bounded; invalid or worse rewrites are rejected, final hard copy issues cannot be marked completed, and all original whole-deck/quality/export gates still apply. No deck text, page count or successful status is supplied by the harness. Local full suite: 2819 passed/1 skipped; 47 density/contract/recovery audit checks passed.

- Run 37973960910 在依赖安装期间取消，未调用模型；Run 37974873374 已启动（私有执行提交 3e8b242），恢复原 Run/DAG 和事件记录，通过原 POST /retry 继续。独立恢复诊断证明原 input 字节、模板、source framework 和 Run ID 一致；21 个节点重试、30 页有效内容保持不变。该诊断使用主动失败的模型替身，不算真实生成验收。最新全量 2819 pass / 1 skip / 0 fail，47 项容量/合同审计通过。

- Run 37974873374 失败：51 页冻结，39 页 done / 12 页 failed，71 次真实模型调用完成。generation.error 只保留前 400 字，不能据此统计失败页；完整 Run 节点记录为准。新增逐页实测解释字符预算、section 导航独立修复、保留全部原正文的 sourceCommentary 重排提示、锁定来源例子可见提示、LaTeX/display 共用规范化，以及标题型封面额外正文遮挡检查。只对长局部修复请求使用完整检索对象/锁定证据视图，原输入与 source framework hash 不变；所有门禁仍执行。49 项审计通过，下一轮仍需真实生成/导出与全部幻灯片目视检查。

- Run 37980104821 已启动，私有执行提交 45f5785。源码补丁已验证可应用到固定 08727bea，并逐文件与本机测试代码完全相同。全量 2820 / 2819 pass / 1 skip / 0 fail；50 项审计与 prompt/evidence 专项通过。真实小范围诊断：封面、导航、CAPM 与 q 模型硬性错误为零（保留软性深度提示），只证明单页合同，不证明整稿或导出。绑定来源 ID 由模块原样编译到可见节点，不用模型翻译替代锁定原句；实际字体、容量、来源、critic、导出门禁全部保留。原始 51 页大纲不变，恢复验证为 38 页不变、13 页重试。

- 第 16 轮实时观测限制：运行中只能读取 GitHub 步骤级状态。认证 gh 拒绝读取仍在执行的 Job 日志，job-log API 返回 404；内置浏览器未登录私有仓库。报告明确披露该限制，不用粗粒度状态推断逐页进度。最终仍待真实产物、原门禁与逐页视觉验收。

- Run 37980104821 完整记录：51/51 内容节点 done，29 次真实调用；整稿审查 79 条义务中 40 处引用不合法（9 处错误节点、31 处非逐字摘录）。19:34 已被原门禁阻止，observer 无导航/退出上限导致 CI 清理停滞；20:45 取消后全部 artifacts 上传成功。录像原始只有239.8秒，不覆盖整轮，未裁剪转换。新增表/图精确可见 text、最多两次模型审查合同纠错，校验规则与语义修复轮数保持不变；不自动修正摘录或判通过。运行器导航/截图/清理有界，保存模块结果后退出。
- Run 37990935148 已启动，执行提交 9e200ce，恢复真实 51 页断点，原 retry 路由，无内容节点重开。全量2819 pass / 1 skip，50容量审计及提示/evidence/硬规则、observer超时回归通过，18文件补丁与固定源码精确匹配；恢复诊断确认全部51页内容与framework/RunID不变。仍待真实整稿审查、导出和全部最终幻灯片目视验收。

- Run 37990935148 在 Runner 启动前失败，无步骤、无模型调用。GitHub annotations 明确称近期付款失败或消费上限需要提高（另有 ARM64 排队容量提示）；不归类为模块失败。实际本机硬件为 Intel i9 / x64，不能称本机ARM64。用户可处理账户后再验证ARM64；先准备同087固定源码和9e200ce补丁的隔离x64运行，保留架构差异与云端阻塞。托管worktree工具作用于外层仓库，无法解析该嵌套仓库ref，故用本任务持有的CLI临时worktree，完成后保留产物并清理。
