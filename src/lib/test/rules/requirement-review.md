---
name: requirement-review
description: Evaluates software requirement documents (PRDs, user stories, change requests) for test-readiness before they enter an automated test generation pipeline. Use this skill whenever a requirement is submitted to the AI testing platform and needs quality assessment, or when the user asks to "review", "score", "check quality of", or "assess testability of" a requirement document. Scores across four dimensions (clarity, completeness, testability, atomicity), identifies issues with verbatim quotes from the source, suggests concrete improvements, and outputs a structured JSON verdict including whether human escalation is needed. Apply this any time the input contains requirement text, acceptance criteria, user stories, feature specifications, or change descriptions intended for downstream test case generation.
---

# 需求评审 Skill（requirement-review）

## 用途

对软件需求文档（PRD、用户故事、变更说明）做质量评审，判断它是否达到"可被自动化测试平台消费"的标准。输出结构化的多维度评分、具体问题清单、改进建议，以及是否需要升级到人工评审的判断。

本 skill 是 AI 测试平台的"需求评审三层机制"中的**第二层（LLM 质量评分）**。第一层（结构化校验）由确定性程序完成，第三层（人工评审）由人完成。本 skill 不替代任何一层。

## 何时使用

满足下列任一情况时使用：

- AI 测试平台收到一份新需求，准备进入测试用例生成流程之前
- 系统或用户请求"评估这份需求的可测试性"
- 输入包含验收条件、用户故事、功能描述、变更说明
- 需要判断需求是否需要升级到人工评审

**注意**：本 skill 不评估业务正确性（"这个需求该不该做"），只评估**可测试性**（"这个需求能不能被转化为可执行的测试"）。

## 输入

**主输入**：

- `requirement_text` (required)：需求文档全文，可以是 Markdown、纯文本或结构化的 PRD

**可选上下文**（影响人工评审触发判断）：

- `is_first_submission` (default: false)：该团队是否首次向平台提交需求
- `is_high_risk_module` (default: false)：是否涉及项目配置中标记的高风险模块（支付、权限、数据修改等）
- `previous_review_rejected` (default: false)：上一次评审是否被退回但本次未采纳反馈

## 评审维度

按以下 4 个维度逐项评分（每项 0-25 分，合计 0-100）：

### 1. 清晰度（Clarity, 0-25 分）

**判断标准**：需求文本中是否存在歧义术语、模糊描述、主观判断。

**典型扣分项**：

- 模糊形容词：好的、友好的、快速的、合理的、简单的、流畅的
- 含义不明的指代：未明确的"它"、"那个"、"相关的"、"对应的"
- 主观判断：用户体验好、看起来美观、操作直观
- 未定义的业务术语：使用专有名词但未给上下文
- 缺失的数量词：多个、少量、经常、偶尔、大量

**对照样例**：

- 优秀："用户点击'提交'按钮后，3 秒内显示确认页面"
- 问题："用户提交订单后，快速显示确认页面" — "快速"无法量化

### 2. 完整度（Completeness, 0-25 分）

**判断标准**：验收条件是否覆盖正常流程、异常流程、边界情况。

**典型扣分项**：

- 只有 happy path，未提及异常分支（重扣，8-10 分）
- 没有指明前置条件 / 后置条件（3-5 分）
- 没有指明涉及的角色 / 权限（3-5 分）
- 没有指明数据约束（最大长度、格式要求等）（3-5 分）
- 没有指明非功能性约束（性能、并发等，可选项，0-3 分）

**最低要求**：至少包含 1 个正向路径 + 1 个异常路径。

### 3. 可测试性（Testability, 0-25 分）

**判断标准**：每条验收条件能否转化为具体的测试动作（点击、输入、断言）。

**典型扣分项**：

- 无法转为具体动作（如"系统应该高效"，每条扣 5-8 分）
- 无可观察的期望结果（如"用户感到满意"，每条扣 5-8 分）
- 涉及不可自动化的部分（视觉美观、交互流畅性）且未说明可豁免（3-5 分）

