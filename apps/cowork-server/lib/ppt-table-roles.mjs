/** Source tables in decks. Since the hand deck (the user, 2026-11-02
 * evening) no table is drawn: comparison points on the slide, the whole
 * table in the notes (documentWrittenTable, tableNotePoints). The shapes
 * below still name a table's kind. History: which source tables a document deck showed as tables (Fable 2026-11-01,
 * 3186 docx on Mood-Board: 19 of 21 content pages were one table each, most
 * of them two-column "name | explanation" lists). Decided in code before the
 * writer runs, so the writer is offered only the tables it may show:
 * A  a key-value table (2 columns, at most 10 data rows, cells of at most 40
 *    characters, its second column not all numbers) is written as labelled
 *    points; 7-10 rows take two cards;
 * C  a small 3-column table (at most 5 data rows, cells of at most 30
 *    characters) is written as a grid, one labelled point per row;
 * B  of the rest, at most max(2, floor(N/3)) are table pages (N content
 *    cards): numeric or comparison tables of 3+ columns first, then by rows,
 *    then by size; the others are written as points too.
 * A table of more than 12 data rows goes to the appendix (D) and is not
 * counted. A headerless PDF table of 3+ columns stays a table: its values
 * have no names to write them with (JEPA b_0023, 2026-11-01). A leaf module:
 * the planner, the writers and the restore pass use it. */
const TABLES=new Set(['TableBlock','SummaryTableBlock']);
const KV_ROWS=10,KV_TWO_CARDS=7,KV_CELL=40,GRID_ROWS=5,GRID_CELL=30,APPENDIX_ROWS=12;
const cell=value=>String(value??'').replace(/\*\*/gu,'').replace(/\s+/gu,' ').trim();
const dataRows=item=>Math.max(0,(item?.rows?.length||0)-(item?.headerless===true?0:1));
const numeric=value=>/\d/u.test(value)&&/^[\s\d.,%+\-–~×x/:()$¥€<>=≤≥]*$/u.test(value);
/** 'keyvalue' | 'grid' | 'appendix' | 'table' for a table item, else null. */
export function tableShape(item){
 if(!TABLES.has(item?.type)||!Array.isArray(item.rows)||item.rows.length<2)return null;
 const rows=item.rows.map(row=>row.map(cell)),columns=Math.max(...rows.map(row=>row.length)),body=rows.slice(item.headerless===true?0:1);
 if(item.headerless===true&&columns>=3)return dataRows(item)>APPENDIX_ROWS?'appendix':'table';
 if(columns===2&&dataRows(item)<=KV_ROWS&&rows.every(row=>row.every(text=>text.length<=KV_CELL))&&!body.every(row=>numeric(row[1]||'')))return'keyvalue';
 if(columns===3&&dataRows(item)<=GRID_ROWS&&rows.every(row=>row.every(text=>text.length<=GRID_CELL)))return'grid';
 if(dataRows(item)>APPENDIX_ROWS)return'appendix';
 return'table';
}
/** A written table's data rows as points, one per row (code writes them, the
 * writer never does: CodePilot PDF 2026-11-02 showed five points reading only
 * the header cell "本手册中的含义"). The first cell is each row's label when
 * every row's fits (all or none, so no term is lost to a partial grid), else
 * it leads the text; the other cells are the text (two columns: that row's
 * second cell; more: "header：value" joined with "；"). A headerless table's
 * first row is data. rowLabel marks a label the source table gives. */
const ORDINAL_HEAD=/^(?:编号|序号|序|No\.?|#|Index|Step|步骤)$/iu;
const labelFits=value=>/\p{Script=Han}/u.test(value)?[...value].length<=12:value.split(/\s+/u).length<=6&&value.length<=40;
export function tableRowPoints(item,id=item?.id){
 let rows=(item?.rows||[]).map(row=>row.map(cell));const headerless=item?.headerless===true;
 // An ordinal first column (编号, #, 1 2 3) is the rows' order, not a name: it is left
 // out (MCP xlsx 2026-11-02: steps read "1. 17：示例阶段…").
 const ordinal=rows.length>1&&Math.max(...rows.map(row=>row.length))>2&&(!headerless&&ORDINAL_HEAD.test(rows[0][0]||'')||rows.slice(headerless?0:1).every(row=>/^\d{1,4}[.)、]?$/u.test(row[0]||'')));
 if(ordinal)rows=rows.map(row=>row.slice(1));
 const head=headerless?[]:rows[0]||[],named=(value,k)=>head[k]?`${head[k]}：${value}`:value,trim=value=>value.replace(/[。；;，,]+$/u,'');
 const body=rows.slice(headerless?0:1).filter(row=>row.some(Boolean)).map(row=>({first:row[0],rest:row.length===2?row[1]:row.slice(1).map(trim).map((value,k)=>named(value,k+1)).filter(Boolean).join('；'),whole:row.map(trim).map(named).filter(Boolean).join('；')}));
 // A label names one row: every first cell fits as a label and none repeats.
 const labelled=body.length>0&&body.every(row=>row.first&&row.rest&&labelFits(row.first))&&new Set(body.map(row=>row.first)).size===body.length;
 return body.map(row=>labelled?{label:row.first,text:row.rest,sourceUnitIds:[id],fromRow:true,rowLabel:true}:{text:rows[0]?.length>2?row.whole:[row.first,row.rest].filter(Boolean).join('：'),sourceUnitIds:[id],fromRow:true});
}
/** Whether a point restates a written table's rows or header: table markup;
 * its text a cell; its label or lead a row's first cell or a header; a
 * "header：" inside it; or two of the table's body cells in it (CodePilot PDF
 * 2026-11-02: "本手册中的含义：页级变更代次…；本手册中的含义：任务或…"). */
