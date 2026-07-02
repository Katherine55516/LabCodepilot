# 内置 AI_LabTest —— 产品思考

> 技术实现见 [docs/handover/ailab-plugin.md](../handover/ailab-plugin.md)

## 用户问题

AI_LabTest 是一套把 Claude Code 当 QA 自动化工程师的方法论插件(用例设计 → AI 实时驱动 Playwright 执行 → 报告)。它原本通过 `/plugin marketplace add` + `/plugin install` 安装,但在 CodePilot 里有两个落地障碍:

1. **安装门槛**:普通用户不会用 marketplace 命令,且国内网络 clone/npm 常失败。
2. **provider 作用域失效**:CodePilot 多数用户跑自定义/DB 服务商(非 Anthropic),SDK 的插件命令解析走 provider 作用域能力缓存,在非 Anthropic provider 下不被填充 —— 即便 `enabledPlugins` 置真,`ai-lab-test:*` 命令也不出现在选择器。这与内置 GSD 遇到的是同一类问题。

目标因此收敛为:**把它像 GSD 一样随包内置,用户在设置里一键启用即可正常运行(命令 + 技能 + Playwright 全可用),不依赖 provider 类型。**

## 为什么这样设计

**形态对齐 GSD(vendored 内置 + 全局镜像 + `builtIn:true`)。** 这是本仓库已验证、provider 无关的唯一可靠路径:全局 `~/.claude/commands` 直接被读盘注入,不经 SDK 能力缓存。复用同一条 vendor 流水线,降低维护面与认知成本。

**默认关闭,而非 GSD 的默认开启。** 用户的诉求原文是"**启用时**就可以正常运行" —— 这天然意味着它是一个可开关、按需启用的插件,而不是常驻。默认关闭也让"启用"成为注册 Playwright MCP 的明确时机(见下),避免开机就静默改 `~/.claude.json`。

**命名空间用子目录而非平面化。** GSD 把命令拍平成 `gsd-x`,但 AI_LabTest 的产品语言、`.claude/settings.json` 白名单、命令正文交叉引用都是 `ai-lab-test:cases` 这种冒号命名空间。强行平面成 `ai-lab-test-cases` 既不符合插件原貌,也要额外改写文件名(命令文件无 `name` frontmatter,文件名即 ID)。用全局命令子目录 `commands/ai-lab-test/` 让扫描器自然得到 `ai-lab-test:<stem>`,零改名、贴合原貌。

**"停用即消失"做成真删,而非 GSD 的标记式停用。** GSD 停用只改插件目录、保留全局镜像(命令其实仍可跑)——对 GSD 无伤,但与"停用"的用户预期不符。AI_LabTest 的命名空间目录由 installer 独占,停用时整目录删除,命令/技能从选择器真正消失,语义干净。

**`${CLAUDE_PLUGIN_ROOT}` 在安装时改写为绝对路径。** 这是 AI_LabTest 相对 GSD 最隐蔽、也最关键的一处。命令/技能用该占位符引用方法论资产,而全局镜像副本没有运行时 plugin root,占位符不会被替换,资产读不到、流程就断。安装时机是唯一能确定本机 home 的时刻,故在镜像时把占位符替换为真实插件目录路径——这正是 GSD"冒号→连字符"改写的功能对等物。

**Playwright MCP 走 app 自己的 MCP 配置,而非依赖 `.mcp.json` 自启。** 全局镜像不会启动插件的 `.mcp.json`。为兑现"正常运行"(`execute` 要真驱动浏览器),启用时由前端卡片幂等写入 `~/.claude.json` 的 `playwright` 服务器,复用本仓库已为该 npx 形式 MCP 修好的 shadow-HOME/连接超时链路(commit `4005415`/`51b79a7`),并命中 `mcp__playwright` 的硬编码自动批准。停用不删 MCP:它是通用工具、可能被别处用、空转无害——删它属于过度副作用。

## 与 GSD 的取舍对比

| 取舍 | 选择 | 理由 |
|------|------|------|
| 脚本/installer | 复制 GSD 三件为 ai-lab 专用,而非抽象成通用管线 | 风险隔离、不动正在工作的 GSD 链路;有第三个插件时再抽象 |
| 默认状态 | 关闭 | 贴合"启用时"语义 + 启用是注册 MCP 的明确时机 |
| 命名空间 | 子目录(冒号) | 贴合插件原貌,零改名 |
| 停用 | 真删命名空间目录 | 语义干净,优于 GSD 的标记式 |
| MCP 删除 | 停用不删 | 通用工具,避免副作用 |

## 未来方向 / 局限

- **通用化**:GSD + AI_LabTest 两套近似的 vendor 脚本/installer,出现第 3 个内置插件时值得抽象成"配置表驱动的通用插件管线"(`vendor-plugin-prepare.js` + 参数化 installer)。当前刻意不做,避免改动正在工作的 GSD。
- **设置面板仍是硬编码卡片**:`PluginsManager` 目前为每个内置插件硬编码一张卡片(GSD、AI_LabTest)。插件多了应改为数据驱动列表。
- **Playwright 冷启动**:首次冷机仍可能因 npx 下载/浏览器未装而首跑较慢或失败,理想做法是启用时后台预热 `playwright install chromium`,当前先以文档/告警兜底。
- **版本更新**:更新插件需重跑 `vendor:ailab` 刷新快照 + 提 `SNAPSHOT.md` commit + 递增 `TRANSFORM_VERSION`,目前手动;可考虑 CI 定期跟随上游 tag。
