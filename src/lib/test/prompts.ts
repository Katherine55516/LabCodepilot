import fs from 'fs';
import path from 'path';
import type { MCPServerConfig } from '@/types';
import { writeMcpLauncherShim } from './evidence';

/**
 * AI 测试工作台 · 步骤 prompts（移植自 ai-lab-test-framework V0.3 的执行流程）。
 *
 * 框架的 6 步流程在 LabCodepilot 里裁掉「代码库分析」「需求评审」后 = 4 步：
 *   需求分析 → 用例设计 → 测试执行 → 测试报告
 * 每步用框架引擎里**原样**的角色 system prompt（见 app/src/main/engine/
 * {requirements,testcases,runner,report}.js），user prompt 按框架 buildPrompt
 * 改写以适配 LabCodepilot 的「任务」维度——框架以「模块」为单位且带 Step1
 * 产出的 key/entry/coreApis；这里只有任务名 + 项目路径，故走 L2/L3 自动回退、
 * 不依赖模块元数据。规则文件（framework/rules/*.md）已复制到 ./rules 随包加载。
 */

export type TestStep = 'requirement' | 'cases' | 'execution' | 'report';

export const TEST_STEPS: TestStep[] = ['requirement', 'cases', 'execution', 'report'];

/**
 * 加载随包的框架规则文件（./rules，复制自 framework/rules，V0.3）。
 * dev 下 process.cwd() = 项目根可直接读到 src/lib/test/rules/*.md（已验证路径）。
 * 打包 standalone 下 next.config 的 outputFileTracingExcludes 会剥掉 `**​/*.md`，
 * 故打包态此处读不到 → 自动回退到各 prompt 内置的精简规则（见 ruleBlock 的
 * fallback）。打包态要带上完整框架规则属下一轮硬化项（需在 NFT 里显式收录或
 * 改存为非 .md 资源）。
 */
function loadRule(name: string): string | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'test', 'rules', `${name}.md`), 'utf-8');
  } catch {
    return null;
  }
}

/** 产物路径约定（镜像框架；相对项目根）。 */
export function artifactPaths(taskName: string, env: string = 'local') {
  const base = 'AI_LabTest';
  return {
    requirement: `${base}/requirements/${taskName}-需求.md`,
    cases: `${base}/testCase/.data/${taskName}.cases.json`,
    runJson: `${base}/report/${taskName}/${taskName}-${env}.run.json`,
    report: `${base}/report/${taskName}/${taskName}-${env}.md`,
    evidenceDir: `${base}/report/_evidence/${taskName}-${env}`,
  };
}

/**
 * 导入需求「保留原始文档」的落点（相对项目根）：原样保存用户上传件，按原扩展名存，
 * 永不被 AI 需求分析覆盖（那个产物走 artifactPaths().requirement = {任务}-需求.md）。
 */
export function requirementOriginalPath(taskName: string, ext: string): string {
  const safeExt = (ext || 'txt').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'txt';
  return `AI_LabTest/requirements/${taskName}-需求-原始.${safeExt}`;
}

/**
 * 仅 .docx 导入时的内部工作文本（隐藏 .data 目录，不作产物展示）：Agent SDK 的 Read
 * 工具读不了二进制 docx，故导入时用 mammoth 抽一份纯文本供 AI 读；原始 .docx 仍保留。
 * .md/.txt 导入无需此文件（原文本身即可 Read）。
 */
export function requirementImportedTextPath(taskName: string): string {
  return `AI_LabTest/requirements/.data/${taskName}-导入原文.txt`;
}

// ── 角色 system prompts（逐字搬自框架引擎 V0.3）────────────────────────────
const SYS: Record<TestStep, string> = {
  // requirements.js:12
  requirement: `你是 QA 自动化测试平台的「需求分析师」，同时是资深业务分析与测试设计专家。
任务：针对指定测试任务，产出一份「可被自动化测试平台消费」的需求清单。
要求：所有需求必须基于真实证据（已有需求文档原文 或 真实代码），不要臆造；只读源码与文档；只把结果写入 AI_LabTest/ 目录，绝不修改任何业务源码与配置文件。
来源可追溯：每条需求必须标注来源 USER / PROJECT_DOC: 路径 / REVERSE_ENGINEERED: file:line。`,
  // testcases.js:13
  cases: `你是 QA 自动化测试平台的「测试用例设计师」，精于把需求转化为可执行、可断言、相互隔离的测试用例。
任务：基于已产出的需求清单，为指定测试任务设计覆盖完整的测试用例。
要求：每条用例可追溯到需求维度；基于真实证据不臆造；只读 + 只写 AI_LabTest/ 目录，绝不修改业务源码。`,
  // runner.js:447
  execution: `你是 QA 自动化测试平台的「测试执行工程师」，精于用 Playwright 浏览器工具手动驱动被测系统逐条执行测试用例。
铁律：① 只按测试用例做被测系统内的操作，绝不修改任何业务源码与配置；② 严格对照用例「预期结果」判定四态，路径/前置/登录态未建立 → blocked（不是应用 bug）；③ 只把结果写入 AI_LabTest/ 目录；④ 判定基于真实可观察证据，不臆造。`,
  // report.js:12
  report: `你是 QA 自动化测试平台的「测试报告员」。
任务：把一次测试执行的结果，严格按《测试报告规范》整合成可被人和机器消费的结构化 Markdown 报告。
铁律：① 只陈述事实与分类，引用真实证据（执行结果/错误/截图路径），不臆造；
② 失败必须给出分类(应用bug/测试bug/环境问题/路径不可建立/flaky)与三段式备注(做了什么/看到了什么/为什么足以关闭为该状态)；
③ 报告只属测试范畴：可列 bug 事实与"待开发处理"，但禁止写 bug 修复方案/改哪行代码/发布与否/优先级/指派责任人；
④ 禁止在报告中向用户提问或留 TBD/待确认占位；⑤ 只读输入与业务源码，只写 AI_LabTest/ 目录。`,
};

