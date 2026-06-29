# AI_LabTest — Claude Code 插件版

把根目录 `framework/` + `commands/` 那套「3 步 QA 自动化测试方法论」打包成一个**可安装的 Claude Code 插件**。方法论本体（`rules/`）随插件分发，6 个 slash 命令 + 1 个自动触发技能驱动整个流程。Playwright MCP 由插件**自动注册**，无需逐项目改 `.mcp.json`。

> **V0.12**：Step 3 **默认只产 2 份报告**——主报告（仅 概要 + 执行矩阵）+ 独立缺陷报告（仅未通过用例）；其余主报告章节与 历史归档/latest/多任务/XLSX/DOCX 暂不默认生成。
> **V0.10**：用户**上传**测试用例时以上传为准——AI 只**审核**不改写、把不合适处列「审核提醒」交用户决定是否修改（不臆造 预期依据、不新增用例）。
> **V0.8**：Step 3 出**执行矩阵**（用例 12 列 + 执行 5 列：实际结果/执行状态/证据/录像/失败·阻塞原因，与用例一一对应）+ **独立缺陷报告**（仅未通过用例，fail 进正文 / partial·blocked 进附录）。
> **V0.7**：Step 1 用例产物统一为**单个 Markdown 表格**（`testCase/{任务}-testcase.md`，12 列）；不再出 JSON / Excel。
> **V0.6**：Step 1 用例设计输入来源增至三种，新增「依据会话内容生成需求文档」（AI 回溯本轮对话提炼→落盘 `testCase/{任务}-requirement.md`→用户确认→设计用例，预期依据逐条判定）。
> **V0.4**：剔除「代码库分析 / 需求分析 / 需求评审」三步。用例设计直接以用户提供的需求文档或现成用例为输入，流程由 6 步精简为 **3 步**（用例设计 → 执行 → 报告）。

> 本插件是对仓库内框架的**等价封装**，不改动 `framework/`、`commands/`、`scripts/`、`app/` 等原有产物。

---

## 安装

### 方式 A — 从 GitHub 安装（推荐给所有用户）

在 Claude Code 会话里依次执行两条命令：

```text
/plugin marketplace add qitianersheng/ai-lab-test-agent
/plugin install ai-lab-test@ai-lab-test-marketplace
```

第 1 条把本仓库注册为「插件市场」（marketplace），第 2 条从该市场安装 `ai-lab-test` 插件（`@` 后面是市场名，不是仓库名）。装完按提示 `/reload-plugins` 或重启即可生效。

> 也可用 CLI 形式（适合脚本/CI）：
> ```bash
> claude plugin marketplace add qitianersheng/ai-lab-test-agent
> claude plugin install ai-lab-test@ai-lab-test-marketplace
> ```

### 方式 B — 本地市场安装（离线 / 二次开发）

```text
/plugin marketplace add /绝对路径/ai-lab-test    # 仓库根目录下有 .claude-plugin/marketplace.json
/plugin install ai-lab-test@ai-lab-test-marketplace
```

### 方式 C — 本地直接挂载（改插件本身时最快）

```bash
claude --plugin-dir /绝对路径/ai-lab-test
# 改动后无需重启：在会话里 /reload-plugins
```

安装后插件启用，`playwright` MCP 自动注册，命令以 `/ai-lab-test:<name>` 形式出现，`test-workflow` 技能可被自然语言触发。

---

## 更新

插件作者每次 **bump `version` 字段 → 提交 → push** 后，用户可以这样拿到新版本：

### 用户侧 — 手动更新

```text
/plugin marketplace update ai-lab-test-marketplace   # 从 GitHub 重新拉取市场（含新版本）
/reload-plugins                                       # 应用变更（或重启 Claude Code）
```

省略市场名（`/plugin marketplace update`）则刷新全部市场。在 `/plugin` 菜单的 Marketplaces 标签页也能看到/触发更新。

### 用户侧 — 开启自动更新（一次设置，后续无感）

