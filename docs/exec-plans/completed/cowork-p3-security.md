# Cowork P3 安全强化 — 凭证不进 VM + 会话间隔离

> 创建时间:2026-07-15
> 最后更新:2026-07-15
> 上游:办公模式 E1-E5 + 镜像流水线 M1-M4 已交付(见 [docs/handover/cowork-vm-mode.md](../../handover/cowork-vm-mode.md));调研见 [docs/research/cowork-local-vm-mode.md](../../research/cowork-local-vm-mode.md)

**威胁模型转变**:E1-E5 + 流水线保护的是"用户的真机"(agent 碰不到宿主文件)。P3 保护的是"用户的凭证与数据"——办公模式的核心用法是把**不可信文件**喂给 agent,一份被提示注入的文档可以指挥 agent 干它权限内的坏事。P3 堵两个当前敞开的口子。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| P3-A | 每会话非特权用户:daemon 提权 + exec setuid 降权到会话专属用户 + workspace 700 | ✅ 已完成 | 2026-07-15 VM 实测:会话 B whoami=cw_<B>,cat/ls 会话 A 目录均 Permission denied,自己 workspace 读写正常,daemon(root)下载 A 产物正常,删会话 userdel;附带修竞态(见决策)+ seed instance-id 内容寻址 |
| P3-B-0 | 宿主代理 POC:claude http base_url + 一次性 token + HTTP/SSE 转发三点验证 | ✅ 已完成 | 2026-07-15 宿主本地层(scripts/poc/cowork/proxy-poc.ts)真凭证实测:三假设全 PASS,claude 回 BRIDGE_OK/result 无错。**理想架构可行,不走退路**。VM→host 通道选型待 P3-B 首步定(见决策) |
| P3-B | 宿主代理产品化:真 key 只在宿主内存,VM 只拿一次性 token | ✅ 已完成 | 2026-07-15 NAT 网关方案 VM 实测:回合正常(81s,PROXY_TEST_OK),VM 内 `ANTHROPIC_API_KEY=cwk_…(len=52)` **是一次性 token 非真 key**、`ANTHROPIC_BASE_URL=http://192.168.64.1:8788`(代理);proxy 日志确认 real key withheld;删会话触发 revokeSession。guest→host 网关 192.168.64.1 实测可达 |
| P3-C | 审计日志 + 双文档 + 回归 + 打包 | ✅ 已完成 | 2026-07-15 cowork-audit.ts 宿主侧 append-only 审计(凭证签发/废止、文件进出、VM 生命周期);接入 cowork-proxy/transfer/vm-manager;落 audit.log(JSON Lines,8MB 软截断);双文档终稿;test 1948 绿。**P3 全部完成,计划归档** |

## 决策日志

