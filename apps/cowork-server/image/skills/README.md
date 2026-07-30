# 沙箱预制 Agent Skills

镜像构建时整目录拷进 `/opt/cowork-skills`(只读),由 `container/cowork-shim.py` 在启动
claude 前逐个软链到 `~/.claude/skills/`。**升级 skill = 重建镜像**,与 claude 二进制同一
版本单元。

## 清单

| Skill | 来源 | License | 说明 |
|---|---|---|---|
| `docx-manipulation` | [claude-office-skills](https://github.com/claude-office-skills/skills) | MIT | python-docx，14 个代码块 |
| `xlsx-manipulation` | 同上 | MIT | openpyxl，15 个代码块，**已修 3 处错误** |
| `pptx-manipulation` | 同上 | MIT | python-pptx，16 个代码块 |
| `pdf-extraction` | 同上 | MIT | pdfplumber，18 个代码块 |
| `office-cn` | 本仓库自写 | 随本仓库 | 中文办公规范（字体/纸张/列宽） |

MIT 要求保留版权与许可全文 → `LICENSE-claude-office-skills.txt`,勿删。

## 对上游做的修正

`xlsx-manipulation` 原文有 3 处会直接报错或误导的示例,已改:

1. `from openpyxl.styles import ... Fill ...` ×2 → `PatternFill`。`Fill` 虽可 import
   (它是基类)但不能用于设置单元格填充色。
2. `ws['A1:C1'] = [['Col1','Col2','Col3']]` → 改为 `ws.append([...])`。openpyxl **不支持
   区间赋值**,`ws['A1:C1']` 返回 cell 元组,原写法直接 `TypeError`。

其余 3 个 skill 的 API 已逐一核对(python-docx 的 `WD_ORIENT`/`paragraph_format`、
python-pptx 的 `CategoryChartData`/`XL_CHART_TYPE`、pdfplumber 的 `.crop()`/
`extract_tables()`),无误。

## 为什么只有 5 个 —— 被排除的和原因

同批评估过、**刻意不装**的:

| 排除项 | 原因 |
|---|---|
| 官方 `docx`/`pdf`/`pptx`/`xlsx` | LICENSE.txt 明文禁止在服务外保留副本、复制、再分发 |
| `contract-review` | 依赖仓库内 `mcp-servers/office-mcp/knowledge/*.json`,预制后路径必然失效;且 20 处英美法系术语,法律场景误导风险高 |
| `data-analysis`、`pdf-merge-split` | **零 python 代码块**,agent 本就会 pandas / pypdf,纯占 context |
| `meeting-notes`、`weekly-report`、`email-drafter` | 含中文行数 **0**,纯英文模板,中文办公用不上 |
| `chart-designer` | 面向 ECharts / Chart.js 等 **Web 图表库**,会误导 agent 去产出前端配置,而沙箱要的是 matplotlib 静态图 |
| `pdf-ocr`、`table-extractor`、`md-to-office`、`report-generator` | 依赖镜像未装的 tesseract / camelot+ghostscript / pandoc / reportlab |

**克制是有成本考量的**:每个 skill 的 `description` 都会进 system prompt 做渐进式披露,
装得越多每轮对话的 context 开销越大。宁可 5 个精准的,不要 40 个大杂烩。

## 增删 skill

1. 在本目录建 `<name>/SKILL.md`(frontmatter 需含 `name` 与 `description`)
2. `./build-image.sh` 重建镜像
3. `docker rm -f cowork-proxy && systemctl restart cowork-server`
4. 存量会话容器仍是旧镜像 —— TTL 回收或删除后新建的才生效

**新增前先确认依赖已在镜像里**(见 Dockerfile 的 pip 清单),否则 agent 会在回合中
`pip install`,在共享带宽下是明显的卡顿点。

## 注意

- 只放 **Markdown**,不要放可执行脚本:预制内容会以 agent 身份进入沙箱,纯文档零执行风险
- 软链是逐个建的,同名时**不覆盖**已存在项 —— 用户自建的同名 skill 优先
- 非 bundled 模式(`COWORK_IMAGE_BUNDLED` 未设)下 orchestrator 会把宿主 assets 挂到
  `/opt/cowork:ro`;预制目录刻意放在 `/opt/cowork-skills` 就是为了不被那次挂载遮蔽
