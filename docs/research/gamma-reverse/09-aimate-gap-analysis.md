# Gamma vs the AIMate PPT engine: gap analysis

> Part of the Gamma reverse-engineering set: [index](README.md)

Markers on the **Gamma** side follow the set convention (🟢 confirmed, 🟡 inferred, 🔴 unknown) and point to the domain report that holds the evidence. The **AIMate** side is read from this repository's working tree on 2026-11-05 (HEAD `23bc10e`, one commit after `7c8ee63`) and cites the file. "Facade" means the Gamma-compatible API added in `7c8ee63` (`src/lib/ppt-gamma-*.ts`, route `src/app/api/ppt/gamma/v1.0/[...path]/route.ts`).

Priority: **P0** = a user-visible quality gap Gamma users would notice in the first deck; **P1** = an important capability gap; **P2** = nice to have or out of scope for a desktop app.

---

## 1. Summary

| Area | Verdict | Biggest single gap |
|---|---|---|
| Generation pipeline | Near parity in shape; we stop for review more often | API callers get `failed` at review stops; whether `generation-edits` matches Gamma's queued instructions is unverified |
| Content handling | Parity in principles; density and composition still behind on dense inputs | Composition patterns (paired tables, comparison grids) that let dense decks hold ~1,000 characters per page |
| Media | **Largest gap** | No accent/decorative images (AI, stock or theme); 512 KB PNG/JPEG cap; no GIF/SVG/WebP |
| Themes and templates | Different but comparable; we are stronger on PPTX template fidelity | No slide-level template instructions; no header/footer configuration |
| Editing | Close | No element-scope AI selection chip; no grouped accept/restore receipt in chat |
| Import and export | Behind | No PNG export; no prompt-directed import intent; links need auth |
| API, MCP, analytics | Facade covers the generation subset | No MCP surface; no edits, exports or search endpoints; no analytics |

---

## 2. Generation pipeline ([02](02-generation-pipeline.md))

| Topic | Gamma | AIMate | Gap → recommendation | Pri |
|---|---|---|---|---|
| Entry flow | Intake → optional clarifying questions → editable plan → Generate → per-card build → summary 🟢 | Input → read input (`input_ready`) → settings form (length, density, language) → card outline (`outline_ready`) → confirm → generate (`apps/cowork-server/lib/ppt-api.mjs`, planning `command:'outline'`) | Same shape. Gamma asks only when the prompt is vague; we always show the settings form. → Keep. Consider skipping the form when the request already states length and language. | P2 |
| Progress model | `queued/writing/imaging/checking/polishing/done/failed` per card; `percent` 0–99 🟢 | Per-page `generationStages.pages` (`waiting`, `retrieving`, `writing`, `layout`, `previewing`, `validating`, `repairing`, `ready`, `failed`; `apps/cowork-server/lib/ppt/project-view.mjs`), `progress{contentReady, previewReady, total}` (`src/components/ppt/types.ts`) | Richer than Gamma internally. The facade maps it (`gammaProgress` in `src/lib/ppt-gamma-compat.ts`). | — |
| Instructions during build | Queued, editable, run after the build 🟢 | `generation-edit-scopes` / `generation-edits` routes, plus pause/resume (`src/lib/ppt-proxy-path.ts`) | 🟡 Possibly equivalent; this was not run against a live deck in this round. → Verify, and expose it in the facade as an edit call. | P1 |
| Review stops | None in the API: the agent decides; results are "not validated" 🟢 | Generate refuses with 409 for, among others, card facts not in the source, unplaced source objects, unresolved source warnings, title capacity, frozen sources that do not fit (`ppt-api.mjs`, `action === 'generate'`) | Our gates are stricter by design (faithfulness). For API callers the facade turns a generate 409 into `failed` + `gammaUrl` (`advance` in `src/lib/ppt-gamma-service.ts`). → Offer an API option `reviewPolicy: 'auto'` that downgrades non-safety gates to warnings. | P1 |
| Concurrency | 2 / 10 agent jobs per workspace 🟢 | At most 3 concurrent Agent SDK model calls per app process (`PPT_AGENT_SDK_CONCURRENCY`, `src/lib/ppt-desktop-model-worker.ts`); the cap covers the SDK channel only. Not in the SDK handoff doc | Fine for a desktop app. | — |
| Where models run | Server side 🟢 | User's desktop worker (`src/hooks/usePptDesktopModelWorker.ts`) | The structural cause of "the app must be open". → Document it; optionally add a headless worker in the Next server for API jobs. | P1 |

