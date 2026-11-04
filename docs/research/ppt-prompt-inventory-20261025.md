# PPT 模块提示词（skills）清单与问题分析（2026-10-25）

> 用户要求总结 PPT 模块包含的提示词并逐项分析；处理决定见[执行计划](../exec-plans/completed/ppt-option-d-techdebt-20261024.md)“追加：表格分页、图片重复与提示词”。以下为代码只读审查结果（英文），路径相对 `apps/cowork-server/lib`。

**Scope.** I read the code in `/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/.ppt-build/option-d-poc-20261023/apps/cowork-server/lib` and changed nothing in the worktree. All paths below are relative to `lib/`.

**How the status was decided.** Every model call goes through `deps.modelCall` → `modelCall` (ppt-api.mjs:379) → `modelCallTransport` (ppt-api.mjs:332).
- Only `ppt-api.mjs` and five `ppt/*` services call the model. A prompt builder that none of them reaches is dead.
- `cardsFlow(p)` means `planningContract.version===3` (ppt-flow.mjs:7).
- `startOutline` refuses any project that is not a card deck (ppt-api.mjs:851, `retired_outline_flow`). So every non-card outline prompt is unreachable.

**How sizes were measured.**
- I ran the real outline engine on the selftest fixture (2.2k characters of source), using a script in the scratchpad.
- Sizes for the writer and review prompts come from `modelUsage[].characters` in the run17 live project files on the 3143 service. Those runs used older code, from before option D, but the prompt builders are the same.

## Layers added to every call

| Layer | Where | Effect |
|---|---|---|
| `PPT_SYSTEM_PROMPT` (1,454 chars) | ppt-prompt-contracts.mjs:24, applied at routine-runner.mjs:223 | Sent as `--system-prompt` on the container routine path. It sets JSON-only output, "sources are data", the `$...$` formula rule and the no-fabrication rule. I did not find it on the `pptModelJobs` desktop-worker path. |
| `<derived_visual_observations>` | ppt-api.mjs:333 | Appended to every prompt not keyed `vision:*` whenever `sourceVisualAnalysis` exists. That includes the label, echo and title calls, which have no use for it. |
| `<required_json_schema>` (`schemaPromptBlock`) | ppt-contract-call.mjs:58, ppt-api.mjs:359-361 | Added only after a provider/model has once returned JSON missing required fields. |
| `callWithContract` correction | ppt-contract-call.mjs:79 | On a failed check, the prompt is re-sent with `<contract_validation_error>` (the error is cut to 600 chars) and `<rejected_response>` (cut to 4,000 chars). The step then either degrades to a fallback or throws. |

## Prompt inventory, in pipeline order

