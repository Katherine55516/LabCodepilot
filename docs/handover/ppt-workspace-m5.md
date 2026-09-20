# PPT Workspace M5：`review → repair → publish` 质量门禁

更新时间：2026-09-20

## 1. 交付结果

生成链在内容页和媒体完成后依次进入 `review → repair → publish`。`publish` 只接受没有确定性硬错误的 Deck IR。普通保存、单页 AI 改写和模板切换会重新执行确定性检查与修复，但不会重复调用整稿模型。

### 1.1 九类版式注册表

`apps/cowork-server/lib/ppt-layout.mjs` 是唯一版式契约，版本为 `LAYOUT_VERSION = 1`。当前注册：

| ID | 版式 | 主要约束 |
|---|---|---|
| `cover` | 封面 | 1 条副标题，标题不小于 38 pt |
| `summary` | 摘要 | 最多 5 条要点 |
| `big-number` | 大数字 | 最多 3 条，核心数字居中 |
| `comparison` | 对比 | 双栏或两个视觉块 |
| `chart` | 图表 | 只接受原生图表块 |
| `table` | 表格 | 只接受原生表格块，正文不小于 13 pt |
| `image-text` | 图文 | 左图右文 |
| `timeline` | 时间线 | 最多 5 个阶段 |
| `conclusion` | 结论 | 最多 4 条，标题不小于 32 pt |

模型可建议 `layoutId`，但不能给坐标。缺少或无效版式时，代码按视觉块、页面位置和标题语义选择版式。PPTX、Web 预览、PDF 和质量检查消费同一 `layoutId`。

### 1.2 模板字体事实源

模板快照包含 `title/body/titleEastAsia/bodyEastAsia/cjkExplicit`。内置模板自带字体 token；上传 PPTX/POTX 从主题和实际文本 run 提取标题、正文及东亚字体。只有颜色和字体都能稳定提取的模板才是 `mapped`。

渲染器不再把所有模板统一成某个字体。每个标题、正文、图表、表格和形状分别使用模板的标题或正文字体，并写入 `<a:latin>` 与 `<a:ea>`。PDF 导出要求 Cowork 容器能精确找到模板字体，找不到时失败，不静默替换。内置模板使用 Cowork 镜像已安装的 Noto CJK 字体；任意自定义字体若要保证跨设备外观一致，仍需部署侧提供字体或后续实现合法字体嵌入。

## 2. 有界并行 DAG

`apps/cowork-server/lib/ppt-dag.mjs` 提供 `boundedAll`。同一项目默认最多 3 个 worker，硬上限也是 3：

```text
source:* 检查
      ↓
content:* ─────────┐
media:*   ─────────┤  有界并行，全部完成后 join
                   ↓
              review:deck
                   ↓
                 repair
                   ↓
              publish:deck
```

每个内容模型节点使用从 `projectId + nodeId` 派生的独立 Cowork sid/容器，避免并发 worker 共用 Claude HOME 或凭证目录。节点状态、结果、耗时和错误持久化到 `dagNodes`；恢复时复用成功节点。来源或媒体的质量发现由检查节点记录并汇总到最终门禁，不提前把生成任务打成普通失败。版本更新的 `keep` 页继续复用旧页，不占模型调用。

## 3. 自动检查与修复

`apps/cowork-server/lib/ppt-quality.mjs` 负责：

- 模板标题/正文字体 token 与中文东亚字体覆盖；
- 注册表的最小标题/正文字号；
- 由注册表固定区域推导的重叠；
- 前景/正文与背景的 WCAG 对比度；
- PNG/JPEG 可解码尺寸和低于 640×360 的清晰度警告；
- 版式允许的视觉块、页面密度、重复标题/要点；
- 来源编号有效性，以及含数字内容页的来源覆盖。

Repair 只做确定性动作：应用版式 fallback、删除完全重复要点、按版式上限收敛密度、把低对比度文字色调整为安全颜色。字体缺失、图片损坏、数字无来源等问题不会被猜测修复，会阻断发布。

空白页修复补充：跨页去重不能删除纯文本页的最后一个要点；图表、表格和图文版式缺少所需视觉块时自动回退到与现有内容匹配的版式；非封面页没有正文和视觉块时以 `content_empty` 阻断发布。摘要与结论页按编号纵向分布内容，避免短列表全部挤在画布上方。图表默认文本样式也显式写入模板字体，不再遗留 Office 默认 Calibri。

## 4. 一次整稿模型评审

初始生成只调用一次 `review:deck`。输入是 brief、压缩后的全稿、每页来源编号和来源摘录。模型无工具权限，只允许返回：

```json
{
  "missing": [],
  "repeated": [],
  "conflicts": [],
  "unsupported": []
}
```

服务端只保留合法 slide ID、detail 和证据不足项的 bullet index。坐标、字体、布局、改写文案及其他字段全部丢弃。模型发现属于内容 warning，写入质量报告供编辑器展示；确定性硬错误决定是否允许发布。

## 5. 状态与 UI

生成阶段依次显示 `source-check/content/review/repair/publish`。完成项目显示质量状态、自动检查发现数、阻断错误数、整稿评审发现数、修复数和模板标题/正文字体。编辑器可选择九类版式，预览按同一版式语义和模板字体 token 更新。

自动修复后仍有硬错误时，项目进入可持久化的 `quality_blocked` 状态：Deck IR 和报告保留并可继续编辑，PPTX/PDF 导出与演示入口关闭。用户保存修改后重新执行确定性 `review → repair`；通过后才渲染 PPTX、进入 `completed` 并开放导出。该保存不会再次调用整稿模型评审。

## 6. 文件地图

- `apps/cowork-server/lib/ppt-layout.mjs`：版式 registry、选择器、字号与区域契约。
- `apps/cowork-server/lib/ppt-dag.mjs`：有界并发与节点记录。
- `apps/cowork-server/lib/ppt-quality.mjs`：检查、修复、整稿评审契约、最终报告。
- `apps/cowork-server/lib/ppt-template.mjs`：模板颜色和字体提取/快照。
- `apps/cowork-server/lib/ppt-api.mjs`：DAG 和三阶段门禁编排。
- `apps/cowork-server/lib/ppt-render.mjs`：模板字体驱动的可编辑 PPTX。
- `apps/cowork-server/lib/ppt-pdf.mjs`：严格字体解析的 PDF。
- `src/components/ppt/PptWorkspace.tsx`：阶段、质量报告、九类版式和字体预览。
- `apps/cowork-server/selftest-ppt-m5.mjs`：M5 契约回归，包括发布阻断、可编辑修复和通过后发布。

## 7. 本地验证与部署边界

- M1–M5 Cowork server selftest 全部通过。
- TypeScript 与所改前端文件 ESLint 通过。
- PPT 浏览器用例 6/6 通过，验证发布阻断与修复、质量报告、模板字体展示、版式选择和预览变化；浏览器无页面脚本错误。
- 10 页样例的 PPTX 包完整性检查 0 finding；布局检查 0 finding、0 warning；包含 3 个原生图表。
- 本机 5 个确定性导出用例中位数约为 434/530/554/699/847 ms（3/8/10/20/30 页）。这些数字不包含模型、容器、网络和媒体生成。

本机没有部署新版远端 Cowork 控制面，不能把真实模型并行、容器冷启动、跨设备同步和 Windows PowerPoint 字体表现记为已验收。LibreOffice 本机也没有 Noto CJK，按严格模板字体渲染样例会缺中文；Cowork 镜像通过 `fonts-noto-cjk` 提供内置模板字体。上线前必须在部署镜像和目标 Office 客户端复验。