**好的验收条件特征**（GIVEN-WHEN-THEN 结构）：

- GIVEN：触发条件清晰（前置状态、数据）
- WHEN：操作明确（动作、输入）
- THEN：期望结果可观察（UI 状态、数据变化、API 响应）

### 4. 原子性（Atomicity, 0-25 分）

**判断标准**：是否一份文档只描述一个独立的功能 / 变更。

**典型扣分项**：

- 一份文档涉及多个独立功能（10-15 分）
- 涉及的页面/模块过多且关联性弱（5-10 分）
- 验收条件之间相互矛盾（5-10 分）

## 输出格式

严格按以下 JSON 格式输出。**不要添加任何前后缀文本、Markdown 代码块标记或解释性文字**。直接输出可被 `JSON.parse` 解析的字符串。

```json
{
  "overall_score": 75,
  "verdict": "pass_with_notes",
  "needs_human_review": false,
  "dimensions": {
    "clarity": {
      "score": 20,
      "issues": [
        {
          "quote": "原文中的具体引用",
          "problem": "问题描述",
          "suggestion": "建议改进"
        }
      ]
    },
    "completeness": {
      "score": 18,
      "issues": []
    },
    "testability": {
      "score": 22,
      "issues": []
    },
    "atomicity": {
      "score": 25,
      "issues": []
    }
  },
  "escalation_triggers": [],
  "summary": "总体评价的简短文字（1-2 句）"
}
```

### 字段说明

- `overall_score`：4 个维度分数之和（0-100）
- `verdict`：三选一
  - `"pass"`：≥ 80 分且无关键问题，可直接进入测试生成
  - `"pass_with_notes"`：60-79 分，有非阻塞问题，进入流程但标注覆盖度有限
  - `"reject"`：< 60 分，或有阻塞性问题（如完全无验收条件），退回修订
- `needs_human_review`：是否需要升级人工评审（boolean）
- `dimensions`：每个维度的详细评分和问题列表
- `escalation_triggers`：触发人工评审的具体原因（字符串数组，可能为空）
- `summary`：给提交者看的简短总结，2 句以内

### 升级人工评审的触发规则

`needs_human_review = true` 当满足任一：

| 触发条件 | escalation_triggers 中的标识 |
|---|---|
| `overall_score < 70` | `"total_score_below_70"` |
| 任一维度分数 `< 10` | `"dimension_below_10:<dimension_name>"` |
| 输入上下文 `is_high_risk_module = true` | `"high_risk_module"` |
| 输入上下文 `is_first_submission = true` | `"first_submission"` |
| 输入上下文 `previous_review_rejected = true` | `"previous_rejection_not_addressed"` |
| 验收条件少于 2 条 | `"fewer_than_2_acceptance_criteria"` |

## 关键约束

### 1. 不允许编造问题（最重要）

每个问题必须包含 `quote` 字段，引用需求文档中的**原文片段**。如果找不到原文支撑，**不要写这个问题**。

错误示例：

```json
{
  "quote": "（推断）用户可能会困惑",
  "problem": "..."
}
```

正确示例：

```json
{
  "quote": "用户点击后页面会有合适的反应",
  "problem": "'合适的反应'未定义具体行为",
  "suggestion": "明确反应类型：是 toast 提示、跳转还是弹窗？"
}
```

### 2. 不允许补充需求文档中没有的内容

如果需求未提到"权限校验"，**不要建议**加入权限校验——这超出了评审范围，是产品决策。可以指出"未说明权限要求"作为完整度扣分，但不要假设系统需要权限校验。

### 3. 不允许做业务判断

不评价"这个需求该不该做"、"这个设计合不合理"、"这个功能有没有价值"。只评价"这个需求能不能被测试"。

### 4. 没问题就老实说没问题

如果某个维度的需求写得很好，没什么问题，就输出 `"issues": []`。**不要为了显得勤勉而强行挑刺**。低质量的反馈比没有反馈更糟。

