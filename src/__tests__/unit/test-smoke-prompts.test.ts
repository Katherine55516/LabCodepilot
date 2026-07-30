/**
 * Unit tests for 冒烟测试的 prompt 变体 (buildStep with taskType: 'smoke').
 *
 * Run with: npx tsx --test src/__tests__/unit/test-smoke-prompts.test.ts
 *
 * 锁三类东西：
 *  1. **分流正确** —— smoke 三步走冒烟 prompt，功能测试任务完全不受影响（零回归）。
 *  2. **口径铁律进了 prompt** —— 数据前缀/数据安全/自主探索/失败不中断/@@OBSERVATION/
 *     结论口径/不出双口径与回归红线。这些是冒烟与功能测试的全部实质差异，漏一条就等于
 *     把冒烟做成了"少几步的功能测试"。
 *  3. **打包态 fallback** —— rules/*.md 在打包 standalone 下被 NFT 剥离，loadRule 返回
 *     null，此时内置精简规则必须仍然包含全部铁律（打包用户拿到的就是它）。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStep } from "../../lib/test/prompts";

const SMOKE = { taskName: "评估机构-冒烟", taskType: "smoke" as const, env: "sit" };
const PREFIX = "冒烟测试_20260730_";

describe("buildStep · smoke 分流", () => {
  it("cases 步走「场景整理」而非用例设计", () => {
    const b = buildStep("cases", SMOKE);
    assert.ok(b.systemPrompt.includes("冒烟测试场景整理员"));
    assert.ok(b.prompt.includes("冒烟测试场景"));
    assert.equal(b.needsPlaywright, false);
    // 绝不能落到功能测试的八维用例设计上
    assert.equal(b.prompt.includes("需求 × 适用维度"), false);
    assert.equal(b.prompt.includes("八类维度"), false);
  });

  it("execution 步走冒烟执行且仍需要 Playwright", () => {
    const b = buildStep("execution", { ...SMOKE, dataPrefix: PREFIX });
    assert.ok(b.systemPrompt.includes("冒烟测试"));
    assert.equal(b.needsPlaywright, true);
  });

  it("report 步走冒烟报告", () => {
    const b = buildStep("report", { ...SMOKE, dataPrefix: PREFIX });
    assert.ok(b.systemPrompt.includes("冒烟测试报告员"));
    assert.ok(b.prompt.includes("冒烟测试报告"));
  });

  it("功能测试任务（无 taskType / functional）行为完全不变——零回归", () => {
    for (const opts of [{ taskName: "登录验证" }, { taskName: "登录验证", taskType: "functional" as const }]) {
      const cases = buildStep("cases", opts);
      assert.ok(cases.systemPrompt.includes("测试用例设计师"));
      assert.equal(cases.systemPrompt.includes("冒烟"), false);
      const exec = buildStep("execution", opts);
      assert.ok(exec.systemPrompt.includes("测试执行工程师"));
      const report = buildStep("report", opts);
      assert.ok(report.systemPrompt.includes("测试报告员"));
      assert.equal(report.systemPrompt.includes("冒烟"), false);
    }
  });

  it("smoke 的 requirement 步回落功能 prompt（冒烟无需求节点，理论上不会走到）", () => {
    const b = buildStep("requirement", SMOKE);
    assert.ok(b.systemPrompt.includes("需求分析师"));
  });
});

describe("smoke execution prompt · 口径铁律", () => {
  const b = buildStep("execution", {
    ...SMOKE,
    dataPrefix: PREFIX,
    baseUrl: "https://sit.example.com/eval",
    moduleEntry: "左侧导航「评估管理」→「评估机构」列表页",
  });

  it("下发数据前缀并要求新建数据带前缀", () => {
    assert.ok(b.prompt.includes(PREFIX));
    assert.ok(b.prompt.includes("新建数据一律带前缀"));
  });

  it("数据安全：只动自建数据、先建再操作、绝不碰存量", () => {
    assert.ok(b.prompt.includes("只针对本次自己新建的数据"));
    assert.ok(b.prompt.includes("必须先自己新建一条再对它操作"));
    assert.ok(b.prompt.includes("绝不动列表里已有的存量数据"));
  });

  it("自主探索：声明场景无预设步骤，先 snapshot 再操作", () => {
    assert.ok(b.prompt.includes("没有预设操作步骤"));
    assert.ok(b.prompt.includes("自主探索"));
    assert.ok(b.prompt.includes("browser_snapshot"));
  });

  it("模块入口被下发（承接 <如何进入该模块> 占位符）", () => {
    assert.ok(b.prompt.includes("左侧导航「评估管理」→「评估机构」列表页"));
  });

  it("@@OBSERVATION 体验观察通道 + 与四态正交的护栏", () => {
    assert.ok(b.prompt.includes("@@OBSERVATION"));
    assert.ok(b.prompt.includes("不要因为发现体验问题就把功能正常的场景判 fail"));
  });

  it("失败不中断 + 依赖场景判 blocked", () => {
    assert.ok(b.prompt.includes("失败场景**不中断**"));
    assert.ok(b.prompt.includes("依赖场景"));
  });

  it("保留既有执行契约：@@CASE_START / @@RESULT / 裸写纪律 / 覆盖自检", () => {
    assert.ok(b.prompt.includes("@@CASE_START"));
    assert.ok(b.prompt.includes("@@RESULT"));
    assert.ok(b.prompt.includes("裸写"));
    assert.ok(b.prompt.includes("覆盖自检"));
  });

  it("保留非交互护栏：禁 AskUserQuestion", () => {
    assert.ok(b.prompt.includes("严禁使用 `AskUserQuestion`"));
  });

  it("保留登录态处理块（三分支之一必现）", () => {
    assert.ok(b.prompt.includes("登录"));
    const withState = buildStep("execution", { ...SMOKE, dataPrefix: PREFIX, hasLoginState: true });
    assert.ok(withState.prompt.includes("storageState"));
    const withCreds = buildStep("execution", {
      ...SMOKE,
      dataPrefix: PREFIX,
      loginCredentials: { username: "qa", password: "p@ss" },
    });
    assert.ok(withCreds.prompt.includes("qa"));
    assert.ok(withCreds.prompt.includes("p@ss"));
  });

  it("不设置 baseUrl 时给出「不要臆造结果」的兜底口径", () => {
    const noUrl = buildStep("execution", { ...SMOKE, dataPrefix: PREFIX });
    assert.ok(noUrl.prompt.includes("不要臆造结果"));
  });

  it("dataPrefix 缺省时用服务端当日值兜底（不会出现 undefined）", () => {
    const noPrefix = buildStep("execution", { taskName: "x", taskType: "smoke" });
    assert.equal(noPrefix.prompt.includes("undefined"), false);
    assert.ok(/冒烟测试_\d{8}_/.test(noPrefix.prompt));
  });
});

describe("smoke report prompt · 结论口径", () => {
  const b = buildStep("report", { ...SMOKE, dataPrefix: PREFIX });

  it("五节结构齐全", () => {
    for (const sec of ["测试环境与执行时间", "场景结果表", "Bug 清单", "奇怪交互 / 体验问题", "整体结论"]) {
      assert.ok(b.prompt.includes(sec), `缺少报告章节：${sec}`);
    }
  });

  it("结论回答两件事：主流程通不通 + 能否进入下一阶段", () => {
    assert.ok(b.prompt.includes("主流程是否通过冒烟"));
    assert.ok(b.prompt.includes("是否具备进一步测试"));
  });

  it("有 fail 即未通过；有 blocked 无 fail 不得报「通过」", () => {
    assert.ok(b.prompt.includes("即判「**未通过**」"));
    assert.ok(b.prompt.includes("不要报"));
    assert.ok(b.prompt.includes("判「未完成」"));
  });

  it("Bug 清单结构化字段齐全（供 UI 解析成可复核列表）", () => {
    for (const f of ["编号", "标题", "严重级别", "关联场景", "实际", "预期", "接口", "证据"]) {
      assert.ok(b.prompt.includes(`**${f}**`), `Bug 清单缺字段：${f}`);
    }
    assert.ok(b.prompt.includes("致命 / 严重 / 一般 / 建议"));
    assert.ok(b.prompt.includes("仅 `fail` 状态的场景产出 Bug"));
  });

  it("不出需求覆盖矩阵 / 双口径通过率 / 回归红线", () => {
    assert.ok(b.prompt.includes("**不出**需求覆盖矩阵"));
    assert.ok(b.prompt.includes("**不出**双口径通过率"));
    assert.ok(b.prompt.includes("**不出**回归集红线"));
  });

  it("四态以 run.json 为准、时间用 run.json 的 time", () => {
    assert.ok(b.prompt.includes("不得自行重算"));
    assert.ok(b.prompt.includes("不要用当前时间"));
  });

  it("守 QA 边界：禁修复方案 / 发布决策 / 优先级 / 指派", () => {
    assert.ok(b.prompt.includes("禁止**写 bug 修复方案"));
    assert.ok(b.prompt.includes("指派责任人"));
  });

  it("消费 run.json 的 observations 渲染体验问题节", () => {
    assert.ok(b.prompt.includes("observations"));
    assert.ok(b.prompt.includes("这些不是缺陷"));
  });
});

describe("smoke cases prompt · 以用户录入为准", () => {
  const b = buildStep("cases", SMOKE);

  it("只审不改：禁改写含义 / 禁臆造 / 禁增删场景", () => {
    assert.ok(b.prompt.includes("以用户录入为准"));
    assert.ok(b.prompt.includes("绝不臆造"));
    assert.ok(b.prompt.includes("绝不新增用户没写的场景"));
    assert.ok(b.prompt.includes("绝不删除用户写了的场景"));
  });

  it("禁止补边界 / 异常 / 权限场景（范围裁剪是刻意的）", () => {
    assert.ok(b.prompt.includes("不要补充边界 / 异常 / 权限"));
    assert.ok(b.prompt.includes("刻意的范围裁剪"));
  });

  it("保护 tags 空数组与 verification 功能验证两条落盘铁律", () => {
    assert.ok(b.prompt.includes("必须保持空数组"));
    assert.ok(b.prompt.includes("必须保持「功能验证」"));
    assert.ok(b.prompt.includes("回归用例库"));
  });

  it("产出问题走「审核提醒」交用户裁定", () => {
    assert.ok(b.prompt.includes("审核提醒"));
  });
});

describe("打包态 fallback（rules/*.md 被 NFT 剥离时）", () => {
  it("内置精简规则包含全部 7 条全局铁律", () => {
    // loadRule 读 process.cwd()/src/lib/test/rules/*.md；改 cwd 到临时目录即模拟打包态
    // （standalone 的 outputFileTracingExcludes 会剥掉 **/*.md）。
    const orig = process.cwd();
    try {
      process.chdir("/");
      const b = buildStep("execution", { ...SMOKE, dataPrefix: PREFIX });
      // 走到 fallback 分支（未加载到规范文件）
      assert.ok(b.prompt.includes("未找到《冒烟测试规范》"));
      for (const rule of ["【范围】", "【数据可识别】", "【数据安全", "【自主执行】", "【判定原则】", "【失败不中断】", "【截图】", "【体验观察】"]) {
        assert.ok(b.prompt.includes(rule), `fallback 缺铁律：${rule}`);
      }
      // fallback 里也必须带上真实前缀，不能是占位符
      assert.ok(b.prompt.includes(PREFIX));
    } finally {
      process.chdir(orig);
    }
  });

  it("dev 态（规则文件可读）走完整规范文件", () => {
    const b = buildStep("execution", { ...SMOKE, dataPrefix: PREFIX });
    assert.ok(b.prompt.includes("<冒烟测试规范>"));
    assert.equal(b.prompt.includes("未找到《冒烟测试规范》"), false);
  });
});