export function tableRowPoint(item,point){
 const rows=(item?.rows||[]).map(row=>row.map(cell)),text=cell(point?.text),label=cell(point?.label),lead=text.split(/[：:]/u)[0].trim();
 const body=rows.slice(item?.headerless===true?0:1),head=item?.headerless===true?[]:(rows[0]||[]).filter(value=>[...value].length>=2);
 const firsts=new Set(body.map(row=>row[0]).filter(Boolean)),cells=new Set(rows.flat().filter(Boolean));
 const quoted=body.flatMap(row=>row.slice(1)).filter(value=>[...value].length>=4&&text.includes(value));
 return markdownTableText(point?.text)||cells.has(text)||firsts.has(label)||firsts.has(lead)||head.includes(lead)||head.some(value=>text.includes(value+'：'))||new Set(quoted).size>=2;
}
/** Markdown table text pasted into a point ("| a | b |", "| --- |"). */
export const markdownTableText=text=>/\|\s*:?-{3,}/u.test(String(text||''))||(String(text||'').match(/\|/gu)||[]).length>=4;
/** A key-value table long enough for two cards. */
export const twoCardTable=item=>tableShape(item)==='keyvalue'&&dataRows(item)>=KV_TWO_CARDS;
/** Every table's role in this deck, kept in the run data for review:
 * {id: {shape, role:'written', reason:'comparison_cards'}} (the hand deck,
 * 2026-11-02 evening: no table is a card object any more). */
export function tableRoles(p){
 const roles={};
 for(const item of p?.source?.semantic?.inventory?.items||[]){const shape=tableShape(item);if(shape)roles[item.id]={shape,role:'written',reason:'comparison_cards'};}
 return roles;
}
/** A document table the writer turns into points (never a card object).
 * The hand deck (the user, 2026-11-02 evening, "表格按手工版做法改",
 * superseding the 11-01 roles and the 11-02 row points): no table is drawn,
 * none is written row by row; the slide shows at most COMPARISON_MAX
 * comparison points for the numbers that carry its message, and the whole
 * table goes to the speaker notes (tableNotePoints). Every length. */
export const COMPARISON_MAX=4;
export const documentWrittenTable=(p,item)=>Boolean(tableShape(item));
/** The language a deck's notes are written in: its output locale, else the source's. */
export const noteLanguage=p=>p?.generationPolicy?.language?.mode==='output'?p.generationPolicy.language.locale||'en':p?.inputUnderstanding?.primaryLanguage||'en';
/** A whole table as speaker-note points: a header line, then one line per
 * data row ("label：cells"), each citing the table, so every value is kept
 * (the hand deck: "表 1 CarRacing-v0 …" in the notes). */
export function tableNotePoints(item,id=item?.id,language='en'){
 if(!tableShape(item))return [];
 const zh=String(language).startsWith('zh'),name=String(item.caption||item.sectionPath?.at(-1)||'').replace(/\s+/gu,' ').trim();
 const head=item.headerless===true?[]:(item.rows[0]||[]).map(cell).filter(Boolean);
 const lead=[zh?'表':'Table',name].filter(Boolean).join(' ')+(head.length?(zh?'：':': ')+head.join(' | '):'');
 return [{text:lead,sourceUnitIds:[id],tableHeader:true},...tableRowPoints(item,id).map(({fromRow,rowLabel,label,text},k)=>({text:label?`${label}${zh?'：':': '}${text}`:text,sourceUnitIds:[id],tableRow:k+1}))];
}
/** The writer's rule for the tables of its topic. */
export function documentTableRule(p,units){
 const written=units.filter(unit=>documentWrittenTable(p,unit));
 if(!written.length)return'';
 return`Tables ${written.map(unit=>unit.id).join(', ')} are never drawn and never written row by row: code puts each whole table in the speaker notes. For a table this card uses, write at most ${COMPARISON_MAX} comparison points for the numbers that carry the card's message, grouping rows that belong together; each point's label names the row or group (at most 12 characters) and its text gives that group's numbers exactly as the table writes them plus one short sentence on what they show; cite the table's unit. A table that carries no message for this card needs no point. `;
}
