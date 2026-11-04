// Every supported input format, in English, Simplified Chinese and Traditional
// Chinese (Hong Kong), must reach the planner with the same document structure:
// title and section headings in order, tables in document position with their
// tail row, list numbering, numbers as displayed, and no running page furniture.
// The deterministic estimate (the syllabus skeleton) must run on each result.
import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { spawnSync } from 'node:child_process';
import { localPptRuntime } from './test/ppt-local-runtime.mjs'; import { extractFile, validateFile } from './lib/ppt-source.mjs'; import { estimatePageRecommendation } from './lib/ppt-planning.mjs';

const out = process.env.PPT_FORMAT_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-syllabus-')), python = process.env.PPT_TEST_PYTHON || 'python3';
fs.mkdirSync(out, { recursive: true }); const runtime = localPptRuntime(out, python), report = [];
const LANGS = {
  en: { title: 'Alpha Mining Guide', sections: ['Search Space', 'Evaluation Gauntlet'], para1: 'Search over 10^6 candidate formulas and keep 5% of them.',
    list: ['Data audit', 'IC decay', 'Pool correlation'], table: [['Metric', 'Value'], ['IC', '0.05'], ['Turnover', '20%'], ['Tail', 'kept']], para2: 'Every candidate is recorded in the graveyard.',
    continued: 'Continued: rejected candidates stay in the trial count.', txtHeadings: (t, a, b) => [t, '', '1 ' + a, '', null, '2 ' + b], encoding: 'utf-16' },
  zh: { title: '因子挖掘指南', sections: ['搜索空间', '评估关卡'], para1: '在 10^6 个候选公式中搜索，保留其中 5%。', list: ['数据审查', 'IC 衰减', '因子池相关性'],
    table: [['指标', '数值'], ['IC', '0.05'], ['换手', '20%'], ['尾行', '保留']], para2: '每个候选都记录在候选坟场中。', continued: '续：被拒绝的候选仍计入试验次数。',
    txtHeadings: (t, a, b) => [t, '', '一、' + a, '', null, '二、' + b], encoding: 'gb18030' },
  'zh-HK': { title: '營運風險指南', sections: ['搜尋空間', '評估關卡'], para1: '在 10^6 個候選公式中搜尋，保留其中 5%。', list: ['數據審查', 'IC 衰減', '因子池相關性'],
    table: [['指標', '數值'], ['IC', '0.05'], ['換手', '20%'], ['尾行', '保留']], para2: '每個候選都記錄在候選墳場中。', continued: '續：被拒絕的候選仍計入試驗次數。',
    txtHeadings: (t, a, b) => [t, '', '第一章 ' + a, '', null, '第二章 ' + b], encoding: 'big5hkscs' },
};
const md = l => ['---', 'title: ' + l.title, 'lang: x', '---', '', '## ' + l.sections[0], '', l.para1, '', ...l.list.map((x, i) => `${i + 1}. ${x}`), '',
  ...l.table.map((r, i) => '| ' + r.join(' | ') + ' |' + (i === 0 ? '\n| ' + r.map(() => '---').join(' | ') + ' |' : '')), '', '## ' + l.sections[1], '', l.para2, ''].join('\n');
const txt = l => { const [t, b1, a, b2, , b] = l.txtHeadings(l.title, ...l.sections);
  return [t, b1, a, b2, l.para1, '', ...l.list.map((x, i) => `${i + 1}. ${x}`), '', ...l.table.map(r => '| ' + r.join(' | ') + ' |'), '', b, '', l.para2, ''].join('\n'); };
