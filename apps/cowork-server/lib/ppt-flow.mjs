/** Which planning flow a project uses. A leaf module (no imports), so outline,
 * template and quality modules can all ask without import cycles. */
export const outlineFirst=p=>p?.planningContract?.version===3;
/** Card outline (ppt-outline-cards.mjs): every outline-first project writes
 * cards (R1-R8 confirmed 2026-10-22); the card count follows the measured
 * need and a page preference is a soft request, never an authorization gate. */
export const cardsFlow=p=>outlineFirst(p);
