import {effectivePageRole,isContentPage,visibleSemanticUnits,claimFragmentKey} from './ppt-page-semantics.mjs';
import {cardsFlow} from './ppt-flow.mjs';
import {approximateFormulaUnits,approximateFormulaPages,shortenedCoverTitle,omittedCoverage} from './ppt-card-language.mjs';
import {sourceDisplayText,richTextContent} from './ppt-source-text.mjs';
import {isSectionReferenceList} from './ppt-section-references.mjs';
import {nodeContentText,visibleNodes} from './ppt-visible-content.mjs';
import {markdownTableText} from './ppt-table-roles.mjs';
import {writtenTable} from './ppt-spreadsheet-cards.mjs';
import {contentSelectionMatchesSource} from './ppt-content-selection.mjs';
import {verifiedFragmentRange} from './ppt-source-numbers.mjs';
import { inspectDensity } from './ppt-density-qa.mjs';
import { inspectInventoryCoverage, recall } from './ppt-content-inventory.mjs';
/** Deterministic content diagnostics within the existing quality node. */
import { evidenceMeasurements, sourceWordsFor, evidenceVisible, missingRequiredEvidence, visibleSlideText, visibleSlideParts } from './ppt-evidence.mjs';
import { visualUnits, visibleBodyTarget, templateVisualUnits } from './ppt-presentation-writing.mjs';
function normalized(value) { return String(value || '').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ''); }
// Visible rich math flattens the script markers and renders \mid as ∣. Keep
// variable names and operators (especially t+1), normalize only presentation.
const mathNames={sigma:'σ',rho:'ρ',tau:'τ',alpha:'α',beta:'β',gamma:'γ',odot:'⊙'};
// A displayed fraction reads "(capacityi)/(100)"; a card's "capacityᵢ/100" is the same spelling (Fable Q1, 2026-11-03).
const formulaKey = value => sourceDisplayText(value).normalize('NFKC').replace(/\\+(sigma|rho|tau|alpha|beta|gamma|odot)\b/gu,(_,name)=>mathNames[name]).replace(/\b(sigma|rho|tau|alpha|beta|gamma)(?=\s*\()/gu,(_,name)=>mathNames[name]).replace(/[`\s{}_^]/gu, '').replace(/\(([\p{L}\p{N}.]+)\)(?=\/)|(?<=\/)\(([\p{L}\p{N}.]+)\)/gu,(_,top,bottom)=>top??bottom).replace(/[∣｜]/gu,'|').replace(/−/gu,'-').replace(/∗/gu,'*').toLocaleLowerCase();
function formulaCalls(value) {
  const text = String(value || '');
  const calls = [];
  for (const match of text.matchAll(/\b[A-Za-z_]\w*\s*\(/g)) {
    if(match.index>0 && text[match.index-1]==='\\' && /^(?:big|Big|left|right)\b/u.test(match[0]))continue;
    let depth = 0; let end = -1;
    for (let index = text.indexOf('(', match.index); index < text.length; index++) {
      if (text[index] === '(') depth++;
      else if (text[index] === ')' && --depth === 0) { end = index + 1; break; }
    }
    if (end < 0) continue;
    const expression = text.slice(match.index, end);
    // Pagination locators are editorial metadata, not function calls. Require
    // the complete locator grammar and the space before '('; arithmetic calls
    // (including spaced calls and a variable named Rows) still use source checks.
    const locator = /\s+\(\s*(?:rows?|pages?|items?|sections?|slides?|lines?)\s+\d+\s*[-–—]\s*\d+\s*\)$/iu.test(expression)
      // A record table's row page counter, "Summary (2 / 5)" (Fable plan T17; live mlq-r32).
      || /\s+\(\s*\d{1,3}\s*\/\s*\d{1,3}\s*\)$/u.test(expression);
    const sectionLocator=/\s+\(/u.test(expression)&&isSectionReferenceList(expression.slice(expression.indexOf('(')+1,-1));
    const body=expression.slice(expression.indexOf('(')+1,-1);
    // A spaced prose aside such as "lookback (63-day volatility: at least
    // 63 days)" is not an arithmetic call merely because a unit has a hyphen.
    // Actual subtraction, other operators and unspaced calls remain checked.
    const proseAside=/\s+\(/u.test(expression)&&/[:;]/u.test(body)&&/\b\d+(?:\.\d+)?-[A-Za-z]{2,}\b/u.test(body)&&
      !/[+*/=<>-]/u.test(body.replace(/\b\d+(?:\.\d+)?-[A-Za-z]{2,}\b/gu,''));
    // A spaced aside holding two ordinary words in a row is prose: formulas do
    // not put words side by side ("problem (look-elsewhere effect)", "days (15
    // years daily A-share)", "corrections (deflated Sharpe ratio, PBO, ...)";
    // 3143 runs 1efa0344, 631ea11e, cb26eb1a). Unspaced calls and asides with
    // operators or commas between single terms stay checked.
    // Words include numbers and hyphenated words ("15 years", "A-share"); one
    // of the pair has two letters (3143, eb6f0617: "days (15 years A-share)").
    const proseRun=/\s+\(/u.test(expression)&&[...body.matchAll(/(?<![\w'’-])([A-Za-z0-9][A-Za-z0-9'’-]*) (?=([A-Za-z0-9][A-Za-z0-9'’-]*)(?![\w'’]))/gu)].some(([,a,b])=>/[A-Za-z]{2}/u.test(a)||/[A-Za-z]{2}/u.test(b));
    // A spaced aside listing single words ("anomalies (distress, O-score,
    // momentum, etc.)", live fz-r6) is prose when two of them are ordinary words;
    // a term with an operator or a list of short symbols stays checked.
    const terms=body.split(/\s*,\s*/u).map(term=>term.trim());
    const proseList=/\s+\(/u.test(expression)&&terms.length>=2&&terms.every(term=>/^[A-Za-z][A-Za-z'’]*(?:-[A-Za-z]+)*\.?$/u.test(term))&&terms.filter(term=>/^[A-Za-z]{4,}$/u.test(term)).length>=2;
    // A spaced aside of upper-case acronyms joined by "/" names alternatives,
    // not a division: "fitness (IC/ICIR)" for "IC or ICIR" (3143 o57). Lower-
    // case or mixed terms ("ret/vol") stay checked.
    const acronymAlternatives=/\s+\(/u.test(expression)&&body.trim().split(/\s*\/\s*/u).length>1&&body.trim().split(/\s*\/\s*/u).every(term=>/^[A-Z][A-Za-z0-9]+$/u.test(term)&&(term.match(/[A-Z]/gu)||[]).length>=2);
    // A spaced aside listing signed values with labels is a list of numbers, not
    // arithmetic: "buys (+10%, +20% ChiNext/STAR, +5% ST)"; the number check
    // verifies each value (3143 g1j).
    const signedValues=/\s+\(/u.test(expression)&&body.split(/[,;，；]/u).every(part=>/^\s*(?:or\s+)?[+\-−]?\d+(?:\.\d+)?\s*%?(?:\s+[A-Za-z][A-Za-z0-9/&-]*)*\s*$/u.test(part));
    // A spaced aside comparing numbers ("robustness (e.g., +80% vs +15%)") is
    // no formula: signed numbers, percentages, units or currency joined by
    // comparison words, with no operator and no variable (Fable 2026-10-26,
    // live mlq-i2 p14). The number check verifies each value.
    const compared=body.replace(/^(?:.*?(?:^|[\s,;，；])(?:e\.g\.|i\.e\.|for example|such as|例如|如))*[\s,:：]*/iu,'').split(/\s*(?:\bvs\.?(?!\w)|\bversus\b|\bto\b|\band\b|\bor\b|→|对|比|与|至)\s*/iu);
    const numericComparison=/\s+\(/u.test(expression)&&compared.length>=2&&compared.every(part=>/^[+\-−]?[$¥€£]?\d+(?:[.,]\d+)?\s*(?:%|‰|bps?|pp|x|k|m|bn)?$/iu.test(part.trim()));
    if (!locator && !sectionLocator && !proseAside && !proseRun && !proseList && !acronymAlternatives && !signedValues && !numericComparison && expression.length >= 15 && /[+*/-]/u.test(expression)) calls.push({ start: match.index, end, expression });
  }
  return calls.filter(call => !calls.some(other => other !== call && other.start < call.start && other.end >= call.end));
}
/** The function-call formulas of a text that the source does not write
 * (spelling aside): the publish gate's check, shared with the outline's send-back. */
export function unverifiedFormulas(sourceText, text) {
  const inSource=value=>formulaKey(sourceText).includes(formulaKey(value)) || formulaKey(sourceDisplayText(sourceText)).includes(formulaKey(sourceDisplayText(value)));
  return formulaCalls(text).map(({ expression }) => expression).filter(expression => {
    // A spaced aside ("Vertical barrier (t+hmax)", "barrier (e.g. +2σi)") puts
    // a formula after a prose word: the formula is its body (live mlq-r9 page 13).
    // A prose lead inside the aside ("profit-take, e.g. +2σi") ends at its last
    // example marker; the formula is what follows it (live mlq-r25 page 10).
    const aside=/^[A-Za-z_]\w*\s+\(/u.test(expression)?expression.slice(expression.indexOf('(')+1,-1).replace(/^(?:.*?(?:^|[\s,;，；])(?:e\.g\.|i\.e\.|for example|such as|例如|如))*[\s,:：]*/iu,''):'';
    return !inSource(expression) && !(aside.trim() && inSource(aside));
  });
}
function words(value) { return new Set((String(value || '').toLocaleLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u3400-\u9fff]{2,4}/g) || [])); }
function similarity(a, b) {
  const left = words(a); const right = words(b);
  if (!left.size || !right.size) return 0;
  const common = [...left].filter(word => right.has(word)).length;
  return common / (left.size + right.size - common);
}

function significantNumbers(value) {
  return [...String(value || '').matchAll(/(?<![a-zA-Z_])(?:\d+(?:[.,]\d+)?\s*(?:%|％|万|亿|元|美元|秒|分钟|ms)|\d{2,}(?:[.,]\d+)?)(?![a-zA-Z_])/g)]
    .map(match => match[0].replace(/\s/g, '').replace(/％/g, '%').replace(/,(?=\d{3}(?:\D|$))/g, ''))
    .map(value => value.replace(/^\d+(?:\.\d+)?/, numeric => {
      const [whole, fractional = ''] = numeric.split('.');
      const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
      const normalizedFraction = fractional.replace(/0+$/, '');
      return normalizedWhole + (normalizedFraction ? `.${normalizedFraction}` : '');
    }));
}

// A cardinality claim tied to a source table must retain every row label on
// its mapped pages. This is a row-presence check, not semantic cell coverage.
function promisedTableRows(title) {
  const names = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
  const match = String(title || '').toLowerCase().match(/\b(\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:factor\s+)?(?:families|categories|types|methods|features)\b/u);
  return match ? names.includes(match[1]) ? names.indexOf(match[1]) : Number(match[1]) : null;
}
const HEADING_ROLES = new Set(['title', 'title-translation', 'template-title', 'eyebrow', 'section-label', 'source-navigation', 'page-number']);
function rowLabelVisible(label, text) {
  const englishAlias = label.replace(/\([^)]*\)/gu, '').split(/[\u3400-\u9fff]/u)[0].trim();
  if (/[\u3400-\u9fff]/u.test(label) && normalized(text).includes(normalized(label))) return true;
  const clean = value => String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
  return [label, englishAlias].filter(Boolean).some(alias => ` ${clean(text)} `.includes(` ${clean(alias)} `));
}
function tableRowLabels(block) {
  const rows = String(block.text || '').split('\n').filter(line => /^\s*\|/u.test(line)).map(line => line.trim().slice(1).split(/(?<!\\)\|/u).map(cell => cell.trim()));
  const divider = rows.findIndex(row => row.length > 1 && row.every(cell => !cell || /^[:\s-]+$/u.test(cell)));
  if (divider < 0) return [];
  return rows.slice(divider + 1).map(row => row[0].replace(/[*`$]/gu, '').trim()).filter(Boolean);
}

