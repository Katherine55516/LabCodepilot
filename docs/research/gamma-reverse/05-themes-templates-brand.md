# Gamma themes, templates and brand

> Part of the Gamma reverse-engineering set: [index](README.md)

Scope: how Gamma (gamma.app) carries a brand. Covers themes, templates, the theme and template catalogues, template workflows, the layout system, headers and footers, the Styles panel, and sharing options. A short section at the end lists what this means for the AIMate PPT engine.

**Evidence markers.** 🟢 confirmed by Gamma's developer docs or by our own hands-on sessions (cited). 🟡 inferred (the basis is stated). 🔴 unknown.

**Evidence base.**

- Gamma developer docs (`developers.gamma.app`, `llms-full.txt` plus the OpenAPI blocks embedded in it), read on 2026-11-05. The brand-controls page says it was verified against both engines on 2026-10-20. 🟢
- Our hands-on Gamma sessions, written up in Chinese under `docs/research/`:
  - 2026-09-29: Gamma 5 Beta and Classic editors.
  - 2026-10-08: Compiler and Sample Size templates.
  - 2026-10-19: Further Study and Shoal templates.
  - 2026-10-22: Hanifah template.

  Only Gamma-side observations are used here. 🟢
- gamma.app itself sits behind a Cloudflare challenge. Nothing here comes from bypassing it, from private APIs, or from network captures. 🟢