- 2026-07-15 **范围:只做两项 + 审计,不做出网白名单**(用户拍板)。①宿主代理注入 token(凭证永不进 VM)②每会话非特权用户(会话间不可越权互读)③配套审计日志。**明确不做出网白名单**:用户接受 agent 在沙箱内自由上网的风险(白名单会让"画图装包/查网页/下链接"失效,代价太大)。
- 2026-07-15 **宿主代理只管 claude 的 API 凭证,不碰通用出网**(用户确认)。只把 claude 调模型 API 的流量引回宿主注入真 key;agent 跑脚本时的通用出网(pip/网页/下载)照旧走 VM 的 NAT 自由出去。与"保留自由上网"一致。**代价诚实记录**:被注入的 agent 理论上仍能把数据 POST 到任意外部地址——这是用户已接受的风险,P3 不封。
- 2026-07-15 **每会话隔离用 Linux 用户 + setuid,而非 bwrap/namespace**。理由:Debian 云镜像自带 useradd/setuid(subprocess `user=` 参数,Python 3.11 支持),bwrap 要额外装进镜像;setuid 降权 + workspace chmod 700 从文件系统权限层面封死跨会话读,足够且标准。代价:daemon 须从 `User=agent` 提权到 root(才能 useradd + setuid 降权)——daemon 攻击面扩大,但其协议面小且固定(几个 op),是合理取舍。
- 2026-07-15 **三处版本必须同步 bump**(沿用 M1 纪律):daemon `DAEMON_VERSION`=4、`cowork-seed.ts` 的 `SEED_TEMPLATE_VERSION`=3 + `EXPECTED_DAEMON_VERSION`=4。P3-A 改 daemon(root + setuid)与 seed(systemd User=root),必须让已有磁盘 cloud-init 重跑才生效。
- 2026-07-15 **实测抓到两个升级健壮性 bug,一并修**(P3-A 副产物):①**seed instance-id 内容寻址**——原 instance-id 只跟 SEED_TEMPLATE_VERSION,daemon 改了不 bump 版本就不重灌(M1 坑16 的手动纪律);改为 `codepilot-cowork-v{N}-{userData内容hash}`,daemon/模板一改即触发重灌,消除手动 bump 负担(SEED_TEMPLATE_VERSION 仅留作结构版本 + EXPECTED_DAEMON_VERSION 单测锁)。②**runcmd 用 restart 而非 enable --now**——升级重灌时 daemon 可能已被 systemd 用旧 unit 开机自启,`enable --now` 对已运行服务 no-op → 新 unit(User=root)不生效;restart 强制加载。③**就绪判定加 root 门**(vsockRootReady)——竞态:daemon 首次 boot 就 vsock 应答(可能还是 agent),cloud-init restart 提权到 root 尚未完成;若此时开跑回合,exec setuid 失败、claude 秒退。修:health 上报 uid,v4+ daemon 必须 uid==0 才算就绪(fail-secure,绝不在 daemon 非 root 时开跑)。**这仨都是 P3-A 实测两次撞到 claude 秒退才挖出来的,非纸面能预见。**

## 详细设计

### P3-A 每会话非特权用户(先做,技术确定)

**现状**:seed 里 systemd unit `User=agent`,daemon 与它 exec 的 claude 都在 agent 下;所有会话共用 agent 用户,`/home/agent/sessions/<A>/workspace` 对会话 B 的 claude 可读(同属主)。

**目标态**:
1. **daemon 提权**:seed 的 systemd unit `User=agent` → `User=root`(daemon 需 useradd + setuid 降权)。daemon 自身的 HTTP 代理(P3-B)也在 root,但监听 127.0.0.1。
2. **exec 降权**:`op_exec` spawn claude 前——
   - 幂等建会话专属用户 `cw_<sessionId[:12]>`(`useradd -M -r` 无家目录系统账号;已存在跳过)
   - workspace `chown -R <user>:<user>` + `chmod 700`
   - `subprocess.Popen(..., user=<user>, group=<user>, cwd=workspace)` —— claude 以该用户身份跑
3. **文件 op 不变**:writeFile/readFile/listFiles/archive/removeSession 由 daemon(root)执行,root 无视权限,上传下载照常;chown 后产物属会话用户,daemon 仍能读。
4. **清理**:removeSession + reconcileSessions 顺带 `userdel cw_<...>`(best-effort)。

**验收(VM 实测)**:建会话 A 建文件 → 会话 B 的 claude `cat /home/agent/sessions/<A>/workspace/*` 应 **permission denied**;会话 B 读写自己 workspace 正常;上传附件/下载产物/对账全部不受影响。

**风险**:daemon root 化后若崩溃影响面更大(但有 systemd Restart=always);uid 耗尽(会话专属用户不回收会累积,靠 userdel + reconcile 兜底)。

### P3-B 宿主代理注入 token(POC 先行,架构有不确定性)

**现状(凭证暴露面)**:`provider-resolver.toClaudeCodeEnv` 注入 `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL`;forwarder 白名单 `/^(ANTHROPIC_|CLAUDE_|COWORK_)/` **把真凭证整个透传进 VM claude 的 env**。VM 被攻陷即泄 key。

