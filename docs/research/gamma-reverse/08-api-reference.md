# Gamma public API reference (generated)

> Part of the Gamma reverse-engineering set: [index](README.md)

> 🟢 Generated mechanically from the OpenAPI blocks embedded in Gamma's developer docs (developers.gamma.app, `llms-full.txt`, fetched 2026-11-05) by `.opencode/scripts/gamma-api-reference.py`. Notes are shortened from Gamma's field descriptions; follow the endpoint link for the authoritative text. Server: `https://public-api.gamma.app`; auth header `X-API-KEY` (or OAuth Bearer).

**25 endpoints · 77 schemas**

## Endpoints

| Method | Path | operationId | Summary |
|---|---|---|---|
| GET | [`/v1.0/agent/edits/{editId}`](#get-agent-edits-editid) | `getEditStatus` | Retrieves the current status of an edit job. Poll this endpoint until `status` is "completed" or "failed". |
| POST | [`/v1.0/agent/gammas/{gammaId}/edits`](#post-agent-gammas-gammaid-edits) | `editGamma` | Creates an asynchronous AI edit of one page of an existing Gamma from a natural-language `prompt`. Returns an … |
| POST | [`/v1.0/agent/generations`](#post-agent-generations) | `createAgentGeneration` | Creates an asynchronous generation job run by the Gamma agent. `prompt` is the only required field. Guidance … |
| GET | [`/v1.0/agent/generations/{generationId}`](#get-agent-generations-generationid) | `getAgentGenerationStatus` | Retrieves the current status of an agent generation. Poll this endpoint until `status` is "completed" or … |
| GET | [`/v1.0/exports/{id}`](#get-exports-id) | `getExportStatus` | Retrieves the current status of an export job. Poll this endpoint until status is "completed" or "failed". |
| GET | [`/v1.0/folders`](#get-folders) | `listFolders` | Lists the folders the authenticated user can access within the workspace. Some may be view-only. Using a … |
| GET | [`/v1.0/gammas/search`](#get-gammas-search) | `searchGammas` | Full-text search over the gammas the caller can access, matched against titles and body text. When a query is … |
| DELETE | [`/v1.0/gammas/{gammaId}`](#delete-gammas-gammaid) | `deleteGamma` | Deletes a Gamma document. Requires workspace admin role on the workspace the API key belongs to. The Gamma is … |
| GET | [`/v1.0/gammas/{gammaId}`](#get-gammas-gammaid) | `getGamma` | Returns metadata for a single gamma. Accepts either a file ID or the doc ID from a gamma.app/docs/... URL. … |
| GET | [`/v1.0/gammas/{gammaId}/analytics`](#get-gammas-gammaid-analytics) | `getGammaAnalytics` | Returns doc-level engagement metrics for a Gamma: total views, unique viewers/editors, card count, last … |
| GET | [`/v1.0/gammas/{gammaId}/analytics/cards`](#get-gammas-gammaid-analytics-cards) | `getGammaCardAnalytics` | Returns per-card engagement data for a Gamma: view time (absolute seconds) and viewer reach (percentage) per … |
| GET | [`/v1.0/gammas/{gammaId}/analytics/viewers`](#get-gammas-gammaid-analytics-viewers) | `getGammaViewerAnalytics` | Returns paginated per-viewer engagement data for a Gamma. Requires at least edit permission on the Gamma. … |
| GET | [`/v1.0/gammas/{gammaId}/analytics/viewers/{userId}`](#get-gammas-gammaid-analytics-viewers-userid) | `getGammaViewerDetailAnalytics` | Returns one viewer's engagement with a Gamma: display name, email, last-opened time, cards viewed, and the … |
| POST | [`/v1.0/gammas/{gammaId}/archive`](#post-gammas-gammaid-archive) | `archiveGamma` | Archives a Gamma document. The operation is idempotent - archiving an already archived Gamma succeeds. |
| GET | [`/v1.0/gammas/{gammaId}/comments`](#get-gammas-gammaid-comments) | `listGammaComments` | Returns comment threads on a Gamma, cursor-paginated. Supports an updatedSince filter for efficient delta … |
| POST | [`/v1.0/gammas/{gammaId}/export`](#post-gammas-gammaid-export) | `exportGamma` | Creates an asynchronous export job for an existing Gamma in the requested format. Returns an export ID to … |
| POST | [`/v1.0/generations`](#post-generations) | `createGeneration` | Creates an asynchronous generation job. Provide either `inputText` for a single-page File, or a `pages` array … |
| POST | [`/v1.0/generations/from-template`](#post-generations-from-template) | `createFromTemplateGeneration` | Creates an asynchronous generation job from a template Gamma with variable substitution. |
| GET | [`/v1.0/generations/{id}`](#get-generations-id) | `getGenerationStatus` | Retrieves the current status of a generation job. Poll this endpoint until status is "completed" or "failed". |
| POST | [`/v1.0/images`](#post-images) | `createImageGeneration` | Creates an asynchronous image generation job that produces one standalone on-brand image. Returns an image … |
| POST | [`/v1.0/images/media/{savedMediaId}/archive`](#post-images-media-savedmediaid-archive) | `archiveImage` | Removes an item you created (such as a generated image) from the workspace media library. The operation is … |
| GET | [`/v1.0/images/{id}`](#get-images-id) | `getImageGenerationStatus` | Retrieves the current status of an image generation job. Poll this endpoint until status is "completed" or … |
| GET | [`/v1.0/templates/search`](#get-templates-search) | `searchTemplates` | Search the caller's workspace templates and the official Gamma explore templates. Returns two lists. With a … |
| GET | [`/v1.0/themes`](#get-themes) | `listThemes` | Lists all themes available to the workspace, including standard themes and custom workspace themes. |
| POST | [`/v1.0/uploads`](#post-uploads) | `createUpload` | Stores one file for `files` on `POST /v1.0/agent/generations`. Send the raw bytes as … |

### GET /agent/edits/{editId}

Docs: https://developers.gamma.app/agent-gamma-5/get-edit-status

Retrieves the current status of an edit job. Poll this endpoint until `status` is "completed" or "failed".

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `editId` | path | string | yes |  | The edit ID returned by `POST /v1.0/agent/gammas/{gammaId}/edits`. |

- **200** Edit status retrieved successfully → [PendingEditStatusResponse](#schema-pendingeditstatusresponse) / [CompletedEditStatusResponse](#schema-completededitstatusresponse) / [FailedEditStatusResponse](#schema-failededitstatusresponse)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **404** Edit not found → —
- **429** Rate limit exceeded → —

### POST /agent/gammas/{gammaId}/edits

Docs: https://developers.gamma.app/agent-gamma-5/edit-gamma

Creates an asynchronous AI edit of one page of an existing Gamma from a natural-language `prompt`. Returns an edit ID to poll with `GET /v1.0/agent/edits/{editId}`. Requires at least edit permission on the Gamma. Only one edit runs on a Gamma at a time, and an edit cannot add pages.

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `gammaId` | path | string | yes |  | The Gamma to edit: a gamma (file) ID, or a page ID (the id in a gamma.app/docs/<id> URL). A file ID edits the Gamma's main page; a page ID … |

**Request body** (`application/json`): [EditGamma](#schema-editgamma)

- **201** Edit job created → [EditGammaResponse](#schema-editgammaresponse)
- **400** Invalid request parameters, or a Gamma that is archived, has no pages, or is of a type that cannot be edited → —
- **401** Invalid or missing API key → —
- **403** Insufficient credits, no edit permission on the Gamma, or a `quality` tier the plan does not include → —
- **404** Gamma not found → —
- **409** An edit is already in progress for this Gamma (`code: edit_in_progress`, with the running `editId` when it belongs to your workspace) → —
- **429** Rate limit exceeded, or the workspace has too many in-flight agent jobs (`code: workspace_concurrency_limit_exceeded`, with a `Retry-After` header) → —
- **503** The service is busy; retry the request → —

### POST /agent/generations

Docs: https://developers.gamma.app/agent-gamma-5/create-agent-generation

Creates an asynchronous generation job run by the Gamma agent. `prompt` is the only required field. Guidance fields (`numCards`, `additionalInstructions`) are soft targets; `numCards` must not exceed the card maximum for the workspace plan. To work from your own files, such as a presentation to import, store each with `POST /v1.0/uploads` and list them in `files`. A `folderId` or `sharingOptions` setting that a workspace admin restricts is ignored and reported in `warnings`. Returns a `gen_`-prefixed generation ID to poll with `GET /v1.0/agent/generations/{generationId}`.

**Request body** (`application/json`): [CreateAgentGeneration](#schema-createagentgeneration)

- **202** Generation job created → [CreateAgentGenerationResponse](#schema-createagentgenerationresponse)
- **400** Invalid request parameters, `numCards` above the plan maximum, a `templateId` that is not an accessible template or gamma, a `themeId` that is not an available … → —
- **401** Invalid or missing API key → —
- **403** Insufficient credits, a `quality` tier the plan does not include, or access denied → —
- **404** A `files` upload does not exist or has expired → —
- **413** `files` exceed 250 MiB in total → —
- **429** Rate limit exceeded, or the workspace has too many in-flight agent jobs (`code: workspace_concurrency_limit_exceeded`, with a `Retry-After` header) → —
- **503** The service is busy; retry the request → —

### GET /agent/generations/{generationId}

Docs: https://developers.gamma.app/agent-gamma-5/get-agent-generation-status

Retrieves the current status of an agent generation. Poll this endpoint until `status` is "completed" or "failed". The `gamma` object can appear on a pending generation once the document has been created.

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `generationId` | path | string | yes | maxLen: `128`; pattern: `^gen_[A-Za-z0-9]+$` | The generation id returned by `POST /v1.0/agent/generations`. Agent generation ids are prefixed `gen_`. |

- **200** Generation status retrieved successfully → [PendingAgentGenerationResponse](#schema-pendingagentgenerationresponse) / [CompletedAgentGenerationResponse](#schema-completedagentgenerationresponse) / [FailedAgentGenerationResponse](#schema-failedagentgenerationresponse)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **404** Generation not found → —
- **429** Rate limit exceeded → —

### GET /exports/{id}

Docs: https://developers.gamma.app/management/get-export-status

Retrieves the current status of an export job. Poll this endpoint until status is "completed" or "failed".

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | path | string | yes |  | The unique export ID returned from the export endpoint |

- **200** Export status retrieved successfully → [ExportStatusResponse](#schema-exportstatusresponse)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **404** Export not found → —

### GET /folders

Docs: https://developers.gamma.app/workspace/list-folders

Lists the folders the authenticated user can access within the workspace. Some may be view-only. Using a folder as folderId requires edit or full access.

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `query` | query | string |  |  | Search query to filter folders by name |
| `limit` | query | number |  | min: `1`; max: `50` | Maximum number of folders to return |
| `after` | query | string |  |  | Cursor for pagination (from previous response's nextCursor) |

- **200** Folders retrieved successfully → [ListFoldersResponse](#schema-listfoldersresponse)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —

### GET /gammas/search

Docs: https://developers.gamma.app/management/search-gammas

Full-text search over the gammas the caller can access, matched against titles and body text. When a query is provided, results are relevance-ranked. When no query is provided (an empty query with at least one filter), results are ordered by last-updated descending.

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `q` | query | string |  |  | Full-text search query matched against gamma titles and body text. Optional when at least one filter (createdBy, updatedAfter, … |
| `createdBy` | query | string |  |  | Restrict results to gammas created by this user: 'me', an email address, or a user ID. |
| `updatedAfter` | query | string |  |  | ISO-8601 lower bound (inclusive) on the gamma's last-updated time. |
| `updatedBefore` | query | string |  |  | ISO-8601 upper bound (inclusive) on the gamma's last-updated time. |
| `includeArchived` | query | boolean |  |  | When true, archived gammas are included in results. Defaults to false. |
| `limit` | query | number |  | min: `1`; max: `25` | Maximum number of hits to return (1-25) |

- **200** Search results retrieved successfully → [SearchGammasResponse](#schema-searchgammasresponse)
- **400** Invalid query parameters → —
- **401** Invalid or missing credentials → —
- **503** Document search is temporarily unavailable → —

### DELETE /gammas/{gammaId}

Docs: https://developers.gamma.app/management/delete-gamma

Deletes a Gamma document. Requires workspace admin role on the workspace the API key belongs to. The Gamma is auto-archived first if not already archived, so a single call handles the full archive-then-delete transition. The Gamma becomes immediately inaccessible and is removed from all workspace views. After deletion, the Gamma is no longer addressable via the API; subsequent requests for the same ID return the same response as for a non-existent Gamma.

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `gammaId` | path | string | yes |  | The unique ID of the Gamma to delete |

- **200** Gamma deleted successfully → [DeleteGammaResponse](#schema-deletegammaresponse)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **403** Access denied - workspace admin role required → —

### GET /gammas/{gammaId}

Docs: https://developers.gamma.app/management/get-gamma

Returns metadata for a single gamma. Accepts either a file ID or the doc ID from a gamma.app/docs/... URL. Designed for link-preview integrations (Atlassian Smart Links, Notion Link Previews).

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `gammaId` | path | string | yes | minLen: `1`; maxLen: `128`; pattern: `^[A-Za-z0-9_-]+$` | The gamma file ID or the doc ID from the gamma.app/docs/... URL |

- **200** Gamma metadata retrieved successfully → [GetGammaResponse](#schema-getgammaresponse)
- **400** Invalid gamma ID → —
- **401** Invalid or missing credentials → —
- **403** Access denied → —
- **404** Gamma not found → —

### GET /gammas/{gammaId}/analytics

Docs: https://developers.gamma.app/analytics/get-gamma-analytics

Returns doc-level engagement metrics for a Gamma: total views, unique viewers/editors, card count, last opened time, and a 30-day daily unique-viewer breakdown. Requires at least edit permission on the Gamma. When the API key's user has manage permission the metrics cover all viewers (`scope: "all"`); otherwise they cover only that user's own activity (`scope: "self"`). Data is eventually consistent (~hourly).

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `gammaId` | path | string | yes |  | The ID of the Gamma — accepts a gamma (file) ID or a page/doc ID (the ID in a gamma.app/docs/<id> URL). |

- **200** Analytics retrieved successfully → [GammaAnalytics](#schema-gammaanalytics)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **403** Access denied — at least edit permission required; Pro plan or higher required (`code: individual_analytics_required`) → —
- **404** Gamma not found → —

### GET /gammas/{gammaId}/analytics/cards

Docs: https://developers.gamma.app/analytics/get-gamma-card-analytics

Returns per-card engagement data for a Gamma: view time (absolute seconds) and viewer reach (percentage) per card. Requires at least edit permission on the Gamma. When the API key's user has manage permission the data covers all viewers (`scope: "all"`); otherwise it covers only that user's own activity (`scope: "self"`). Data is eventually consistent (~hourly).

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `gammaId` | path | string | yes |  | The ID of the Gamma — accepts a gamma (file) ID or a page/doc ID (the ID in a gamma.app/docs/<id> URL). |

- **200** Card analytics retrieved successfully → [GammaCardAnalytics](#schema-gammacardanalytics)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **403** Access denied — at least edit permission required; Pro plan or higher required (`code: individual_analytics_required`) → —
- **404** Gamma not found → —

### GET /gammas/{gammaId}/analytics/viewers

Docs: https://developers.gamma.app/analytics/get-gamma-viewer-analytics

Returns paginated per-viewer engagement data for a Gamma. Requires at least edit permission on the Gamma. When the API key's user has manage permission the list covers all viewers (`scope: "all"`); otherwise it contains at most that user's own row (`scope: "self"`). Viewers are capped at 500. Data is eventually consistent (~hourly).

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `gammaId` | path | string | yes |  | The ID of the Gamma — accepts a gamma (file) ID or a page/doc ID (the ID in a gamma.app/docs/<id> URL). |
| `limit` | query | number |  | min: `1`; max: `50` | Maximum number of viewers to return |
| `after` | query | string |  |  | Cursor for pagination (from a previous response's nextCursor) |
| `sortDirection` | query | string |  | enum: `asc`, `desc` | Sort direction, applied to the viewer's most recent open time |

- **200** Viewer analytics retrieved successfully → [GammaViewerAnalytics](#schema-gammavieweranalytics)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **403** Access denied — at least edit permission required; Pro plan or higher required (`code: individual_analytics_required`) → —
- **404** Gamma not found → —

### GET /gammas/{gammaId}/analytics/viewers/{userId}

Docs: https://developers.gamma.app/analytics/get-gamma-viewer-detail-analytics

Returns one viewer's engagement with a Gamma: display name, email, last-opened time, cards viewed, and the relative time spent on each card (percentage of that viewer's total view time). Only authenticated viewers are addressable. Requires at least edit permission on the Gamma. When the API key's user has manage permission any viewer is addressable (`scope: "all"`); otherwise only the API key user's own activity is addressable (`scope: "self"`). Data is eventually consistent (~hourly).

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `gammaId` | path | string | yes |  | The ID of the Gamma — accepts a gamma (file) ID or a page/doc ID (the ID in a gamma.app/docs/<id> URL). |
| `userId` | path | string | yes |  | The viewer's user ID — the viewerId returned by the viewers list endpoint for authenticated viewers. |

- **200** Viewer analytics retrieved successfully → [GammaViewerDetailAnalytics](#schema-gammaviewerdetailanalytics)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **403** Access denied — at least edit permission required; manage permission required to address viewers other than yourself; Pro plan or higher required (`code: … → —
- **404** Gamma not found, or no viewer with this user ID → —

### POST /gammas/{gammaId}/archive

Docs: https://developers.gamma.app/management/archive-gamma

Archives a Gamma document. The operation is idempotent - archiving an already archived Gamma succeeds.

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `gammaId` | path | string | yes |  | The unique ID of the Gamma to archive |

- **200** Gamma archived successfully → [ArchiveGammaResponse](#schema-archivegammaresponse)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **403** Access denied - edit permission required → —

### GET /gammas/{gammaId}/comments

Docs: https://developers.gamma.app/management/get-gamma-comments

Returns comment threads on a Gamma, cursor-paginated. Supports an updatedSince filter for efficient delta polling.

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `gammaId` | path | string | yes |  | The ID of the Gamma to list comments for |
| `limit` | query | number |  | min: `1`; max: `50` | Maximum number of comments to return per page |
| `after` | query | string |  |  | Cursor for pagination (from previous response's nextCursor) |
| `updatedSince` | query | string |  |  | ISO-8601 timestamp cursor. When provided, only comment threads with activity (including new replies) after this timestamp are returned — … |
| `includeArchived` | query | boolean |  |  | When true, archived (deleted) comments and replies are included in the response, each carrying an `archived` flag. Defaults to false. |

- **200** Comments retrieved successfully → [ListCommentsResponse](#schema-listcommentsresponse)
- **400** Invalid request parameters (e.g. malformed updatedSince) → —
- **401** Invalid or missing API key → —
- **403** Insufficient permissions — caller must have comment-level access → —
- **404** Gamma not found → —

### POST /gammas/{gammaId}/export

Docs: https://developers.gamma.app/management/export-gamma

Creates an asynchronous export job for an existing Gamma in the requested format. Returns an export ID to poll for the download URL.

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `gammaId` | path | string | yes |  | The ID of the Gamma to export — accepts a gamma (file) ID or a page/doc ID (the id in a gamma.app/docs/<id> URL). |

**Request body** (`application/json`): [CreateExportRequest](#schema-createexportrequest)

- **200** Export job created successfully → [CreateExportResponse](#schema-createexportresponse)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **403** Feature not available for workspace → —
- **404** Gamma not found → —

### POST /generations

Docs: https://developers.gamma.app/generations-classic/create-generation

Creates an asynchronous generation job. Provide either `inputText` for a single-page File, or a `pages` array to generate a multi-page File (optionally published as a Gamma site via `publish`). Returns a generation ID that can be used to poll for status.

**Request body** (`application/json`): [Generation](#schema-generation)

- **200** Generation job created successfully → [CreateGenerationResponse](#schema-creategenerationresponse)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **402** Insufficient credits → —
- **403** Access denied or feature not available → —
- **429** Rate limit exceeded, or a Free workspace has too many pending generation jobs started with an API key (`code: workspace_concurrency_limit_exceeded`, with a … → —

### POST /generations/from-template

Docs: https://developers.gamma.app/generations-classic/create-from-template

Creates an asynchronous generation job from a template Gamma with variable substitution.

**Request body** (`application/json`): [FromTemplateGeneration](#schema-fromtemplategeneration)

- **200** Generation job created successfully → [FromTemplateGenerationResponse](#schema-fromtemplategenerationresponse)
- **400** Invalid request or template not found → —
- **401** Invalid or missing API key → —
- **402** Insufficient credits → —
- **403** Feature not enabled for workspace → —
- **429** Rate limit exceeded, or a Free workspace has too many pending generation jobs started with an API key (`code: workspace_concurrency_limit_exceeded`, with a … → —

### GET /generations/{id}

Docs: https://developers.gamma.app/generations-classic/get-generation-status

Retrieves the current status of a generation job. Poll this endpoint until status is "completed" or "failed".

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | path | string | yes |  | The unique generation ID returned from the create endpoint |

- **200** Generation status retrieved successfully → [GenerationStatusResponse](#schema-generationstatusresponse)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **404** Generation not found → —

### POST /images

Docs: https://developers.gamma.app/images/create-image-generation

Creates an asynchronous image generation job that produces one standalone on-brand image. Returns an image generation ID that can be used to poll for status. If `themeId` is provided but does not exist or is not accessible to your workspace, the request fails with 400.

**Request body** (`application/json`): [CreateImageGeneration](#schema-createimagegeneration)

- **200** Image generation job created successfully → [CreateImageGenerationResponse](#schema-createimagegenerationresponse)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **402** Insufficient credits → —
- **403** Access denied or feature not available → —
- **404** Not found → —
- **429** Rate limit exceeded, or a Free workspace has too many pending generation jobs started with an API key (`code: workspace_concurrency_limit_exceeded`, with a … → —

### POST /images/media/{savedMediaId}/archive

Docs: https://developers.gamma.app/images/archive-image

Removes an item you created (such as a generated image) from the workspace media library. The operation is idempotent - archiving an already archived item succeeds. The underlying file is not deleted: existing URLs continue to work.

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `savedMediaId` | path | string | yes |  | The media library identifier of the item to archive, as returned in `image.savedMediaId` by the image generation status endpoint |

- **200** Item archived successfully → [ArchiveImageResponse](#schema-archiveimageresponse)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **403** Access denied or feature not available → —
- **404** Item not found → —

### GET /images/{id}

Docs: https://developers.gamma.app/images/get-image-generation-status

Retrieves the current status of an image generation job. Poll this endpoint until status is "completed" or "failed".

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | path | string | yes |  | The unique image generation ID returned from the create endpoint |

- **200** Image generation status retrieved successfully → [ImageGenerationStatusResponse](#schema-imagegenerationstatusresponse)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —
- **404** Image generation not found → —

### GET /templates/search

Docs: https://developers.gamma.app/management/search-templates

Search the caller's workspace templates and the official Gamma explore templates. Returns two lists. With a query, workspace templates use best-effort relevance ranking against title and body text and may fall back to last-edited browse order, while explore templates use their best-effort ranking. An empty query returns both lists in browse order. Workspace browse results use last-edited order, most recent first. Workspace template IDs can be passed as the gammaId to generate-from-template, which validates eligibility at generation time and may reject some templates, such as multi-page or …

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `q` | query | string |  | maxLen: `2000` | Search query. Workspace templates use best-effort relevance ranking against title and body text and may fall back to last-edited browse … |
| `limit` | query | number |  | min: `1`; max: `25` | Maximum number of hits to return per list (1-25) |

- **200** Search results retrieved successfully → [SearchTemplatesResponse](#schema-searchtemplatesresponse)
- **400** Invalid query parameters → —
- **401** Invalid or missing credentials → —

### GET /themes

Docs: https://developers.gamma.app/workspace/list-themes

Lists all themes available to the workspace, including standard themes and custom workspace themes.

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `query` | query | string |  |  | Search query to filter themes by name |
| `limit` | query | number |  | min: `1`; max: `50` | Maximum number of themes to return |
| `after` | query | string |  |  | Cursor for pagination (from previous response's nextCursor) |
| `type` | query | string |  | enum: `custom`, `standard` | Filter by theme type: "standard" for built-in themes, "custom" for workspace-created themes. Must be kept consistent across paginated … |

- **200** Themes retrieved successfully → [ListThemesResponse](#schema-listthemesresponse)
- **400** Invalid request parameters → —
- **401** Invalid or missing API key → —

### POST /uploads

Docs: https://developers.gamma.app/agent-gamma-5/create-upload

Stores one file for `files` on `POST /v1.0/agent/generations`. Send the raw bytes as `application/octet-stream` with a `Content-Length` header; chunked and content-encoded bodies are rejected. Files can be up to 250 MiB, and images up to 50 megapixels. Each upload can be attached to one generation. An upload that is never attached expires two days after it was created.

**Parameters**

| Name | In | Type | Req | Constraints | Notes |
|---|---|---|---|---|---|
| `mimeType` | query | string | yes | enum: `application/javascript`, `application/json`, `application/pdf`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`, `application/vnd.openxmlformats-officedocument.presentationml.template`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/xml`, `font/otf`, `font/ttf`, `image/avif`, `image/bmp`, `image/gif`, `image/heic`, `image/heif`, `image/jpeg`, `image/png`, `image/svg+xml`, `image/tiff`, `image/webp`, `text/css`, `text/csv`, `text/html`, `text/markdown`, `text/plain` | The file's media type. It must match the file's contents. |
| `x-harness-upload-name` | header | string | yes |  | The filename, percent-encoded (for example with `encodeURIComponent`) |

**Request body** (`application/octet-stream`): string

- **200** File stored → [CreateUploadResponse](#schema-createuploadresponse)
- **400** A missing `mimeType`, `x-harness-upload-name`, or `Content-Length`; a filename that is not percent-encoded; a body that is not `application/octet-stream`, is … → —
- **401** Invalid or missing API key → —
- **403** Insufficient credits, or the plan does not include the API → —
- **404** Uploads are unavailable → —
- **408** The body arrived too slowly → —
- **413** The file exceeds 250 MiB, or the image exceeds 50 megapixels → —
- **429** Rate limit exceeded → —
- **503** Too many uploads in progress; retry with backoff → —
- **504** Storing the file timed out → —

## Schemas

<a id="schema-agentcreditsresponse"></a>
### AgentCreditsResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `deducted` | number |  |  | Credits recorded as debited from your balance for this job so far: the agent's model and tool spend settled from its ledger plus image generation charged as it … |
| `remaining` | number |  |  | Credits currently available to the authenticated user in this workspace, read when this status was served. Not what this job cost: other jobs, purchases and … |

<a id="schema-agentgenerationerror"></a>
### AgentGenerationError

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `reason` | string | yes | enum: `access_revoked`, `generation_failed`, `insufficient_credits`, `invalid_files`, `timeout`, `unavailable` | Machine-readable failure reason. |
| `message` | string | yes |  | Human-readable explanation. |
| `statusCode` | number | yes |  | HTTP-style status code for the failure reason. |

<a id="schema-agentgenerationfile"></a>
### AgentGenerationFile

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `uploadId` | string | yes |  | Id returned by `POST /v1.0/uploads`. |
| `filename` | string | yes |  | Filename returned by `POST /v1.0/uploads`. |
| `purpose` | string |  | enum: `import` | Omit to give the agent the file as ordinary source material. |

<a id="schema-agentgenerationgamma"></a>
### AgentGenerationGamma

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `gammaId` | string | yes |  | File id of the generated gamma. |
| `gammaUrl` | string | yes |  | Editor URL of the generated gamma. |

<a id="schema-agentgenerationprogress"></a>
### AgentGenerationProgress

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `stages` | [AgentGenerationProgressStages](#schema-agentgenerationprogressstages) | yes |  |  |
| `done` | number | yes |  | Cards finished. |
| `total` | number | yes |  | Cards in the gamma. |
| `percent` | number | yes |  | Estimated completion, 0 to 99. Never decreases within one generation attempt, but can restart lower if the agent retries the generation; `completed` is still … |

<a id="schema-agentgenerationprogressstages"></a>
### AgentGenerationProgressStages

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `queued` | number |  |  |  |
| `writing` | number |  |  |  |
| `imaging` | number |  |  |  |
| `checking` | number |  |  |  |
| `polishing` | number |  |  |  |
| `done` | number |  |  |  |
| `failed` | number |  |  |  |

<a id="schema-agentgenerationresult"></a>
### AgentGenerationResult

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `summary` | string | yes |  | Agent-written summary of what was generated. |

<a id="schema-agentgenerationsharingoptions"></a>
### AgentGenerationSharingOptions

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `workspaceAccess` | string |  | enum: `comment`, `edit`, `fullAccess`, `noAccess`, `view` | Default access level for workspace members |
| `externalAccess` | string |  | enum: `comment`, `edit`, `noAccess`, `view` | Access level for external users (via shared link) |
| `emailOptions` | [EmailOptions](#schema-emailoptions) |  |  | Email sharing configuration |

<a id="schema-agentgenerationwarning"></a>
### AgentGenerationWarning

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `code` | string | yes | enum: `email_full_access_members_only`, `email_invites_failed`, `export_failed`, `external_access_failed`, `folder_placement_failed`, `ignored_email_options`, `ignored_email_recipients`, `ignored_external_access`, `ignored_folder_id`, `ignored_workspace_access`, `workspace_access_failed` | Machine-readable warning code. |
| `message` | string | yes |  | Human-readable explanation, suitable for display. |

<a id="schema-archivegammaresponse"></a>
### ArchiveGammaResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `gammaId` | string | yes |  | The ID of the archived Gamma |
| `archived` | boolean | yes |  | Confirmation that the Gamma is archived |

<a id="schema-archiveimageresponse"></a>
### ArchiveImageResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `savedMediaId` | string | yes |  | The media library identifier of the archived item |
| `archived` | boolean | yes |  | Confirmation that the item is archived |

<a id="schema-cardanalyticsentry"></a>
### CardAnalyticsEntry

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `cardId` | string | yes |  | The card ID within the Gamma |
| `cardName` | string (nullable) | yes |  | Title of the card, or null if the card has no discernible title |
| `cardPosition` | number | yes |  | 1-indexed position of the card within the Gamma |
| `viewTimeSeconds` | number | yes |  | Total view time across all viewers, in seconds |
| `viewersPercent` | number | yes |  | Percentage of unique viewers who viewed this card (0-100) |

<a id="schema-cardoptions"></a>
### CardOptions

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `dimensions` | string |  | enum: `16x9`, `1x1`, `4x3`, `4x5`, `9x16`, `a4`, `fluid`, `letter`, `pageless` | Card aspect ratio/dimensions |
| `headerFooter` | [HeaderFooter](#schema-headerfooter) |  |  | Header and footer configuration |

<a id="schema-commentauthor"></a>
### CommentAuthor

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `id` | string | yes |  | Unique user identifier |
| `name` | string (nullable) | yes |  | Display name of the author, or null if the user has no name set |

<a id="schema-commentitem"></a>
### CommentItem

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `id` | string | yes |  | Unique comment identifier |
| `cardId` | string (nullable) | yes |  | ID of the card this comment is attached to, or null for page-level comments |
| `targetText` | string (nullable) | yes |  | Quoted snippet of the text the comment targets, as plain text |
| `targetHtml` | string (nullable) | yes |  | Quoted snippet of the text the comment targets, as HTML |
| `author` | [CommentAuthor](#schema-commentauthor) | yes |  | Author of the comment |
| `contentText` | string | yes |  | Comment content as plain text — text, @mentions, and emoji, with paragraphs separated by newlines. |
| `status` | string | yes | enum: `closed`, `open` | Comment status: open or closed |
| `archived` | boolean | yes |  | Whether the comment has been archived (deleted) |
| `mentionedUsers` | array of string | yes |  | Users mentioned in this comment (user IDs) |
| `replies` | array of [CommentReply](#schema-commentreply) | yes |  | Threaded replies to this comment |
| `createdTime` | string | yes |  | ISO-8601 timestamp of when the comment was created |
| `updatedTime` | string | yes |  | ISO-8601 timestamp of when the comment was last modified |

<a id="schema-commentreply"></a>
### CommentReply

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `id` | string | yes |  | Unique reply identifier |
| `author` | [CommentAuthor](#schema-commentauthor) | yes |  | Author of the reply |
| `contentText` | string | yes |  | Reply content as plain text — text, @mentions, and emoji, with paragraphs separated by newlines. |
| `mentionedUsers` | array of string | yes |  | Users mentioned in this reply (user IDs) |
| `archived` | boolean | yes |  | Whether the reply has been archived (deleted) |
| `createdTime` | string | yes |  | ISO-8601 timestamp of when the reply was created |
| `updatedTime` | string | yes |  | ISO-8601 timestamp of when the reply was last modified |

<a id="schema-completedagentgenerationresponse"></a>
### CompletedAgentGenerationResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `generationId` | string | yes | pattern: `^gen_[A-Za-z0-9]+$` | Unique id for the generation job, prefixed `gen_`. |
| `status` | string | yes | enum: `completed` |  |
| `gamma` | [AgentGenerationGamma](#schema-agentgenerationgamma) | yes |  |  |
| `result` | [AgentGenerationResult](#schema-agentgenerationresult) | yes |  |  |
| `exportUrl` | string |  |  | Download URL for the exported artifact. Present only when `exportAs` was requested and the export succeeded; a failed export appears as an `export_failed` … |
| `warnings` | array of [AgentGenerationWarning](#schema-agentgenerationwarning) | yes |  | Warnings accumulated during the run. Empty array when there are none. |
| `updatedTime` | string | yes |  | ISO-8601 timestamp of the last state change. |
| `credits` | [AgentCreditsResponse](#schema-agentcreditsresponse) | yes |  | Credit accounting for this job. Present on every completed or failed response; each member is best-effort and omitted when unknown. |

<a id="schema-completededitstatusresponse"></a>
### CompletedEditStatusResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `status` | string | yes | enum: `completed` |  |
| `editId` | string | yes |  | Unique ID for the edit job. |
| `gammaId` | string | yes |  | File ID of the edited Gamma. |
| `gammaUrl` | string | yes |  | URL to the Gamma being edited |
| `pageId` | string | yes |  | ID of the page the edit applies to. |
| `result` | [EditResult](#schema-editresult) | yes |  |  |
| `updatedTime` | string | yes |  | ISO-8601 timestamp of the last state change. |
| `credits` | [AgentCreditsResponse](#schema-agentcreditsresponse) | yes |  | Credit accounting for this job. Present on every completed or failed response; each member is best-effort and omitted when unknown. |

<a id="schema-createagentgeneration"></a>
### CreateAgentGeneration

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `themeId` | string |  | minLen: `1`; maxLen: `128` | Optional saved theme to apply, using an `id` from `GET /v1.0/themes`. The theme is applied on Gamma's Standard Brand Base design for the requested `format`. … |
| `numCards` | integer |  | min: `1`; max: `100` | Target number of cards, capped at the plan's maximum (10 on free plans, 100 on paid plans); a higher value is rejected with 400. Within the cap it is a soft … |
| `sourceUrls` | array of string |  | maxItems: `10` | Up to 10 http or https URLs the agent reads as source material. A link the prompt depends on, such as a Google Slides deck to import or a report to build the … |
| `files` | array of [AgentGenerationFile](#schema-agentgenerationfile) |  |  | Files stored with `POST /v1.0/uploads`, as the `{ uploadId, filename }` that route returned. The agent works from them beside the prompt; a .pptx or .pdf is … |
| `prompt` | string | yes | maxLen: `400000` | The brief: what to generate. The only required field. |
| `folderId` | string |  |  | Folder to place the generated Gamma in, within the caller's workspace. Use an `id` from `GET /v1.0/folders`. |
| `sharingOptions` | [AgentGenerationSharingOptions](#schema-agentgenerationsharingoptions) |  |  | Access settings for the generated Gamma. |
| `format` | string |  | enum: `document`, `presentation`, `social` | Output format. Defaults to "presentation" when omitted. `webpage` is not supported by the agent engine and is rejected. |
| `templateId` | string |  | minLen: `1`; maxLen: `128` | Optional starting point: the id of an accessible workspace template, of a regular gamma in the workspace, or of an official Gamma template (the … |
| `quality` | string |  | enum: `lite`, `max`, `standard` | Quality preset: "lite", "standard", or "max" — the same presets the Gamma app offers. `max` requires a plan that includes it and can use more credits. Omitting … |
| `additionalInstructions` | string |  | minLen: `0`; maxLen: `5000` | Guidance: extra direction for the generation (tone, audience, language, style). Treated as guidance the agent aims to follow, not a constraint the output is … |
| `exportAs` | string |  | enum: `pdf`, `png`, `pptx` | Export the finished gamma after a successful generation as a PDF, PPTX, or PNG zip. Export failure is reported as a warning on the generation, never as a … |
| `disableConnectors` | boolean |  |  | Opt this run out of workspace connector access (e.g. Notion, Slack). |

<a id="schema-createagentgenerationresponse"></a>
### CreateAgentGenerationResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `generationId` | string | yes | pattern: `^gen_[A-Za-z0-9]+$` | Unique id for the generation job, prefixed `gen_`. |
| `status` | string | yes | enum: `pending` | Always "pending" on create. |
| `warnings` | array of [AgentGenerationWarning](#schema-agentgenerationwarning) | yes |  | Request-level warnings. Empty array when there are none. |

<a id="schema-createexportrequest"></a>
### CreateExportRequest

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `exportAs` | string | yes | enum: `pdf`, `png`, `pptx` | File format to export the Gamma to. |

<a id="schema-createexportresponse"></a>
### CreateExportResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `exportId` | string | yes |  | Unique identifier for the export job. Poll `GET /v1.0/exports/:id` with it. |

<a id="schema-creategenerationresponse"></a>
### CreateGenerationResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `generationId` | string | yes |  | Unique identifier for the generation job |
| `warnings` | string |  |  | File-level warnings about the request (e.g., ignored sharing, folder, or dimension options that apply to the whole gamma). |
| `pageWarnings` | array of string |  |  | Page-level warnings, one entry per requested page (index-aligned with the `pages` request array); `null` for a page with none. Each entry contains only that … |

<a id="schema-createimagegeneration"></a>
### CreateImageGeneration

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `type` | string |  | enum: `abstract`, `illustration`, `photo`, `scene`; default: `illustration` | Visual style of the generated images. Defaults to "illustration". Skipped when referenceImages are present — references take precedence and style comes from … |
| `sizePreset` | string |  | enum: `banner`, `slide`, `social-portrait`, `social-square`, `story`; default: `social-square` | Output size preset (sets the aspect ratio; exact pixel dimensions are model-determined). Defaults to "social-square" (1:1). |
| `referenceImages` | array of [ReferenceImage](#schema-referenceimage) |  | maxItems: `4` | Reference images with subject semantics ("put this character or product in the scene"). Maximum 4. When present, they take precedence over `type` and `themeId`. |
| `prompt` | string | yes | maxLen: `5000`; pattern: `\S` | Description of the image to generate. Background treatments ("on white", "contained in a circle") go here. |
| `themeId` | string |  |  | Theme to brand the images with. Defaults to the workspace default theme. Applied for all types except `"scene"`, whose curated style ignores theme colors (a … |

<a id="schema-createimagegenerationresponse"></a>
### CreateImageGenerationResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `imageGenerationId` | string | yes |  | Unique identifier for the image generation job. Poll `GET /v1.0/images/{id}` with this id until status is "completed" or "failed". |
| `warnings` | array of [ImageGenerationWarning](#schema-imagegenerationwarning) |  |  | Warnings known at request time (e.g. a skipped style or theme) |

<a id="schema-createuploadresponse"></a>
### CreateUploadResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `uploadId` | string | yes |  |  |
| `filename` | string | yes |  | Stored filename, derived from `x-harness-upload-name`. |
| `name` | string | yes |  | The filename as sent. |
| `mimeType` | string | yes |  |  |
| `size` | number | yes |  | Size in bytes. |

<a id="schema-creditsresponse"></a>
### CreditsResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `deducted` | number | yes |  | Number of credits deducted for this operation |
| `remaining` | number | yes |  | Remaining credits in the workspace |

<a id="schema-dailyviewentry"></a>
### DailyViewEntry

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `date` | string | yes |  | Calendar date (YYYY-MM-DD) |
| `uniqueViewers` | number | yes |  | Number of unique viewers on this day |

<a id="schema-dailyviews"></a>
### DailyViews

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `dayCount` | number | yes |  | Number of days in the window |
| `timezone` | string | yes |  | IANA timezone used for day boundaries |
| `days` | array of [DailyViewEntry](#schema-dailyviewentry) | yes |  | Per-day viewer counts |

<a id="schema-deletegammaresponse"></a>
### DeleteGammaResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `status` | string | yes | enum: `deleted` | Status of the deletion request. Always `deleted` on success. |
| `gammaId` | string | yes |  | The ID of the deleted Gamma |
| `message` | string | yes |  | Customer-facing message confirming the Gamma has been deleted. |

<a id="schema-editerror"></a>
### EditError

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `reason` | string | yes | enum: `access_revoked`, `edit_failed`, `insufficient_credits`, `target_not_found`, `timeout`, `unavailable`, `unsupported_target` | Machine-readable failure reason. A failed edit may have been partially applied, so inspect the Gamma before retrying. |
| `message` | string | yes |  | Human-readable explanation. |
| `statusCode` | number | yes |  | HTTP-style status code for the failure reason. |

<a id="schema-editgamma"></a>
### EditGamma

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `prompt` | string | yes | maxLen: `10000` | Natural-language instruction describing the edit. |
| `quality` | string |  | enum: `lite`, `max`, `standard` | How much model effort the edit runs with, matching the quality tiers in the Gamma agent UI. `max` requires a plan that includes it and can use more credits. … |
| `disableConnectors` | boolean |  |  | Opt this edit out of workspace connector access (e.g. Notion, Slack). |

<a id="schema-editgammaresponse"></a>
### EditGammaResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `editId` | string | yes |  | Unique ID for the edit job. Poll `GET /v1.0/agent/edits/{editId}` with it. |
| `gammaUrl` | string | yes |  | URL to the Gamma being edited |

<a id="schema-editresult"></a>
### EditResult

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `summary` | string | yes |  | Agent-written summary of the applied changes. |

<a id="schema-emailoptions"></a>
### EmailOptions

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `access` | string |  | enum: `comment`, `edit`, `fullAccess`, `view` | Permission level for email recipients |
| `recipients` | array of string | yes | minItems: `1` | Email addresses to share with |

<a id="schema-errorresponse"></a>
### ErrorResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `message` | string | yes |  | Human-readable error message |
| `statusCode` | number | yes |  | HTTP status code |

<a id="schema-exploretemplatesearchhit"></a>
### ExploreTemplateSearchHit

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `id` | string | yes |  | Template identifier. Not accepted as the gammaId for generate-from-template. |
| `title` | string (nullable) | yes |  | Template title, or null if untitled |
| `url` | string | yes |  | URL to view the template |
| `thumbnailUrl` | string (nullable) | yes |  | Thumbnail image URL, or null if unavailable |
| `previewUrl` | string (nullable) | yes |  | Preview image URL, or null if unavailable |

<a id="schema-exporterror"></a>
### ExportError

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `reason` | string |  | enum: `deck_too_large`, `export_failed`, `no_content`, `render_timeout` | Machine-readable failure reason so callers can react programmatically. `render_timeout` and `export_failed` are transient (safe to retry); `deck_too_large` and … |
| `message` | string | yes |  | Human-readable error message. |
| `statusCode` | number | yes |  | Indicative status code for the failure. |

<a id="schema-exportstatusresponse"></a>
### ExportStatusResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `exportAs` | string | yes | enum: `pdf`, `png`, `pptx` | The requested export format, echoed from the request. Always present — pinned from the original request, so it's returned for every status (`pending`, … |
| `exportId` | string | yes |  | Unique identifier for the export job. |
| `status` | string | yes | enum: `completed`, `failed`, `pending` | Current status of the export job. Poll until "completed" or "failed". |
| `gammaId` | string | yes |  | Canonical file ID of the exported Gamma. Always present. Always the file ID, even when a page/doc ID was supplied as `gammaId` in the export request (it … |
| `exportUrl` | string |  |  | URL to download the exported file (when completed). The file format matches `exportAs`: `pptx` → .pptx, `pdf` → .pdf, `png` → a .zip archive containing one PNG … |
| `error` | [ExportError](#schema-exporterror) |  |  | Error details (when failed). |

<a id="schema-failedagentgenerationresponse"></a>
### FailedAgentGenerationResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `generationId` | string | yes | pattern: `^gen_[A-Za-z0-9]+$` | Unique id for the generation job, prefixed `gen_`. |
| `status` | string | yes | enum: `failed` |  |
| `gamma` | [AgentGenerationGamma](#schema-agentgenerationgamma) |  |  | Present when the document was created before the failure. |
| `error` | [AgentGenerationError](#schema-agentgenerationerror) | yes |  |  |
| `warnings` | array of [AgentGenerationWarning](#schema-agentgenerationwarning) | yes |  | Usually empty: warnings returned on create are not guaranteed to be repeated here, so keep them from the create response. |
| `updatedTime` | string | yes |  | ISO-8601 timestamp of the last state change. |
| `credits` | [AgentCreditsResponse](#schema-agentcreditsresponse) | yes |  | Credit accounting for this job. Present on every completed or failed response; each member is best-effort and omitted when unknown. |

<a id="schema-failededitstatusresponse"></a>
### FailedEditStatusResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `status` | string | yes | enum: `failed` |  |
| `editId` | string | yes |  | Unique ID for the edit job. |
| `gammaId` | string | yes |  | File ID of the Gamma being edited. |
| `gammaUrl` | string | yes |  | URL to the Gamma being edited |
| `pageId` | string | yes |  | ID of the page the edit applies to. |
| `error` | [EditError](#schema-editerror) | yes |  |  |
| `updatedTime` | string | yes |  | ISO-8601 timestamp of the last state change. |
| `credits` | [AgentCreditsResponse](#schema-agentcreditsresponse) | yes |  | Credit accounting for this job. Present on every completed or failed response; each member is best-effort and omitted when unknown. |

<a id="schema-folderitem"></a>
### FolderItem

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `id` | string | yes |  | Unique folder identifier |
| `name` | string | yes |  | Display name of the folder |

<a id="schema-fromtemplategeneration"></a>
### FromTemplateGeneration

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `exportAs` | string |  | enum: `pdf`, `png`, `pptx` | Export format for automatic export after generation |
| `prompt` | string | yes | minLen: `1`; maxLen: `400000` | Text prompt describing what to generate |
| `title` | string |  | minLen: `1`; maxLen: `500` | Custom title for the generated Gamma. If not provided, a title will be automatically generated from the content. |
| `gammaId` | string | yes |  | The File ID of the gamma to be used as a template. The File must contain exactly one Page. |
| `themeId` | string |  |  | Theme ID to apply to the generated Gamma |
| `imageOptions` | [FromTemplateImageOptions](#schema-fromtemplateimageoptions) |  |  | Image generation options |
| `sharingOptions` | [SharingOptions](#schema-sharingoptions) |  |  | Sharing and permissions options |
| `folderId` | string |  |  | Folder to place the generated Gamma in. |
| `folderIds` | array of string |  | maxItems: `1` | Folder to place the generated Gamma in. Accepts at most 1 folder ID. Ignored when folderId is provided. |

<a id="schema-fromtemplategenerationresponse"></a>
### FromTemplateGenerationResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `generationId` | string | yes |  | Unique identifier for the generation job |
| `warnings` | string |  |  | Warnings about the request |

<a id="schema-fromtemplateimageoptions"></a>
### FromTemplateImageOptions

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `model` | [ImageModel](#schema-imagemodel) |  |  | AI model for image generation |
| `style` | string |  | minLen: `0`; maxLen: `5000` | Style description for images |

<a id="schema-gammaanalytics"></a>
### GammaAnalytics

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `scope` | string | yes | enum: `all`, `self` | Which activity the metrics cover: `all` — every viewer of the Gamma (the API key's user has manage permission); `self` — only the API key user's own activity … |
| `gammaId` | string | yes |  | The Gamma (file) ID |
| `totalViews` | number | yes |  | Total number of view events, including repeat opens by the same viewer. |
| `uniqueViewers` | number | yes |  | Total unique viewers (authenticated + anonymous) |
| `uniqueEditors` | number | yes |  | Total unique editors |
| `cardCount` | number | yes |  | Number of cards in the Gamma |
| `lastOpened` | string (nullable) | yes |  | ISO-8601 timestamp of the most recent view, or null if never viewed |
| `dailyViews` | [DailyViews](#schema-dailyviews) | yes |  | Daily unique viewer breakdown (30-day rolling window) |

<a id="schema-gammaauthor"></a>
### GammaAuthor

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `name` | string | yes |  | Display name of the author |
| `avatarUrl` | string (nullable) | yes |  | URL of the author's avatar image, or null if not set |

<a id="schema-gammacardanalytics"></a>
### GammaCardAnalytics

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `scope` | string | yes | enum: `all`, `self` | Which activity the card stats cover: `all` — every viewer of the Gamma (the API key's user has manage permission); `self` — only the API key user's own … |
| `gammaId` | string | yes |  | The Gamma (file) ID |
| `uniqueViewers` | number | yes |  | Total unique viewers for the Gamma |
| `uniqueEditors` | number | yes |  | Total unique editors |
| `cardCount` | number | yes |  | Number of cards in the Gamma |
| `cards` | array of [CardAnalyticsEntry](#schema-cardanalyticsentry) | yes |  | Per-card engagement stats for every card in the Gamma, ordered by card position. Cards with no recorded activity have zeroed stats. |

<a id="schema-gammasearchhit"></a>
### GammaSearchHit

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `id` | string | yes |  | Unique gamma identifier |
| `title` | string (nullable) | yes |  | Gamma title, or null if untitled |
| `url` | string | yes |  | URL to view the gamma |
| `highlight` | string (nullable) | yes |  | Query-centered snippet from the gamma's text, or null when no snippet is available (e.g. filter-only browse) |
| `createdBy` | string (nullable) | yes |  | Display name of the gamma's creator, or null if unavailable |
| `updatedTime` | string (nullable) | yes |  | ISO-8601 timestamp of when the gamma was last modified |
| `archived` | boolean | yes |  | True when the hit is an archived gamma (only possible with includeArchived) |

<a id="schema-gammavieweranalytics"></a>
### GammaViewerAnalytics

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `scope` | string | yes | enum: `all`, `self` | Which viewers the rows cover: `all` — every viewer of the Gamma (the API key's user has manage permission); `self` — at most the API key user's own row (edit … |
| `gammaId` | string | yes |  | The Gamma (file) ID |
| `data` | array of [ViewerAnalyticsEntry](#schema-vieweranalyticsentry) | yes |  | Viewer engagement rows |
| `hasMore` | boolean | yes |  | Whether more viewers exist beyond this page |
| `nextCursor` | string (nullable) | yes |  | Cursor for fetching the next page (null if no more results) |

<a id="schema-gammaviewerdetailanalytics"></a>
### GammaViewerDetailAnalytics

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `scope` | string | yes | enum: `all`, `self` | Which viewers are addressable: `all` — any viewer of the Gamma (the API key's user has manage permission); `self` — only the API key user's own activity (edit … |
| `gammaId` | string | yes |  | The Gamma (file) ID |
| `userId` | string | yes |  | The viewer's user ID |
| `displayName` | string (nullable) | yes |  | Display name of the viewer |
| `email` | string (nullable) | yes |  | Email of the viewer |
| `lastOpened` | string (nullable) | yes |  | ISO-8601 timestamp of the viewer's most recent Gamma open/view, or null if unknown |
| `cardsViewed` | number | yes |  | Number of cards this viewer has viewed, counting only cards currently in the Gamma |
| `cardCount` | number | yes |  | Total number of cards in the Gamma (the denominator for cardsViewed) |
| `perCardTimeSpent` | array of [ViewerCardTimeSpent](#schema-viewercardtimespent) | yes |  | Relative time spent per card, as a percentage of this viewer's total view time on the Gamma. Covers every card in the Gamma, ordered by card position; cards … |

<a id="schema-generatedimage"></a>
### GeneratedImage

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `url` | string | yes |  | CDN URL of the generated image |
| `width` | number | yes |  | Image width in pixels |
| `height` | number | yes |  | Image height in pixels |
| `format` | string | yes |  | File format of the generated image. Output is model-native (commonly "png" or "webp") — it is not converted. |
| `mimeType` | string | yes |  | MIME type of the generated image |
| `transparency` | boolean | yes |  | Whether the image has an alpha channel |
| `aspectRatioUsed` | string | yes |  | The aspect ratio the image was generated at |
| `savedMediaId` | string |  |  | Identifier of the image in the Gamma media library |

<a id="schema-generation"></a>
### Generation

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `textMode` | string |  | enum: `condense`, `generate`, `preserve` | How to interpret the input text |
| `pages` | array of [PageGeneration](#schema-pagegeneration) |  | minItems: `1`; maxItems: `50` | Generate multiple pages in a single File. When provided, takes precedence over the top-level per-page fields (`inputText`, `textMode`, `numCards`, `format`, … |
| `format` | string |  | enum: `document`, `presentation`, `social`, `webpage` | Output format for the generated Gamma |
| `cardSplit` | string |  | enum: `auto`, `inputTextBreaks` | How to split content across cards |
| `exportAs` | string |  | enum: `pdf`, `png`, `pptx` | Export format for automatic export after generation |
| `inputText` | string |  | minLen: `1`; maxLen: `400000` | The text content to generate from (topic, outline, or full content) |
| `title` | string |  | minLen: `1`; maxLen: `500` | Custom title for the generated Gamma. If not provided, a title will be automatically generated from the content. |
| `additionalInstructions` | string |  | minLen: `0`; maxLen: `5000` | Additional instructions for the AI |
| `publish` | boolean |  |  | If true, publishes the generated File as a Gamma site after all pages succeed. Applies to multi-page (`pages`) requests. |
| `numCards` | number |  | min: `1` | Target number of cards/slides to generate |
| `themeId` | string |  |  | Theme ID to apply (from /themes endpoint) |
| `textOptions` | [TextOptions](#schema-textoptions) |  |  | Text generation options |
| `imageOptions` | [ImageOptions](#schema-imageoptions) |  |  | Image generation and selection options |
| `cardOptions` | [CardOptions](#schema-cardoptions) |  |  | Card dimensions and layout options |
| `sharingOptions` | [SharingOptions](#schema-sharingoptions) |  |  | Sharing and permissions options |
| `folderId` | string |  |  | Folder to place the generated Gamma in. |
| `folderIds` | array of string |  | maxItems: `1` | Folder to place the generated Gamma in. Accepts at most 1 folder ID. Ignored when folderId is provided. |

<a id="schema-generationstatusresponse"></a>
### GenerationStatusResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `generationId` | string | yes |  | Unique identifier for the generation job |
| `status` | string | yes | enum: `completed`, `failed`, `pending` | Current status of the generation job |
| `gammaId` | string |  |  | File ID of the generated Gamma (when completed) |
| `gammaUrl` | string |  |  | URL to the generated Gamma (when completed) |
| `error` | [ErrorResponse](#schema-errorresponse) |  |  | Error details (when failed) |
| `exportUrl` | string |  |  | URL to download the exported file (when exportAs was specified). The file format matches exportAs: `pptx` → .pptx, `pdf` → .pdf, `png` → a .zip archive … |
| `credits` | [CreditsResponse](#schema-creditsresponse) |  |  | Credit usage information |
| `pages` | array of [PageGenerationResult](#schema-pagegenerationresult) |  |  | Per-page results for multi-page generations. Only present when the generation was created with a `pages` array. |

<a id="schema-getgammaresponse"></a>
### GetGammaResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `id` | string | yes |  | Unique gamma identifier (file ID) |
| `title` | string | yes |  | Gamma title |
| `type` | string | yes | enum: `regular`, `template` | Gamma type: 'template' or 'regular' |
| `url` | string | yes |  | Canonical URL to view the gamma |
| `thumbnailUrl` | string (nullable) | yes |  | Screenshot URL, or null if unavailable. Usually signed so it loads without a Gamma session; a signed URL expires after about 7 days, so re-fetch it rather than … |
| `description` | string (nullable) | yes |  | Description or preview text for the gamma, or null if unavailable |
| `author` | [GammaAuthor](#schema-gammaauthor) (nullable) | yes |  | Author of the gamma, or null if unavailable |
| `createdTime` | string (nullable) | yes |  | ISO-8601 timestamp of when the gamma was created, or null if unavailable |
| `updatedTime` | string (nullable) | yes |  | ISO-8601 timestamp of when the gamma was last modified, or null if unavailable |
| `themeId` | string (nullable) | yes |  | ID of the theme applied to the gamma, or null if no theme is set |
| `archived` | boolean | yes |  | Whether the gamma is archived |

<a id="schema-headerfooter"></a>
### HeaderFooter

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `topLeft` | [HeaderFooterElement](#schema-headerfooterelement) |  |  | Element in top-left position |
| `topCenter` | [HeaderFooterElement](#schema-headerfooterelement) |  |  | Element in top-center position |
| `topRight` | [HeaderFooterElement](#schema-headerfooterelement) |  |  | Element in top-right position |
| `bottomLeft` | [HeaderFooterElement](#schema-headerfooterelement) |  |  | Element in bottom-left position |
| `bottomCenter` | [HeaderFooterElement](#schema-headerfooterelement) |  |  | Element in bottom-center position |
| `bottomRight` | [HeaderFooterElement](#schema-headerfooterelement) |  |  | Element in bottom-right position |
| `hideFromFirstCard` | boolean |  |  | Hide header/footer from the first card (title card) |
| `hideFromLastCard` | boolean |  |  | Hide header/footer from the last card |

<a id="schema-headerfooterelement"></a>
### HeaderFooterElement

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `type` | string | yes | enum: `cardNumber`, `image`, `text` | Type of element to display |
| `source` | string |  | enum: `custom`, `themeLogo` | Image source type (required when type is "image") |
| `src` | string |  | minLen: `1`; maxLen: `2048` | Custom image URL (required when source is "custom") |
| `value` | string |  | minLen: `1`; maxLen: `500` | Text content (required when type is "text") |
| `size` | string |  | enum: `lg`, `md`, `sm`, `xl` | Size of the image element |

<a id="schema-imagegenerationstatusresponse"></a>
### ImageGenerationStatusResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `imageGenerationId` | string | yes |  | Unique identifier for the image generation job |
| `status` | string | yes | enum: `completed`, `failed`, `pending` | Current status of the image generation job |
| `image` | [GeneratedImage](#schema-generatedimage) |  |  | The generated image (present when completed) |
| `warnings` | array of [ImageGenerationWarning](#schema-imagegenerationwarning) |  |  | Warnings about how the request was interpreted (e.g. a skipped style or theme) |
| `error` | [ErrorResponse](#schema-errorresponse) |  |  | Error details (when failed) |
| `credits` | [CreditsResponse](#schema-creditsresponse) |  |  | Credit usage information |

<a id="schema-imagegenerationwarning"></a>
### ImageGenerationWarning

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `code` | string | yes | enum: `curated_style_skipped_for_references`, `no_brand_theme_applied`, `theme_ignored_for_type`, `theme_skipped_for_references` | Machine-readable warning code |
| `message` | string | yes |  | Human-readable explanation |

<a id="schema-imagemodel"></a>
### ImageModel

AI model to use for image generation

_Type: string — enum: `dall-e-3`, `flux-1-pro`, `flux-1-quick`, `flux-1-ultra`, `flux-2-flex`, `flux-2-klein`, `flux-2-max`, `flux-2-pro`, `flux-kontext-fast`, `flux-kontext-max`, `flux-kontext-pro`, `gemini-2.5-flash-image`, `gemini-3-pro-image`, `gemini-3-pro-image-hd`, `gemini-3.1-flash-image`, `gemini-3.1-flash-image-hd`, `gemini-3.1-flash-image-mini`, `gpt-image-1-high`, `gpt-image-1-medium`, `gpt-image-1-mini-high`, `gpt-image-1-mini-low`, `gpt-image-1-mini-medium`, `gpt-image-2`, `gpt-image-2-hd`, `gpt-image-2-mini`, `ideogram-v3`, `ideogram-v3-quality`, `ideogram-v3-turbo`, `leonardo-motion-2`, `leonardo-motion-2-fast`, `leonardo-phoenix`, `recraft-v3`, `recraft-v3-svg`, `recraft-v4`, `recraft-v4-pro`, `recraft-v4-svg`, `veo-3.1`, `veo-3.1-fast`_

<a id="schema-imageoptions"></a>
### ImageOptions

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `model` | [ImageModel](#schema-imagemodel) |  |  | AI model to use for image generation |
| `source` | string |  | enum: `aiGenerated`, `giphy`, `noImages`, `pexels`, `pictographic`, `placeholder`, `themeAccent`, `webAllImages`, `webFreeToUse`, `webFreeToUseCommercially` | Source for images: AI-generated or web search |
| `style` | string |  | minLen: `0`; maxLen: `5000` | Style description for AI-generated images |

<a id="schema-listcommentsresponse"></a>
### ListCommentsResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `data` | array of [CommentItem](#schema-commentitem) | yes |  | Array of comment threads |
| `hasMore` | boolean | yes |  | Whether more results exist beyond this page |
| `nextCursor` | string (nullable) | yes |  | Cursor for fetching the next page (null if no more results) |

<a id="schema-listfoldersresponse"></a>
### ListFoldersResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `data` | array of [FolderItem](#schema-folderitem) | yes |  | Array of folder items |
| `hasMore` | boolean | yes |  | Whether more results exist beyond this page |
| `nextCursor` | string (nullable) | yes |  | Cursor for fetching the next page (null if no more results) |

<a id="schema-listthemesresponse"></a>
### ListThemesResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `data` | array of [ThemeItem](#schema-themeitem) | yes |  | Array of theme items |
| `hasMore` | boolean | yes |  | Whether more results exist beyond this page |
| `nextCursor` | string (nullable) | yes |  | Cursor for fetching the next page (null if no more results) |

<a id="schema-pagegeneration"></a>
### PageGeneration

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `textMode` | string |  | enum: `condense`, `generate`, `preserve` | How to interpret this page's input text |
| `format` | string |  | enum: `document`, `presentation`, `social`, `webpage` | Output format for this page |
| `cardSplit` | string |  | enum: `auto`, `inputTextBreaks` | How to split content across cards for this page |
| `title` | string |  | minLen: `1`; maxLen: `500` | Custom title for this page. If not provided, a title will be automatically generated from the content. |
| `inputText` | string | yes | minLen: `1`; maxLen: `400000` | The text content to generate from (topic, outline, or full content) |
| `additionalInstructions` | string |  | minLen: `0`; maxLen: `5000` | Additional instructions for the AI for this page |
| `numCards` | number |  | min: `1` | Target number of cards for this page |
| `path` | string |  | minLen: `1`; maxLen: `500` | URL slug for this page within the published site. When omitted, Gamma derives a slug from the generated title and disambiguates collisions. Honored for … |
| `textOptions` | [TextOptions](#schema-textoptions) |  |  | Text generation options for this page |
| `imageOptions` | [ImageOptions](#schema-imageoptions) |  |  | Image generation and selection options for this page |

<a id="schema-pagegenerationresult"></a>
### PageGenerationResult

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `gammaId` | string | yes |  | Doc ID of this page within the File. |
| `gammaUrl` | string | yes |  | Direct URL to this page. |
| `status` | string | yes | enum: `completed`, `failed`, `pending` | Current status of this page's generation. |
| `error` | [ErrorResponse](#schema-errorresponse) |  |  | Error details if this page failed. |
| `exportUrl` | string |  |  | URL to download this page's exported file (present only when `exportAs` was specified). Each page is exported independently; the file format matches `exportAs` … |

<a id="schema-pendingagentgenerationresponse"></a>
### PendingAgentGenerationResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `generationId` | string | yes | pattern: `^gen_[A-Za-z0-9]+$` | Unique id for the generation job, prefixed `gen_`. |
| `status` | string | yes | enum: `pending` |  |
| `gamma` | [AgentGenerationGamma](#schema-agentgenerationgamma) |  |  | Can appear once the document has been created. |
| `progress` | [AgentGenerationProgress](#schema-agentgenerationprogress) |  |  | Can appear once the agent starts building cards. |
| `warnings` | array of [AgentGenerationWarning](#schema-agentgenerationwarning) | yes |  | Always empty while pending. Request-level warnings are returned on create and again on the completed response. |
| `updatedTime` | string | yes |  | ISO-8601 timestamp of the last state change. |

<a id="schema-pendingeditstatusresponse"></a>
### PendingEditStatusResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `status` | string | yes | enum: `pending` |  |
| `editId` | string | yes |  | Unique ID for the edit job. |
| `gammaId` | string | yes |  | File ID of the Gamma being edited. |
| `gammaUrl` | string | yes |  | URL to the Gamma being edited |
| `pageId` | string | yes |  | ID of the page the edit applies to. |
| `updatedTime` | string | yes |  | ISO-8601 timestamp of the last state change. |

<a id="schema-referenceimage"></a>
### ReferenceImage

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `url` | string | yes | pattern: `^https://` | HTTPS URL of the reference image. The server fetches, validates, and rehosts the image before generation. |
| `role` | string |  | enum: `subject` | How the reference influences generation. `subject` places the pictured character or product into the generated scene. |

<a id="schema-searchgammasresponse"></a>
### SearchGammasResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `hits` | array of [GammaSearchHit](#schema-gammasearchhit) | yes |  | Array of hits, relevance-ranked when a query is provided and ordered by last-updated descending otherwise |

<a id="schema-searchtemplatesresponse"></a>
### SearchTemplatesResponse

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `workspaceTemplates` | array of [WorkspaceTemplateSearchHit](#schema-workspacetemplatesearchhit) | yes |  | Hits from the caller's workspace templates. With a query, hits use best-effort relevance ranking and may fall back to last-edited browse order. Without a … |
| `workspaceDegraded` | boolean |  |  | True when workspace relevance ranking failed and workspaceTemplates use last-edited browse order. Omitted otherwise. |
| `exploreTemplates` | array of [ExploreTemplateSearchHit](#schema-exploretemplatesearchhit) | yes |  | Hits from the official Gamma templates, relevance-ranked when a query is provided. Ranking is best-effort. Not accepted as the gammaId for … |

<a id="schema-sharingoptions"></a>
### SharingOptions

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `workspaceAccess` | string |  | enum: `comment`, `edit`, `fullAccess`, `noAccess`, `view` | Default access level for workspace members |
| `externalAccess` | string |  | enum: `comment`, `edit`, `noAccess`, `view` | Access level for external users (via shared link) |
| `emailOptions` | [EmailOptions](#schema-emailoptions) |  |  | Email sharing configuration |

<a id="schema-textoptions"></a>
### TextOptions

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `amount` | string |  | enum: `brief`, `detailed`, `extensive`, `medium` | Controls the amount of text generated per card |
| `language` | string |  | enum: `af`, `ar`, `ar-sa`, `bg`, `bn`, `bs`, `ca`, `cs`, `cy`, `da`, `de`, `el`, `en`, `en-gb`, `en-in`, `es`, `es-419`, `es-es`, `es-mx`, `et`, `fa`, `fi`, `fr`, `gu`, `ha`, `he`, `hi`, `hr`, `hu`, `id`, `is`, `it`, `ja`, `ja-da`, `kk`, `kn`, `ko`, `lt`, `lv`, `mk`, `ml`, `mr`, `ms`, `nb`, `nl`, `pl`, `pt-br`, `pt-pt`, `ro`, `ru`, `sl`, `sq`, `sr`, `sv`, `sw`, `ta`, `te`, `th`, `tl`, `tr`, `uk`, `ur`, `uz`, `vi`, `yo`, `zh-cn`, `zh-tw` | Language code for the generated content |
| `tone` | string |  | minLen: `0`; maxLen: `500` | The tone or writing style for the generated text |
| `audience` | string |  | minLen: `0`; maxLen: `500` | The target audience for the content |

<a id="schema-themeitem"></a>
### ThemeItem

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `id` | string | yes |  | Unique theme identifier |
| `name` | string | yes |  | Display name of the theme |
| `colorKeywords` | array of string |  |  | Keywords describing the theme's color palette |
| `toneKeywords` | array of string |  |  | Keywords describing the theme's tone/style |
| `type` | string | yes | enum: `custom`, `standard` | Theme type: standard (built-in) or custom (workspace-created) |

<a id="schema-vieweranalyticsentry"></a>
### ViewerAnalyticsEntry

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `viewerId` | string | yes |  | Stable viewer identifier. For authenticated viewers this is their user ID; for anonymous viewers this is their anonymous ID. |
| `displayName` | string (nullable) | yes |  | Display name of the viewer, or null for anonymous viewers |
| `email` | string (nullable) | yes |  | Email of the viewer, or null for anonymous viewers |
| `lastOpened` | string (nullable) | yes |  | ISO-8601 timestamp of the viewer's most recent Gamma open/view, or null if unknown |
| `cardsViewed` | number | yes |  | Number of cards the viewer has viewed |

<a id="schema-viewercardtimespent"></a>
### ViewerCardTimeSpent

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `cardId` | string | yes |  | The card ID within the Gamma |
| `cardName` | string (nullable) | yes |  | Title of the card, or null if the card has no discernible title |
| `cardPosition` | number | yes |  | 1-indexed position of the card within the Gamma |
| `viewTimePercent` | number | yes |  | Percentage of this viewer's total view time on the Gamma that was spent on this card (0-100). Sums to ~100 across the cards the viewer has seen. |

<a id="schema-workspacetemplatesearchhit"></a>
### WorkspaceTemplateSearchHit

| Field | Type | Req | Constraints | Notes |
|---|---|---|---|---|
| `id` | string | yes |  | Template identifier, to pass as the gammaId to generate-from-template |
| `title` | string (nullable) | yes |  | Template title, or null if untitled |
| `url` | string | yes |  | URL to view the template |
| `previewUrl` | string (nullable) | yes |  | Screenshot URL, or null if unavailable. Usually signed so it loads without a Gamma session; a signed URL expires after about 7 days, so re-fetch it rather than … |