// ── user prompt 构造（按框架 buildPrompt 改写，适配「任务」维度）──────────────
function ruleBlock(title: string, content: string | null, fallback: string): string {
  return content
    ? `下面是《${title}》（权威依据，请严格遵循）：\n\n<${title}>\n${content}\n</${title}>`
    : `（未找到《${title}》规范文件，按内置精简执行：${fallback}）`;
}

function requirementPrompt(
  taskName: string,
  opts: { reuseImported?: boolean; sourcePath?: string } = {},
): string {
  const p = artifactPaths(taskName);
  const reuseImported = opts.reuseImported ?? false;
  // 权威原文的 Read 落点：导入需求(生成 md 模式)时指向「保留的原始文档/抽取文本」，
  // 缺省(旧任务/无导入)回退到 需求.md 本身(与旧行为一致：读它、归一后覆盖它)。
  const sourcePath = opts.sourcePath || p.requirement;
  const rule = ruleBlock(
    '需求发现规范',
    loadRule('requirement-discovery'),
    '先扫 /docs 等目录找该任务相关需求文档，命中则结构化归一并标 PROJECT_DOC；找不到从代码反推并标 REVERSE_ENGINEERED；每条需求含 描述/前置/验收(GWT)/异常分支/数据约束/涉及页面或API'
  );
  // 自审趟依据（评审已内化进本步，不再单独做 Step3 评审、也不产 review.json）。
  const reviewRule = ruleBlock(
    '需求评审规范',
    loadRule('requirement-review'),
    '按 4 维度自查：清晰度/完整度/可测试性/原子性；问题须有原文依据，不臆造、不补需求外的内容、不做业务判断'
  );
  const completenessRule = ruleBlock(
    '需求完整性规范',
    loadRule('requirement-completeness'),
    '每条需求覆盖 正常/空/无效/边界/错误反馈/状态恢复 六路径；涉及鉴权/数据生命周期再加对应维度'
  );
  // 新建任务时用户上传了需求文档，原文已保留 → 让本步以它为权威来源，只读不覆盖；
  // 结构化归一结果写到分离的产物 需求.md（sourcePath 与 p.requirement 不同一文件时，原文安全保留）。
  const importedBlock = reuseImported
    ? `\n\n⚠️⚠️ 用户已上传需求文档，原文已保留在 \`${sourcePath}\`。请**第一步就 Read 该文件**，把它当作**权威需求来源（等同 PROJECT_DOC，标注来源为 USER_UPLOAD）**：在其内容基础上做结构化归一与补全（确有缺失再从代码反推补全并标 REVERSE_ENGINEERED），**严禁忽略它、也严禁从零生成覆盖用户上传的内容**。下面的「项目内扫描」此时仅作补充。⚠️ **原文 \`${sourcePath}\` 是只读输入，绝不写入/覆盖它**；把结构化归一后的需求清单 Write 到产物文件 \`${p.requirement}\`。`
    : '';
  return `请对以下测试任务做「需求分析」，产出可评审的需求清单。

目标任务：${taskName}${importedBlock}

${rule}

⚠️ 目录约定（务必区分）：项目根的 \`docs/\` 是只读的需求源文件输入，绝不写入；\`AI_LabTest/\` 是产物目录，本步写入其下的 \`requirements/\`。

⚡ 执行纪律（控制耗时，必须遵守）：
- 不要使用 Task / Agent 子代理，自己直接读文件。
- 每个文件最多读一次，严禁重复读同一文件。
- 禁止 Glob 全库遍历（如 \`**/*\`），只按任务名精确定位。
- 尽量一轮把要读的文件并行读完，随后直接产出。

⚠️ 本步非交互运行（无法向用户提问），按回退执行：
1. **L2 项目内扫描（优先）**：在 \`docs/\`、\`requirements/\`、\`PRD/\`、\`specs/\`、根目录 \`*.md\`(README 除外) 中按命中「${taskName}」定位相关需求文档（通常 1–2 份，命中即止），结构化归一写入产物，每条标 \`PROJECT_DOC: 路径\`。
2. **L3 代码反推（兜底/补全）**：未命中或文档不覆盖的部分，从相关代码（路由/表单/校验/错误处理/状态/权限/DB 约束）反推需求，每条标 \`REVERSE_ENGINEERED: file:line\`，反推部分如实标记「可能不完整」。

⚠️ 落点与体量（必须遵守）：
- 需求清单**只写入这一个文件** \`${p.requirement}\`（写入白名单仅放行 AI_LabTest/，平台预览固定读取该路径）：先写初稿，再按下方「生成后自审」覆盖同一文件即可；不要用 Bash/heredoc 拼文件、不要写到别处。
- 严格使用规范《§2 输出格式》的 Markdown 结构（文档头：生成时间/主要来源；每条 REQ-NNN：来源/优先级/描述/前置/验收GWT/异常分支/数据约束/涉及页面或API）。
- 文档体量封顶 ≤ 400 行，逐条精炼。

## 生成后自审（评审已内化进本步，不单独出评审报告/评分）

写完需求初稿后，再做一趟自审并**直接修订需求文档本身**（不新增「评审/评分/覆盖矩阵/自查记录」小节，只输出干净的需求文档）：

${reviewRule}

${completenessRule}

自审执行：
1. 通读刚写出的需求清单，对照上述规范自查：① 4 维度（清晰度/完整度/可测试性/原子性）有无硬伤；② 每条需求的 6 路径覆盖（正常/空/无效/边界/错误反馈/状态恢复；涉及鉴权再加未认证/权限级别/会话过期，涉及数据生命周期再加加载/空数据/刷新）有无明显缺口；③ 命中判定表（多条件决定同一结果）或状态迁移信号时，核对组合与非法迁移的预期是否说清。
2. 发现的问题**直接在需求文档里修订**：澄清模糊措辞、补全缺失的验收(GWT)/异常分支/数据约束、拆分非原子需求、补上明显缺失的需求点。修订/新增内容沿用 PROJECT_DOC / REVERSE_ENGINEERED 来源标注，不臆造无依据的需求。
3. ⚠️ 本平台非交互运行：规范中的「强制用户交互 / 产 review.json / 独立评审产物 / 用户门控」一律**跳过**——发现问题直接改进文档，不向用户提问、不产独立评审文件。
4. 用 Write 覆盖保存 \`${p.requirement}\`（即使无需大改也写一次，确认已自查）。

完成后用一句话总结：识别了多少条需求、来源分布（PROJECT_DOC / REVERSE_ENGINEERED 各几条），以及自审修订了哪些点（澄清/补全/拆分/补缺各几处）。`;
}

