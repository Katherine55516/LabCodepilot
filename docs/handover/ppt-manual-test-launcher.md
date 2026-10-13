# 本机 PPT 手动测试启动器

入口固定为 http://127.0.0.1:3141/ppt。此启动器用于当前 Mac 和现有隔离工作目录。

## 使用

在 Finder 中双击 `scripts/ppt/start-manual-test.command`，或在本工作目录运行：

```sh
./scripts/ppt/start-manual-test.command
```

脚本优先复用健康的 3140/3141 服务；服务未运行时后台启动生产 PPT API 和已构建的前端快照，并打开 Google Chrome。终端退出不会停止后台服务。页面上的新建、输入/上传、模型选择、大纲确认、生成、编辑和导出均使用产品原有接口。

```sh
./scripts/ppt/start-manual-test.command status
./scripts/ppt/start-manual-test.command check-llm --no-open
./scripts/ppt/start-manual-test.command stop
```

`check-llm` 发送一个最小真实模型请求，会使用已配置 API 的额度。`stop` 只停止此脚本启动的服务，不接管或停止其他已经运行的测试服务。生成时请保持网页打开，以便浏览器中的生产 BYOK worker 持续领取任务；可以返回本应用 Home 查看进度。

## 真实配置与持久化

- 本机非密启动配置：`outputs/ppt-manual-testing/launch-config.json`，文件权限 600，记录端口、运行目录与已构建前端位置。
- 现有凭据源：`~/.aimate-api-development`；主密钥读取已有 macOS 钥匙串项目 `AIMate API Development Master Key`。脚本不要求粘贴 API Key，也不把主密钥写入脚本或配置文件。
- 手动测试 profile/项目/文件继续使用既有 `PPT_IMPLEMENTATION_OUTPUT`，重新启动保留历史项目。API Key 经现有加密 DB 层读取，模型默认沿用已配置默认模型；本轮实测为 qwen3.8-max。
- 2026-10-13 同源比较测试已将配置切至 `outputs/ppt-gamma-semantic-improvements-20261013/live` 与 `frontend-snapshot/.next`。这是既有加密配置和项目状态的独立副本，原测试目录保留；新项目文件写入新 workspace。重新启动继续使用此副本，不覆盖原库。服务沿用 profile 中已有认证 token，避免前端会话因重新启动失效。
- 新服务入口 `scripts/ppt/manual-test-service.mjs` 使用生产 `handlePpt`、模型队列和真实 parser/exporter；本地测试只把容器文件 IO 映射到本机测试 workspace。没有伪造模型响应或关闭质量门禁。
- Node.js 22 从当前已安装 nvm 路径启动；可用 `PPT_NODE_BIN` 指定另一 Node.js 22+。前端使用已构建生产快照，不执行安装、重建或自动合并。
- 在页面的 API 设置修改当前测试 profile 的 provider/model 后，页面新项目按选择使用该配置。启动器读取 source 默认模型用于冷启动；重用已有服务时保留该服务的当前默认配置。

## 验证

- 启动器语法检查及从工作目录外执行 status 通过。
- 固定 3141 页面、生产项目 API 和既有真实 provider 连接测试通过。
- Google Chrome CDP 实际点击“新建 → 粘贴文本 → 确认 LLM”，qwen3.8-max 可选并进入创建向导；浏览器 pageerror 为 0。
- 新服务在独立 3160/3161 冷启动验证：创建独立测试 profile，生产 API 就绪、真实模型连接测试成功；随后只清理本轮独立服务，既有 3140/3141 保持运行。
- 证据位于 `outputs/ppt-manual-testing/`：`llm-check.json`、`cold-start-check.json`、`browser-check.json` 和截图。此验证证明可启动、可点击且真实 LLM 可调用，不代表任何完整 PPT 内容已通过质量验收。

如果端口被不兼容进程占用、钥匙串不可读或前端快照缺失，脚本明确退出并保留已有服务/数据。新服务日志为 `outputs/ppt-manual-testing/service.log`。