### 5. 一律使用 quote 原文，不要改写

`quote` 字段必须是需求文档中的**逐字引用**，不允许做任何"善意的改写"。如果原文有错别字也要保留。

## 工作流程

1. 解析输入（`requirement_text` + 可选上下文）
2. 按 4 个维度逐项评估，找出问题并定位原文 quote
3. 计算各维度分数和总分
4. 根据规则判断 verdict 和 `needs_human_review`
5. 组装 `escalation_triggers` 列表
6. 输出严格符合 schema 的 JSON
7. **填充需求完整性矩阵**（见下节，本 skill 在 AI_LabTest 流程中的扩展职责）
8. **主动陈述不足**（见 7.3 节，**强制**：评分后必须列出每个扣分项，不等用户问）
9. **执行强制用户交互**（见下节）

---

## 在 AI_LabTest 6 步流程中的扩展职责

本 skill 在独立使用时（如外部 LLM 测试平台调用）仅输出 JSON 评分。
在 `/AI_LabTest/rules/test-workflow.md` 步骤 3 中使用时，**额外**承担以下职责：

### 7.1 填充需求完整性矩阵

对每个 `REQ-{模块}-{编号}`，按 `requirement-completeness.md` 第 3.1 节填写覆盖矩阵：

```
需求：REQ-{模块}-{编号}

| 路径类型     | 已覆盖? | 评审人意见       |
|-------------|--------|-----------------|
| 正常路径     | ?      | ...              |
| 空/无输入    | ?      | ...              |
| 无效输入     | ?      | ...              |
| 边界值       | ?      | ...              |
| 错误反馈     | ?      | ...              |
| 状态恢复     | ?      | ...              |
```

如需求触及鉴权 → 补 `未认证访问 / 权限级别 / 会话过期` 维度。
如需求触及数据生命周期 → 补 `数据加载 / 空数据 / 数据刷新` 维度。

**强制约束（高风险组合维度 — 判定表 / 状态迁移）**：

自动扫描需求文本，命中以下信号即追加对应维度；`is_high_risk_module = true` 时无条件审视这两类。

| 维度 | 命中信号 |
|---|---|
| **判定表** | 「当 A 且 B」「根据 / 视…而定」「不同 {角色 / 状态 / 类型 / 套餐} 下」；或同一结果（按钮可用性 / 价格 / 可见性 / 跳转目标）被 ≥2 个独立条件决定 |
| **状态迁移** | 状态字段（订单 / 审核 / 启用状态）、流转动词（提交 / 审批 / 取消 / 上下架）、「处于 X 状态时不可 Y」 |

命中后，在覆盖矩阵之后追加对应表：

**① 判定表**（多条件组合 × 预期结果）

| 规则 | 条件1 | 条件2 | … | → 预期结果 | 需求是否说明 |
|---|---|---|---|---|---|
| R1 | … | … | | … | ✅ / ❌需求未说 → 追问 |

- **组合策略**：默认 **pairwise**（两两覆盖，避免组合爆炸）；涉及**金额 / 权限提升 / 不可逆操作 / 安全边界**的组合为**关键组合**，即使 pairwise 未抽中也强制单独成行。`is_high_risk_module = true` 时扩大「关键」范围。
- 任一「❌需求未说」的关键组合 = 完整度缺口 → §7.2 追问。
- 落地到用例时进「业务规则」覆盖维度（见 `test-case-completeness.md §2.1`）。

**② 状态迁移矩阵**（起态 × 操作 → 止态 / 是否允许）

| 起态＼操作 | 操作A | 操作B |
|---|---|---|
| 状态1 | →状态2 ✅ | ✗非法 |
| 终态 | ✗非法必拒 | ✗ |

