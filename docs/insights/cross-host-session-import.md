# Cross-Host Session Import — 产品思考

> 技术实现见 [docs/handover/cross-host-session-import.md](../handover/cross-host-session-import.md)

## 用户问题

用户同时使用了两个基于 Claude Code 的桌面工具：本项目 **AI Native Lab** 与 **bsApp（claude-bs-agent）**。"底层都用同一个 Claude Code CLI，为什么我在 bsApp 里跑过的会话，到 AI Native Lab 看不见？"

最直观的猜测是"两个项目各存各的"，但代码层面看两者的 jsonl 写入逻辑都遵循 Claude Code 官方的 `~/.claude/projects/<slug>/<sessionId>.jsonl` 规范，路径模板完全一样。

### 为什么底层接同一份 CLI 却各跑各的

实测发现真正的分叉点：**bsApp 在 Electron 主进程 spawn server 子进程时，把 `HOME`/`USERPROFILE` 改写到了应用私有的 `<userData>/claude-home`**。这是一个"假家目录"沙箱，目的是不让用户机器上原有的 `~/.claude/settings.json` 干扰 bsApp 自带的鉴权（apiKeyHelper / OAuth token / proxy 等）。

副作用：`os.homedir()` 是 Claude CLI 内部寻找 `~/.claude/` 的唯一入口；HOME 被改写后，CLI 把会话 jsonl 全部写进了 `<userData>/claude-home/.claude/projects/`，跟用户真实 `~/.claude/projects/` 在文件系统层面完全没交集。AI Native Lab 用的是 `@anthropic-ai/claude-agent-sdk`，没改写 HOME，所以读真实 `~/.claude/projects/`，看不到 bsApp 那一棵树。

> 这是一个隐藏度极高的认知陷阱：用户合理假设"同一份 CLI = 共享目录"，但当宿主应用做了进程级 env 隔离时，这个假设悄无声息地被破坏，且没有任何 UI 提示。

## 设计权衡

### 方案 A — 在 AI Native Lab 端扩展扫描目录（采纳）

让 AI Native Lab 的 session parser 多扫一个根目录 `<userData>/claude-home/.claude/projects/`，列表/导入 API 自动合并两边的 jsonl。改动只在 `claude-session-parser.ts` 一个文件里。

- ✅ 不需要改 bsApp，能立刻让所有现存用户的历史可迁移
- ✅ 单向只读，不会污染 bsApp 的沙箱
- ✅ 后续如果出现第三个类似 sibling 应用，扩展模式开放

### 方案 B — 让 bsApp 取消 HOME 改写

更"治本"的做法：把 bsApp 的隔离收窄到只覆盖 `settings.json`（比如显式传 `--settings-file`），projects 留在用户真实 `~/.claude/projects/`。

- ❌ 需要改另一个项目 + 重新分发 bsApp，周期长
- ❌ 改了之后 bsApp 自己的 token 隔离要重新设计，溢出本次需求
- ❌ 已经分发出去的旧版 bsApp 用户得不到收益

### 方案 C — 在 Settings 里加"额外 projects 目录"自定义输入

最通用，但 over-engineering：

- 目标只有一个已知对象（bsApp），没必要为"假想中的第三方"建配置 UI
- 引入持久化 + i18n + 验证 + 测试矩阵，工作量翻倍
- 自动发现 bsApp 是"零配置零认知负担"，让用户填路径反而暴露了底层细节

**最后选 A**，并把"自动发现 bsApp"做成代码里 case-by-case 列举的形式，以后若真的需要扩展，是清晰的演化方向。

## 不加来源 badge 的取舍

最初设计里考虑给每条会话加个小 badge（"Claude CLI" / "bsApp"），让用户看清这条会话从哪里来。最终决定**不加**：

- 用户已经能从 `cwd` 字段（"D:\test0511"、"D:\CodePilot-main" 等）一眼看出"这是我在哪个项目下跑的"，那个心智模型比"哪个产品写的"更接近用户的真实记忆
- 加 badge 会暗示"这条会话不属于 AI Native Lab 主流"，反而强化了"两个应用是割裂的"这种错误认知。我们想传达的信息恰恰相反：**底层就是同一个 Claude Code，会话本质上是统一的**
- 翻译、配色、可访问性的成本 vs 上述微弱信号收益，不划算

如果未来用户反馈"想知道这条是从哪导入的"，可以在导入后的 AI Native Lab session 元数据里加一个 `imported_from` 字段，在会话详情页（而不是选择列表里）显示。

## 已知局限

1. **Resume 仍然受限于 SDK 的真实 HOME**。AI Native Lab resume 一条 import 进来的会话时，SDK 会按真实 `os.homedir()` 寻找 jsonl —— 如果原 jsonl 在 bsApp 的 shadow home 而不在真实主目录，SDK 找不到、resume 失败。这块是 SDK 的硬约束，本次没解决；目前主要场景是"浏览 + 单次完整 import 历史"，所以可接受。要解决就得再做一步"导入时把 jsonl 复制到主目录"，是清晰的下一步
2. **每个 sibling 应用要写一行代码**。`getBsAppShadowHome()` 是写死的；新出现的应用要复制这个模式。这跟方案 C 是同一个权衡：换"零配置"换"代码里加 case"
3. **跨平台兼容仰仗于 Electron 的 `app.getPath('userData')` 公式稳定**。如果 Electron 上游改了平台默认值，公式会失效。低风险但写在 [handover 文档](../handover/cross-host-session-import.md#shadow-home-路径计算) 里以便未来对齐

## 复盘 — 这次的设计教训

**"两个应用都用 Claude Code CLI 所以应该共享会话" 这个用户假设值得在产品层面回应**。底层引擎一致 ≠ 用户感知一致，沙箱隔离这种工程决策对用户是不可见的。AI Native Lab 作为"基于 Claude Code 的 AI 客户端"，应该承担起"统一用户在 Claude Code 上的所有历史"的角色 —— 这次的多目录扫描就是这个产品定位的第一步具体兑现。

未来还可以做：

- 检测到 import 失败时（jsonl 不在主目录），引导用户一键迁移 jsonl
- 让 AI Native Lab 本身也提供"shadow home"模式（用户能选择"用我的 ~/.claude 还是用 AI Native Lab 私有副本"），把这个工程决策提升为产品选项
- 把 sibling 应用列表做成 plugin 形式，让社区可以贡献新的发现规则