第三方市场默认**不**自动更新。用户在 `/plugin` 菜单的 Marketplaces 标签页把本市场的 auto-update 打开，或在 settings.json 中声明：

```json
{
  "extraKnownMarketplaces": {
    "ai-lab-test-marketplace": {
      "source": { "source": "github", "repo": "qitianersheng/ai-lab-test-agent" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "ai-lab-test@ai-lab-test-marketplace": true
  }
}
```

开启后，Claude Code **每次启动**会自动拉取市场并更新已装插件。

### 作者侧 — 发布新版本的标准动作

1. 改代码 / 规则 / 命令。
2. 把 `.claude-plugin/plugin.json` 里的 `version` 升一级（如 `0.3.0 → 0.4.0`，遵循 semver）。版本以 **plugin.json 为唯一来源**，`marketplace.json` 无需重复维护版本号。
3. 建议同步更新 `CHANGELOG`（若有）。
4. `git commit` 后 `git push`。

> Claude Code 通过 `version` 字段的变化判断「有新版本」。只要版本号变了，用户 `/plugin marketplace update` 或自动更新就会拉到新版；版本号不变则视为无更新。

---

## 命令对照（原框架 → 插件）

| 原框架 | 插件 | 步骤 |
|---|---|---|
| `/ai-lab-test`（主入口） | `/ai-lab-test:test-workflow`（技能，亦可自然语言触发） | 主流程 |
| `/ai-lab-test-cases` | `/ai-lab-test:cases` | Step 1 |
| `/ai-lab-test-execute` | `/ai-lab-test:execute` | Step 2 |
| `/ai-lab-test-report` | `/ai-lab-test:report` | Step 3 |
| `/ai-lab-test-status` | `/ai-lab-test:status` | 工具 |
| `scripts/install.sh`（项目配置部分）+ `/ai-lab-install` | `/ai-lab-test:init` | 初始化 |
| `framework/rules/system_knowledge_map.md` | `/ai-lab-test:knowledge-map` | 附加 |

> **V0.4 剔除**：原 `analyze`（代码库分析）/ `requirements`（需求分析）/ `review`（需求评审）三个命令及其规则文件已移除，不再提供。

> **命名说明**：Claude Code 插件命令**强制带命名空间**（`/<插件名>:<命令>`），无法做出裸 `/ai-lab-test`。这是插件机制决定的唯一不可消除差异（见下「差异与限制」）。

---

## 典型用法

```text
# 首次在某项目使用
/ai-lab-test:init            # 建 AI_LabTest/ 目录 + 渲染 environments.json + 初始化 site-patterns（会问选哪种模式，见下）
/ai-lab-test:test-workflow   # 顺序走完 3 步（或直接说「帮我测试登录模块」自动触发）

# 增量补测某功能（把需求文档/现成用例给到用例设计步，或选「依据会话内容生成需求文档」；任务名自动生成，无需录入模块名）
/ai-lab-test:cases               # 据需求自动生成任务名（语义优先、时间戳兜底，如 登录）；也可显式传名覆盖
/ai-lab-test:execute 登录        # 用上一步生成的任务名（或 all）
/ai-lab-test:report 登录

# 查看进度
/ai-lab-test:status
```

产物落在**项目内** `AI_LabTest/`（`testCase/` `report/` `site-patterns/`），V0.4 起不再生成 `analysis/`、`requirements/`（代码库分析 / 需求分析 / 需求评审三步已剔除）。

---

## 两种初始化模式（`/ai-lab-test:init` 会让你选）

| | **模式 A · 纯插件（推荐默认）** | **模式 B · 完全复刻原框架** |
|---|---|---|
| 产物目录 + environments.json + site-patterns + AI_LabTest/README.md + .gitignore | ✅ | ✅ |
| 规则文件位置 | `${CLAUDE_PLUGIN_ROOT}/rules/`（随插件，按需 Read） | 额外复制到项目 `AI_LabTest/rules/` |
| `AI_LabTest/CLAUDE.md`（QA 角色 + 3 步入口约束文档） | 不落地（内容已在 `test-workflow` 技能里） | 渲染到项目 `AI_LabTest/CLAUDE.md` |
| 项目根 `CLAUDE.md` | **不动** | 追加一行 `@AI_LabTest/CLAUDE.md`（原内容不动） |
| 自然语言触发 | 技能描述匹配（可靠但非 100% 常驻） | **常驻上下文**，与原框架**完全一致** |
| 适合 | 想要干净插件、不污染项目 | 想要与原 `install.sh` **逐文件、逐行为一致** |