Short source keys used inline are defined under [Sources](#sources).

---

## 1. Theme vs template

### 1.1 Definitions

| | Theme | Template | Marker |
|---|---|---|---|
| What it is | The look: colours, fonts, backgrounds and card styling. Themes are created in the Gamma app. | An existing gamma used as a starting point: its cards, layouts and example content, plus the theme it was built with. | 🟢 [brand-controls] |
| What it controls | Styling only. The agent still decides the structure and writes the content. | Structure and styling. The content is rewritten from the prompt. | 🟢 [brand-controls] |
| Elements named in the docs | Colours, fonts, backgrounds, "layout feel" ([themes]); "colors, fonts, logo" ([explore-api] parameter table); accent images (`imageOptions.source: themeAccent`, [gen-guide]); a logo (`headerFooter … source: themeLogo`, [hf-guide]) | Card list and order, per-card layouts, example content, image source, card dimensions, header/footer, the theme, plus hidden instructions and locks | 🟢 (template card dimensions and header/footer: [migrate], which says to use a template whose layout already has them) |
| Lookup | `GET /themes`, MCP `get_themes` | `GET /templates/search`, MCP `search_templates`, MCP `get_gammas` with `type: template` | 🟢 [themes], [tpl-search], [mcp-tools] |
| How it is marked | `type`: `standard` (built-in, global) or `custom` (made in the workspace) | A gamma whose `type` is `template` rather than `regular` | 🟢 [themes-guide], [get-gamma] |
| Which to pick | When on-brand styling is enough and Gamma may design the structure | When the structure matters too | 🟢 [brand-controls] |

- 🟢 A gamma's metadata exposes its `themeId`, or null when no theme is set. A template is therefore a gamma that points at a theme, not a separate kind of object ([get-gamma]).
- 🟡 Taken together: theme = style layer, template = an instance of a document that references a theme. The basis is the shared `themeId` field and the fact that "any gamma in your workspace" is accepted as a `templateId` ([agent-gen]).

### 1.2 Parameters per endpoint and mutual exclusion

| Endpoint / tool | Theme parameter | Template parameter | Both together | Default when no theme is given | Marker |
|---|---|---|---|---|---|
| `POST /agent/generations` (Gamma 5) | `themeId`, 1–128 chars | `templateId`, 1–128 chars | **400**: a template brings its own look | **None.** Without either, the agent picks a look. | 🟢 [agent-gen], [brand-controls], [migrate] |
| Classic `POST /generations` | `themeId` | — | n/a | Workspace default theme | 🟢 [gen-guide], [brand-controls] |
| Classic `POST /generations/from-template` | `themeId` (optional) | `gammaId` (required) | **Allowed.** The **exception**: `themeId` replaces the template's theme. | The template's own theme | 🟢 [from-template-guide], [brand-controls] |
| MCP `generate` | `themeId` | — | n/a | Workspace default theme (see Unknown theme IDs, [mcp-tools]) | 🟢 [mcp-tools] |
| MCP `generate_from_template` | `themeId` accepted only on a non-agent run. On an agent run the call fails before generating and says to retry without it. | `gammaId` (a workspace template), pinned as `templateId` | Rejected on agent runs | Keeps the template's theme | 🟢 [mcp-tools], [branded-workflow] |
| MCP `generate_multi_page_gamma` | `themeId` | — | n/a | Workspace default theme | 🟢 [mcp-tools] (parameter; Unknown theme IDs says "the other tools use the workspace default theme") |
| `POST /images`, MCP `generate_image` | `themeId` | — | n/a | Workspace default theme. Ignored for `type: scene` and when `referenceImages` are given. | 🟢 [images] |
| `POST /agent/gammas/{id}/edits` | none | none | n/a | Theme kept. "Edits never change the theme." | 🟢 [brand-controls] |
| Import (`files[].purpose: import`) | Not allowed with `themeId` | Not allowed with `templateId` | n/a | The imported deck keeps its own layout | 🟢 [import] |

- 🟢 An unknown or inaccessible `themeId` behaves differently by surface ([agent-gen], [images], [mcp-tools]):
  - REST agent endpoint and REST images: **400**.
  - MCP: a failed result with `themeNotFound: true`, `guidance`, and `validThemes`, which lists up to 100 `{id, name}` pairs.
- 🟢 The MCP docs tell the calling LLM to pass `themeId` only when the user named a theme or a custom theme exists for that brand. Otherwise the LLM should name the brand in `additionalInstructions` ([mcp-tools]).
- 🟢 Migrating from Classic from-template to the agent: drop `themeId`. "To change the look, save a template with that theme." There is no `title` field on the agent endpoint; ask for the title in the prompt ([migrate]).
- 🟢 Classifications on the brand-controls page ([brand-controls]):
  - The theme choice is a **default**.
  - "Edits cannot restyle" is **enforced**.
  - Template structure on the agent endpoint is **prompt-directed**.
  - Template structure on Classic from-template is a **default**.

### 1.3 "Standard Brand Base" (agent endpoint with `themeId`)

- 🟢 On `POST /agent/generations`, a `themeId` "is applied on Gamma's Standard Brand Base design for the requested `format`". The MCP docs call the same thing "Gamma's standard design" ([agent-gen], [mcp-tools]).
- 🟡 A theme alone does not choose layouts. The agent builds on a per-format base design (a base layout set) and the theme's tokens are painted over it. The basis is "base design for the requested format" plus the theme definition "styling only".
- 🟡 This means the agent has three routes:
  1. No brand: the agent picks a look.
  2. `themeId`: Standard Brand Base plus the theme.
  3. `templateId`: the template's own layouts and theme.

  The basis is [brand-controls] Defaults together with [agent-gen].
- 🔴 Whether a Standard Brand Base can be seen or chosen in the UI, and how it differs between `presentation`, `document` and `social`.

---

## 2. Theme catalogue and folders

### 2.1 `GET /themes` / `get_themes`

| Item | Detail | Marker |
|---|---|---|
| Purpose | Lists the themes available to the workspace: Gamma's standard library plus custom workspace themes | 🟢 [themes] |
| Query parameters | `query` (filter by name), `limit` (1–50, default 20), `after` (cursor), `type` (`standard` \| `custom`) | 🟢 [themes] OpenAPI |
| Pagination | Cursor-based: `data[]`, `hasMore`, `nextCursor` (null at the end). Pass `nextCursor` back as `after`. Keep `type` the same on every page, or results become inconsistent. | 🟢 [themes], [themes-guide] |
| `ThemeItem` fields | `id`, `name`, `type` (required); `colorKeywords[]`, `toneKeywords[]` (optional) | 🟢 [themes] OpenAPI |
| Example keywords | A custom theme "Prism": colour `light, blue, pink, purple, pastel, gradient, vibrant`; tone `playful, friendly, creative, inspirational, fun`. A standard theme "Standard Dark": colour `black, gray, accent`; tone `sophisticated, modern`. | 🟢 [themes-guide] (doc samples) |
| MCP form | `get_themes(name?)` returns `themes[]` with the same fields plus `count`. Guidance: search by name if the user names a theme; otherwise fetch the list and choose by tone and colour keywords. | 🟢 [mcp-tools] |
| Where IDs come from | This endpoint, or copied from the theme's ID shown in the app | 🟢 [gen-guide], [from-template-guide] |
| Where IDs go | `themeId` on `POST /generations`, `POST /generations/from-template`, `POST /agent/generations` (not together with `templateId`), and `POST /images` | 🟢 [themes], [images] |
| Writes | No API creates or edits a theme. Themes are made in the app. | 🟢 [brand-controls] ("Themes are created in the Gamma app"); 🟡 the absence of a write endpoint is inferred from the path list |

- 🟡 `colorKeywords` and `toneKeywords` look like retrieval metadata, so that an LLM can choose a theme without seeing it. The basis is the MCP guidance "choose based on tone and color keywords". There is no preview image field on `ThemeItem`.
- 🔴 Whether the keywords are hand-written or machine-tagged, and whether custom themes get them automatically.

### 2.2 `GET /folders` / `get_folders`

| Item | Detail | Marker |
|---|---|---|
| Fields | `FolderItem {id, name}` | 🟢 [folders] |
| Query parameters | `query`, `limit` (1–50, default 20), `after`. Same cursor pattern as themes. | 🟢 [folders], [themes-guide] |
| Permission | The list includes folders the user can only view. Placing a gamma in one with `folderId` needs **edit or full access** on that folder. A view-only folder returns `400`. Folder membership or workspace admin rights alone are not enough. | 🟢 [folders], [gen-guide] |
| Default location | Generated gammas go to the workspace root when no folder is given | 🟢 [folders] |
| History | Channels became folders on 2026-09-10, with per-folder permissions. Folders migrated without a clear owner give view-only access, so placing gammas in them fails with `400` until an admin assigns an owner. Separately, on 2026-09-25 `folderIds[]` was deprecated (max 1 entry, ignored when `folderId` is present). | 🟢 [changelog] |
| Agent warnings | `ignored_folder_id` and `folder_placement_failed` | 🟢 [agent-gen] OpenAPI `AgentGenerationWarning` |

---

## 3. Template workflows

### 3.1 Three ways to generate from a template

| | Classic `POST /generations/from-template` | Agent `POST /agent/generations` + `templateId` | MCP `generate_from_template` | Marker |
|---|---|---|---|---|
| Engine | Classic | Gamma 5 agent | Docs say it is the MCP form of the agent call ([branded-workflow]). The tool page also describes a non-agent behaviour (see 3.5). | 🟢 / 🟡 |
| Accepted sources | Only gammas marked as templates in the workspace | A workspace template, **any regular gamma** in the workspace, or an **official Explore template** | Only workspace templates (`workspaceTemplates` hits, `get_gammas type=template`, or a user-supplied ID) | 🟢 [brand-controls], [mcp-tools] |
| Structure retention | **Automatic** (a default). Changes only when the prompt asks. | **Prompt-directed.** The prompt says how closely to follow the template. | Prompt-directed (agent) | 🟢 [brand-controls] |
| Theme override | `themeId` replaces the template's theme | Rejected (400) | Rejected on agent runs | 🟢 |
| Eligibility limits | Exactly one page; card count within the plan's limit; not archived; not part of a site; not an Explore ID | Unknown, unauthorised, other-workspace, archived and retired IDs all get the **same 400**. No other template is substituted. | Same rejections as Classic are listed (multi-page, site-bound, archived, Explore) | 🟢 [from-template], [agent-gen], [connect-agent] |
| When eligibility is checked | The docs disagree: "when you submit the request" ([from-template], [scope]) vs "at generation time" ([tpl-search]) | At request time (400 on create) | At generation time; "try another hit" | 🟢 [from-template], [scope], [tpl-search], [agent-gen], [mcp-tools] |
| Title | `title`, 1–500 chars | No field; ask in the prompt | `title`, 1–500 chars | 🟢 [from-template-guide], [migrate], [mcp-tools] |
| Recommended for | Existing integrations | New integrations | Agents over MCP | 🟢 [branded-workflow] |

### 3.2 Classic from-template: every field

| Field | Required | Constraint / behaviour | Marker |
|---|---|---|---|
| `gammaId` | yes | File ID of a template gamma. The file must contain exactly one page. Find it with `GET /templates/search` or copy it from the app. | 🟢 [from-template] OpenAPI |
| `prompt` | yes | 1–400,000 chars. About 100k tokens in total, but the template itself uses part of that budget, so in practice the prompt can be shorter. Holds content, image URLs and instructions. | 🟢 [from-template-guide] |
| `title` | no | 1–500 chars. Inferred from the content when omitted. | 🟢 |
| `themeId` | no | Overrides the template's theme. The default is the template's theme. | 🟢 |
| `imageOptions.model` | no | AI image model. Relevant only when the template's images are AI-generated. | 🟢 |
| `imageOptions.style` | no | 0–5,000 chars of style text (the guide says 1–5,000). Same AI-only condition. | 🟢 (OpenAPI vs guide differ on the minimum) |
| `sharingOptions` | no | Same as the generate flow (section 8) | 🟢 |
| `folderId` / `folderIds` | no | Edit or full access needed; `folderIds` deprecated, at most 1 | 🟢 |
| `exportAs` | no | `pdf` \| `pptx` \| `png` (a zip with one PNG per card). One format per request. The URL expires after about a week and works for anyone who has it. | 🟢 |

- 🟢 Image source: new images automatically use the same source as the original template. If the template used Pictographic, new images come from Pictographic. There is no `source` field on this endpoint ([from-template-guide]).
- 🟢 Status codes: `400` (invalid request or template not found), `401`, `402` (insufficient credits), `403` (feature not enabled for the workspace), `429` (rate limit, or too many pending jobs on a Free workspace, with `Retry-After`) ([from-template] OpenAPI).
- 🟢 The OpenAPI operation description calls it generation "from a template Gamma with variable substitution". The prompt surface is the same as the app's **Remix** feature ([from-template], [from-template-guide]).
- 🟢 Create from Template went to beta with the Generate API v1.0 on 2025-11-05 and became GA on 2026-02-27 ([changelog]).

#### Classic prompt patterns (paraphrased from [from-template-guide]) 🟢

| Operation | Paraphrased example |
|---|---|
| Retarget the audience | Adapt a pitch deck for healthcare, stressing compliance and patient safety |
| Transform the subject | Turn a lesson plan on climate change into one on clean energy |
| Placeholders | Replace every `[[client-name]]` with a company name. The token style is a convention; any clear notation works. |
| Address a card | On card 9, update the pricing |
| Add cards | After the intro, add three case-study cards built from the template |
| Remove cards | Drop the team-bios section and a duplicate intro |
| "Lock" cards in the prompt | Leave the title, bios and thank-you cards exactly as written |
| Images | Use a logo URL to replace the placeholder image on the title slide |
| Fill from data | Populate the client-overview card from intake-form answers |
| Reorder | Put "Our Solution" before "The Problem"; move case studies to the end |

### 3.3 Agent `templateId`

- 🟢 Picking a template through the API "works the way picking the same template or gamma in the Gamma app does". The prompt decides how the source is used: filling its layouts with new content, borrowing only its look, or moving its content onto a new design. The source gamma itself is never changed ([agent-gen] OpenAPI).
- 🟢 An official template ID names "the currently published copy". It survives routine updates but can change when Gamma rebuilds or reintroduces the template, so rediscover it through search if a saved ID stops working ([agent-gen]).
- 🟡 Official Explore templates are therefore versioned gamma documents that Gamma republishes, not static assets. The basis is the "published copy" wording.
- 🟢 Dimensions and header/footer have no field on the agent endpoint. "Use a `templateId` whose layout already has the dimensions, logo, or footer you need" ([migrate]).
- 🟢 On REST the request still takes `format`. The worked example sends `presentation`, `document` and `social` with three different templates. Over MCP, "the format follows the template" ([branded-workflow]).
- 🟡 Other agent fields probably still apply alongside `templateId` (`numCards`, `quality`, `exportAs`, `folderId`, `sharingOptions`). Basis: the `CreateAgentGeneration` schema excludes only `themeId` when `templateId` is set (and `templateId`, `themeId`, `numCards` when a file has `purpose: import`), and the [branded-workflow] example sends `exportAs` with `templateId`. No page states it outright.
- 🔴 How `numCards` interacts with a template's own card count.

#### Prompt-directed structure retention 🟢

| Goal | Example prompt (paraphrased) | Source |
|---|---|---|
| Strict fill | Follow this template's structure and style exactly; only replace the content | [branded-workflow], [migrate] |
| Fix drift and regenerate | Keep every card, in the same order, with the same layouts | [branded-workflow] |
| Look only | Borrow only the template's look | [agent-gen] description |
| Use an imported deck as the template | Use this deck as a template for a Q3 update on another topic (imports, then rewrites, title included) | [import] |
| Restyle an imported deck | Import this deck and make it look better / use our brand colours | [import] |

- 🟢 In the worked example, the "Product launch deck" template with a strict prompt came back as eight cards in the template's order. The feature, pricing, roadmap and closing cards were filled from the brief, and the theme ran throughout. The docs still say to check the first run of any template ([branded-workflow]).
- 🟢 A loose prompt lets the agent add, drop or reorder cards ([brand-controls]).

### 3.4 Template instructions and locked slides

| Control | Where it is set | Behaviour | Marker |
|---|---|---|---|
| Template-level instructions | App: Template settings → Instructions | Overall guidance such as tone, audience, or "always fill in the pricing table" | 🟢 [brand-controls] |
| Slide-level instructions | App: a note on each slide | What belongs on that slide | 🟢 |
| Locked slide | App: lock per slide | Generation leaves the slide untouched (cover, legal disclaimer, pricing). **Human editors can still change it afterwards.** | 🟢 [brand-controls]; also noted in [audit-1019] B3 |
| Storage | Hidden inside the template | Never appears in the generated gamma. Read on every generation from that template, so the prompt only needs the brief. | 🟢 |
| API surface | **None** | No request parameter. There is also no per-element lock in a request; locking is per slide in the template. | 🟢 |
| Placeholder text | — | Placeholder text the prompt does not cover is filled by the model, not left as-is | 🟢 [brand-controls] |
| Validation | — | Gamma does not validate the result against the template or the prompt; check it yourself | 🟢 [brand-controls] |

- 🟡 A lock is a flag on a card that the generator obeys (the card is copied through or skipped) rather than an editor permission. The basis is "honored by generation, not by human editors".

### 3.5 End-to-end branded workflow (one brief, three outputs) 🟢 [branded-workflow]

| Step | REST | MCP | Notes |
|---|---|---|---|
| 0. Approve templates | — (done in the app) | — | Three templates in the example: "Product launch deck" (presentation), "Release notes" (document), "Launch announcement" (social) |
| 1. Generate | `POST /agent/generations {templateId, format, prompt, exportAs}`, once per output | `generate_from_template {gammaId, prompt, exportAs}` | Do not send `themeId`. Poll until `completed` or `failed`. |
| 2. Check | `GET /gammas/{id}` returns metadata only; the completed status carries `result.summary` | `read_gamma` returns the content as text | Reading content is MCP-only |
| 3. Revise | `POST /agent/gammas/{deckId}/edits {prompt}` | `edit_gamma` | Edit the **generated** gamma, not the template. One edit at a time. Needs edit access. Costs credits. |
| 4. Export | `POST /gammas/{id}/export {exportAs}` then `GET /exports/{id}` | `export_gamma` / `get_export_status` | Free. Any non-archived gamma you can view. |

- 🟢 Failure table from the same page:
  - `themeId` and `templateId` together: 400, drop `themeId`.
  - Bad `templateId`: 400; pick an ID from search.
  - Drift from the template: tighten the prompt and add locks.
  - `insufficient_credits`.
  - View-only access on an edit: permission error.
  - Classic eligibility rejections.
- 🟡 **The docs contradict each other on MCP `generate_from_template`.**
  - [branded-workflow] says it always runs the agent with `templateId`.
  - [mcp-tools] and [scope] apply Classic-style eligibility (single page, not site-bound) and say `themeId` is rejected only "when it runs as an agent generation".
  - The likely reading is that the tool can still route to Classic in some cases. 🔴 which cases.

### 3.6 Templates in the app (hands-on) 🟢

| Observation | Session | Source |
|---|---|---|
| A "Gamma templates" library with filters for Format, Category (for example Lesson 201, Proposal 176), Topic (Business 326, Education 256, Data and analytics 129), Color and Style. Cards are labelled like "Presentation · 16:9 · By Gamma". | 2026-10-08 | [alpha-1008] §27 |
| The template link parameter looked like `gamma:template:standard:further-study-sprint-finish` | 2026-10-19 | [audit-1019] §13.1 |
| **Use template** (10-19: after a preview). The composer then shows a removable template chip, and the full input is typed after that. | 10-08, 10-19 | [alpha-1008] §17.1, [audit-1019] §13.1 |
| The agent's tool activity lists "Prepped selected template" before "Created Plan" | 2026-10-08 | [alpha-1008] §27 |
| The Plan's **Look and feel** section shows "Suggested template", View/Browse templates, and Image source (AI images / Image placeholders). On 10-22 the plan review was only recorded as letting the user change the template and image source. | 10-08, 10-22 | [alpha-1008] §16.1, §17.1, §27.2; [outline-1022] §1 |
| Each template has a self-description (for example "dark code panels, step bars", or "graph-paper ground, lab-sheet panels, ~28 sample cards"). The generated deck did **not** use every component the template described. | 2026-10-08 | [alpha-1008] §16.1, §27 |
| Generated decks kept the template's palette and display treatment and dropped its sample text. Further Study: warm stone ground, blue-to-orange gradients, orange titles. Shoal: warm paper, deep-blue titles, coral strokes. | 2026-10-19 | [audit-1019] §15.1, §23.1 |
| **Leftover template text**: Page setup still held the template's header text ("The Patience Required to Build Well"). It did not appear in the exported body. | 2026-10-19 | [audit-1019] §15.1 |
| The type scale **differed between the two templates** seen that day. Compiler body text was about 17 pt. Sample Size used H1 52 / H2 36 / H3 24 / H4 20 / body 18 / footer 14 pt. | 2026-10-08 | [alpha-1008] §19, §27.7 |
| The document menu offers Duplicate, Remix and a save-as-template entry. Labels differed: 10-08 "**Create from this (Remix)**", "**Save new template**" plus Logo/colors/fonts; 10-19 "Remix", "Save template" (no Logo/colors/fonts entry recorded) | 10-08, 10-19 | [alpha-1008] §27.8, [audit-1019] §16.2 |
| The help centre treats Remix and a plain copy as different operations for workspace templates | help centre (read 10-19; not hands-on) | [audit-1019] B2 |
| A Gamma-sourced template PPTX the team used (Deal Review) carries a "Made with GAMMA" mark in its static assets | 10-13, 10-15 | [dl29-1013], [delivery-1015] |

- 🟡 "Suggested template" in the Plan suggests the agent proposes a template when the user has not picked one. Only the label was observed.
- 🔴 Whether the "Made with GAMMA" mark depends on the plan.

---

## 4. Template search

### 4.1 `GET /templates/search` / `search_templates`

| Item | Workspace templates | Explore templates | Marker |
|---|---|---|---|
| What | Templates in the caller's workspace | Official Gamma templates | 🟢 [tpl-search] |
| Hit fields | `id`, `title` (nullable), `url`, `previewUrl` (nullable) | `id`, `title`, `url`, `thumbnailUrl`, `previewUrl` (`title` and both image URLs nullable) | 🟢 OpenAPI |
| Ranking with `q` | Best-effort relevance on title **and body text**. May fall back to last-edited order. | Their own best-effort ranked search | 🟢 |
| Ranking without `q` | Browse by last edit, most recent first | Browse order | 🟢 |
| Fallback flag | `workspaceDegraded: true` when relevance ranking failed and last-edited order was used. **Omitted** otherwise. | — | 🟢 |
| Valid as Classic / MCP `gammaId` | Yes, checked at generation time (multi-page or site-bound may be rejected) | **No** | 🟢 |
| Valid as agent `templateId` | Yes | **Yes** | 🟢 [mcp-tools], [changelog] |
| Preview URL | Usually signed so it loads without a Gamma session. Expires after about 7 days; re-fetch rather than store. | Nullable; signing is not stated | 🟢 / 🔴 explore signing |

- 🟢 Parameters: `q` (up to 2,000 chars) and `limit` (1–25, applied **per list**). There is no cursor pagination ([tpl-search], [explore-api]).
- 🟢 On MCP the docs say both lists are relevance-ranked against `q`. MCP also notes that an Explore template can be linked by `url` ([mcp-tools]).
- 🟢 Ways to browse templates by title:
  - MCP `get_gammas` with `type: template|regular|all`: `query` of at least 3 characters, `limit` up to 50, cursor via `after`; results carry `themeId`.
  - REST `GET /gammas/{id}` returns `type: template|regular`.

  Sources: [mcp-tools], [get-gamma].
- 🟢 Changelog dates: template search arrived on REST (`GET /templates/search`, with `GET /gammas/search` and MCP `search_gammas`) on 2026-08-28, then on MCP as `search_templates` on 2026-08-31 ([changelog]).
- 🟡 "Best-effort relevance" with a degraded flag points to a separate search index (body-text retrieval) that can fail independently of the primary store. The basis is the wording "relevance ranking failed".

---

## 5. Layout system

### 5.1 Card dimensions per format

| Format | Valid `cardOptions.dimensions` | Default | Marker |
|---|---|---|---|
| `presentation` | `fluid`, `16x9`, `4x3` | `fluid` | 🟢 [gen-guide], [warnings] |
| `document` | `fluid`, `pageless`, `letter`, `a4` | `fluid` | 🟢 |
| `social` | `1x1`, `4x5`, `9x16` | `4x5` (Instagram posts and LinkedIn carousels); `9x16` for stories | 🟢 |
| `webpage` | `fluid` per [warnings]; "not applicable" per [gen-guide] | — | 🟢 (the two pages disagree) |

- 🟢 Only these values are accepted. Custom ratios and pixel sizes are not. A mismatch between dimensions and format falls back to the format default with a warning, for example "1x1 is not valid for format presentation … Using default: fluid" ([gen-guide], [warnings]).
- 🟢 Dimensions are a Classic request field (`POST /generations` and MCP `generate`). The agent endpoint has none; [migrate] says to use a `templateId` whose layout already has the dimensions you need.
- 🟢 Fluid vs fixed:
  - Fluid cards grow with their content. Fixed ratios are chosen in Page setup.
  - Overflow behaviour differs between fixed and fluid cards.
  - Older decks keep their original layout.

  Sources: help-centre pages cited in [queue-0929] §4 and [audit-1019] B4.
- 🟢 Page setup options as seen in the UI. The labels differed between sessions:
  - 2026-10-08: Default 16:9 / Flexible / Tall 4:3 / Custom.
  - 2026-10-19: 16:9 / Fluid / 4:3 / Custom.

  2026-10-08 also showed content alignment (top), Minimum text size (17 pt with Compiler, 18 pt with Sample Size), Scale content to fit (on), Show overflow guides (on) and Animations (off) ([alpha-1008] §16.1, §27.8). 2026-10-19 listed minimum text size, scale-to-fit, overflow guides and header/footer ([audit-1019] §16.2).
- 🟢 Tooltip meanings ([alpha-1008] §19.1):
  - Minimum text size is the **floor for scale-to-fit shrinking**, not a minimum per text role.
  - The overflow guide marks the 16:9 export boundary.
- 🟢 In the 2026-10-08 Sample Size session the 16:9 card was a fixed **1280 × 720 logical px** surface (`.gml-card__canvas`), scaled to the window with CSS `zoom` ([alpha-1008] §18, §27.9). The 2026-10-19 PPTX export measured 12,191,695 × 6,858,000 EMU ([audit-1019] §15.2).

### 5.2 Standard and suggested layouts (the card level) 🟢

| Element | Observation | Source |
|---|---|---|
| Standard layouts | Five: No accent, Top (colour band), Left image, Right image, Background image | [queue-0929] §4, [alpha-1008] §27.8 |
| Suggested layouts | After about 2–4 s of "Finding layouts that fit", about 5 thumbnails show **the same card content arranged differently**, with "Show more layouts". It re-lays out the card without changing the text. | [alpha-1008] §27.8, [queue-0929] §4 |
| Classic equivalent | The per-card "Try new layout" quick action (Smart Layouts) | [queue-0929] §3.1, [audit-1019] B5 |
| Accent images | Gamma decides automatically whether a card gets one, where it goes (left / right / top / background) and which image. This cannot be controlled through the API. It works best on fixed formats such as 16x9. | [gen-guide] |
| Layout hints over the API | Free text in `additionalInstructions`, for example "use a gallery layout", "keep text on the left" | [gen-guide] |
| Charts | No chart parameters. For predictable chart layouts, build them into a template and generate into it. "Your theme controls styling for all structured content." | [charts], [scope] |

### 5.3 Blocks, grids and freeform (inside the card) 🟢

| Element | Observation | Source |
|---|---|---|
| Add block categories | Blocks, Images, Shapes, Layouts, Diagrams, Charts, Videos, Embeds, Forms. Includes headings, body text, tables, callouts, **columns**, timelines, funnels, charts and embeds. | [queue-0929] §4 |
| Onboarding tip | "…and the layout adjusts around them" (on Add block) | [alpha-1008] §27.8 |
| GML node types | `gml-heading`, `gml-paragraph`, `gml-bullet`, `gml-table`, `gml-grid`, `gml-grid-cell`. Grid attributes: `layout=grid`, `gridDirection`, `gridRole=structure\|collection`, `gridLevel=card\|block` | [alpha-1008] §27.6 |
| Layout vocabulary seen in one deck | Text-and-image card split (for example 63/37, 30/70); full-width title over two panels (roughly 49/49 to 58/38); a repeated-item grid (4×2, 2×4); vertical numbered steps; a side formula panel; a takeaway sentence pushed to the panel bottom; native 2-column tables | [alpha-1008] §27.6 |
| Fit attributes | `data-overflow-mode="reveal"`, `--content-fit-scale` (1 on every card), `data-layout-fit-active` / `--layout-fit-scale` on dense grid cards | [alpha-1008] §27.7 |
| Freeform | "Convert Heading to freeform", "Convert slide to freeform", "Convert all slides to freeform…". Grids and freeform positioning are separate modes. | [queue-0929] §4, [audit-1019] B4 |
| Manual toolbar | Edit \| Agent, Undo/Redo, Add block, Layouts, text style, font, font size (pt), More formatting, Comment | [alpha-1008] §27.8 |

- 🟡 The engine appears to try layout-level fitting (spacing, arrangement) before shrinking text. The basis: dense grid cards had layout-fit active while content-fit scale stayed at 1. That source marks the inference as unverified.
- 🔴 Whether freeform conversion can be undone, and what is lost in a round trip. This was not tested.

---

## 6. Headers and footers

### 6.1 Specification (`cardOptions.headerFooter`) 🟢 [hf-guide], [gen-guide], OpenAPI `HeaderFooter`

| Key | Type | Allowed | Notes |
|---|---|---|---|
| `topLeft`, `topCenter`, `topRight` | element | one element each | Header row |
| `bottomLeft`, `bottomCenter`, `bottomRight` | element | one element each | Footer row |
| `hideFromFirstCard` | boolean | default `false` | Sits at the `headerFooter` level and applies to all positions (the title card) |
| `hideFromLastCard` | boolean | default `false` | Same, for the closing card |

| Element field | Required when | Constraint | Notes |
|---|---|---|---|
| `type` | always | `text` \| `image` \| `cardNumber` | The only required field in the schema |
| `value` | `type: text` | 1–500 chars | Keep it short; for a company name, copyright, "Confidential", a handle |
| `source` | `type: image` | `themeLogo` \| `custom` | `themeLogo` uses the selected theme's logo |
| `src` | `source: custom` | URI, 1–2,048 chars; must be publicly reachable | Your own logo |
| `size` | optional, images | `sm` \| `md` \| `lg` \| `xl` | The guide calls `md` the default |
| (none) | `type: cardNumber` | no configuration | Automatic page or slide number |

- 🟢 Limits: six positions at most, one element per position, not available for `webpage` ([hf-guide]).
- 🟢 Common mistakes the guide lists: a text element without `value`, a custom image without `src`, and booleans sent as strings (`"true"`) ([hf-guide]).
- 🟢 The guide's three full examples use `16x9` with a custom logo, card number and confidentiality text, then hides both. Social uses `1x1` with a handle centred in the footer. A document uses `letter` with a theme logo, a title and a card number ([hf-guide]).
- 🟢 Which surfaces take it:
  - Classic `POST /generations` and MCP `generate` / `generate_multi_page_gamma`: yes. The MCP slot shape matches REST, and all properties are optional ([mcp-tools]).
  - Classic from-template and the agent endpoint: no field. For the agent, [migrate] says to use a `templateId` whose layout already has the logo or footer you need.
- 🟢 Headers and footers shipped with the Generate API GA release, together with the List Themes and List Folders endpoints, on 2025-11-05 ([changelog]).
- 🔴 Whether a malformed element (for example a missing `src`) gives a 400 or a warning. The guide shows mistakes but not the response.

Illustrative only (assembled from the documented fields; not a captured request):

```json
{
  "format": "presentation",
  "cardOptions": {
    "dimensions": "16x9",
    "headerFooter": {
      "topRight":    { "type": "image", "source": "themeLogo", "size": "sm" },
      "bottomLeft":  { "type": "text",  "value": "Confidential" },
      "bottomRight": { "type": "cardNumber" },
      "hideFromFirstCard": true,
      "hideFromLastCard": true
    }
  }
}
```

### 6.2 Header and footer in the app (hands-on) 🟢

- 🟢 On 2026-10-19 the header and footer controls were under **Page setup**, and a template's header text stayed there after generation ([audit-1019] §15.1, §16.2). 🟡 That this makes them document-level rather than per-card is inferred from where the control sits.
- 🟢 In the Sample Size deck the footer text was 14 pt ([alpha-1008] §27.7).
- 🟡 Because headers and footers are document-level, a template carries them and the agent route inherits them. That matches the docs' advice to pick a template whose layout already has the footer.

---

## 7. Styles panel and brand elements in the UI

| Group | What was seen | Session | Marker / source |
|---|---|---|---|
| Themes | The theme picker in the Styles panel | 2026-09-29 | 🟢 [queue-0929] §4 |
| Fonts | Roles: **Display, Heading, Subheading, Body, Eyebrow, Caption, Label** (all Noto Sans SC in one deck), plus **block spacing** (value 18) | 2026-10-08 | 🟢 [alpha-1008] §19.1 |
| Colors | A group in the panel; contents not listed | all | 🟢 [queue-0929], [alpha-1008], [audit-1019] |
| Logo | A group in the panel; the same asset that `themeLogo` in headers and footers refers to | all | 🟢 panel; 🟡 that it is the same asset (basis: the `themeLogo` naming) |
| Button Design / Design | Named "Button Design" on 2026-09-29 and "Design" on 2026-10-08 and 2026-10-19 | — | 🟢 [queue-0929], [alpha-1008], [audit-1019] |
| Charts | Chart styling group; the docs say the theme styles structured content | all | 🟢 |
| Images | Image treatment group; the API's `themeAccent` source uses the theme's accent images | all | 🟢 panel, [gen-guide] |
| Custom styling | Free-form overrides | all | 🟢 panel; 🔴 whether it is CSS or a token editor |
| ··· menu | "Logo/colors/fonts" shortcut, Page setup, Save new template | 10-08 | 🟢 [alpha-1008] §27.8 |

- 🟢 The Styles panel is separate from content editing. Content and per-card layout have their own entry points ([queue-0929] §4, [audit-1019] §16.2).
- 🟢 Export warnings seen in the UI ([alpha-1008] §19.4, [audit-1019] §15.2):
  - Install the theme fonts (Noto Sans SC, Inter) on the machine that opens the file.
  - Gradient text and frosted backgrounds fall back to simpler rendering in export.
- 🟡 Some theme effects have no OOXML equivalent and are approximated on export. The basis is that fallback warning.
- 🟢 One case where the deck and the export disagreed on fonts: the DOM reported Noto Sans SC for code, while the PPTX code runs were Consolas 13 pt ([alpha-1008] §19.1).
- 🔴 The full set of tokens behind Colors (how many roles: accent, background, card, text…).

---

## 8. Sharing options

### 8.1 Fields and levels 🟢 (OpenAPI `SharingOptions` / `AgentGenerationSharingOptions` / `EmailOptions`; [gen-guide], [from-template-guide])

| Field | Levels | Default when omitted | Notes |
|---|---|---|---|
| `workspaceAccess` | `noAccess`, `view`, `comment`, `edit`, `fullAccess` | Workspace setting: "Default workspace sharing permission for new gammas" | `fullAccess` = view, comment, edit and share. An admin default of "No access" makes every new gamma private. |
| `externalAccess` | `noAccess`, `view`, `comment`, `edit` (no `fullAccess`) | Workspace setting: "Default link sharing permission for new gammas" | Access for people outside the workspace through the link |
| `emailOptions.recipients` | email list, at least 1 | — | Required inside `emailOptions` |
| `emailOptions.access` | `view`, `comment`, `edit`, `fullAccess` | not stated | Only workspace members can have `fullAccess`. MCP marks `access` as required. |

- 🟢 An explicit value in the request always overrides the workspace default ([gen-guide]).
- 🟢 The agent and Classic schemas have the same shape ([agent-gen], [from-template] OpenAPI).
- 🟢 Edits keep sharing settings and the gamma's URL ([brand-controls]).

### 8.2 Admin restrictions and warnings

| Warning code (agent, structured `{code, message}`) | Meaning | Marker |
|---|---|---|
| `ignored_workspace_access` | The admin has restricted workspace sharing, so the field was stripped and the admin default applied | 🟢 behaviour ([warnings]); 🟡 code-to-case mapping |
| `ignored_external_access` | Access links are disabled by an admin | 🟢 / 🟡 same |
| `ignored_email_options`, `ignored_email_recipients` | Email sharing was dropped | 🟡 from the code names; 🟢 that MCP Superhuman Go drops `emailOptions` |
| `email_full_access_members_only` | `fullAccess` was asked for a non-member | 🟡 from the name plus the members-only rule |
| `workspace_access_failed`, `external_access_failed`, `email_invites_failed` | Applying the setting failed after creation | 🟡 from the names |
| `ignored_folder_id`, `folder_placement_failed` | The folder could not be used or applied | 🟡 from the names |
| `export_failed` | `exportAs` failed. This is a warning, never a failed generation. | 🟢 [agent-gen] |

- 🟢 Classic returns warnings as one free-text string. Examples: "sharingOptions.workspaceAccess was ignored because workspace sharing is restricted by a workspace admin", and the same for access links ([warnings]).
- 🟢 Warnings never stop a generation. They appear on the create response and may appear again on the final status ([warnings], [agent-gen]).
- 🟢 Superhuman Go MCP connections cannot share outside the workspace. On the generate tools the server drops `emailOptions`, forces `externalAccess` to `noAccess`, ignores `publish`, and keeps `workspaceAccess` ([mcp-tools]).
- 🔴 Whether a template carries sharing defaults into generated gammas. None are documented.

---

## 9. Inferred internals of the theming system

| Inference | Evidence | Marker |
|---|---|---|
| A theme is a set of design tokens: colour roles, a font family per role (Display through Label), block spacing, button and chart styles, image treatment and accent images, a logo, plus custom overrides | The Styles panel groups and font role list (§7); `themeAccent` and `themeLogo` in the API; "colors, fonts, backgrounds, card styling" | 🟡 |
| The type scale (pt per role) belongs to the template or theme, not to the engine | Different scales in Compiler and Sample Size under the same engine (§3.6) | 🟡 |
| A theme carries metadata for machine selection (`colorKeywords`, `toneKeywords`) alongside its tokens | `ThemeItem` and the MCP selection guidance (§2.1) | 🟡 |
| With `themeId`, the agent combines a per-format **base design** (Standard Brand Base) with theme tokens. With `templateId`, the template's own layouts replace that base. | The [agent-gen] wording; theme = "styling only" | 🟡 |
| A template is a regular gamma document with `type=template`. It holds a theme reference, page setup (dimensions, header/footer), an image-source setting, hidden instructions per document and per card, and per-card lock flags. | `type` and `themeId` on `GET /gammas`; any gamma accepted as `templateId`; instructions "stored invisibly"; images inherit the template's source; dimensions and footer inherited on the agent route | 🟡 |
| Generating from a template = cloning the document, then rewriting the unlocked cards' content (and, if allowed, the card list) with the agent | The source stays unchanged; locked slides are "carried over unchanged"; results drift without a strict prompt | 🟡 |
| Official Explore templates are versioned published copies under a "standard" namespace | The "currently published copy" wording; the link parameter `gamma:template:standard:<slug>` | 🟡 |
| Cards are a structured grid document (GML) rendered on a fixed logical canvas. Layout fitting runs before content (text) fitting, with a minimum-text-size floor. | DOM attributes and the 1280×720 canvas (§5) | 🟡 |
| Classic from-template is a stricter, structure-preserving pipeline (one page, card limit) built before the agent existed | Eligibility rules; "variable substitution"; same prompt surface as Remix | 🟡 |
| Template search uses a separate relevance index over title and body text, with a fallback to the primary store | `workspaceDegraded` | 🟡 |

---

## 10. Implications for AIMate (short)

- 🟢 Our built-ins (`violet`, `blue`, `light`, `marketing`, `education`) are a palette plus a set of fonts applied to our own deterministic layouts (`BUILT_INS` in `apps/cowork-server/lib/ppt-template.mjs`). That is close to Gamma's **theme on the Standard Brand Base**. Uploaded and managed PPTX templates are close to Gamma's **template**.
- 🟡 Adopt Gamma's explicit rule: a request names a style (built-in) **or** a template, never both silently. Report the choice in the result.
- 🟢 Gamma's template locks are honoured by generation only, and its output is not validated against the template. Our engine already does more than this, and we should keep it:
  - The `keep_fixed` template content mode and per-node `mustPreserve` flags (used in `ppt-template-dispositions.mjs` and `ppt-template-fidelity.mjs`).
  - Template fidelity checks (`ppt-template-fidelity.mjs`).
  - Old-text leak checks (`inspectTemplateLeak` in `ppt-template-leak.mjs`).

  Gamma's leftover template header text (§3.6) is exactly the kind of failure our leak check targets. Today `inspectTemplateLeak` scans only visible text and list nodes on slides; extend it to header/footer text and to notes.
- 🟡 Gamma's `design_only`-like behaviour (borrow only the look) is something the prompt asks for. Ours is a mode (`design_only` / `keep_fixed`), which is more predictable, so keep it a mode.
- 🟡 Headers and footers: Gamma has a small declarative model (six slots; text, logo or number; hide on first/last card). Our chrome slots (`ppt-chrome-slots.mjs`) are geometric picture bands found in uploaded templates. A declarative six-slot header/footer for built-ins and `preserve`/`mapped` templates would be cheap to add and easy to expose in an API.
- 🟡 Add `colorKeywords` / `toneKeywords`-style metadata and a preview URL to template records, so the LLM and the UI can pick templates the way Gamma's `get_themes` / `search_templates` allow.
- 🟢 Our built-in renderer writes a fixed 16:9 slide (12,192,000 × 6,858,000 EMU in `ppt-render.mjs`); uploaded-template paths read the template's own size (`templateFidelity.width/height`). Gamma has nine dimension values, but its agent endpoint has no dimensions field (only a template carries them), so a 16:9 default is not a gap for template-driven decks.
- 🟡 Keep the size of each text role separate from the floor that fitting may shrink to. Gamma's "Minimum text size" is only the second of these (§5.1).

---

## Evidence limitations

- The docs corpus is one snapshot (`llms-full.txt`, read 2026-11-05). Pages disagree in places (MCP `generate_from_template` routing, when Classic eligibility is checked, `webpage` dimensions) and are reported as disagreements, not resolved.
- No API call was made for this report. Defaults, error codes and warning texts are as documented, not as observed on the wire.
- Hands-on evidence is four sessions (2026-09-29 to 10-22; the 09-29 and 10-08 ones on a Free plan) with five named templates. Type scales, menu labels and Page setup options are per session and per template, and labels changed between sessions.
- Help-centre statements (fluid vs fixed cards, Remix vs copy, template-instruction lock semantics) are second-hand, quoted by the in-repo studies, not read directly here.
- gamma.app was not inspected below the UI (Cloudflare challenge; no network capture), so every claim about theme tokens, template storage or Standard Brand Base internals is 🟡 at best.
- Agent warning codes beyond `export_failed` are mapped to cases from their names; only the Classic free-text warnings have documented examples.

## Open questions

- 🔴 What a Standard Brand Base looks like per format, and whether users can see or choose it.
- 🔴 Which cases make MCP `generate_from_template` run as Classic rather than agent, given the contradicting pages (§3.5).
- 🔴 How `numCards` and `format` interact with a template's own card count and format on the agent endpoint.
- 🔴 The full token list behind Colors and Custom styling, and whether custom styling is raw CSS.
- 🔴 How `colorKeywords` / `toneKeywords` are produced, and whether every custom theme has them.
- 🔴 Whether Explore preview and thumbnail URLs are signed or expire.
- 🔴 What a malformed header/footer element returns (a 400 or a warning), and how `size` behaves for `themeLogo` when the theme has no logo.
- 🔴 Whether templates carry sharing or folder defaults into generated gammas.
- 🔴 What locking does to the slide-level instructions on a locked slide, and whether locks survive Duplicate or Remix.
- 🔴 Whether the "Restyle" quick edits seen in the Classic UI change the theme, given that the API says edits never restyle.
- 🔴 Whether the "Made with GAMMA" mark in Gamma-sourced template assets depends on the plan.
- 🔴 What freeform conversion loses in a round trip, and how a fluid deck is paginated on PPTX export.

## Sources

Gamma developer docs (all `https://developers.gamma.app/…`, read 2026-11-05):

[brand-controls]: https://developers.gamma.app/build-with-gamma/brand-template-editing-controls.md
[branded-workflow]: https://developers.gamma.app/build-with-gamma/branded-template-workflow.md
[agent-gen]: https://developers.gamma.app/agent-gamma-5/create-agent-generation.md
[from-template]: https://developers.gamma.app/generations-classic/create-from-template.md
[from-template-guide]: https://developers.gamma.app/guides/create-from-template-api-parameters-explained.md
[gen-guide]: https://developers.gamma.app/guides/generate-api-parameters-explained.md
[themes]: https://developers.gamma.app/workspace/list-themes.md
[folders]: https://developers.gamma.app/workspace/list-folders.md
[themes-guide]: https://developers.gamma.app/guides/list-themes-and-list-folders-apis-explained.md
[tpl-search]: https://developers.gamma.app/management/search-templates.md
[get-gamma]: https://developers.gamma.app/management/get-gamma.md
[hf-guide]: https://developers.gamma.app/guides/header-and-footer-formatting.md
[mcp-tools]: https://developers.gamma.app/mcp/mcp-tools-reference.md
[connect-agent]: https://developers.gamma.app/build-with-gamma/connect-your-own-agent.md
[warnings]: https://developers.gamma.app/reference/warnings.md
[scope]: https://developers.gamma.app/reference/common-feature-requests.md
[migrate]: https://developers.gamma.app/get-started/migrate-from-classic-to-gamma-5.md
[explore-api]: https://developers.gamma.app/get-started/understanding-the-api-options.md
[import]: https://developers.gamma.app/build-with-gamma/import-a-presentation.md
[charts]: https://developers.gamma.app/guides/charts-and-structured-content.md
[images]: https://developers.gamma.app/images/create-image-generation.md
[changelog]: https://developers.gamma.app/reference/changelog.md

- [brand-controls] Brand, template, and editing controls
- [branded-workflow] Generate from approved templates
- [agent-gen] POST /agent/generations (with embedded OpenAPI `CreateAgentGeneration`, `AgentGenerationWarning`)
- [from-template] POST /generations/from-template (OpenAPI `FromTemplateGeneration`)
- [from-template-guide] Generate from template (Classic guide)
- [gen-guide] Generate from text (Classic guide: `cardOptions`, `sharingOptions`, accent images)
- [themes] GET /themes (OpenAPI `ThemeItem`, `ListThemesResponse`)
- [folders] GET /folders (OpenAPI `FolderItem`)
- [themes-guide] Use themes and folders
- [tpl-search] GET /templates/search (OpenAPI `SearchTemplatesResponse`, `WorkspaceTemplateSearchHit`, `ExploreTemplateSearchHit`)
- [get-gamma] GET /gammas/{gammaId}
- [hf-guide] Format headers and footers (OpenAPI `CardOptions`, `HeaderFooter`, `HeaderFooterElement`)
- [mcp-tools] MCP tools reference (`generate`, `generate_from_template`, `search_templates`, `get_themes`, `get_folders`, `get_gammas`, Unknown theme IDs)
- [connect-agent] Connect your own agent
- [warnings] Warnings
- [scope] API scope and limits
- [migrate] Migrate from Classic to Gamma 5
- [explore-api] Explore the API
- [import] Import a presentation
- [charts] Add charts and structured content
- [images] POST /images
- [changelog] Changelog

In-repo hands-on and related reports:

[audit-1019]: ../ppt-gamma-template-first-editor-workflow-audit-20261019.md
[queue-0929]: ../gamma-ai-editing-generation-queue-2026-09-29.md
[alpha-1008]: ../ppt-alpha-mining-layout-content-gamma-review-20261008.md
[outline-1022]: ../PPT_Outline_vs_Gamma_Simplification_20261022.md
[delivery-1015]: ../ppt-gamma-ai-review-delivery-20261015.md
[dl29-1013]: ../ppt-dl29-gamma-semantic-comparison-20261013.md

- [audit-1019] Template-first generation and Visual Editor audit (Further Study and Shoal templates; B1–B8 help-centre findings)
- [queue-0929] Gamma 5 and Classic editing and generation queue (Layouts, Add block, Freeform, Styles panel)
- [alpha-1008] Alpha Mining review §16–27 (Compiler and Sample Size templates; GML, Page setup, Fonts roles)
- [outline-1022] Outline vs Gamma simplification (Hanifah template; Plan controls)
- [delivery-1015] and [dl29-1013] Notes on the "Made with GAMMA" mark in a Gamma-sourced template
- Set siblings: [master report](../gamma-reverse-engineering-20261105.md) §5; [API reference](08-api-reference.md)
- AIMate code referenced in §10: `apps/cowork-server/lib/ppt-template.mjs`, `ppt-template-dispositions.mjs`, `ppt-template-leak.mjs`, `ppt-chrome-slots.mjs`
