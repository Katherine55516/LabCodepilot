# GSD Source Snapshot

> 这是 [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done)（archived, MIT）的固定快照，由 AI Native Lab 维护者手动同步。**请勿手动修改此目录下的文件**——若需升级，重新跑 `node scripts/vendor-gsd-fetch.js` 或按下方流程手动同步。

## 当前快照

- **Source**: `gsd-build/get-shit-done`
- **Commit**: `837114c1d0a4bec91983bb198a2b0d9f42a9446f`
- **Date**: 2026-05-22
- **Snapshot taken at**: 2026-05-25 (commands + agents), 2026-05-26 (assets backfill)
- **License**: MIT (Copyright © 2025 Lex Christopherson — see [LICENSE](./LICENSE))

## 保留的文件

| 路径 | 用途 | 数量 |
|---|---|---|
| `commands/gsd/*.md` | 斜杠命令 prompt 模板 | 67 |
| `agents/gsd-*.md` | Claude Code subagent 定义 | 33 |
| `get-shit-done/workflows/**` | 命令体 @-import 的工作流定义 | ~107 |
| `get-shit-done/references/**` | 命令体 @-import 的参考资料 | ~63 |
| `get-shit-done/templates/**` | 命令体 @-import 的模板 | ~46 |
| `get-shit-done/bin/**` | GSD 工具脚本（.cjs + lib/） | ~80 |
| `get-shit-done/contexts/**` | dev/research/review 上下文 | 3 |
| `LICENSE` | MIT 许可证全文 | 1 |

`get-shit-done/` 子目录里的所有 `.md` 文件会跑 `gsd:` → `gsd-` 转换（与命令/子 agent 同步规则），`.cjs`/`.js` 等脚本原样保留。

## 不复制的目录

`docs/` `tests/` `sdk/` `scripts/`（仓库根）、`bin/`（仓库根 = npm 包 installer）、`assets/`、`hooks/` 等是 GSD 自身的构建工具与文档站，与"内置进 AI Native Lab 运行时"无关，不入库。注意区分：
- 仓库根的 `bin/` **不复制**（npm installer 工具）
- 仓库 `get-shit-done/bin/` **复制**（命令运行时引用 `~/.claude/get-shit-done/bin/...`）

## 升级流程

1. `git clone --depth=1 https://github.com/gsd-build/get-shit-done.git /tmp/gsd-clone`
2. `cd /tmp/gsd-clone && git fetch --depth=1 origin <new-commit> && git checkout <new-commit>`
3. 删 `vendor/gsd-source/commands/gsd/` `vendor/gsd-source/agents/` `vendor/gsd-source/get-shit-done/`
4. `cp -r /tmp/gsd-clone/commands/gsd vendor/gsd-source/commands/gsd`
5. `cp -r /tmp/gsd-clone/agents/. vendor/gsd-source/agents/`
6. `cp -r /tmp/gsd-clone/get-shit-done vendor/gsd-source/get-shit-done`
7. 复制最新 `LICENSE` 到 `vendor/gsd-source/LICENSE`
8. 更新本文件的 commit / date 字段
9. 跑 `npm run vendor:gsd && npm run vendor:gsd:verify`
10. 测试：`npm run test`、`npm run electron:dev` → CDP 验证斜杠菜单
11. commit 并发版（package.json `version` 同步 bump）
