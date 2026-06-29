# AI_LabTest 插件源快照

本目录是 `qitianersheng/ai-lab-test-agent`（插件根目录 `ai-lab-test/`）的固定快照，
由 `scripts/vendor-ailab-prepare.js` 读取并生成 `vendor/ailab-bundle/`（CodePilot 打包用的
内置插件资源）。更新方式：重新从上游仓库同步本目录内容，并刷新下方 Commit 字段。

- **Source**: https://github.com/qitianersheng/ai-lab-test-agent
- **Plugin**: ai-lab-test (marketplace: ai-lab-test-marketplace)
- **Commit**: `bab7b0dcccee8286129baf1372b2d06579a3eac4`
- **Plugin version**: 0.14.0

## 快照内容

- `.claude-plugin/{plugin.json,marketplace.json}` — 插件 / marketplace 清单（root-layout，`source: "./"`）
- `.mcp.json` — 插件级 Playwright MCP 声明（`npx -y @playwright/mcp@latest --browser chromium`）
- `commands/` — 6 个 slash 命令（cases / execute / init / knowledge-map / report / status）
- `skills/test-workflow/SKILL.md` — 自动触发的测试工作流技能
- `rules/` — 5 份方法论规则（命令 / 技能通过 `${CLAUDE_PLUGIN_ROOT}/rules/...` 引用）
- `templates/` — 5 个 init 模板
- `site-patterns/_template.md` — 站点模式模板
- `README.md` — 上游说明（仅供参考，不进 bundle）

## 排除项

`.git/`、`.claude/`、`.idea/`、`.DS_Store`、上游自带的 `.gitignore` 均未纳入快照。
