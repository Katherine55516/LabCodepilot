# Gamma MCP, integrations, errors and limits

> Part of the Gamma reverse-engineering set: [index](README.md)

Scope: the agent and integration side of Gamma (hosted MCP server, OAuth, connectors, custom MCP connectors) and the operational contract every caller has to handle (errors, warnings, limits, pricing, change history). Everything here comes from Gamma's public developer docs (GitBook export `llms-full.txt`, plus the OpenAPI blocks embedded in it), read on 2026-11-05. gamma.app itself sits behind a Cloudflare challenge and was not accessed.

**Markers:** 🟢 confirmed in the docs (citation given) · 🟡 inferred (the evidence is stated) · 🔴 unknown / not documented.

Short citation keys (full URLs in [Sources](#sources)): [mcp-setup], [mcp-ref], [own-agent], [oauth], [pricing], [integrations], [custom-mcp], [errors], [warnings], [limits], [polling], [image-models], [languages], [changelog], [explore], [migrate], [import], [uploads], [agent-create], [agent-status], [agent-edit], [edit-status], [classic-create], [gen-text], [gen-template], [templates-wf], [images], [export-status], [analytics-viewers], [help], [docs-home].

---

## 1. MCP server

### 1.1 Endpoint, transport and discovery

| Item | Value | Marker |
|---|---|---|
| Server URL | `https://mcp.gamma.app/mcp` | 🟢 [mcp-setup] |
| Transport | Remote MCP server over **streamable HTTP** (step 1 of "Connect and verify") | 🟢 [own-agent] |
| Protected-resource metadata | `GET /.well-known/oauth-protected-resource` on the MCP server (RFC 9728) | 🟢 [mcp-ref] |
| 401 challenge | `WWW-Authenticate: Bearer resource_metadata="https://<server>/.well-known/oauth-protected-resource"`; a token whose Gamma access was revoked gets the same 401 | 🟢 [mcp-ref] |
| Client registration | RFC 7591 Dynamic Client Registration. The registration endpoint is discovered from the authorization-server metadata. There are **no static client IDs** | 🟢 [mcp-ref], [own-agent] |
| Grant | OAuth 2.0 with PKCE (the authorization-code grant is named on the REST OAuth page) | 🟢 [mcp-setup], [oauth] |
| Auth header | `Authorization: Bearer <token>` on every request | 🟢 [mcp-ref] |
| `tools/list` caching | Responses carry `ttlMs: 60000` and `cacheScope: "private"`. Hosts that support SEP-2549 may cache the per-user tool list for up to 60 s | 🟢 [mcp-ref] |
| Plan availability | All Gamma plans, including Free. The analytics tools need Pro or above | 🟢 [mcp-setup], [pricing] |
| Credits | Generations, edits and images cost credits the same way as on the REST API. Reading, searching and exporting are free | 🟢 [mcp-setup], [own-agent] |
| Cheap health check | `get_themes` or `get_folders`: they return quickly and cost nothing | 🟢 [own-agent] |

### 1.2 Redirect URI allowlist and requesting access

- 🟢 DCR succeeds only if **every** redirect URI the client sends matches a pattern Gamma has allowlisted. Most patterns are HTTPS callbacks on the client's own hostname. A few app deep-link and loopback (`http://localhost:<port>`) patterns exist for onboarded desktop tools, with Cursor and Gemini CLI named as examples. Loopback redirects require PKCE [mcp-setup].
- 🟢 Clients that are already onboarded (the first-party connectors plus "a number of developer tools and agent platforms") connect with no setup. A redirect-URI error at registration means the client has not been onboarded yet [mcp-setup], [own-agent].
- 🟢 To get access, fill in the "Request MCP Access" Google Form: name, email, company, use case, the exact OAuth redirect URIs (local and production), and a consent-page logo (SVG/PNG/JPEG, 256×256 px). The Gamma team reviews each request and registers the URIs by hand [mcp-setup], [own-agent].
- 🟢 Loopback URIs for local development are rejected unless your client's loopback pattern is allowlisted [mcp-setup].
- 🟢 While you wait, the docs suggest prototyping on the REST API with an API key (any plan). Most tools have a REST equivalent, but `read_gamma` exists only on MCP [mcp-setup].
- 🟡 This means Gamma's DCR is "open registration, closed redirect set": the endpoint accepts any client, but a policy layer checks redirect URIs against a per-client-pattern allowlist. Evidence: [oauth] says REST DCR needs "no approval process", while [mcp-setup] says MCP clients must be registered first. Whether the two share one authorization server with different policies per resource is 🔴.

### 1.3 Consent and the workspace binding

- 🟢 On first connection the user signs in, **picks a workspace**, and approves the permissions on the consent screen. Every tool call then runs as that user in that workspace, and credits and access checks follow that user [mcp-setup], [own-agent].
- 🟢 The consent screen lists four permissions: create gammas in your workspace; read gammas in your workspace; list folders; list themes [mcp-ref].
- 🟡 The consent text does not mention editing, exporting, comments or analytics, even though tools for all of these exist. Either one coarse grant (the REST `generate` scope, see §3) covers them, or the consent copy is out of date. Evidence: the REST `generate` scope is described as "full API access" [oauth].
- 🟢 Troubleshooting: for auth errors, disconnect and reconnect the connector; for connection problems, make sure the user is logged into both the AI assistant and Gamma [mcp-setup].

### 1.4 Supported clients and surfaces

| Client | How it connects | Notable behavior | Marker |
|---|---|---|---|
| ChatGPT (Gamma app, "Gamma: Create presentations and docs") | ChatGPT Settings → Apps / app directory → Connect → OAuth, choose workspace | Invoke with `@Gamma` or via **+ → More**. A `@Gamma` title picker (≥3 chars, up to 10 results, newest first; fewer than 3 chars shows recent gammas) is backed by the app-only tool `mention_gammas`. `get_gamma_embed_urls` (app-only) feeds the Gamma panel's page view. OpenAI reviews each app update, so features can lag | 🟢 [mcp-setup], [mcp-ref], [integrations] |
| Claude (connector) | claude.ai Settings → Connectors → Browse → "Gamma" → Connect → Allow, choose workspace | Can edit gammas (since 2026-10-05) | 🟢 [integrations], [changelog] |
| Slack (Gamma app) | gamma.app/slack → Add to Slack → authorize → link Gamma account | DM or `@Gamma`; uses thread context; standalone images with up to 4 reference images attached to the same message (PNG, JPEG, GIF, WebP, HEIC, HEIF, AVIF; earlier thread images are not used); generate from templates; status and export; link unfurls (only for gammas you can access); reply to comment notifications. **No edit tools yet** | 🟢 [integrations] |
| Superhuman Go (agent) | Agent Store → Gamma → Try agent → authorize | Cannot share outside the workspace: on generate tools the server ignores `emailOptions` and `publish`, forces `externalAccess` to `noAccess`, and says so in `warnings` when a setting is ignored | 🟢 [integrations], [mcp-ref] |
| Atlassian Rovo | An org admin adds an external MCP server ("Gamma" from the gallery) under Atlassian Administration → Apps → Sites → Connected apps | Once added, every user on the site gets Gamma skills in Rovo and Rovo Studio | 🟢 [integrations] |
| Codex | Named only in the "OpenAI reviews updates" caveat | Setup is not documented | 🟢 mention [mcp-setup] / 🔴 setup |
| Cursor, Gemini CLI | Onboarded desktop tools with allowlisted loopback/deep-link redirects | Setup steps are not documented | 🟢 [mcp-setup] |
| Custom agent / harness | Add the URL as a streamable-HTTP server; DCR + PKCE; redirect URIs registered first | Sees the full public tool set (not the ChatGPT-only tools) | 🟢 [own-agent] |

### 1.5 MCP Apps widgets

| Widget | Behavior | Marker |
|---|---|---|
| Generation widget (live progress) | While an agent generation (`gen_` ID) is `pending`, clients that support MCP apps show live card progress in a widget fed by `get_generation_status`. That progress goes **only to the widget**, not into the tool result. Code that needs progress should use REST `GET /agent/generations/{id}` | 🟢 [mcp-ref] |
| Generation widget (completed preview) | When done, it can show the whole gamma in an embedded, interactive preview with an **Edit in Gamma** action. The preview link is short-lived, tied to the signed-in user, and goes only to the widget. Rollout is gradual per client; the fallback is a preview image plus a link | 🟢 [mcp-ref] |
| Analytics widget | `get_gamma_analytics` renders an interactive widget in MCP-apps clients and also returns structured data plus a formatted text summary | 🟢 [mcp-ref] |
| ChatGPT Gamma panel | `get_gamma_embed_urls` returns short-lived embed links in the result `_meta`, never in `content`/`structuredContent`, so the model never sees them. Each call returns fresh links | 🟢 [mcp-ref] |
| 🟡 Delivery channel | The live progress and preview links probably use the same `_meta` channel that is documented for `get_gamma_embed_urls`. Evidence: the same "goes only to the widget, not part of the tool result" wording | 🟡 |

### 1.6 MCP vs REST

| | MCP | REST | Marker |
|---|---|---|---|
| Who chooses calls | The agent, at runtime | Your code | 🟢 [own-agent] |
| Auth | OAuth + DCR, any plan | API key (any plan) or OAuth | 🟢 [own-agent] |
| Read a gamma's full content | `read_gamma` | Not available | 🟢 [own-agent] |
| Archive / delete | Not available | `POST /gammas/{id}/archive`, `DELETE /gammas/{id}` | 🟢 [own-agent] |
| Webpages / multi-page | `generate_multi_page_gamma` | Classic `POST /generations` with `pages` | 🟢 [own-agent] |
| Archive media image | Not available | `POST /images/media/{savedMediaId}/archive` | 🟢 [limits] |
| Upload files / import a deck | Not documented as an MCP tool | `POST /uploads` + `files` on agent generation | 🟢 REST [import] / 🔴 MCP |

---

## 2. MCP tools

### 2.1 Full tool table

The read-only, destructive and idempotent flags come from Gamma's own overview table [mcp-ref]. "Async" means the tool returns a job ID that a `get_*_status` tool resolves.

| Tool | Purpose | RO | Destr. | Idem. | Async | Key params (type, req) | Returns | Marker |
|---|---|---|---|---|---|---|---|---|
| `generate` | New presentation/doc/webpage/social from scratch | No | No | No | Yes | `inputText` str **req**; `title`, `textMode`, `format`, `numCards`, `cardSplit`, `themeId`, `folderId`, `additionalInstructions`, `exportAs`, `quality`, `textOptions`, `imageOptions`, `cardOptions`, `sharingOptions` | `generationId`, `status: pending`, `gammaUrl?`, `warnings` (string) | 🟢 [mcp-ref] |
| `generate_multi_page_gamma` | One gamma with several pages under one URL | No | No | No | Yes | `pages[]` (1–50) **req**; `title`, `publish`, `themeId`, `folderId`, `cardOptions`, `sharingOptions`, `exportAs` | `generationId`, `status`, `gammaUrl`, `pages[]`, `warnings` | 🟢 [mcp-ref] |
| `generate_from_template` | New gamma from a workspace template | No | No | No | Yes | `gammaId` str **req**, `prompt` str **req**; `title`, `themeId`, `imageOptions`, `sharingOptions`, `folderId`, `exportAs`, `quality` | `generationId`, `status`, `gammaUrl`, `warnings` | 🟢 [mcp-ref] |
| `get_generation_status` | Poll any of the three generate tools | Yes | No | Yes | — | `generationId` str **req** (ID or `/generations/` URL) | `status`, `gammaUrl`, `exportUrl`, `credits.*`, `warnings`, `error` | 🟢 [mcp-ref] |
| `generate_image` | One standalone image | No | No | No | Yes | `prompt` str **req** (1–5,000); `type`, `sizePreset`, `themeId`, `referenceImages[]` (≤4) | `imageGenerationId`, `status`, `warnings[]`, `generatedTime`, `mediaLibraryUrl` | 🟢 [mcp-ref] |
| `get_image_generation_status` | Poll the image job | Yes | No | Yes | — | `imageGenerationId` str **req** | `status`, `image{url,width,height,aspectRatioUsed,savedMediaId}`, `warnings[]`, `error`, `retryable`, `errorStatusCode`, `credits.*`, `mediaLibraryUrl` | 🟢 [mcp-ref] |
| `export_gamma` | Export to PDF/PPTX/PNG-zip | No | No | No | Yes | `gammaIdOrUrl` str **req**, `exportAs` enum **req** | `exportId`, `status`, `gammaId`, `exportAs` | 🟢 [mcp-ref] |
| `get_export_status` | Poll the export | Yes | No | Yes | — | `exportId` str **req** | `status`, `gammaId`, `exportAs`, `exportUrl`, `error`, `reason` | 🟢 [mcp-ref] |
| `edit_gamma` | Natural-language edit of an existing gamma | No | **Yes** | No | Yes | `gammaIdOrUrl` str **req**, `prompt` str **req** (1–10,000); `disableConnectors` bool, `quality` enum | `editId`, `status`, `gammaUrl` | 🟢 [mcp-ref] |
| `get_edit_status` | Poll the edit | Yes | No | Yes | — | `editId` str **req** | `status`, `gammaUrl`, `summary`, `error`, `reason` | 🟢 [mcp-ref] |
| `get_gammas` | Browse/search by title, incl. templates | Yes | No | Yes | — | `query` (≥3 chars), `type`, `limit` (25/50), `createdByMe`, `after` | `gammas[]`, `hasMore`, `nextCursor` | 🟢 [mcp-ref] |
| `search_gammas` | Full-text search of title and body | Yes | No | Yes | — | `q`, `createdBy`, `updatedAfter`, `updatedBefore`, `includeArchived`, `limit` (10/25) | `hits[]` | 🟢 [mcp-ref] |
| `search_templates` | Workspace + official Explore templates | Yes | No | Yes | — | `q` (≤2,000 chars), `limit` (10/25 per list) | `workspaceTemplates[]`, `exploreTemplates[]` | 🟢 [mcp-ref] |
| `read_gamma` | Full human-readable content | Yes | No | Yes | — | `gammaIdOrUrl` str **req** | Formatted text | 🟢 [mcp-ref] |
| `get_gamma_outline` | Pages and cards with stable IDs (gradual rollout) | Yes | No | Yes | — | `gammaIdOrUrl` str **req** | `gammaId`, `title`, `requestedPageId`, `pages[].cards[]` | 🟢 [mcp-ref] |
| `get_gamma_comments` | Comment threads and replies | Yes | No | Yes | — | `gammaIdOrUrl` **req**; `limit` (50/50), `after`, `updatedSince`, `includeArchived` | `comments[]`, `hasMore`, `nextCursor` | 🟢 [mcp-ref] |
| `get_gamma_analytics` | Engagement summary (Pro+) | Yes | No | Yes | — | `gammaIdOrUrl` **req** | totals + 30-day `dailyViews` | 🟢 [mcp-ref] |
| `get_gamma_card_analytics` | Per-card engagement (Pro+) | Yes | No | Yes | — | `gammaIdOrUrl` **req** | `cards[]` | 🟢 [mcp-ref] |
| `get_gamma_viewer_analytics` | Viewer list (Pro+) | Yes | No | Yes | — | `gammaIdOrUrl` **req**; `limit` (25/50), `after`, `sortDirection` | `viewers[]`, `hasMore`, `nextCursor` | 🟢 [mcp-ref] |
| `get_gamma_viewer_detail_analytics` | One viewer's detail (Pro+) | Yes | No | Yes | — | `gammaIdOrUrl` **req**, `userId` **req** | per-card time share, `scope` | 🟢 [mcp-ref] |
| `get_themes` | Theme library | Yes | No | Yes | — | `name` optional | `themes[]`, `count` | 🟢 [mcp-ref] |
| `get_folders` | User's folders | Yes | No | Yes | — | `name` optional | `folders[]`, `count` | 🟢 [mcp-ref] |
| `mention_gammas` | ChatGPT @-mention picker (app-only; the model never calls it) | Yes | — | — | — | not documented | not documented | 🟢 exists [mcp-ref] / 🔴 schema |
| `get_gamma_embed_urls` | ChatGPT Gamma panel embed links (app-only) | Yes | — | — | — | `gammaIdOrUrl` (generation ID OK) | links in `_meta` only | 🟢 [mcp-ref] |

- 🟢 Conditional tools: `edit_gamma`/`get_edit_status` appear only when editing is available for the connected account. `get_gamma_outline` appears only where it is enabled. Clients should check the tool list before offering these features [mcp-ref].
- 🟡 The tool list is assembled per user and per client: it carries a private cache scope, has feature-gated tools, and registers some tools for ChatGPT only. Evidence: `cacheScope: "private"`, the conditional tools, and the client-specific `mention_gammas`/`get_gamma_embed_urls` [mcp-ref].

### 2.2 `generate`

- 🟢 `inputText` (req): a brief prompt, outline or full draft. Pass **the user's own material, not a slide-by-slide rewrite** of it [mcp-ref].
- 🟢 `title`: 1–500 chars, inferred if omitted [mcp-ref].
- 🟢 `textMode` `generate|condense|preserve`. Use `preserve` only when the user asked to keep their wording or supplied finished slide-by-slide text, **not for text the AI tool wrote or rewrote**. A pasted document, report or notes counts as source material. Agent generations still resolve bracketed notes such as `[TBD]` under `preserve` [mcp-ref], [migrate].
- 🟢 `format` `presentation|document|social|webpage`. Some generations reject `webpage`; the error then says to retry with a different format [mcp-ref].
- 🟢 `numCards` int; `cardSplit` `auto|inputTextBreaks`. Use `inputTextBreaks` only when the user wrote their text slide by slide or asked for one card per section, **not for breaks the AI tool added** [mcp-ref].
- 🟢 `themeId` from `get_themes`. For a brand look, pass one only if the user named a theme or a custom theme exists for the brand. Otherwise omit it and name the brand in `additionalInstructions` [mcp-ref].
- 🟢 `folderId` from `get_folders`. `folderIds` is deprecated (at most one entry; `folderId` wins) [mcp-ref].
- 🟢 `additionalInstructions`: what the user asked for beyond the content, **in their own words** (brand look, style, audience, purpose, how to handle `[TBD]`, layout guidance). **Keep it out of `inputText`** [mcp-ref].
- 🟢 `exportAs` `pptx|pdf|png` (png = `.zip` with one PNG per card) [mcp-ref].
- 🟢 `quality` `lite|standard|max`: applies to agent generations only. Other generations ignore it and say so in `warnings`. Omit it to get the plan default. A preset the plan lacks fails as a plan-limit failure [mcp-ref].
- 🟢 `textOptions`: `amount` (`brief|medium|detailed|extensive`), `tone`, `audience`, `language` (codes per [languages]; default `en`) [mcp-ref], [languages].
- 🟢 `imageOptions`: `source` (`aiGenerated|webAllImages|webFreeToUse|webFreeToUseCommercially|pictographic|giphy|pexels|themeAccent|placeholder|noImages`), `model` (REST model IDs), `stylePreset` (`photorealistic|illustration|abstract|3D|lineArt|custom`), `style` [mcp-ref].
- 🟢 `cardOptions`: `dimensions` (`16x9|4x3|fluid|letter|a4|pageless|1x1|4x5|9x16`) and `headerFooter`. The six slots (`topLeft`…`bottomRight`) each take `{type: cardNumber|image|text, source: themeLogo|custom, src, value, size: sm|md|lg|xl}`, plus the flags `hideFromFirstCard` and `hideFromLastCard` [mcp-ref].
- 🟢 `sharingOptions`: `workspaceAccess` (`edit|comment|view|noAccess|fullAccess`), `externalAccess` (`edit|comment|view|noAccess`), `emailOptions{recipients[] req, access req}` [mcp-ref].
- 🟢 Docs tips for end users: be specific about structure, describe the style, name the brand (Gamma applies it itself), say "use my slide text as written" to keep wording, give format and density, name folders, ask for exports [mcp-setup].
- 🟡 One `generate` tool is served by **two engines**, the Gamma 5 agent (`gen_` IDs) and Classic. Evidence: `quality` "applies to agent generations only", agent generations omit `credits`, `[TBD]` handling is "agent generations" behavior, and "some generations do not support webpage" [mcp-ref]. The routing rule is 🔴.

### 2.3 `generate_multi_page_gamma`

- 🟢 For sales rooms, proposal sites, onboarding portals and microsites. For a single deck, prefer `generate`. This tool cannot edit an existing gamma [mcp-ref].
- 🟢 Per-page `pages[]` entries take: `inputText` (req), `title`, `path` (slug; honored only for pages after the first, otherwise derived from the title), `additionalInstructions`, `textMode`, `format`, `numCards`, `cardSplit`, `textOptions`, `imageOptions`. File-wide settings: `title`, `publish`, `themeId`, `folderId`, `cardOptions`, `sharingOptions`, `exportAs` [mcp-ref].
- 🟢 `publish: true` publishes a live multi-page site on a Gamma-generated subdomain **once all pages succeed** (ignored for Superhuman Go) [mcp-ref].
- 🟢 Output `pages[]` holds a per-page `gammaId`, `gammaUrl`, `status`, and `error`/`exportUrl` [mcp-ref].
- 🟢 It runs on Classic generation, matching REST `POST /generations` with `pages` [own-agent].

### 2.4 `generate_from_template`

- 🟢 `gammaId` must be a workspace template: a `get_gammas` hit with `type: template`, a `search_templates` `workspaceTemplates` hit, or a user-supplied ID. **IDs from `exploreTemplates` are rejected**; use them as `templateId` on REST `POST /agent/generations` instead [mcp-ref].
- 🟢 `prompt`: the user's own content and request. New material is included **verbatim, not summarized**. Do not pick cards or layouts or write final card copy. **Pass the user's wording through as-is** when they name a layout or slide or give a length ("a quick deck", "5 slides") [mcp-ref].
- 🟢 `themeId` is not supported when the tool runs as an agent generation: the call fails before generating and asks you to retry without it, or to use `generate` + `themeId`. Such failures carry no `themeNotFound` [mcp-ref].
- 🟢 `imageOptions` here only takes `model` and `style` [mcp-ref].
- 🟢 This tool is the MCP form of `POST /agent/generations` with `templateId`: the template is pinned as the starting point, and its template instructions (including locked slides) apply [own-agent], [templates-wf].
- 🟢 Eligibility is checked at generation time. Multi-page, site-bound, archived, non-template and Explore IDs are rejected; when that happens, try another `workspaceTemplates` hit [mcp-ref], [own-agent].

### 2.5 `get_generation_status`

- 🟢 Accepts the ID or the `/generations/` URL. `gen_`-prefixed IDs are agent generations [mcp-ref].
- 🟢 Output: `status` (`pending|completed|failed`), `gammaUrl`, `exportUrl` (about 1 week; treat as a secret), `credits.deducted`/`credits.remaining` (**omitted for `gen_` IDs**), `warnings` (one per line), `error` [mcp-ref].
- 🟢 Rules for using a generation ID in place of a gamma ID [mcp-ref]:

| Case | Result | Marker |
|---|---|---|
| Completed generation | Its `generationId` or `/generations/<id>` URL can be passed as `gammaIdOrUrl` to `read_gamma`, `get_gamma_outline`, `edit_gamma`, `export_gamma` | 🟢 |
| Comment and analytics tools | Do **not** accept generation IDs | 🟢 |
| Still `pending` | Error: check `get_generation_status` (a few seconds apart, not a tight loop), then retry the same call once it is `completed` | 🟢 |
| `failed` | Error carrying the generation's failure message | 🟢 |
| Multi-page generation | Error listing each page's `gammaId`/`gammaUrl`; call again with one page's ID | 🟢 |
| Lookup order | A plain `gen_` token is looked up as a generation. Any other plain token is tried as a gamma file ID first and as a generation only if no accessible gamma matches; otherwise the original `404 Not found` | 🟢 |

### 2.6 `edit_gamma` / `get_edit_status`

- 🟢 Reword, restructure, add, remove, reorder and rewrite cards **within one page** (the page in the URL, or the main page). It **cannot add pages**. Requires edit access; archived gammas are refused [mcp-ref].
- 🟢 One edit per gamma at a time; wait for `completed`/`failed` before starting another. Do not call `edit_gamma` again to check progress, because that starts a new edit [mcp-ref].
- 🟢 `disableConnectors: true` keeps the edit away from workspace connectors (Notion, Slack, …) [mcp-ref].
- 🟢 `get_edit_status` returns `summary` on completion. Failure `reason` is one of `target_not_found | unsupported_target | access_revoked | insufficient_credits | timeout | unavailable | edit_failed` [mcp-ref].
- 🟢 The REST `EditError` notes that a failed edit **may have been partially applied**, so inspect the gamma before retrying (OpenAPI on [edit-status]).
- 🟢 The only object-level addressing is the prompt; there is no API for targeting specific slide elements [limits].
- 🟢 Slack does not expose the edit tools yet; ChatGPT and Claude do [integrations].

### 2.7 `export_gamma` / `get_export_status`

- 🟢 Any non-archived gamma the user can view in the connected workspace. Do not re-call `export_gamma` to poll, because each call starts a new export [mcp-ref].
- 🟢 `exportUrl` lives about a week; anyone holding it can download the file, and access is not tied to the key [mcp-ref], [limits].
- 🟢 Failure `reason` values: `render_timeout`, `deck_too_large`, `no_content`, `export_failed`. Per the REST `ExportError`, `render_timeout` and `export_failed` are transient (safe to retry); `deck_too_large` and `no_content` need a changed input (OpenAPI on [export-status]).

### 2.8 `generate_image` / `get_image_generation_status`

- 🟢 `type`: `illustration` (default), `scene`, `photo`, `abstract`. `sizePreset`: `social-square` 1:1 (default), `social-portrait` 4:5, `story` 9:16, `banner` 16:9, `slide` 16:9. The model picks the exact pixels [mcp-ref].
- 🟢 `referenceImages`: up to 4 `{url (https, req), role: "subject"}`. When present, they override `type` and `themeId` [mcp-ref].
- 🟢 Never re-call `generate_image` to poll: that starts a new, **separately billed** generation [mcp-ref].
- 🟢 `retryable` (on failure) says whether retrying the same request could succeed. Invalid input such as an unknown `themeId` or a blocked reference URL is not retryable. `errorStatusCode` carries the underlying HTTP status [mcp-ref].
- 🟢 Images are saved to the media library. `{mediaLibraryUrl}/{savedMediaId}` deep-links one image and stays valid after the job ages out of the status endpoint, so it is the durable link [mcp-ref].

### 2.9 Read and browse tools

- 🟢 `get_gammas`: `query` is title-only (min 3 chars). Keep `query`/`type` fixed while paginating with `after`. `createdByMe: true` excludes shared and collaborated gammas. `thumbnailUrl` is signed and lasts about 7 days [mcp-ref].
- 🟢 `search_gammas` maps to `GET /gammas/search`. Omit `q` and set at least one of `createdBy`/`updatedAfter`/`updatedBefore` to browse by last-updated (descending). Hits carry a `highlight` snippet and `createdBy` (name or email). It may fail with service-unavailable when search is down; retry later [mcp-ref].
- 🟢 `search_templates`: two lists. Only `workspaceTemplates[].id` works with `generate_from_template`; `exploreTemplates[].id` works as REST `templateId` or as a link via `url` [mcp-ref].
- 🟢 `read_gamma` returns formatted text: `Title: …` followed by `=== Page N: <title> ===` blocks covering text, images, videos, embeds, charts, tables and diagrams. No raw HTML or JSON. Archived gammas cannot be read [mcp-ref].
- 🟢 `get_gamma_outline` returns both `structuredContent` (matching `outputSchema`) and the same JSON as text. Cards carry `index` (0-based, **counts hidden cards**), `slideNumber` (visible cards only, from 1; `null` when hidden), `hidden`, `title` (first heading) and `textPreview` (≤200 chars). To resolve "slide 3", use the card whose `slideNumber` is 3. `requestedPageId` is set when the input pointed at a page [mcp-ref].
- 🟢 `get_gamma_comments` lists oldest activity first. `updatedSince` supports delta polling. `includeArchived` flags deleted items. `cardId` is `null` for page-level comments [mcp-ref].
- 🟢 `get_themes`: if the user names a theme, search by name; otherwise fetch everything and choose by `colorKeywords`/`toneKeywords`. `type` is `standard|custom` [mcp-ref].
- 🟢 `get_folders`: returns `{id, name}`. Since 2026-09-10, placing a gamma in a folder needs edit or full access to that folder [mcp-ref], [changelog].

### 2.10 Analytics tools

| Tool | Default use | Output highlights | Marker |
|---|---|---|---|
| `get_gamma_analytics` | **Default** when a user asks how a gamma is performing; renders a widget | `totalViews` (includes repeats), `uniqueViewers` (auth + anon), `uniqueEditors`, `cardCount`, `lastOpened`, `dailyViews{dayCount,timezone,days[{date,uniqueViewers}]}` (30-day) | 🟢 [mcp-ref] |
| `get_gamma_card_analytics` | Best cards / drop-off | Every card in order: `cardId`, `cardName`, `cardPosition` (1-based), `viewTimeSeconds`, `viewersPercent` | 🟢 [mcp-ref] |
| `get_gamma_viewer_analytics` | Who saw it / find a person | `viewers[]` with `viewerId`, `displayName`/`email` (`null` if anonymous), `lastOpened`, `cardsViewed`. To find a person, scan pages and pass the matching `viewerId` as `userId` to the detail tool | 🟢 [mcp-ref] |
| `get_gamma_viewer_detail_analytics` | One person's engagement | `scope` (`all` = manage, `self` = edit only), `perCardTimeSpent[].viewTimePercent` (0 for unviewed). Anonymous viewers return 404 | 🟢 [mcp-ref] |

- 🟢 All four need Pro+ and at least edit permission. Manage permission shows all viewers; edit-only shows just the caller's own activity. Data is eventually consistent and can lag about an hour [mcp-ref].
- 🟢 REST caps viewer analytics at 500 viewers in total [explore], [analytics-viewers].
- 🟢 **Plan denial guidance:** on a plan without analytics, the four tools return the API's explanation in `error` plus a `guidance` field telling the model that analytics are unavailable on this plan and that **changing Gamma access permissions will not help**. REST returns `403` `code: individual_analytics_required` for the same case [mcp-ref].

### 2.11 MCP error envelope and plan-limit failures

- 🟢 Every tool error looks like `{ "error": "...", "isError": true }` [mcp-ref].

| MCP error | Meaning | Handling | Marker |
|---|---|---|---|
| `401 Unauthorized` | Missing, expired or revoked Bearer token | Re-authorize via `resource_metadata` | 🟢 [mcp-ref] |
| `403 Forbidden` | User lacks access to the gamma or workspace resource | Share the gamma or connect as a user who has access; it is "working correctly" | 🟢 [mcp-ref], [own-agent] |
| `404 Not found` | Gamma, generation or resource not found | Check the ID (see §2.5 lookup order) | 🟢 [mcp-ref] |
| `400 Bad request` | Invalid parameters | The assistant usually retries with corrected values | 🟢 [mcp-ref], [mcp-setup] |
| `Rate limit exceeded` | Too many requests | Back off (no MCP-specific header documented) | 🟢 [mcp-ref] / 🔴 header |
| `Network connectivity` | Cannot reach the server | Retry | 🟢 [mcp-ref] |
| `Insufficient credits` | Not enough credits for the generation | Buy credits at Settings › Billing or upgrade [mcp-setup]; add credits or enable auto-recharge [own-agent] | 🟢 [mcp-ref], [mcp-setup], [own-agent] |

- 🟢 **Plan-limit failures** apply to `generate`, `generate_from_template`, `generate_multi_page_gamma`, `generate_image`, `get_image_generation_status`, `edit_gamma` and `export_gamma`. Triggers: insufficient credits, `numCards` above the plan maximum, **more `inputTextBreaks` than the plan allows**, image models or reference images outside the plan, and a `quality` outside the plan [mcp-ref]. The failed result carries:

| Field | Content | Marker |
|---|---|---|
| `planLimitExceeded` | `true` | 🟢 [mcp-ref] |
| `currentPlanLimits` | **Live** limits read at failure time: `workspace`, `planTier` (`free` or highest paid of `plus|pro|ultra|team|business|enterprise`), `creditsRemaining`, `maxGenerateCards`, `availableImageModels[]`, `availableQualities[]`. `creditsRemaining` and `availableQualities` may be absent; the whole object is omitted if the lookup fails | 🟢 [mcp-ref] |
| `upgradeUrl` | `https://gamma.app/settings/billing?source=mcp` (example) | 🟢 [mcp-ref] |
| `guidance` | Tells the model to report the limit, offer a retry at `maxGenerateCards`, offer a preset from `availableQualities`, and retry after an upgrade (the API validates against the live plan) | 🟢 [mcp-ref] |

- 🟢 **Unknown theme:** `themeNotFound: true`, `guidance`, and `validThemes` (≤100 `{id,name}`; omitted if the lookup fails). Pick the closest one, search with `get_themes`, or omit the theme (templates keep their own theme; other tools fall back to the workspace default). "Only pass theme IDs returned by the API" [mcp-ref].

---

## 3. OAuth for the REST API

| Item | Value | Marker |
|---|---|---|
| Flow | OAuth 2.0 authorization code + PKCE (S256), plus DCR (RFC 7591), AS metadata (RFC 8414), PRM (RFC 9728), Resource Indicators (RFC 8707), refresh-token rotation | 🟢 [oauth] |
| Not OIDC | No `/.well-known/openid-configuration`, ID tokens or userinfo. Do not use it as "Sign in with Gamma" | 🟢 [oauth] |
| Protected-resource metadata | `https://public-api.gamma.app/.well-known/oauth-protected-resource` | 🟢 [oauth] |
| AS metadata | `https://auth.gamma.app/.well-known/oauth-authorization-server` | 🟢 [oauth] |
| Register | `POST https://auth.gamma.app/oauth/register`: no approval, credentials returned immediately. Register once per app, not per user | 🟢 [oauth] |
| Authorize | `GET https://auth.gamma.app/oauth/authorize` with `client_id`, `redirect_uri`, `response_type=code`, **`resource=https://public-api.gamma.app`**, `scope`, `state`, `code_challenge`, `code_challenge_method=S256` | 🟢 [oauth] |
| Token | `POST https://auth.gamma.app/oauth/token` (form-encoded). Grants: `authorization_code`, `refresh_token` | 🟢 [oauth] |
| JWKS | `https://auth.gamma.app/.well-known/jwks.json` | 🟢 [oauth] |
| API base | `https://public-api.gamma.app/v1.0/...` | 🟢 [oauth] |
| Client auth | `none` (public: SPA/CLI/desktop/mobile), `client_secret_basic` (default), `client_secret_post` | 🟢 [oauth] |
| Scopes | `generate` (full: generations, edits, exports, themes, folders, reads; default). `gamma:read` (metadata only: title, thumbnail, author, timestamps; for link previews; spends no credits; `403 insufficient_scope` elsewhere) | 🟢 [oauth] |
| Access token | `expires_in: 3600` (about 1 h); example value starts `eyJ` | 🟢 [oauth] |
| Refresh token | Rotates on every use (the old one is invalidated); lives up to 90 days; example prefix `gamma_refresh_` | 🟢 [oauth] |
| Auth codes | Single-use, short-lived | 🟢 [oauth] |
| Binding | One user + one workspace per authorization; repeat the flow for each workspace | 🟢 [oauth] |
| Billing | Credit-spending calls consume the **authorizing user's** credits in the chosen workspace. Reads are free | 🟢 [oauth], [pricing] |

Step order 🟢 [oauth]: (1) register → (2) redirect the user, who signs in, **selects a workspace** and consents → callback with `code` and `state` (verify `state`) → (3) exchange the code with `code_verifier` → (4) call the API with `Authorization: Bearer` → (5) refresh before expiry and persist the rotated token atomically.

| Error | Where | Meaning | Action | Marker |
|---|---|---|---|---|
| `401 invalid_token` | API | Token missing, expired, malformed or **wrong audience** | Refresh once and retry; if that fails, re-authorize | 🟢 [oauth] |
| `403 insufficient_scope` | API | Scope does not cover the endpoint | Request the right scope | 🟢 [oauth] |
| `400 invalid_grant` / `invalid_target` | authorize/token | Bad or expired code, PKCE mismatch, unsupported `resource` | Fix `resource` and PKCE | 🟢 [oauth] |

- 🟢 Best practices: PKCE even for confidential clients; minimum scope; serialize refreshes across workers; store tokens server-side; cache until near `expires_in`; show which workspace is connected [oauth].
- 🟡 Access tokens are JWTs signed with keys published at the JWKS URL. Evidence: the `eyJ…` sample token and the JWKS endpoint. Whether resource servers verify them locally or via introspection is 🔴.
- 🟡 Omitting `resource` is "the most common integration mistake" because the audience claim is enforced per resource. The MCP server likely receives tokens with its own audience (it publishes its own PRM). Which audience MCP tokens carry is 🔴.

---

## 4. Integrations

### 4.1 Connector and automation matrix

| Platform | Auth | Plan | What it supports | Marker |
|---|---|---|---|---|
| ChatGPT app | OAuth (MCP) | Any | Generate, templates, read, comments, analytics, export and edit; @-mention picker; Gamma panel. Features can lag while OpenAI reviews app updates | 🟢 [integrations], [mcp-ref], [mcp-setup] |
| Claude connector | OAuth (MCP) | Any | Generate etc.; edit since 2026-10-05. Template browsing and status "may be available depending on the platform" | 🟢 [integrations], [changelog] |
| Slack app | Slack install + Gamma sign-in | Any | Generate from DM/@mention/thread context, images with references, templates, status/export, link previews, comment replies. **No edit** | 🟢 [integrations] |
| Superhuman Go | Agent Store authorization | Any | Generate presentations/docs/social/webpages from emails and notes; external sharing forced off | 🟢 [integrations], [mcp-ref] |
| Atlassian Rovo | Org admin adds the external MCP server | Any | Gamma skills in Rovo agents and Rovo Studio from Jira/Confluence context | 🟢 [integrations] |
| Zapier | API key | Any (API key) | Actions such as "Generate a Gamma"; example triggers: Sheets row, closed CRM deal, form submission | 🟢 [integrations] |
| Make | API key | Any (API key) | Modules such as "Create a Generation" | 🟢 [integrations] |
| n8n | API key (Gamma credential) | Any (API key) | Official node: Generation Create / Create from Template / Get Status; Theme List; Folder List. Poll with a Wait node (30–60 s suggested in [polling]) | 🟢 [integrations], [polling] |
| Other platforms / custom apps | `X-API-KEY` or OAuth Bearer | Any | `POST /v1.0/generations` + poll. **Server-side only, no browser calls** | 🟢 [integrations] |
| Own MCP client | OAuth + DCR | Any (redirect URIs registered first) | Full public tool set | 🟢 [integrations], [own-agent] |

- 🟢 The changelog (2026-03-06) claims "full v1.0 API parity" across Zapier, Make and n8n. However, the n8n operation table on [integrations] lists only Classic operations [changelog], [integrations].
- 🟡 The automation nodes probably have not yet picked up the Gamma 5 agent, edit, export, search or analytics endpoints. Evidence: the n8n operation list. Zapier/Make action lists are not enumerated (🔴).
- 🟢 Rate limits seen from Zapier/Make/n8n "may be on the platform side rather than Gamma's" [polling].

### 4.2 Custom MCP connectors (bringing your MCP into Gamma Agent)

| Aspect | Detail | Marker |
|---|---|---|
| Plan | Enterprise only | 🟢 [custom-mcp] |
| Who adds | A workspace admin, once per workspace: Settings → **Sharing & access** → turn on **Workspace connectors** → **Custom connectors** → **Add connector** (Name + Server URL) | 🟢 [custom-mcp] |
| Who connects | Each member separately: Settings → **My connectors** → Connect → popup sign-in → "Connector connected" | 🟢 [custom-mcp] |
| Server requirements | Streamable HTTP, public HTTPS MCP endpoint, OAuth sign-in with DCR **or Client ID Metadata Documents** | 🟢 [custom-mcp] |
| Redirect to allowlist | `https://api.gamma.app/mcp/custom/callback` | 🟢 [custom-mcp] |
| Tool policy | Gamma "aims to only use your read-only tools". Troubleshooting: if a tool doesn't show up, make sure it is marked read-only on your server | 🟢 [custom-mcp] |
| Access model | Per-member accounts, so Gamma sees only what that member can see. Usable alongside built-in connectors (Google Drive, Notion) | 🟢 [custom-mcp] |
| Selection | A toggle in the chat box picks which connectors the agent may use | 🟢 [custom-mcp] |
| Manage | Pause = admin toggle off; rename/URL change = delete and re-add; deleting disconnects every member; members can Disconnect | 🟢 [custom-mcp] |
| Lock icon | Shows when the plan is not Enterprise or Workspace connectors is off | 🟢 [custom-mcp] |
| API opt-out | `disableConnectors: true` on `POST /agent/generations`, `POST /agent/gammas/{id}/edits` and `edit_gamma` opts a run out of workspace connector access | 🟢 OpenAPI on [agent-create], [agent-edit]; [mcp-ref] |
| Launch | 2026-10-05 | 🟢 [changelog] |

- 🟡 Gamma's main backend (`api.gamma.app`) acts as the MCP **client** for custom connectors and filters tools by the MCP `readOnlyHint` annotation. Evidence: the callback host and the "marked as read-only" troubleshooting row.
- 🟡 API-triggered agent runs can reach the caller's connected workspace connectors by default, which is why the opt-out exists. Evidence: the `disableConnectors` description. Which connectors an API run actually reaches is 🔴.
- 🔴 Prompt-injection or data-exfiltration controls for connector content are not documented beyond the read-only policy.

---

## 5. Error codes (REST)

Envelope 🟢: `{ "message": "...", "statusCode": 401 }`. The OpenAPI `ErrorResponse` schema declares only `message` and `statusCode` (required) [errors]. The docs prose adds a machine `code` on some responses (`edit_in_progress`, `workspace_concurrency_limit_exceeded`, `individual_analytics_required`, `agent_premium_models_restricted`, `insufficient_credits`) [errors], [pricing].
- 🟡 `code` is an undocumented-in-schema extra field on the same object. Evidence: the prose says "Response includes `code: …`", while the schema has no `code` property.

### 5.1 Status table

| Status | Code / message | Where | Meaning | Handling | Marker |
|---|---|---|---|---|---|
| 400 | Input validation errors | All | Bad shape or values: missing required fields, enum case, `inputText` outside 1–400,000 chars, `numCards` above plan, `themeId`+`templateId` together, unknown theme, inaccessible `templateId`, view-only/ownerless folder | Fix the request; don't retry blindly | 🟢 [errors], OpenAPI on [agent-create], [changelog] |
| 400 | (edit) | `POST /agent/gammas/{id}/edits` | Gamma archived, has no pages, or is a non-editable type | Pick another target | 🟢 OpenAPI on [agent-edit] |
| 400 | (uploads) | `POST /uploads` | Missing `mimeType`/`x-harness-upload-name`/`Content-Length`; filename not percent-encoded; body not octet-stream, content-encoded, or mismatched; unsupported type | Fix the headers/body | 🟢 OpenAPI on [uploads] |
| 401 | Invalid API key | All | Key invalid, revoked or ineligible. Keys start `sk-gamma-`; header `X-API-KEY` | Check the key and header | 🟢 [errors] |
| 401 | `invalid_token` | OAuth | Token expired, malformed or wrong audience | Refresh once, then re-auth | 🟢 [oauth] |
| 402 | Insufficient credits remaining | Classic `POST /generations`, `/from-template`, `POST /images` | Workspace out of credits | Buy credits / auto-recharge; check `credits.remaining` proactively | 🟢 [errors], [polling]; routes from OpenAPI |
| 403 | `insufficient_credits` | Agent create/edit, `POST /uploads` | Zero balance (a job needs ≥1 credit to start) | Same as 402 | 🟢 [pricing], [polling] |
| 403 | `agent_premium_models_restricted` | Agent create/edit with `quality: max` | Plan below Pro | Use `lite`/`standard` or upgrade | 🟢 [pricing] |
| 403 | `individual_analytics_required` ("Pro plan or higher required") | 4 analytics routes | Below Pro, **or** lacking edit permission, **or** (detail route) needing manage to read another viewer | Upgrade or fix permissions | 🟢 [errors] |
| 403 | "You must have edit permission to archive this gamma" | `/archive` | Usually a web URL slug instead of the API file ID (`g_…`), wrong workspace, or no edit permission | Use the poll's `gammaId` | 🟢 [errors] |
| 403 | "workspace admin role required" | `DELETE /gammas/{id}` | Key owner is not an admin | Use an admin key | 🟢 [errors] |
| 403 | `insufficient_scope` | OAuth `gamma:read` token on a write route | Scope too narrow | Re-authorize with `generate` | 🟢 [oauth] |
| 403 | Forbidden / feature not available | Various | No permission, plan lacks the feature, or API access turned off by an admin | Check plan and admin settings | 🟢 [errors], [pricing] |
| 403 | comment-level access required | `GET /gammas/{id}/comments` | Caller cannot comment | Get access | 🟢 OpenAPI |
| 404 | Generation ID not found | Polls | Wrong or expired ID | Fix the ID | 🟢 [errors] |
| 404 | Upload not found | `POST /agent/generations` | An upload in `files` is missing or expired | Re-upload | 🟢 [errors] |
| 404 | Uploads are unavailable | `POST /uploads` | Feature not available | 🔴 (not explained) | 🟢 OpenAPI on [uploads] |
| 404 | Gamma / edit / export / viewer not found | Read routes | Unknown ID, or anonymous viewer on the detail route | Fix the ID | 🟢 OpenAPI |
| 408 | Request timeout | `POST /uploads` | Body arrived too slowly | Retry | 🟢 [errors] |
| 409 | `edit_in_progress` | `POST /agent/gammas/{id}/edits` | Another edit is running; may include the running `editId` if it belongs to your workspace | Poll that `editId`; don't duplicate | 🟢 [errors] |
| 413 | Payload too large | `POST /uploads`, `POST /agent/generations` | File >250 MiB or image >50 MP; `files` total >250 MiB | Shrink or split | 🟢 [errors] |
| 422 | — | — | **Not documented anywhere** | — | 🔴 |
| 429 | Too many requests / `workspace_concurrency_limit_exceeded` | Create routes; polls | HTTP rate limits, too many in-flight agent jobs, or (Free + API key) too many pending Classic/template/image jobs. `Retry-After` when present; concurrency 429s always carry it | Wait `Retry-After` (or 30 s), then exponential backoff; finish/poll existing jobs first | 🟢 [errors], [pricing], [polling] |
| 500 | "An error occurred while generating the gamma." | Generation | Unexpected | Contact support with the `x-request-id` header | 🟢 [errors] |
| 502 | Bad gateway | Any | Temporary gateway issue | Retry | 🟢 [errors] |
| 503 | Service unavailable | Agent endpoints (busy); `POST /uploads` (too many uploads); `GET /gammas/search` (search down) | Transient | Retry with exponential backoff | 🟢 [errors] |
| 504 | Gateway timeout | `POST /uploads` | Storing the file timed out | Retry the upload | 🟢 [errors] |

### 5.2 In-job failure reasons (status endpoints)

| Family | `reason` enum | Notes | Marker |
|---|---|---|---|
| Agent generation (`AgentGenerationError`) | `access_revoked`, `generation_failed`, `insufficient_credits`, `invalid_files`, `timeout`, `unavailable` | Each with `message` and an HTTP-style `statusCode`. A `gamma` object may exist if the doc was created before the failure. `invalid_files` = upload expired, already attached, or too large. A required `sourceUrls` link that cannot be read also fails the job and creates no gamma | 🟢 OpenAPI on [agent-status]; [import]; [changelog] |
| Agent edit (`EditError`) | `access_revoked`, `edit_failed`, `insufficient_credits`, `target_not_found`, `timeout`, `unavailable`, `unsupported_target` | May be **partially applied** | 🟢 OpenAPI on [edit-status] |
| Export (`ExportError`) | `deck_too_large`, `export_failed`, `no_content`, `render_timeout` | Retry only `render_timeout`/`export_failed` | 🟢 OpenAPI on [export-status] |
| Classic generation / image | `error` = `ErrorResponse {message,statusCode}` | Images over MCP add `retryable` + `errorStatusCode` | 🟢 OpenAPI; [mcp-ref] |

- 🟡 Insufficient credits is reported three different ways: 402 on Classic and images, 403 `insufficient_credits` on agent routes and uploads, and an in-job `reason`. This looks like an inconsistency left over from the older Classic stack. Evidence: the response tables on each route.

---

## 6. Warnings

General rules 🟢 [warnings]: warnings are informational and never stop generation. Classic responses return them as **one string** (`warnings`) next to `generationId`. Agent and image responses return a **structured array** of `{code, message}`.

### 6.1 Classic generation (string warnings)

| Scenario | Example text (paraphrased) | Marker |
|---|---|---|
| Dimensions invalid for format | `cardOptions.dimensions 1x1 is not valid for format presentation … Using default: fluid.` | 🟢 [warnings] |
| Image model with non-AI source | `imageOptions.model` and `imageOptions.style` ignored unless `source` is `aiGenerated` | 🟢 [warnings] |
| `preserve` + text options | `textOptions.amount`/`tone` (and `audience`) ignored under `textMode: preserve` | 🟢 [warnings] |
| Admin-restricted workspace sharing | `sharingOptions.workspaceAccess` ignored because an admin restricted workspace sharing | 🟢 [warnings] |
| Access links disabled | `sharingOptions.externalAccess` ignored because an admin disabled access links | 🟢 [warnings] |
| Deprecated `folderIds` | Returns a deprecation warning | 🟢 [changelog] |
| `quality` on a non-agent generation (MCP) | Ignored and reported | 🟢 [mcp-ref] |
| Superhuman Go sharing overrides (MCP) | Each ignored setting is reported | 🟢 [mcp-ref] |

Valid dimensions per format 🟢 [warnings]:

| Format | Valid `cardOptions.dimensions` | Fallback shown in docs |
|---|---|---|
| `presentation` | `16x9`, `4x3`, `fluid` | `fluid` |
| `document` | `pageless`, `letter`, `a4`, `fluid` | 🔴 |
| `social` | `1x1`, `4x5`, `9x16` | 🔴 |
| `webpage` | `fluid` | 🔴 |

### 6.2 Agent generation warning codes (`AgentGenerationWarning.code`)

| Code | Meaning (from name + docs prose) | Marker |
|---|---|---|
| `email_full_access_members_only` | Email `fullAccess` only allowed for workspace members | 🟢 enum / 🟡 meaning |
| `email_invites_failed` | Email invites could not be sent | 🟢 enum / 🟡 |
| `export_failed` | `exportAs` export failed. Export failure is **always a warning, never a failed generation** | 🟢 OpenAPI on [agent-create] |
| `external_access_failed` | External access could not be applied | 🟢 enum / 🟡 |
| `folder_placement_failed` | `folderId` could not be applied | 🟢 [warnings] |
| `ignored_email_options` | Email options ignored (e.g. admin restriction) | 🟢 enum / 🟡 |
| `ignored_email_recipients` | Some recipients ignored | 🟢 enum / 🟡 |
| `ignored_external_access` | `externalAccess` stripped (access links disabled) | 🟢 enum / 🟡 |
| `ignored_folder_id` | `folderId` ignored | 🟢 enum / 🟡 |
| `ignored_workspace_access` | `workspaceAccess` stripped (workspace sharing restricted) | 🟢 enum / 🟡 |
| `workspace_access_failed` | Workspace access could not be applied | 🟢 enum / 🟡 |

- 🟢 Warnings can appear on create and again on the status response. The failed-status schema says they are "usually empty" there, so **keep them from the create response** (OpenAPI on [agent-status]; [warnings]).

### 6.3 Image warnings (`ImageGenerationWarning.code`)

| Code | Meaning | Marker |
|---|---|---|
| `no_brand_theme_applied` | No brand theme found; a standard theme was used | 🟢 [warnings] |
| `theme_ignored_for_type` | `themeId` ignored because `type` is `scene` | 🟢 [warnings] |
| `theme_skipped_for_references` | `themeId` ignored because `referenceImages` were given | 🟢 [warnings] |
| `curated_style_skipped_for_references` | `type` ignored because `referenceImages` were given | 🟢 [warnings] |

### 6.4 Export

- 🟢 Standalone exports report failures via `reason`, not warnings (§5.2). When `exportAs` is set on an agent generation, a failed export becomes the `export_failed` warning [export-status], [agent-create].
- 🔴 No export-specific warning enum is documented.

---

## 7. Limits

### 7.1 Plan matrix

| Limit | Free | Paid | Marker |
|---|---|---|---|
| API keys / REST | Yes (since 2026-10-22) | Yes. Admins can restrict or disable keys | 🟢 [pricing], [changelog] |
| MCP + first-party connectors | Yes | Yes | 🟢 [pricing] |
| Cards per gamma (`numCards` on agent and Classic; >cap → 400; the agent also caps decks it plans itself) | ≤10 | ≤100 (Plus, Pro, Ultra, Teams, Business, Enterprise) | 🟢 [pricing], [gen-text] |
| In-flight agent jobs per workspace (generations + edits) | 2 | 10 | 🟢 [pricing] |
| Pending Classic/template/image jobs (API key) | Capped (number 🔴) → 429 | Not stated | 🟢 [pricing] / 🔴 value |
| `quality: max` | No (`403 agent_premium_models_restricted`) | Pro, Ultra, Teams, Business, Enterprise | 🟢 [pricing] |
| `lite` / `standard` | All plans | All plans | 🟢 [pricing] |
| Analytics (REST + MCP) | No (`403 individual_analytics_required`) | Pro+ for every caller, incl. OAuth/connector users | 🟢 [pricing], [changelog] |
| AI image models | Only the models the plan includes (example plan-limit payload shows `flux-1-quick`, `flux-2-klein` on free) | More tiers on higher plans | 🟢 [pricing], [mcp-ref] |
| Custom MCP connectors | No | Enterprise | 🟢 [custom-mcp] |
| `inputTextBreaks` count | Plan-capped (value 🔴) | Plan-capped (value 🔴) | 🟢 [mcp-ref] / 🔴 |
| Model → plan mapping per tier | 🔴 | 🔴 | 🔴 |

### 7.2 Input and payload limits

| Limit | Value | Marker |
|---|---|---|
| Classic `inputText` | 1–400,000 chars; token limit 100,000 (about 400k chars), can be lower when extra reasoning is needed. For templates the template counts toward the limit | 🟢 [errors], [gen-text], [gen-template] |
| Agent `prompt` | maxLength 400,000 | 🟢 OpenAPI on [agent-create] |
| Agent `additionalInstructions` | ≤5,000 | 🟢 OpenAPI on [agent-create] |
| Agent `themeId` | 1–128 chars | 🟢 OpenAPI |
| Agent `sourceUrls` | ≤10 http(s) URLs. Links the prompt depends on are required (unreadable → fail); background links are skipped | 🟢 OpenAPI on [agent-create] |
| Agent `files` | ≤50 files, ≤250 MiB total, one `purpose: import`; each upload attaches to one generation; unattached uploads expire after 2 days | 🟢 [import], [uploads] |
| Upload | Raw `application/octet-stream` body with `Content-Length` (no chunked/encoded), ≤250 MiB, images ≤50 MP, `mimeType` must match, name percent-encoded in `x-harness-upload-name` | 🟢 [uploads] |
| Edit `prompt` | 1–10,000 chars | 🟢 [mcp-ref], OpenAPI on [agent-edit] |
| Image `prompt` | 1–5,000 chars; ≤4 reference images (https) | 🟢 [mcp-ref], [images] |
| Title | 1–500 chars | 🟢 [mcp-ref] |
| Multi-page | 1–50 pages per request | 🟢 [mcp-ref], [gen-text] |
| Template search `q` | ≤2,000 chars | 🟢 [mcp-ref] |
| Output language | One language per generation; default `en`; 67 keys listed (e.g. `zh-cn`, `zh-tw`, `ja`, `ja-da`) | 🟢 [languages] |
| Image URLs in input | Must be publicly accessible; Classic re-hosts them; agent does not guarantee fetch/re-host | 🟢 [limits] |

### 7.3 Pagination and search

| Surface | Limit | Marker |
|---|---|---|
| Themes, folders, comments, viewers (REST) | Cursor: `hasMore` + `nextCursor` → `after` | 🟢 [explore] |
| Viewer analytics | ≤500 viewers in total; MCP page default 25, max 50 | 🟢 [explore], [mcp-ref] |
| `get_gammas` | default 25, max 50; cursor | 🟢 [mcp-ref] |
| Gamma search / `search_gammas` | default 10, max 25; **no cursor**; without `q` needs a filter and returns newest-updated first (use date filters to reach older ones) | 🟢 [explore], [mcp-ref] |
| Template search | default 10, max 25 **per list**; no cursor; workspace ranking is best-effort (`workspaceDegraded: true` when it falls back to last-edited) | 🟢 [explore], [mcp-ref] |
| Comments (MCP) | default 50, max 50 | 🟢 [mcp-ref] |
| `validThemes` in errors | ≤100 | 🟢 [mcp-ref] |

### 7.4 Rate limits, timing and URLs

| Item | Value | Marker |
|---|---|---|
| Headers on every response | `x-ratelimit-limit-burst` / `-remaining-burst` (short window), `x-ratelimit-limit` / `-remaining` (per hour), `x-ratelimit-limit-daily` / `-remaining-daily` | 🟢 [polling] |
| Actual numbers | The docs example shows 10,000 burst / 40,000 hourly / 200,000 daily, but presents it only as an example response. Real per-plan values are not stated | 🟢 example / 🔴 real |
| Burst window length | Not stated | 🔴 |
| Adaptive polling | Poll every 5 s; slow to 15 s when `remaining-burst` < 100 (doc sample) | 🟢 [polling] |
| 429 handling | Honor `Retry-After` when present (concurrency 429s always carry it); otherwise pause 30 s, then exponential backoff | 🟢 [polling], [pricing] |
| Classic timing | Usually 1–3 min; suggested 5-min ceiling | 🟢 [polling] |
| Agent timing | Usually minutes, can run **up to 20 min**; sample deadline 25 min; don't resubmit a pending job | 🟢 [migrate] |
| Agent `progress` | `done`, `total`, `percent` 0–99 (never drops within an attempt, can restart lower on agent retry; only `completed` = 100), `stages{queued,writing,imaging,checking,polishing,done,failed}` | 🟢 OpenAPI on [agent-status] |
| Webhooks | **None**; everything is create-then-poll | 🟢 [limits] |
| Export URL | About 1 week; bearer-style (anyone with the link) | 🟢 [limits] |
| Thumbnail / preview URLs | Signed, about 7 days | 🟢 [mcp-ref] |
| Upload expiry | 2 days if never attached | 🟢 [uploads] |
| Analytics freshness | Lags about 1 h | 🟢 [mcp-ref] |
| MCP tool list cache | 60 s | 🟢 [mcp-ref] |
| Debug ID | `x-request-id` response header; give it to support / the API Slack channel | 🟢 [errors], [help] |

---

## 8. Pricing

| Item | Value | Marker |
|---|---|---|
| Model | Credits, shared with in-app AI features and priced by the same rules. API key → key owner's credits in that workspace (teammates sharing a key drain the owner); OAuth/MCP → authorizing user | 🟢 [pricing] |
| Classic cards | 1–3 credits per card (depends on the text model Gamma picks internally). Template generations "may cost slightly more per card" | 🟢 [pricing] |
| Image tiers (Classic) | Standard 2–15 · Advanced 20–33 · Premium 34–75 · Ultra 30–125 credits per image | 🟢 [pricing] |
| Per-model prices | e.g. `flux-1-quick` 2, `gpt-image-2-mini` 5, `recraft-v4` 12, `gemini-2.5-flash-image` 20, `dall-e-3` 33, `gemini-3.1-flash-image` 50, `gemini-3-pro-image` 70, `gpt-image-2-hd` 115, `recraft-v4-pro` 125 | 🟢 [image-models] |
| Agent generations/edits | Priced by the work the agent does (writing, research, images it creates). Depends on `quality`; the agent picks image models; per-card/per-image prices don't apply; the same prompt can cost different amounts | 🟢 [pricing] |
| Estimating agent cost | Run representative prompts and compare `credits.deducted` | 🟢 [pricing] |
| Reads / searches / exports / archive | Free (archiving deducts nothing) | 🟢 [pricing], [limits] |
| Minimum to start | ≥1 available credit | 🟢 [pricing] |
| Disclaimer | Rates and charged actions "subject to change" | 🟢 [pricing] |

Illustrative Classic scenarios 🟢 [pricing]:

| Scenario | Credits |
|---|---|
| Deck, 10 cards + 5 images, basic image model | about 20–60 |
| Doc, 20 cards + 15 images, premium model | about 320–1,070 |
| Socials, 30 cards + 30 images, ultra model | about 930–3,900 |

Where credits are reported:

| Surface | Fields | Marker |
|---|---|---|
| Classic `GET /generations/{id}` | `credits{deducted,remaining}` on completed/failed (not pending) | 🟢 [polling] |
| Agent `GET /agent/generations/{id}`, `GET /agent/edits/{id}` | `credits.deducted` = ledger-settled spend so far (can still grow from late settlement; best-effort; `0` = nothing recorded; omitted if the lookup fails). `remaining` = live balance, not job cost. "Informational, not a billing record" | 🟢 [pricing], OpenAPI on [agent-status] |
| Images | `credits{deducted,remaining}` | 🟢 [mcp-ref] |
| MCP `get_generation_status` | `credits.*` **omitted for `gen_` IDs** | 🟢 [mcp-ref] |
| Plan-limit failure | `currentPlanLimits.creditsRemaining` | 🟢 [mcp-ref] |

---

## 9. Changelog timeline

All entries 🟢 [changelog], one line each, newest first.

**2026-11**
- 11-04 · feature · Import a presentation: `POST /uploads` + `files` on agent generation; new `invalid_files` reason; required `sourceUrls` links fail the job when unreadable.

**2026-10**
- 10-22 · feature · API keys and REST on every plan incl. Free, limited by credits and plan limits (Free: Classic `numCards` ≤10, two concurrent agent jobs, no `max` quality); analytics endpoints and MCP analytics tools now Pro+ for every caller, incl. OAuth and connector users.
- 10-05 · launch · Gamma 5 agent: `POST /agent/generations` (+`templateId`), `POST /agent/gammas/{id}/edits`, `GET /agent/edits/{id}`; MCP `edit_gamma`/`get_edit_status`; ChatGPT and Claude can edit.
- 10-05 · launch · Custom MCP connectors for Enterprise workspaces.

**2026-09**
- 09-25 · deprecation · `folderIds` deprecated in favor of `folderId` (≤1 entry, ignored if `folderId` is present, warns).
- 09-10 · breaking · Channels become folders with their own permissions; placing a gamma needs edit/full access to the folder; ownerless migrated folders now give a 400.

**2026-08**
- 08-31 · feature · MCP `search_templates`.
- 08-28 · feature · `GET /gammas/search`, `GET /templates/search`; MCP `search_gammas`.
- 08-04 · feature · Standalone images: `POST /images`, `GET /images/{id}`, media-library archive; MCP `generate_image`/`get_image_generation_status`.

**2026-07**
- 07-30 · launch · Gamma app for Slack (on the MCP server).
- 07-20 · feature · MCP `generate_multi_page_gamma`, with site publishing.
- 07-16 · feature · Card analytics gain `cardName`/`cardPosition`; complete card lists with zeroed stats; viewer detail covers every card.
- 07-13 · feature · Read/export/analyze existing gammas: `GET /gammas/{id}`, comments, export + `GET /exports/{id}`, analytics family; MCP `get_gamma_comments`, `export_gamma`, analytics tools.

**2026-03**
- 03-06 · launch · ChatGPT app live.
- 03-06 · launch · Native Zapier, Make and n8n integrations, "full v1.0 parity".

**2026-02**
- 02-27 · feature · Create-from-template GA; `stylePreset`; PNG export; `gammaId` on `GET /generations/{id}`; new image models (`recraft-v4*`, `gemini-3.1-flash-image*`, `flux-2-max`, `flux-2-klein`).

**2026-01**
- 01-23 · launch · Claude connector.
- 01-16 · deprecation · `v0.2` endpoints disabled; `v1.0` required.

**2025-11**
- 11-05 · feature · Generate API GA as `v1.0`; create-from-template beta; webpages; headers/footers; image URLs in input; folders and email sharing; themes/folders list endpoints; official Make integration; hard generation limits removed.

**2025-09**
- 09-15 · feature · Credits-based pricing; Ultra tier with stronger models and up to 75 cards (since raised to 100 on paid plans per [pricing]); Zapier.

**2025-07**
- 07-28 · launch · Beta of the Generate endpoints.

- 🔴 Superhuman Go, Atlassian Rovo, the MCP server's own launch, MCP OAuth/DCR, `get_gamma_outline` and the MCP Apps widgets have no changelog entry.
- 🟡 The MCP server was probably live before 2026-01-23, since the Claude connector "runs on this server" [mcp-setup]. The exact launch date is 🔴.

---

## 10. Inferred internals

| # | Inference | Evidence | Marker |
|---|---|---|---|
| 1 | The MCP server is a thin adapter over the Public API, running as the OAuth user | `search_gammas` "maps to `GET /gammas/search`"; analytics denials quote "the API's explanation" and map to REST `403 individual_analytics_required`; `errorStatusCode` = "the HTTP status behind the failure when the API reported one"; image models "same IDs as the REST API"; "most MCP tools have a REST equivalent" [mcp-ref], [mcp-setup] | 🟡 |
| 2 | The adapter adds agent-facing value on top: `guidance` strings, `planLimitExceeded` + a live limits lookup, `validThemes`, `retryable`, and generation-ID → gamma-ID resolution | All are MCP-only fields absent from the OpenAPI schemas [mcp-ref] vs openapi | 🟡 |
| 3 | MCP `generate` routes between the Gamma 5 agent and Classic engines; `generate_from_template` always goes to the agent; multi-page always to Classic | `quality` "agent generations only"; `gen_` IDs omit credits; webpage sometimes unsupported; template = `POST /agent/generations` with `templateId`; multi-page = Classic [mcp-ref], [own-agent] | 🟡 (routing rule 🔴) |
| 4 | The agent runs inside an internal "harness" runtime that owns uploads | Upload filename header is `x-harness-upload-name`; `CreateUploadResponse.filename` is "derived from" it [uploads] | 🟡 |
| 5 | The agent pipeline works per card through the stages queued → writing → imaging → checking → polishing, and can restart a whole attempt | `progress.stages` enum; percent "can restart lower if the agent retries" (OpenAPI on [agent-status]) | 🟡 |
| 6 | Agent billing is metered through a usage ledger settled asynchronously (model + tool spend + image charges) | `AgentCreditsResponse.deducted` wording: "settled from its ledger", "late settlement", "best-effort" | 🟡 |
| 7 | One per-workspace limiter covers in-flight agent jobs (2/10) and Free-tier pending Classic jobs, and shares its error code with the HTTP rate limiter | Same `workspace_concurrency_limit_exceeded` code and `Retry-After` for all three causes [errors], [pricing] | 🟡 |
| 8 | Per-key/user HTTP rate limiting uses three windows (burst/hour/day) | Header triplet [polling]. Whether it is keyed per key, user or workspace is 🔴 | 🟡 |
| 9 | Edits take a per-gamma lock | 409 `edit_in_progress` returns the running `editId` [errors] | 🟡 |
| 10 | The tool registry is per user and per client, with feature flags (edit availability, outline rollout) and client-specific tools/policies (ChatGPT-only tools, Superhuman Go sharing clamp) | `cacheScope: private`, conditional tools, client-specific notes [mcp-ref] | 🟡 |
| 11 | A separate authorization server (`auth.gamma.app`) issues JWT access tokens audience-bound per resource (`public-api.gamma.app`, MCP server) | Endpoints, JWKS, RFC 8707, `eyJ` sample [oauth] | 🟡 |
| 12 | Gamma's main backend (`api.gamma.app`) is an MCP client for custom connectors and only exposes tools annotated read-only to the agent | Callback URL, "marked as read-only" [custom-mcp] | 🟡 |
| 13 | Export and thumbnail links are presigned object-storage URLs (about 7-day TTL) | "anyone with the URL", "not tied to your API key", "signed", 7-day expiry [limits], [mcp-ref] | 🟡 |
| 14 | MCP Apps progress/preview data travels in result `_meta`, hidden from the model | Documented for `get_gamma_embed_urls`; same "only to the widget" wording for progress/preview [mcp-ref] | 🟡 |
| 15 | Classic and agent stacks are separate services with different error conventions | 402 vs 403 for credits; string vs structured warnings; `200` Classic create vs `202` agent create (OpenAPI) | 🟡 |
| 16 | Docs are designed for agents: GitBook `llms.txt`/`llms-full.txt`, `.md` for every page, and an "ask" endpoint `GET https://developers.gamma.app/index.md?ask=…&goal=…` | Top of `llms-full.txt` [docs-home], [explore] | 🟢 |

---

## 11. Implications for AIMate

- 🟢 AIMate already hosts MCP servers for its own agents (`src/lib/builtin-mcp-bridge.ts`, `image-gen-mcp.ts`, `media-import-mcp.ts`, and others), so a PPT MCP server would follow an existing pattern (repo listing).
- 🟢 The Gamma-compatible REST facade `src/lib/ppt-gamma-service.ts` already returns Gamma's error body shape `{message, statusCode, code?}`. It also mirrors the two warning shapes: a structured `{code, message}[]` for the agent flavor and a joined string for Classic. That matches §5 and §6 (code read).
- 🟢 Create status codes match Gamma: the facade answers agent create with **202** and Classic create with 200 (`createGeneration` in `src/lib/ppt-gamma-service.ts`; Gamma: 202 vs 200 in OpenAPI). Divergence: a failed facade job reports `error.statusCode: 422` (`toGammaStatus` in `src/lib/ppt-gamma-compat.ts`), a status Gamma documents nowhere (§5.1). Gamma's agent **edit** create returns 201 (OpenAPI); the facade has no edit route.
- 🟡 PPT generation has **no MCP exposure** yet. If we add it, Gamma's agent-facing contract is the cheapest model to copy:
  - a start/poll tool pair;
  - a generation ID accepted wherever a deck ID is;
  - `isError` plus a `guidance` string;
  - `retryable` on failures;
  - live limits in failure payloads;
  - parameter descriptions that tell the model to pass user wording through and keep instructions separate from content.
- 🟡 Operational items to borrow: `Retry-After` on concurrency 429s, a per-deck edit lock (409 + running ID), `reason` enums that mark which failures are transient, and treating export URLs as short-lived secrets (the facade already signs download URLs with `expires`/`signature`).

---

## Evidence limitations

- Every 🟢 Gamma claim rests on one snapshot of the public docs (`llms-full.txt` and the OpenAPI blocks embedded in it, read 2026-11-05). Nothing was called live: no MCP session, OAuth flow, error response or rate-limit header was observed.
- Docs prose and OpenAPI sometimes differ in detail (for example, prose adds a `code` field the `ErrorResponse` schema lacks). Where they differ, both are cited and the gap is flagged; neither is assumed to match production.
- Example values (rate-limit headers, the plan-limit payload, image models on Free) are illustrative in the docs and are not stated entitlements.
- The connector and client rows (ChatGPT, Claude, Slack, Superhuman Go, Rovo, Cursor, Gemini CLI, Codex) come from setup pages only. Their real feature sets can lag the docs while platforms review app updates.
- The changelog is Gamma's own and lists only what Gamma chose to announce; features with no entry (MCP server launch, DCR, outline tool, widgets) have no dated history here.
- The §11 AIMate statements come from reading the code, not running it; the facade's status codes and error bodies were not exercised against a live engine.

## Open questions

- 🔴 Actual rate-limit numbers per plan, the burst window length, and whether limits are keyed per API key, user or workspace (the doc example values are not stated to be real).
- 🔴 The exact cap on pending Classic/template/image jobs for Free workspaces, and on `inputTextBreaks` per plan.
- 🔴 Which image models each plan includes (only an example payload exists).
- 🔴 The rule that sends MCP `generate` to the Gamma 5 agent vs Classic.
- 🔴 Whether any 422 responses exist; none are documented.
- 🔴 Whether a REST `ErrorResponse.code` is guaranteed: the schema omits it, the prose uses it.
- 🔴 Schemas of `mention_gammas` and the MCP Apps widget payloads (resource URIs, `_meta` keys).
- 🔴 Which audience MCP access tokens carry, and whether REST and MCP DCR share one authorization server with different redirect policies.
- 🔴 Full Zapier and Make action lists, and whether the automation nodes support agent, edit, export or search.
- 🔴 Codex, Cursor and Gemini CLI setup specifics; the launch date of the MCP server itself.
- 🔴 Whether MCP clients can upload files or import decks (no tool documented).
- 🔴 What, beyond the read-only policy, protects against prompt injection through custom connectors.
- 🔴 Default dimension fallbacks for `document`, `social` and `webpage` when the dimensions are invalid.

## Sources

All pages fetched as the GitBook markdown export (`llms-full.txt`) on 2026-11-05; OpenAPI blocks are embedded in the endpoint pages.

- [docs-home] https://developers.gamma.app/readme.md
- [explore] https://developers.gamma.app/get-started/understanding-the-api-options.md
- [oauth] https://developers.gamma.app/get-started/authenticate-with-oauth.md
- [pricing] https://developers.gamma.app/get-started/access-and-pricing.md
- [migrate] https://developers.gamma.app/get-started/migrate-from-classic-to-gamma-5.md
- [own-agent] https://developers.gamma.app/build-with-gamma/connect-your-own-agent.md
- [templates-wf] https://developers.gamma.app/build-with-gamma/branded-template-workflow.md
- [import] https://developers.gamma.app/build-with-gamma/import-a-presentation.md
- [uploads] https://developers.gamma.app/agent-gamma-5/create-upload.md
- [agent-create] https://developers.gamma.app/agent-gamma-5/create-agent-generation.md
- [agent-status] https://developers.gamma.app/agent-gamma-5/get-agent-generation-status.md
- [agent-edit] https://developers.gamma.app/agent-gamma-5/edit-gamma.md
- [edit-status] https://developers.gamma.app/agent-gamma-5/get-edit-status.md
- [classic-create] https://developers.gamma.app/generations-classic/create-generation.md
- [images] https://developers.gamma.app/images/create-image-generation.md
- [export-status] https://developers.gamma.app/management/get-export-status.md
- [analytics-viewers] https://developers.gamma.app/analytics/get-gamma-viewer-analytics.md
- [gen-text] https://developers.gamma.app/guides/generate-api-parameters-explained.md
- [gen-template] https://developers.gamma.app/guides/create-from-template-api-parameters-explained.md
- [polling] https://developers.gamma.app/guides/async-patterns-and-polling.md
- [mcp-setup] https://developers.gamma.app/mcp/gamma-mcp-server.md
- [mcp-ref] https://developers.gamma.app/mcp/mcp-tools-reference.md
- [integrations] https://developers.gamma.app/connectors/connectors-and-integrations.md
- [custom-mcp] https://developers.gamma.app/connectors/custom-mcp-connectors.md
- [image-models] https://developers.gamma.app/reference/image-model-accepted-values.md
- [languages] https://developers.gamma.app/reference/output-language-accepted-values.md
- [errors] https://developers.gamma.app/reference/error-codes.md
- [warnings] https://developers.gamma.app/reference/warnings.md
- [limits] https://developers.gamma.app/reference/common-feature-requests.md
- [help] https://developers.gamma.app/reference/get-help.md
- [changelog] https://developers.gamma.app/reference/changelog.md

[docs-home]: https://developers.gamma.app/readme.md
[explore]: https://developers.gamma.app/get-started/understanding-the-api-options.md
[oauth]: https://developers.gamma.app/get-started/authenticate-with-oauth.md
[pricing]: https://developers.gamma.app/get-started/access-and-pricing.md
[migrate]: https://developers.gamma.app/get-started/migrate-from-classic-to-gamma-5.md
[own-agent]: https://developers.gamma.app/build-with-gamma/connect-your-own-agent.md
[templates-wf]: https://developers.gamma.app/build-with-gamma/branded-template-workflow.md
[import]: https://developers.gamma.app/build-with-gamma/import-a-presentation.md
[uploads]: https://developers.gamma.app/agent-gamma-5/create-upload.md
[agent-create]: https://developers.gamma.app/agent-gamma-5/create-agent-generation.md
[agent-status]: https://developers.gamma.app/agent-gamma-5/get-agent-generation-status.md
[agent-edit]: https://developers.gamma.app/agent-gamma-5/edit-gamma.md
[edit-status]: https://developers.gamma.app/agent-gamma-5/get-edit-status.md
[classic-create]: https://developers.gamma.app/generations-classic/create-generation.md
[images]: https://developers.gamma.app/images/create-image-generation.md
[export-status]: https://developers.gamma.app/management/get-export-status.md
[analytics-viewers]: https://developers.gamma.app/analytics/get-gamma-viewer-analytics.md
[gen-text]: https://developers.gamma.app/guides/generate-api-parameters-explained.md
[gen-template]: https://developers.gamma.app/guides/create-from-template-api-parameters-explained.md
[polling]: https://developers.gamma.app/guides/async-patterns-and-polling.md
[mcp-setup]: https://developers.gamma.app/mcp/gamma-mcp-server.md
[mcp-ref]: https://developers.gamma.app/mcp/mcp-tools-reference.md
[integrations]: https://developers.gamma.app/connectors/connectors-and-integrations.md
[custom-mcp]: https://developers.gamma.app/connectors/custom-mcp-connectors.md
[image-models]: https://developers.gamma.app/reference/image-model-accepted-values.md
[languages]: https://developers.gamma.app/reference/output-language-accepted-values.md
[errors]: https://developers.gamma.app/reference/error-codes.md
[warnings]: https://developers.gamma.app/reference/warnings.md
[limits]: https://developers.gamma.app/reference/common-feature-requests.md
[help]: https://developers.gamma.app/reference/get-help.md
[changelog]: https://developers.gamma.app/reference/changelog.md
