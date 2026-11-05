# Gamma editing, import, export and collaboration

> Part of the Gamma reverse-engineering set: [index](README.md)

Scope: how an existing gamma is changed (AI edits through the API, MCP and UI; manual editing), how versions and restore behave, how decks come in (uploads, `files`, `sourceUrls`) and go out (PDF, PPTX, PNG), and the read, search, comment, analytics and lifecycle (archive, delete) surface.

**Markers.** 🟢 confirmed by Gamma's developer docs or by first-hand use recorded in this repo (cited). 🟡 inferred (the evidence is named). 🔴 unknown.

**Evidence base.**

| Tag | Source | What it is | Marker |
|---|---|---|---|
| Docs | developers.gamma.app (`llms-full.txt` and the OpenAPI blocks embedded in it, fetched 2026-11-05) | Gamma's own API, MCP and limits documentation | 🟢 |
| H1 | [gamma-ai-editing-generation-queue-2026-09-29.md](../gamma-ai-editing-generation-queue-2026-09-29.md) | Hands-on Gamma 5 and Classic session: queued instructions, scope-first AI editing, Original/Modified, Classic quick actions, editor controls | 🟢 |
| H2 | [ppt-gamma-template-first-editor-workflow-audit-20261019.md](../ppt-gamma-template-first-editor-workflow-audit-20261019.md) §13–25 | Two hands-on runs (11 and 18 cards): paragraph and card edits, version toggle and restore limits, real PPTX/PDF exports inspected at OOXML level | 🟢 |
| H3 | [ppt-alpha-mining-layout-content-gamma-review-20261008.md](../ppt-alpha-mining-layout-content-gamma-review-20261008.md) §16–21, §27 | Hands-on agent run: element scope, Review changes screen, export panel, OOXML wrap and autofit | 🟢 |
| H4 | [ppt-editorial-relational-media-gamma-observation-20261019.md](../ppt-editorial-relational-media-gamma-observation-20261019.md) §B02 | Help-centre note on import modes | 🟢 (help centre, second-hand) |
| BC | [BornCity, Gamma 5 launch coverage](https://borncity.com/news/gamma-5-gamma-tech-stellt-den-groessten-umbau-seiner-praesentationsplattform-vor/) | Press coverage repeating company claims | 🟡 |

gamma.app itself sits behind a Cloudflare challenge. Nothing here comes from bypassing it, from private APIs or from network capture. 🟢

---

## 1. Summary

- 🟢 **Editing is prompt-only.** `POST /agent/gammas/{gammaId}/edits` takes a natural-language instruction of up to 10,000 characters ([edit][d-edit]). It has no object-level API for addressing a slide element ([limits][d-limits]).
- 🟢 **An edit changes one page.** It can add, remove, reorder and rewrite cards on that page. It cannot add pages. Only one edit runs on a gamma at a time (`409 edit_in_progress`) ([edit][d-edit], [MCP][d-mcp]).
- 🟢 **Edits cannot restyle.** Gamma labels "edits cannot restyle" as enforced. The layouts of untouched cards, sharing settings and the URL are listed as preserved, without a type label ([controls][d-ctrl]).
- 🟢 **The UI was scope-first in our sessions (2026-09-29 to 10-19).** You select the deck, a card or an element, then type into an inline "What should change?" box. The changes come back as a grouped Original/Modified version with compare and restore (H1, H2, H3).
- 🟢 **Restore was not snapshot replay in one observed run.** It ran as another agent operation, and the agent's versions and the editor's Undo stack behaved as separate things (H2 §22.3; one session, 2026-10-19).
- 🟢 **Import is a generation, not a separate endpoint.** You upload raw bytes, then pass them in `files` on an agent generation. The prompt decides what happens: import as is, edit, restyle, template or summarise ([import][d-import]).
- 🟢 **Export** is one format per job: `pdf`, `pptx`, or `png` (a zip with one PNG per card). The download link is a bearer URL that expires after about a week ([export status][d-expst]). A failed export during generation is only a warning ([agent generation][d-agen]).
- 🟢 **The read surface** covers metadata, full-text search, comments with delta polling, and four analytics endpoints (Pro and above). Reading card content (`read_gamma`) and card outlines (`get_gamma_outline`) is MCP-only ([controls][d-ctrl], [MCP][d-mcp]).
- 🟢 **Lifecycle.** Archive is idempotent, needs edit access and is free. Delete needs a workspace admin and archives first ([archive][d-archive], [delete][d-delete]).

---

## 2. AI edits through the API

### 2.1 Request

`POST /v1.0/agent/gammas/{gammaId}/edits` ([edit][d-edit]; schema `EditGamma`)

| Field | Type | Required | Meaning | Marker |
|---|---|---|---|---|
| `gammaId` (path) | string | yes | A file ID (`g_…`) edits the gamma's **main page**. A page ID (the id in a `gamma.app/docs/<id>` URL) edits **that page** | 🟢 |
| `prompt` | string | yes | The instruction. Docs say 1–10,000 characters; the schema sets only `maxLength: 10000` | 🟢 |
| `quality` | enum `lite` \| `standard` \| `max` | no | Model effort, matching the agent UI's tiers. If omitted, the API default is used, capped at the plan. `max` needs Pro or above and can cost more | 🟢 |
| `disableConnectors` | boolean | no | Keeps workspace connectors (Notion, Slack, custom MCP) out of this edit | 🟢 |

- 🟢 Nothing else can be passed: no card ID, element ID, theme, layout or "dry run" field (schema `EditGamma`).
- 🟢 The response is `201` with `{ editId, gammaUrl }` (`EditGammaResponse`). Note that agent generations answer `202` ([agent generation][d-agen]).

### 2.2 Status polling

`GET /v1.0/agent/edits/{editId}` ([edit status][d-editst]). The response is one of three shapes:

| Status | Fields (all required unless noted) | Marker |
|---|---|---|
| `pending` | `status`, `editId`, `gammaId` (file ID), `gammaUrl`, `pageId` (the page being edited), `updatedTime` | 🟢 |
| `completed` | as pending, plus `result.summary` (the agent's summary of what it changed) and `credits` | 🟢 |
| `failed` | as pending, plus `error {reason, message, statusCode}` and `credits` | 🟢 |

- 🟢 `credits.deducted` is what was actually debited for this job. It is best-effort: it can still grow after completion and can read low after a failed record write. `credits.remaining` is the balance when the status was served, not this job's cost. Either field is omitted when its lookup fails (`AgentCreditsResponse`, [pricing][d-pricing]).
- 🟢 Every status carries `pageId`, so a caller always learns which page was edited even when it passed a file ID.
- 🟢 Poll every few seconds rather than in a tight loop. There are no webhooks ([MCP][d-mcp], [limits][d-limits]).
- 🟢 With MCP, calling `edit_gamma` again to check progress **starts a new edit**. Poll `get_edit_status` instead ([MCP][d-mcp]).

### 2.3 Failure reasons on a failed edit (`EditError.reason`)

| `reason` | Meaning per docs | Marker |
|---|---|---|
| `access_revoked` | Access ended while the job ran | 🟢 enum; 🟡 meaning inferred from the name |
| `edit_failed` | Generic failure | 🟢 enum; 🟡 meaning inferred from the name |
| `insufficient_credits` | The balance ran out (a job needs at least 1 credit to start) | 🟢 [pricing][d-pricing] |
| `target_not_found` | The page or card the instruction targets could not be resolved | 🟢 enum; 🟡 meaning inferred |
| `timeout` | The job exceeded its time budget | 🟢 enum; 🔴 budget unknown |
| `unavailable` | The service was unavailable | 🟢 enum; 🟡 meaning inferred from the name |
| `unsupported_target` | The target is a kind the edit agent cannot change | 🟢 enum; 🔴 which kinds |

- 🟢 **Partial application.** Docs warn that a failed edit may already have been partly applied, so inspect the gamma before retrying (`EditError.reason` description).
- 🔴 The `statusCode` value for each reason is not documented.

### 2.4 Errors when creating an edit (HTTP)

| Code | Cause | Marker |
|---|---|---|
| 400 | Invalid parameters, or the gamma is archived, has no pages, or is a type that cannot be edited | 🟢 |
| 401 | Missing or invalid key | 🟢 |
| 403 | Insufficient credits, no edit permission, or a `quality` tier the plan lacks (`agent_premium_models_restricted`) | 🟢 ([pricing][d-pricing]) |
| 404 | Gamma not found | 🟢 |
| 409 | `code: edit_in_progress`. May include the running `editId` when it belongs to your workspace | 🟢 ([errors][d-err]) |
| 429 | Rate limit, or too many in-flight agent jobs (`workspace_concurrency_limit_exceeded`, with `Retry-After`) | 🟢 |
| 503 | Service busy; retry | 🟢 |

- 🟢 The in-flight cap is shared between agent generations and edits: 2 per workspace on Free and 10 on paid plans ([pricing][d-pricing]).
- 🟢 Docs advise that on a 409 you poll the existing `editId` rather than start a duplicate ([errors][d-err]).

### 2.5 What an edit can and cannot do

| Aspect | Behaviour | Type (Gamma's own label) | Marker |
|---|---|---|---|
| Unit | One page per edit: the page in the URL, or the main page | not labelled | 🟢 [MCP][d-mcp] |
| Cards | Can add, remove, reorder and rewrite cards on that page | prompt-directed | 🟢 [MCP][d-mcp] |
| Pages | Cannot add pages to a multi-page gamma; generate a new gamma instead | not labelled | 🟢 [limits][d-limits] |
| Text, images, charts, layout | Can change for the cards the instruction targets | prompt-directed | 🟢 [controls][d-ctrl] |
| Theme | Never changed by an edit | enforced | 🟢 [controls][d-ctrl] |
| Untouched cards, sharing, URL | Preserved | not labelled (listed as "Preserved") | 🟢 [controls][d-ctrl] |
| Format (deck, doc, social, webpage) | Not changed by edits | not labelled | 🟢 [controls][d-ctrl] |
| Locked template slides | Locks bind generation, not human editors. Whether the edit agent honours them is not stated | — | 🟢 / 🔴 [controls][d-ctrl] |
| Concurrency | One edit per gamma; per-workspace in-flight cap | enforced | 🟢 |
| Access | At least edit access; not on archived gammas | enforced | 🟢 |
| Validation | Gamma does not check the result against the prompt. Read, export or open it to verify | not provided | 🟢 [controls][d-ctrl] |
| Element addressing | None. You describe the target in words, e.g. "slide 3" or a title | — | 🟢 [limits][d-limits] |

- 🟢 **Locating "slide 3".** MCP `get_gamma_outline` returns stable `cardId`s and visible `slideNumber`s so an agent can resolve "slide 3" before writing the prompt. The edit itself still takes only a prompt ([MCP][d-mcp]).
- 🟢 **Template versus copy.** Edit the generated gamma, not the template; editing a template changes the template itself ([template workflow][d-workflow]).

### 2.6 MCP and connectors

| Item | Detail | Marker |
|---|---|---|
| `edit_gamma` | Inputs: `gammaIdOrUrl` (file ID, full URL, or a completed `generationId` or `/generations/` URL), `prompt` (1–10,000 characters), `disableConnectors`, `quality`. Output: `editId`, `status: pending`, `gammaUrl`. Annotated destructive and not idempotent | 🟢 [MCP][d-mcp] |
| `get_edit_status` | Output: `editId`, `status`, `gammaUrl`, `summary`, `error`, and `reason` (same seven values as REST) | 🟢 |
| Availability | Both tools appear only when editing is available for the connected account; check the tool list first | 🟢 |
| Plan failures | A `quality` the plan lacks or a lack of credits returns `planLimitExceeded: true`, `currentPlanLimits` (including `availableQualities`), `upgradeUrl` and `guidance` | 🟢 |
| Connectors | ChatGPT and Claude connectors can edit. The Slack app does not expose the edit tools | 🟢 [integrations][d-integ] |
| History | Agent edits through the API and MCP launched 2026-10-05 | 🟢 [changelog][d-changelog] |

---

## 3. AI editing in the UI

### 3.1 Choosing the scope

| Step | What happens | Marker |
|---|---|---|
| Mode | The Gamma 5 toolbar switches between **manual editing** and **AI editing**. The chat also offers `Select area`, and each card's rail has `Edit with Agent` | 🟢 H1 §3.2, H3 §20.1 |
| Selection prompt | The canvas shows "Choose a card or element to edit · Esc to cancel" | 🟢 H1, H3 |
| Levels | Help-centre levels: whole deck, a card, a single element. Selecting text and using the format toolbar's AI entry or `Cmd/Ctrl+E` also works | 🟢 (help centre via H1) |
| Chip | The selection gets a blue border and a typed chip: `Paragraph · "Reallocate spend…"`, `Card · <title>`, `Heading · <title>`. Clicking empty card space gives Card scope; clicking a heading switches to Heading | 🟢 H1, H2 §16.1, H3 §20.2 |
| Inline box | A floating "What should change?" composer appears next to the selection. Send is disabled while it is empty; Enter sends and Esc dismisses | 🟢 H3 §20.1 |
| Chat sync | The main chat shows the same scope (`Selected: Card`) with `Exit select area`, and the inline request lands in the chat history | 🟢 H3 |
| Text-range scope | Character-range AI edits were not tested | 🔴 H2 §16.2 |

### 3.2 While the edit runs, and the receipt

| Element | Observation | Marker |
|---|---|---|
| Progress | The chat button turns into `Stop`. The target card shows `Editing…` and then `Checking…` | 🟢 H1 §2.1, H3 §20.1 |
| Receipt | The chat posts an explanation plus **Original / Modified** thumbnails, with Modified selected by default. It says how much changed ("This edit changes slide 2", "1 slide changed") | 🟢 H2 §16.1, H3 |
| Compare | `Compare before & after` (H1) or `Compare all changes` (H3) opens a before/after view; in H3 it was a full-screen **Review changes** view with changed regions highlighted in red and blue | 🟢 H1, H3 §20.1 |
| Decision | `Restore all edits` or `Continue with selection` | 🟢 H1, H3 |
| Grouping | All changes from one request are accepted or restored together; you cannot pick individual changes. The chat history is kept | 🟢 (help centre via H1) |
| Apply model | In the observed runs the edit was applied to the canvas first and could be toggled back; no "preview, then apply" step was offered | 🟢 H2 §16.1–16.2 |
| Scope fidelity | Paragraph edit: only the selected paragraph changed. Card edit: only that card's visible text changed, and the other cards' text, styles and image sources stayed the same | 🟢 H1 §3.2, H2 §16.1, §22 |
| Image bytes | AI images on cards that were not targeted differed byte-for-byte between exports before and after the edit. Their sources and positions did not change; the cause was not isolated | 🟢 observed; 🔴 cause (H3 §20.1) |

### 3.3 Restore and Undo in practice

| Action | Observed result | Marker |
|---|---|---|
| Original ↔ Modified toggle (first run) | Toggling both ways restored the exact visible text of both states across all 11 cards | 🟢 H2 §16.1 |
| Restore Original (second run) | Restore showed `Original restored` and started **a new agent restore operation**. Afterwards the Modified control was gone and switching back failed | 🟢 H2 §22.3 |
| Re-apply Modified via chat | The agent said it **could not replay the saved after-version** and rebuilt it from saved content. Visible text matched; object IDs and geometry were not proven identical | 🟢 H2 §22.3 |
| Global Undo/Redo | A separate stack. Undo changed object order on another card instead of reverting the agent edit; Redo returned to the prior state | 🟢 H2 §22.3 |
| Version history | Listed in the document menu next to Comments, Duplicate, Remix, Save template and Export; not exercised | 🟢 entry; 🔴 behaviour (H2 §16.2) |

### 3.4 Queued instructions during generation

- 🟢 **Queueing.** An instruction sent while the agent is still generating is shown as **`Queued`**, with `Edit queued message` and `Remove queued message` (H1 §2.1).
- 🟢 **Order.** The queued edit ran only after every card had been generated and polished. The target card then showed `Editing…` and `Checking…`, and the change landed (H1 §2.1).
- 🟢 **Help-centre statement.** The AI does not respond immediately during generation; wait for the current generation to finish (via H1).
- 🔴 **Not observed.** Interrupting a card that is being written, re-planning mid-run, or merging conflicting queued instructions.

### 3.5 Classic quick actions and whole-deck edits

| Surface | Group | Actions | Marker |
|---|---|---|---|
| Classic per-slide `Edit with Agent` ("Edit this slide": free-text box plus file attachment) | Layout | Try new layout | 🟢 H1 §3.1 |
| | Text | Improve writing; Fix spelling & grammar; Translate; Make longer; Make shorter; Simplify language; Be more specific | 🟢 H1 |
| | Visual | Make this more visual; Add an image; Add a chart | 🟢 H1 |
| Classic `Edit all slides with AI` → Quick edits | Research | Add web evidence; find counter-data and cases | 🟢 H1 (entry only; not run) |
| | Refine | Check weak arguments; add an executive summary; add two slides | 🟢 H1 |
| | Restyle | Global layout and theme suggestions | 🟢 H1 |
| Gamma 5 agent path | — | Preset menus such as Make longer/shorter did **not** appear; free text only | 🟢 H3 §20.2 |

- 🟡 **UI versus API.** A whole-deck "Restyle" exists in the UI, but API and MCP edits are documented as never changing the theme. So UI restyling probably uses a different capability (theme application) from the edit agent. Evidence: [controls][d-ctrl] versus H1.

### 3.6 The receipt can disagree with the canvas

| Case | Observation | Marker |
|---|---|---|
| Quoted sentence | The sentence quoted in the chat receipt did not match the canvas text word for word | 🟢 H1 §3.2 |
| Plan versus receipt versus canvas | The plan and the receipt both claimed a comparison of two cohort types; the card did not show it | 🟢 H1 §5 |
| "Text size is unchanged" | The exported PPTX showed a title going from 26.5 to 28 pt and body text from 16 to 14.5 pt | 🟢 H3 §19.3 |
| Self-reported failures | On completion the agent flagged that card 2 overflowed ("9/10 pass", "Couldn't finish"). The failing card could still be exported | 🟢 H3 §18 |
| Export claims | After a layout fix the agent said, correctly, that it had not re-exported. An independent re-export confirmed the fix | 🟢 H2 §22.4 |

Rule from these: treat the rendered canvas or the exported file as the truth, never the agent's summary. 🟢 ([controls][d-ctrl] also says results are not validated.)

---

## 4. Manual editing surface

| Control | Contents | Marker |
|---|---|---|
| Canvas | Cards stacked vertically, with `Insert slide` between cards. The filmstrip shows thumbnails for navigation and card-level actions | 🟢 H1 §4 |
| Text editing | Direct editing in manual mode; the toolbar has font, size, heading level and list controls | 🟢 H1, H2 |
| `Add block` | Categories: **Blocks, Images, Shapes, Layouts, Diagrams, Charts, Videos, Embeds, Forms**. Items seen include headings, body text, tables, callouts, columns, timelines, funnels, charts and external embeds | 🟢 H1 §4 |
| `Add block` (second run) | Repeated probing did not return a reliable item list | 🟢 H2 §16.2 (caveat) |
| Layouts | Standard image-placement layouts (No, Top, Left, Right, Background), plus **Suggested layouts** with live thumbnails that keep the card's content | 🟢 H1 §4 (previewed, not applied) |
| Freeform | `Convert Heading to freeform`, `Convert slide to freeform`, `Convert all slides to freeform…` | 🟢 H1 (not run; round-trip loss 🔴) |
| Styles panel | Themes (listed 09-29 only), Fonts, Colors, Logo, Button Design (09-29; "Design" on 10-08 and 10-19), Charts, Images, Custom styling | 🟢 H1 §4, H2 §16.2, H3 §18 |
| Fonts | Role slots: Display, Heading, Subheading, Body, Eyebrow, Caption, Label; plus block spacing | 🟢 H3 §19.1 |
| Page setup | 16:9, Fluid, 4:3, Custom (10-19; labelled Default 16:9 / Flexible / Tall 4:3 / Custom on 10-08); minimum text size; Scale content to fit; Show overflow guides; headers and footers (recorded 10-19) | 🟢 H2 §16.2, H3 §16.1, §27.8 |
| Minimum text size | A tooltip calls it the floor for shrink-to-fit, not a per-role minimum | 🟢 H3 §19.1 |
| Card rail | `Edit with Agent`, `View speaker notes`; Undo and Redo icons | 🟢 H1, H3 §18 |
| Document menu | Version history, Comments, Duplicate, Remix, Save template, Export (10-19; on 10-08 the entries read "Create from this (Remix)" and "Save new template") | 🟢 H2 §16.2, H3 §27.8 |
| Template locks | Locked slides can still be changed by anyone with edit access | 🟢 [controls][d-ctrl] |

Editor internals visible in the DOM (2026-10-08 and 10-19 sessions only):

- 🟢 Text is held as structured contenteditable nodes (grid and cell, heading, paragraph, code, math, image) (H3 §18).
- 🟢 The page root carries `data-testid=tiptap-react-root-wrapper` (H2 §16.1).
- 🟢 In the 2026-10-08 Sample Size run a card was a fixed **1280 × 720 logical-px** canvas (`.gml-card__canvas`), scaled to the window with CSS `zoom`; 1 logical px = 0.75 pt (H3 §18–19, §27.9).
- 🟡 The editor is therefore TipTap/ProseMirror on a fixed logical canvas. Evidence: the test id and the node types.

---

## 5. Import

### 5.1 Flow

- 🟢 Import takes two calls: `POST /uploads`, then `POST /agent/generations` naming the upload in `files` ([import][d-import]).
- 🟢 Each generation creates one gamma, and your uploaded file is never modified. Changes happen on the imported gamma ([import][d-import]).
- 🟢 Import through the API shipped on 2026-11-04 ([changelog][d-changelog]).

### 5.2 `POST /v1.0/uploads`

| Item | Rule | Marker |
|---|---|---|
| Body | Raw bytes as `application/octet-stream`, not multipart. `Content-Length` is required; chunked and content-encoded bodies are rejected | 🟢 [upload][d-upload] |
| `mimeType` (query) | Required, and must match the file's actual contents | 🟢 |
| `x-harness-upload-name` (header) | Required: the percent-encoded filename | 🟢 |
| Size | Up to 250 MiB per file; images up to 50 megapixels | 🟢 |
| Response | `{ uploadId, filename (stored name derived from the header), name (as sent), mimeType, size (bytes) }` | 🟢 `CreateUploadResponse` |
| Reuse | An upload can be attached to **one** generation. To retry, upload again | 🟢 |
| Expiry | An upload never attached expires **2 days** after creation | 🟢 |
| Back-pressure | `503` means too many uploads are in progress; retry with exponential backoff | 🟢 |

**Accepted `mimeType` values** (26, from the schema enum) 🟢:

| Family | Types |
|---|---|
| Decks | `application/vnd.openxmlformats-officedocument.presentationml.presentation` (.pptx), `…presentationml.template` (.potx), `application/pdf` |
| Office docs | `…wordprocessingml.document` (.docx), `…spreadsheetml.sheet` (.xlsx), `application/vnd.ms-excel` (.xls) |
| Images | `image/avif`, `image/bmp`, `image/gif`, `image/heic`, `image/heif`, `image/jpeg`, `image/png`, `image/svg+xml`, `image/tiff`, `image/webp` |
| Text and data | `text/plain`, `text/markdown`, `text/csv`, `text/html`, `text/css`, `application/json`, `application/xml`, `application/javascript` |
| Fonts | `font/otf`, `font/ttf` |

- 🔴 Legacy `.ppt`, Keynote and `.odp` are absent from the enum. Whether they are rejected or simply undocumented is unknown.
- 🟡 Font uploads suggest the agent can use supplied brand fonts. Docs do not say how.

**Upload status codes** 🟢 ([upload][d-upload], [errors][d-err]):

| Code | Cause |
|---|---|
| 400 | Missing `mimeType`, header or `Content-Length`; a filename that is not percent-encoded; wrong body type; content-encoded body; body that does not match `mimeType`; unsupported type |
| 401 / 403 | Bad key / insufficient credits or no API on the plan |
| 404 | Uploads are unavailable |
| 408 | The body arrived too slowly |
| 413 | Over 250 MiB, or an image over 50 MP |
| 429 / 503 / 504 | Rate limit / too many uploads in progress / storing timed out |

### 5.3 `files` and `sourceUrls` on `POST /agent/generations`

| Field | Rule | Marker |
|---|---|---|
| `files[]` | `{ uploadId, filename, purpose? }`. Up to **50 files** and **250 MiB in total** | 🟢 [agent generation][d-agen] |
| Plain files | Without `purpose`, a file is ordinary source material. A .pptx or .pdf is still imported with its own layout | 🟢 `CreateAgentGeneration.files` |
| `purpose: "import"` | Marks the file to import faithfully as the new presentation. At most one file can have it | 🟢 |
| Exclusivity | `purpose: "import"` cannot be combined with `templateId`, `themeId` or `numCards` | 🟢 [import][d-import] |
| Precedence | The prompt still wins, so say "import it as is" when you want a faithful copy | 🟢 |
| One deck | Only one presentation can be imported per generation. A request to import, edit or template **more than one** presentation fails **without creating a gamma**. Several decks used as content for one new deck is fine | 🟢 |
| `sourceUrls[]` | Up to 10 http(s) URLs, e.g. a Google Slides deck, which must be public or a direct download | 🟢 |
| Required links | A link the prompt depends on (the deck to import, the report to build from) is required. If Gamma cannot read it, the generation fails with an explanation and creates no gamma | 🟢 |
| Background links | Background links that cannot be read are skipped | 🟢 |
| Untrusted files | Files and linked pages can contain text written to steer the agent. Set `disableConnectors: true` for files from untrusted senders | 🟢 [import][d-import] |

### 5.4 The prompt decides what happens

| Intent | Example prompt (paraphrased) | What Gamma does | Marker |
|---|---|---|---|
| Import as is | "Import this deck." (a bare title also works) | Faithful import | 🟢 [import][d-import] |
| Import and edit | "Import this deck and change the slide 7 heading to …" | Imports, then edits the import | 🟢 |
| Restyle | "Import this deck and make it look better" / "…in our brand colours" | Imports, then restyles it; content kept | 🟢 |
| Use as template | "Use this deck as a template for a Q3 update on …" | Imports, then rewrites it, title included | 🟢 |
| Summarise / new deck | "Make a 5-slide summary of this deck for our board" | Builds one new gamma from the content; the deck itself is not imported | 🟢 |

- 🟢 **Classic modes.** The help centre describes Classic import modes Generate, Condense and Preserve. Gamma 5 replaces them with natural-language intent (H4 §B02).
- 🟡 **The API has no in-place restyle.** "Make it look better" restyles during import, while edits are enforced never to change the theme. So restyling an existing deck through the API means a new generation (an import with a restyle prompt, or Classic from-template with `themeId` on a gamma marked as a template). Evidence: [import][d-import] versus [controls][d-ctrl].

### 5.5 Troubleshooting

| Symptom | Cause | Marker |
|---|---|---|
| `error.reason: invalid_files` on the status | An upload expired, was already attached elsewhere, or the total size is too large; upload again | 🟢 [import][d-import], [changelog][d-changelog] |
| `404` on create | An upload in `files` does not exist or has expired | 🟢 |
| `413` | Over 250 MiB per upload, or in total on the generation | 🟢 |
| `503` on upload | Too many uploads in progress; back off exponentially | 🟢 |

### 5.6 Fidelity

- 🟡 **Claimed fidelity.** Launch coverage reports PPTX/PDF import and export "without layout loss", and an internal conversion benchmark rising from about 30% to over 97%. These are company claims relayed by the press, and the scoring method is unknown (BC).
- 🔴 No first-hand import test exists in this repo: the hands-on sessions generated from text and templates, not from an uploaded deck.

---

## 6. Export

### 6.1 Endpoints

| Path | Request | Response | Marker |
|---|---|---|---|
| `POST /v1.0/gammas/{gammaId}/export` | `{ exportAs: "pdf" \| "pptx" \| "png" }` (required). `gammaId` can be a file ID or a page/doc ID | `200 { exportId }` | 🟢 [export][d-export] |
| `GET /v1.0/exports/{id}` | — | `{ exportAs, exportId, status: pending\|completed\|failed, gammaId, exportUrl?, error? }` | 🟢 [export status][d-expst] |
| `exportAs` on `POST /agent/generations` and Classic `POST /generations` | Auto-export after a successful generation | `exportUrl` on the completed status | 🟢 [agent generation][d-agen] |
| MCP `export_gamma` / `get_export_status` | `gammaIdOrUrl` (also accepts a completed `generationId`), `exportAs` | `exportId`, `status`, `gammaId`, `exportAs`, then `exportUrl`, `error`, `reason` | 🟢 [MCP][d-mcp] |

Export create errors: `400` invalid; `401`; `403` "feature not available for workspace"; `404` not found. 🟢 (Which plans hit the 403: 🔴.)

### 6.2 Formats and rules

| Rule | Detail | Marker |
|---|---|---|
| One format per job | `exportAs` is a single enum value. For PDF and PPTX, start two jobs | 🟢 `CreateExportRequest` |
| PDF and PPTX | Downloaded directly as `.pdf` / `.pptx` | 🟢 |
| PNG | A **.zip with one PNG per card**, not a single image | 🟢 `ExportStatusResponse.exportUrl` |
| `gammaId` canonicalisation | The status always returns the canonical **file** ID, even if you passed a page/doc ID, so it can differ from your input | 🟢 |
| `exportAs` echo | Present on every status, including pending and failed | 🟢 |
| Eligibility | Any non-archived gamma in the workspace that you can **view**, including ones the API did not create. Other workspaces' gammas and archived gammas cannot be exported | 🟢 [limits][d-limits] |
| Cost | Exports, reads and searches are free; generations and edits cost credits | 🟢 [MCP setup][d-mcpsetup], [template workflow][d-workflow] |
| No request options | No quality, page range, editable-tables or speaker-notes switches in the API | 🟢 (schema has only `exportAs`) |

### 6.3 The download link is a bearer URL

- 🟢 Anyone holding `exportUrl` can download the file until it expires, about **one week** later. Access is not tied to your API key ([export status][d-expst], [polling][d-poll]).
- 🟢 Docs tell you to treat the link as a secret: do not log it, share it or embed it in client-side code, and download promptly.
- 🟢 The same rules apply to `exportUrl` on generation statuses, Classic and agent alike.

### 6.4 Failures

| `reason` | Meaning | Retry? | Marker |
|---|---|---|---|
| `render_timeout` | Rendering timed out | Transient; safe to retry | 🟢 `ExportError` |
| `export_failed` | Generic failure | Transient; safe to retry | 🟢 |
| `deck_too_large` | The deck exceeds a size limit | Change the input | 🟢; the threshold is 🔴 |
| `no_content` | Nothing to export | Change the input | 🟢 |

- 🟢 `reason` is optional in the schema; only `message` and `statusCode` are required.
- 🟢 **Export failure during generation is not a failed generation.** It appears as an `export_failed` **warning** on a `completed` generation, and `exportUrl` is simply absent. A completed generation can therefore lack its file, so check `exportUrl` and handle the warning ([agent generation][d-agen], [migrate][d-migrate], [warnings][d-warn]).

### 6.5 Export in the UI, and what the files contain

| Observation | Detail | Marker |
|---|---|---|
| Panel | All slides; three quality levels; PDF, PowerPoint, Google Slides, PNG; `Editable tables` and `Zoom to fit` toggles | 🟢 H3 §19.4, H2 §15 |
| Panel warnings | Asks for host fonts (Noto Sans SC, Inter) and warns that gradient text and frosted backgrounds fall back | 🟢 H2, H3 |
| PPTX structure | About 16:9 (12,191,695 × 6,858,000 EMU). Native text boxes and shapes, native tables, picture objects; **not whole-slide screenshots** | 🟢 H2 §15 |
| Pictures | Pictures include decorative accent lines, photos and a raster diagram base | 🟢 H2 §23.1 |
| Maths | Formulas were exported as PNG pictures (0 OMML nodes) | 🟢 H2 §15, §23.1 |
| Text fitting | Mix of `wordWrap` true and false; no `spAutoFit`; many boxes use `normAutofit` | 🟢 H3 §19.2 |
| Fonts | No embedded font parts. Code runs came out as Consolas 13 pt even though the editor showed Noto Sans SC | 🟢 H3 §19.1, §21 |
| Card count | Web view, PPTX and PDF all had the same number of cards (11 and 18 in the two runs) | 🟢 H2 §13.3 |
| Overflow | One export clipped text below the page edge (glyph bottom 542 pt on a 540 pt page). A targeted layout edit followed by a re-export fixed it | 🟢 H2 §22.4 |
| Editor versus export | The help centre warns that exported PDF/PPTX can differ from the editor view | 🟢 (help centre via H1) |

---

## 7. Read and search

### 7.1 `GET /v1.0/gammas/{gammaId}` (metadata)

- 🟢 Accepts a file ID or the doc ID from a `gamma.app/docs/…` URL; pattern `^[A-Za-z0-9_-]+$`, up to 128 characters.
- 🟢 Built for link previews (Atlassian Smart Links, Notion). Works with an API key or OAuth.
- 🟢 Errors: 400, 401, 403, 404 ([get gamma][d-get]).

| Field | Notes | Marker |
|---|---|---|
| `id` | File ID | 🟢 |
| `title` | — | 🟢 |
| `type` | `regular` or `template` | 🟢 |
| `url` | Canonical view URL | 🟢 |
| `thumbnailUrl` | Nullable screenshot URL, usually **signed** so it loads without a session. Expires after **about 7 days**; re-fetch rather than store | 🟢 |
| `description` | Nullable preview text | 🟢 |
| `author` | `{ name, avatarUrl }`, nullable | 🟢 |
| `createdTime`, `updatedTime` | Nullable ISO-8601 | 🟢 |
| `themeId` | Nullable | 🟢 |
| `archived` | boolean | 🟢 |

- 🔴 **Card count discrepancy.** The controls page says this endpoint returns a card count, but `GetGammaResponse` has no such field. The count is only in the analytics responses (`cardCount`).

### 7.2 `GET /v1.0/gammas/search` and MCP `search_gammas`

| Parameter | Rule | Marker |
|---|---|---|
| `q` | Full-text query over titles **and body text**. Optional if at least one filter is set | 🟢 [search][d-search] |
| `createdBy` | `me`, an email address, or a user ID | 🟢 |
| `updatedAfter` / `updatedBefore` | ISO-8601; both bounds inclusive | 🟢 |
| `includeArchived` | Default false | 🟢 |
| `limit` | 1–25. MCP default 10; REST default not stated | 🟢 / 🔴 |

| Behaviour | Detail | Marker |
|---|---|---|
| Ranking | With `q`, relevance-ranked. Filters only: last-updated descending. Use the date filters to reach older gammas | 🟢 [explore][d-explore] |
| Pagination | No cursor; each call returns up to `limit` hits | 🟢 |
| Hit fields | `id`, `title` (nullable), `url`, `highlight` (a snippet centred on the query, or null in filter-only browsing), `createdBy` (display name, or email via MCP), `updatedTime`, `archived` | 🟢 `GammaSearchHit`, [MCP][d-mcp] |
| Outage | `503` when document search is temporarily unavailable; retry later | 🟢 |
| Title browse | MCP `get_gammas` is separate: title search (minimum 3 characters), `type` filter, `createdByMe`, `limit` default 25 and max 50, cursor `after`. It returns `thumbnailUrl` and `themeId` | 🟢 [MCP][d-mcp] |
| History | Search shipped on 2026-08-28 | 🟢 [changelog][d-changelog] |

### 7.3 Reading content (MCP only)

**`read_gamma`** 🟢 ([MCP][d-mcp])

- Input: `gammaIdOrUrl`, which also accepts a completed `generationId`.
- Output is human-readable text, not HTML or JSON: a `Title: <title>` line, then `=== Page N: <title> ===` for each page or card in order, each with the full content (text, images, videos, embeds, charts, tables, diagrams).
- Needs view access. Archived gammas cannot be read.
- The REST API has no endpoint for content ([controls][d-ctrl]).

**`get_gamma_outline`** (rolling out; listed only when enabled) 🟢 ([MCP][d-mcp])

| Field | Meaning |
|---|---|
| `gammaId`, `title` | — |
| `requestedPageId` | Set when the input pointed at a page; resolve card references there first |
| `pages[]` | `pageId` (stable), `pageIndex` (0-based), `title`, `isMainPage` |
| `pages[].cards[]` | `cardId` (stable), `index` (0-based, **counts hidden cards**), `title` (first heading or empty), `textPreview` (up to 200 characters), `hidden`, `slideNumber` (visible cards only, from 1; `null` when hidden) |

- 🟢 To find "slide 3", use `slideNumber == 3`, not `index` ([MCP][d-mcp]).
- 🟢 The result comes back as both `structuredContent` and JSON text ([MCP][d-mcp]).

### 7.4 A generation ID in place of a gamma ID (MCP)

| Rule | Marker |
|---|---|
| `read_gamma`, `get_gamma_outline`, `edit_gamma` and `export_gamma` accept a `generationId` or `/generations/<id>` URL once the generation has completed | 🟢 [MCP][d-mcp] |
| Comment and analytics tools do **not** accept generation IDs | 🟢 |
| Pending generation: the tool returns an error telling you to poll and retry. Failed generation: it returns the failure message | 🟢 |
| A multi-page generation returns an error listing each page's `gammaId` and `gammaUrl`, so you call again with one | 🟢 |
| Resolution order: a `gen_` token is looked up as a generation. Any other token is tried as a file ID first, then as a generation | 🟢 |

---

## 8. Comments

`GET /v1.0/gammas/{gammaId}/comments` · MCP `get_gamma_comments` ([comments][d-comments]) 🟢

| Parameter | Rule | Marker |
|---|---|---|
| `limit` | 1–50 (MCP default 50) | 🟢 |
| `after` | Cursor from the previous `nextCursor` | 🟢 |
| `updatedSince` | ISO-8601. Returns only threads with activity after that time, **including new replies**; meant for delta polling | 🟢 |
| `includeArchived` | Include deleted comments and replies, each flagged `archived` | 🟢 |
| Access | **Comment-level** access required (403 otherwise). A malformed `updatedSince` returns 400 | 🟢 |

| Thread field (`CommentItem`) | Meaning | Marker |
|---|---|---|
| `id` | Thread ID | 🟢 |
| `cardId` | The card it is attached to; **`null` = page-level comment** | 🟢 |
| `targetText` / `targetHtml` | The quoted snippet the comment targets, as plain text or HTML (nullable) | 🟢 |
| `author` | `{ id, name }`; name nullable | 🟢 |
| `contentText` | Plain text with @mentions and emoji; paragraphs separated by newlines | 🟢 |
| `status` | `open` or `closed` | 🟢 |
| `archived` | Deleted | 🟢 |
| `mentionedUsers` | User IDs | 🟢 |
| `replies[]` | `{ id, author, contentText, mentionedUsers, archived, createdTime, updatedTime }` | 🟢 |
| `createdTime` / `updatedTime` | `updatedTime` is last activity, MCP says | 🟢 |

Response: `{ data[], hasMore, nextCursor }`. MCP names the array `comments` and orders it **oldest activity first**. 🟢

- 🟢 The API is read-only: there is no endpoint to create, reply to, resolve or delete comments.
- 🟢 The Slack app can post a reply from a Gamma comment notification, but that is a connector feature, not a public endpoint ([integrations][d-integ]).
- 🟡 The MCP output table omits `targetText`, `targetHtml` and `mentionedUsers`. They may simply be undocumented there.
- 🟡 **Anchoring.** `targetText`/`targetHtml` together with `cardId` suggest comments are anchored to a text range inside a card, like editor marks. Evidence: the schema.

---

## 9. Analytics

### 9.1 The four endpoints and MCP tools 🟢

| Endpoint / tool | Returns |
|---|---|
| `GET …/analytics` · `get_gamma_analytics` | `scope`, `gammaId`, `totalViews` (includes repeat opens), `uniqueViewers` (signed-in and anonymous), `uniqueEditors`, `cardCount`, `lastOpened` (nullable), `dailyViews { dayCount, timezone (IANA), days[{ date, uniqueViewers }] }` over a 30-day rolling window |
| `GET …/analytics/cards` · `get_gamma_card_analytics` | `scope`, `gammaId`, `uniqueViewers`, `uniqueEditors`, `cardCount`, `cards[{ cardId, cardName (nullable), cardPosition (1-based), viewTimeSeconds (total across viewers), viewersPercent (0–100) }]`. Every card in deck order; no activity means zeros |
| `GET …/analytics/viewers` · `get_gamma_viewer_analytics` | `scope`, `gammaId`, `data[{ viewerId, displayName, email, lastOpened, cardsViewed }]`, `hasMore`, `nextCursor` |
| `GET …/analytics/viewers/{userId}` · `get_gamma_viewer_detail_analytics` | `scope`, `gammaId`, `userId`, `displayName`, `email`, `lastOpened`, `cardsViewed` (only cards still in the gamma), `cardCount`, `perCardTimeSpent[{ cardId, cardName, cardPosition, viewTimePercent }]` |

Sources: [analytics][d-an], [cards][d-anc], [viewers][d-anv], [viewer detail][d-anvd], [MCP][d-mcp].

- 🟢 For anonymous viewers, `viewerId` is an anonymous ID and `displayName`/`email` are null.
- 🟢 `viewTimePercent` sums to about 100 across the cards a viewer has seen.
- 🟢 Every analytics endpoint accepts a file ID or a page/doc ID.

### 9.2 Gating, scope and freshness

| Rule | Detail | Marker |
|---|---|---|
| Plan | Pro or above for every caller, OAuth and connectors included (since 2026-10-22). Otherwise `403 code: individual_analytics_required` | 🟢 [pricing][d-pricing], [changelog][d-changelog] |
| MCP plan denial | The error carries `guidance` saying that changing permissions will not help | 🟢 [MCP][d-mcp] |
| Permission | At least **edit** permission on the gamma | 🟢 |
| `scope: all` | The caller has **manage** permission: every viewer is covered | 🟢 |
| `scope: self` | Edit permission only: metrics cover the caller's own activity, and the viewer list has at most their own row | 🟢 |
| Viewer detail | Manage permission is needed to read another viewer. Only signed-in viewers can be addressed; an anonymous one returns 404 | 🟢 |
| Cap | Viewer lists are capped at **500 viewers** in total | 🟢 [viewers][d-anv] |
| Pagination | `limit` 1–50 (MCP default 25), cursor `after`, `sortDirection` by last open (MCP default `desc`) | 🟢 |
| Freshness | Eventually consistent, updated about **hourly** | 🟢 |
| History | Analytics added 2026-07-13; `cardName`, `cardPosition` and complete card lists on 2026-07-16 | 🟢 [changelog][d-changelog] |

- 🟢 The 403 code `individual_analytics_required` is also used when the caller lacks edit permission, or lacks manage permission on the single-viewer route. So the code alone does not tell you which of the three applies ([errors][d-err]).
- 🟡 **Collection.** Per-card time and reach suggest the viewer client reports card-visibility time, which is aggregated in hourly batches. Evidence: the field shapes and the hourly freshness.

---

## 10. Lifecycle: archive and delete

| Aspect | Archive `POST /gammas/{id}/archive` | Delete `DELETE /gammas/{id}` | Marker |
|---|---|---|---|
| Effect | Removes the gamma from the active workspace without deleting it | Archives first if needed, then marks it for deletion. It becomes inaccessible at once and leaves all workspace views | 🟢 [archive][d-archive], [delete][d-delete] |
| Idempotent | Yes: re-archiving returns `200 { gammaId, archived: true }` | Not stated | 🟢 / 🔴 |
| Permission | Edit access, and the gamma must be in the key's workspace | **Workspace admin** role | 🟢 |
| ID form | **File ID only.** A web-URL slug returns `403`, not `404` | Probably file ID only: the get-gamma page says that, "unlike archive and delete", it accepts a doc ID | 🟢 / 🟡 [get gamma][d-get] |
| Afterwards | Archived gammas cannot be edited, exported or read (`read_gamma`). Search can include them with `includeArchived` | Requests for the ID return the same response as a non-existent gamma | 🟢 |
| Response | `{ gammaId, archived }` | `{ status: "deleted", gammaId, message }` | 🟢 |
| Credits | None | Not stated | 🟢 [limits][d-limits] |
| Surface | REST only (no MCP tool) | REST only | 🟢 [controls][d-ctrl] |
| Unarchive | No API | — | 🟢 (absent from the API) |

- 🟡 **Soft delete.** "Marks it for deletion" suggests a soft delete with a later purge. The purge timing and any recovery window are 🔴.
- 🟢 **Media archive.** `POST /images/media/{savedMediaId}/archive` archives a media-library item idempotently; the underlying file is not deleted and existing URLs keep working ([limits][d-limits]; endpoint description in the OpenAPI).

---

## 11. Inferred internals

| # | Inference | Evidence | Marker |
|---|---|---|---|
| 1 | A gamma is a **file** that contains **pages**, each holding **cards**. The doc ID in the URL is a page ID, and edits are page-scoped jobs | `gammaId` accepts a file or page ID; every edit status carries `pageId`; the outline gives pages → cards; edits "cannot add pages" | 🟡 |
| 2 | The edit lock is held **per gamma** (file), not per page, so editing two pages of one gamma in parallel is serialised | "Only one edit runs on a Gamma at a time" while each edit targets a single page | 🟡 |
| 3 | The edit agent applies tool calls **directly to the live document** rather than committing one transaction, which is why failures can leave partial changes | The `EditError` description warns of partial application; the UI shows the canvas changing in place while `Editing…` runs | 🟡 |
| 4 | Agent versions are **before/after content snapshots per request**, and restore is carried out by the agent rather than a pure pointer swap | `Original restored` started a new agent operation; the agent said it could not replay the after-version and rebuilt it from saved content (H2 §22.3) | 🟡 |
| 5 | Editor Undo/Redo is a separate document-level history (ProseMirror-style) | Undo touched another card instead of the agent edit (H2); TipTap wrapper test id | 🟡 |
| 6 | Queued chat messages wait in a per-session queue, and the agent is single-threaded per document | `Queued` with edit and remove controls; it ran only after generation finished (H1) | 🟡 |
| 7 | Export runs a **headless browser render** of the fixed 1280×720 cards and maps the DOM to OOXML or PDF, rasterising what has no native equivalent | `render_timeout`/`deck_too_large` reasons; host-font and gradient/frosted fallbacks; maths and some diagram bases as PNG; per-card PNG zip; logical canvas (H2, H3) | 🟡 |
| 8 | Agent jobs run in a sandboxed **harness** with a file store, and uploads land there | The header name `x-harness-upload-name`; "the agent works from them beside the prompt" | 🟡 |
| 9 | PPTX/PDF import converts the file into Gamma's card model first; "edit", "restyle" and "template" are agent passes run on the imported gamma | The intent table ("imports it, then edits/restyles/rewrites the import") | 🟡 |
| 10 | Comments are text-range anchors inside cards | `cardId` + `targetText`/`targetHtml` | 🟡 |
| 11 | Signed URLs are issued with a TTL of about 7 days, for both thumbnails and exports | Both documented as about 7 days / about one week | 🟡 |
| 12 | Card IDs are stable across edits, so analytics, comments and the outline can join on `cardId` | "Stable `cardId`" in the outline; the same field in comments and analytics | 🟡 |

---

## 12. Implications for AIMate

| Area | Gamma | AIMate today | Note | Marker |
|---|---|---|---|---|
| AI edit | Prompt-only edit per page, single-flight lock, summary receipt | `POST /ppt/projects/{id}/ai-edit`, typed proposals with preview and explicit apply (`applyProposal`), and revision snapshots with restore (`/revisions/{n}/restore`) (`apps/cowork-server/lib/ppt/api.mjs`, `proposal-service.mjs`, `command-history.mjs`) | Ours is stricter. Keep explicit apply, and add Gamma's visible scope chip and inline box | 🟢 code present |
| Compare and restore | Original/Modified with full-screen compare; restore runs through the agent | `repair-comparison.mjs` before/after; revisions with restore | Persist before and after so restore never re-generates, the gap H2 §22.3 exposed in Gamma | 🟢 |
| Import | Prompt-directed intent: as is, edit, restyle, template, summarise | Editable PPTX import (`import-pptx.mjs`); PDF as a source | Adopting the five-intent table as the import contract is cheap | 🟢 |
| Export | pdf, pptx, png-zip; bearer link of about a week | PPTX and PDF (authenticated engine routes); no PNG | A PNG zip is easy given per-slide renders | 🟢 |
| Comments and analytics | Read API, delta polling, per-card view time | None | Out of scope for a desktop app | 🟢 |
| Gamma-compatible facade | Full edit and export surface | `src/lib/ppt-gamma-service.ts` implements only generations (Classic and agent), polls, `GET /themes` and HMAC-signed 7-day `files/{id}.pptx\|pdf` links. **No `/agent/gammas/{id}/edits`, `/agent/edits/{id}`, `/gammas/{id}/export` or `/exports/{id}`** | Mapping edits onto proposals and exports onto engine export would complete the subset | 🟢 code read |

---

## Evidence limitations

- The docs corpus is one snapshot (`llms-full.txt` and its OpenAPI blocks, fetched 2026-11-05). No API, upload or export call was made for this report, so status codes, limits and error reasons are as documented, not observed.
- Some docs pages conflict (for example `GET /gammas/{id}` "card count" versus `GetGammaResponse`); these are reported, not resolved.
- UI behaviour comes from four in-repo sessions (H1 2026-09-29, H3 2026-10-08, H2 two runs on 2026-10-19). Each finding is one run on one deck; labels changed between sessions; nothing here is a repeated measurement.
- Help-centre statements (edit grouping, selection levels, export differences, import modes) are second-hand, via H1 and H4.
- Import has no first-hand test in this repo; the only fidelity figure is a press report of company claims (BC), which could not be re-checked offline.
- Exported-file findings (OOXML structure, fonts, overflow) come from Gamma's own PPTX/PDF inspected by script and LibreOffice, not opened in Microsoft PowerPoint.
- gamma.app was not inspected below the UI (Cloudflare challenge; no network capture), so §11 internals stay 🟡.

## 13. Open questions

- 🔴 The `statusCode` value for each `EditError.reason`. Which targets are `unsupported_target`.
- 🔴 The time limits behind edit `timeout` and export `render_timeout`, and the threshold for `deck_too_large`.
- 🔴 Whether the edit agent honours template slide locks. Docs only say locks bind generation.
- 🔴 Whether an edit through a file ID can reach cards on non-main pages, and how multi-page gammas show up in `read_gamma`'s "Page N" numbering.
- 🔴 Version history behaviour: retention, granularity, and how it relates to Original/Modified and Undo.
- 🔴 Whether Original/Modified exists for edits made through the API or MCP when the gamma is later opened in the UI.
- 🔴 Import fidelity measured first-hand: no upload test in this repo. How the 97% benchmark is scored (BC).
- 🔴 Whether `.ppt`, `.key` and `.odp` are rejected or just unlisted. What uploaded fonts are used for.
- 🔴 The export `403` "feature not available for workspace": which plans or settings. Whether API exports use the UI's default quality, editable tables and zoom-to-fit settings.
- 🔴 The `GET /gammas/{id}` card-count discrepancy (controls page versus schema).
- 🔴 Whether delete is idempotent, whether it really rejects doc slugs (only implied by the get-gamma page), and its purge timing.
- 🔴 REST default `limit` for search and comments.
- 🔴 How analytics counts "view time": visibility, focus or presenting mode.

---

## 14. Sources

Gamma developer docs (all fetched 2026-11-05):

- [Edit an existing Gamma][d-edit] · [Get edit status][d-editst] · [Brand, template, and editing controls][d-ctrl]
- [Import a presentation][d-import] · [POST /uploads][d-upload] · [POST /agent/generations][d-agen]
- [POST /gammas/{id}/export][d-export] · [GET /exports/{id}][d-expst] · [GET /gammas/{id}][d-get] · [GET /gammas/search][d-search]
- [Comments][d-comments] · [Archive][d-archive] · [Delete][d-delete]
- Analytics: [summary][d-an] · [cards][d-anc] · [viewers][d-anv] · [viewer detail][d-anvd]
- [MCP tools reference][d-mcp] · [Set up the MCP server][d-mcpsetup] · [Connect integrations][d-integ]
- [API scope and limits][d-limits] · [Explore the API][d-explore] · [Access and pricing][d-pricing]
- [Error codes][d-err] · [Warnings][d-warn] · [Poll for results][d-poll] · [Generate from approved templates][d-workflow] · [Migrate from Classic][d-migrate] · [Changelog][d-changelog]

In-repo first-hand research:

- [gamma-ai-editing-generation-queue-2026-09-29.md](../gamma-ai-editing-generation-queue-2026-09-29.md) (H1)
- [ppt-gamma-template-first-editor-workflow-audit-20261019.md](../ppt-gamma-template-first-editor-workflow-audit-20261019.md) (H2)
- [ppt-alpha-mining-layout-content-gamma-review-20261008.md](../ppt-alpha-mining-layout-content-gamma-review-20261008.md) (H3)
- [ppt-editorial-relational-media-gamma-observation-20261019.md](../ppt-editorial-relational-media-gamma-observation-20261019.md) (H4)
- [gamma-reverse-engineering-20261105.md](../gamma-reverse-engineering-20261105.md) (overview this report expands)

Third party (🟡): [BornCity, Gamma 5 launch coverage](https://borncity.com/news/gamma-5-gamma-tech-stellt-den-groessten-umbau-seiner-praesentationsplattform-vor/)

Code: `src/lib/ppt-gamma-service.ts`; `apps/cowork-server/lib/ppt/{api,proposal-service,command-history,repair-comparison,import-pptx}.mjs`

[d-edit]: https://developers.gamma.app/agent-gamma-5/edit-gamma.md
[d-editst]: https://developers.gamma.app/agent-gamma-5/get-edit-status.md
[d-ctrl]: https://developers.gamma.app/build-with-gamma/brand-template-editing-controls.md
[d-import]: https://developers.gamma.app/build-with-gamma/import-a-presentation.md
[d-upload]: https://developers.gamma.app/agent-gamma-5/create-upload.md
[d-agen]: https://developers.gamma.app/agent-gamma-5/create-agent-generation.md
[d-export]: https://developers.gamma.app/management/export-gamma.md
[d-expst]: https://developers.gamma.app/management/get-export-status.md
[d-get]: https://developers.gamma.app/management/get-gamma.md
[d-search]: https://developers.gamma.app/management/search-gammas.md
[d-comments]: https://developers.gamma.app/management/get-gamma-comments.md
[d-archive]: https://developers.gamma.app/management/archive-gamma.md
[d-delete]: https://developers.gamma.app/management/delete-gamma.md
[d-an]: https://developers.gamma.app/analytics/get-gamma-analytics.md
[d-anc]: https://developers.gamma.app/analytics/get-gamma-card-analytics.md
[d-anv]: https://developers.gamma.app/analytics/get-gamma-viewer-analytics.md
[d-anvd]: https://developers.gamma.app/analytics/get-gamma-viewer-detail-analytics.md
[d-mcp]: https://developers.gamma.app/mcp/mcp-tools-reference.md
[d-mcpsetup]: https://developers.gamma.app/mcp/gamma-mcp-server.md
[d-integ]: https://developers.gamma.app/connectors/connectors-and-integrations.md
[d-limits]: https://developers.gamma.app/reference/common-feature-requests.md
[d-explore]: https://developers.gamma.app/get-started/understanding-the-api-options.md
[d-pricing]: https://developers.gamma.app/get-started/access-and-pricing.md
[d-err]: https://developers.gamma.app/reference/error-codes.md
[d-warn]: https://developers.gamma.app/reference/warnings.md
[d-poll]: https://developers.gamma.app/guides/async-patterns-and-polling.md
[d-workflow]: https://developers.gamma.app/build-with-gamma/branded-template-workflow.md
[d-migrate]: https://developers.gamma.app/get-started/migrate-from-classic-to-gamma-5.md
[d-changelog]: https://developers.gamma.app/reference/changelog.md
