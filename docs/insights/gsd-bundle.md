# 内置 GSD —— 产品思考

> 技术实现见 [docs/handover/gsd-bundle.md](../handover/gsd-bundle.md)

## 用户问题

CodePilot 的核心定位是降低 Claude Code 工作流的使用门槛。但 Claude Code 生态里很多"二阶能力"（结构化提示词系统、debug 工作流、spec-driven 开发流程）仍然需要用户：
1. 知道这些工具存在（信息差）
2. 装 npm 包或 git clone（环境门槛，尤其国内网络）
3. 命令行操作配置（学习成本）
4. 维护版本一致（升级痛点）

GSD（Get-Shit-Done by TÂCHES）是社区里最完整的 Claude Code 元提示词系统之一——63.7k stars，67 个斜杠命令覆盖从 ideate / spec / debug / spike 到 ship 的完整开发流程，33 个专门子 agent 解决各类细分任务。但用户要用上它，得先 `npx @opengsd/get-shit-done-redux@latest` 装一遍，还得选对 runtime。我们的用户里大多数装到一半就放弃了。

**"装完 CodePilot 就能用 GSD"** 是把生态产品力直接嵌进 CodePilot 的关键一步。

## 为什么是 GSD 而不是其他

候选名单里有几个项目：
- **GSD (`gsd-build/get-shit-done`)** — 63.7k star, MIT, 命令文件结构清晰、最容易嵌入
- **Awesome Claude Code prompts 合集** — 散落的 markdown，没有统一架构
- **个别 commands repo（如 wshobson/agents）** — 较小、定位单一

GSD 胜在：
1. **架构清晰**：commands 和 subagents 各自一个目录，没有运行时依赖（不像有些方案需要 Node 服务）
2. **设计取舍成熟**：v1.40+ 引入 namespace router 体系，复杂度有节制
3. **MIT 协议**：内置打包零法律风险
4. **GSD 命令本身就是文本提示词**：完全靠 Claude 解读，不依赖任何外部状态/数据库/服务

用户在最初提到的就是原始 archived `gsd-build/get-shit-done`——不是后来 fork 出去的 Redux 版本。选原始版还有一个额外好处：**仓库已归档，意味着内容稳定，不会一夜之间出现 breaking change**。对内置打包场景这是优点。

## 为什么不是"用户自己装"

实际上 CodePilot 现在已经支持 `~/.claude/commands/*.md` 全局扫描——用户完全可以自己 git clone GSD 然后放进去。我们也确实在 ChatListPanel 提示过这个能力。

但是观察用户实际行为：
- 国内用户 git clone GitHub 经常被网络卡住，clone 完一遍 50MB git history 是负担
- 装完不知道要不要做 colon→hyphen 替换（这是 GSD 官方 installer 的隐藏知识）
- 升级麻烦——很多用户装完一次就再也没动过
- agents 文件要单独再放到 `~/.claude/agents/`，多一个步骤就丢一半用户

**内置打包把"获取 → 安装 → 维护"三步合并到"安装 CodePilot"一步**。代价是 ~2MB 包体积和我们自己承担的维护责任（升级时手动 vendor）。这笔账划得来。

## 关键设计权衡

### 命名空间隔离 vs 共享全局

用户最初的诉求是"插件命名空间隔离，但命令名还是 gsd 官方的不能变"——这是个看似矛盾的要求，但实际可解：**文件系统隔离 + 命令名空间共享**。

- 文件落 `~/.claude/plugins/external_plugins/codepilot-gsd-vendor/`（独立目录，与官方安装不冲突）
- 命令名仍是 `/gsd-debug`（与 GSD 官方一致，用户已有的 muscle memory 可复用）
- popover 在用户已装官方 GSD 时同时显示两份，让用户选择

这避免了两个反模式：
- **不命名空间隔离**（直接装 `~/.claude/commands/`）：和用户原有安装冲突，无法可逆
- **强行加前缀变成 `/codepilot-gsd-*`**：违背 GSD 教程和文档的命名，用户每次复制官方文档示例都要改

### 同步策略：fire-and-forget vs 阻塞启动

每次启动都同步会让冷启动多几百 ms（67 个文件 + 33 个 agents = 100 次 fs.writeFile）。但版本戳对比只读两个 VERSION 文件——~1ms。所以默认策略是：
- 启动时读两边 VERSION，一致直接返回（绝大多数情况）
- 不一致时（首次安装或主程序升级带新 GSD 版本）异步同步，不阻塞主窗口

用户察觉不到。

### 冲突时不覆盖 + 持久化日志

