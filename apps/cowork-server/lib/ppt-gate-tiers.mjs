/** Publish gate tiers for card decks (F8, 2026-10-23).
 *
 * On a card deck only integrity blocks publication: a page that overflows or
 * overlaps, type below its floor or without glyphs, broken media or table
 * data, a failed export, a number or formula the model wrote that the source
 * does not have, a locked title changed, a protected template asset lost, a
 * planned object, a reviewed card point or the whole page missing. Every other finding (repetition,
 * sparse copy, obligations, labels, model review) is a review note: the
 * editor lists it and the author decides. Decks of the older flows keep their
 * gates unchanged. See ppt-gamma-results-20261013/
 * PPT_Gamma_SaltAir_vs_Cards_Failures_and_Outline_Simplification_20261023.md §4.2 F8. */
export const BLOCKING_CODES=Object.freeze(new Set([
 // Physical layout.
 'render_overflow','render_overlap','render_geometry_invalid','layout_overlap','title_overflow','rendered_title_capacity','typography_capacity',
 'template_slot_overflow','template_cjk_title_frame_capacity','template_section_decoration_capacity','point_layout_capacity','table_cell_capacity',
 'math_layout_capacity','source_artifact_capacity','card_page_capacity','component_label_capacity','component_label_geometry',
 'planned_native_title_overflow','planned_native_cover_title_overflow','planned_native_cover_title_overlap',
 // Readability.
 // Contrast is a note (Fable D2): theme pages use the template's own colours.
 'minimum_font_size','component_effective_font','font_cjk_coverage','font_invalid_character','formula_or_glyph_placeholder','visible_copy_placeholder',
 // Broken data and export.
 'image_decode','image_crop_invalid','required_source_media_decode','chart_data_invalid','chart_rendering_unsupported','table_matrix_invalid',
 'table_weights_invalid','table_column_identity_missing','export_integrity_failed','unsupported_mathematical_display','math_delimiter_missing','content_empty',
 // Facts the model wrote.
 'source_number_unsupported','numeric_fidelity','numeric_source','visible_numeric_fidelity','visible_formula_unverified','user_title_fidelity',
 // A formula the export cannot write is lost (report 297d4c1d math codes; style codes stay notes).
 'math_export_unsupported',
 // A card that shows a source count that does not multiply out, until edited or kept (Fable).
 'source_arithmetic_shown','orphan_template_icon','section_label_missing','continuation_marker_language','page_number_missing','builder_mark_present',
 // Template and planned objects.
 // Old template text left in the new deck (report 84f9e527, gap 5).
 'template_content_leak',
 // The share of the template's illustrative media kept is a layout finding, a
 // note (the user, 2026-11-03: only lost source content, a broken required
 // object or a broken export blocks); a lost protected asset still blocks.
 'template_media_assembly_split','template_omission_invalid','template_asset_loss','template_component_clone_invalid','native_component_member_missing',
 'media_replacement_missing','required_source_object_missing','required_source_media_missing','media_required_missing',
 // A reviewed card point that no page shows (Fable D2).
 'card_point_missing','empty_template_component',
 // A row of a cited written table that no page shows or notes (Fable 2026-11-02).
 'cited_table_rows_missing',
]));
export const isBlocking=code=>BLOCKING_CODES.has(String(code||''));
/** Text below 2:1 contrast blocks where the deck rebuilt the text (theme and
 * object pages); on a native or cover page the colours are the template's own
 * pair and it is a note (Fable 2026-10-26, from report 52c7696e; 3143 g4 page 4). */
const REBUILT_PAGES=new Set(['theme','objects']);
const blocks=issue=>isBlocking(issue.code)||issue.code==='text_contrast_insufficient'&&REBUILT_PAGES.has(issue.pageMode);
/** A card deck's findings with every non-integrity error turned into a review
 * note (severity 'warning', reviewNote, originalSeverity kept). */
