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

function requirementPrompt(taskName: string, reuseImported = false): string {
  const p = artifactPaths(taskName);
  const rule = ruleBlock(
    '需求发现规范',
    loadRule('requirement-discovery'),
    '先扫 /docs 等目录找该任务相关需求文档，命中则结构化归一并标 PROJECT_DOC；找不到从代码反推并标 REVERSE_ENGINEERED；每条需求含 描述/前置/验收(GWT)/异常分支/数据约束/涉及页面或API'
  );
  // 新建任务时用户上传了需求文档，已写入产物路径 → 让本步以它为权威来源，绝不覆盖。
  const importedBlock = reuseImported
    ? `\n\n⚠️⚠️ 用户已上传需求文档，并已写入 \`${p.requirement}\`。请**第一步就 Read 该文件**，把它当作**权威需求来源（等同 PROJECT_DOC，标注来源为 USER_UPLOAD）**：在其内容基础上做结构化归一与补全（确有缺失再从代码反推补全并标 REVERSE_ENGINEERED），**严禁忽略它、也严禁从零生成覆盖用户上传的内容**。下面的「项目内扫描」此时仅作补充。最终仍只 Write 回 \`${p.requirement}\`。`
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
- 需求清单**只能用 Write 一次写入** \`${p.requirement}\`（写入白名单仅放行 AI_LabTest/，平台预览固定读取该路径）。不要用 Bash/heredoc 拼文件。
- 严格使用规范《§2 输出格式》的 Markdown 结构（文档头：生成时间/主要来源；每条 REQ-NNN：来源/优先级/描述/前置/验收GWT/异常分支/数据约束/涉及页面或API）。
- 文档体量封顶 ≤ 400 行，逐条精炼。

完成后用一句话总结：识别了多少条需求、来源分布（PROJECT_DOC / REVERSE_ENGINEERED 各几条）。`;
}

function casesPrompt(taskName: string, reuseImported = false): string {
  const p = artifactPaths(taskName);
  const rule = ruleBlock(
    '测试用例完整性规范',
    loadRule('test-case-completeness'),
    '每个「需求×维度」生成用例，字段含 ID/优先级/用例类型/需求引用/标题/前置/步骤(操作↔预期1:1)/断言级别/清理；CRUD 用 serial；多角色用隔离会话比较'
  );
  // 新建任务时用户上传了用例（已转成 cases.json）→ 让本步复用它，绝不从零覆盖。
  const importedBlock = reuseImported
    ? `\n\n⚠️⚠️ 用户已上传测试用例，并已写入 \`${p.cases}\`。请**第一步就 Read 该文件**复用其中的用例，仅做规范化与必要补全（字段缺失、格式不合规、断言不具体时修正），**严禁忽略或从零生成覆盖用户上传的用例**。最终仍只 Write 回 \`${p.cases}\`。`
    : '';
  return `请为以下测试任务设计测试用例。

目标任务：${taskName}${importedBlock}
输入产物（请先 Read）：已产出的需求清单 ${p.requirement}

${rule}

执行：
1. Read 需求清单 ${p.requirement}；必要时从相关代码理解页面真实结构与行为。
2. **先建「需求 × 适用维度」覆盖矩阵，再逐格生成**（让条数由需求决定、可复现、不漏需求）：对每条需求从八类维度（正向/异常/边界/状态转换/权限/业务规则/数据一致性/用户体验）判定哪些适用，每个适用格子恰好 1 条用例；**每条需求至少 1 条，一条都不能漏**。
3. 每条用例必含字段：ID（TC-NNN）/ 优先级（P0-P3）/ 用例类型（八类之一）/ 需求引用（REQ-ID）/ 标题（purpose）/ 前置条件 / **测试步骤 steps（操作↔预期 1:1 的数组）** / 断言级别（L1可见/L2内容/L3状态/L4行为）/ 清理（如需要）。
   - steps:[{content,expected}]：每个操作配且仅配一条预期，每条 expected **以【检查点类别】开头**（仅用：【UI检查】【业务功能检查】【数据检查】【通知检查】【异常检查】【权限检查】）。
   - 预期要具体、可验证、有源码依据（真实文案/元素/路由/状态），拿不准标「待真机确认」。
4. 对照规范核验：结构 / 覆盖（八维度）/ 断言 / 隔离 / 顺序 / 数据 / 权限。

⚠️ 落点（必须遵守）：
- 用 Write **只写这一个 JSON 数据文件**：\`${p.cases}\`（平台用可编辑页面渲染该 JSON）。不要生成 .xlsx / .md 或别的文件。
- JSON 必须是严格合法的 UTF-8（可被 JSON.parse 解析）。结构：\`{"cases":[{"id","caseType","requirement","priority","purpose","precondition","steps":[{"content","expected"}],"assertion","cleanup"}]}\`。
- **内层引号铁律**：字符串值里引用按钮名/输入值/文案时，一律用中文全角引号「」或""，绝不用英文半角 \`"\`（半角内层引号会断开 JSON）。确需精确英文文案时用反斜杠转义（\\"Submit\\"）。

完成后用一句话总结：生成了多少条用例、覆盖了多少需求维度。`;
}