- 每个 `✗非法` 格必须有用例验证「操作被拒、状态不变」；落地到用例时进「状态转换」覆盖维度（见 `test-case-completeness.md §2.1`）。
- **非法迁移预期分两层**：
  - **有不可逆 / 安全后果**（涉退款 / 发货 / 权限变更）→ 需求未定义如何拒绝时**必须 §7.2 追问产品**，补全后才生成功能验证用例；未补标 MISSING
  - **纯防御性**（重复操作、终态→任意操作）→ 不逐个追问，按通用安全默认生成**回归基线**用例（断言「被拒、无副作用」，标 `oracle = 现状锁定`，见 `test-case-completeness.md §1.6`）

**评分影响**：判定表存在「需求未说」的关键组合、或状态机存在「未定义处理」的有后果非法迁移 → 扣**完整度**（每类缺口扣 5–8，计入 completeness 维度；扣完整度而非可测试性 —— 本质是「需求没说清各场景预期」）。

**强制约束（鉴权类需求 — 多角色行为差异）**：

评审需求时如发现该需求涉及多角色行为差异（如「admin 可见 X，user 不可见 X」「不同角色看到的列表范围不同」），**必须**在评审备注中明确要求：

- 用例设计阶段（Step 4）按 `test-case-completeness.md §8.2 会话隔离` 实现独立 `storageState`，每个账号一份
- 用例采用**同路径比较**：相同筛选 + 相同关键字 + 相同操作步骤，对比两账号的可观察差异（菜单 / 按钮 / 列表数量 / 下拉范围 / 默认值 / 导出范围）
- **禁止**用例文档出现「因为是 admin 所以能 X」这种基于角色名的推断 —— 必须用实际操作验证

**评分影响**：缺失上述任一项 → 「可测试性」维度扣分（每缺一项扣 5，封顶扣到该维度 ≤ 10）。

任何「?」即为缺口（MISSING），进入下节交互。

### 7.2 强制用户交互协议

**触发条件（任一即触发）**：

| 触发条件 | 必须发起的交互 |
|---------|--------------|
| `verdict = "reject"`（总分 < 60 或致命缺失） | 「这份需求被评为 reject，原因 X。是否：(a) 退回修订 (b) 跳过该需求 (c) 继续但标注风险？」 |
| 任一维度 `score < 10` | 「{维度名}维度分数过低（{score}/25），具体问题：{quotes + suggestions}。请补充澄清后我重新评审。」 |
| 覆盖矩阵中存在 `MISSING` | 「需求 {REQ-ID} 缺少 {维度} 的描述：当 {场景} 时应该发生什么？」 |
| `escalation_triggers` 非空且 `needs_human_review=true` | 「以下原因建议人工评审：{triggers}。是否继续 AI 自动处理？」 |

**交互规则**：
1. 一次只问一个清晰问题，等用户回答后再问下一个
2. 不要假设用户意图——所有「应该这样吧」必须落到具体确认
3. 用户的每次回答都要更新到需求文档中（追加章节，标注「评审补充」）
4. 全部缺口闭合后，输出最终的 `{模块}-review.json` + 更新后的 `{模块}-requirement.md`

### 7.3 主动陈述不足（强制 — 不等用户问）

完成评分后，**必须**在向用户呈现 verdict 之前/之时，明确列出每个扣分项。**禁止只报总分让用户自己问「为什么扣了 X 分」**。

呈现格式（陈述式 Markdown 表格）：

```markdown
## 评分明细（共扣 {N} 分）

### 维度 1：清晰度 {score}/25（扣 {25-score} 分）

| 扣分点 | 原文证据 | 扣分理由 | 可修复? |
|---|---|---|---|
| ... | ... | ... | ✅ / ❌ |

### 维度 2：完整度 {score}/25（扣 {25-score} 分）
... 同上 ...

### 维度 3：可测试性 {score}/25（扣 {25-score} 分）
...

### 维度 4：原子性 {score}/25（扣 {25-score} 分）
...

## 修复后理论最高分
若接受全部「可修复」项的修改，最高分可达 **{X}**（剩余 {Y} 分为有意 SKIP / 不可消除的取舍）。
```

