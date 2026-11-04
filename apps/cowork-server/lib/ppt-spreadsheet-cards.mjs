/** Spreadsheet decks are written cards, not table dumps (the user, 2026-10-31:
 * "即使是excel作为input也不应该全部提取表格出来"; the MCP workbook made five
 * cards that were each one sheet table, plus twelve appendix pages, where
 * Gamma made thirteen cards by meaning).
 * Below the full length an Excel/CSV sheet is the source's text: the writer
 * cuts its rows into cards and points by meaning. Only a small comparison
 * (at most 6 data rows and 4 short columns) may still be shown verbatim. The
 * source's own appendix sheet is one summary card; the closing notes name it.
 * A leaf module: the planner, both card writers and the restore pass use it. */
import {documentWrittenTable} from './ppt-table-roles.mjs';
const SPREADSHEET=/^(?:xlsx|xlsm|xls|csv|tsv)$/iu;
const SMALL_ROWS=6,SMALL_COLUMNS=4,SHORT_CELL=40,ROWS_PER_CARD=5,MAX_SHEET_CARDS=3;

export const spreadsheetSource=p=>SPREADSHEET.test(String(p?.source?.extension||'').replace(/^\./u,''));
const lengthPreset=p=>p?.planningContract?.length?.preset??p?.planningContract?.deckPlan?.length?.preset??p?.planningContract?.settings?.length?.preset;
/** Written cards apply below the full length (an exact page count included). */
export const spreadsheetCards=p=>spreadsheetSource(p)&&lengthPreset(p)!=='full';
const dataRows=item=>Math.max(0,(item?.rows?.length||0)-1);
export function smallComparison(item){
 const rows=item?.rows||[];
 return dataRows(item)<=SMALL_ROWS&&rows.every(row=>row.length<=SMALL_COLUMNS&&row.every(cell=>String(cell??'').length<=SHORT_CELL));
}
/** A table the writer turns into points (never a card object): every table
 * of every deck and length since the hand deck (the user, 2026-11-02
 * evening): comparison points on the slide, the whole table in the notes. */
export const writtenTable=(p,item)=>Boolean(item?.rows)&&(spreadsheetSource(p)||documentWrittenTable(p,item));
/** Cards a spreadsheet section needs: about one per five data rows, at most
 * three; the source's own appendix sheet one. */
export function sheetCards(section,items,appendix){
 if(appendix)return 1;
 const rows=(section.ids||[]).map(id=>items.get(id)).reduce((n,item)=>n+dataRows(item),0);
 return Math.max(1,Math.min(MAX_SHEET_CARDS,Math.ceil(rows/ROWS_PER_CARD)));
}
/** The writer's rule for a spreadsheet deck. */
export const spreadsheetRule=`The source is a spreadsheet: its sheets are its text. Cut each sheet's rows into cards by meaning (rows that belong together make one card; ordered steps make one numbered card) and write the points from the cells, each point citing the sheet's table unit it comes from; never copy a whole sheet onto a card. A table may be shown in "objects" only when it is listed there (a small comparison). A topic marked "summarize" is the source's own appendix: write it as ONE card whose points group its rows into their stages or kinds.`;