function casesPrompt(
  taskName: string,
  opts: { reuseImported?: boolean; requirementSourcePath?: string } = {},
): string {
  const p = artifactPaths(taskName);
  const reuseImported = opts.reuseImported ?? false;
  // 需求来源文件：缺省 需求.md（AI 归一产物）；「直接使用导入文档」模式下指向保留的原文/抽取文本。
  const reqSource = opts.requirementSourcePath || p.requirement;
  const usingRawSource = !!opts.requirementSourcePath && opts.requirementSourcePath !== p.requirement;
  const rule = ruleBlock(
    '测试用例完整性规范',
    loadRule('test-case-completeness'),
    '每个「需求×维度」生成用例，字段含 ID/优先级/用例类型/需求引用/标题/前置/步骤(操作↔预期1:1)/断言级别/标签(回归集)/清理；CRUD 用 serial；多角色用隔离会话比较'
  );
  // 新建任务时用户上传了用例（已转成 cases.json）→ 让本步复用它，绝不从零覆盖。
  const importedBlock = reuseImported
    ? `\n\n⚠️⚠️ 用户已上传测试用例，并已写入 \`${p.cases}\`。请**第一步就 Read 该文件**复用其中的用例，仅做规范化与必要补全（字段缺失、格式不合规、断言不具体时修正），**严禁忽略或从零生成覆盖用户上传的用例**。最终仍只 Write 回 \`${p.cases}\`。`
    : '';
  // 「直接使用导入文档」：需求来源是用户原始文档（未经 AI 结构化归一，通常无 REQ-ID / 无来源标注）。
  const rawSourceNote = usingRawSource
    ? `\n\n⚠️ 本任务**直接使用用户导入的原始需求文档**作为需求来源（未经结构化归一，可能无 REQ-ID、无来源标注、为长文本）：生成用例时**为每条需求就地编号 REQ-NNN** 以支撑 TC↔REQ 追溯与需求覆盖矩阵；来源统一按 \`USER_UPLOAD\` 处理，oracle 取「产品确认」+ \`verification:"功能验证"\`（除非原文明显只是照抄现状，才用 现状锁定 + 回归基线）。`
    : '';
  return `请为以下测试任务设计测试用例。

目标任务：${taskName}${importedBlock}${rawSourceNote}
输入产物（请先 Read）：需求来源 ${reqSource}

${rule}

执行：
1. Read 需求来源 ${reqSource}；必要时从相关代码理解页面真实结构与行为。
2. **先建「需求 × 适用维度」覆盖矩阵，再逐格生成**（让条数由需求决定、可复现、不漏需求）：对每条需求从八类维度（正向/异常/边界/状态转换/权限/业务规则/数据一致性/用户体验）判定哪些适用，每个适用格子恰好 1 条用例；**每条需求至少 1 条，一条都不能漏**。
3. 每条用例必含字段：ID（TC-NNN）/ 优先级（P0-P3）/ 用例类型（八类之一）/ 需求引用（REQ-ID）/ 标题（purpose）/ 前置条件 / **测试步骤 steps（操作↔预期 1:1 的数组）** / 断言级别（L1可见/L2内容/L3状态/L4行为）/ **oracle 来源 + 验证性质（见第 4 步「oracle 双轴」铁律）** / **用例标签 tags（见第 5 步「回归集」铁律）** / 清理（如需要）。
   - steps:[{content,expected}]：每个操作配且仅配一条预期，每条 expected **以【检查点类别】开头**（仅用：【UI检查】【业务功能检查】【数据检查】【通知检查】【异常检查】【权限检查】）。
   - 预期要具体、可验证、有源码依据（真实文案/元素/路由/状态），拿不准标「待真机确认」。
4. **oracle 双轴（功能验证 vs 回归基线 —— 决定报告通过率口径，必须标对，详见《测试用例完整性规范》§1.6）**：每条用例除「用例类型」(覆盖维度) 外，**必须**再标两个字段——
   - \`oracle\`（预期结果来源，五选一）：PRD / 设计稿 / API契约 / 产品确认 / 现状锁定。
   - \`verification\`（验证性质，二选一）：功能验证 / 回归基线。
   - **映射铁律**（承接需求来源）：预期来自权威来源（需求标 USER / PROJECT_DOC）→ oracle 取 PRD/设计稿/API契约/产品确认之一 + \`verification:"功能验证"\`；预期来自代码反推或照抄当前 UI 现状（需求标 REVERSE_ENGINEERED 且未经产品确认）→ \`oracle:"现状锁定"\` + \`verification:"回归基线"\`。回归基线用例只锁现状、永远 pass，**禁止**当功能验证。
   - 状态迁移里「纯防御性」的非法迁移（重复操作、终态→任意操作）标 \`verification:"回归基线"\`（oracle = 现状锁定）。
5. **回归集标签（tags —— 标记「发版必跑」的阻塞级用例，详见《测试用例完整性规范》§1.7）**：逐条判定「该用例若不通过，是否阻塞系统运行」——失败意味着 登录/鉴权不可用、核心业务主链路中断、数据写入或一致性被破坏、应用崩溃/白屏 之一 → \`tags\` 含 \`"回归测试"\`；全不满足 → 不打（\`tags:[]\` 或省略）。
   - **与第 4 步「验证性质」是两个正交维度，禁止互相推导**：回归集看「失败后果」，回归基线看「预期来源」。\`verification:"功能验证"\` 的登录主流程用例同时打 \`"回归测试"\` 是常态；\`verification:"回归基线"\` 也**不自动**属于回归集。
   - P0 是天然候选但以失败后果为最终判据：**禁止** P0 无脑全打回归、**禁止**给纯文案/样式类用例打回归；回归集贵在小而准（经验值 ≤ 总数 30%）。
6. 对照规范核验：结构（含 oracle/验证性质/tags 是否齐全）/ 覆盖（八维度）/ 断言 / 隔离 / 顺序 / 数据 / 权限 / 回归集标注是否克制且覆盖核心链路。

⚠️ 落点（必须遵守）：
- 用 Write **只写这一个 JSON 数据文件**：\`${p.cases}\`（平台用可编辑页面渲染该 JSON）。不要生成 .xlsx / .md 或别的文件。
- JSON 必须是严格合法的 UTF-8（可被 JSON.parse 解析）。结构：\`{"cases":[{"id","caseType","requirement","priority","purpose","precondition","steps":[{"content","expected"}],"assertion","oracle","verification","cleanup","tags"}]}\`（\`oracle\`/\`verification\` 取值见第 4 步；\`tags\` 为字符串数组，回归集用例含 \`"回归测试"\`，见第 5 步）。
- **内层引号铁律**：字符串值里引用按钮名/输入值/文案时，一律用中文全角引号「」或""，绝不用英文半角 \`"\`（半角内层引号会断开 JSON）。确需精确英文文案时用反斜杠转义（\\"Submit\\"）。

完成后用一句话总结：生成了多少条用例、覆盖了多少需求维度、其中功能验证 / 回归基线各几条、回归集（tags 含「回归测试」）几条；**若全部为回归基线**，显式提示「本任务用例仅锁定现状、未验证正确性，建议补充权威需求来源（PRD / 产品确认）」。`;
}