**目标架构**:
```
VM 内 claude ──http──▶ daemon(127.0.0.1 HTTP 代理) ──vsock 反向──▶ 宿主 cowork-proxy ──https──▶ 真 API
  base_url=http://127.0.0.1:<port>          剥一次性token              校验+注入真key+真base_url
  ANTHROPIC_AUTH_TOKEN=<一次性token>        经 vsock 转发             (真 key 只在宿主内存)
```
- **宿主 cowork-proxy**(next-server 侧,globalThis 单例同 vm-manager):持真实 `ANTHROPIC_*`(内存态,从 provider-resolver 拿),按会话签发一次性 token;收到 VM 转来的请求 → 校验一次性 token → 剥掉 → 插真 key + 真 base_url → 转发真 API → 流式回传。
- **guest daemon 兼 HTTP 代理**:监听 `127.0.0.1:<port>`,收 claude 的 API 请求 → 经 vsock 反向通道转宿主 proxy → 流式回传。
- **env 改造**:claude 的 `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`、`ANTHROPIC_AUTH_TOKEN=<一次性token>`;forwarder 白名单**剔除真凭证透传**(真 key 不再过河,只放行 COWORK_* + 一次性 token 的注入)。
- **边界**:只引流 claude 的 API 调用(base_url 指向的域);agent 脚本的通用出网走 VM NAT 不经代理(决策 2)。

**POC 验证结论(P3-B-0,2026-07-15,scripts/poc/cowork/proxy-poc.ts)**:宿主本地层用真 managed 凭证实测,三假设**全 PASS**:
1. ✅ **claude 接受 `http://` 本地明文 base_url**——darwin claude 正常打到 http 代理,不强制 https。
2. ✅ **HTTP/SSE 流经代理完整转发**——claude 回 `BRIDGE_OK`,result 无错(此层是宿主本地 HTTP 转发;vsock 跳见下方通道选型)。
3. ✅ **一次性 token 校验+剥离+注入真 key**——代理用 ONESHOT 换真 key 转发,真 key 只在宿主内存。
- 发现:claude 会发个别**无 auth 的预检请求**,代理拒绝(401)后 claude 容错重试,对话仍成功 → 产品代理对无效 token 返回 401 是安全的(fail-secure)。

**VM→host 通道选型(P3-B 已定:NAT 网关)**:2026-07-15 实测 guest(192.168.64.4)curl 宿主网关 `192.168.64.1:8899` → REACHED,宿主 ping-server 收到请求。**采用 NAT 网关**:cowork-proxy 绑 vmnet 网关 IP `192.168.64.1:8788`(仅该接口可达),claude base_url 指它。daemon 完全不参与代理链(P3-B 不用改 daemon/seed)。备选 vsock 反向(更隔离更复杂)未采用。三重防护:绑网关 IP + 来源须 vmnet 网段 + 一次性 token。

**P3-B 实现要点(已交付)**:
- `src/lib/cowork-proxy.ts`(新,server 侧单例):`discoverGatewayIp`(os.networkInterfaces 找 192.168.64.x,回退 .1)、`ensureProxyRunning`(绑网关失败回退 0.0.0.0)、`registerSession`(签发 `cwk_`+24 字节 hex token,幂等,内存 Map 存真凭证)、`revokeSession`;请求处理校验来源 IP+token → 剥 token → 注入真 key(按 authStyle) → https 转发真 base_url → SSE 流式回传。
- `claude-client.ts` cowork 分支:读 coworkEnv 的真 ANTHROPIC_*，注册进 proxy，覆盖为 token + 代理 base_url(真 key 不再进 queryOptions.env → 不过河);无真凭证(env 模式)保持原样。
- `sessions/[id]` DELETE:revokeSession(会话删 → token 失效)。

**验收**:办公回合正常 + VM 内 `env | grep ANTHROPIC` **看不到真 key**(只有一次性 token + 本地 base_url);宿主 proxy 日志显示注入真 key 转发成功;速度/流式无退化。

### P3-C 审计日志 + 配套

- daemon 记 exec/文件 op 到宿主可读的审计日志(会话 id、时间、op、argv 摘要),经 vsock 拉取或落 guest 文件由宿主定期收。企业信任加分项,无用户可感面。
- 双文档 + 回归 + 打包。

## 明确不做(范围外)

- **出网白名单**(决策 1 排除):agent 沙箱内自由上网,用户已接受数据外流风险。
- 每会话独立网络命名空间 / 出口 IP:与自由上网决策冲突,不做。
- P2 Windows/WSL2:独立立项。
