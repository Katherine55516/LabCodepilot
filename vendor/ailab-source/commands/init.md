---
description: 在当前项目初始化 AI_LabTest 工作区（建产物目录 + 渲染 environments.json + 初始化 site-patterns；可选「完全复刻原框架布局」）
argument-hint: [可选：目标项目路径，默认当前目录]
---

# /ai-lab-test:init — 初始化项目内的 AI_LabTest 工作区

## 这一步做什么 / 不做什么

本命令把原 `scripts/install.sh` 的**「项目配置渲染」部分**搬进插件，在**目标项目内**创建产物目录与配置文件。它**不**注册 `.mcp.json`（Playwright MCP 由本插件自动注册），也**不**跑 `npm install`（`@playwright/mcp` 经 `npx -y` 首次执行时自动拉取，Chromium 在首次 `/ai-lab-test:execute` 时按需下载）。

提供两种模式（§2 让用户选）：
- **模式 A · 纯插件（推荐，默认）**：只建产物目录 + environments.json + site-patterns + README + .gitignore。规则随插件分发（`${CLAUDE_PLUGIN_ROOT}/rules/`，按需 Read），不写进项目；根 `CLAUDE.md` **不动**；测试经 `test-workflow` 技能或 `/ai-lab-test:*` 命令触发。
- **模式 B · 完全复刻原框架**：在模式 A 基础上，额外把规则复制进 `AI_LabTest/rules/`、渲染 `AI_LabTest/CLAUDE.md`、在项目根 `CLAUDE.md` 追加一行 `@AI_LabTest/CLAUDE.md`。这样得到与原 `install.sh` **逐文件一致**的项目布局与**常驻上下文**（自然语言触发与原框架完全相同）。代价：项目内多出规则副本（插件升级后需重跑本命令同步）+ 根 `CLAUDE.md` 被追加一行。

> 幂等：已存在的文件**一律不覆盖**（environments.json / site-patterns / AI_LabTest/CLAUDE.md / 产物 / 根 CLAUDE.md 已含 @import 行时跳过）。

## 执行步骤（严格按序）

### 1. 安全 / 前置检查

1. 跑 `pwd` 拿到目标目录（若 `$ARGUMENTS` 传了路径则用它，但仍做安全检查）。
2. **拒绝**在 `$HOME` / `/` / `/tmp` / `/var` / `/usr` 等系统/家目录初始化。
3. 若已存在 `AI_LabTest/`：用 `AskUserQuestion` 确认「补全缺失项 / 取消」（绝不覆盖已有配置与产物）。

### 2. 选择初始化模式（AskUserQuestion）

> **本次测试要哪种初始化？**
> - `纯插件模式（推荐）` — 不在项目内放 CLAUDE.md/规则，根 CLAUDE.md 不动；靠技能/命令触发。
> - `完全复刻原框架` — 额外渲染 AI_LabTest/CLAUDE.md + 复制规则 + 根 CLAUDE.md 追加 @import，获得与原框架一致的常驻上下文。

记下选择为 `MODE=A` 或 `MODE=B`，§11 据此决定是否执行复刻步骤。

### 3. 扫描项目，自动推断 7 项默认值