/**
 * 登录处理指引（执行 prompt 的🔐块）。三态，优先级 storageState > 密码凭据 > 无：
 *  1. hasLoginState：平台已注入 storageState（capture 抓过）→ 开跑即已登录。
 *  2. loginCredentials：配了「密码」账号且无 storageState → 下发用户名/密码，指示 AI
 *     在登录页自动填充并提交（替代旧的「遇登录墙一律 blocked」）。
 *  3. 都没有：既无密码账号又无 storageState → 遇登录墙判 blocked 并引导去设置。
 * 三个分支各自保留「严禁 AskUserQuestion 向用户索取凭证/输入」的非交互护栏。
 */
function loginHandlingBlock(
  hasLoginState: boolean,
  loginCredentials?: { username: string; password: string },
): string {
  if (hasLoginState) {
    return `🔐 **登录态处理**：平台已为本项目注入登录态（storageState），正常情况下开跑即已登录。若仍被**登录页 / 企业 SSO / 401** 拦住、无法建立会话：把受影响用例判 \`blocked\`、\`error\` 写明「登录态失效 / 未生效」，并在收尾总结**明确提示用户**前往「**设置 · 测试账号**」重新获取登录态后重跑；**严禁**用 \`AskUserQuestion\` 向用户索取任何输入。`;
  }
  if (loginCredentials) {
    // 凭据来自「设置·测试账号」平台下发，不是向用户索取 —— 明文进 prompt，与 DB /
    // environments.json 的明文存储模型一致（见 docs/handover/test-account-settings.md）。
    return `🔐 **登录处理（平台已下发登录账号，请自动登录）**：本项目已在「设置 · 测试账号」配置了「密码」登录账号，以下凭据由平台下发（**非**向用户索取，可直接使用）：
- 用户名：\`${loginCredentials.username}\`
- 密码：\`${loginCredentials.password}\`
当访问被测系统被**登录页**拦住、需要登录时：先用 \`browser_snapshot\` 观察登录页结构，定位「账号 / 用户名 / 域账号」输入框与「密码」输入框（按可见文案 / placeholder / label 识别，中文系统常见 placeholder 如「请输入域账号」「请输入密码」），用 \`browser_fill_form\` 或 \`browser_type\` 把上面的用户名、密码填进对应输入框，再点击「登录」按钮提交；登录成功（跳出登录页、进入系统主界面）后再继续执行用例。
- **登录只做一次**：会话建立后其余用例复用同一登录态，不要每条用例都重新登录。
- 若遇**图形验证码 / 短信验证码 / 企业 SSO 二次跳转 / 2FA** 等用上述凭据无法自动完成的校验 → 该用例（及后续需登录用例）判 \`blocked\`，\`error\` 写明「需人工二次校验，密码自动登录无法完成」，并在收尾总结提示用户改用「**设置 · 测试账号 → 获取登录态**」抓取登录态后重跑；
- **严禁**用 \`AskUserQuestion\` 向用户索取账号 / 密码 / 验证码或任何输入（下发的凭据已足够；缺失信息一律判 \`blocked\` 而非提问）。`;
  }
  return `🔐 **登录态处理（重要，替代"向用户要账号"）**：**本项目未配置登录态**（既未配置「密码」登录账号、也未捕获 storageState），若被测系统需要登录你将无法建立会话。若访问被测系统时被**登录页 / 企业 SSO / 401** 拦住、无法建立会话：
- **不要**手动编造账号密码登录，**更不要**用 \`AskUserQuestion\` 向用户索取凭证；
- 把受影响的用例判 \`blocked\`，\`error\` 写明「未检测到登录态，被登录页 / SSO 拦截」；
- 若**整个被测系统都需要登录**（首个用例即被登录页挡住）→ **立即停止、不要逐条空跑**，其余用例一并判 \`blocked\`（原因同上，未输出的由平台补全为「未执行」）；
- 在收尾总结里**明确提示用户**：请前往「**设置 · 测试账号**」为本项目配置登录账号（密码）或获取登录态（即项目的环境配置），配置好后再重跑本步。`;
}

