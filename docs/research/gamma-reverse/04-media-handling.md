# How Gamma handles media

> Part of the Gamma reverse-engineering set: [index](README.md)

Date: 2026-11-05. Scope: images, accent images, logos, charts, diagrams, GIFs, videos and embeds in Gamma Classic (`POST /generations`, `POST /generations/from-template`), the Gamma 5 agent (`POST /agent/generations`), the standalone image API (`POST /images`), the MCP server, and the editor as observed in this repo's hands-on sessions.

Markers:

- 🟢 **Confirmed**: stated in Gamma's developer docs (developers.gamma.app, `llms-full.txt` and the OpenAPI blocks, fetched 2026-11-05), or observed hands-on in this repo's Gamma sessions (linked).
- 🟡 **Inferred**: deduced from documented behaviour, field shapes, error codes or observed output; the evidence is named.
- 🔴 **Unknown**: not knowable from the public docs or the sessions we ran.

gamma.app sits behind a Cloudflare challenge. It was not bypassed, so nothing here comes from the app's bundle or network traffic. 🟢

---

## 0. Summary

| # | Finding | Marker |
|---|---|---|
| 1 | Classic generation picks one image source per page: AI generation (the default), four stock or web sources, the theme's accent images, empty placeholders, or none. | 🟢 [gen] |
| 2 | `model` and `style` apply only to `aiGenerated`. With any other source they are dropped, with a warning. | 🟢 [gen], [warn] |
| 3 | Accent images (large decorative images) are placed by Gamma. The API cannot control whether a card gets one, where it goes or which image is used. | 🟢 [gen] |
| 4 | Your own images enter as **bare HTTPS URLs** in the input text. Gamma fetches each one, re-hosts it on its CDN, and **silently skips** any it cannot fetch. | 🟢 [imgurl] |
| 5 | There are 34 still-image models in four tiers (2–125 credits per image). Four video model ids are in the enum but do not generate video. | 🟢 [models] |
| 6 | `POST /images` makes one standalone on-brand image. It takes up to 4 subject reference images, and the result goes into the workspace media library. Archiving an item does not break its URL. | 🟢 [postimg], [arch] |
| 7 | The Gamma 5 agent picks its own image sources and models. Neither can be pinned per request, and URLs in its prompt are **not guaranteed** to be fetched. | 🟢 [mig], [scope] |
| 8 | Charts, tables and diagrams are native editable blocks prompted through text, with no chart parameters. On PPTX export, formulas and some diagram bases turned into PNGs in the decks we checked. | 🟢 [charts]; 🟢 observed [tpl1st] |
| 9 | In the decks we observed, most pictures were decorative: photos, icons, card backgrounds, divider lines and formula bitmaps. Information was carried by native tables, grids and diagrams, not by AI pictures. | 🟢 observed [fz], [fix], [tpl1st] |

---

## 1. Image sources (`imageOptions.source`)

### 1.1 The ten source values

`imageOptions.source` is optional and **defaults to `aiGenerated`**. 🟢 [gen] The OpenAPI enum and the MCP `generate` tool list the same ten values. 🟢 [gen], [mcp]