```bash
PROJECT_NAME=$(basename "$(pwd)")

# 前端端口（vite.config / package.json）
LOCAL_FRONTEND_PORT=$(
  grep -oE "port[ :=]+[0-9]+" vite.config.ts vite.config.js 2>/dev/null | head -1 | grep -oE "[0-9]+" \
  || grep -oE -- "--port[ =][0-9]+" package.json 2>/dev/null | head -1 | grep -oE "[0-9]+" \
  || echo 5173
)

# 前端启动命令
LOCAL_START_CMD=$(
  for n in dev client:dev start serve watch; do
    if grep -q "\"$n\":" package.json 2>/dev/null; then echo "npm run $n"; break; fi
  done
)
[[ -z "$LOCAL_START_CMD" ]] && LOCAL_START_CMD="npm run dev"

# 后端端口（.env 或子目录）
LOCAL_API_PORT=$(grep -E "^PORT[ =]" .env 2>/dev/null | grep -oE "[0-9]+" | head -1)
if [[ -z "$LOCAL_API_PORT" ]]; then
  for d in api server backend; do [[ -d "$d" ]] && LOCAL_API_PORT=3001 && break; done
fi
LOCAL_API_PORT=${LOCAL_API_PORT:-0}  # 0 = 无后端

# 健康端点
HEALTH_ENDPOINT="/api/health"; [[ "$LOCAL_API_PORT" == "0" ]] && HEALTH_ENDPOINT="/"

# 代码目录
SOURCE_DIRS=$(
  for d in src api lib components backend server pages app frontend; do
    [[ -d "$d" ]] && echo -n "$d/, "
  done | sed 's/, $//'
)
[[ -z "$SOURCE_DIRS" ]] && SOURCE_DIRS="src/"

# 测试账号 role（默认）
TEST_ROLE=admin

# 站点域（PROJECT_NAME → 小写 + 非字母数字替换为 -）
PROJECT_DOMAIN=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/--*/-/g; s/^-//; s/-$//')
TODAY=$(date +%Y-%m-%d)
```

### 4. 一次性确认 7 项推断（AskUserQuestion）

把扫描结果整段展示，再问**一个**问题「是否全部确认？」：
- `全部确认`（推荐）
- `要改某些字段` → 再用一次 `AskUserQuestion`（multiSelect）让用户挑字段，逐个 read 新值后回到本步重新确认。

呈现的 7 项：项目名 / 前端端口 / 前端启动命令 / 后端端口(0=无后端) / 健康端点 / 代码目录 / 测试账号 role。

### 5. 收集 2 项必填（测试账号）

用一次 `AskUserQuestion`，2 个问题并列：
| # | 标题 | 描述 |
|---|---|---|
| 1 | 测试账号 username | DB 里真实存在的测试账号（如 testuser）|
| 2 | 测试账号 password | 对应密码 |

> ⚠️ **绝对禁止**猜测这两个值，必须问用户。**禁止**把 password 写入任何 markdown / log / report 文件（只写进 `AI_LabTest/environments.json`）。

### 6. 创建目录骨架（在目标项目内）

```bash
mkdir -p AI_LabTest/{testCase,report,site-patterns}
# 模式 B 额外：
[[ "$MODE" == "B" ]] && mkdir -p AI_LabTest/rules
```

> V0.4 起目录骨架不再含 `analysis/`、`requirements/`（代码库分析 / 需求分析 / 需求评审三步已剔除）。用户提供的需求文档为其自有文件，按路径引用即可，无需 AI_LabTest 管理。V0.6「依据会话内容生成需求文档」来源的产物落在 `testCase/{任务}-requirement.md`，复用 `testCase/`，仍不单独建 `requirements/`。Step 2 登录态缓存目录 `AI_LabTest/.auth/`（storageState，含 token）**按需创建、已在 `.gitignore` 忽略**，不在此预建。

### 7. 渲染 environments.json（不覆盖已有）

读模板 `${CLAUDE_PLUGIN_ROOT}/templates/environments.json.template`，替换占位符后写入 `AI_LabTest/environments.json`（**若已存在则跳过**）：

| 占位符 | 值 |
|---|---|
| `{{LOCAL_FRONTEND_PORT}}` | $LOCAL_FRONTEND_PORT |
| `{{LOCAL_API_PORT}}` | $LOCAL_API_PORT |
| `{{HEALTH_ENDPOINT}}` | $HEALTH_ENDPOINT |
| `{{TEST_USERNAME}}` | 用户填写 |
| `{{TEST_PASSWORD}}` | 用户填写 |
| `{{TEST_ROLE}}` | $TEST_ROLE |
| `{{LOCAL_START_CMD}}` | $LOCAL_START_CMD |

### 8. 初始化 site-patterns（不覆盖已有）

读模板 `${CLAUDE_PLUGIN_ROOT}/site-patterns/_template.md`，替换 `{{PROJECT_DOMAIN}}` / `{{PROJECT_NAME}}` / `{{TODAY}}` 后写入 `AI_LabTest/site-patterns/{PROJECT_DOMAIN}.md`（**若已存在则跳过**）。