function executionPrompt(
  taskName: string,
  env: string,
  baseUrl?: string,
  hasLoginState = false,
  loginCredentials?: { username: string; password: string },
): string {
  const p = artifactPaths(taskName, env);
  const rule = ruleBlock(
    '测试执行规范',
    loadRule('test-execution'),
    '逐条用例用浏览器工具满足前置→执行操作→对照预期判四态(pass/fail/partial/blocked)；前置卡在非被测第三方依赖可按 §1.1 受控桩(browser_route)绕过、桩须留痕；仅被测接口/地址/账号本身不可建立才归 blocked（非应用 bug）；每条截图留证'
  );
  return `请对测试任务「${taskName}」执行测试用例（AI 通过 Playwright MCP 浏览器工具实时驱动浏览器逐条执行）。

环境：${env}
${baseUrl ? `被测地址：${baseUrl}（平台已在执行前完成可达性探测、确认可达才会进入本步——**无需再用 curl/请求工具反复探活**；若执行中途发现地址不可达，最多重试探活 3 次即停止并在结果中说明，**切勿无限重试**。）` : '（未配置被测地址：若无法确定目标系统地址或地址不可达，相应用例判 blocked 并在结果中说明，不要臆造结果。）'}
输入产物（请先 Read）：测试用例 ${p.cases}

⚠️ **本步为非交互自动化执行（交互端无人应答）**：**严禁使用 \`AskUserQuestion\`，也严禁以任何方式向用户提问 / 等待用户输入 / 暂停等待确认**——问了永远不会有人回答，会让执行永久卡死。目标环境已由平台指定为 \`${env}\`，直接使用，**不要再反问用户选环境**。

${loginHandlingBlock(hasLoginState, loginCredentials)}

${rule}

执行：
1. Read ${p.cases}，逐条用例：用浏览器工具（browser_navigate / browser_click / browser_type / browser_fill_form / browser_snapshot / browser_wait_for / browser_take_screenshot）满足前置条件（如登录）→ 执行测试操作 → 对照用例「预期结果」判定四态。前置若卡在**非被测的第三方依赖**（三方 OAuth 回调 / 验证码 / 外部 SDK / 无关外部 API），可用 \`browser_route\` 受控桩绕过（见《测试执行规范》§1.1：先真实后桩、被测接口绝不桩、桩须在 actual 留痕、用完 browser_unroute 清理）。
2. **录像（每条用例一段）**：每条用例开始操作前调 \`browser_start_video({filename:"{用例ID}.webm"})\` 开录，用例结束（判完四态、补完证据后）调 \`browser_stop_video\` 停录。**pass 用例：录像不写进 evidence**（平台会清理未被引用的录像）；**fail / partial 用例：把 \`{用例ID}.webm\` 写进该用例 evidence**。录像与截图都落 \`${p.evidenceDir}\`。
3. **失败用例采集接口信息**：对 fail / partial 用例，先用 \`browser_network_requests\` 列出本页请求、定位与失败现象相关的关键请求，再用 \`browser_network_request\` 取其完整 方法 / URL / 状态码 / 请求体 / 响应体；请求体、响应体过长时各自截断到约 ≤4000 字符。pass / blocked 用例无需采集。
4. **每条用例在任何浏览器工具调用之前**先输出两行：机器标记 \`@@CASE_START {"id":"TC-xxx","index":N}\`（单行严格 JSON，id 必须与 cases.json 完全一致）以及可读进度 \`▶ 用例 N/总数：{标题}\`。结束**输出单行 JSON**：\`@@RESULT {"id":"...","status":"pass|fail|partial|blocked","actual":"观察现象","evidence":["TC-xxx.png","TC-xxx.webm"],"error":"失败/阻塞原因，pass留空","api":{"method":"POST","url":"/api/...","status":200,"requestBody":"...","responseBody":"..."}}\`（单行、严格 JSON、内层引号用「」或转义）。\`api\` **仅 fail / partial 且定位到关键请求时给出**，pass 省略该字段；\`evidence\` 含截图与（fail/partial 时）录像文件名。\`@@CASE_START\` 只用于平台把本条真实 Playwright 工具轨迹归属到对应用例，不得省略、不得在工具调用后补写。
5. **四态**：pass=预期完全出现；fail=预期明确未出现且可复现（疑似应用缺陷，保留事实不放水）；partial=部分满足；blocked=前置/路径/登录态/地址不可达（**不是应用 bug**）。判 blocked 前：若挡路的是**非被测前置依赖**，先按 §1.1 受控桩重试；仅当**被测接口/地址/账号本身**无法建立才判 blocked。桩过的用例 \`actual\` 须注明「已桩 mock <依赖>」，被桩部分不计入验证。
6. 绝不修改业务源码与配置，只在被测系统页面内操作；截图与录像存到 \`${p.evidenceDir}\`。
7. **不要自己写汇总文件**：每条用例的 \`@@RESULT\` 行就是唯一事实来源，平台会据此**确定性归约**出 \`${p.runJson}\`（计数 / 四态 / 环境错误重分类 / 401 熔断由平台代码计算，不由你汇总）。你只需保证**每条用例都输出一行规范的 @@RESULT**。
8. **覆盖自检（防漏跑，最重要）**：开跑前先数出 \`${p.cases}\` 的用例总数 N，以「全部执行完 N 条」为目标，**逐条执行、不得中途停**。每条用例无论 pass/fail/partial/blocked **都必须输出恰好一行 @@RESULT**；确实无法执行的也要输出 \`status:"blocked"\` 并在 error 说明，**不得跳过或省略任何一条**。全部结束后核对：已输出的 @@RESULT 行数必须等于 N；**若少于 N，必须回到缺失的用例补执行并补输出 @@RESULT**，严禁因用例多、耗时长而提前收尾、抽样或只跑前几条。**每条 @@RESULT 的 \`id\` 必须与 \`${p.cases}\` 中该用例的 id 完全一致；一条用例只输出一行 @@RESULT，不得为同一用例产出多行、也不得编造或拆分出 cases 之外的用例（否则报告会多出用户没设计的用例）。**

完成后用一句话总结：用例总数 N、已输出 @@RESULT 行数、以及四态计数（pass/fail/partial/blocked）；若行数 < N 必须显式说明哪些用例未覆盖。`;
}