**每一个扣分项必须**：
- 引用具体 REQ-ID 或原文 quote（不允许「整体感觉不够清晰」这种模糊话）
- 标注「可修复 (✅)」或「有意取舍 (❌)」
- 列出可修复项的具体修改建议

### 7.4 评审用户门控（陈述完不足后）

呈现完扣分明细后，再问用户决定：

> 评分 {总分}/100（verdict={pass/pass_with_notes/reject}），共扣 {N} 分。
>
> 如何推进？
> - 接受当前评分，进 Step 4
> - 修全部可修复项后重评（理论可达 {X} 分）
> - 仅修原子性 / 仅修措辞（部分修复）

### 7.5 评审产物

存放到 `/AI_LabTest/requirements/`：

| 文件 | 内容 |
|------|------|
| `{模块}-review.json` | 本 skill 输出的 JSON 评分 |
| `{模块}-requirement.md`（更新） | 追加「## 评审补充」章节，记录用户对每个缺口的回答 |
| `{模块}-coverage-matrix.md` | 覆盖矩阵快照 |

---

## 与既有规则的关系

- 评分逻辑（4 维度、quote、escalation_triggers）：保持本文档 1-5 节定义不变
- 完整性维度（正常/空/无效/边界/错误/恢复）：见 `requirement-completeness.md`
- 用户交互门控：见 `test-workflow.md` 步骤 3

---

## 评分校准示例

### 示例 1：高质量需求

**输入**：

```
功能：用户取消订单

前置条件：用户已登录，且订单状态为"待支付"或"待发货"

验收条件：
1. 在订单详情页，"取消订单"按钮可见且可点击
2. 点击按钮后，弹出二次确认弹窗，文字为"确认取消订单？取消后无法恢复"
3. 用户点击弹窗"确认"后，调用 API DELETE /api/orders/{id}，等待响应
4. API 返回 200 时，订单状态更新为"已取消"，页面显示绿色 toast "订单已取消"
5. API 返回 4xx/5xx 时，显示红色 toast "取消失败，请稍后重试"，订单状态不变
6. 用户点击弹窗"取消"按钮或关闭弹窗时，不做任何操作

异常情况：
- 订单状态非"待支付"/"待发货"时，按钮置灰且不可点击
- 网络超时（>10秒）按 API 失败处理

涉及页面：订单详情页 /orders/:id
涉及 API：DELETE /api/orders/{id}
权限要求：订单所属用户

非功能性：取消操作整体响应时间 ≤ 3 秒
```

**输出**：

```json
{
  "overall_score": 95,
  "verdict": "pass",
  "needs_human_review": false,
  "dimensions": {
    "clarity": {"score": 24, "issues": []},
    "completeness": {"score": 24, "issues": []},
    "testability": {"score": 24, "issues": []},
    "atomicity": {"score": 23, "issues": []}
  },
  "escalation_triggers": [],
  "summary": "需求质量优秀，验收条件完整、可测试性强，可直接进入测试生成流程"
}
```

### 示例 2：低质量需求

**输入**：

```
做一个会员中心，要让用户能管理自己的信息，体验要好，最好支持各种操作。
```

**输出**：