如果用户改了 `~/.claude/agents/gsd-debugger.md`（比如改了 prompt 来适应自己的 codebase），我们的同步逻辑会检测 hash 不同，跳过这个文件，把它记到 `.conflicts.json`。Settings 面板看到 conflict count > 0 时显示警告条幅。

为什么不强制覆盖？因为这破坏了用户的预期——他们改的是 Claude 标准位置的文件，不是 CodePilot 内部资产。CodePilot 不该"知道"那个文件是给 GSD 用的、就有权擦掉用户改动。

为什么不在卸载时也跳过用户改动？同样道理——uninstall 只清理 hash 还匹配 bundle 的 agent 副本，保留用户改过的。这样卸载内置 GSD 不会误伤用户为其他工作流写的同名 agent。

## 实施中的发现

### Description 字段是个普惠 bug

实施过程中验证 `/api/skills` 返回时发现，所有带 frontmatter 的 .md 命令在 popover 里都显示 `---`（YAML 分隔符的第一行）。这不是 GSD 特有的——CodePilot 自己写的 `~/.claude/commands/` 用户文件、Claude Code 官方仓库示例命令，全都中招。

顺手在 `src/app/api/skills/route.ts:scanDirectory` 改了：先读 frontmatter `description:`，否则跳过 frontmatter 块取第一个非空行。**一行 GSD 的工作捎带修复了一个跨产品的小 bug**。这种"副作用收益"是内置插件之外的额外回报。

### 6 个 ns-* 文件的命名陷阱

GSD v1.40+ 的 namespace router 文件名（`ns-context.md`）和 frontmatter `name`（`gsd-context`）不一致——这是 GSD 故意做的，因为他们在 Claude Code 上跑的命令是按 frontmatter name 走的。如果我们按文件名直译就会产生 `/gsd-ns-context` 这种用户从没在 GSD 文档里见过的命令。

转换脚本里加了"读 frontmatter 优先于文件名"的逻辑后，6 个 ns 文件正确变成 `/gsd-context`、`/gsd-quality` 等——和 GSD 官方文档对得上。校验脚本会断言所有文件都满足这个一致性，未来 GSD 升级时若引入新的命名异常，第一时间能发现。

### "两个 AskUserQuestion" 的价值

实施前用了 3 轮 AskUserQuestion 收集决策（GSD 版本 / 安装位置 / Settings UI / Vendor 方式 / 冲突策略 / 同步时机），把不确定性都消除在动手前。第二轮用户的回答"插件命名空间隔离，但命令名还是 gsd 官方的不能变"——如果没问这个问题，我大概率会直接落到 `~/.claude/commands/` 全局目录或者加上 `codepilot-gsd-` 前缀，两个方案都偏离用户真实意图。

## 未来方向

### 1. 多个内置插件

PluginsManager.tsx 已经设计成多卡片容器，目前只有 GSD 一张卡片。理论上可以再嵌：
- **claude-flow / claude-swarm** 之类的多 agent 编排
- **CCCC（Claude Code Commands Collection）** 之类的精品命令合集
- 自家的"CodePilot 专属"工作流命令

每个新插件只需要：
1. vendor 一份源
2. 写转换脚本（如果命名约定和 GSD 不一样）
3. installer 复用 `gsd-installer.ts` 模式
4. PluginsManager 加一张卡片

### 2. 用户可调的 GSD 配置

GSD 自身有 `/gsd-config` 命令支持配置 plan 模式、verbose 程度等。未来可以把这些设置暴露到 Settings UI，免去用户在 chat 里跑命令的步骤。

### 3. 命令搜索 / 分类

67 个 `/gsd-*` 命令对新用户其实信息密度过高。GSD v1.40 的 namespace router（6 个 ns-* meta-skill）是他们自己给出的答案。但 popover UI 还没把它们分组高亮。后续可以让 popover 优先显示 6 个 namespace router，子命令按需展开。

### 4. 项目级覆盖

CodePilot 已经扫描项目级 `.claude/commands/`。如果用户在某个项目里需要禁用某个内置 GSD 命令（比如 `/gsd-debug` 和他们自家 debug 工具冲突），目前没法在项目级关掉。可以加项目级的"插件覆盖"配置。

## 外部参考

- [gsd-build/get-shit-done README](https://github.com/gsd-build/get-shit-done) — 项目介绍 + 67 命令列表
- [open-gsd/get-shit-done-redux](https://github.com/open-gsd/get-shit-done-redux) — 活跃的继任版本（用 skill 架构）
- [GSD docs/COMMANDS.md](https://github.com/gsd-build/get-shit-done/blob/main/docs/COMMANDS.md) — 命令字典
- [GSD docs/USER-GUIDE.md](https://github.com/gsd-build/get-shit-done/blob/main/docs/USER-GUIDE.md) — 用户指南