function reportPrompt(taskName: string, env: string): string {
  const p = artifactPaths(taskName, env);
  const rule = ruleBlock(
    '测试报告规范',
    loadRule('test-report'),
    '概要四态表 + 模块结果 + 失败明细(分类+三段式+截图) + 需求覆盖矩阵 + 应用Bug清单 + 测试侧后续；只陈述事实，不提修复方案/发布决策'
  );
  return `请为测试任务「${taskName}」生成测试报告。

环境：${env}
输入产物（请先 Read）：
- 执行结果（权威事实，四态计数/逐条状态以此为准，不要自行改数）：${p.runJson}
- 测试用例（含 TC↔REQ 引用、断言级别）：${p.cases}

⚠️ 本步**不读需求文档**：需求覆盖矩阵只依据**测试用例中的 REQ 引用**，不要去找/读需求文档，也不要臆造未在用例中出现的需求。

${rule}

执行：
1. Read ${p.runJson} 与 ${p.cases}。
2. 按规范产出**全部必含章节**：概要(环境/四态/**双口径通过率**/执行时间/报告时间) → 模块结果 → 失败明细(每条：分类 + 三段式备注 + 错误摘要 + 截图路径) → 需求覆盖矩阵(以测试用例中的 REQ 引用为行) → 应用Bug清单(仅事实) → 测试侧后续动作(仅测试范畴)。
3. **双口径通过率（承接《测试报告规范》§2.1 通过率铁律 + 用例 oracle 双轴）**：概要必须分别给出——
   - 「功能验证通过率」= 功能验证用例 pass ÷ 功能验证用例总数（**回归基线不计入**）；
   - 「执行通过率（参考）」= 全部 pass ÷ 全部用例（含回归基线，**不代表功能正确**）。
   - 用例的 \`verification\`（功能验证 / 回归基线）来自 ${p.cases}；run.json 已按 cases 预聚合好功能验证四态，**优先直接采用** run.json 的 \`funcCounts\`（功能验证四态计数）与 \`funcPassStr\`（功能验证通过率字符串，全回归基线时为 \`N/A\`），无需自行重算。
   - 若全部用例均为回归基线，功能验证通过率记 \`N/A（仅锁现状）\`，**禁止**报「100% 通过」；需求覆盖矩阵中仅由回归基线覆盖的格子用 \`LOCK\` 符号（非 PASS）。
   - **回归集红线（tags 口径，与上面回归基线正交，详见《测试报告规范》§2.1a）**：run.json 若含 \`suiteCounts\`/\`suitePassStr\`（回归集 = 用例 \`tags\` 含「回归测试」，失败即阻塞系统），报告**必须**含「回归集」小节列出其四态与通过率；回归集存在 fail/partial/blocked（含未执行）时，报告结论**必须**标「**阻塞——回归集未全过，不可发版**」，**禁止**在总体结论中表述为通过/可发布；回归集全过则结论标注「回归集全过（N/N）」。无 suiteCounts（用例未打回归标签）则跳过该小节。
4. 失败分类必须明确（应用bug/测试bug/环境问题/路径不可建立/flaky），三段式给证据。报告时间用 run.json 的 time，不要用当前时间。
5. 严守规范禁止事项：不写 bug 修复方案 / 改哪行代码 / 发布与否 / 优先级 / 指派；报告内不向用户提问、不留 TBD。

⚠️ 落点（必须遵守）：报告**只能用 Write 写入** \`${p.report}\`。

完成后用一句话总结：结论(通过/未通过/阻塞)、通过率、失败数、主要风险点（仅事实）。`;
}