```json
{
  "overall_score": 12,
  "verdict": "reject",
  "needs_human_review": true,
  "dimensions": {
    "clarity": {
      "score": 3,
      "issues": [
        {
          "quote": "体验要好",
          "problem": "'体验要好'无法量化，不可测试",
          "suggestion": "明确具体指标：响应时间、加载时间、操作步数等"
        },
        {
          "quote": "支持各种操作",
          "problem": "'各种操作'未明确列举",
          "suggestion": "列举具体操作：修改头像、修改密码、修改昵称等"
        }
      ]
    },
    "completeness": {
      "score": 2,
      "issues": [
        {
          "quote": "做一个会员中心",
          "problem": "未提供任何验收条件、前置条件、异常分支",
          "suggestion": "至少补充：核心功能列表、每个功能的验收条件、异常处理"
        }
      ]
    },
    "testability": {
      "score": 2,
      "issues": [
        {
          "quote": "让用户能管理自己的信息",
          "problem": "未指明具体可执行动作和可观察结果",
          "suggestion": "改为 GIVEN-WHEN-THEN 结构，例如：GIVEN 用户已登录，WHEN 用户点击'修改昵称'并输入新昵称，THEN 个人中心页显示新昵称"
        }
      ]
    },
    "atomicity": {
      "score": 5,
      "issues": [
        {
          "quote": "支持各种操作",
          "problem": "暗示包含多个独立功能，应拆分为独立需求",
          "suggestion": "按功能拆分：'修改昵称'、'修改密码'、'修改头像'各自单独提需求"
        }
      ]
    }
  },
  "escalation_triggers": [
    "total_score_below_70",
    "dimension_below_10:clarity",
    "dimension_below_10:completeness",
    "dimension_below_10:testability",
    "dimension_below_10:atomicity",
    "fewer_than_2_acceptance_criteria"
  ],
  "summary": "需求过于模糊，无可测试条目，建议重新撰写：明确功能边界、列出验收条件、按 GIVEN-WHEN-THEN 结构组织"
}
```

### 示例 3：中等质量需求

**输入**：

```
功能：用户修改头像

用户在个人中心点击头像，可以上传新头像。上传成功后头像更新。
```

**输出**：

```json
{
  "overall_score": 55,
  "verdict": "reject",
  "needs_human_review": true,
  "dimensions": {
    "clarity": {
      "score": 18,
      "issues": []
    },
    "completeness": {
      "score": 10,
      "issues": [
        {
          "quote": "用户在个人中心点击头像，可以上传新头像",
          "problem": "未说明文件格式限制、文件大小限制、上传失败的处理",
          "suggestion": "补充：支持的格式（如 jpg/png）、最大文件大小、超限提示文案、上传失败提示"
        },
        {
          "quote": "上传成功后头像更新",
          "problem": "未说明前置权限（是否需要登录）、未说明跨设备同步行为",
          "suggestion": "补充前置条件（已登录），明确是否需要刷新页面、多端是否实时同步"
        }
      ]
    },
    "testability": {
      "score": 12,
      "issues": [
        {
          "quote": "可以上传新头像",
          "problem": "'可以上传'描述能力，不是可测试的动作步骤",
          "suggestion": "拆解为具体步骤：点击头像 -> 弹出文件选择器 -> 选择文件 -> 显示预览 -> 点击确认 -> 显示加载状态 -> 显示成功提示"
        }
      ]
    },
    "atomicity": {
      "score": 15,
      "issues": []
    }
  },
  "escalation_triggers": [
    "total_score_below_70"
  ],
  "summary": "功能边界清晰但验收条件粗糙，缺少异常分支和具体步骤，建议按 GIVEN-WHEN-THEN 重写后再提交"
}
```

### 示例 4：高质量但涉及高风险模块

**输入**：（同示例 1，但调用方传入 `is_high_risk_module = true`，因为"取消订单"涉及订单状态变更）

**输出**（与示例 1 主体相同，但 `needs_human_review` 和 `escalation_triggers` 不同）：

```json
{
  "overall_score": 95,
  "verdict": "pass",
  "needs_human_review": true,
  "dimensions": {
    "clarity": {"score": 24, "issues": []},
    "completeness": {"score": 24, "issues": []},
    "testability": {"score": 24, "issues": []},
    "atomicity": {"score": 23, "issues": []}
  },
  "escalation_triggers": [
    "high_risk_module"
  ],
  "summary": "需求质量优秀，但涉及高风险模块（订单状态变更），按策略需人工复审"
}
```

注意：高质量需求仍可被标记为需要人工评审——评分和评审触发是两个独立维度。

---

## 最重要的一句话

如果你不确定一个问题该不该报告：**没有原文 quote 支撑就不报**。宁可漏报也不要凭空发挥。这个 skill 的所有价值都建立在"评审基于事实"的前提上。