> 想要「工作流程与原框架 100% 一致（含常驻上下文触发）」就选**模式 B**——它产出与原 `scripts/install.sh` 逐文件相同的项目布局。代价是项目里多出规则副本（插件升级后重跑 `/ai-lab-test:init` 同步）+ 根 `CLAUDE.md` 多一行 import。

---

## 目录结构

```
plugin/
├── .claude-plugin/
│   └── marketplace.json          # 本地市场清单
└── ai-lab-test/
    ├── .claude-plugin/
    │   └── plugin.json            # 插件清单
    ├── .mcp.json                  # Playwright MCP 自动注册
    ├── README.md                  # 本文件
    ├── skills/
    │   └── test-workflow/
    │       └── SKILL.md           # 主流程 + 自然语言触发（= 原 CLAUDE.md 注入 + /ai-lab-test 主入口）
    ├── commands/                  # 6 个 slash 命令（cases/execute/report/status/init/knowledge-map）
    ├── rules/                     # 方法论本体（5 个 .md：test-workflow/test-case-completeness/test-execution/test-report/system_knowledge_map）
    ├── site-patterns/_template.md # 站点经验骨架（init 时初始化进项目）
    └── templates/                 # init 时渲染/复制进项目的源文件：
                                   #   environments.json.template / gitignore.snippet / playwright.config.ts.template
                                   #   CLAUDE.md.template（仅模式 B 渲染为 AI_LabTest/CLAUDE.md）
                                   #   AI_LabTest-README.md（复制为项目内 AI_LabTest/README.md）
```

`rules/` 现为 **5 个文件**（V0.4 剔除代码库分析 / 需求分析 / 需求评审三步后，删去 `codebase-analysis.md` / `requirement-discovery.md` / `requirement-review.md` / `requirement-completeness.md`）。保留的判定标准（四态、用户门控、覆盖矩阵、可追溯、终态原则）与原框架一致；命令体按插件机制做了两处机械改写：① 规则引用路径 `/AI_LabTest/rules/X.md` → `${CLAUDE_PLUGIN_ROOT}/rules/X.md`；② 跨命令引用 `/ai-lab-test-x` → `/ai-lab-test:x`。

---

## 与原框架的差异与限制（请务必知晓）

下面列出**所有**「插件机制无法 100% 复刻原框架」的点。绝大多数是**机制不同、行为等价**；个别是真正的差异，已逐条标注。

### 1. 命令命名空间（不可消除的差异）
插件命令强制为 `/ai-lab-test:<name>`，做不出裸 `/ai-lab-test`。功能与产物完全一致，仅调用前缀不同。已在上面对照表与技能里把所有跨命令指引同步成新前缀。

### 2. 自然语言触发：靠技能描述，而非常驻 CLAUDE.md（机制不同、行为接近）
原框架靠**安装时**往项目根 `CLAUDE.md` 追加 `@AI_LabTest/CLAUDE.md`，使 QA 角色与 3 步规则**常驻上下文**——只在装过的项目里生效。插件**不能**注入常驻 CLAUDE.md（官方明确：插件根的 `CLAUDE.md` 不作为项目上下文加载）。等价机制是 `test-workflow` **技能**：其 `description` 常驻于上下文，Claude 据此在「测试 X 模块 / 跑测试 / 出报告」等请求上**自动触发**并加载完整流程。
- **行为差异**：技能触发是「模型按描述判断」，不是「规则文本逐字常驻」。对明确的测试请求触发很可靠；对极隐晦的措辞，可能需要显式 `/ai-lab-test:test-workflow`。
- **作用域差异**：原 `@import` 只在装过的项目生效；插件一旦启用对**所有**项目可用（更广，通常是好事）。

