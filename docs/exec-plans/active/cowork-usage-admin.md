# 沙箱使用情况管理后台(cowork-usage-admin)

> 创建时间:2026-08-03
> 最后更新:2026-08-21
> 跨仓库:LabCodepilot(apps/cowork-server)+ codeagent-server(API + admin web)

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| P0-a | cowork-server 审计补全(exec_end + 字段扩展 + MAX_BYTES env) | ✅ 已完成 | eed2b10 |
| P0-b | cowork-server admin 面(`__admin__` 鉴权 + audit/stats/运维端点)+ selftest | ✅ 已完成 | 本机+生产 selftest 各 17/17;卷大小改走 docker system df(cowork 用户穿越不了 root data-root,du 恒 null) |
| P0-c | codeagent-server 迁移 + 惰性拉取器 + 聚合服务 | ✅ 已完成 | codeagent-server 3be252a;pytest 134 passed |
| P1 | admin usage API + pytest + admin web「沙箱用量」页 | ✅ 已完成 | 同 3be252a;web tsc+build 过 |
| P2 | 运维动作(删会话 / 产物查看下载)+ 管理操作审计 | ✅ 已完成 | 同批交付;admin_remove/admin_download 生产验证落审计 |
| 部署 | 沙箱侧同步重启 + selftest;账号后端由用户 pull+build | 🔄 沙箱侧已上线 | 沙箱侧 2026-08-03 已重启并真 secret 验证(20 卷/audit 210 行);**账号后端待用户 pull + migrate + build** |

## 决策日志

- 2026-08-03: **UD1(用户)** 历史统计要做 → 完整 PG 数据管道,不做纯实时版
- 2026-08-03: **UD2(用户)** admin 可删除用户会话
- 2026-08-03: **UD3(用户)** admin 可查看并下载用户产物 —— 放宽了原方案"只元数据"的隐私边界;
  制衡:所有 admin 删除/下载动作写入沙箱审计日志(`admin_remove`/`admin_download`),
  经拉取器进 PG,后台事件流对全体 admin 可见留痕
- 2026-08-03: **D1** 后台放账号后端 admin web —— admin 鉴权/UI/部署现成;uid→人名映射只有那里能做
- 2026-08-03: **D2** cowork-server 保持无状态 —— 只加只读/运维端点,统计数据一律进账号后端 PG
- 2026-08-03: **D3** admin 鉴权零新密钥 —— 复用 HMAC 体系,`/admin/*` 只认 `uid === '__admin__'` 的
  token;账号后端服务端持 secret 自签;普通用户 token 恒为真实 UUID,不可能碰撞
- 2026-08-03: **D4** 拉取器用**惰性拉取**而非常驻定时任务 —— admin API 被调用且距上次 >60s 即
  增量拉一次(另有手动 sync 按钮)。省掉后台任务基建及其失败模式,内部工具量级足够
- 2026-08-03: **D5** admin 删除/下载**不走**用户面端点(会被 assertOwner 按 OWNER_MISMATCH 拒成
  404),cowork-server 提供 `/admin/session/:sid/*` 专用端点直调 orch/files,绕过 owner 校验
- 2026-08-03: **D6** 审计日志截断从 4MB 调大到 64MB(env 可覆盖),拉取器上线后日志只是缓冲区;
  fileId(首行哈希)变化 = 截断/重置信号 → 拉取器归零重拉,PG UNIQUE 兜底去重
- 2026-08-21: **D7(性能)** 「每次查询都慢/经常超时」根因修复,三处联动:
  ① 沙箱 `/admin/stats` 快照化(admin.mjs getStats):请求恒即答内存快照,采集转后台 ——
  docker stats 天然 ~2s + `system df` 随卷数量涨到几十秒,现采叠加账号后端 10s 超时必爆;
  df 加 in-flight 去重 + 失败保留旧值(此前并发各起一个 df,daemon 正反馈恶化);
  ② overview 的惰性同步失败降级(sync_failed)而非整页 500 —— 沙箱不可达时历史统计必须可用;
  ③ `_live_stats` 失败进 15s 冷却 + 回退 ≤10min 旧快照 —— 此前"失败不缓存",3 个被锁
  串行化的请求各付一次 10s 超时,整页 ~30s 顶爆前端 30s 超时。
  刻意不做启动预热:selftest 与冷启动首调依赖「现场采集」语义,冷启动只慢这一次

## 详细设计(摘要,完整讨论见会话)

### 数据流

```
admin web「沙箱用量」 → codeagent-server /admin/cowork/usage/*
                          ├─ 实时:代签 __admin__ token → cowork-server /admin/stats
                          ├─ 历史:PG cowork_audit_events(惰性增量拉取 ← /admin/audit?offset)
                          └─ JOIN users 表 → uid 换人名
```

### cowork-server 新增(全部挂 `__admin__` 鉴权)

- `GET /admin/audit?offset=N` → `{lines, nextOffset, fileSize, fileId}`(单次 ≤1MB)
- `GET /admin/stats` → 活跃容器(uid/状态/资源)+ 全部卷(sid/uid/大小)+ 磁盘
- `DELETE /admin/session/:sid` → 直调 removeSession;审计 `admin_remove`
- `GET /admin/session/:sid/files|file?path=|archive` → 直调 files.*;下载审计 `admin_download`
- 审计新事件:`exec_end`(code + durationMs → 成功率/回合时长的唯一结构化来源)

### PG 表

```sql
cowork_audit_events(id bigserial PK, ts timestamptz, event varchar(32),
  session_id varchar(64), uid uuid NULL, detail text, code int NULL,
  duration_ms int NULL, UNIQUE(ts, event, session_id, detail))
cowork_audit_cursor(offset bigint, file_id varchar(64))  -- 单行
```

### 页面(admin web /cowork-usage)

概览卡(健康/活跃容器/今日会话/今日与累计用户/磁盘)· 用户表(人名/会话数/回合数/
成功率/传输量/最近活跃)· 会话表(sid/归属/时间轴/容器状态/卷大小/产物数 + 删除·产物
查看下载操作列,Popconfirm)· 手动同步按钮。趋势图/事件流浏览 = P3 可选,本轮不做。

### 验收标准

1. cowork-server selftest-admin 全过(鉴权拒绝非 admin token / audit 增量与截断容错 / stats 形状 / admin 删除三方归零 / admin 动作产生审计)
2. codeagent-server pytest:拉取幂等(重拉不重复)、fileId 变化归零重拉、聚合口径、非 admins 组 403
3. 真实链路:页面显示**人名**而非 UUID;删除会话后沙箱侧容器+卷+PG 状态一致;admin 下载动作出现在审计事件里