/** Evidence preservation/collection is a procedure, not a claim of measured
 * results. A title explicitly promising results still needs real evidence. */
export function titlePromisesEvidence(title='') {
 const text=String(title);
 if(/\bresults?\b|实测结果|基准结果|测试结果/iu.test(text))return true;
 const procedural=/\b(?:(?:evidence|benchmark)\s+(?:retention|preservation|collection|handling|storage|protocol|method(?:s|ology)?|design|plan(?:ning)?)|(?:retain(?:ing)?|preserv(?:e|ing)|collect(?:ing)?|handl(?:e|ing)|stor(?:e|ing))\s+evidence)\b|证据(?:保留|保全|保存|留存|收集|采集|管理)|(?:保留|保全|保存|留存|收集|采集|管理)证据/iu;
 return /\b(?:evidence|benchmark)\b|证据/iu.test(text)&&!procedural.test(text);
}

const citedEvidenceAtoms = (atoms, chunkIds, sourceRefs) => atoms.filter(atom => chunkIds.size
  ? chunkIds.has(atom.chunkId)
  : (sourceRefs || []).some(ref => atom.sourceRefs.includes(ref)));
/** The quantities a page's sources state: its chunks' (or source refs')
 * evidence atoms and the cited segments and chunks themselves. */
function pageSourceMeasurements(project, chunkIds, sourceRefs) {
  const atoms = project.source?.semantic?.evidenceAtoms || [], segments = project.source?.segments || [];
  const directSources=[...segments.filter(segment=>sourceRefs?.includes(segment.id)).map(segment=>sourceDisplayText(segment.text)),...(project.source?.semantic?.chunks||[]).filter(chunk=>chunkIds.has(chunk.id)).map(chunk=>sourceDisplayText(chunk.text))];
  return [...citedEvidenceAtoms(atoms, chunkIds, sourceRefs).flatMap(atom => atom.measurements || []),...directSources.flatMap(evidenceMeasurements)];
}
const measurementStated = (cited, measurement) => cited.some(item => item.value === measurement.value && item.unit === measurement.unit);

