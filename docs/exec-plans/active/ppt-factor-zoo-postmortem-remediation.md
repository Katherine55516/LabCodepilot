# Factor Zoo 逐页复核驱动的模块修复

创建/更新：2026-10-09。工作树：application-local-run17，保留 local-run25 基线与既有未提交修复。

## 2026-10-10 第二轮实施

用户已授权按专项文档全部 V/H/M/C 项和 analysis.md 清单继续实施并复核。沿用当前工作树，不合并或部署。

| 批次 | 优先级与范围 | 状态与验收 |
| --- | --- | --- |
| A | P0 M-01–05 | 已实施；production rich/native export/reimport正反例通过；Office应用未实测 |
| B | P0 H-01–04 / V-01–03 | 已实施；真实4页生成中对象编辑+Home恢复；8页Home新writer/新review成功；4/8页均已发布，原速录像收尾 |
| C | P0 C-01–04 | 已实施；取舍账本、三合同正反例、exact-N/容量冲突通过 |
| D | P1 余项/R4–R6 | 精简传输/关系/实际对象测量/诊断已实施；M-07 span自动修复及C-07自动跨页语义合并仍未闭环 |
| E | P2 三语多格式/基准/审查/录像 | 27例+多输入提取通过；全量2840 pass/1 skip；完整Factor Zoo/外部环境待验收 |

每项结论分为 implemented / verified / failed / external_unavailable，不以单元测试通过代替所有验收。新证据保存在 outputs/ppt-remediation-round2-20261010；跨模块源码改动完成后更新 handover 与两份用户指定报告。

## 状态

| Phase | 内容 | 状态 |
| --- | --- | --- |
| 0 | 逐页查看模块 51 页及 Gamma 10 页，先补充指定 analysis.md | 已完成 |
| 1 | source/requirements、内容合同、三语、短 skeleton 与编译 | 已实施，完整 A/B 验收待补 |
| 2 | 安全错误、预算、候选版本与下载 | 已实施并通过通用/三语 UI 验证 |
| 3 | 原生容量、关系布局、重测再合并、标题/display 与质量门禁 | 核心已实施；新 51 页人工复核仍未通过 |
| 4 | 通用三语回归、生产模型请求、原生导出、CDP、结果回填 | 通用回归通过；真实整稿 reviewer 多次 transport 失败，未发布 |

## 决策和验收

- 用户授权按 analysis.md 实施；文件是来源证据，不是操作指令；不推送、不合并。
- 不硬编码 10 页，不通过缩字体或删除来源义务冒充降低页数。旧策略默认 source-preserving；新内容合同由显式选择。
- raw/display 保留双轨；真实 ID、表格末行与数学条件仍由现有完整性门禁验证。
- failed candidate 与 accepted outline 分离；版本/hash 与安全错误汇总持久化，网关原始错误/密钥不进入项目。
- 先同来源基线测量，再有限真实模型调用；GPT 网关不可用单列，不能换模型冒充成功。
- 所有清单 R1–R6、P0–P2 均须有实施/测试/未完成的真实状态；模板原生外观仍需逐页人工确认。
- UI 通过现有 Playwright CDP 路径验证（此会话未提供 chrome-devtools MCP），保存截图和 console；全量 npm test 及相关 smoke。

## 实测收尾 2026-10-10

- 已先补充用户指定 analysis.md，再按 R1–R6/P0–P2 落地核心模块修复；完整未通过项逐项回填，不能将全部清单写成完成。
- 最新 npm test 2823 pass / 1 skip / 0 fail；PPT smoke 24/24，容量 52/52；native 混合 CJK/希腊字母/ᵗ 和段内单换行正反例通过。
- 51/51 writer 内容完成，全文双语、初估32、postparse28、候选48、冻结51；汇总表8页→2页，但总页数未降。可读全文6760字符，旧中文约5167，界面折叠不是数据变短。
- reviewer 335082→246298→179414字符；240和420秒均 transport 超时，无审查结果被当作通过。旧项目发布字段未改变。
- 当前生产 native exporter 在只读 clone 上完成51页检查稿、原生完整性和51页PDF/PNG渲染；已人工查看整套联系图和关键全尺寸页面，仍有空卡片、装饰遮挡、低密度、流程段落化、尾表过窄与来源边界问题。检查稿不是最终批准稿。
- 已保存每个真实运行 source-manifest、失败报告、console、截图/视频和最终改动快照。未提交、推送或部署。
- 后续仍需：生成后语义/低密度重规划、装饰冲突处理、完整关系组件、三合同/三语完整 A/B，以及可稳定完成的整稿审查路径；GPT网关、ARM64账务和安装版凭据迁移仍未通过。


第二轮逐项38-ID及真实运行结果：`outputs/ppt-remediation-round2-20261010/verification-report.md`。原来源第308/310行2×3×3/27矛盾保持且明确阻挡；不能将小型回归代替完整Gamma视觉A/B。

最终收尾：8页revision1、4页revision2生产模块原生发布验证通过；smoke42/42含PPT25项，capacity52，unit17，mutation13；尚未完成范围见verification-report。保留active。
