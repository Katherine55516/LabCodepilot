# Gamma (gamma.app) reverse engineering: how it handles content, media, layout, templates, editing and export

> Date: 2026-11-05 · Scope: Gamma 5 (launched 2026-10-06) and Gamma Classic.
> Technical implementation of the compatibility layer built from this review: [docs/handover/ppt-gamma-compat.md](../handover/ppt-gamma-compat.md) · product reasoning: [docs/insights/ppt-gamma-compat.md](../insights/ppt-gamma-compat.md)

Confidence markers (borrowed from the [Reversa](https://github.com/sandeco/reversa) spec convention):

- 🟢 **Confirmed**: stated in Gamma's official developer docs (OpenAPI schemas and guides at developers.gamma.app, fetched 2026-11-05) or observed hands-on in earlier rounds of this repo's research.
- 🟡 **Inferred**: deduced from documented behaviour, error codes, field shapes or third-party reports; plausible, not verified.
- 🔴 **Gap**: not knowable from public evidence; needs a hands-on session or is closed.

## 0. Evidence and method

| Source | What it gave | Marker |
|---|---|---|
| `developers.gamma.app/llms-full.txt` (562 KB, 25 REST endpoints, 77 OpenAPI schemas, the MCP tool reference, guides) | The full public contract: fields, enums, limits, status shapes, warnings, error codes, pricing | 🟢 |
| This repo's hands-on Gamma sessions ([editing queue](gamma-ai-editing-generation-queue-2026-09-29.md), [outline comparison](PPT_Outline_vs_Gamma_Simplification_20261022.md), [density review](ppt-gamma-density-page-estimation-review-20261006.md), [media observation](ppt-editorial-relational-media-gamma-observation-20261019.md)) | Observed UI flow, outline behaviour, measured content density | 🟢 (observed) |
| Gamma's ProseMirror forum showcase post | The editor is built on ProseMirror and Tiptap | 🟢 |
| BornCity report on the Gamma 5 launch (company claims) | Agent sandbox, 20+ models, ~20 connectors, import fidelity claim | 🟡 (third party relaying company claims) |
| Headless browser on gamma.app | Blocked by a Cloudflare Turnstile challenge. Not bypassed on purpose, so no bundle or network-level inspection. | 🔴 |

Everything below that describes Gamma's internals beyond the published contract is labelled 🟡 or 🔴.

---

## 1. Inventory: what Gamma is made of

### 1.1 Document model 🟢

```
Workspace
 └── File  ("gamma", id g_…, URL gamma.app/docs/<slug>-<id>)
      ├── type: regular | template
      ├── theme (themeId)                    ← styling only
      └── Page[]  (1 normally; up to 50 for a multi-page file or site)
           └── Card[]  (a "slide"; stable cardId, index, hidden flag)
                └── Blocks (text, image, chart, table, diagram, embed, form, …)
```

- **A card is the unit** of content, layout, analytics (time on card) and editing ("edit this card"). `slideNumber` counts only visible cards; `index` counts hidden ones too.
- **Formats** are `presentation`, `document`, `social` and `webpage` (webpage is Classic only). Each format has its own valid card dimensions:

| Format | Dimensions |
|---|---|
| presentation | `16x9`, `4x3`, `fluid` |
| document | `pageless`, `letter`, `a4`, `fluid` |
| social | `1x1`, `4x5`, `9x16` |
| webpage | `fluid` |

- Cards **grow with their content by default** (`fluid`). A fixed aspect ratio is a page-setup choice, and fixed ratios matter for exports. 🟢 (help centre, observed)

### 1.2 Two engines side by side 🟢

| | Classic (`POST /generations`) | Gamma 5 agent (`POST /agent/generations`) |
|---|---|---|
| Input | `inputText` + explicit knobs (`textMode`, `textOptions`, `imageOptions`, `cardOptions`, `cardSplit`) | `prompt` (the brief and the source text) + `additionalInstructions` |
| Who decides structure | Parameters plus the model | The agent plans it; `numCards` is a soft target ("may deviate by a card or two, not validated") |
| Unknown fields | — | **Rejected with 400** (`textMode` and `textOptions` are not allowed) |
| Pricing | Per card (1–3 credits) and per image (2–125 credits by model tier) | "By the work the agent does", following the `quality` preset (`lite`/`standard`/`max`) |
| Default theme | Workspace default | None: pass `themeId` or `templateId` |
| Webpages, multi-page | Yes | No |

### 1.3 Architecture (inferred)

| Layer | Evidence | Marker |
|---|---|---|
| Editor: ProseMirror + Tiptap block editor; cards are nodes in one document | Gamma's own forum post; the "Add block" catalogue; "convert heading or slide to freeform" | 🟢 editor base · 🟡 card-as-node |
| Freeform canvas added in Gamma 5 next to structured blocks | Launch coverage; "Convert slide to freeform" menu | 🟢 |
| Async job system: every generate, edit, export and image is a job (`gen_…`, `editId`, `exportId`) polled every ~5 s; **no webhooks** | API docs | 🟢 |
| Agent runtime in a sandbox: web research, image generation, code, "automated layout and self-checks" | BornCity; the `checking`/`polishing` progress stages | 🟡 |
| Multi-model routing: 20+ text models (Anthropic, OpenAI, Google) and many image models, chosen by internal evals | BornCity; the image model table | 🟡 text · 🟢 image list |
| Model output is not validated against the request ("results are not validated against the template or prompt") | Brand-controls doc | 🟢 |
| Per-workspace concurrency limiter (2 agent jobs on Free, 10 on paid; `429 workspace_concurrency_limit_exceeded` with `Retry-After`) and three-tier rate-limit headers (burst, per-period, daily) | API docs | 🟢 |
| Media CDN: Gamma fetches and **re-hosts** input image URLs | Image URL guide | 🟢 |
| Hosted MCP server with OAuth and dynamic client registration (DCR); the same server powers the ChatGPT, Claude and Slack connectors; custom MCP connectors can be added to the agent | MCP docs | 🟢 |
| Frontend stack beyond the editor (UI kit, state, transport, collaboration sync such as Yjs or Hocuspocus) | Not observable through the Cloudflare challenge | 🔴 |

---

## 2. The generation pipeline

### 2.1 Gamma 5 agent flow (UI) 🟢 observed

| Stage | What happens |
|---|---|
| 1. Intake | Pick a format, type a prompt, attach files or connector sources, choose an effort level, optionally choose a template. Long pasted text becomes an attachment ("Pasted text · 19 KB"). |
| 2. Clarify | The agent may ask about the goal, audience, language ("bilingual" was preselected when it found paired paragraphs) and text handling (condense / preserve / expand). It did **not** ask for a page count. It skips questions when the prompt is specific. |
| 3. Plan | A streamed, editable outline in which **each card already holds its finished content**, not just a title. Controls: Merge between cards, an instruction per card, Add slide, template preview, image source. The user clicks **Generate**. Intermediate outline states can briefly show extra cards. |
| 4. Build | Per-card progress: "Writing slides 0/19 → Adding images 14/19 → Polishing slides 17/19". The API exposes the same stages as `progress.stages`: `queued / writing / imaging / checking / polishing / done / failed`, and `percent` runs 0–99 (only `completed` is 100). |
| 5. Deliver | An agent summary plus an editable deck in the same conversation. |
| During build | Messages typed mid-generation are **queued** (they can be edited or removed) and run after the build. Generation is not interrupted. |

### 2.2 Classic parameter semantics 🟢

- `textMode`:
  - `generate` expands brief input.
  - `condense` summarises long input to the requested length.
  - `preserve` keeps the exact text, adding structure such as headings "where it makes sense".
- `textOptions.amount` (`brief`, `medium` (default), `detailed`, `extensive`) sets text per card. It applies to `generate` and `condense` only.
- `tone` and `audience` take free text (≤500 characters) and apply **only to `generate`**.
- `language` sets the output language regardless of the input language. About 60 codes are accepted.
- `numCards` defaults to 10. It applies **only with `cardSplit: auto`**, which ignores `\n---\n`.
- `cardSplit: inputTextBreaks` makes one card per `\n---\n` segment and ignores `numCards`; one break gives two cards.
- `additionalInstructions` (≤5,000 characters) is free steering for layout, visual style, tone and formatting. Gamma's own tips: "use a gallery layout for the product images", "keep text on the left".
- Input limit is about 100k tokens (~400k characters), lower when the job needs extra reasoning.

---

## 3. How Gamma handles content

### 3.1 Content principles (observed, same-input comparisons) 🟢

1. **The outline is the content.** Each outline card is already the condensed 3–8 points, numbered steps or a one-line claim. The later build only lays it out and no longer decides what to say.
2. **Split by idea, not by heading.** Eleven source sections became 19 cards. One section became four cards; another became a checklist plus a one-line claim. The table of contents was dropped, and a "read with tutorial 14" aside became the closing card.
3. **Facts are preserved verbatim**: ranges, √N, 10^6, "~3,700 trading days" and all eight gates survived condensing.
4. **Bilingual material is merged per line** ("English | 中文", with the Chinese side shorter) instead of putting both full paragraphs on the slide.
5. **Code is explained, not pasted**: a Python example became "raw = -ret5 / rank(20-day avg volume), then cross-sectional rank · example only".
6. **Page count follows the content.** The user is not asked for a number up front.

### 3.2 Measured density (Gamma 10 pages vs AIMate 22 pages, same input, 16:9) 🟢

| Metric | Gamma | AIMate |
|---|---:|---:|
| Body characters per page (median) | **1,019** | 443 |
| Body Q1 / Q3 | 909 / 1,098 | 371 / 587 |
| Explicit body font size (median) | ~11 pt | ~13 pt |
| Total text | 9,359 | 10,175 |

The same amount of information fit on less than half as many pages. Gamma does this through **composition**: multi-column comparisons, two short tables side by side, a problem stated with several supporting dimensions, full stage descriptions in process cards, and a high-information closing card. It does not do it by shrinking text. 🟡 Gamma's density does depend on a ~11 pt body size, so a template that requires larger type holds less.

### 3.3 Structured content: charts, tables, diagrams 🟢

- There are **no chart parameters** in the API. Chart type, styling and data format are steered through the prompt and `additionalInstructions`, and **output is non-deterministic** across runs.
- Gamma's advice: give explicit values, name the chart type, and avoid category labels that look like numbers (`$100` as a label is read as data).
- For predictable charts or tables, **design them once in a template** and generate into it.
- The theme controls the styling of all structured content.
- The editor's block catalogue covers Blocks, Images, Shapes, Layouts, **Diagrams** (timeline, funnel and others), **Charts**, Videos, Embeds and **Forms**. These are native, editable components, not pictures.

### 3.4 Placeholders, locks and verbatim text 🟢

- Template placeholder text that the prompt does not cover is **filled by the model**, not left as it was.
- There is **no per-element lock in a request**. Locking is per slide, set in the template (template-level instructions, slide-level instructions, locked slides).
- To keep a block verbatim outside a template, say so in the prompt. This is prompt-directed, so check the result.

---

## 4. How Gamma handles media

### 4.1 Image sources 🟢

`imageOptions.source` (Classic) chooses where images come from:

| Source | Behaviour |
|---|---|
| `aiGenerated` (default) | Text-to-image; `model` and `style` apply only to this source |
| `pictographic`, `pexels`, `giphy` | Stock illustrations, photos, GIFs |
| `webAllImages` / `webFreeToUse` / `webFreeToUseCommercially` | Web search with an increasingly strict licence filter |
| `themeAccent` | The theme's own accent images |
| `placeholder` | Empty image slots to fill later |
| `noImages` | Only the images you supplied |

`imageOptions.style` (≤5,000 characters) is recommended even as a single word ("photorealistic") so images stay visually consistent across the deck.

### 4.2 Accent images (decorative) 🟢 and 🟡

- **Accent images are placed automatically and cannot be controlled through the API.** Gamma decides **whether** a card gets one, **where** it goes (left, right, top or background) and **which** image it is, from the content and the image source. 🟢
- Placement works best on fixed-ratio formats (16:9). 🟢
- The layout picker in the editor exposes the same positions: No / Top / Left / Right / Background accent, plus "Suggested layouts" previewed with the card's real content. 🟢
- Inferred: an accent slot is part of each card layout, and image prompts are generated per card from the card's text plus the deck-wide style string. 🟡

### 4.3 Your own images in the input 🟢

Gamma's image URL preprocessor:

1. Scans the input for **bare, whitespace-separated** URLs, inline or on their own line.
2. A URL qualifies only if it is **HTTPS**, its path (before `?`) ends in `.jpg/.jpeg/.png/.gif/.webp/.svg/.heic/.heif/.avif`, and it is **publicly reachable** (no auth, hotlink protection or private IPs).
3. **Markdown-wrapped `![](url)` and HTML `<img>` are skipped by the preprocessor.** Use raw URLs.
4. Gamma **fetches and re-hosts** each image on its CDN during generation, so a URL only has to be live at generation time.
5. A failed fetch is **silently skipped**: no error, no image. A known failure mode: images appear during generation and disappear on refresh because the background re-hosting step failed (hotlink protection, rate limits, expired signed URLs).
6. Add `imageOptions.source: noImages` so Gamma does not add more images next to yours.
7. `additionalInstructions` can say how to show them, for example "group the last 10 images into a gallery".
8. On the agent endpoint, URLs in the prompt are **not guaranteed** to be used.

### 4.4 Image models and costs 🟢

There are about 30 still-image models in four tiers. Credits per image:

| Tier | Credits per image | Models |
|---|---|---|
| Standard | 2–15 | Flux 1 Quick, Flux 2 Fast, GPT Image Mini Low, Ideogram 3 Turbo, Recraft V4, Leonardo Phoenix, … |
| Advanced | 20–33 | Flux 2 Max, Ideogram 3, Nano Banana Flash, GPT Image 2, Dall-E 3, … |
| Premium | 34–75 | Recraft vector (SVG) models, Ideogram 3 Quality, … |
| Ultra | 30–125 | — |

If `imageOptions.model` is omitted, Gamma picks one. Video model ids appear in the OpenAPI enum but **do not generate video** through this field.

### 4.5 Standalone on-brand images (`POST /images`) 🟢

- `type`: `abstract`, `illustration` (default), `photo` or `scene`.
- `sizePreset`: `banner`, `slide`, `social-portrait`, `social-square` (default) or `story`. The preset sets the aspect ratio; exact pixel size is up to the model.
- **`referenceImages` (up to 4)** carry subject semantics ("put this product in the scene") and take precedence over `type` and theme.
- `themeId` brands the colours, except for `scene`, whose curated style ignores the theme (warning `theme_ignored_for_type`).
- Results land in a workspace media library, which can be archived; existing URLs keep working.

### 4.6 Media in the observed decks 🟢

In same-input runs, Gamma kept **one picture per idea**. A figure sat on the card that explains it, and a dense figure was never shrunk next to text below legibility. Earlier hand-deck review rules in this repo (image and points on the same card, a chrome slot that is never empty, no repeated content images) were written to match this behaviour.

---

## 5. Themes, templates and brand 🟢

| | Theme | Template |
|---|---|---|
| What it is | The look: colours, fonts, backgrounds, card styling, logo | A whole gamma used as a starting point (cards, layouts, example content and its theme) |
| Controls | Styling only; the agent still decides structure and writes content | Structure and styling; the content is rewritten from the prompt |
| Parameter | `themeId` | `templateId` (agent), `gammaId` (Classic from-template) |
| Together | Rejected (400). Exception: Classic from-template, where `themeId` replaces the template's theme. | |

- **Agent plus template is prompt-directed.** "Follow this template exactly; only replace the content" keeps card order and layouts; a loose prompt lets the agent add, drop or reorder cards. Classic from-template keeps structure automatically, but accepts only single-page workspace templates within the plan's card limit.
- **Edits never restyle.** The theme is enforced across edits.
- **Header and footer** (Classic `cardOptions.headerFooter`):
  - Six positions: top-left, top-centre, top-right, bottom-left, bottom-centre, bottom-right.
  - Each holds `text` (≤500 characters), `image` (`themeLogo` or a custom URL, sizes `sm`–`xl`) or `cardNumber`.
  - `hideFromFirstCard` and `hideFromLastCard` toggles.
- Gamma 5 claims "thousands" of templates, human-made and machine-generated, plus an Explore gallery. Explore templates are usable as `templateId` only. 🟡

---

## 6. Editing 🟢

### 6.1 Edits through the API and MCP

- `POST /agent/gammas/{id}/edits` takes a prompt of 1–10,000 characters and **edits one page**.
- It can rewrite, add, remove and reorder cards on that page, but **cannot add pages**.
- **One edit runs per gamma at a time** (`409 edit_in_progress`). It needs edit access and does not work on archived gammas.
- A failed edit **may be partially applied** (`edit_failed`, `target_not_found`, `unsupported_target`), so inspect the gamma before retrying.
- Everything the instruction does not mention is preserved: theme, untouched layouts, sharing settings, URL.

### 6.2 Editing in the UI (observed)

- **Scope first.** Toggle between manual and AI editing, then select the whole deck, a card, or a single element (for example "Paragraph · 'Reallocate spend…'"). A small "What should change?" box appears beside the selection, and the chat shows the same scope.
- **The receipt is visual.** Each change comes back as Original / Modified thumbnails with "Compare before & after", "Restore all edits" and "Continue with selection". The changes from one request are accepted or restored as a group.
- **Quick actions** in Classic:
  - Layout: try new layout.
  - Text: improve, fix, translate, longer, shorter, simplify, be more specific.
  - Visual: make more visual, add image, add chart.
  - Whole deck: Research, Refine, Restyle.
- **Styles panel**: themes, fonts, colours, logo, buttons, charts, images, custom CSS-like styling. Style is a layer separate from content.
- Caveat observed: the chat receipt's quoted sentence did not exactly match the rendered text. Treat the canvas as the truth.

---

## 7. Import and export 🟢

- **Import** a `.pptx`, `.potx` or PDF of slides, or a link such as Google Slides through `sourceUrls`:
  - Upload with `POST /uploads`: raw bytes plus `x-harness-upload-name`; ≤250 MiB per file, ≤50 MP per image, 50 files per generation; an unattached upload expires after 2 days; each upload attaches to one generation only.
  - The **prompt decides what happens**:
    - "Import this deck" makes a faithful copy.
    - "…and change slide 7" imports, then edits.
    - "…make it look better" restyles and keeps the content.
    - "Use this deck as a template for…" rewrites the content.
    - "Make a 5-slide summary of this deck" builds a new deck from its content.
  - `purpose: 'import'` marks the deck to import. It cannot be combined with `templateId`, `themeId` or `numCards`.
  - The upload header name `x-harness-upload-name` suggests the agent works on files inside a harness sandbox. 🟡
- **Import fidelity**: the company claims an internal conversion benchmark rose from about 30% to over 97%. 🟡
- **Export** to `pdf`, `pptx` or `png` (a **zip with one PNG per card**):
  - One format per request.
  - The URL is a bearer link (anyone holding it can download) and **expires after about a week**; treat it as a secret.
  - A failed export on a successful generation is a **warning** (`export_failed`), never a failed generation.

---

## 8. API contract summary 🟢

- **Base and auth**: `https://public-api.gamma.app/v1.0`. Auth is an `X-API-KEY` header or OAuth 2.0 Bearer (authorization code flow). The MCP server uses OAuth with DCR.
- **Create → poll → result.** Poll about every 5 s.

| Flavour | Pending | Completed | Failed |
|---|---|---|---|
| Agent | `{generationId, status:'pending', gamma?, progress?{stages,done,total,percent}, warnings:[], updatedTime}` | `{gamma:{gammaId,gammaUrl}, result:{summary}, exportUrl?, warnings[], credits:{deducted,remaining}}` | `{error:{reason, message, statusCode}, gamma?}` |
| Classic | `{generationId, status}` | top-level `gammaId`, `gammaUrl`, `exportUrl`, `credits` | `error` |

Failure reasons on the agent endpoint: `access_revoked`, `generation_failed`, `insufficient_credits`, `invalid_files`, `timeout`, `unavailable`.

- **Warnings** are machine-readable `{code, message}`. Examples: `ignored_folder_id`, `ignored_workspace_access`, `ignored_external_access`, `export_failed`, `no_brand_theme_applied`.
- **Other surface**: themes, folders, full-text search over gammas and templates, `GET /gammas/{id}` metadata, comments (cursor-paginated, with an `updatedSince` delta), archive, delete (admin only), analytics.
- **Analytics**: views, unique viewers and editors, 30-day trend, **per-card view time and reach**, per-viewer detail.
- **MCP-only**: `read_gamma` returns the full content as text (`Title:` …, then `=== Page N: <title> ===`) and `get_gamma_outline` lists stable card ids. A `generationId` can stand in for a gamma id after completion.
- **Limits by plan**:

| | Free | Paid |
|---|---|---|
| Cards per gamma | 10 | 100 |
| Concurrent agent jobs | 2 | 10 |
| `quality: max` | No | Pro and above |
| Analytics | No | Pro and above |

- **Credits**: about 20–60 for 10 cards plus 5 basic images; about 320–1,070 for 20 cards plus 15 premium images.

---

## 9. What this means for the AIMate PPT engine

| Topic | Gamma | AIMate today | Gap or recommendation |
|---|---|---|---|
| Outline = content | Cards carry their final points | Same since the card-outline work (2026-10-22) | Parity; keep it |
| Page count | Content-driven, soft target | Code-statistics presets, exact 6–40 | Parity in spirit; `numCards` maps to an exact length |
| Density | ~1,019 characters per page through composition | 443 median in the 10-06 review; improved since | Keep measuring against the 900–1,100 band at a fixed font size, never by shrinking type |
| Charts and tables | Prompt-steered, non-deterministic | Deterministic native bar and pie charts, tables to metric cards | AIMate is **more predictable**. Keep the deterministic path; it is a differentiator |
| Accent images | Automatic left/right/top/background accents from AI or stock | Template "chrome" slots reuse certified template images; no AI or stock images | 🔴 **Largest media gap.** An optional accent-image provider (themeAccent first, then stock, then AI) behind the existing chrome-slot contract |
| Input image URLs | Bare https URLs fetched and re-hosted; failures skipped | Only embedded PNG/JPEG ≤512 KB; any image reference it cannot embed is a *required* warning that **blocks** generation | Closed for API callers by the compatibility layer (fetch, embed, skip, warn). The in-app paste flow still blocks. Consider a "skip unreachable image" choice in the app |
| Formats | presentation, document, social, webpage; 9 dimensions | 16:9 presentation | Out of scope; reported as warnings or 400s |
| Templates | Theme xor template; template instructions and locked slides | Templates with preserve/mapped modes and keep-fixed objects | Similar. Gamma's **slide-level instructions** are a cheap, useful addition to our template model |
| Editing | Scope-first, one page per edit, grouped accept or restore, visual diff | Proposals, revisions, repair comparison | Close; Gamma's element-scope chip is the UX to copy |
| Queued instructions during build | Yes | Pause and resume | Consider a queued-instruction list |
| Import | PPTX/PDF with a prompt-directed intent | Editable PPTX import; PDF as a source | Prompt-directed import intent is worth adopting |
| Export | pdf, pptx, png-zip; week-long bearer link | pptx, pdf (authenticated) | PNG zip is easy given per-slide SVG previews |
| API and MCP | Full async API, MCP server, analytics | None, until now | **Built**: a Gamma-compatible API subset (below) |
| Analytics | Per-card view time | None | Out of scope for a desktop app |

## 10. Built in this round: a Gamma-compatible API for the AIMate PPT engine

`/api/ppt/gamma/v1.0/…` speaks a subset of Gamma's public contract, so Gamma clients and automation (scripts, n8n, agents) can drive the AIMate engine.

- **Routes**: `POST /generations`, `POST /agent/generations`, the two status polls, `GET /themes`, and signed `files/{id}.pptx|pdf` downloads.
- **Engine stepping**: each poll advances the outline-first engine by one step (plan, then generate). The engine's review stops, such as card facts to edit or unresolved source warnings, come back as `failed` with the engine's own reason and a `gammaUrl` that opens the project in the app.
- **Mapping**:
  - `textMode` sets the input kind and the knowledge policy.
  - `amount` sets the text density.
  - `numCards` sets an exact length, clamped to 6–40 with a warning.
  - `inputTextBreaks` becomes the author outline.
  - Image URLs are fetched with public-host guards and embedded if they are PNG/JPEG ≤512 KB.
  - Anything unsupported is a 400 or a named warning.
- Details: [handover](../handover/ppt-gamma-compat.md).

## 11. Open questions 🔴

1. Gamma's collaboration and sync layer and its card schema: can't be observed through the Cloudflare challenge. A logged-in hands-on session with devtools would answer it.
2. How Gamma picks an accent image's position (left, right, top or background) per card: is it rules or a model? Compare 3 decks with the same content and different themes.
3. Whether "checking" in Gamma's progress is visual (rendered overflow detection) or textual.
4. How the 97% import-fidelity benchmark is scored.

## Sources

- Gamma developer docs: https://developers.gamma.app (llms-full.txt and llms.txt, fetched 2026-11-05)
- Gamma ProseMirror showcase: https://discuss.prosemirror.net/t/showcase-gamma-a-presentation-editor-built-in-prosemirror/4834
- Gamma 5 launch coverage (BornCity): https://borncity.com/news/gamma-5-gamma-tech-stellt-den-groessten-umbau-seiner-praesentationsplattform-vor/
- Gamma 5 announcement (blocked to automated fetch): https://gamma.app/insights/introducing-gamma-5-your-story-your-style-your-tools
- Reversa (spec-format convention used here): https://github.com/sandeco/reversa
- In-repo hands-on research listed in §0
