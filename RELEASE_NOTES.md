## AI Native Lab v3.1.19

> 侧边栏体验改版:布局更清爽、常用入口按模式归位,并支持一键折叠侧边栏。

### 新增功能

- **侧边栏可以折叠了** — 侧边栏顶部新增折叠按钮,点击后整个侧边栏收起为一条细栏,给对话和工作区让出更多空间;细栏上保留展开和搜索入口,随时一键恢复。应用会记住你的折叠偏好,重启后保持
- **常用入口按模式归位** — 「文生图」跟随办公模式、「测试」跟随研发模式:切到哪个模式,侧边栏就只显示该模式用得上的入口,不再全部堆在底部

### 优化改进

- **侧边栏布局重排** — 「新对话」按钮从顶部大按钮改为轻量样式,移到 办公/研发 切换栏下方,视觉更安静、层级更清晰;搜索入口与折叠按钮并列于侧边栏顶部
- **入口样式统一** — 新对话、测试、文生图三个入口统一为同一种样式,消除了此前图标和文字颜色不一致的观感
- 切换到办公模式时会自动收起测试工作台,避免工作台停留在屏幕上无法关闭

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v3.1.19/CodePilot-3.1.19-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v3.1.19/CodePilot-3.1.19-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v3.1.19/CodePilot.Setup.3.1.19.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示,在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商(Anthropic / OpenRouter 等)
- 推荐安装 Claude Code CLI 以获得完整功能