function executionPrompt(taskName: string, env: string, baseUrl?: string): string {
  const p = artifactPaths(taskName, env);
  const rule = ruleBlock(
    '测试执行规范',
    loadRule('test-execution'),
    '逐条用例用浏览器工具满足前置→执行操作→对照预期判四态(pass/fail/partial/blocked)；环境/连接/登录态无法建立归 blocked（非应用 bug）；每条截图留证'
  );
  return `请对测试任务「${taskName}」执行测试用例（AI 通过 Playwright MCP 浏览器工具实时驱动浏览器逐条执行）。

环境：${env}
${baseUrl ? `被测地址：${baseUrl}` : '（未配置被测地址：若无法确定目标系统地址或地址不可达，相应用例判 blocked 并在结果中说明，不要臆造结果。）'}
输入产物（请先 Read）：测试用例 ${p.cases}

${rule}

执行：
1. Read ${p.cases}，逐条用例：用浏览器工具（browser_navigate / browser_click / browser_type / browser_fill_form / browser_snapshot / browser_wait_for / browser_take_screenshot）满足前置条件（如登录）→ 执行测试操作 → 对照用例「预期结果」判定四态。
2. **每条用例先打印进度** \`▶ 用例 N/总数：{标题}\`；结束**输出单行 JSON**：\`@@RESULT {"id":"...","status":"pass|fail|partial|blocked","actual":"观察现象","evidence":["TC-xxx.png"],"error":"失败/阻塞原因，pass留空"}\`（单行、严格 JSON、内层引号用「」或转义）。
3. **四态**：pass=预期完全出现；fail=预期明确未出现且可复现（疑似应用缺陷，保留事实不放水）；partial=部分满足；blocked=前置/路径/登录态/地址不可达（**不是应用 bug**）。
4. 绝不修改业务源码与配置，只在被测系统页面内操作；截图存到 \`${p.evidenceDir}\`。
5. **不要自己写汇总文件**：每条用例的 \`@@RESULT\` 行就是唯一事实来源，平台会据此**确定性归约**出 \`${p.runJson}\`（计数 / 四态 / 环境错误重分类 / 401 熔断由平台代码计算，不由你汇总）。你只需保证**每条用例都输出一行规范的 @@RESULT**。

完成后用一句话总结四态计数（pass/fail/partial/blocked）。`;
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
2. 按规范产出**全部必含章节**：概要(环境/四态/通过率/执行时间/报告时间) → 模块结果 → 失败明细(每条：分类 + 三段式备注 + 错误摘要 + 截图路径) → 需求覆盖矩阵(以测试用例中的 REQ 引用为行) → 应用Bug清单(仅事实) → 测试侧后续动作(仅测试范畴)。
3. 失败分类必须明确（应用bug/测试bug/环境问题/路径不可建立/flaky），三段式给证据。报告时间用 run.json 的 time，不要用当前时间。
4. 严守规范禁止事项：不写 bug 修复方案 / 改哪行代码 / 发布与否 / 优先级 / 指派；报告内不向用户提问、不留 TBD。

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
      return withNote({ systemPrompt: SYS.requirement, prompt: requirementPrompt(taskName, opts.reuseImported), needsPlaywright: false }, note);
    case 'cases':
      return withNote({ systemPrompt: SYS.cases, prompt: casesPrompt(taskName, opts.reuseImported), needsPlaywright: false }, note);
    case 'execution':
      return withNote({ systemPrompt: SYS.execution, prompt: executionPrompt(taskName, env, opts.baseUrl), needsPlaywright: true }, note);
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
function resolveBundledHeadlessShell(): string | null {
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

export function buildPlaywrightMcp(
  projectPath: string,
  evidenceDir: string,
  storageStatePath?: string | null,
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
  return {
    type: 'stdio',
    command: process.execPath,
    args: [
      shim,
      '--browser', 'chromium',
      // 打包态直指随包 headless_shell:playwright 1.49+ 默认 headless 走完整 chromium 的
      // new-headless、不会自动用 headless_shell,故必须显式 --executable-path 指过去,
      // 同时绕过 playwright 按 revision 目录发现浏览器的逻辑。dev 态(null)不加,用本机浏览器。
      ...(headlessShell ? ['--executable-path', headlessShell] : []),
      '--isolated',
      '--caps', 'devtools,network',
      '--viewport-size', '1280,800',
      '--output-dir', evidenceAbs,
      '--save-session',
      // Preload the captured login state (from 测试账号设置) so the AI starts logged in.
      ...(storageStatePath ? ['--storage-state', storageStatePath] : []),
      '--headless',
    ],
    env: {
      ...(process.env as Record<string, string>),
      // Packaged build: process.execPath is Electron → run it as plain node.
      ELECTRON_RUN_AS_NODE: '1',
      // Read by the shim: chdir target + the real CLI to require after chdir.
      AILAB_MCP_CWD: evidenceAbs,
      AILAB_MCP_CLI: cli,
      // 打包态:把浏览器根目录也指过去(executable-path 已直指,这是双保险)。
      ...(headlessShell && process.env.AILAB_RESOURCES_PATH
        ? { PLAYWRIGHT_BROWSERS_PATH: path.join(process.env.AILAB_RESOURCES_PATH, 'ms-playwright') }
        : {}),
    },
  };
}
