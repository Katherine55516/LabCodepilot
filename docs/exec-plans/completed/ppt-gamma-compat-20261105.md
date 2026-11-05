# PPT Gamma 兼容 API

> 交接：[handover/ppt-gamma-compat.md](../../handover/ppt-gamma-compat.md) · 产品：[insights/ppt-gamma-compat.md](../../insights/ppt-gamma-compat.md) · 调研：[research/gamma-reverse-engineering-20261105.md](../../research/gamma-reverse-engineering-20261105.md)

## 状态

| Phase | 内容 | 状态 | 备注 |
|---|---|---|---|
| Phase 0 | 调研 Gamma 公开契约（OpenAPI、MCP、指南）与既有实测；确认引擎接口（readOnlyInput、planning outline、author outline、generate、export/pdf、templates） | ✅ 已完成 | gamma.app 网页有 Cloudflare 人机校验，未绕过 |
| Phase 1 | 纯契约模块：校验、映射、步骤机、状态投影、主题 | ✅ 已完成 | `src/lib/ppt-gamma-compat.ts` |
| Phase 2 | 服务 + 路由 + `ppt_gamma_jobs` 表 + 密封 key | ✅ 已完成 | 轮询驱动，不改 cowork-server |
| Phase 3 | 图片 URL：Gamma 规则提取、公网 HTTPS 抓取、嵌入、跳过告警 | ✅ 已完成 | 单测中发现并修复 Agent 丢 `exportAs` 的缺陷 |
| Phase 4 | 打包登录版真实端到端 | 📋 待开始 | 技术债务 #33 |

## 决策日志

- 2026-11-05：采用 Gamma 公共 API 形状而非自造（零学习成本、契约已验证）。
- 2026-11-05：轮询驱动推进引擎，每次最多一步；generate 返回 409 的审阅停顿转为 failed 并附 gammaUrl。
- 2026-11-05：不支持的值 400、部分支持给具名警告；语言只开放引擎支持的 4 种。
- 2026-11-05：用户提供的 Reversa 框架以源码为输入，Gamma 闭源无法运行其 Discovery 流水线；只借用其 🟢/🟡/🔴 置信标记与文档结构写调研。