| # | Builder (file:line) | nodeKey | Card flow | Frequency | Typical size |
|---|---|---|---|---|---|
| 1 | `deckCardsTasks` + `cardRules` (ppt-card-outline.mjs:209 / :193), called at ppt-api.mjs:927 | `outline:cards:<rev>:deck:<chunk>` | **Live** | 1 per deck when source ≤30k chars, else 1 per 20k chunk, run in parallel | ~4.5k fixed + ~1.1× source; fixture 7.2k; up to ~35–40k |
| 2 | `cardTopicTask` (ppt-outline-cards.mjs:176), called at ppt-api.mjs:940 | `outline:cards:<rev>:topic:<i>[:retry][:contract]` | **Live** | Per topic whose deck reply fails or is missing | 4.9k fixed + topic source; run17 9–18k, corrections 10–20k |
| 3 | `briefDeckTask` (ppt-card-outline.mjs:649), called at ppt-api.mjs:914 | `outline:cards:<rev>:brief[:contract]` | **Live** when the input has no source units (`isBrief`, :625) | 1 per deck + 1 correction | ~3k + brief |
| 4 | `deckFinishTask` (ppt-card-outline.mjs:235), called at ppt-api.mjs:966 | `outline:finish:<rev>` | **Live** | 1 per deck | fixture 6.5k; ~6–12k |
| 5 | `takeawayCorrectionTask` (:348), called at ppt-api.mjs:971 | `…:takeaway[:retry]` | **Live** | Only when the takeaway is refused | ~4.8k |
| 6 | `labelCompletionTask` (:410), called at ppt-api.mjs:983 | `…:labels` | **Live** | Only when a card's labels are partly valid | 1–3k |
| 7 | `echoRewriteTask` (:387), called at ppt-api.mjs:987 | `…:echo` | **Live** | Only when points on a card with fewer than 3 points repeat the takeaway | 1–2k |
| 8 | `titleShortenTask` (ppt-card-pages.mjs:325), called at ppt-api.mjs:1025 | `outline:cards:<rev>:titles` | **Live, native (preserve) templates only** (ppt-api.mjs:1016) | 1 per deck, only if cheap shortening fails | 1–3k |
| 9 | `writerPrompt` via `contentPrompt` (ppt-prompt-contracts.mjs:337; ppt-api.mjs:319), plus `writerLocalRepairPrompt` (ppt-writer-local-repair.mjs:95) and `writerRepairPrompt` (:479) | `content:<id>`, `:contract-repair:n`, `:repair[:n]` | **Live on built-in templates only** (cover + every content card without source objects); preserve templates practically never reach it | Per page, plus up to 3 repairs | run17: 39–47k, repairs 42–60k |
| 10 | Title edit during generation (generation-edit-service.mjs:223) | `content:<id>:title` | **Live** (author edits a title while the deck is generating) | On demand | ~9k+ (8.7k of it is `promptPolicy`) |
| 11 | AI edit (ppt/proposal-service.mjs:192–194) + `aiActionPrompt` (ppt/ai-actions.mjs:28) | `ai:<proposalId>` | **Live** | Per editor AI action | 12k + context (up to ~60k) |
| 12 | Scope audit = `deckReviewPrompt` (ppt/input-scope-service.mjs:42) | `review:deck:local-scope:candidate` | **Live, no card guard** | After every AI text, data, structure or asset edit | ~160–175k for decks under 20 pages (whole deck) |
| 13 | `typedCommands` (ppt/typed-proposal.mjs:26; prompts at :34 layout, :40 style, :63 data, :81 split, :110 insert) | `ai:<id>:<task>` | **Live**; on native templates only style is allowed (edit-context.mjs:34/40) | On demand | 9k+ |
| 14 | `deckReviewPrompt` + `reviewWithContractRepair` (ppt-quality.mjs:372 / :599), via `aiCheckProject` (ppt/publish-service.mjs:83) | `review:deck[:batch:n][:contract/:source-witness:n]` | **Live, on demand (AI check)** | Per AI check | 160–175k |
| 15 | `confirmNegativeClaimAudits` (ppt/claim-audit-confirmation.mjs:24/41) | `review:deck:claim_confirmation:<claim>` | Live (inside #12 and #14) | 1 per negative claim, ×2 on a contract error | ~10–50k |
| 16 | `confirmReviewFindings` (ppt/review-findings-confirmation.mjs:58/91) | `review:deck:findings_confirmation[:batch:n]` | Live (inside #14) | 1 per 3 findings | ~52k each |

### 1–2. Writing the cards
- **Input.** Each topic's source units (id, type, languagePairId, text, rows), the topic title and the number of cards code fixed for it. The topic prompt (#2) also gets `requiredSourceUnitIds` and `objectSourceUnitIds`.
- **Output.** `{topics:[{topicId,cards:[{title≤160, numbered, visualIntent, points[{text≤280, sourceUnitIds 1–8}], objects}]}]}`. The schema allows 1–3 cards per topic; it does not enforce the exact count.
- **Rules in the prompt.**
  - One idea per point, at most 90 Latin or 45 Han characters per language. 1–5 points, up to 8 for a numbered list, at most 3 next to objects.
  - Never write item or step numbers inside a point.
  - Keep every number, name, formula (`$...$` exactly as in the source) and term. Never invent facts.
  - Bilingual decks: every title and point on ONE line as "English | 中文", with a field-specific glossary example (universe → 股票池). Density follows `CARD_DENSITY` (concise / standard / detailed).
- **Checks after the reply.** `acceptCardTopic` (ppt-outline-cards.mjs:453) normalizes first: strips list numbers, adds a citation for any repeated number, restores source math, fixes bilingual terms. `cardTopicProblems` (:316) then splits problems into hard ones and soft ones (`SOFT`, :199).
  - Hard (sent back): count, citations, numbers or formulas not in the source, length over 130%, a title joining two section headings, an uncovered section over 300 chars, an object shown in the wrong section.
  - Soft (listed only): fit, duplicates, required units not cited, uncited numbers.
- **Corrections.** The deck reply counts as the first attempt, so a topic gets one correction; without a deck reply it gets up to two (ppt-api.mjs:940). A timeout is retried once. If the correction itself fails, the deck reply is kept, sanitized and listed (`sanitizeCardTopic`, :467). A topic that never got a reply fails the outline.

### 3. Brief mode (no source)
- Exactly n cards from the brief. No statistics, dates, studies or named-entity claims unless the brief states them. Formulas only as `$...$`.
- Code accepts small counts 1–12 as numbers (:661).
- The rules are English-only; there is no bilingual rule.

### 4–7. Finishing the outline
- **#4 finishing call.** One call returns chapter names (2–5 words, ≤40 chars), a takeaway (a claim-sentence title within the title budget; one statement citing its units; not a repeat of any card point), 2–5-word labels made only of each point's own words, and a `coverTitle` when the cover title does not fit.
  - `acceptDeckFinish` (:433) checks each piece on its own. A bad chapter name falls back to its first heading; labels are all-or-none per card.
  - `acceptTakeaway` (:296) checks citations, numbers, formulas, length (2× budget), repeats of a point (≥75% word overlap), the title as a claim (verb regex, :268), the title language, and a bilingual pair title.
  - If the whole call fails, chapters use their first heading and the deck has no takeaway and no labels (ppt-api.mjs:968).
- **#5 takeaway correction.** One more call, retried once on a transport error. If it fails again: a "Key Takeaway" title and a paired sentence cut (`pairedSentenceCut`, :287), or the takeaway is dropped.
- **#6 label completion.** Missing labels only, as a "Title Case" noun phrase. `settleLabels` (:420) re-checks each label with `labelProblem`; a gap that remains is filled from the point's lead before ":" or the card loses all its labels.
- **#7 echo rewrite.** Same numbers and form, without the takeaway's wording. A rewrite is applied only if its numbers are a subset of the original's, it no longer echoes, and it keeps the pair form (:398).

### 8. Title shortening
- Rewrite each unfit title to at most `maxCharacters`, using only words from the title, its points and its source heading. On bilingual decks the prompt also asks for " | translation".
- `acceptShortTitles` (:337) keeps a title only if it fits the slot, keeps the pair form and duplicates no other title. Otherwise code cuts it at a word boundary (`fallbackCardTitle`).

### 9. Page writer (built-in templates)
- **How a page is routed** (ppt-api.mjs:1458–1477):
  - Code writes the page: native card pages (`cardPageDraft`), the native cover, frames on built-in templates, and any page with objects (`cardObjectPageDraft`).
  - The writer runs for the rest: the cover and every content card without objects on built-in templates; on native templates, only a card with no points and no objects.
- **What the prompt contains.** `promptPolicy` (8.7k chars even on a small fixture), `writingGuide` (2.7k), `<whole_deck_message_ownership>`, `<brief>`, `<deck_plan>`, `<slide_contract>`, `<card_contract>` ("exactly these card points"), `<source_packet>` (≤28k), the page's own source content and evidence. Mostly in Chinese.
- **Checks.** `normalizeSlide`, then the copy checks (`card_point_missing`, slot, evidence). Up to `maxQualityRepairs` (3) repair rounds; remaining errors are downgraded to `pageReview` warnings on card decks (ppt-api.mjs:1539).

### 11–13. Editor AI edits
- **#11 AI edit.** One of seven actions (improve, grammar, translate, expand, shorten, simplify, specific), plus `promptPolicy`, `writingGuide`, `editPromptContext` (ppt-prompt-contracts.mjs:247), the objects and their capacity. Returns `{"content"}`, `{"patches"}` or `{"replacement"}`.
  - Checked by `semanticContent` and `validateCandidate` (deterministic, ppt/proposal-service.mjs:84), then by #12.
- **#12 scope audit.** Any finding on a changed page, or `not_evaluated`, rejects the edit with a 422.
- **#13 typed commands.** Layout, style, data, split and insert prompts. The data prompt's numbers are checked against the sources (typed-proposal.mjs:66–69).

### 14–16. AI check
- Uses the legacy whole-deck rubric: obligations, claim audit, the selection ledger, notes/summary handling, object coverage. A transport failure keeps the previous review (`keepReviewAfterUnavailable`).
- On card decks, findings are review notes only; the deck's status and publication do not change.

## Weaknesses and risks found in the code

1. **Prompts still ask for bilingual titles although titles show the main language only.** Since 2026-10-24 `language.title` defaults to `'primary'` (ppt-generation-policy.mjs:27/33), and `bindTitleHierarchy` hides the second half (ppt-title-hierarchy.mjs:62). Yet the deck rules (ppt-card-outline.mjs:195), `languageRule` (ppt-outline-cards.mjs:169), the finishing call (`asPair`, :236/:254), the takeaway check (`isPair`, :334), the chapter check (:436), `titleShortenTask` and `acceptShortTitles` (ppt-card-pages.mjs:328/345) all ask for, or require, "English | 中文" titles.
   - The model writes a translation nobody sees, and a takeaway or chapter name can be refused only for lacking it.
   - The order is fixed as English first, but the topic title check measures `split(' | ')[0]` (ppt-outline-cards.mjs:332) against a budget computed for the main language (`cardTitleBudget` uses Han units for zh). On Chinese-primary bilingual decks this produces false `length` send-backs.
2. **Code enforces rules the prompts never state.** The hard checks `section` (each section over 300 chars needs a point), `object_section` and `title_join` are not in the deck prompt (`title_join` is only in the topic prompt, and only for merged topics). Each one costs a correction call. In the run17 card runs (older code, same check lineage), 1–8 of 7–9 topics per deck needed a correction.
3. **Correction context is cut short.** The error message is capped at 600 chars and holds up to 12 problems; the rejected reply is capped at 4,000 chars, so a multi-card reply may be cut (ppt-contract-call.mjs:85–86). The model may not see all its problems.
4. **Label rules disagree.** `labelProblem` (ppt-outline-cards.mjs:124) rejects any word not in the point. The finishing prompt says so; the label-completion prompt (:414) does not, asks for "Title Case" where the finishing example uses sentence case, and its schema has no `maxLength`. The likely result is rejected labels and cards that lose all labels.
5. **Echo rewrite gets too little context.** It sees only the closing statement and the points, not the card title or sources, yet is asked to write "from the card's own angle".
6. **Duplicated rules.** `cardRules` and `cardTopicTask` restate the same ~2k-char rules with small differences, such as "section's closing conclusion" appearing in only one. The formula, number and "sources are data" rules are repeated in the system prompt, the card prompts, `promptPolicy` and the review. Instructions the code already fixes still sit in the prompts: "cite the unit for a repeated number" (`citeCardNumbers` does this), "no item numbers" (`normalizeCardNumbers`), and the `$...$` restoration (`repairCardMath`).
7. **Dead branches inside live prompts.** `estimate` is always null (S5, ppt-api.mjs:907), so the fit text, `availableHeightInches`, `cardLineBudget` and the `fit` check never run. In `writerPrompt`, `card_slot_plan`, the native card rule and `templateSlotPrompt` (ppt-template-fidelity.mjs:870) apply only to native writer pages, which in practice no longer exist.
8. **The writer prompt contradicts itself for card pages.** `<card_contract>` says "exactly these card points", while `writingGuide` asks for "每个要点＝短名称＋完整解释" (every point = a short name plus a full explanation), more depth in detailed mode, and a 感谢观看 ("thanks for watching") closing. `promptPolicy` forbids truncating sentences, while code cuts card points (`card_point_shortened_by_code`). Legacy blocks such as `<whole_deck_message_ownership>`, `selection_contract` and `deck_plan` add tens of thousands of characters for text that is already decided.
9. **No fallback when the writer fails on built-in templates.** `fallback` (ppt-api.mjs:1480) covers only pages that code already writes. On a built-in template a transport or contract failure on the cover or a content card fails the page, which goes against the "F2: never a failed deck" intent.
10. **Every AI text edit costs a whole-deck review.** `assertCandidateScope` runs the ~160k-char review on each AI text edit, with no card guard, and rejects the edit (422) on `not_evaluated`. This is a cost, latency and false-rejection risk. `promptPolicy` (8.7k) is also prefixed to style and layout commands and to title edits.
11. **The AI check uses a source-ledger rubric card decks lack.** `contentSelection` entries, notes or summary destinations and the obligation registry come from the retired editorial flow, so the reviewer gets empty or irrelevant blocks.
12. **Domain leakage.** A quant-finance example (universe → 股票池) is hard-coded in generic bilingual rules (ppt-card-outline.mjs:195, ppt-outline-cards.mjs:169).

## Unreachable from card decks (candidates for deletion)

**Unreachable in the card flow, with the guard that blocks each:**
- **Navigation plan + label audit + label repair.** `prepareNavigationPlan` (ppt-navigation-plan.mjs:61, called at ppt-api.mjs:1068/1615) needs a page with role `navigation`; card assembly never creates one.
- **Topic-title projection.** `prepareTopicTitleProjection` (ppt-topic-title-projection.mjs:36, called at ppt-api.mjs:1360) returns null for `generationPolicy.version===2` (:9). With it, `languageProjectionPrompt` and `languageProjectionAuditPrompt` (ppt-language-projection.mjs:43/65) go too.
- **Post-writer consolidation** (`content:<id>:postwriter`, ppt-api.mjs:1621). `executePostWriterPlan` (ppt-postwriter-executor.mjs:13) exits unless `pageDecision.mode==='auto'`; card decks set `'explicit'` (ppt-api.mjs:1034).
- **Deck review during generation.** `review:deck` and `review:deck:refresh` are skipped for card decks (ppt-api.mjs:1637–1640, 1655), and so is the publish-time `reviewSemantic` (ppt/publish-service.mjs:28).
- **Page reassessment** (`input:page-reassess`, ppt-page-reassessment.mjs:22/41). The card reading's identity (`codeUnderstandingIdentity`, ppt-card-outline.mjs:54) never equals `understandingIdentity` (ppt-input-understanding.mjs:20), so the endpoint always returns 409 (ppt-api.mjs:2185).
- **Source-summary repair** (`repair:source-summary`, ppt-summary-recovery.mjs:15 → `outlineSummaryRepairPrompt`, ppt-outline-protocol.mjs:127). It needs `contentSelection` summary entries, which card outlines do not have.

**Legacy rewrite endpoint:** ppt-api.mjs:2631–2655. Chinese prompt, no nodeKey, works on `slide.bullets`, no card guard. Client use could not be checked because this worktree has no client sources.

**Prompt builders nothing calls:**
- ppt-outline-protocol.mjs: `skeletonPrompt`/`skeletonBatches` :338/:368, `outlineDeltaPrompt` :281, and the metadata, relation, relation-batch and ownership repair prompts (:67/:180/:193/:211).
- `editorialSkeletonPrompt` (ppt-editorial-planner.mjs:7) and `editorialOwnerRepairTask` (ppt-editorial-contract.mjs:45).
- `semanticTask`, the semantic cover/coverage/metadata repair tasks (ppt-outline-first.mjs:104–161), and `continuationTask` (ppt-outline-continuation.mjs:7).
- `semanticGroupsPrompt` / `semanticPlanningResponseSchema` (ppt-semantic-groups.mjs:149/167) and `semanticEditorialPrompt` (ppt-semantic-editorial.mjs:25).
- `tableRowSelectionRepairTask` and `tableProjectionRepairTask` (ppt-table-projection.mjs:8/90).
- `outlineContentContract` with `terminologyLockPrompt` (ppt-prompt-contracts.mjs:282) and `templateOutlinePrompt` (ppt-template-fidelity.mjs:901).
- The schema sniffers in `modelResponseSchema` (ppt-api.mjs:377): `outlineResponseSchema`, `navigationResponseSchema`, `languagePairAuditSchema`.

The measurement script is (a scratch measurement script, not in the repository); it lives in the scratchpad and is not part of the repo.