## 3. Content ([03](03-content-handling.md))

| Topic | Gamma | AIMate | Gap → recommendation | Pri |
|---|---|---|---|---|
| Outline = final content | 🟢 | Card outline written in one call, edited directly (`ppt-card-outline.mjs`) | Parity | — |
| Text modes | generate / condense / preserve 🟢 | `knowledge` source_only / source_plus_explanation; `content` overview / full_source (`ppt-generation-policy.mjs`) | Mappable (the facade does it). Gamma's "preserve but add headings" is closest to `full_source`. | — |
| Amount | brief / medium / detailed / extensive 🟢 | concise / standard / detailed | No "extensive". → Fine. | P2 |
| Languages | 67 output-language codes, independent of input 🟢 | bilingual / en / zh / zh-Hant (`ppt-card-language.mjs` `LANGUAGE_CHOICES`) | Large gap for non-Chinese/English users. → Add an output-locale passthrough for writing; titles and fonts need per-script measurement (`measureText`). | P1 |
| Card count | Agent: content-driven, `numCards` a soft target; capped at 10 (Free) / 100 (paid), above that 400 🟢 | Presets quick/standard/full or exact 6–40 (`ppt-card-outline.mjs` `LENGTHS`; `ppt-api.mjs` planning `command:'outline'`); only an author-supplied outline goes outside it (create `pages` 3–100, `ppt-api.mjs`) | The planner cannot target 1–5 or 41–100 cards. → Allow exact 3–60. Capacity measurement already exists. | P2 |
| Density | Template-dependent 🟡: median 1,019 characters per body page (~11 pt explicit-size median) in the dense Factor Zoo deck, but a median of about 75 English words per page in a sparser lesson-template deck 🟢 ([03 §4](03-content-handling.md); [density review](../ppt-gamma-density-page-estimation-review-20261006.md)) | Body-page median 443 characters on the same input as the dense deck in that review; improved since by card capacity work (`ppt-density-capacity.mjs`) | → Compare against Gamma **on the same input and same template density class**, never a single global band. Re-measure on the current main branch. | P0 |
| Composition | Comparison grids, paired tables, problem + evidence, process with inputs/actions/checks/outputs 🟢 | Native diagrams (`ppt-diagram-cards.mjs`), key-number cards (`ppt-key-number.mjs`), icon grids (`ppt-card-icons.mjs`) | → Add "paired table" and "comparison grid" card layouts. | P1 |
| Charts | Prompt-steered, non-deterministic 🟢 | Deterministic native bar/pie charts with 2–6 labels (`ppt-blocks.mjs`) | **We are stronger** (predictable). → Add line/column/stacked types. | P2 |
| Bilingual | Merged per line "English \| 中文" 🟢 | `language.body` primary/both; card titles in the primary language unless `title:'both'` (`ppt-generation-policy.mjs`) | Parity | — |
| Faithfulness | Not validated against the source 🟢 | Fact checks (`ppt-content-qa.mjs`, card fact issues) | **We are stronger**; keep it. | — |

## 4. Media ([04](04-media-handling.md)), the largest gap

