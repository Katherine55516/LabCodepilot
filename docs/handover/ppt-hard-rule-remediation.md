# PPT hard rules：实施与验收交接

更新：2026-10-08。依据 [审计及五项 P0 方案](../research/ppt-hard-rules-vs-gamma-current-audit-20261008.md)。本轮优先修复五项已复现漏洞；既有用户 workflow 不变。真实模型、Microsoft PowerPoint 和复杂遮挡验收仍未完成，不将其列为通过。

## 1. 实施结果与文件地图

| 优先项 | 实施位置 | 当前行为 |
|---|---|---|
| F1：原生发布删除硬错误 | `ppt/publish-service.mjs`、`ppt-api.mjs`、`ppt-export-integrity.mjs` | 删除 externalPptx 发布 whitelist。generic/native 均执行完整确定性与语义门禁；导出或证书失败进入 quality_blocked/repair，保留上一版 published pointer/revision |
| F3：locked 漏检、背景误报 | `ppt/render-collision.mjs`、`ppt/render-audit.mjs` | locked 可见节点照常检查。合法下层背景承载文字通过；上层不透明媒体遮住文字、实际占用行的文本重叠阻断。不能精确判断的复杂 artwork/connector 相交保留 warning，不声称视觉认证 |
| F2：文件存在即通过 | `ppt-export-integrity.mjs`、`ppt/export-verifier-python.mjs`、`ppt-render.mjs`、`ppt/import-pptx.mjs` | manifest v2 逐 Render Tree 实例绑定 nodeId/part、几何、样式、段落、图片裁切/字节、原生结构、表格/图表/数学；重开实际 PPTX 逐项比对，并转换实际候选 PDF 检查文字和页面边界 |
| F4：mandatory 截短、局部修改丢义务 | `ppt-obligations.mjs`、`ppt-planning.mjs`、`ppt-prompt-contracts.mjs`、`ppt-quality.mjs`、`ppt/input-scope-service.mjs`、`ppt/versioning.mjs` | 不再截为 160 字符或只留 10 项。完整条件/requiredDetails/mustInclude 建 registry，source span/hash 与审核绑定；missing/altered/not_evaluated 均阻断，不随 strictDepth 降级；局部候选与应用重新核查 |
| F5：prose 冒充媒体等价、reason 冒充批准 | `ppt-template-dispositions.mjs`、`ppt-object-integrity.mjs`、`ppt-template-fidelity.mjs`、`ppt-source-artifacts.mjs`、`ppt-density-capacity.mjs` | unknown/evidence/brand/关系媒体保留并预留空间；普通来源文字不再认证媒体等价。retained/replaced_verified/retired_by_adaptation/excluded_by_user/unresolved 分离；自动旧案例 retirement 绑定输入/模板/原资产哈希 |

上述路径以 `apps/cowork-server/lib/` 为根。新增正式反例测试在 `apps/cowork-server/selftest-ppt-hard-rules.mjs`；本轮产物在 [证据目录](../../outputs/ppt-hard-rule-remediation-20261008/README.md)。

## 2. 数据与控制合同

- Prompt contract / review rubric 升至 **8**，quality policy、export manifest/verifier、Render Contract、template disposition 升至 **2**；obligation registry 为 **1**。修改内容、来源、模板、义务后旧审查与导出证明失效。
- generated shape name 保存稳定 `AIMate instance:<renderId>:<part>`；原生实例使用 native shape ID。一个实际对象不能满足多个期望实例。metric 数值/说明和列表各 point 使用单独 part，避免正文合并通过。
- manifest 保存 revision、renderHash、manifestHash；accept 要求当前合同版本、三个绑定一致及文件 SHA。初次生成先固定最终 revision，再生成证书，避免 rev0 证明被用于 rev1 发布。
- critic 收到完整 input framework、完整义务及可见 node ID。每个义务恰好一次；satisfied 必须给当前可见实例与逐字存在的 excerpt，语义同义性仍由模型判断。planned detail 不成为新增事实来源。
- 局部 AI 增补/缩短/删除页、媒体说明修改均受 scope 与 mandatory 检查；候选绑定 registryHash 和内容哈希，应用时复查。重复 claim 不用于填密度；既有不同来源内容的 packing/容量流程保留。
- 导入原稿是 **imported_baseline**，不冒充新内容审查已通过。旧 native 合同不能认证新发布；历史文件/快照保留，新发布要求重新导入或重新生成 nativeRef v2。模板解析缓存统一为 `pptx-ir-4`，注册、上传、预览、store 读取同步。
- 生产 exporter 的 `renderedTextVerified` 表示实际转换后文字实例检查通过；**visualVerified 保持 false**，防止将结构/glyph 核验解释为所有像素及语义关系认证。

