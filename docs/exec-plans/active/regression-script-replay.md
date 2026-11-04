# 回归执行 · 脚本重放优先(script-first regression)

> 状态:开发完成(2026-07-13;typecheck + 全量单测 2175/0,含本功能 12 条契约);**待打包真机验收**(混跑/全脚本/脚本失败/关开关 四轮,见「验证口径」)
> 关联:docs/handover/regression-script-generation.md(脚本沉淀链,本计划的上游;实现细节已并入该文档「回归执行 · 脚本重放优先」节)

## 背景与目标

功能测试已对「回归测试」标签 + 通过的用例自动沉淀 Playwright 脚本(生成→校验→重放,manifest 记状态)。
回归轮次执行目前全部走 AI 智能体(慢、烧 token)。本计划打通"最后一公里":**回归执行时,
有合格脚本的用例直接跑脚本(秒级/零 token),其余走 AI;全部有脚本则整轮零模型消耗。**

## 已确认的产品决策(2026-07-13,用户拍板)

1. **失败兜底**:脚本失败 = 用例失败(不自动转 AI)。**连续失败 ≥2 次**的脚本必须在错误信息/
   报告中提示用户并给出建议(脚本面板 AI 修复/重试生成,或关闭「优先脚本重放」走 AI 对照)。
   环境类失败(isEnvironmentFailure)判 blocked、不计连败。
2. **范围**:`verified` + `needs_review`(排除 `usesMock`;排除带 `lastRunError` 的 needs_review
   ——已知失败的交给既有修复通道,不进回归轮次白白挂红)。
3. **开关**:发起弹窗「优先脚本重放」默认开、可关;预检卡显示「其中 N 条可脚本重放」。

## 架构(嵌入点与数据流)

`/api/test/run` step=execution(仅 回归用例库+roundId)同一条 SSE 流内两阶段:

- **阶段 A 脚本重放**(服务端直跑):快照 idMap 反解 {来源任务, originalId} → 读
  `scripts/<来源任务>/<env>/manifest.json` → 资格判定(状态/mock/lastRunError/文件存在/
  **caseBodyHash 匹配**)→ 逐条发合成帧(`@@CASE_START` + `▶ 用例 i/N：标题（脚本重放）`)
  → `runGeneratedScript`(现有隔离运行器)→ `@@RESULT {"id",status,actual,error,"via":"script"}`。
  manifest 的 lastRunAt/lastRunError/连败计数/verified 提升就地更新(持 .generation.lock,
  锁忙 → 该任务的用例整组降级走 AI,不阻塞)。
- **阶段 B AI 执行**(只跑剩余):剩余为空 → 跳过智能体;否则 prompt 注入「M 条已由脚本执行,
  禁止执行,只跑剩余 K 条、编号续 M+1」。
- 归约器"同 id 取第一条"⇒ 脚本结果天然不被模型误跑覆盖;下游 run.json/报告/轮次/矩阵/
  delta/健康度/实时面板零改动(标记同构)。

### 指纹防错配

生成时在 manifest 条目记 `caseBodyHash = caseFingerprint(用例体)`(复用 library.ts 语义指纹,
排除 id/tags/_source/_lib)。重放前与快照用例比对——库里改过的用例(rev 升)不拿旧脚本重放。
存量条目无 hash → 宽限放行(下轮生成自然补齐)。

## 改动清单

| 文件 | 改动 |
|------|------|
| `src/lib/test/script-artifacts.ts` | ScriptManifestCase +`caseBodyHash?` +`consecutiveRunFailures?` |
| `src/lib/test/script-generator.ts` | EligibleScriptCase 计算并携带 caseBodyHash(retarget 保留) |
| `src/lib/test/script-job-manager.ts` | 落 manifest 时写 caseBodyHash;导出 `tryAcquireScriptLock` |
| `src/lib/test/script-regression.ts`(新) | `resolveScriptPlan`(资格判定)+ `runScriptPhase`(合成帧流+manifest 更新+连败提示) |
| `src/lib/test/prompts.ts` | executionPrompt 支持 `scriptDoneIds`(排除声明+计数/编号调整) |
| `src/app/api/test/run/route.ts` | execution 步:plan → 阶段 A 流 → 拼接 AI 流/跳过 → wrapExecutionStream 包整体;审计 |
| `src/lib/test/reduce.ts` | RawResult/ReducedTest +`via?` 透传 |
| `src/lib/test/run-scope.ts` 或 suites/eval | scope +`scriptable` 计数(预检卡) |
| `InlineTestingPanel.tsx` | 弹窗开关+预检行;报告行「脚本」徽标;runLibrary 透传 scriptFirst |
| `src/i18n/{en,zh,zh-HK}.ts` | 开关/预检/徽标文案 |
| `src/__tests__/unit/script-regression.test.ts`(新) | 资格矩阵/合成帧↔归约契约/先到先得/连败提示 |

## 验证口径

- `npm run test`(typecheck+单测)全过;
- 单测覆盖:资格判定矩阵、合成帧经 harvestResults→reduce 的端到端、重复 id 先到先得、
  连败计数与提示阈值、锁忙降级;
- 真机(打包版):混跑轮(部分脚本+部分 AI)、全脚本轮(跳过智能体)、脚本失败轮(错误提示+连败建议)、
  关闭开关轮(纯 AI 回归不变)。

## 风险与边界

- 脚本重放 v1 无截图/录像证据(失败只有 Playwright 输出摘要)——phase 2 计划 screenshot-on-failure 收进 evidence;
- 合成任务目录遗留(映射缺失)的脚本不参与重放(走 AI);
- trace 不会为脚本重放的用例重新提取——脚本生成幂等按语义指纹复用,无影响。
