# Uploaded PPTX template fidelity

## Root cause

The previous uploaded-template path extracted palette and font tokens, then built a new presentation from AIMate layouts. The original PPTX was never the export base. Its pictures, diagram parts, cards, background artwork, and object order were therefore absent from generated decks.

## Implemented path

1. Analyze the uploaded PPTX and retain its original bytes in the template store.
2. On project creation, import each original slide into stable native shape IDs and an object-level template contract. Keep original geometry, order, pictures, crops, and style metadata. A page without editable text slots is rejected.
3. Give the Story Planner a compact page-by-page slot contract. The existing content node returns text keyed by native shape ID. A bounded retry checks missing and overlong slots without adding a DAG stage.
4. Bind generated copy to native text shapes. Preserve static pictures and components. Preview and editor read the same native geometry and content. Template text and image placement are represented in the Render Tree.
5. Export by opening the original PPTX and changing only mapped native text and supported object edits. When the confirmed page count is larger, duplicate interior native slides and reorder them using the persisted `slideMap`. Validate every output slide against its source slide's shape count and picture hashes before replacing the published file. Native PDF conversion starts from that published PPTX.
6. Keep template objects under the conservative editing rules. Text, supported style changes, and geometry can be edited and published through the Command Journal. Structural edits and stacking changes are disabled for preserved templates because the native exporter does not implement them.

## Current boundary

- Preserving every original slide requires the confirmed page count to be at least the uploaded PPTX page count. Additional pages reuse original interior slides with distinct stable node IDs. Fewer pages are rejected because they would omit original artwork; an internal template or explicit mapped mode can be used for a shorter deck.
- Native charts and tables remain in their original form. A future data-binding path is required to update their values; the current fidelity path targets text and existing artwork.
- PowerPoint retains the template's original font names. PDF rendering requires the fonts or compatible glyph fallbacks in the Cowork image. The image now includes LibreOffice and Noto CJK fonts.

## Verification

- `node apps/cowork-server/selftest-ppt-template-fidelity.mjs` creates a three-slide PPTX, confirms native picture bytes, shapes, text replacement, preview, PDF conversion when LibreOffice is available, 3-to-5 slide native duplication, rejection when the page count is too small, and an edit through the Command Journal.
- The user-supplied `Gamma-AI.pptx` was inspected with the same importer: 10 slides, 201 native shapes, 39 picture placements; the exported regression deck retained the same counts and picture hashes.
- `npm run typecheck` and all PPT server selftests passed.