export function tierCardDeckIssues(issues=[]){
 return issues.map(issue=>issue?.severity==='error'&&!blocks(issue)?{...issue,severity:'warning',reviewNote:true,originalSeverity:'error'}:issue);
}
/** Model review findings on a card deck are review notes, never a gate. A
 * contradiction the confirmation pass confirmed, or a claim the audit found
 * contradicted, is a highlighted note (confirmed: true), listed first (Fable
 * 2026-10-26: the report's model-derived blocks were not ported). */
const confirmedContradiction=issue=>issue?.code==='claim_entailment_contradicted'||issue?.code==='model_conflict'&&issue.confirmed===true;
export function tierCardDeckModelIssues(issues=[]){
 const tiered=issues.map(issue=>issue?.severity==='error'?{...issue,severity:'warning',reviewNote:true,originalSeverity:'error',...(confirmedContradiction(issue)?{confirmed:true}:{})}:issue);
 return [...tiered.filter(issue=>issue?.confirmed),...tiered.filter(issue=>!issue?.confirmed)];
}
/** User decision 2026-10-31 (D2, like Gamma): a card deck publishes when its
 * remaining errors are local to pages it names. Each such error stays in the
 * report as a flagged note (pageFlag) the editor marks on its page. Facts the
 * model wrote that the source does not support still block, as does anything
 * that is not tied to a page (a broken export, an empty deck). Repairs run on
 * the errors before this, so it only decides publication. */
export const FACT_CODES=Object.freeze(new Set(['source_number_unsupported','numeric_fidelity','numeric_source','visible_numeric_fidelity','visible_formula_unverified','user_title_fidelity','source_arithmetic_shown']));
// A lost row of a cited table is content loss, never a page flag (Fable 2026-11-02).
const DECK_CODES=new Set(['export_integrity_failed','content_empty','font_cjk_coverage','builder_mark_present','cited_table_rows_missing']);
const pageLocal=issue=>Boolean(issue?.slideId||issue?.slideIds?.length);
// A formula rebuilt from approximate PDF math text is checked on its page (the user, 2026-10-31),
// as is a card formula still unmatched after its one send-back (Fable Q1, 2026-11-03).
const approximateFormula=issue=>issue?.code==='visible_formula_unverified'&&(issue.approximateSource===true||issue.sentBack===true);
// A number never blocks a card deck (Fable F4, 2026-11-01, the user: "下一次不要
// 再因为numeric被阻止"): its page is flagged with the number and why.
const NUMBER_CODES=new Set(['source_number_unsupported','numeric_fidelity','numeric_source','visible_numeric_fidelity']);
const numberFlag=issue=>NUMBER_CODES.has(issue?.code);
export function pageFlaggable(issue){return issue?.severity==='error'&&pageLocal(issue)&&(!FACT_CODES.has(issue.code)||approximateFormula(issue)||numberFlag(issue))&&!DECK_CODES.has(issue.code);}
const numberMessage=issue=>{const findings=issue.numericFindings||[],missing=findings.filter(item=>item.reason==='value_or_sign_not_in_input').map(item=>item.raw),loose=findings.filter(item=>item.reason!=='value_or_sign_not_in_input').map(item=>item.raw);
 return [missing.length?`Not found in the source: ${[...new Set(missing)].join(', ')}.`:'',loose.length?`In the source, but not with this unit or meaning: ${[...new Set(loose)].join(', ')}.`:''].filter(Boolean).join(' ')+' Check these numbers on this page.';};
export function flagPageIssues(deterministic){
 if(!deterministic?.cardOutline)return deterministic;
 const issues=(deterministic.issues||[]).map(issue=>pageFlaggable(issue)?{...issue,severity:'warning',pageFlag:true,originalSeverity:'error',...(numberFlag(issue)&&issue.numericFindings?.length?{message:numberMessage(issue)}:{})}:issue);
 return {...deterministic,issues,hardErrors:issues.filter(issue=>issue.severity==='error').length,flaggedPages:[...new Set(issues.filter(issue=>issue.pageFlag).flatMap(issue=>issue.slideIds?.length?issue.slideIds:[issue.slideId]))]};
}