const html = l => `<!doctype html><html><head><meta charset="utf-8"><title>${l.title}</title><style>p{color:red}</style></head><body><nav><a href="/">Home menu</a></nav>
<h2>${l.sections[0]}</h2><p>${l.para1.replace('10^6', '10<sup>6</sup>')} <strong>${l.list[0]}</strong></p><ol>${l.list.map(x => `<li>${x}</li>`).join('')}</ol>
<table>${l.table.map((r, i) => '<tr>' + r.map(c => i ? `<td>${c}</td>` : `<th>${c}</th>`).join('') + '</tr>').join('')}</table><h2>${l.sections[1]}</h2><p>${l.para2}</p></body></html>`;
const py = (code, ...args) => { const r = spawnSync(python, ['-c', code, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
const CJK_FONT = `\nfrom reportlab.pdfbase import pdfmetrics\nfrom reportlab.pdfbase.cidfonts import UnicodeCIDFont\npdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))\n`;

function blocksOf(source) { return source.semantic.blocks; }
function assertStructure(kind, lang, source, l, { title = true, sections = l.sections, prose = true } = {}) {
  const blocks = blocksOf(source), headings = blocks.filter(b => b.type === 'heading').map(b => b.text.trim());
  const wanted = [...(title ? [l.title] : []), ...sections], at = wanted.map(h => headings.findIndex(x => x.includes(h)));
  assert.ok(at.every(i => i >= 0), `${kind}/${lang}: headings ${JSON.stringify(headings)} miss ${JSON.stringify(wanted)}`);
  assert.ok(at.every((v, i) => !i || v > at[i - 1]), `${kind}/${lang}: heading order ${JSON.stringify(headings)}`);
  const tail = l.table.at(-1)[0], table = blocks.find(b => b.type === 'table' && b.text.includes(tail));
  assert.ok(table, `${kind}/${lang}: table tail row missing`);
  assert.ok(table.sectionPath.some(s => s.includes(sections[0])), `${kind}/${lang}: table left its section ${JSON.stringify(table.sectionPath)}`);
  const second = blocks.find(b => b.type === 'heading' && b.text.includes(sections[1]));
  if (second) assert.ok(table.position < second.position, `${kind}/${lang}: table moved after the next section`);
  assert.ok((!prose || source.text.includes('5%')) && source.text.includes('20%'), `${kind}/${lang}: percentages changed`);
  const estimate = estimatePageRecommendation({ inputKind: 'file', source, prompt: '', generationPolicy: {} });
  assert.ok(estimate.recommended >= 2 && estimate.recommended <= 100, `${kind}/${lang}: estimate ${estimate.recommended}`);
  assert.ok(!estimate.warnings.some(w => w.code === 'capacity_estimate_failed'), `${kind}/${lang}: estimate failed`);
  const allocation = (estimate.sectionAllocation || []).map(s => s.title).join(' / ');
  report.push({ kind, lang, headings, tableSection: table.sectionPath, recommended: estimate.recommended, allocation, warnings: (source.mediaWarnings || []).map(w => w.code) });
  return { blocks, headings, estimate };
}
const ordered = (text, items) => { const at = items.map((x, i) => text.indexOf(`${i + 1}. ${x}`)); return at.every(i => i >= 0) && at.every((v, i) => !i || v > at[i - 1]); };

for (const [lang, l] of Object.entries(LANGS)) {
  const dir = path.join(out, lang); fs.mkdirSync(dir, { recursive: true });
  // Markdown with YAML front matter: the title comes from metadata, not prose.
  const fromMd = await extractFile({ id: 'md-' + lang, uid: 'f' }, 'guide.md', Buffer.from(md(l)), runtime.io);
  assert.ok(!fromMd.text.includes('lang: x'), 'front matter leaked into prose');
  assert.ok(ordered(fromMd.text, l.list)); assertStructure('md', lang, fromMd, l);

  // Plain text: UTF-8 and the legacy encoding a regional editor would write.
  for (const encoding of ['utf-8', l.encoding]) {
    const text = txt(l), bytes = encoding === 'utf-8' ? Buffer.from(text) : Buffer.from(spawnSync(python, ['-c', `import sys;sys.stdout.buffer.write(sys.stdin.read().encode('${encoding === 'utf-16' ? 'utf-16' : encoding}'))`], { input: Buffer.from(text) }).stdout);
    assert.equal(validateFile('guide.txt', bytes), 'txt');
    const fromTxt = await extractFile({ id: 'txt-' + lang + encoding, uid: 'f' }, 'guide.txt', bytes, runtime.io);
    assert.ok(fromTxt.text.includes(l.para2), `txt/${encoding}: decoded text differs`);
    assert.ok(ordered(fromTxt.text, l.list), `txt/${encoding}: numbered list`);
    assertStructure('txt-' + encoding, lang, fromTxt, l);
    if (encoding !== 'utf-8' && encoding !== 'utf-16') assert.ok(fromTxt.mediaWarnings.some(w => w.code === 'source_text_encoding' && !w.required));
  }

  // HTML: <title> names the document when there is no <h1>; nav is not content.
  const fromHtml = await extractFile({ id: 'html-' + lang, uid: 'f' }, 'guide.html', Buffer.from(html(l)), runtime.io);
  assert.ok(!fromHtml.text.includes('Home menu') && !fromHtml.text.includes('color:red'));
  assert.ok(fromHtml.text.includes('10⁶'), 'html superscript digits must not merge into 106');
  assert.ok(fromHtml.text.includes(`**${l.list[0]}**`), 'html strong emphasis lost');
  assert.ok(ordered(fromHtml.text, l.list), 'html ordered list numbering lost'); assertStructure('html', lang, fromHtml, l);

  // DOCX: Title style, Heading 1, List Number, a merged header cell, table between sections.
  const docx = path.join(dir, 'guide.docx');
  py(`import json,sys\nfrom docx import Document\nl=json.loads(sys.argv[2]);d=Document();d.add_heading(l['title'],0);d.add_heading(l['sections'][0],1);d.add_paragraph(l['para1'])\nfor x in l['list']:d.add_paragraph(x,style='List Number')\nt=d.add_table(rows=len(l['table'])+1,cols=2)\na=t.cell(0,0).merge(t.cell(0,1));a.text=l['title']\nfor r,row in enumerate(l['table'],1):\n  for c,v in enumerate(row):t.cell(r,c).text=v\nd.add_heading(l['sections'][1],1);d.add_paragraph(l['para2']);d.save(sys.argv[1])`, docx, JSON.stringify(l));
  const fromDocx = await extractFile({ id: 'docx-' + lang, uid: 'f' }, 'guide.docx', fs.readFileSync(docx), runtime.io);
  assert.ok(ordered(fromDocx.text, l.list), 'docx List Number numbering lost');
  assert.equal(fromDocx.text.split(l.title).length - 1, 2, 'docx merged header cell duplicated');
  assert.ok(fromDocx.mediaWarnings.some(w => w.code === 'source_table_span' && !w.required));
  assertStructure('docx', lang, fromDocx, l);

  // XLSX: one sheet per section; Excel formats; formula without cached value.
  const xlsx = path.join(dir, 'guide.xlsx');
  py(`import json,sys,datetime\nfrom openpyxl import Workbook\nl=json.loads(sys.argv[2]);w=Workbook();s=w.active;s.title=l['sections'][0]\nfor r,row in enumerate(l['table'],1):\n  for c,v in enumerate(row,1):\n    if v.endswith('%'):cell=s.cell(r,c,float(v[:-1])/100);cell.number_format='0%'\n    else:s.cell(r,c,v)\ns.cell(len(l['table'])+3,1,'2026-10-10 date');s.cell(len(l['table'])+3,2,datetime.datetime(2026,10,10))\ns.cell(len(l['table'])+4,1,'sum');s.cell(len(l['table'])+4,2,'=1+1')\nb=w.create_sheet(l['sections'][1]);b.append(['#','item'])\nfor i,x in enumerate(l['list'],1):b.append([i,x])\nb.append([1234567.5,'amount']);b.cell(b.max_row,1).number_format='#,##0.00'\nw.save(sys.argv[1])`, xlsx, JSON.stringify(l));
  const fromXlsx = await extractFile({ id: 'xlsx-' + lang, uid: 'f' }, 'guide.xlsx', fs.readFileSync(xlsx), runtime.io);
  assert.ok(fromXlsx.text.includes('2026-10-10') && !fromXlsx.text.includes('00:00:00'), 'xlsx date format');
  assert.ok(fromXlsx.text.includes('1,234,567.50'), 'xlsx thousands format');
  assert.ok(!/\|\s*\|\s*\|/u.test(fromXlsx.text), 'xlsx kept an empty separator row');
  assert.ok(fromXlsx.mediaWarnings.some(w => w.code === 'source_xlsx_formula_uncached' && w.required), 'uncached formula must be reported');
  assertStructure('xlsx', lang, fromXlsx, l, { title: false, prose: false });

  // PDF: heading sizes, running footer + page numbers, a section crossing pages.
  const pdf = path.join(dir, 'guide.pdf');
  py(`import json,sys\nfrom reportlab.pdfgen import canvas${CJK_FONT}l=json.loads(sys.argv[2]);c=canvas.Canvas(sys.argv[1])\ndef footer(n):\n  c.setFont('STSong-Light',9);c.drawString(40,40,'Confidential draft');c.drawString(520,40,str(n))\ndef line(y,text,size=11):\n  c.setFont('STSong-Light',size);c.drawString(40,y,text)\nline(780,l['title'],22);line(740,l['sections'][0],16);line(710,l['para1'])\nfor i,x in enumerate(l['list']):line(690-i*18,'%d. %s'%(i+1,x))\nfor x in [40,200,360]:c.line(x,450,x,590)\nfor y in [450,485,520,555,590]:c.line(40,y,360,y)\nfor i,row in enumerate(l['table']):\n  line(570-i*35,row[0]);c.drawString(210,570-i*35,row[1])\nfooter(1);c.showPage();line(780,l['continued']);line(740,l['sections'][1],16);line(710,l['para2']);footer(2);c.showPage();line(780,l['para2']);footer(3);c.save()`, pdf, JSON.stringify(l));
  const fromPdf = await extractFile({ id: 'pdf-' + lang, uid: 'f' }, 'guide.pdf', fs.readFileSync(pdf), runtime.io);
  assert.ok(!fromPdf.text.includes('Confidential draft'), 'pdf running footer kept');
  assert.ok(!/^\s*[123]\s*$/mu.test(fromPdf.text), 'pdf page numbers kept');
  const { blocks: pdfBlocks } = assertStructure('pdf', lang, fromPdf, l);
  const continued = pdfBlocks.find(b => b.text.includes(l.continued.slice(0, 6)));
  assert.ok(continued?.sectionPath.some(s => s.includes(l.sections[0])), 'pdf section did not continue across the page break');

  // PPTX: title placeholders become the section headings.
  const pptx = path.join(dir, 'guide.pptx');
  py(`import json,sys\nfrom pptx import Presentation\nfrom pptx.util import Inches\nl=json.loads(sys.argv[2]);p=Presentation();s=p.slides.add_slide(p.slide_layouts[0]);s.shapes.title.text=l['title']\ns=p.slides.add_slide(p.slide_layouts[5]);s.shapes.title.text=l['sections'][0];b=s.shapes.add_textbox(Inches(1),Inches(1.5),Inches(8),Inches(1)).text_frame;b.text=l['para1']\nt=s.shapes.add_table(len(l['table']),2,Inches(1),Inches(3),Inches(6),Inches(2)).table\nfor r,row in enumerate(l['table']):\n  for c,v in enumerate(row):t.cell(r,c).text=v\ns=p.slides.add_slide(p.slide_layouts[5]);s.shapes.title.text=l['sections'][1];s.shapes.add_textbox(Inches(1),Inches(1.5),Inches(8),Inches(1)).text_frame.text=l['para2']\np.save(sys.argv[1])`, pptx, JSON.stringify(l));
  const fromPptx = await extractFile({ id: 'pptx-' + lang, uid: 'f' }, 'guide.pptx', fs.readFileSync(pptx), runtime.io);
  assertStructure('pptx', lang, fromPptx, l);

  // CSV carries a single table and no headings; the tail row must survive.
  const fromCsv = await extractFile({ id: 'csv-' + lang, uid: 'f' }, 'guide.csv', Buffer.from(l.table.map(r => r.join(',')).join('\n')), runtime.io);
  assert.ok(fromCsv.semantic.blocks.some(b => b.type === 'table' && b.text.includes(l.table.at(-1)[0])));
  report.push({ kind: 'csv', lang, recommended: estimatePageRecommendation({ inputKind: 'file', source: fromCsv, prompt: '' }).recommended });
}
assert.throws(() => validateFile('guide.txt', Buffer.from([0xff, 0xff, 0x00, 0x01])), /UTF-8|binary/);
fs.writeFileSync(path.join(out, 'syllabus-report.json'), JSON.stringify(report, null, 2));
console.log(`Input formats × zh/en/zh-HK → structure and syllabus estimate: passed (${report.length} cases)`);