export interface BuildStepOptions {
  taskName: string;
  env?: string;
  baseUrl?: string;
  /** Free-text instructions the user typed in the 测试对话 composer — appended to the step prompt. */
  extraInstruction?: string;
  /** 新建任务 imported this step's artifact (需求/用例) — Read + reuse the upload, don't regenerate. */
  reuseImported?: boolean;
  /**
   * 导入需求的来源模式：'generate-md' = AI 读原文归一产 需求.md（保留原始 + md 两份）；
   * 'use-original' = 跳过 AI，用例步直接读原始文档。缺省(旧任务/无导入)按 需求.md。
   */
  requirementMode?: 'generate-md' | 'use-original';
  /**
   * 本步应读取的需求来源文件（相对项目根）：
   *  - requirement 步(generate-md)：保留的原始文档 / docx 抽取文本（Read 它，Write 到 需求.md）；
   *  - cases 步(use-original)：同上原始来源；cases 步(generate-md/旧任务)：留空 → 回退 需求.md。
   */
  requirementSourcePath?: string;
  /** 执行步：本项目/该环境是否已捕获登录态(storageState)。false → 执行 prompt 提示 AI「未配置登录态，遇登录墙判 blocked 并引导去设置·测试账号」，且非交互运行严禁向用户提问。 */
  hasLoginState?: boolean;
  /**
   * 执行步：本项目/该环境配的「密码」登录账号（平台下发的用户名/密码），仅在无 storageState
   * 时用于让执行智能体在登录页自动填充并提交登录。缺省 → 不注入凭据（走 hasLoginState 分支）。
   */
  loginCredentials?: { username: string; password: string };
}

export interface BuiltStep {
  systemPrompt: string;
  prompt: string;
  /** True if this step needs the Playwright MCP server injected. */
  needsPlaywright: boolean;
}

/** Append the user's typed instructions (追加指令) to a step's prompt, if any. */
function withNote(built: BuiltStep, note?: string): BuiltStep {
  const n = note?.trim();
  if (!n) return built;
  return { ...built, prompt: `${built.prompt}\n\n## 用户补充要求（请在本步中一并遵循）\n${n}` };
}

/** Build the system + user prompt for one test step. */
export function buildStep(step: TestStep, opts: BuildStepOptions): BuiltStep {
  const taskName = opts.taskName;
  const env = opts.env || 'local';
  const note = opts.extraInstruction;
  switch (step) {
    case 'requirement':
      return withNote({ systemPrompt: SYS.requirement, prompt: requirementPrompt(taskName, { reuseImported: opts.reuseImported, sourcePath: opts.requirementSourcePath }), needsPlaywright: false }, note);
    case 'cases':
      return withNote({ systemPrompt: SYS.cases, prompt: casesPrompt(taskName, { reuseImported: opts.reuseImported, requirementSourcePath: opts.requirementSourcePath }), needsPlaywright: false }, note);
    case 'execution':
      return withNote({ systemPrompt: SYS.execution, prompt: executionPrompt(taskName, env, opts.baseUrl, opts.hasLoginState, opts.loginCredentials), needsPlaywright: true }, note);
    case 'report':
      return withNote({ systemPrompt: SYS.report, prompt: reportPrompt(taskName, env), needsPlaywright: false }, note);
  }
}

/**
 * Build the Playwright MCP server config injected ONLY for the execution step.
 * Mirrors the framework runner.js launch flags (V0.3). Per-run injection — 普通
 * 对话不会看到它（不进全局 MCP 配置）。
 */
/**
 * 打包态:定位随安装包分发的 chromium_headless_shell 二进制。scripts/bundle-chromium.mjs
 * 在打包前把它装到项目 ms-playwright-bundle/,electron-builder 复制为 resources/
 * ms-playwright;electron/main.ts fork standalone server 时注入 AILAB_RESOURCES_PATH=
 * process.resourcesPath。dev 态没有该 env → 返回 null,buildPlaywrightMcp 不加
 * --executable-path,沿用本机 ~/.cache/ms-playwright 里的浏览器。
 *
 * 动态扫描(不写死 revision,升级 playwright 后仍生效):
 *   <resources>/ms-playwright/chromium_headless_shell-<rev>/chrome-headless-shell-<plat>/chrome-headless-shell[.exe]
 */
export function resolveBundledHeadlessShell(): string | null {
  const resourcesPath = process.env.AILAB_RESOURCES_PATH;
  if (!resourcesPath) return null;
  const browsersDir = path.join(resourcesPath, 'ms-playwright');
  const exe = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
  let revDirs: string[];
  try {
    revDirs = fs.readdirSync(browsersDir).filter((d) => d.startsWith('chromium_headless_shell-'));
  } catch {
    return null;
  }
  for (const rev of revDirs) {
    const revDir = path.join(browsersDir, rev);
    let platDirs: string[] = [];
    try {
      platDirs = fs.readdirSync(revDir).filter((d) => d.startsWith('chrome-headless-shell-'));
    } catch { continue; }
    for (const pd of platDirs) {
      const bin = path.join(revDir, pd, exe);
      if (fs.existsSync(bin)) return bin;
    }
  }
  return null;
}

