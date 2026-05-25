# GSD Source Snapshot

> 这是 [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done)（archived, MIT）的固定快照，由 CodePilot 维护者手动同步。**请勿手动修改此目录下的文件**——若需升级，重新跑 `node scripts/vendor-gsd-fetch.js` 或按下方流程手动同步。

## 当前快照

- **Source**: `gsd-build/get-shit-done`
- **Commit**: `837114c1d0a4bec91983bb198a2b0d9f42a9446f`
- **Date**: 2026-05-22
- **Snapshot taken at**: 2026-05-25
- **License**: MIT (Copyright © 2025 Lex Christopherson — see [LICENSE](./LICENSE))

## 保留的文件

| 路径 | 用途 | 数量 |
|---|---|---|
| `commands/gsd/*.md` | 斜杠命令 prompt 模板 | 67 |
| `agents/gsd-*.md` | Claude Code subagent 定义 | 33 |
| `LICENSE` | MIT 许可证全文 | 1 |

## 不复制的目录

`docs/` `tests/` `sdk/` `scripts/` `bin/` `assets/` `hooks/` 等是 GSD 自己的构建工具和文档站，与"内置进 CodePilot"无关，不入库。

## 升级流程

1. `git clone --depth=1 https://github.com/gsd-build/get-shit-done.git /tmp/gsd-clone`
2. 删 `vendor/gsd-source/commands/gsd/` `vendor/gsd-source/agents/`
3. `cp -r /tmp/gsd-clone/commands/gsd vendor/gsd-source/commands/gsd`
4. `cp -r /tmp/gsd-clone/agents/. vendor/gsd-source/agents/`
5. 复制最新 `LICENSE` 到 `vendor/gsd-source/LICENSE`
6. 更新本文件的 commit / date 字段
7. 跑 `npm run vendor:gsd && npm run vendor:gsd:verify`
8. 测试：`npm run test`、`npm run electron:dev` → CDP 验证斜杠菜单
9. commit 并发版（package.json `version` 同步 bump）
