---
name: office-cn
description: 中文办公文档与图表的必备规范。生成或修改 Word/Excel/PPT/PDF、以及用 matplotlib 画任何带中文的图表时，必须先读本规范。覆盖中文字体设置（不设则图表中文全是方块、Word 中文字体不生效）、A4 纸张（python-docx 默认是 Letter）、中文列宽与日期命名约定。Use this skill whenever producing or editing documents, spreadsheets, slides or charts whose content is in Chinese.
---

# 中文办公规范（沙箱环境）

本沙箱已预装 `python-docx` `python-pptx` `openpyxl` `xlsxwriter` `pdfplumber` `pypdf`
`pandas` `matplotlib` `pillow` `tabulate`，以及 Noto CJK 字体。**不需要 pip install。**

下面每段代码都已在本镜像内实测通过。中文场景有四个必踩的坑，逐个说明。

## 1. matplotlib 画中文图：不设字体就是一堆方块

matplotlib 默认字体不含汉字，中文标签会渲染成 `□□□`。**每个画图脚本开头都要设**：

```python
import matplotlib
matplotlib.use("Agg")                                    # 沙箱无显示器，必须用 Agg
matplotlib.rcParams["font.sans-serif"] = ["Noto Sans CJK SC"]
matplotlib.rcParams["axes.unicode_minus"] = False        # 否则负号显示为方块
import matplotlib.pyplot as plt
```

`axes.unicode_minus = False` 容易被漏掉：设了中文字体但没设它，**负数刻度的负号仍是方块**。

本镜像可用的 CJK 字体名（写错名字会静默回退到默认字体，图上就是方块）：

| 用途 | 字体名 |
|---|---|
| 简体黑体（默认首选） | `Noto Sans CJK SC` |
| 简体宋体（正式报告） | `Noto Serif CJK SC` |
| 等宽（代码/数字对齐） | `Noto Sans Mono CJK SC` |
| 繁体 / 港澳 | `Noto Sans CJK TC` / `Noto Sans CJK HK` |

自检：图存盘后若担心有方块，用 `warnings.simplefilter("error", UserWarning)`
包住绘图代码——缺字形时 matplotlib 会发 UserWarning，转成异常就能立刻发现。

## 2. Word 中文字体：只设 `font.name` 是不生效的

python-docx 的 `run.font.name` **只作用于西文**。中文字符由 OOXML 的 `w:eastAsia`
属性决定，必须单独设置，否则中文会回落到 Word 的默认字体：

```python
from docx import Document
from docx.shared import Pt, Mm
from docx.oxml.ns import qn

doc = Document()
p = doc.add_paragraph()
run = p.add_run("中文正文 mixed with English 123")
run.font.name = "Noto Sans CJK SC"                              # 西文
run.font.size = Pt(11)
run._element.rPr.rFonts.set(qn("w:eastAsia"), "Noto Sans CJK SC")  # ← 中文，必须
```

批量设置时把它写成一个函数复用：

```python
def set_cn_font(run, name="Noto Sans CJK SC", size=11):
    run.font.name = name
    run.font.size = Pt(size)
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
```

改整篇文档默认样式（比逐个 run 设更省事）：

```python
style = doc.styles["Normal"]
style.font.name = "Noto Sans CJK SC"
style.font.size = Pt(11)
style.element.rPr.rFonts.set(qn("w:eastAsia"), "Noto Sans CJK SC")
```

## 3. 纸张：python-docx 默认是 Letter，不是 A4

实测新建文档为 **216 × 279 mm（Letter）**。国内办公一律用 A4，打印才不会错位：

```python
from docx.shared import Mm
for section in doc.sections:
    section.page_width  = Mm(210)      # A4
    section.page_height = Mm(297)
    section.left_margin = section.right_margin = Mm(25)
    section.top_margin  = section.bottom_margin = Mm(25)
```

横向（宽表格场景）要**同时**换 orientation 和交换宽高，只设 orientation 无效：

```python
from docx.enum.section import WD_ORIENT
section.orientation = WD_ORIENT.LANDSCAPE
section.page_width, section.page_height = Mm(297), Mm(210)
```

## 4. Excel 中文列宽：按字符数算会偏窄

openpyxl 的 `column_dimensions[x].width` 单位是「字符宽度」，
一个汉字实际约占 **2 个**。按 `len(字符串)` 设宽会导致中文列显示不全：

```python
from openpyxl.utils import get_column_letter

def cn_len(s):
    """汉字算 2，其余算 1"""
    return sum(2 if "一" <= ch <= "鿿" else 1 for ch in str(s))

for col_idx, col in enumerate(ws.iter_cols(), start=1):
    width = max((cn_len(c.value) for c in col if c.value is not None), default=8)
    ws.column_dimensions[get_column_letter(col_idx)].width = min(width + 2, 60)
```

中文表头建议加自动换行与居中，否则长标题会串到相邻列：

```python
from openpyxl.styles import Alignment
for c in ws[1]:
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
```

## 5. PPT 中文字体

PPT 比 Word 更麻烦：python-pptx **没有**提供东亚字体的便捷 API
（`CT_TextCharacterProperties` 上没有 `get_or_add_ea`），必须手动插 `<a:ea>` 子元素：

```python
from pptx.util import Pt
from pptx.oxml.ns import qn

def set_cn_text(text_frame, name="Noto Sans CJK SC", size=18):
    for para in text_frame.paragraphs:
        for run in para.runs:
            run.font.name = name          # 建 <a:latin>（西文）
            run.font.size = Pt(size)
            rPr = run.font._rPr
            ea = rPr.find(qn("a:ea"))     # <a:ea> 才是东亚字体（中文）
            if ea is None:
                ea = rPr.makeelement(qn("a:ea"), {})
                latin = rPr.find(qn("a:latin"))
                # schema 要求顺序 latin -> ea -> cs，插错位置 PowerPoint 可能拒绝打开
                latin.addnext(ea) if latin is not None else rPr.append(ea)
            ea.set("typeface", name)
```

⚠️ **不要写成 `rPr.set(qn("a:eastAsian"), name)`**。那是给 `a:rPr` 加了一个自定义
*属性*，XML 允许所以代码不报错、也能正常保存，但 PowerPoint 完全不认——中文字体
静默失效。正确结果是 `<a:ea>` 作为**子元素**存在：

```xml
<a:rPr><a:latin typeface="Noto Sans CJK SC"/><a:ea typeface="Noto Sans CJK SC"/></a:rPr>
```

自检（这类"能跑但无效"的问题只能靠查 XML 发现）：

```python
import zipfile
xml = zipfile.ZipFile("out.pptx").read("ppt/slides/slide1.xml").decode("utf8")
assert "<a:ea typeface=" in xml, "东亚字体没设上，中文会回落到默认字体"
```

## 6. 命名与日期约定

- 文件名用中文可以，但**不要含空格**，用下划线：`销售月报_2026-07.xlsx`
- 日期统一 `YYYY-MM-DD`（`2026-07-30`），不要用 `07/30/26` 这种有歧义的写法
- 金额标注单位，别让读者猜：`金额（万元）`
- 产出文件放在 `/workspace` 下，用户才能在「沙箱产物」里看到并下载

## 交付前自检

1. 图表里的中文和负号是否都正常（没有 `□`）
2. Word 是否 A4、中文字体是否真的生效（不只设了 `font.name`）
3. Excel 中文列是否显示完整
4. 文件是否存到了 `/workspace`