### 3. 不再往项目写规则文件（机制不同、判定一致）
原框架把 `rules/` 复制进每个项目的 `AI_LabTest/rules/`，用户可逐项目改规则。插件的规则集中在 `${CLAUDE_PLUGIN_ROOT}/rules/`（只读，全局共享、随插件升级）。
- **影响**：判定标准完全一致；但「在某项目里临时改规则」的玩法变成「改插件全局规则」。如需逐项目定制，仍可手动把某规则拷进项目并让命令读它。

### 4. 依赖安装时机（机制不同、结果一致）
原框架 `install.sh` 会 `npm install -D @playwright/mcp @playwright/test` 且 `npx playwright install chromium`。插件靠 MCP 配置 `npx -y @playwright/mcp@latest` **首次执行时按需拉取**，Chromium 在**首次 `/ai-lab-test:execute` 时按需下载**。
- **影响**：首次执行会更慢，且**需要网络**。离线环境请预先 `npx playwright install chromium`。

### 5. `environments.json` / 目录 / site-patterns / AI_LabTest/README.md 的落地靠 `/ai-lab-test:init`（机制不同、产物一致）
原框架由 `install.sh` 在安装时渲染/复制。插件改为显式 `/ai-lab-test:init`（首个项目跑一次）。渲染逻辑、占位符、默认值推断（7 项）、必填账号（2 项）、`AI_LabTest/README.md` 框架参考文档复制，均与原 `install.sh`/`ai-lab-install.md` 一致。`execute`/`report` 在缺失时也会提示先 init。

### 6. 项目内 `AI_LabTest/CLAUDE.md` 与根 `CLAUDE.md` —— 默认不落地，模式 B 可完全复刻
原框架 `install.sh` 会①渲染一份 `AI_LabTest/CLAUDE.md`（QA 角色 + 3 步入口约束）到项目里，并②在项目根 `CLAUDE.md` 追加 `@AI_LabTest/CLAUDE.md` 使其**常驻上下文**。
- **默认（模式 A）**：插件**不**在项目里生成 `AI_LabTest/CLAUDE.md`、**不**改动根 `CLAUDE.md`。该文件的**全部内容**已等价并入 `test-workflow` 技能的 `SKILL.md`——即项目内不再有这个 .md 实体，角色约束改由技能承载（触发机制差异见第 2 条）。
- **要逐文件 + 常驻上下文完全一致** → `/ai-lab-test:init` 选**模式 B**：它会渲染 `AI_LabTest/CLAUDE.md`、复制规则到 `AI_LabTest/rules/`、并在根 `CLAUDE.md` 追加 `@AI_LabTest/CLAUDE.md`（原内容不动），产出与原 `install.sh` **逐文件相同**的布局与触发体验。

### 7. 升级方式（机制不同）
原框架用 `scripts/upgrade.sh` 覆盖项目内 `rules/`。插件用 `/plugin update`（或 `--plugin-dir` 重载）。`upgrade.sh` 里的「V0.3 清理 test-script.md」类一次性迁移在插件里天然不需要（插件本就不含已删产物）。

### 8. 未纳入插件的原框架件（有意省略，非遗漏）
- `scripts/setup-claude-command.sh`、`commands-global/ai-lab-install.md`：是「把安装器注册成全局命令」的引导，插件本身就是分发与安装机制，已由 `/plugin install` + `/ai-lab-test:init` 取代。
- `app/`：是同一方法论的 **Electron 桌面应用**重写（独立产物线），与 Claude Code 插件无关，不在本次提取范围。

> 除以上 8 点外，3 步流程的**每一个判定细节**（四态决策树、401 熔断阈值 >50%、用户门控触发条件、覆盖矩阵符号、预期依据/验证性质、数据策略、权限隔离、报告章节与终态禁止事项、§10 经验回写）都来自保留的 `rules/`，判定标准与原框架一致。