| Topic | Gamma | AIMate | Gap → recommendation | Pri |
|---|---|---|---|---|
| Decorative / accent images | Automatic per card (whether, where: L/R/top/background, what), from the chosen source 🟢 | Template "chrome slots" reuse certified template images only (`ppt-chrome-slots.mjs`); built-in templates have no image library | **P0.** → An accent-image provider behind the chrome-slot contract, in order: (1) theme accent packs for built-in templates; (2) a licensed stock API; (3) AI image generation through the app's existing image generator (`src/lib/image-generator.ts`), with one deck-wide style string. | P0 |
| Image sources | 10 sources incl. AI (34 still-image models), Pexels, Giphy, web with licence filters, theme accent, placeholder, none 🟢 | Input images only | As above, plus a `placeholder` mode (empty image slots for the user to fill). | P1 |
| Input image formats and sizes | jpg/png/gif/webp/svg/heic/heif/avif; uploads ≤50 MP 🟢 | PNG/JPEG ≤512 KB, caption ≤100 characters, ≤64 per source (`ppt-blocks.mjs`) | → Server-side transcoding to PNG/JPEG with downscaling (WebP/AVIF/HEIC/GIF first frame; SVG rasterised) before the 512 KB check. | P1 |
| Image URLs in text | Bare https URLs fetched and re-hosted; failures skipped silently 🟢 | In-app: any unembeddable reference is a **required** warning that blocks generation (`ppt-source.mjs` `normalizePaste`). Facade: fetched with public-host guards (`src/lib/ppt-gamma-image-fetch.ts`) | → Bring the facade's behaviour into the app as an explicit "skip unreachable images" choice (tech-debt #34). | P1 |
| Figure ↔ point pairing | One picture per idea, on the card that explains it: 🟢 observed (hands-on), 🟡 as a general rule | Same rule ([SDK handoff](../../exec-plans/active/ppt-sdk-round-handoff-20261103.md) rule 5; `ppt-card-figure-layout.mjs`) | Parity | — |
| Standalone image generation | `POST /images` with reference images and theme branding 🟢 | The image studio exists in the app (`src/components/image-studio`) but is not wired to decks | → Wire it to slide image slots. | P1 |
| Video, GIF, embeds | Blocks and embeds 🟢 | None (PPTX export target) | Out of scope for PPTX. | P2 |

## 5. Themes, templates, brand ([05](05-themes-templates-brand.md))

| Topic | Gamma | AIMate | Gap → recommendation | Pri |
|---|---|---|---|---|
| Theme vs template | Theme = styling; template = structure + styling; mutually exclusive on the agent endpoint 🟢 | Built-ins (violet/blue/light/marketing/education) act as themes. Uploaded or managed PPTX templates have `templateMode` preserve/mapped and `templateContentMode` design_only/keep_fixed (`ppt-api.mjs` create; `ppt-template-fidelity.mjs`) | **We are stronger on PPTX fidelity** (native slot filling). | — |
| Template instructions | Template-level and slide-level instructions plus locked slides, applied on every generation 🟢 | Fixed objects (`templateFixedObjectIds`), keep-fixed mode | → Add per-template-page instructions ("this page is for pricing"). Cheap, and high value for template matching. | P1 |
| Headers and footers | Six positions × text / logo / card number; hide on first/last card 🟢 | Template-defined only | → Expose page-number and logo positions as deck settings. | P2 |
| Dimensions | 16:9, 4:3, fluid, A4, letter, social sizes 🟢 | 16:9 only | → 4:3 is the only cheap win. | P2 |
| Theme catalogue API | `GET /themes` with colour and tone keywords 🟢 | Template list with category and tags; the facade maps them to `toneKeywords` and always returns `colorKeywords: []` (`toGammaThemes`) | Shape parity for the API; no colour keywords. | — |

## 6. Editing ([06](06-editing-import-export-collaboration.md))

| Topic | Gamma | AIMate | Gap → recommendation | Pri |
|---|---|---|---|---|
| AI edit scope | Deck / card / element selection, a chip, an inline "What should change?" box 🟢 | `ai-edit`, proposals with revise/version/restore (`apps/cowork-server/lib/ppt/proposal-service.mjs`, `ai-actions.mjs`) | → Add an element-level selection chip on the canvas. | P1 |
| Receipt | Original / Modified thumbnails, compare, restore the whole group 🟢 | Repair comparison before/after (`ppt/repair-comparison.mjs`), revisions restore | Close. → Show the receipt inline in the conversation. | P2 |
| Edit constraints | One edit per gamma; cannot add pages; may partially apply 🟢 | Structure edits are refused with 409 when the template lacks the structure capability ("native templates preserve their original layout and structure", `ppt/mutation-router.mjs`). E1/E2 (card merge, figure-page merge, section-page delete proposals) are recorded as implemented in [`ppt-integration-option-d-mainline-20261026.md`](../../exec-plans/active/ppt-integration-option-d-mainline-20261026.md); the SDK handoff does not cover them | → Verify E1/E2 on real decks (that plan still lists live runs as pending in one place). | P1 |
| Manual editing | Block library, freeform, styles panel 🟢 | Canvas editor with inspector (`src/components/ppt/canvas`, `inspector`) | Comparable; no freeform conversion. | P2 |

## 7. Import and export ([06](06-editing-import-export-collaboration.md))