| Value | Documented behaviour | Licensing as documented | `model` / `style` apply? | Marker |
|---|---|---|---|---|
| `aiGenerated` (default) | Text-to-image generation | Not stated | **Yes**, the only source where they apply | 🟢 [gen] |
| `pictographic` | Pulls images from Pictographic | Not stated | No | 🟢 [gen] |
| `pexels` | Gets images from Pexels | Not stated | No | 🟢 [gen] |
| `giphy` | Gets **GIFs** from Giphy | Not stated | No | 🟢 [gen] |
| `webAllImages` | The most relevant web images | "Even if licensing is unknown" | No | 🟢 [gen] |
| `webFreeToUse` | Web images | Licensed for **personal** use | No | 🟢 [gen] |
| `webFreeToUseCommercially` | Web images | Licensed for **commercial** use (Gamma's example: a sales pitch) | No | 🟢 [gen] |
| `themeAccent` | Accent images from the selected theme | Theme-owned | No | 🟢 [gen] |
| `placeholder` | Image placeholders to fill in by hand later | n/a | No | 🟢 [gen] |
| `noImages` | No images. Use it when you supply your own URLs and want only those. | n/a | No | 🟢 [gen] |

- Sending `model` or `style` with a source other than `aiGenerated` does not fail the request. The response carries a warning that both are ignored. 🟢 [warn]
- `imageOptions.style` is free text of 1–5,000 characters. Gamma recommends setting it even to one word (for example "photorealistic"), so the generated images look consistent across the deck. 🟢 [gen]
- `imageOptions.model` is optional; if it is omitted, Gamma picks a model. 🟢 [gen]
- The MCP `generate` tool adds a `stylePreset` enum (`photorealistic`, `illustration`, `abstract`, `3D`, `lineArt`, `custom`), and `style` is used when the preset is `custom` or omitted. 🟢 [mcp] The changelog for 2026-02-27 announces a new `stylePreset` parameter. 🟢 [changelog] The REST `ImageOptions` schema in the merged OpenAPI has only `model`, `source` and `style`, so whether REST accepts `stylePreset` is 🔴.
- The "Explore the API" quick table gives `aiGenerated`, `webFreeToUseCommercially` and `noImages` as the example values. 🟢 [explore]
- With multi-page `pages`, `imageOptions` is a per-page field: each page's settings take precedence over the top-level ones. 🟢 [gen]

### 1.2 Gating

| Question | What the sources say | Marker |
|---|---|---|
| Are any sources Free-only or paid-only? | No source is documented as plan-gated. | 🔴 |
| Are AI image models gated? | Free gets "only the models your plan includes"; higher plans unlock more model tiers. | 🟢 [price] |
| What a plan-limit failure returns (MCP) | `planLimitExceeded`, plus `currentPlanLimits.availableImageModels`. Plan-limit failures include "image models or reference images that the plan does not include". | 🟢 [mcp] |
| Which models Free gets | The docs' example failure payload is a `free` workspace with `availableImageModels: ["flux-1-quick", "flux-2-klein"]`. It is an illustrative example, not a stated entitlement. | 🟡 from [mcp] example |
| Concurrency | On Free workspaces, too many pending Classic, template or image generation jobs started with an API key return `429 workspace_concurrency_limit_exceeded` with `Retry-After`. | 🟢 [price], [err] |

### 1.3 Templates and the agent

| Path | How the image source is chosen | Marker |
|---|---|---|
| Classic from-template | New images automatically **match the template's original source**: a template built with Pictographic images gets new Pictographic images. `FromTemplateImageOptions` has only `model` and `style`, with no `source`; they override AI image settings only for templates that use AI images. | 🟢 [tpl], OpenAPI |
| MCP `generate_from_template` | `imageOptions` takes `{model, style}`: "AI image overrides for templates that use AI-generated images". | 🟢 [mcp] |
| Gamma 5 agent | No `imageOptions` field. "The agent chooses image sources and models"; describe the style in `additionalInstructions`. You **cannot pin a model or turn off a source** from the request. | 🟢 [mig] |
| Agent plan UI | The Plan's "Look and feel" area shows **Image source: AI images** by default; the same menu offers **Image placeholders**. | 🟢 observed [alpha] |
| Agent plan UI | The outline review step lets the user change the template and the image source before **Generate**. | 🟢 observed [outline] |
| Agent "My calls to check" | In one run the agent listed an **Imagery** assumption ("few; the pipeline and five-stock example as charts and tables") next to its Language and Code assumptions, for the user to check. | 🟢 observed [alpha] |

---

## 2. Accent images

### 2.1 What the docs say

| Aspect | Documented behaviour | Marker |
|---|---|---|
| Definition | Large decorative images that make cards look better | 🟢 [gen] |
| Control | **Placed automatically; cannot be directly controlled through the API** | 🟢 [gen] |
| **Whether** | Gamma's AI decides per card whether to include one | 🟢 [gen] |
| **Where** | Gamma decides the position: **left, right, top or background** | 🟢 [gen] |
| **What** | Gamma picks the image "based on your content and `imageOptions` settings" | 🟢 [gen] |
| Dimensions | Placement works best with fixed-dimension formats such as `16x9` presentations | 🟢 [gen] |
| Workaround | For more control, put specific image URLs in `inputText` | 🟢 [gen] |
| Theme source | `themeAccent` fills images from the theme's own accent images | 🟢 [gen] |
| Listing a theme's accent images | `GET /themes` returns `id`, `name`, `colorKeywords`, `toneKeywords` and `type`, with no accent-image list | 🟢 OpenAPI `ThemeItem`; how many accent images a theme has is 🔴 |

### 2.2 What the editor shows

| Control | Observation | Marker |
|---|---|---|
| Layouts ▾, Standard layouts | Five choices: no accent, top band, left image, right image, background image (recorded as No / Top / Left / Right / Background) | 🟢 observed [queue], [alpha] |
| Suggested layouts | After about 2–4 s of "Finding layouts that fit", 5 thumbnails of **the same card with the same content in different arrangements**, plus "Show more layouts" | 🟢 observed [alpha] |
| Suggested layouts, intent | Re-arranges without rewriting text. Only previewed ([queue] §4, [alpha] §27.8); no candidate was applied in either run. | 🟢 observed |
| Card-level text + image split | In one Gamma 5 deck, pages 1, 4 and 10 used a text/image split at 63/37, 30/70 and 67/33, with the image at full height (624 px on a 1280 × 720 logical canvas) | 🟢 observed [alpha] |
| Styles panel | Whole-deck styles: Themes, Fonts, Colors, **Logo**, Design / Button design, **Charts**, **Images**, Custom styling | 🟢 observed [queue], [tpl1st], [alpha] |
| Styles → Images | The panel was opened and read, but no image style was applied, so what it controls is 🔴 | 🟢 observed (existence) |

### 2.3 Inference

- An accent slot is part of the card **layout**, not a content block: the API positions (left/right/top/background) match the editor's Standard layouts one to one, and switching layouts keeps the text. 🟡 from [gen] + [alpha]
- The fixed-ratio advice suggests the accent's crop and size are computed against the card frame. A fluid card that grows with its content gives no stable frame. 🟡 from [gen]

---

## 3. Your own images (user-supplied URLs)

### 3.1 The URL preprocessor (Classic `inputText` and template `prompt`)

| Rule | Detail | Marker |
|---|---|---|
| Where | Put raw URLs in `inputText` (Generate) or `prompt` (from-template), where each image should appear | 🟢 [imgurl], [gen], [tpl] |
| Scheme | **HTTPS only**; HTTP URLs are ignored | 🟢 [imgurl] |
| Extension | The path must end in `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`, `.heic`, `.heif` or `.avif` | 🟢 [imgurl] |
| Query strings | Allowed: the extension is matched **before the `?`** (`photo.jpg?width=800` works) | 🟢 [imgurl] |
| Access | Public: no auth headers, login walls or IP restrictions | 🟢 [imgurl] |
| Position | Inline in a sentence or on its own line; Gamma scans for **whitespace-separated** URLs | 🟢 [imgurl] |
| Several images | Several URLs in a row are allowed (the docs' example mixes `.jpg`, `.png` and `.webp`) | 🟢 [imgurl] |
| Wrapped URLs | `![alt](url)` Markdown is **skipped by the preprocessor**; `<img src>` HTML fails; use the raw URL | 🟢 [imgurl] |
| No extension | `https://example.com/image` fails; so does `.pdf` | 🟢 [imgurl] |
| Gallery and display | Display instructions go in `additionalInstructions`, e.g. "Group the last 10 images into a gallery"; Gamma's tips also mention "use a gallery layout for the product images" | 🟢 [gen], [tpl] |
| Template replace | In from-template, a prompt like "use this logo to replace the placeholder image on the title slide", with the URL in the prompt | 🟢 [tpl] |
| Charts as images | The charts guide points to the image URL guide "if you want to include your own chart images" | 🟢 [charts] |

### 3.2 Fetch, re-host and failure modes

| Step / case | Behaviour | Marker |
|---|---|---|
| 1. Detect | Matched by format (the rules above) | 🟢 [imgurl] |
| 2. Fetch | Fetched from your URL during generation | 🟢 [imgurl] |
| 3. Re-host | Re-hosted on Gamma's CDN, so the URL only has to be live **at generation time** | 🟢 [imgurl] |
| Fetch fails | **Silently skipped**: no error, no image | 🟢 [imgurl] |
| Each URL independent | "Each URL is fetched independently"; a mix of working and broken images means some URLs are restricted or have no recognised extension | 🟢 [imgurl] |
| "Appear, then disappear on refresh" | Gamma could reach the URL for its first render, but the later **re-hosting step failed**. Typical causes: hotlink protection, rate limits, or a signed URL that expired before the **background upload** ran | 🟢 [imgurl] |
| Conflicting older text | The Generate guide says Gamma "stores references to your image URLs" and an expired URL shows as broken; the newer URL guide says images are re-hosted. Read together: until the re-host succeeds, the reference is your URL. | 🟢 both texts [gen], [imgurl]; the reading is 🟡 |
| Quick test | Open the URL in an incognito window; if it shows without a login, Gamma can fetch it | 🟢 [imgurl] |

Hosting recommendations (the image URL guide's table, merged with the older table in the Generate guide):

| URL type | Recommended | Why (paraphrased) | Marker |
|---|---|---|---|
| Public CDN (Cloudflare, CloudFront, Fastly) | Yes | Permanent, fast, reliable | 🟢 [imgurl] |
| Direct image hosting (Imgur, Unsplash) | Yes | Generally permanent | 🟢 [imgurl] |
| S3/GCS signed URL, 7+ day expiry | Yes | Works if the expiry is long enough | 🟢 [imgurl], [gen] |
| S3/GCS signed URL, < 24 h | No | May expire before Gamma fetches it | 🟢 [imgurl], [gen] |
| Google Drive / Dropbox share link | Maybe | Breaks if permissions change; not a direct image URL | 🟢 [imgurl] |
| Behind CDN hotlink protection | No | Gamma's servers get blocked | 🟢 [imgurl] |
| Localhost / private IPs (192.168.x.x) | No | Gamma's servers cannot reach them | 🟢 [imgurl], [gen] |

### 3.3 Interplay with `noImages`

- Without `noImages`, "Gamma may add additional images from the selected source alongside yours". 🟢 [imgurl]
- The documented recipe for "exactly my images, exactly my text" is `textMode: "preserve"` plus `imageOptions.source: "noImages"`. 🟢 [imgurl]
- Whether `noImages` also suppresses accent images and theme backgrounds is 🔴. The docs say only "a gamma with no images".

### 3.4 The agent endpoint and files

| Topic | Behaviour | Marker |
|---|---|---|
| URLs in an agent `prompt` | `POST /agent/generations` "doesn't guarantee that URLs in `prompt` are fetched and re-hosted" | 🟢 [scope] |
| `sourceUrls` | Up to 10 http(s) URLs **read as source material**. A link the prompt depends on is required (the generation fails if it cannot be read); a background link is skipped. Image URLs are not singled out. | 🟢 [agen] |
| Uploads | `POST /uploads` accepts `image/avif`, `bmp`, `gif`, `heic`, `heif`, `jpeg`, `png`, `svg+xml`, `tiff` and `webp`, plus decks, documents, spreadsheets, fonts (`font/otf`, `font/ttf`), text types and JSON/XML/CSS/JS | 🟢 OpenAPI [upl] |
| Image limit | **50 megapixels** per image; 250 MiB per file; otherwise `413` | 🟢 [upl], [err] |
| Per generation | At most 50 files and 250 MiB in total; each upload attaches to one generation; an unattached upload expires after 2 days | 🟢 [agen], [import] |
| What the agent does with an uploaded image | "The agent works from them beside the prompt." Whether an uploaded image is placed in the deck, used as a reference, or only read is not stated. | 🔴 |
| Format notes | Uploads allow BMP and TIFF, which the Classic URL preprocessor does not accept (its extension list has no `.bmp`/`.tiff`). The two paths have different image intakes. | 🟢 both lists; the comparison is 🟡 |

---

## 4. AI image models

### 4.1 The full table

`imageOptions.model` takes these strings when `source` is `aiGenerated`. Credits per image are as published. 🟢 [models]

**Standard**

| Model name | String | Credits / image |
|---|---|---|
| Flux 1 Quick | `flux-1-quick` | 2 |
| Flux 2 Fast | `flux-2-klein` | 2 |
| Flux Kontext Fast | `flux-kontext-fast` | 2 |
| GPT Image Mini Low | `gpt-image-1-mini-low` | 2 |
| GPT Image 2 Mini | `gpt-image-2-mini` | 5 |
| Flux 1 Pro | `flux-1-pro` | 8 |
| Flux 2 Pro | `flux-2-pro` | 8 |
| GPT Image Mini Medium | `gpt-image-1-mini-medium` | 8 |
| Ideogram 3 Turbo | `ideogram-v3-turbo` | 6 |
| Recraft V4 | `recraft-v4` | 12 |
| Leonardo Phoenix | `leonardo-phoenix` | 15 |

**Advanced**

| Model name | String | Credits / image |
|---|---|---|
| Flux 2 Flex | `flux-2-flex` | 20 |
| Flux 2 Max | `flux-2-max` | 20 |
| Flux Kontext Pro | `flux-kontext-pro` | 20 |
| Ideogram 3 | `ideogram-v3` | 20 |
| Recraft V3 | `recraft-v3` | 20 |
| Nano Banana Flash (Gemini 2.5 Flash) | `gemini-2.5-flash-image` | 20 |
| GPT Image Mini High | `gpt-image-1-mini-high` | 20 |
| GPT Image | `gpt-image-1-medium` | 30 |
| GPT Image 2 | `gpt-image-2` | 20 |
| Flux 1 Ultra | `flux-1-ultra` | 30 |
| Dall-E 3 | `dall-e-3` | 33 |

**Premium**

| Model name | String | Credits / image |
|---|---|---|
| Nano Banana 2 Mini | `gemini-3.1-flash-image-mini` | 34 |
| Flux Kontext Max | `flux-kontext-max` | 40 |
| Recraft V3 Vector | `recraft-v3-svg` | 40 |
| Recraft V4 Vector | `recraft-v4-svg` | 40 |
| Ideogram 3 Quality | `ideogram-v3-quality` | 45 |
| Nano Banana 2 | `gemini-3.1-flash-image` | 50 |
| Nano Banana Pro (Gemini 3 Pro) | `gemini-3-pro-image` | 70 |
| Nano Banana 2 HD | `gemini-3.1-flash-image-hd` | 75 |

**Ultra**

| Model name | String | Credits / image |
|---|---|---|
| GPT Image 2 HD | `gpt-image-2-hd` | 115 |
| GPT Image Detailed | `gpt-image-1-high` | 120 |
| Nano Banana Pro HD (Gemini 3 Pro HD) | `gemini-3-pro-image-hd` | 120 |
| Recraft V4 Pro | `recraft-v4-pro` | 125 |

Notes on the table:

- That is 11 + 11 + 8 + 4 = **34 still-image models**. The OpenAPI `ImageModel` enum has 38 values: these 34 plus `veo-3.1`, `veo-3.1-fast`, `leonardo-motion-2` and `leonardo-motion-2-fast`. 🟢 [models], OpenAPI
- The four extra ids **do not generate video**: `imageOptions.model` makes still images only, so use a model from the tables. 🟢 [models]
- The pricing page gives tier ranges of Standard 2–15, Advanced 20–33, Premium 34–75 and Ultra 30–125. The Ultra table itself starts at 115, so the published "30–125" lower bound does not match its own rows. 🟢 both texts; the mismatch is an observation.
- The Standard table is not sorted by price (Ideogram 3 Turbo at 6 comes after two 8s). It is reproduced as published. 🟢 [models]
- Eight models arrived on 2026-02-27: `recraft-v4`, `recraft-v4-svg`, `recraft-v4-pro`, `gemini-3.1-flash-image-mini`, `gemini-3.1-flash-image`, `gemini-3.1-flash-image-hd`, `flux-2-max` and `flux-2-klein`. 🟢 [changelog]
- The `-svg` "Vector" models suggest vector output is possible. Whether the vector stays editable in the deck or is rasterised is 🔴.

### 4.2 Output dimensions

- Quality tiers (`low` / `medium` / `high`) change detail and cost, not pixel count. **Aspect ratio is the only parameter that changes output dimensions.** 🟢 [models]
- OpenAI models return 3:2 / 2:3 when 16:9 / 9:16 is requested; other providers match the requested ratio exactly. 🟢 [models] The page's own Ideogram row does not fit that note: 1280×768 is 5:3 and 768×1344 is 4:7 (an observation on the published numbers).

| Provider | Models | 1:1 | 16:9 | 9:16 | Max side | Marker |
|---|---|---|---|---|---|---|
| OpenAI | `gpt-image-2-mini`, `gpt-image-2`, `gpt-image-2-hd` | 1024×1024 | 1536×1024 | 1024×1536 | 1536 | 🟢 [models] |
| OpenAI | `gpt-image-1-medium`, `gpt-image-1-high` | 1024×1024 | 1536×1024 | 1024×1536 | 1536 | 🟢 [models] |
| OpenAI | `gpt-image-1-mini-low/-medium/-high` | 1024×1024 | 1536×1024 | 1024×1536 | 1536 | 🟢 [models] |
| Ideogram | `ideogram-v3`, `-turbo`, `-quality` | 1024×1024 | 1280×768 | 768×1344 | 1344 | 🟢 [models] |
| Flux | `flux-1-quick`, `flux-1-pro`, `flux-1-ultra` | 1024×1024 | 1376×768 | 768×1376 | 1376 | 🟢 [models] |
| Flux | `flux-2-pro/-flex/-max`, `flux-kontext-fast/-pro/-max` | 1440×1440 | 1920×1088 | 1088×1920 | 1920 | 🟢 [models] |
| Leonardo | `leonardo-phoenix` | 1024×1024 | 1376×768 | 768×1376 | 1376 | 🟢 [models] |
| Recraft | `recraft-v3`, `recraft-v3-svg` | 1024×1024 | 1820×1024 | 1024×1820 | 1820 | 🟢 [models] |
| Gemini | `gemini-3.1-flash-image-mini`, `-image`, `-image-hd` | 1024×1024 | 1920×1080 | 1080×1920 | 1920 | 🟢 [models] |
| Gemini | `gemini-3-pro-image` | 2048×2048 | 2752×1536 | 1536×2752 | 2752 | 🟢 [models] |
| Gemini | `gemini-3-pro-image-hd` | 2048×2048 | 3840×2160 | 2160×3840 | 3840 | 🟢 [models] |
| Gemini | `gemini-2.5-flash-image` | 1024×1024 | 1920×1080 | 1080×1920 | 1920 | 🟢 [models] |

- The dimension table leaves out `flux-2-klein`, `recraft-v4`, `recraft-v4-svg`, `recraft-v4-pro` and `dall-e-3`, so their sizes are 🔴.

### 4.3 Selection, latency and cost

| Topic | Fact | Marker |
|---|---|---|
| Automatic selection | Omit `model` and Gamma picks one (Classic). The agent always picks its own. | 🟢 [gen], [price] |
| How auto-selection chooses | Not documented. It is probably capped by the plan's `availableImageModels` (the field exists on plan-limit failures). | 🟡 from [mcp]; the policy is 🔴 |
| Latency | Higher-tier and HD models usually take longer, so allow a longer polling window | 🟢 [models] |
| Classic cost | Cards cost 1–3 credits each, plus a per-image price by tier. Examples: 10 cards + 5 basic-model images ≈ 20–60 credits; 20 cards + 15 premium images ≈ 320–1,070; 30 cards + 30 ultra images ≈ 930–3,900. | 🟢 [price] |
| Agent cost | Charged for the work done, including "the images it creates"; the per-image prices above do not apply | 🟢 [price] |
| How many images a Classic deck gets | Not exposed before generation; the cost appears afterwards as `credits.deducted` | 🟢 [price]; the count rule is 🔴 |

---

## 5. Standalone image API (`POST /images`)

Launched 2026-08-04; the MCP equivalents are `generate_image` and `get_image_generation_status`. 🟢 [changelog]

### 5.1 Request (`CreateImageGeneration`)

| Field | Type / values | Default | Semantics | Marker |
|---|---|---|---|---|
| `prompt` | string, required, ≤5,000 chars, must contain a non-space | — | Describes the image. **Background treatments go here** ("on white", "contained in a circle"). | 🟢 [postimg] |
| `type` | `abstract`, `illustration`, `photo`, `scene` | `illustration` | Visual style. MCP glosses: `scene` = narrative illustration, `photo` = photorealistic. **Skipped when `referenceImages` are present**; the style then comes from the prompt. | 🟢 [postimg], [mcp] |
| `sizePreset` | `banner`, `slide`, `social-portrait`, `social-square`, `story` | `social-square` (1:1) | Sets the aspect ratio only; the model decides the exact pixels. MCP ratios: social-square 1:1, social-portrait 4:5, story 9:16, banner 16:9, slide 16:9. | 🟢 [postimg], [mcp] |
| `referenceImages[]` | ≤4 items of `{url (https, required), role}` | — | Subject semantics: "put this character or product in the scene". **They take precedence over `type` and `themeId`.** | 🟢 [postimg] |
| `referenceImages[].role` | `subject` only | — | The pictured character or product is placed into the generated scene | 🟢 [postimg] |
| `referenceImages[].url` | `^https://` | — | The server **fetches, validates and re-hosts** it before generating | 🟢 [postimg] |
| `themeId` | string | Workspace default theme | Brands the image. Applied for every `type` **except `scene`**, whose curated style ignores theme colours. Also ignored when references are present. An unknown or inaccessible id → `400`. | 🟢 [postimg] |

- There is no `model` field, so which model `POST /images` uses is 🔴. 🟢 (field absent in the schema)
- The MCP docs warn that calling `generate_image` again to check progress starts a **new, separately billed** generation. 🟢 [mcp]

### 5.2 Responses

| Shape | Fields | Marker |
|---|---|---|
| Create (`200`) | `imageGenerationId` (required), `warnings[]` known at request time | 🟢 [postimg] |
| Create errors | `400` invalid, `401` key, **`402` insufficient credits**, `403` access/feature, `404`, `429` (rate limit, or too many pending jobs on a Free workspace using an API key) | 🟢 [postimg] |
| Status (`GET /images/{id}`) | `imageGenerationId`, `status` (`pending`/`completed`/`failed`), `image`, `warnings[]`, `error {message, statusCode}`, `credits {deducted, remaining}` | 🟢 [getimg] |
| `image` (`GeneratedImage`) | `url` (CDN), `width`, `height`, `format`, `mimeType`, `transparency`, `aspectRatioUsed` (all required) and `savedMediaId` (optional) | 🟢 [getimg] |
| `format` | **Model-native**, commonly `png` or `webp`, and **not converted** | 🟢 [getimg] |
| Polling | Every 5 s until `completed` or `failed` | 🟢 [getimg] |
| MCP extras | `generatedTime`, **`mediaLibraryUrl`**; on failure `retryable` (false for invalid input such as an unknown `themeId` or a **blocked reference image URL**) and `errorStatusCode` | 🟢 [mcp] |

### 5.3 Warnings (`ImageGenerationWarning`)

Each warning is `{code, message}`. They are informational, the generation still runs, and they can appear on both the create and the completed response. 🟢 [warn]

| Code | Meaning | Trigger | Marker |
|---|---|---|---|
| `no_brand_theme_applied` | No brand theme was found, so a standard theme was used | Workspace without a brand theme (exact condition 🔴) | 🟢 [warn] |
| `theme_ignored_for_type` | `themeId` ignored because `type` is `scene` | `type: scene` + `themeId` | 🟢 [warn], [postimg] |
| `theme_skipped_for_references` | `themeId` ignored because references were given | `referenceImages` + `themeId` | 🟢 [warn] |
| `curated_style_skipped_for_references` | `type` ignored because references were given | `referenceImages` + `type` | 🟢 [warn] |

Classic generation warnings, by contrast, are a single string next to `generationId`, plus an index-aligned `pageWarnings` string array for `pages` requests (🟢 OpenAPI `CreateGenerationResponse`) (for example, "imageOptions.model and imageOptions.style are ignored when imageOptions.source is not aiGenerated"). 🟢 [warn]

### 5.4 Media library and archive

| Behaviour | Detail | Marker |
|---|---|---|
| Saved automatically | Generated images are saved to the **workspace media library** | 🟢 [changelog], [mcp] |
| Durable link | `{mediaLibraryUrl}/{savedMediaId}` links to one image. The library entry outlives the job's status record, so it is the link to give a user. | 🟢 [mcp] |
| Archive | `POST /images/media/{savedMediaId}/archive` removes an item **you created** from the library | 🟢 [arch] |
| Idempotent | Archiving again returns `200` with `{savedMediaId, archived: true}` | 🟢 [arch] |
| URLs keep working | The underlying file is **not deleted**; existing URLs keep working | 🟢 [arch], [explore] |
| Errors | `403` access denied, `404` item not found | 🟢 [arch] |
| MCP | No archive tool; archive is REST-only | 🟢 [scope] |
| Library for deck images | Whether images generated inside a gamma (accent or inline) also land in the library is 🔴 | 🔴 |
| Inserting a library image into a gamma via API | No endpoint does this; you would pass the CDN URL as an input image URL | 🟡 from the absence of any such field |

---

## 6. Brand and images

| Element | Behaviour | Marker |
|---|---|---|
| Theme scope | A theme is the look: colours, fonts, backgrounds, card styling. The Explore table lists `themeId` as "colors, fonts, logo". | 🟢 [brand], [explore] |
| Theme accent images | `imageOptions.source: themeAccent` uses the selected theme's accent images | 🟢 [gen] |
| Agent + theme | `themeId` is applied on Gamma's **Standard Brand Base** design; it cannot be combined with `templateId`. The agent has **no default theme**. | 🟢 OpenAPI, [brand] |
| Template brings its look | A template keeps its own theme, and its images follow the template's original source | 🟢 [brand], [tpl] |
| Edits never restyle | Edits do not change the theme; edits can change text, images, charts and the layout of targeted cards | 🟢 [brand] |
| Branding check | The migration guide asks you to verify that the PPTX "uses your theme or template: colors, fonts, and logo" | 🟢 [mig] |

### 6.1 Logos in headers and footers (`cardOptions.headerFooter`)

| Aspect | Detail | Marker |
|---|---|---|
| Positions | `topLeft`, `topCenter`, `topRight`, `bottomLeft`, `bottomCenter`, `bottomRight`; one element per position, six at most | 🟢 [hf] |
| Element types | `text` (`value`, 1–500 chars), `image`, `cardNumber` | 🟢 [hf], OpenAPI |
| Image source | `themeLogo` (the selected theme's logo) or `custom` | 🟢 [gen], [hf] |
| Custom `src` | Required for `custom`; a URI of 1–2,048 chars; "a valid, publicly accessible URL to an image file" | 🟢 [hf], OpenAPI |
| Size | `sm` (subtle), `md` (**default**, balanced), `lg` (prominent), `xl` (very prominent) | 🟢 [hf] |
| Visibility | `hideFromFirstCard` and `hideFromLastCard` sit at the `headerFooter` level and apply to all positions; both default `false` | 🟢 [hf] |
| Formats | Not for `webpage` | 🟢 [hf] |
| Agent | No `headerFooter` field; use a `templateId` whose layout already has the logo or footer | 🟢 [mig] |
| Custom logo re-hosting | Whether a custom `src` is re-hosted like body images or stays hot-linked is not stated | 🔴 |
| Custom logo formats | Not stated whether the body-image extension rules apply | 🔴 |

### 6.2 Styles → Logo / Images in the app

- The Styles panel has **Logo** and **Images** sections next to Fonts, Colors, Charts and Custom styling. 🟢 observed [queue], [tpl1st]
- Only the panel's existence was recorded; no logo or image style was changed hands-on. 🟢 observed. What "Images" controls (filters, corner radius, accent behaviour) is 🔴.
- The Help Center has a "visuals menu" article for choosing visuals and image styles in the app. It was not opened in this round. 🟢 linked from [models]; its content is 🔴

---

## 7. Charts, diagrams, GIFs, videos and embeds

| Media type | How it is made | Native or picture | Marker |
|---|---|---|---|
| Charts | Prompted through `inputText` / `additionalInstructions`; **no parameters** for chart type, styling or data format; output varies between runs | Native editable component in the editor | 🟢 [charts] |
| Chart tips | Name the chart type, give explicit values, keep labels unambiguous (a `$100` category may be read as data); use a template for consistent layouts | — | 🟢 [charts] |
| Chart styling | "Your theme controls styling for all structured content"; Styles has a Charts section | — | 🟢 [charts]; 🟢 observed [queue] |
| Tables | Same prompting principles; native tables. One PPTX export dialog offered an **Editable tables** option. | Native in PPTX: 1 table in the 11-page deck, 2 in the 18-page deck | 🟢 [charts]; 🟢 observed [tpl1st] |
| Infographics (timelines, process flows) | Can be prompted; "the AI determines the final layout" | Grid of native shapes and text | 🟢 [charts]; 🟢 observed [tpl1st] |
| Diagrams | Add block → Diagrams (timeline, funnel and others) | Native editable blocks | 🟢 observed [queue] |
| Relational diagram on request | A card-scoped edit turned a purge/embargo explanation into five editable colour segments with variable notes; Gamma labelled the proportions illustrative | Editable shapes and text | 🟢 observed [tpl1st] |
| Triple-barrier figure (18-page deck) | Labels are editable text, but the figure base is a **PNG**; the exported labels were 8 / 9.5 pt | Mixed | 🟢 observed [tpl1st], [mlq] |
| Math | Shown as math in the web view; **exported to PPTX as pictures**, with 0 OMML nodes | Picture on export | 🟢 observed [tpl1st], [mlq], [fz] |
| GIFs | `imageOptions.source: giphy`; `.gif` is also an accepted extension for user URLs | Image | 🟢 [gen], [imgurl] |
| Videos | Add block → Videos in the editor; `read_gamma` content can include videos. The API cannot generate video (the video model ids do nothing). | Embed / player | 🟢 observed [queue]; 🟢 [mcp], [models] |
| Embeds | Add block → Embeds (external embeds); `read_gamma` includes embeds | Embed | 🟢 observed [queue]; 🟢 [mcp] |
| Video / embed via API | No request field adds a video or embed. Whether a video URL in `inputText` becomes an embed is not documented. | — | 🔴 |
| Forms | Add block → Forms | Native | 🟢 observed [queue] |
| Images block | Add block → Images | Image block | 🟢 observed [queue] |
| Editor AI quick actions (Classic) | "Make this more visual", "Add an image", "Add a chart" in the single-slide panel | — | 🟢 observed [queue] |

In the editor's DOM, image, math, code, table, grid and cell are separate visible components (`gml-*` card structure). 🟢 observed [alpha]

---

## 8. Media in import and export

### 8.1 Import

| Topic | What the sources say | Marker |
|---|---|---|
| Accepted decks | `.pptx`, `.potx` and PDF of slides, uploaded or linked (`sourceUrls`, e.g. Google Slides) | 🟢 [import] |
| Layout | "A .pptx or .pdf is imported with its own layout"; `purpose: "import"` imports the file faithfully | 🟢 OpenAPI [agen] |
| Restyle | "Import this deck and make it look better / in our brand colors" restyles and keeps the content | 🟢 [import] |
| Are the deck's images preserved? | Not stated explicitly | 🔴 |
| Are charts or SmartArt converted to native blocks? | Not stated | 🔴 |
| Embedded fonts | Uploads accept `font/otf` and `font/ttf`; whether imported decks keep their fonts is not stated | 🟢 mime list; behaviour 🔴 |
| Third-party claims of high import fidelity | Repeated in [umbrella] from a press report; not verified here | 🟡 |

### 8.2 Export

| Topic | Behaviour | Marker |
|---|---|---|
| Formats | `pdf`, `pptx`, `png`; one format per request | 🟢 [gen], [export] |
| PNG | A **`.zip` with one PNG per card**, not one image | 🟢 [gen], OpenAPI `ExportStatusResponse` |
| URL lifetime | About one week; anyone with the link can download; treat as a secret | 🟢 [expstat] |
| Agent | `exportAs` on the agent request; a failed export is a warning (`export_failed`), never a failed generation | 🟢 OpenAPI |
| Scope | Any non-archived gamma in your workspace that you can view, not only API-created ones | 🟢 [scope] |
| Export dialog (app) | Standard quality, All slides, **Editable tables**, Zoom to fit; it warned that Noto Sans SC / Inter must be installed and some visual effects fall back | 🟢 observed [tpl1st] |
| How images export to PPTX | As picture objects. 11-page deck: 8 pictures (4 formula images, 4 on gradient-background pages). 18-page deck: 25 pictures (17 title divider-line variants, 6 mood photos, 1 diagram base, 1 formula). | 🟢 observed [tpl1st] |
| Diagrams in PPTX | Interval diagram exported as editable shapes and text, not a screenshot | 🟢 observed [tpl1st] |
| Overflow | After two local edits (18-page deck), the first re-export had p13 text past the slide bottom (PDF glyphs to 542.07 pt on a 540 pt page); a further layout-only edit fixed it, confirmed by another export | 🟢 observed [tpl1st] §22.4 |
| Editor vs export | Gamma's Help Center warns the export can differ from the editor view | 🟢 linked in [queue] |
| Package media vs visible pictures | Factor Zoo deck: 48 media parts in the ZIP vs 42 slide-level picture instances (`p:pic`, master images excluded); packages can hold shared, fallback or unused parts | 🟢 observed [fz] |

---

## 9. Observed media behaviour in hands-on decks

All counts come from re-opened PPTX files (slide-level `p:pic`) or the web DOM, as noted in each source. 🟢

### 9.1 Decks and what their pictures were

| Deck (source) | Pages | Pictures | What the pictures were | Native info media | Marker |
|---|---|---|---|---|---|
| Factor Zoo, Gamma PPTX `The-Factor-Zoo (1).pptx` ([fz]) | 10 | 42 | 13 formula/symbol bitmaps, 4 finance/city mood photos (pp. 1, 4, 7, 9), 17 icons (incl. 8 arrows on p. 10), 7 card/panel backgrounds, 1 grouped 2×3 flow graphic | 3 native tables, 0 native charts | 🟢 |
| gamma.md architecture deck ([fix]) | 10 | 39 (38 distinct hashes) | Photos, icons, card backgrounds, graphic assets, including repeated photos; a picture on every page | 0 native tables; structured content cards instead | 🟢 |
| ML, Further Study template, 11 pages ([tpl1st]) | 11 | 8 | 4 formula images, 4 on gradient-background pages | 1 native table; editable interval diagram | 🟢 |
| ML, Shoal template, 18 pages ([tpl1st]) | 18 | 25 | 17 title-line decorations, 6 mood photos (sea, sandbar), 1 triple-barrier figure base, 1 weight formula | 2 native tables, 203 auto-shapes | 🟢 |
| Alpha Mining, first run ([alpha]) | 8 | 20 | Abstract backgrounds, circle decorations, icons, card backgrounds | No native charts or tables | 🟢 |
| Cohort explainer, Gamma 5 ([queue]) | 4 | — | p. 1 cover: person-and-calendar illustration; pp. 2–4 carried by a native table, three warning panels and a vertical flow | Native table + flow | 🟢 |
| Five-point comparison ([five]) | 10 | 22 | Photos and illustrations mostly mood and decoration, not factual figures | 1 native table, key-number cards, 0 Office math | 🟢 |

### 9.2 Patterns

| Pattern | Evidence | Marker |
|---|---|---|
| **Decorative images outnumber content images.** Information was carried by native tables, grids, step lists and diagrams; pictures were mood, icons, backgrounds or dividers. | All decks above | 🟢 observed |
| **Pictures are theme metaphors, not evidence.** The Alpha Mining cover had a line-art tree, p. 10 an "AI graveyard" line drawing next to the 8-step loop; the Shoal cover had a beach photo. | [alpha], [tpl1st] | 🟢 observed |
| **One idea, one picture**, in the editorial sense: an image sits in a card-level split beside the text it accompanies (63/37, 30/70, 67/33), never as a second competing figure | [alpha] | 🟢 observed (layout); as a general rule 🟡 |
| **No AI photo on every page.** Body pages used big numbers, 2×2 grids, left/right comparisons, formula + variable panels and native tables | [tpl1st] | 🟢 observed |
| **Repetition.** 17 title-line decorations (repeats or variants) in one deck; 39 pictures with 38 distinct hashes in another (repeated photos) | [tpl1st], [fix] | 🟢 observed |
| **No captions or alt text were observed on content images.** The only labels seen were "Example only" on a code panel and an "illustrative proportions" note on a requested diagram | [alpha], [tpl1st] | 🟢 observed (labels); captions in general 🔴 |
| **No card was scaled down to fit** in the one GML deck measured (S5 in [alpha] §27.7: `--content-fit-scale: 1` on every card). Figures can still be small: the triple-barrier figure was compact with 8 / 9.5 pt labels. | [alpha], [tpl1st], [mlq] | 🟢 observed |
| **Relational diagrams were not planned automatically.** In both ML runs the purge/embargo interval diagram appeared only after a card-scoped request | [tpl1st] | 🟢 observed |
| **Radial look over topology.** The media-routing page used a hub-and-spoke diagram whose labels were visible but whose yes/no and stock/web/generate branches were not drawn as a directed graph | [fix] | 🟢 observed |
| **Images come after text.** Progress showed "Writing slides … → Adding images … → Checking … → Polishing"; once, "Adding images" appeared only after all 10 cards were written; another time some cards were at "Adding images 6/10" while others were already checking | [alpha], [outline] | 🟢 observed |
| **Local edits preserve other pages' images.** After paragraph-level and card-level edits, the other pages' sampled text, styles and **image sources** were unchanged. In the Compiler run, the untouched pages' AI images still differed in bytes/pixels between the two exports, with unchanged source URLs and positions | [obs-media], [tpl1st]; [alpha] §20.1 | 🟢 observed (sources); byte identity not shown |
| **Plan, receipt and canvas can disagree.** In the cohort deck the agent's receipt described content the canvas did not show; image provenance (template asset vs newly generated) could not be told from the canvas | [queue] | 🟢 observed |

Earlier summaries in this repo (see [umbrella] §4.6) stated that Gamma "kept one picture per idea" and never shrank a dense figure below legibility. The layout data above supports the first claim. The 8 / 9.5 pt triple-barrier labels contradict the second as a universal rule, and [umbrella] §4.6 now strikes it out. 🟡

---

## 10. Inferred internals of the media pipeline

None of the following is published. Each item names its evidence.

| # | Inference | Evidence | Marker |
|---|---|---|---|
| 1 | Images are a separate pass after text, run per card | `progress.stages` has an `imaging` count between `writing` and `checking`; UI showed "Adding images x/N" after writing, with cards at different stages | 🟡 from OpenAPI `AgentGenerationProgressStages` + [alpha] |
| 2 | Each card's image prompt is built from that card's text plus the deck-wide `style` string | Accent "what" is "based on your content and `imageOptions` settings"; `style` is described as giving consistency across all generated images | 🟡 from [gen] |
| 3 | The accent slot belongs to the card layout (none/top/left/right/background), chosen with the layout | The API's four positions match the editor's five Standard layouts; Suggested layouts re-render the same content | 🟡 from [gen], [alpha] |
| 4 | Re-hosting runs in two phases: the card first renders from your URL, then a background job copies the file to the CDN and swaps the reference | The "appear during generation, disappear on refresh" failure, explicitly blamed on the background upload | 🟡 from [imgurl] |
| 5 | The URL detector is a token regex: whitespace split, `https://`, extension check before `?`; Markdown/HTML wrapping defeats it | Documented rules and failure table | 🟡 from [imgurl] |
| 6 | The stored gamma records which image source it was built with | From-template reuses "the image source used in the original template" | 🟡 from [tpl] |
| 7 | Theme branding is injected into image generation (palette and tone), except for the curated `scene` style | `themeId` "brands" images; `scene` ignores theme colours; ThemeItem carries `colorKeywords` / `toneKeywords` | 🟡 from [postimg], OpenAPI |
| 8 | "Brand theme" is a distinct workspace concept from ordinary standard themes | The `no_brand_theme_applied` warning ("a standard theme was used") | 🟡 from [warn] |
| 9 | Reference images go through the same fetch → validate → re-host service as input URLs, with a blocklist | "Fetches, validates, and rehosts"; MCP `retryable: false` for a "blocked reference image URL" | 🟡 from [postimg], [mcp] |
| 10 | Auto model choice is constrained by the plan's model list, and the agent routes models internally | `availableImageModels` on plan-limit failures; "the agent chooses its own image models" | 🟡 from [mcp], [price] |
| 11 | Math renders as structured math in the web DOM and is rasterised at PPTX export | Web shows math; PPTX has picture objects and 0 OMML | 🟡 from [tpl1st] (the observation is 🟢) |
| 12 | Diagram blocks export as native shapes when possible, falling back to a PNG base with editable labels | Interval diagram native; triple-barrier figure PNG base + text | 🟡 from [tpl1st] |
| 13 | Web image search ranks by relevance, with a licence filter per source tier | "Most relevant images from the web", three licence levels | 🟡 from [gen] |
| 14 | Image placement and density are judged by the agent's checking/polishing pass | "Checking every slide…" and "Polishing" follow "Adding images"; polishing trimmed text by 1–4% | 🟡 from [alpha] |

---

## 11. Implications for AIMate

| Gamma behaviour | AIMate today | Implication | Marker |
|---|---|---|---|
| Accepts nine image extensions (incl. SVG, WebP, AVIF, HEIC) and re-hosts them | The engine embeds **PNG/JPEG only, ≤512 KB** ([ppt-blocks.mjs](../../../apps/cowork-server/lib/ppt-blocks.mjs)) | Convert or downscale WebP/SVG/large images before they enter the engine, or report them; never silently accept a format the engine will drop | 🟢 code |
| Silently skips an image it cannot fetch | Unembeddable image references become **required** `source_media_unresolved` warnings (`normalizePaste` in [ppt-source.mjs](../../../apps/cowork-server/lib/ppt-source.mjs)) | Keep the warning. It is the better contract; Gamma's silent skip is the documented pain point. | 🟢 code + [imgurl] |
| Fetches public HTTPS URLs at generation time | The Gamma facade fetches public HTTPS PNG/JPEG with no redirects, a public-address check and a byte cap, and returns a reason instead of throwing ([ppt-gamma-image-fetch.ts](../../../src/lib/ppt-gamma-image-fetch.ts)) | Already matches Gamma's "one bad URL never fails the deck"; also surface the reason in `warnings` | 🟢 code |
| Decorative accent images, chosen automatically | Certified template imagery is reused in **chrome slots** with a limited-repeat rule: a painting may reappear only five or more pages after its last use, 2–3 times at most, else the slot shows a flat panel ([ppt-chrome-slots.mjs](../../../apps/cowork-server/lib/ppt-chrome-slots.mjs)) | Our chrome slots are the accent-image equivalent: same role, deterministic | 🟡 |
| `aiGenerated`, stock and web image sources | **No AI or stock image generation** for decks | The facade must map every non-`noImages` source to template imagery or none, and say so in a warning, as Gamma does for ignored `model` / `style` | 🟡 |
| Decks carry information in native tables, grids and diagrams, not in pictures | Native tables, process cards, diagrams and OMML math | Do not chase picture counts. Our native math is stronger than Gamma's PNG formulas; keep it. | 🟢 observed [tpl1st]; [mlq] §3 (our 24-page deck: 38 OMML nodes, 4 native tables) |

---

## Evidence limitations

- The docs (fetched 2026-11-05) cover the public API and MCP only. They give no internals of image selection, prompting, model routing or re-hosting, and the app's network traffic was not observed (Cloudflare challenge), so §10 is inference throughout.
- No hands-on run used the Classic API or `POST /images`. Every claim about `imageOptions`, models, credits, reference images and warnings is documentation-only; the model table and dimensions are vendor-published and were not measured.
- Picture counts come from about nine decks dated 2026-09-29 to 2026-10-22. Several are user-supplied exports whose engine, template and image settings were not recorded, and the 18-page ML deck had already been through card-scoped edits before export.
- Each deck used a different template, and most of the pictures came with the template (photos, title lines, icons, backgrounds). Picture mix and placement therefore can't be separated from template choice, and "decorative over informational" may be a property of these templates.
- Counting rules differ between source docs (slide-level `p:pic`, package media parts, web DOM images), and whether a picture is a template asset or newly generated usually could not be told.
- Export findings (formula PNGs, 0 OMML, PNG diagram bases) come from PPTX files reopened with python-pptx/LibreOffice, not Microsoft PowerPoint. Missing Chinese glyphs in local renders were partly font substitution.
- The import-fidelity figure in [umbrella] is a company claim relayed by a third-party report and was not tested.

## Open questions

| # | Question | Marker |
|---|---|---|
| 1 | Are any image sources (`pexels`, `webAllImages`, `giphy`, …) plan-gated? | 🔴 |
| 2 | What licence terms apply to `pictographic` and `pexels` images in exported decks? | 🔴 |
| 3 | Does `noImages` also suppress theme accent images and background images? | 🔴 |
| 4 | How does Gamma decide how many images a Classic deck gets, and which cards? | 🔴 |
| 5 | Which model does `POST /images` use, and what does one image cost? | 🔴 |
| 6 | Output sizes for `flux-2-klein`, `recraft-v4`, `recraft-v4-svg`, `recraft-v4-pro`, `dall-e-3` | 🔴 |
| 7 | Do `-svg` vector models stay vector (editable) in the deck and in PPTX export? | 🔴 |
| 8 | Is REST `imageOptions.stylePreset` accepted (it is in MCP and the changelog, not in the merged schema)? | 🔴 |
| 9 | What does the agent do with uploaded image files: place them, use them as references, or only read them? | 🔴 |
| 10 | Are images inside imported PPTX/PDF decks preserved, re-hosted or regenerated? | 🔴 |
| 11 | Are custom header/footer logo URLs re-hosted or hot-linked? | 🔴 |
| 12 | Do images generated inside a gamma enter the media library? | 🔴 |
| 13 | What do Styles → Images settings control? | 🔴 |
| 14 | Can a video or embed be created through the API (for example, a YouTube URL in `inputText`)? | 🔴 |
| 15 | Does Gamma add alt text or captions to images, and are they exported? | 🔴 |
| 16 | How are GIFs exported to PPTX (animated or first frame) and to PDF? | 🔴 |
| 17 | Is a theme's accent-image set enumerable, and how many images does it hold? | 🔴 |

---

## Sources

Gamma developer docs (fetched 2026-11-05 via `llms-full.txt`; page URLs from `llms.txt`):

- [gen] Generate from text: https://developers.gamma.app/guides/generate-api-parameters-explained.md
- [imgurl] Optimize image URLs: https://developers.gamma.app/guides/image-url-best-practices.md
- [models] Image models: https://developers.gamma.app/reference/image-model-accepted-values.md
- [postimg] POST /images: https://developers.gamma.app/images/create-image-generation.md
- [getimg] GET /images/{id}: https://developers.gamma.app/images/get-image-generation-status.md
- [arch] POST /images/media/{savedMediaId}/archive: https://developers.gamma.app/images/archive-image.md
- [tpl] Generate from template: https://developers.gamma.app/guides/create-from-template-api-parameters-explained.md
- [hf] Format headers and footers: https://developers.gamma.app/guides/header-and-footer-formatting.md
- [charts] Add charts and structured content: https://developers.gamma.app/guides/charts-and-structured-content.md
- [warn] Warnings: https://developers.gamma.app/reference/warnings.md
- [err] Error codes: https://developers.gamma.app/reference/error-codes.md
- [price] Review access and pricing: https://developers.gamma.app/get-started/access-and-pricing.md
- [explore] Explore the API: https://developers.gamma.app/get-started/understanding-the-api-options.md
- [mig] Migrate from Classic to Gamma 5: https://developers.gamma.app/get-started/migrate-from-classic-to-gamma-5.md
- [import] Import a presentation: https://developers.gamma.app/build-with-gamma/import-a-presentation.md
- [brand] Brand, template, and editing controls: https://developers.gamma.app/build-with-gamma/brand-template-editing-controls.md
- [upl] POST /uploads: https://developers.gamma.app/agent-gamma-5/create-upload.md
- [agen] POST /agent/generations: https://developers.gamma.app/agent-gamma-5/create-agent-generation.md
- [export] POST /gammas/{gammaId}/export: https://developers.gamma.app/management/export-gamma.md
- [expstat] GET /exports/{id}: https://developers.gamma.app/management/get-export-status.md
- [scope] API scope and limits: https://developers.gamma.app/reference/common-feature-requests.md
- [mcp] MCP tools reference: https://developers.gamma.app/mcp/mcp-tools-reference.md
- [changelog] Changelog: https://developers.gamma.app/reference/changelog.md
- OpenAPI schemas cited by name (`ImageOptions`, `ImageModel`, `FromTemplateImageOptions`, `CreateImageGeneration`, `ReferenceImage`, `ImageGenerationWarning`, `ImageGenerationStatusResponse`, `GeneratedImage`, `ArchiveImageResponse`, `CardOptions`, `HeaderFooterElement`, `ThemeItem`, `CreateAgentGeneration`, `AgentGenerationProgressStages`, `ExportStatusResponse`) are embedded in the pages above; see also [08-api-reference.md](08-api-reference.md).

In-repo hands-on observations (Chinese; Gamma-side observations only):

- [obs-media] [ppt-editorial-relational-media-gamma-observation-20261019.md](../ppt-editorial-relational-media-gamma-observation-20261019.md)
- [fz] [ppt-factor-zoo-repetition-media-gamma-review-20261007.md](../ppt-factor-zoo-repetition-media-gamma-review-20261007.md)
- [fix] [ppt-gamma-fixture-content-media-review-20261019.md](../ppt-gamma-fixture-content-media-review-20261019.md)
- [queue] [gamma-ai-editing-generation-queue-2026-09-29.md](../gamma-ai-editing-generation-queue-2026-09-29.md)
- [tpl1st] [ppt-gamma-template-first-editor-workflow-audit-20261019.md](../ppt-gamma-template-first-editor-workflow-audit-20261019.md)
- [alpha] [ppt-alpha-mining-layout-content-gamma-review-20261008.md](../ppt-alpha-mining-layout-content-gamma-review-20261008.md)
- [mlq] [ppt-ml-quant-24p-vs-gamma-18p-review-20261020.md](../ppt-ml-quant-24p-vs-gamma-18p-review-20261020.md)
- [outline] [PPT_Outline_vs_Gamma_Simplification_20261022.md](../PPT_Outline_vs_Gamma_Simplification_20261022.md)
- [five] [ppt-five-point-gamma-comparison-20261013.md](../ppt-five-point-gamma-comparison-20261013.md)
- [umbrella] [gamma-reverse-engineering-20261105.md](../gamma-reverse-engineering-20261105.md)

AIMate code referenced in §11: [ppt-blocks.mjs](../../../apps/cowork-server/lib/ppt-blocks.mjs), [ppt-source.mjs](../../../apps/cowork-server/lib/ppt-source.mjs), [ppt-chrome-slots.mjs](../../../apps/cowork-server/lib/ppt-chrome-slots.mjs), [ppt-gamma-image-fetch.ts](../../../src/lib/ppt-gamma-image-fetch.ts).

[gen]: https://developers.gamma.app/guides/generate-api-parameters-explained.md
[imgurl]: https://developers.gamma.app/guides/image-url-best-practices.md
[models]: https://developers.gamma.app/reference/image-model-accepted-values.md
[postimg]: https://developers.gamma.app/images/create-image-generation.md
[getimg]: https://developers.gamma.app/images/get-image-generation-status.md
[arch]: https://developers.gamma.app/images/archive-image.md
[tpl]: https://developers.gamma.app/guides/create-from-template-api-parameters-explained.md
[hf]: https://developers.gamma.app/guides/header-and-footer-formatting.md
[charts]: https://developers.gamma.app/guides/charts-and-structured-content.md
[warn]: https://developers.gamma.app/reference/warnings.md
[err]: https://developers.gamma.app/reference/error-codes.md
[price]: https://developers.gamma.app/get-started/access-and-pricing.md
[explore]: https://developers.gamma.app/get-started/understanding-the-api-options.md
[mig]: https://developers.gamma.app/get-started/migrate-from-classic-to-gamma-5.md
[import]: https://developers.gamma.app/build-with-gamma/import-a-presentation.md
[brand]: https://developers.gamma.app/build-with-gamma/brand-template-editing-controls.md
[upl]: https://developers.gamma.app/agent-gamma-5/create-upload.md
[agen]: https://developers.gamma.app/agent-gamma-5/create-agent-generation.md
[export]: https://developers.gamma.app/management/export-gamma.md
[expstat]: https://developers.gamma.app/management/get-export-status.md
[scope]: https://developers.gamma.app/reference/common-feature-requests.md
[mcp]: https://developers.gamma.app/mcp/mcp-tools-reference.md
[changelog]: https://developers.gamma.app/reference/changelog.md
[obs-media]: ../ppt-editorial-relational-media-gamma-observation-20261019.md
[fz]: ../ppt-factor-zoo-repetition-media-gamma-review-20261007.md
[fix]: ../ppt-gamma-fixture-content-media-review-20261019.md
[queue]: ../gamma-ai-editing-generation-queue-2026-09-29.md
[tpl1st]: ../ppt-gamma-template-first-editor-workflow-audit-20261019.md
[alpha]: ../ppt-alpha-mining-layout-content-gamma-review-20261008.md
[mlq]: ../ppt-ml-quant-24p-vs-gamma-18p-review-20261020.md
[outline]: ../PPT_Outline_vs_Gamma_Simplification_20261022.md
[five]: ../ppt-five-point-gamma-comparison-20261013.md
[umbrella]: ../gamma-reverse-engineering-20261105.md