/** Facts a card outline must not carry into generation, checked live at
 * confirmation (Fable, 2026-10-24) with the publish gate's own rules: a
 * quantity the page's sources do not state (visible_numeric_fidelity) and a
 * formula that cannot be typeset. Edits clear them; nothing is stored. */
export function cardFactIssues(project) {
  // A brief deck cites no source: its figures are checked against the brief by the outline.
  if (!cardsFlow(project) || !project.source?.segments?.length || !project.source?.semantic?.inventory?.items?.length) return [];
  const issues = [];
  let approximate;const approximateUnits = () => approximate ||= approximateFormulaUnits(project);
  (project.outline || []).forEach((page, index) => {
    if (index === 0) return;
    // A page's sources are its own refs and its points' (an assembled card deck
    // carries them on the points until the outline is normalized).
    const points = page.keyPoints || [], chunkIds = new Set([...(page.chunkRefs || []), ...points.flatMap(point => point?.chunkRefs || [])]);
    const cited = pageSourceMeasurements(project, chunkIds, [...new Set([...(page.refs || []), ...points.flatMap(point => point?.refs || [])])]);
    const sourceText = [...(project.source?.semantic?.chunks || []).filter(chunk => chunkIds.has(chunk.id)).map(chunk => chunk.text)].join('\n');
    for (const [pointIndex, point] of points.entries()) {
      // A divider's navigation entry is code-written from the headings, not a claim.
      if (point?.navigation) continue;
      const text = String(point?.text ?? point ?? '');
      for (const half of text.split(/\s+\|\s+/u)) {
        for (const measurement of evidenceMeasurements(half)) if (!measurementStated(cited, measurement)) {
          const words = sourceWordsFor(sourceText, measurement.value);
          issues.push({ code: 'card_quantity_unstated', pageIndex: index, pointIndex, point: text, quantity: measurement.raw, value: measurement.value, unit: measurement.unit, ...(words ? { sourceWords: words } : {}),
            message: `Page ${index + 1}: "${measurement.raw}" in "${text.slice(0, 120)}" is not a quantity its sources state${words ? `; the source says "${words}"` : ''}. Edit the point before generating.` });
        }
      }
      const math = richTextContent(text).richText.diagnostics.filter(item => /^math_/u.test(item.code));
      // A point from a PDF's approximate formula text publishes with its page
      // flagged (the user, 2026-10-31); asking the author to retype it blocked the deck.
      if (math.length && approximateFormulaPages({ keyPoints: [point] }, approximateUnits()).length) continue;
      if (math.length) issues.push({ code: 'card_math_untypeset', pageIndex: index, pointIndex, point: text, span: math[0].source,
        message: `Page ${index + 1}: "${text.slice(0, 120)}" has a formula that cannot be typeset; write it as $…$ TeX as the source does. Edit the point before generating.` });
    }
  });
  return issues;
}