/**
 * 定位一个可用于「有头(可见窗口)」运行的完整 Google Chrome 二进制。
 *
 * 为什么需要它:打包态随包只分发 chrome-headless-shell(仅无头),要弹可见窗口必须有完整
 * 浏览器。本机完整 chromium 也没随包,故复用系统已装的 Chrome —— 直接拿到它的可执行路径,
 * 用 --executable-path 指过去(不走 playwright 的 `chrome` channel:channel 只认死的标准
 * 安装路径,Linux 的 snap/flatpak/自定义前缀一律找不到,会在 MCP 进程里抛错崩掉整轮)。
 *
 * 解析顺序:
 *  1. AILAB_CHROME_PATH 显式覆盖(power-user 自定义安装 / 测试桩):
 *     - 设为有效存在路径 → 用它;设为空 / "none" → 显式判定「无 Chrome」(不再探标准路径)。
 *  2. 各平台标准安装路径(镜像 playwright-core 的探测点)。
 * 找不到返回 null —— 调用方据此自动回落无头,绝不让有头请求把执行步打崩。
 */
export function resolveSystemChrome(): string | null {
  const override = process.env.AILAB_CHROME_PATH;
  if (override != null) {
    const v = override.trim();
    if (!v || v.toLowerCase() === 'none') return null;
    try { return fs.existsSync(v) ? v : null; } catch { return null; }
  }
  let candidates: string[];
  if (process.platform === 'darwin') {
    candidates = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  } else if (process.platform === 'win32') {
    candidates = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]
      .filter((p): p is string => !!p)
      .map((p) => path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  } else {
    candidates = ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* keep probing */ }
  }
  return null;
}

/**
 * 本次执行最终是否真的会有头跑。打包态请求有头但定位不到完整浏览器(随包只有无头 shell、
 * 系统又没装 Chrome)→ 自动回落无头,此函数返回 false。路由据此给用户一条「已改无头」提示。
 */
export function willRunHeaded(headed: boolean): boolean {
  if (!headed) return false;
  const headlessShell = resolveBundledHeadlessShell();
  if (!headlessShell) return true; // dev 态:用本机完整 chromium,可有头
  return !!resolveSystemChrome();  // 打包态:仅当系统/自定义 Chrome 可定位
}

export function buildPlaywrightMcp(
  projectPath: string,
  evidenceDir: string,
  storageStatePath?: string | null,
  opts?: { headed?: boolean },
): MCPServerConfig {
  const cli = path.join(process.cwd(), 'node_modules', '@playwright', 'mcp', 'cli.js');
  const evidenceAbs = path.join(projectPath, evidenceDir);
  // Ensure the evidence dir exists so the shim's chdir target is valid at launch.
  try { fs.mkdirSync(evidenceAbs, { recursive: true }); } catch {}
  // Launch via a shim that chdir's to the evidence dir before loading the CLI
  // (stdio MCP servers can't take a `cwd`), so relative-named writes land there.
  const shim = writeMcpLauncherShim();
  // 打包态:随包分发的 headless_shell 二进制路径(dev 态为 null,用本机浏览器)。
  const headlessShell = resolveBundledHeadlessShell();
  // 可见(有头)模式:用户选「独立窗口可见运行」时弹出真实浏览器窗口。
  const headed = opts?.headed === true;
  // 打包态有头需要一个完整浏览器(随包 shell 仅无头)。定位系统/自定义 Chrome;定位不到则
  // 自动回落无头 —— 绝不让有头请求把执行步打崩。dev 态(headlessShell=null)有头用本机 chromium。
  const systemChrome = headed && headlessShell ? resolveSystemChrome() : null;
  const effectiveHeaded = headed && (!headlessShell || !!systemChrome);
  // --executable-path 选择:
  //   有头 + 打包(且定位到 Chrome) → 直指 Chrome 完整二进制(不走 `chrome` channel:channel 只认
  //     死的标准路径,snap/flatpak/自定义装法找不到会崩;直指路径还能honor AILAB_CHROME_PATH)。
  //   有头 + dev → 不指(用本机完整 chromium)。
  //   无头 + 打包 → 直指随包 headless_shell(playwright 默认 headless 走完整 chromium 的 new-headless、
  //     不会自动用 shell,故必须显式指过去并绕过 revision 目录发现)。
  //   无头 + dev → 不指(用本机浏览器)。
  const executablePath = effectiveHeaded ? systemChrome : headlessShell;
  // 仅「无头 + 用随包 shell」时把浏览器根目录也指过去(双保险);有头/dev 不注入。
  const usePackagedBrowsersPath = !!headlessShell && !effectiveHeaded;
  return {
    type: 'stdio',
    command: process.execPath,
    args: [
      shim,
      '--browser', 'chromium',
      ...(executablePath ? ['--executable-path', executablePath] : []),
      '--isolated',
      '--caps', 'devtools,network',
      '--viewport-size', '1280,800',
      '--output-dir', evidenceAbs,
      '--save-session',
      // Preload the captured login state (from 测试账号设置) so the AI starts logged in.
      ...(storageStatePath ? ['--storage-state', storageStatePath] : []),
      // 无头模式加 --headless;有头(且真能有头)省略 → playwright 默认弹出可见窗口。
      ...(effectiveHeaded ? [] : ['--headless']),
    ],
    env: {
      ...(process.env as Record<string, string>),
      // Packaged build: process.execPath is Electron → run it as plain node.
      ELECTRON_RUN_AS_NODE: '1',
      // Read by the shim: chdir target + the real CLI to require after chdir.
      AILAB_MCP_CWD: evidenceAbs,
      AILAB_MCP_CLI: cli,
      // 打包态【无头】:把浏览器根目录也指过去(executable-path 已直指,这是双保险)。有头用
      // 系统 Chrome,不能指向随包目录(那里只有 headless_shell),故仅无头时注入。
      ...(usePackagedBrowsersPath && process.env.AILAB_RESOURCES_PATH
        ? { PLAYWRIGHT_BROWSERS_PATH: path.join(process.env.AILAB_RESOURCES_PATH, 'ms-playwright') }
        : {}),
    },
  };
}