### 9. 复制框架参考 README（不覆盖已有）

把 `${CLAUDE_PLUGIN_ROOT}/templates/AI_LabTest-README.md` 复制到 `AI_LabTest/README.md`（**若已存在则跳过**）——与原 `install.sh` 一致，作为项目内的框架参考文档。

### 10. 追加 .gitignore（不重复）

把 `${CLAUDE_PLUGIN_ROOT}/templates/gitignore.snippet` 的内容追加到项目 `.gitignore`（若已含 `AI_LabTest/.last-run-env.json` 则跳过；无 `.gitignore` 则新建）。

### 11.【仅模式 B】完全复刻：规则副本 + AI_LabTest/CLAUDE.md + 根 @import

仅当 §2 选了**完全复刻原框架**时执行（模式 A 跳过本步）：

1. **复制规则**：把 `${CLAUDE_PLUGIN_ROOT}/rules/`*.md（5 个：test-workflow / test-case-completeness / test-execution / test-report / system_knowledge_map）复制到 `AI_LabTest/rules/`（覆盖以保持与插件一致）。
2. **渲染 `AI_LabTest/CLAUDE.md`**（**若已存在则跳过**）：读 `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md.template`，替换 `{{SOURCE_DIRS}}` 为 $SOURCE_DIRS 后写入 `AI_LabTest/CLAUDE.md`。
3. **根 CLAUDE.md 追加 @import**（不覆盖原内容）：
   - 若项目根 `CLAUDE.md` 存在且已含一行 `@AI_LabTest/CLAUDE.md` → 跳过。
   - 若存在但无该行 → 追加（前面加一行注释 `<!-- AI_LabTest: auto-injected -->`），**原内容一字不动**。
   - 若不存在 → 新建一个只含注释 + `@AI_LabTest/CLAUDE.md` 的文件。

> 模式 B 产物与原 `scripts/install.sh` 逐文件一致（规则集已按 V0.4 精简为 3 步）；自此该项目即便不显式调用命令，也会因根 `@import` 常驻 QA 角色与 3 步规则（与原框架一致的自然语言触发体验）。

### 12.（可选）playwright.config.ts

V0.3 执行不依赖 spec 文件，本配置仅作「环境白名单」防御性护栏，**非必需**。仅当用户要求时，读 `${CLAUDE_PLUGIN_ROOT}/templates/playwright.config.ts.template` 替换 `{{LOCAL_FRONTEND_PORT}}` / `{{LOCAL_START_CMD}}` 后写入项目根 `playwright.config.ts`（已存在则先备份 `.bak`）。

### 13. 验证 + 陈述式汇报

- 核验：`AI_LabTest/{testCase,report,site-patterns}/` 已建；`AI_LabTest/environments.json` 无残留 `{{...}}`；`AI_LabTest/site-patterns/{domain}.md`、`AI_LabTest/README.md` 已建。
- 模式 B 额外核验：`AI_LabTest/rules/`（5 个 .md）、`AI_LabTest/CLAUDE.md`（无残留 `{{...}}`）已建；根 `CLAUDE.md` 含 `@AI_LabTest/CLAUDE.md` 一行（原内容保留）。
- 向用户陈述：✅ 已初始化 `AI_LabTest/` 工作区（模式 A/B）；推断的 7 项 + 用户填的 2 项；下一步「运行主流程 `/ai-lab-test:test-workflow` 或 `/ai-lab-test:cases` 开始 3 步流程（任务名由用例设计步自动生成，无需录入）」。**不要**追问「要不要现在开始？」。

## 边界 / 禁止

- ❌ 不在 `$HOME` 或系统目录初始化
- ❌ 不擅自填测试账号 username/password —— 必须问用户
- ❌ 不把 password 写入任何 markdown / log / report
- ❌ 不覆盖已有 environments.json / site-patterns / AI_LabTest/CLAUDE.md / 任何产物；模式 B 的根 CLAUDE.md **只追加**一行，绝不覆盖原内容
- ❌ 不修改业务源码与配置（QA 角色边界）

## 参数

`$ARGUMENTS` — 通常为空（用当前目录）。如传了路径，把那当作目标，但仍走 §1 安全检查。