export function inspectContent(project, deck = project.deck) {
  const inventoryReview = inspectInventoryCoverage(project.source, deck?.slides || [], visibleSlideText);
  const issues = [...inventoryReview.issues];
  // A cover headline shortened as the last resort (no frame growth fits it) is
  // flagged for the author; its full title is kept beneath it (Fable option Q, 2026-11-01).
  {const full=cardsFlow(project)&&deck?.slides?.[0]?shortenedCoverTitle(project):'';
   if(full)issues.push({code:'cover_title_shortened',severity:'warning',pageFlag:true,slideId:deck.slides[0].id,repairable:false,message:`封面标题放不下，已缩短为“${project.outline[0].title}”；完整标题“${full}”在副标题或演讲者备注中，请核对`});}
  const metrics = { ...inventoryReview.metrics, coverageRatio: null, highPriorityCoverageRatio: null, copyLikeness: 0, adjacentRedundancy: 0, unsupportedNumberCount: 0,
    semanticUnitsPerSlide: [], requiredDetailCoverage: null, densityDistributionMatch: null, pageCountCompliant: true,
    unsupportedContentPages: 0, repeatedClaimsAcrossDeck: 0, sourceDensityRatio: null,
    plannedChunkCoverageRatio: null, evidenceCoverageRatio: null, requiredEvidenceCount: 0, renderedEvidenceCount: 0,
    visibleContentUnitsPerSlide: [], templateCapacityWarnings: 0, chapterCoverageRatio: null, requiredTableRows: 0, renderedTableRows: 0, notedTableRows: 0 };
  const slides = deck?.slides || [];
  const segments = project.source?.segments || [];
  const richSource = String(project.source?.text || '').length >= 8000;
  const underfilled = [], fragments = [];
  for (let index = 1; index < slides.length - 1; index++) {
    const slide = slides[index], plan = project.planning?.slidePlan?.find(item => item.slideId === slide.id);
    const artifacts=(slide.nodes||[]).filter(node=>node.sourceArtifact);
    const units=visibleSemanticUnits(slide);
    const cited = (project.source?.semantic?.chunks || []).filter(chunk => plan?.sourceChunks?.includes(chunk.id));
    if (richSource && isContentPage(project,slide,index) && units < Math.min(4, plan?.semanticUnitBudget || 3) && cited.some(chunk => chunk.tokenCount > 200)) {
      underfilled.push(slide.id); issues.push({code:'rich_source_underfilled',severity:'warning',slideId:slide.id,repairable:false,message:'Available source detail exceeds the visible semantic units; review page capacity and role'});
    }
    const next = slides[index+1], nextPlan = project.planning?.slidePlan?.find(item => item.slideId === next?.id);
    if (next && isContentPage(project,slide,index) && isContentPage(project,next,index+1) && !artifacts.length && !next.nodes?.some(n=>n.sourceArtifact) && units <= 2 && visibleSemanticUnits(next) <= 2 && plan?.sourceChunks?.some(id=>nextPlan?.sourceChunks?.includes(id)) && recall(plan?.message,nextPlan?.message)>.35) {
      fragments.push([slide.id,next.id]); issues.push({code:'adjacent_micro_slide_merge_candidate',severity:'warning',slideId:slide.id,repairable:false,message:'Adjacent thin pages share source and question; review merge while retaining final page budget'});
    }
  }
  metrics.underfillRate = slides.length>2?underfilled.length/(slides.length-2):0;
  metrics.fragmentationRate = slides.length>2?fragments.length/(slides.length-2):0;
  metrics.mergeCandidates = fragments;
  const coverage = project.planning?.coverage || [];
  const strictCoverage = project.planning?.brief?.depthPolicy === 'strict' && !project.compressionApproved;
  if (project.pages && slides.length !== project.pages) {
    metrics.pageCountCompliant = false;
    issues.push({ code: 'page_count_compliance', severity: 'error', message: `输出 ${slides.length} 页，与用户确认的 ${project.pages} 页不一致`, slideId: null, repairable: false });
  }
  // A point the number guard moved to the speaker notes flags its page (Fable F3).
  if (cardsFlow(project)) for (const [index, slide] of slides.entries()) {
    const page = (project.outline || []).find(item => item.id === slide.id) || project.planningContract?.cardOutline?.raw?.slides?.find(item => item.id === slide.id);
    if (page?.numericNotes?.length) issues.push({ code: 'source_number_to_notes', severity: 'warning', pageFlag: true, slideId: slide.id, repairable: false,
      message: page.numericNotes.every(item => item.kept)
        ? `Page ${index + 1}: every point carries ${[...new Set(page.numericNotes.map(item => item.value))].join(', ')}, which the source does not state this way; the points stay on the page. Check them before presenting.`
        : `Page ${index + 1}: a point with ${[...new Set(page.numericNotes.map(item => item.value))].join(', ')} is in the speaker notes; the source does not state it this way. Check it before presenting.` });
  }
  // Table markup is never drawn as text (JEPA 2026-11-01, "| ViT-B/16 | 600 | 72.9 | | --- |"):
  // a page whose writer pasted it has those points in its notes; markup still
  // visible on a page by any other path flags the page.
  if (cardsFlow(project)) for (const [index, slide] of slides.entries()) {
    const page = (project.outline || []).find(item => item.id === slide.id) || project.planningContract?.cardOutline?.raw?.slides?.find(item => item.id === slide.id);
    if (page?.tableTextNotes) issues.push({ code: 'table_text_to_notes', severity: 'warning', pageFlag: true, slideId: slide.id, repairable: false,
      message: `Page ${index + 1}: a point that pasted table markup is in the speaker notes. Check whether the page needs the table itself.` });
    const shown = visibleNodes(slide).filter(node => node.type !== 'table').map(node => [node.content?.text, ...(node.content?.items || []).map(item => item?.text || item?.body)].filter(Boolean).join(' ')).find(text => markdownTableText(text));
    if (shown) issues.push({ code: 'table_markup_visible', severity: 'warning', pageFlag: true, slideId: slide.id, repairable: true,
      message: `Page ${index + 1} shows table markup as text ("${shown.replace(/\s+/gu, ' ').slice(0, 60)}"). Show the table or write its rows as points.` });
  }
  // A card deck names what its length leaves unexpanded on the closing page's
  // notes; those are a stated cut, not a silent gap (Fable D5, 2026-11-01).
  const stated = cardsFlow(project) ? omittedCoverage(project) : { chapters: [], topics: [] };
  if (coverage.length) {
    const included = coverage.filter(item => item.action === 'included').length;
    const important = coverage.filter(item => item.priority === 'high');
    metrics.plannedChunkCoverageRatio = included / coverage.length;
    for (const item of important.filter(item => item.action === 'unmapped' && !stated.topics.includes(String(item.topic || '').trim())).slice(0, 12)) {
      issues.push({ code: 'source_coverage', severity: strictCoverage ? 'error' : 'warning', message: `高优先级主题未映射到页面：${item.topic}`, slideId: null, repairable: false, chunkId: item.chunkId });
    }
  }
  const chapters = project.planning?.sourceCapacity?.sections || [];
  if (chapters.length && coverage.length) {
    let mapped = 0;
    for (const chapter of chapters) {
      const decisions = coverage.filter(item => chapter.chunkIds?.includes(item.chunkId));
      const included = decisions.some(item => item.action === 'included');
      const explained = decisions.length && decisions.every(item => item.action === 'omitted' && item.reason);
      if (included) mapped++;
      else if (!explained && chapter.sourceTokens >= 200 && !stated.chapters.includes(String(chapter.title || '').trim())) issues.push({
        code: 'source_chapter_unmapped', severity: strictCoverage ? 'error' : 'warning', slideId: null, repairable: false,
        message: `来源章节未映射且未说明取舍：${chapter.title}`,
      });
    }
    metrics.chapterCoverageRatio = mapped / chapters.length;
  }
  const chunks = project.source?.semantic?.chunks || [];
  const sourceBlocks = project.source?.semantic?.blocks || [];
  const checkedTables = new Set(), rawPlan = new Map((project.planningContract?.cardOutline?.raw?.slides || []).map(item => [item.id, item]));
  for (const slide of slides) {
    const count = promisedTableRows(slide.title);
    const outline = (project.outline || []).find(item => item.id === slide.id);
    const tableIntent = outline?.visualIntent?.type === 'table';
    if (!count && !tableIntent) continue;
    const citedChunks = chunks.filter(chunk => outline?.chunkRefs?.includes(chunk.id));
    for (const chunk of citedChunks) for (const block of sourceBlocks.filter(item => item.type === 'table' && chunk.sourceBlocks?.includes(item.id))) {
      const originalLabels = tableRowLabels(block);
      const entry=contentSelectionMatchesSource(project)&&project.contentSelection.entries.find(e=>e.sourceUnitId===block.id&&e.destination==='summary'&&Array.isArray(e.rowIndices));
      const labels=entry?entry.rowIndices.map(row=>originalLabels[row-1]).filter(Boolean):originalLabels;
      if (originalLabels.length < 2 || !tableIntent && originalLabels.length !== count || checkedTables.has(block.id)) continue;
      checkedTables.add(block.id);
      if (count && count !== labels.length) issues.push({code:'source_table_cardinality',severity:strictCoverage?'error':'warning',slideId:slide.id,chunkId:chunk.id,blockId:block.id,repairable:false,message:`页面声明 ${count} 类/项，而对应来源表格为 ${labels.length} 行；需明确取舍或修正标题数量`});
      const peers = (project.outline || []).filter(item => item.chunkRefs?.includes(chunk.id)).map(item => slides.find(page => page.id === item.id)).filter(Boolean);
      // A row shows in the page's body (points, tiles, tables), never by a
      // title or eyebrow that shares its words (Fable 2026-11-02: "FULL WORLD
      // MODEL 906 ± 21" counted as shown through the page title); a row in the
      // card's speaker notes is noted, not lost.
      const text = peers.map(page => cardsFlow(project) && page.nodes?.length ? visibleNodes(page).filter(node => !HEADING_ROLES.has(node.semanticRole)).map(nodeContentText).join(' ') : visibleSlideText(page)).join(' ');
      // Notes of the table's own pages, and any note anywhere that cites the
      // table (Codex G3: the whole table in a card's notePoints, one row each).
      const cites = point => (point?.sourceUnitIds || []).includes(block.id);
      const notes = [...peers.flatMap(page => [...(rawPlan.get(page.id)?.notePoints || []), ...((project.outline || []).find(item => item.id === page.id)?.notePoints || [])]),
        ...[...rawPlan.values(), ...(project.outline || [])].flatMap(page => (page.notePoints || []).filter(cites))].map(point => String(point?.text ?? point ?? '')).join(' ');
      const unseen = labels.filter(label => !rowLabelVisible(label, text)), missing = unseen.filter(label => !rowLabelVisible(label, notes));
      metrics.requiredTableRows += labels.length; metrics.renderedTableRows += labels.length - unseen.length; metrics.notedTableRows += unseen.length - missing.length;
      const translated = labels.every(label => !/[\u3400-\u9fff]/u.test(label)) && (text.match(/[\u3400-\u9fff]/gu)||[]).length > (text.match(/[a-z]/giu)||[]).length;
      // A lost row of a written table that a card point cites blocks export on
      // a card deck (Fable 2026-11-02); other tables keep their severity, and
      // every finding names the missing row range.
      const item = (project.source?.semantic?.inventory?.items || []).find(unit => unit.id === block.id);
      // Cited: a row point of the table, or a point whose primary source it is;
      // prose that also names the table as evidence for one number promises no
      // rows (live light-minimal: "906 ± 21" citing the scores table second).
      const cited = cardsFlow(project) && writtenTable(project, item) && (project.outline || []).some(page => (page.keyPoints || []).some(point => (point.sourceUnitIds || [])[0] === block.id || point.rowLabel && (point.sourceUnitIds || []).includes(block.id)));
      const rowNumbers = missing.map(label => labels.indexOf(label) + 1).filter(n => n > 0).sort((a, b) => a - b);
      const ranges = rowNumbers.reduce((list, n) => { const last = list.at(-1); if (last && n === last[1] + 1) last[1] = n; else list.push([n, n]); return list; }, []).map(([a, b]) => a === b ? String(a) : `${a}–${b}`).join(', ');
      if (missing.length) issues.push({ code: cited && !translated ? 'cited_table_rows_missing' : 'source_table_rows_missing', severity: (strictCoverage || cited) && !translated ? 'error' : 'warning',
        slideId: slide.id, chunkId: chunk.id, blockId: block.id, repairable: false, missingRows: missing, missingRowRange: ranges,
        message: `页面规划 ${count || labels.length} 类/项，但来源表格 ${block.id} 第 ${ranges} 行未在相关页面呈现：${missing.join('、')}` });
    }
  }
  const atoms = project.source?.semantic?.evidenceAtoms || [];
  const atomById = new Map(atoms.map(atom => [atom.id, atom]));
  const visibleBySlide = new Map(slides.map(slide => [slide.id, visibleSlideText(slide)]));
  const inventoryItems=project.source?.semantic?.inventory?.items||[];
  const eligibleAtom=id=>{const atom=atomById.get(id),unit=inventoryItems.find(unit=>unit.id===atom?.sourceUnitId);return atom&&!unit?.presentation&&!(unit?.type==='CodeBlock'&&project.generationPolicy?.code?.presentation==='omit');};
  const evidenceChunks = coverage.filter(item => chunks.some(chunk => chunk.id === item.chunkId && chunk.evidenceIds?.some(eligibleAtom)));
  const chunkVisible = item => {
    const chunk = chunks.find(value => value.id === item.chunkId);
    return (chunk?.evidenceIds || []).filter(eligibleAtom).some(id => item.slideIds.some(slideId => evidenceVisible(atomById.get(id), visibleBySlide.get(slideId))));
  };
  if (evidenceChunks.length) {
    metrics.coverageRatio = evidenceChunks.filter(chunkVisible).length / evidenceChunks.length;
    const important = evidenceChunks.filter(item => item.priority === 'high');
    metrics.highPriorityCoverageRatio = important.length ? important.filter(chunkVisible).length / important.length : null;
    for (const item of important.filter(item => item.action === 'included' && !chunkVisible(item)).slice(0, 12))
      issues.push({ code: 'source_evidence_unrendered', severity: 'warning', message: `来源主题已映射但没有可见证据：${item.topic}`,
        slideId: item.slideIds[0] || null, repairable: false, chunkId: item.chunkId });
  }
  const sourceText = String(project.source?.text || (segments || []).map(segment => segment.text || '').join(' '));
  const contentPages = Math.max(0, slides.length - 2);
  if (contentPages >= 10 && segments.length) {
    metrics.sourceDensityRatio = chunks.length / contentPages;
    if (chunks.length < Math.ceil(contentPages / 3) && sourceText.length < contentPages * 100)
      issues.push({ code: 'long_deck_source_thin', severity: 'warning',
        message: `已确认 ${slides.length} 页，但来源只有 ${chunks.length} 个语义单元、约 ${sourceText.length} 字；请审查每页是否有独立事实与证据`,
        slideId: null, repairable: false });
  }
  const outlineClaims = new Map();
  const claimPages = new Map();
  const previousPageCopy = [];
  let copied = 0; let checked = 0; let redundant = 0; let requiredDetails = 0; let coveredDetails = 0; let densityChecks = 0; let densityMatches = 0;
  // Numbers a page may show: the evidence atoms and source passages it cites.
  const pageChunkIds = slide => new Set(slide.sourceChunks?.length ? slide.sourceChunks : project.outline?.find(outline => outline.id === slide.id)?.chunkRefs || []);
  const citedMeasurementsFor = slide => {
    const chunkIds = pageChunkIds(slide);
    const cited = atoms.filter(atom => chunkIds.size ? chunkIds.has(atom.chunkId) : (slide.sourceRefs || []).some(ref => atom.sourceRefs.includes(ref)));
    const direct = [...segments.filter(segment => slide.sourceRefs?.includes(segment.id)).map(segment => sourceDisplayText(segment.text)),
      ...(project.source?.semantic?.chunks || []).filter(chunk => chunkIds.has(chunk.id)).map(chunk => sourceDisplayText(chunk.text)),
      // A page's own figures state their captions (JEPA on Blue, 2026-11-01: "ImageNet-1K 1%" in a figure caption).
      ...(project.outline?.find(item => item.id === slide.id)?.sourceImageIds || []).map(id => project.source?.images?.find(image => image.id === id)?.caption).filter(Boolean).map(caption => sourceDisplayText(String(caption)))];
    return [...cited.flatMap(atom => atom.measurements || []), ...direct.flatMap(evidenceMeasurements)];
  };
  // A summary or closing page without a source of its own restates the deck:
  // its numbers must match what the other pages cite, not any input number.
  // A chapter divider lists the cards it opens; their titles are checked on
  // their own pages, so a divider reads numbers against the whole deck too
  // (JEPA 2026-10-31: "1% ImageNet-1K" in a card title blocked the deck).
  const unsourcedSynthesis = slide => {const outline = project.outline?.find(item => item.id === slide.id);
    return (['summary', 'closing', 'conclusion'].includes(outline?.role) || outline?.cardFrame === 'divider')
      && !pageChunkIds(slide).size && !(slide.sourceRefs || []).length;};
  const deckMeasurements = slides.filter(slide => !unsourcedSynthesis(slide)).flatMap(citedMeasurementsFor);
  let approximate;const approximateUnits = () => approximate ||= approximateFormulaUnits(project);
  slides.forEach((slide, index) => {
    if (index > 0 && index < slides.length - 1 && isContentPage(project,slide,index)) {
      const focus = normalized(project.outline?.[index]?.focus || project.planning?.slidePlan?.[index]?.message);
      if (focus.length >= 6 && outlineClaims.has(focus)) {
        metrics.repeatedClaimsAcrossDeck++;
        issues.push({ code: 'repeated_claim_across_deck', severity: 'warning',
          message: `本页核心主张与第 ${outlineClaims.get(focus) + 1} 页重复`, slideId: slide.id, repairable: false });
      } else if (focus) outlineClaims.set(focus, index);
      if (slides.length >= 12 && segments.length && !(slide.sourceRefs?.length || project.outline?.[index]?.refs?.length || project.outline?.[index]?.chunkRefs?.length)) {
        metrics.unsupportedContentPages++;
        issues.push({ code: 'ungrounded_content_page', severity: 'warning',
          message: '内容页没有对应的用户来源；请补充真实引用或明确标记为结构页', slideId: slide.id, repairable: false });
      }
    }
    const contract = project.planning?.slidePlan?.find(item => item.slideId === slide.id) || {};
    const visibleText = visibleBySlide.get(slide.id) || '';
    const templateSlots = project.templateFidelity?.mode === 'preserve' ? (project.templateFidelity.slides?.[index]?.slots || []).map(slot => {
      const mapped = (slide.nodes || []).find(node => node.nativeRef?.shapeId === slot.shapeId)?.templateSlot;
      return mapped ? { ...slot, purpose:mapped.purpose || slot.purpose, groupId:mapped.groupId || slot.groupId } : slot;
    }) : [];
    const contentSlots = templateSlots.filter(slot => slot.role === 'content' && !['footnote', 'group-heading'].includes(slot.purpose) &&
      !(slide.templateOmissions || []).some(item => String(item.shapeId) === String(slot.shapeId)));
    const visibleNative = (slide.nodes || []).filter(node => node.nativeRef && node.templateSlot?.mapped &&
      node.templateSlot.role === 'content' && !['footnote', 'group-heading'].includes(node.templateSlot.purpose));
    const contentText = visibleNative.length ? visibleNative.map(node => node.content?.text || '').join(' ') : contentSlots.length ? contentSlots.flatMap(slot => {
      const value = slide.templateSlotTexts?.[String(slot.shapeId)];
      return Array.isArray(value) ? value.map(item => `${item.label || ''} ${item.body || ''}`) : [String(value || '')];
    }).join(' ') : (slide.copy?.blocks || []).map(block => `${block.heading || ''} ${block.body || ''}`).join(' ') ||
      (slide.bullets || []).join(' ');
    const contentUnits = templateSlots.length ? templateVisualUnits(contentText) : visualUnits(contentText);
    const templateCapacity = templateSlots.filter(slot => slot.role === 'content' && !['footnote', 'group-heading'].includes(slot.purpose))
      .reduce((sum, slot) => sum + Number(slot.capacity || 0), 0);
    metrics.visibleContentUnitsPerSlide.push({ slideId: slide.id, units: contentUnits, templateCapacity });
    if (index > 0 && index < slides.length - 1 && isContentPage(project,slide,index) &&
      (project.inputProfile?.level === 'rich' || sourceText.length >= 8000)) {
      // A card page's density was chosen in the outline (concise, standard or
      // detailed card points), so the visible-body target below does not apply
      // to it (3143, 0395f2aa page 5: 325 of 330 units blocked publish).
      const target = templateCapacity > 0 ? visibleBodyTarget(templateCapacity, contract.depth) : contract.depth === 'detailed' ? 160 : 130;
      if (!slide.cardPage && templateCapacity > 0 && templateCapacity < 130) {
        metrics.templateCapacityWarnings++;
        issues.push({ code: 'template_depth_capacity', severity: 'warning',
          message: `本页原生模板正文容量约 ${templateCapacity} visual units，低于富来源内容页的最低解释容量；应在版式调度时选更大正文区域，或明确压缩本页内容范围`,
          slideId: slide.id, repairable: false });
      } else if (!cardsFlow(project) && contentUnits < target && !((slide.nodes||[]).filter(node=>node.sourceArtifact).some(node=>(node.content?.items?.length || (node.content?.rows?.length||0)-1)>=Math.min(4,contract.semanticUnitBudget||4)))) {
        issues.push({ code: 'visible_content_sparse', severity: templateCapacity >= 130 && !slide.sourceArtifactFit?.capacity_ok ? 'error' : 'warning',
          message: `本页有来源内容且可见正文仅约 ${Math.ceil(contentUnits)} visual units；请补充来源支持的机制、条件、例子或判断，不要靠重复填字`,
          slideId: slide.id, repairable: true });
      }
    }
    if (project.source?.text) for (const expression of unverifiedFormulas(project.source.text, visibleText)) {
      // A card citing a PDF page with typeset math read as approximate text
      // flags its page instead of blocking the deck (the user, 2026-10-31: the
      // model rebuilt "max(2, ⌊P/5⌋)" from "max(2, ⌊ ⌋)" and the PDF never published).
      // A card formula the outline already sent back once is flagged on its
      // page too (Fable Q1, 2026-11-03: a lost index is a fidelity defect, not a deck block).
      const approximateSource = approximateFormulaPages((project.outline || []).find(item => item.id === slide.id), approximateUnits()).length > 0;
      const sentBack = !approximateSource && Boolean(slide.cardPage);
      issues.push({ code: 'visible_formula_unverified', severity: 'error',
        message: `可见公式与输入来源不一致：${expression.slice(0, 100)}${approximateSource ? '（来源为 PDF 排版公式的近似文本，请核对）' : sentBack ? '（已退回改写一次仍不一致，请核对）' : ''}`, slideId: slide.id, repairable: false, ...(approximateSource ? { approximateSource } : {}), ...(sentBack ? { sentBack } : {}) });
    }
    if (/[\ufffd\u25a1]/u.test(visibleText) || /[\u2002\u2003\u2007]{2,}/u.test(visibleText))
      issues.push({ code: 'formula_or_glyph_placeholder', severity: 'error',
        message: '可见文字包含缺字方框、替换字符或连续数学空位；请改为可见的公式文本或可靠的原生公式',
        slideId: slide.id, repairable: false });
    const requiredAtoms = (contract.requiredEvidenceIds || []).map(id => atomById.get(id)).filter(Boolean);
    metrics.requiredEvidenceCount += requiredAtoms.length;
    metrics.renderedEvidenceCount += requiredAtoms.filter(atom => evidenceVisible(atom, visibleText)).length;
    for (const atom of missingRequiredEvidence(project, slide, contract))
      issues.push({ code: 'required_evidence_missing', severity: 'error', message: `锁定来源证据未出现在可见页面：${atom.id}`,
        slideId: slide.id, repairable: false, evidenceId: atom.id });
    const evidenceTitle = titlePromisesEvidence(slide.title);
    const sourcesTitle = /\b(?:sources?|references?|citations?)\b|来源|参考文献|引用/iu.test(slide.title || '');
    if (sourcesTitle && project.source?.kind === 'file' && project.source.name &&
      !normalized(visibleText).includes(normalized(project.source.name)))
      issues.push({ code: 'source_page_without_citation', severity: 'error',
        message: `来源页没有在可见文字中列出输入文件 ${project.source.name}`, slideId: slide.id, repairable: false });
    const chunkIds=new Set(slide.sourceChunks?.length ? slide.sourceChunks : project.outline?.find(outline=>outline.id===slide.id)?.chunkRefs || []);
    const citedAtoms = citedEvidenceAtoms(atoms, chunkIds, slide.sourceRefs);
    // A qualitative evidence explanation may contain a full bound source
    // passage even when the heuristic atom extractor captured only one table
    // clause elsewhere. This is literal source/visible proof, never a model
    // approval. Results/benchmarks and explicit required atoms stay strict.
    const qualitativeEvidence=/\bevidence\b|证据/iu.test(slide.title||'')&&!/\b(?:results?|benchmark)\b|实测结果|基准结果/iu.test(slide.title||'');
    const boundSourceEvidence=qualitativeEvidence&&visibleNodes(slide).some(node=>{
      const item=(project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[]).find(item=>item.id===node.sourceArtifact?.sourceUnitId);
      const exact=item&&!item.rows&&sourceDisplayText(item.text||'');
      return exact&&exact.length>=40&&normalized(nodeContentText(node)).includes(normalized(exact));
    });
    if (evidenceTitle && citedAtoms.length && !boundSourceEvidence && !citedAtoms.some(atom => evidenceVisible(atom, visibleText)))
      issues.push({ code: 'evidence_page_without_evidence', severity: 'error', message: '标题承诺证据或结果，但可见页面没有对应来源事实',
        slideId: slide.id, repairable: false });
    if (evidenceTitle && !citedAtoms.length && !boundSourceEvidence && segments.length)
      issues.push({ code: 'evidence_page_source_absent', severity: 'error', message: '标题承诺证据或结果，但本页来源没有可核对的证据原子；应补充来源或改为评估方法页',
        slideId: slide.id, repairable: false });
    // A point of approximate PDF formula text moved to the notes flags its page (Fable, 2026-11-01).
    const planned = project.outline?.find(item => item.id === slide.id)?.notePoints || project.planningContract?.cardOutline?.raw?.slides?.find(item => item.id === slide.id)?.notePoints || [];
    if (planned.some(point => point?.approximateFormula))
      issues.push({ code: 'approximate_formula_in_notes', severity: 'warning', pageFlag: true, slideId: slide.id, repairable: false,
        message: '本页的近似公式文本已移到演讲者备注，请对照原文核对后再补回页面' });
    const citedMeasurements = unsourcedSynthesis(slide) ? deckMeasurements : citedMeasurementsFor(slide);
    // Measured per shape and paragraph: a pill's static "1" beside the heading
    // "Point-in-Time Fields" is no "1 Point" (3143, 28054887 page 8).
    for (const measurement of visibleSlideParts(slide).flatMap(part => part.split('\n')).flatMap(evidenceMeasurements)) {
      const sourceMatch = measurementStated(citedMeasurements, measurement);
      if (!sourceMatch && segments.length) {
        metrics.unsupportedNumberCount++;
        issues.push({ code: 'visible_numeric_fidelity', severity: 'error', message: `可见文字中的数值 ${measurement.raw} 没有对应的本页来源及单位`,
          slideId: slide.id, repairable: false });
      }
    }
    if (/\bfor comparison\s*[.!?](?=\s|$)/iu.test(visibleText) || /\b(?:a|an)\s+single\s+large\s*[.!?]/iu.test(visibleText))
      issues.push({ code: 'copy_filler_or_fragment', severity: 'error', message: '可见文案包含凑长度尾语或残句', slideId: slide.id, repairable: false });
    for (const claimId of contract.claimIds || []) {
      const previous = claimPages.get(claimId);
      if (previous && previous.narrativeRole === contract.narrativeRole && effectivePageRole(project,slide,index)!=='closing' && !(claimFragmentKey(slide,claimId)&&claimFragmentKey(slide,claimId)!==previous.fragment))
        issues.push({ code: 'repeated_claim_graph', severity: 'warning', message: `相同主张与叙事作用已在另一页出现：${claimId}`,
          slideId: slide.id, repairable: false });
      else claimPages.set(claimId, { slideId: slide.id, narrativeRole: contract.narrativeRole, fragment:claimFragmentKey(slide,claimId) });
    }
    const nativeContent = (slide.nodes || []).filter(node => node.nativeRef && node.templateSlot?.mapped &&
      node.templateSlot.role === 'content' && !['footnote', 'group-heading'].includes(node.templateSlot.purpose) && String(node.content?.text || '').trim());
    const nativeGroups = new Set(nativeContent.map(node => node.templateSlot.groupId || node.templateSlot.pairedWith || node.nativeRef.shapeId));
    const artifactUnits=(slide.nodes||[]).filter(node=>node.sourceArtifact).map(node=>node.content?.rows?node.content.rows.length-1:node.content?.items?.length||1);
    const semanticUnits = visibleSemanticUnits(slide);
    if (project.inputProfile?.level === 'rich' && nativeContent.some(node =>
      ['body', 'point-description', 'list'].includes(node.templateSlot.purpose) &&
      /^(?:[\p{L}-]+\s+){1,2}(?:matters?|works?)\s*[.!]?$/iu.test(String(node.content?.text || '').trim()))) {
      issues.push({ code: 'copy_generic_filler', severity: 'error', message: '富来源正文只有通用断言，未解释机制、条件或来源依据', slideId: slide.id, repairable: false });
    }
    metrics.semanticUnitsPerSlide.push({ slideId: slide.id, units: semanticUnits, density: contract.density || 'medium' });
    const plannedBudget = Number(contract.semanticUnitBudget || 0);
    if (plannedBudget) {
      densityChecks++;
      const tolerance = contract.density === 'high' ? 3 : 2;
      if (Math.abs(semanticUnits - plannedBudget) <= tolerance) densityMatches++;
      else if (contract.density === 'low' && semanticUnits > plannedBudget + 2) {
        issues.push({ code: 'artificial_density', severity: 'warning', message: '低密度页面包含过多语义单元，与整稿密度节奏不符', slideId: slide.id, repairable: false });
      }
    }
    const slideText = normalized(visibleText);
    const comparisonText = `${slide.title} ${(slide.bullets || []).join(' ')} ${(slide.copy?.blocks || []).map(block => `${block.heading} ${block.body}`).join(' ')}`;
    if (slides.length >= 6 && index > 1 && index < slides.length - 1 && comparisonText.length >= 90) {
      const previous = previousPageCopy.find(item => index - item.index > 1 && item.text.length >= 90 &&
        similarity(comparisonText, item.text) >= .82);
      if (previous) issues.push({ code: 'nonadjacent_redundancy', severity: 'warning',
        message: `本页与第 ${previous.index + 1} 页的论证内容高度重复，请确认是否有新的机制、证据或结论`, slideId: slide.id, repairable: false });
    }
    previousPageCopy.push({ index, text: comparisonText });
    for (const detail of contract.requiredDetails || []) {
      requiredDetails++;
      const tokens = [...words(detail)];
      const expression = /\b[A-Za-z_]\w*\s*=|\b[A-Za-z_]\w*\s*\([^\n]*[-+*/][^\n]*\)/u.test(detail);
      const present = expression ? formulaKey(visibleText).includes(formulaKey(detail))
        : normalized(detail).length >= 4 && (slideText.includes(normalized(detail)) ||
          tokens.length >= 2 && tokens.filter(token => slideText.includes(normalized(token))).length / tokens.length >= .6);
      if (present) coveredDetails++;
      else issues.push({ code: 'required_detail_not_visible', severity: 'warning',
        message: `规划要求的来源细节没有完整出现在可见页面：${String(detail).slice(0, 100)}`,
        slideId: slide.id, repairable: true });
    }
    const cited = segments.filter(segment => (slide.sourceRefs || []).includes(segment.id));
    const citedSourceText = cited.map(segment => segment.text).join(' ');
    const sourceNumbers = new Set(significantNumbers(citedSourceText));
    for (const bullet of slide.bullets || []) {
      const value = normalized(bullet);
      if (value.length >= 24 && cited.length) {
        checked++;
        if (normalized(citedSourceText).includes(value)) {
          copied++;
          issues.push({ code: 'copy_likeness', severity: 'warning', message: '要点与来源原句高度一致，建议改写成演示文稿语言', slideId: slide.id, repairable: false });
        }
      }
      for (const number of significantNumbers(bullet)) {
        if (cited.length && !sourceNumbers.has(number)) {
          metrics.unsupportedNumberCount++;
          issues.push({ code: 'numeric_fidelity', severity: 'error', message: `要点中的数值 ${number} 未出现在本页引用的来源中`, slideId: slide.id, repairable: false });
        }
      }
    }
    if (index > 0) {
      const previous = slides[index - 1];
      const score = similarity(`${previous.title} ${(previous.bullets || []).join(' ')}`, `${slide.title} ${(slide.bullets || []).join(' ')}`);
      const enoughText = normalized(`${previous.title} ${(previous.bullets || []).join(' ')}`).length >= 40 && normalized(`${slide.title} ${(slide.bullets || []).join(' ')}`).length >= 40;
      if (enoughText && score >= .78) {
        redundant++;
        issues.push({ code: 'adjacent_redundancy', severity: 'warning', message: `本页与前一页内容高度相似`, slideId: slide.id, repairable: false });
      }
    }
    if (project.planning?.brief?.depth === 'detailed' && index > 0 && index < slides.length - 1 && (slide.bullets || []).length === 1 && !slide.blocks?.length) {
      issues.push({ code: 'content_depth', severity: 'warning', message: '内容页只有一条要点，可检查是否缺少机制、证据或启示', slideId: slide.id, repairable: false });
    }
  });
  metrics.copyLikeness = checked ? copied / checked : 0;
  metrics.adjacentRedundancy = slides.length > 1 ? redundant / (slides.length - 1) : 0;
  metrics.requiredDetailCoverage = requiredDetails ? coveredDetails / requiredDetails : 1;
  metrics.evidenceCoverageRatio = metrics.requiredEvidenceCount ? metrics.renderedEvidenceCount / metrics.requiredEvidenceCount : null;
  metrics.densityDistributionMatch = densityChecks ? densityMatches / densityChecks : 1;
  const similar = (project.templateFidelity?.reusePlan?.visualSimilarityPairs || []).filter(value => value >= .96).length;
  if (slides.length >= 12 && similar > Math.max(2, Math.floor((slides.length - 1) * .15))) issues.push({
    code: 'template_visual_repetition', severity: 'warning',
    message: `${similar} 组相邻页面视觉相似度过高；应检查版式或媒体变体是否足够`, slideId: null, repairable: false });
  metrics.highSimilarityAdjacentPages = similar;
  const densityReview = inspectDensity(project, slides);
  issues.push(...densityReview.issues);
  Object.assign(metrics, densityReview.metrics);
  return { issues, metrics };
}