| Topic | Gamma | AIMate | Gap → recommendation | Pri |
|---|---|---|---|---|
| Import | PPTX/POTX/PDF upload or link; the prompt decides the intent (as-is / edit / restyle / template / summarise) 🟢 | Editable PPTX import (`importMode:'editable'`, `ppt/import-pptx.mjs`); PDF and other files as sources | → Map the five prompt intents onto our two paths (editable import vs source). "Restyle" = import + template switch. | P1 |
| Export formats | PDF, PPTX, PNG zip (one per card) 🟢 | PPTX, PDF (`ppt-api.mjs` `export`/`pdf`) | → PNG zip from the existing per-slide SVG preview renderer (`ppt/exporters/preview.mjs` `slideSvg`) plus a rasteriser. | P2 |
| Export links | Bearer links valid ~1 week 🟢 | Authenticated download; the facade adds signed 7-day links | Parity through the facade. | — |

## 8. API, MCP, collaboration ([07](07-mcp-integrations-errors-limits.md), [08](08-api-reference.md))

| Endpoint family | Gamma | Facade today | Next |
|---|---|---|---|
| Agent / Classic create + poll | 🟢 | ✅ (`/api/ppt/gamma/v1.0/(agent/)generations`; agent create 202, Classic create 200, polls 200; failed jobs carry `error.statusCode: 422`) | — |
| Themes | 🟢 | ✅ (`GET /themes`) | — |
| Edits | 🟢 | ❌ (no route: 404 `No route for …`) | Map to `ai-edit` / proposals; one at a time; return the receipt summary (P1) |
| Exports (`POST /gammas/{id}/export`, `GET /exports/{id}`) | 🟢 | Download through generation `exportUrl` only (`GET /files/{id}.{pptx\|pdf}` with `expires`/`signature`; `exportAs: png` → 400) | Add a standalone export job (P2) |
| Get / search gammas, outline, read | 🟢 | ❌ (404) | `GET /gammas/{id}` from the project view; `read_gamma`-style text projection (P1, needed for MCP) |
| MCP server | 🟢 | ❌ | Expose the same service as MCP tools through the app's existing MCP infrastructure (P1) |
| Comments, analytics, folders, sharing | 🟢 | ❌ (routes 404; `folderId` / `sharingOptions` on create → `ignored_*` warnings) | Out of scope for a desktop app (P2) |
| Uploads / files / sourceUrls | 🟢 | ❌ (`files` / `sourceUrls` on agent create → 400 `unsupported_files` / `unsupported_source_urls`; `POST /uploads` → 404) | Raw-bytes upload → `inputKind:'file'` (P1) |

## 9. Recommended order

1. **P0 accent images**: theme accent packs first (no new dependency), then AI generation through the existing image generator.
2. **P0 density re-measure** on the current main branch, against Gamma decks built from the same input with a comparable template.
3. **P1** image transcoding; slide-level template instructions; API edits + read projection + MCP exposure; an "auto" review policy for API callers; output locales; import intents.
4. **P2** PNG export, 4:3, header/footer settings, more chart types.

## Evidence limitations

- Gamma-side cells summarise reports 02–07; their markers inherit those reports' evidence, which mixes docs (🟢 by citation) and a small number of hands-on sessions on Free accounts (S1–S10 in 03).
- AIMate-side cells come from reading code and plan documents, not from running the app; file paths and symbols were checked with `ls`/`grep`, behaviour was read from source.
- Density figures are single-deck measurements from one review (2026-10-06) and predate the card-outline and capacity work, so the AIMate number may no longer hold.
- The "Facade today" column reflects `src/lib/ppt-gamma-service.ts` and `src/lib/ppt-gamma-compat.ts` as of HEAD `23bc10e`; it was not exercised against a live engine or with a real API key.
- Exec-plan statements (E1/E2 status, tech-debt #34) are the authors' own records and are partly inconsistent; they are cited, not re-verified.
- Priorities (P0–P2) are judgement calls, not measured user impact.

## Open questions 🔴

1. Whether our `generation-edits` behaves like Gamma's queued instructions. It needs a live run.
2. Current per-page density on the main branch. The last measurement predates the card-outline work.
3. The licensing route for stock images (Pexels has a free API; licence terms need review before shipping).

## Sources

- Domain reports [01](01-architecture-and-document-model.md)–[08](08-api-reference.md) in this set, and their sources.
- AIMate code in the working tree at HEAD `23bc10e` (facade added in `7c8ee63`): files cited inline.
