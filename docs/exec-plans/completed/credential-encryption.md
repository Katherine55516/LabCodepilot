# 凭证本地加密落盘

> 创建时间：2026-06-02
> 最后更新：2026-06-03
> 交接文档：[handover/credential-encryption.md](../../handover/credential-encryption.md) · 产品思考：[insights/credential-encryption.md](../../insights/credential-encryption.md)

把 AI Native Lab 落盘的 API 凭证从明文改为 AES-256-GCM 密文，信任根 Electron `safeStorage`。参考 bsApp 的 `claude-配置加密-迁移指南.md`，适配本项目 Electron 主进程 + Next.js utility 子进程的双进程架构。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | `crypto-seal` 原语（src + electron 镜像）+ `secret-key.ts` 主密钥 + main.ts 注入 env | ✅ 已完成 | 13 单测；无行为变化 |
| Phase 1 | Layer 1：`storage.ts` session_token/configs.json seal/open + 静默迁移 | ✅ 已完成 | auth-storage 新增 4 例 |
| Phase 2 | Layer 2：db.ts 敏感列 seal/hydrate + settings allowlist + 迁移重封 + image-generator 绕过修复 | ✅ 已完成 | db-encryption 8 例 |
| 验证 | typecheck（root+electron）+ 全量单测 | ✅ 已完成 | 1330 pass / 0 回归 |
| 文档 | handover + insights + 本计划 + 索引 | ✅ 已完成 | |

## 决策日志

- 2026-06-02: 选 safeStorage + 应用层 AES 列加密，**排除 SQLCipher 全库加密**（需原生模块，违反零原生编译铁律；粒度过粗）。
- 2026-06-02: 核实 `safeStorage` 在 `utilityProcess` 子进程不可用（electron#42869）→ 改为"safeStorage 守一把主密钥，hex 经 env 过河给 server"统一模型；anlcode 文件与 SQLite 列共用 `crypto-seal`（便于在 tsx 测试设 env 跑真加密）。
- 2026-06-02: 加密列定（用户拍板"推荐组合"）：`api_key/managed_extra_json/headers_json/env_overrides_json/extra_env`；`base_url` 保持明文（中等敏感，诊断/UI 需显示）。
- 2026-06-02: 覆盖范围聚焦"API/凭证配置"，Bridge 机器人 token 留后续迭代。
- 2026-06-03: Plan 子代理发现并修复唯一咽喉点绕过 `image-generator.ts:pickImageProvider`（裸 SQL 读 api_key）。

## 关键不变量

- `api_providers.api_key` 的所有读取必须经 db.ts hydrate 出口；任何新增裸 SQL 读会拿到密文。
- `seal('')` → `''`（空串永不加密，保留 `!= ''` 与脱敏判空语义）。
- `open()` 解密失败永不返回密文，只返回 `''`（fail-safe → 重登/重输）。
- 迁移重封在 `withMigrationLock` 内 + `isSealed` 幂等（杜绝双封）。
- 无主密钥（dev / safeStorage 不可用）→ 透明直通明文。

## 剩余事项（非阻塞）

- 打包后手动验证 safeStorage 真加密 + 跨机隔离（dev 拿不到真实下发数据）。
- Bridge token 加密（`weixin_accounts.token` / `channel_configs.config_json`）后续迭代。