## 3. 实际渲染发现及补修

本轮没有仅检查模型或文件 payload。实际文件检查发现以下问题并修复：

1. 原生图表 `-5` 数据正确，LibreOffice PDF 中柱子向上。仅统一 min/max/零轴不能修复；原生柱状图显式关闭 `invert_if_negative`，并验证混合正负、单 series 垂直柱的实际 PDF 柱矩形与零轴关系。泛用图表同时保留全部 series，不再只导出第一列。
2. table/checklist/summary 在真实字体下丢字。表格统一 TOP anchor、paragraph before/after、边距规则；文本测量增加 20% 字体盒高度余量，再由实际成品 gate 校验，避免只用字符容量预测声明可见。
3. timeline 使用 `01` 而合同期待 `1.`，导致合同与实际输出不一致。列表和 timeline 共用 textLayout 段落规则。
4. 原生 chart 的合法静态 `.xlsx` workbook 被附件安全规则一律拒绝。仅开放由 chart 内部 package relationship 拥有的静态 workbook，并核验内层 ZIP、路径、关系、XML；宏/OLE/外链/公式/嵌套活动内容仍拒绝。没有开放任意 embedding。

原生测试实际保留旋转文字、ellipse 图片 mask、group 媒体和 chart 原生数据/结构。遮罩/群组 XML 保存不等同于所有预览视图外观已认证。

## 4. 本地验收

| 范围 | 结果 | 证据 |
|---|---|---|
| 新 hard rules 自检 | 25 组场景通过 | `hard-rules.json`、`hard-rules.log` |
| 实际损坏文件 | 6/6 拒绝：页外、两个正文合并/消失、裁切错、图片实例缺失、字号变更、段落顺序变更 | 6 份 PPTX 及错误信息 |
| 真实生产 exporter | generic/native PPTX reopening 和实际 LibreOffice PDF 检查通过；原生混合符号柱图测量通过 | `valid-instance-contract.*`、`valid-native-contract.*` |
| 全部 PPT backend selftests | 32 个脚本 exit 0 | `selftests.json` 及逐脚本 log |
| 全仓 npm test | typecheck 完成；2,808 pass / 0 fail / 1 skip（共 2,809） | `npm-test.log` |
| 成品图片人工复核 | 7 页最终实际 PDF 拼图已检查：表/清单/摘要可见、负柱向下、原生旋转文字及 mask 保留 | `verified-renders.png` |
| 差异检查 | `git diff --check` 通过 | 本轮最终检查 |

M2 历史脚本的 matplotlib PDF 子检查在本机 Python 缺依赖而跳过；本轮生产 LibreOffice PPTX/PDF 核验实际执行，不混为同一检查。npm 的一个 skip 保留在原日志。没有修改前端组件或新建用户操作，未将此前 UI 测试当作本轮新 UI 验收。

测试 reviewer 使用模拟协议，测试 exporter 替身仅供控制流隔离；真实文件场景使用生产 Python exporter/verifier。模拟通过不证明真实模型的 mandatory recall 或语义判断准确率。

## 5. 下一轮与运维边界

1. **模型内容验收**：使用多类输入与真实所选 LLM，测 mandatory recall、否定/例外、框架外事实、近义重复和误报；目前只是协议强制及负向 gate。
2. **长来源分片审查**：自动跨上下文分区/父条件闭包/结果合并未实现。当前保留全部原文；review prompt 超过 1 MiB 显式报 `content_review_capacity`，不截掉来源。所选模型实际 context 更小时依赖 not_evaluated 协议，仍应完善 token 预算与分区。
3. **复杂视觉/关系认证**：任意 group/alpha/曲线 ink 遮挡、复杂图表符号与 diagram 拓扑映射未全覆盖；未知媒体默认保留，未支持替换阻断。复杂 native chart 类型不参与新发布认证。
4. **部署**：实际渲染核验新增 LibreOffice、PDF 解析和字体环境依赖，需要运行环境具备；缺少转换引擎进入阻断状态，不能降级为 payload-only passed。容器镜像/Windows/Microsoft PowerPoint 未在本轮验收。

回滚时保留已发布文件；不能恢复 externalPptx whitelist、mandatory 截断或 prose 等价规则作为运行兜底。新合同不可验证时显示阻断/需修复，不把旧证书升级。
