# How Gamma handles content

> Part of the Gamma reverse-engineering set: [index](README.md)

This report covers how Gamma (gamma.app) turns input text into card content and card structure: how it reads the input, splits it into cards, condenses or expands it, handles structured objects, fills templates and names things. It also covers where Gamma got this wrong in our hands-on sessions. Visual layout, theming and the rendering engine are covered in other reports in this set.

**Markers.** 🟢 confirmed, by Gamma's developer docs or by a measured hands-on session in this repo (the citation says which). 🟡 inferred; the bullet says what it is inferred from. 🔴 unknown.

**Evidence base.** 🟢 Two kinds of source are used. (1) Gamma's public developer docs (developers.gamma.app, fetched 2026-11-05). They describe the **Classic** engine (`POST /generations`, explicit text parameters) and the **Gamma 5 agent** (`POST /agent/generations`, prompt-driven). (2) Nine in-repo reviews that measured real Gamma output against our own engine. S4, S5, S9, S10 and (🟡) S8 were run in the Gamma 5 agent web UI; S1–S3, S6 and S7 are user-supplied exports whose engine (Classic or Gamma 5) was not recorded (🔴). 🟡 How the UI choices map to the Classic API parameters is our inference unless a row says otherwise. gamma.app sits behind a Cloudflare challenge, and nothing here came from bypassing it.

### Gamma decks examined hands-on

| ID | Deck (source doc) | Template | Input | Pages | Evidence type |
|---|---|---|---|---|---|
| S1 | Factor Zoo, first attachment ([fz]) | unknown | `04_factor_zoo_overview.md` | 10 | 🟢 PPTX XML + render |
| S2 | Factor Zoo, second attachment `The-Factor-Zoo (1).pptx` ([dens]) | unknown | same file, 41,416 chars | 10 | 🟢 PPTX XML + render; S1 and S2 are different exports (🟢 their per-page contents differ: [fz] §2 vs [dens] §3.2) |
| S3 | Alpha Mining, Deal Review ([alpha] §3, §7) | Deal Review 🟡 (labelled so in [alpha] §21; object counts match that template, [alpha] §3) | `10_alpha_mining.md` | 8 | 🟢 PPTX XML + render |
| S4 | Alpha Mining, live run 2026-10-08 ([alpha] §16–21) | Compiler | same, 14,307 chars | 20 planned → 10 generated | 🟢 UI, DOM, PPTX/PDF |
| S5 | Factor testing, live run 2026-10-08 ([alpha] §27) | Sample Size | `09_factor_testing.md`, 46,347 chars | 24 planned → 10 generated | 🟢 UI + DOM only (not exported) |
| S6 | Deep-learning tutorial ([dl29], [five]) | unknown | `input_tutorial13_deep_learning.md` | 10 | 🟢 PPTX XML + render |
| S7 | "Gamma-AI" architecture deck ([same]) | unknown | `gamma.md`, 612 lines | 10 | 🟢 PPTX XML |
| S8 | ML for quant finance, G2/G3 ([mlq]) | Shoal 🟡 (coastal photo theme; same 18-page deck shape and p13/p14 edits as [tpl1st] §19–23, identity not stated) | `12_ml_quant.md` | 18 | 🟢 PPTX XML + render; G2 already includes card-scoped edits 🟡 |
| S9 | Alpha Mining, live run 2026-10-22 ([simp]) | Hanifah | `10_alpha_mining.md`, 14,307 chars | 19 | 🟢 UI outline observed; per-slide output not captured |
| S10 | "What Is a Cohort?", live run 2026-09-29 ([queue]) | not recorded | short prompt asking for 4 pages | 4 | 🟢 UI observation |

🟢 S4 and S5 were capped at 10 slides by the account's limit (stated as the Free plan in S5). In both runs the tester then explicitly asked Gamma to merge the plan down to 10, so 10 is **not** Gamma's own estimate in either case ([alpha] §17.1, §27.1).

---

## 1. Input interpretation

### 1.1 What counts as input

| Channel | Behaviour | Marker / source |
|---|---|---|
| Classic `inputText` | Anything from a few words to "pages of messy notes or highly structured, detailed text". 1–400,000 chars. | 🟢 [gen], [classic] |
| Classic `pages[]` | Up to 50 pages in one File. Each page has its own `inputText`, plus optional per-page `textMode`, `numCards`, `cardSplit`, `textOptions`, `additionalInstructions` and `title`. | 🟢 [gen] |
| Gamma 5 `prompt` | The brief and any source text in a single field. Up to 400,000 chars. It is the only required field. | 🟢 [agent] |
| Gamma 5 `sourceUrls` | Up to 10 URLs read as source material. If a link the prompt depends on can't be read, the job fails. If a background link can't be read, it is skipped. | 🟢 [agent] |
| Gamma 5 `files` | Uploads (up to 50 files, 250 MiB). A .pptx or .pdf is imported with its own layout. `purpose: "import"` asks for a faithful import, but the prompt still takes precedence. | 🟢 [agent], [import] |
| Image URLs in text | A preprocessor finds whitespace-separated HTTPS URLs with an image extension and places each image where its URL sits. Markdown-wrapped URLs are skipped and HTML `<img>` tags don't work; only raw URLs do. On the agent endpoint, fetching URLs from `prompt` is not guaranteed. | 🟢 [imgurl], [scope] |
| Long pasted text (web UI) | The composer turns it into an attachment ("Pasted text · 19 KB" or "60 KB", shown as `.txt`). | 🟢 [simp] §1, [alpha] §27.1 |
| Markdown | `\n---\n` controls card splits (🟢 [gen]). The docs' example input also uses `#` headings and `*` bullets; that these act as structure cues is 🟡 inferred from that example only. | 🔴 no formal Markdown spec |

### 1.2 `textMode`: generate / condense / preserve (Classic and MCP)

| Mode | Documented semantics | When to use (Gamma's guidance) | Marker / source |
|---|---|---|---|
| `generate` | Treats the input as a starting point; rewrites and **expands** it. | Short input you want elaborated. | 🟢 [gen] |
| `condense` | **Summarises** the input to fit the requested length. | Large input you want shortened. | 🟢 [gen] |
| `preserve` | Keeps the exact text, sometimes adding structure such as headings. For zero modification you have to say so in `additionalInstructions`. | The user asked to keep their wording, or supplied finished slide-by-slide text. A pasted report or notes is source material, not finished copy. | 🟢 [gen], [mcp] |

- 🟢 **Default.** The MCP multi-page tool documents `generate` as the default. The REST guide and the OpenAPI schema give no default ([mcp], [classic]).
- 🟢 **`preserve` is not literal pass-through on the agent engine.** Gamma 5 may resolve bracketed notes such as `[TBD]` even under `preserve` ([mig], [mcp]).
- 🟢 **The MCP guidance warns against two common misuses.** Don't pick `preserve` just because the calling AI already wrote a detailed draft. Pass the user's own material rather than a slide-by-slide rewrite of it ([mig], [mcp]).
- 🟢 **Gamma 5 REST has no `textMode`.** Sending `textMode` or `textOptions` to `POST /agent/generations` returns `400`. The treatment has to be written into the prompt instead, e.g. "Condense it to the key results…; keep every figure exactly as written" ([mig]).
- 🟢 **The web UI offers three analogous options.** In S9 the agent asked about text handling with "condense, keeping terms and facts" pre-selected, and offered "keep original" and "expand" as alternatives. S4 showed the same set: condense keeping terms and facts, keep original wording, add more examples ([simp] §1, [alpha] §17.1).
- 🟢 **The question is not always asked.** In S5 there was no setup form. The agent decided for itself and listed its decisions under "My calls to check" ([alpha] §27.2).
- 🟡 We infer that the UI's three options correspond to `condense` / `preserve` / `generate`. The wording matches one to one, but Gamma does not document the mapping.

### 1.3 `textOptions`: which options apply under which mode

| Option | Values / limits | Applies when | Marker / source |
|---|---|---|---|
| `amount` | `brief` · `medium` (default) · `detailed` · `extensive` | `generate` or `condense` only | 🟢 [gen] |
| `tone` | free text, 1–500 chars (schema allows 0–500); one or more words, e.g. "professional, upbeat, inspiring" | `generate` only | 🟢 [gen], [classic] |
| `audience` | free text, 1–500 chars, e.g. "seven year olds" | `generate` only | 🟢 [gen] |
| `language` | one of 67 codes; default `en` | output language **regardless of input language** | 🟢 [gen], [lang] |

- 🟢 Under `preserve`, `amount`, `tone` and `audience` are ignored, and the response carries a warning such as "textOptions.amount and textOptions.tone are ignored when textMode is preserve" ([warn]).
- 🟢 `amount` is described as text density per card ("how much text each card contains"). Gamma publishes no numeric targets for its four levels ([gen], [mcp]).
- 🔴 We have no measurements of chars per card for each `amount` level; none of the hands-on sessions used the Classic API.
- 🔴 We don't know whether `language` translates the text under `preserve`. The docs say the output language applies "regardless of" the input language, and say nothing about preserve.
- 🟢 On Gamma 5, tone, audience, language and amount become plain-language instructions in `prompt` or `additionalInstructions`, e.g. "Audience: board of directors. Tone: confident and concise. Write in English. Keep text per slide brief." ([mig]).

**Accepted language codes** (🟢 [lang]; 67 codes in the schema enum). One request produces one language; for more languages, make separate requests.

`af sq ar ar-sa bn bs bg ca hr cs da nl en-in en-gb en et fi fr de el gu ha he hi hu is id it ja ja-da kn kk ko lv lt mk ms ml mr nb fa pl pt-br pt-pt ro ru sr zh-cn sl es es-419 es-mx es-es sw sv tl ta te th zh-tw tr uk ur uz vi cy yo`

- 🟢 Japanese comes in two registers: `ja` is the です/ます style and `ja-da` the だ/である style. Spanish has four variants and Chinese two (`zh-cn`, `zh-tw`) ([lang]).
- 🟢 There is **no "bilingual" code**. Yet the web agent offers bilingual output and did produce it in S4 and in the S9 outline (§3.4). 🟡 So bilingual output is an agent/prompt behaviour, not an API language value.

### 1.4 `additionalInstructions`

| Aspect | Detail | Marker / source |
|---|---|---|
| Limits | Classic guide: 1–5,000 chars (schema allows 0–5,000). Agent endpoint: 0–5,000. | 🟢 [gen], [agent] |
| What it can steer | Content, layouts and other aspects of the output. Gamma's own examples: gallery layout, text on the left, modern/minimal style, punchy headlines, bullets instead of paragraphs, a summary card at the end, how to display supplied images, chart type. | 🟢 [gen], [charts] |
| MCP usage | What the user asked for beyond the content, in their own words: brand look, style, audience, purpose, how to handle `[TBD]` notes, layout guidance. Keep it out of `inputText`. | 🟢 [mcp] |
| Conflicts | Works best when it doesn't contradict other parameters. Gamma's example: `condense` combined with "preserve all text" cannot both be honoured. | 🟢 [gen] |
| Enforcement (agent) | "Guidance the agent aims to follow, not a constraint the output is validated against." | 🟢 [agent] |
| Validation in general | Gamma does not validate generation or edit results against the template or the prompt. | 🟢 [brand] |

- 🔴 When a parameter and an instruction conflict, the docs don't say which one wins.

### 1.5 Size limits and encoding

| Limit | Value | Marker / source |
|---|---|---|
| Classic `inputText` | 100,000 tokens ≈ 400,000 chars. The effective limit can be lower when the use case needs extra reasoning, so Gamma recommends staying below 100k tokens and testing. | 🟢 [gen] |
| From-template `prompt` | Same 100k-token total, but the template itself uses part of it, so the usable prompt is shorter. | 🟢 [tpl] |
| Agent `prompt` | maxLength 400,000 chars | 🟢 [agent] |
| Edit `prompt` | 1–10,000 chars | 🟢 [edit], [brand] |
| `title` | 1–500 chars | 🟢 [gen] |
| JSON | The input may need JSON escaping; newlines are sent as `\n`. | 🟢 [gen] |
| Practical input sizes seen | 14,307 chars (S4, S9) and 46,347 chars (S5) were accepted. In S5 the text's SHA-256 matched before submission, and content from the input's last section (§15) appeared in the output. | 🟢 [alpha] §16.1, §27.10 |

---

## 2. Card splitting and card count

### 2.1 `cardSplit` and `numCards` (Classic)

- 🟢 **`auto` (the default)** splits the content into `numCards` cards and **ignores** any `\n---\n` in the input ([gen]).
- 🟢 **`inputTextBreaks`** splits only at `\n---\n` and **ignores** `numCards`. One break gives two cards, two breaks give three, and so on ([gen]).
- 🟢 **`numCards`** defaults to 10. On Free the range is 1–10; on Plus, Pro, Ultra, Teams, Business and Enterprise it is 1–100. A higher value returns `400` ([gen], [price]).
- 🟢 Plan-limit failures include "more `inputTextBreaks` than the plan allows" ([mcp]). 🟡 Presumably that is the same card cap.
- 🟢 History: the Ultra tier once unlocked "up to 75 cards" ([changelog]); the current cap is 100.

**Documented truth table** (🟢 [gen]):

| `\n---\n` in input | `cardSplit` | `numCards` | Cards produced |
|---|---|---|---|
| none | auto | 9 | 9 |
| none | auto | blank | 10 (default) |
| none | inputTextBreaks | 9 | 1 |
| 5 breaks | auto | 9 | 9 |
| 5 breaks | inputTextBreaks | 9 | 6 |

- 🟢 **MCP guidance.** Reserve `inputTextBreaks` for text the user already divided into slides, or for an explicit one-card-per-section request; breaks inserted by the calling AI don't qualify ([mcp], [mig]).
- 🟢 **`pages[]`.** Each page can set its own `numCards` and `cardSplit` ([gen]).

### 2.2 Card count on the Gamma 5 agent

| Behaviour | Detail | Marker / source |
|---|---|---|
| `numCards` is a soft target | The agent "may deviate by a card or two" and the result is not validated against it. It is still capped by the plan (10 Free, 100 paid; above that returns 400). | 🟢 [agent], [mig] |
| No `cardSplit` | To force one card per section, say so in `prompt` and check the boundaries in the output. | 🟢 [mig] |
| Agent's own planning is capped too | "The agent also caps the decks it plans itself." | 🟢 [price] |
| Plan length vs account cap in the UI | The Plan kept all 20 (S4) or 24 (S5) cards and showed a 10-slide limit with an upgrade prompt (S5's wording, after card 10: "Free includes up to 10 slides"). Generating fewer took an explicit merge instruction. | 🟢 [alpha] §17.1, §27.2 |
| Verification advice | Gamma tells integrators to check the slide count is "close to `numCards`" and to adjust downstream code that expects an exact count. | 🟢 [mig] |
| Template route | "Pass the user's wording through as-is" when they state a length ("a quick deck", "5 slides"). | 🟢 [mcp] |
| Example | The documented template run returned "eight cards in the template's order". | 🟢 [branded] |

- 🟢 **The web agent did not ask for a page count in S4, S5 or S9** (S9: "不问页数" [simp] §1; the S4 Setup form asked only about text handling and language, [alpha] §17.1; S5 had no form, §27.2). The 4-page cohort prompt (S10) asked for 4 explicitly, and the final plan had 4. A transient 5th card appeared during loading and was then merged ([queue] §2).

---

## 3. Outline semantics observed hands-on

🟢 Everything in this section comes from the S4, S5 and S9 live runs and from the exported decks. S9 rows describe its **outline** only; its slides were not captured.

### 3.1 The outline is the final content

- 🟢 In S9 each outline card already held the condensed copy: 3–8 bullets, numbered steps, or a one-sentence claim ([simp] §1).
- 🟡 [simp] §1 concludes that the later "write slides" step only lays this content into layouts and doesn't decide what the card says. S9's slides were not captured; S5's polish changed card text by only 1–4% (below), but S10's canvas dropped plan content (next bullet), so this holds at most approximately.
- 🟢 The Plan streams card by card (skeleton first, then title and bullets). Every card has Add slide / Merge controls and editable text ([alpha] §17.1; [queue] §2).
- 🟢 **Plan, agent receipt and canvas can disagree.** In S10 the plan contained two cohort types with examples, and the agent's receipt said the deck contrasted them, but the final card showed neither ([queue] §5).
- 🟢 Polishing lightly trims text: in S5's polish stage cards lost 1–4% of their characters (e.g. 619→606, 526→507) ([alpha] §27.5).

### 3.2 Split by idea, not by heading

| Input structure | Gamma's cards | Marker / source |
|---|---|---|
| 11 sections, alpha mining (S9) | **19 outline cards.** §1 became 4 cards (two paradigms / production model / "search is cheap, validation is everything" / look-elsewhere effect). §7 became a checklist card plus a claim card. §9 became roles + lineage. §11 became code example + mining loop. | 🟢 [simp] §1 |
| Same input, Compiler template (S4) | **20 cards** auto-planned: paradigms, factor pool, look-elsewhere, evaluation, pool correlation, lineage, code and graveyard each got their own card. | 🟢 [alpha] §17.1 |
| 15 chapters, factor testing (S5) | **24** = 20 content cards + 4 "Part" divider cards. §1 2, §2 2, §3 1, §4 2 + 1 IR-law card, §5+§6 merged, most of §5–§14 one card each, §15 one card. | 🟢 [alpha] §27.4 |
| Several Gamma decks | A page is "one reader judgement supported by 2–4 parallel blocks" (S6). Each card answers one question with distinct support blocks: definition, mechanism, example, condition, consequence (S7). | 🟢 [dl29], [same] §3.1 |

- 🟢 **Allocation shape.** About one card per independent question. Long chapters are capped (§2 of S5 was 13,018 chars and got 2 cards). Short chapters still get about one card each rather than a fraction of one ([alpha] §27.4).
- 🟢 **Merging for the 10-card cap.** Divider pages were dropped and short Chinese term labels added to titles. The agent itself warned "Some slides are dense because of the merging" ([alpha] §27.2).
- 🟡 Two runs on the same input (S9: 19 cards, S4: 20 cards, different templates and two weeks apart) suggest the count is driven by content and fairly stable. Two samples are not proof.

### 3.3 Facts preserved

- 🟢 **S9 (outline).** Every number appeared: 0.3–0.8, 0.02–0.05, √N, 2,000, ICIR≈0.3, 10^6, ~3,700 trading days, 15 years, and all eight gates ([simp] §1).
- 🟢 **S5.** Every number on pages 4, 6 and 10 (0.03–0.05, 0.05, 0.15, 12/24, k 3–5, 1.4826, 4%, 800%, 50 bps, TC 0.5–0.8, …) was traceable to the source; **no fabricated facts were found** ([alpha] §27.3).
- 🟢 **In S5, enumerations were kept nearly item by item:** 8/8 stages, 9/9 report items, 8/8 common bugs and every A-share mask ([alpha] §27.3). S1 did not do this (7 of 8 families, 6 of "seven" criteria; §8.2).
- 🟢 **Numbers get semantic roles.** In S6, 2–4 is a layer count, 5–20 an ensemble size, and 0.02–0.06 a weak-signal range ([dl29]).
- 🟢 **In S6 the comparison set was kept whole:** all five Qlib models with IC ranges; our engine at the time kept a single row ([dl29], [five]). S1 and S8 dropped table rows (§8.2).
- For the exceptions (lost qualifiers, missing rows, miscounts), see §8.

### 3.4 Bilingual sources

| Run | Treatment | Marker / source |
|---|---|---|
| S9 outline (language question pre-selected "bilingual" after detecting EN/ZH paired paragraphs) | Merged per line as "English \| 中文", with the Chinese part shorter. Never both full paragraphs. | 🟢 [simp] §1 |
| S4 (Setup form: "Bilingual, English with Chinese beneath") | Bilingual. Not every English detail had a Chinese equivalent; on p2 the IC/ICIR numbers weren't repeated in Chinese. | 🟢 [alpha] §16.1, §17.2 |
| S5 (no form; agent decided) | A paired translation counted as **one** piece of content. English body; Chinese only as 13 pt key-term labels under titles and on the cover. About 736 English words vs 56 Chinese characters; not a single EN+ZH paragraph pair on any slide. | 🟢 [alpha] §27.3 |
| S3 | Bilingual headings and labels, English body (920 English tokens vs 238 Han characters). | 🟢 [alpha] §3, §7.5 |
| S8 | English main text with short Chinese counterparts. | 🟢 [mlq] §4 |

- 🟡 The bilingual treatment depends on the agent's call or on the user's answer to the setup question. 🔴 What triggers the question isn't known ([alpha] §27.2).

### 3.5 Code

| Run | Treatment | Marker / source |
|---|---|---|
| S9 outline | Explained, not pasted. A Python example became a one-line description of the formula ("raw = -ret5 / rank(20-day avg turnover), then cross-sectional rank · example only"). | 🟢 [simp] §1 |
| S4 (code-oriented Compiler template) | The full `candidate_alpha` function was kept verbatim in a dark code panel, separate from the explanation. DOM and both PPTX exports were identical; the Python AST matched. | 🟢 [alpha] §17.2 |
| S5 (data-lesson template) | All 13 Python blocks omitted and disclosed ("I left the Python code out. The slides keep the formulas and thresholds"). A code-block ASCII flowchart became a native 4×2 numbered grid. A code `dict` became a native table. | 🟢 [alpha] §27.3 |
| S3 | Did not show the full `candidate_alpha`. | 🟢 [alpha] §7.3 |

- 🟡 The code policy changes with the template or purpose: kept in full by a code template, omitted (with disclosure) by a non-code template. This rests on two runs ([alpha] §27.9).

### 3.6 Closing cards and the table of contents

- 🟢 **In these four decks the closing card carries information, not just thanks.**
  - S9 outline: the intro's "read together with Tutorial 14" became the closing card ([simp] §1).
  - S8: closes with priority order, the boundaries of the advanced methods, and next steps toward a full pipeline ([mlq] §4).
  - S2: closes with an 8-item checklist, a model summary table and a synthesis, 1,101 chars ([dens] §3.2).
  - S6: closes with "architecture matches the input structure" ([dl29]).
- 🟢 **The TOC is often dropped, but not always.**
  - Dropped in the S9 outline ([simp] §1).
  - S7 has no TOC page and no standalone references page ([same] §1).
  - **But** S1's p2 lists eight agenda items, each with what it covers ([fz] §2). S3's p2 is a six-item TOC with short descriptions ([alpha] §7.1). S8's p2 is a five-stage roadmap ([mlq] §5).
- 🟡 Whether a TOC appears seems to depend on the template or deck type. 🔴 The rule isn't known.

---

## 4. Density and per-card composition

### 4.1 Measured density

| Deck | Total | Per page | Fonts | Other | Marker / source |
|---|---|---|---|---|---|
| S2 Factor Zoo, 10 p | 9,359 actual text chars (cells + text, whitespace excluded) | body-page **median 1,019**, Q1 909.5, Q3 1,097.5, min 802, max 1,196; cover 250 | explicit-size median ≈ **11 pt**; p10 ≈ 9.5 pt | 3 native tables; text-box union area median 28.76% (allocation, not ink) | 🟢 [dens] §3.1 |
| S1 Factor Zoo, 10 p | ≈1,408 English words | ≈155 words per non-cover page | — | 7-row model table, classification table | 🟢 [fz] §1, §6.2 |
| S3 Alpha Mining, 8 p | 6,091 non-whitespace chars; 920 English tokens; 238 Han | body-object median **847** chars | body 11–13 pt | 0 tables / 0 charts; 20 image instances | 🟢 [alpha] §3 |
| S4 Alpha Mining, 10 p | 5,046 chars (5,099 after one-card fix) | body median 525 (576 after fix) | editor body 17 pt logical; PPTX caption 12.5 pt, code Consolas 13 pt | 0 tables; 5 images (3 line-art, 2 √N formula images) | 🟢 [alpha] §19, §21 |
| S5 Factor testing, 10 p | ≈736 English words, 56 Chinese chars | **36–110 English words** (median ≈75); innerText 299–648 chars; vertical fill 78–87% | body 18 pt, H2 36 pt, labels 13 pt | 2 native tables, 5 display formulas, 0 code | 🟢 [alpha] §21, §27.7 |
| S6 DL, 10 p | 3,736 chars; 527 English words; 0 Han | ≈374 chars/page (derived) | — | 1 table, 0 native formulas, 22 image instances, 11 chars of notes | 🟢 [dl29], [five] |
| S7 Gamma-AI, 10 p | 5,360 visible chars; 871 Chinese chars; 539 English tokens | **536** chars/page average | Brygada 1918 / Arimo / Consolas | no TOC, no references page | 🟢 [same] §1 |
| S8 ML quant, 18 p | 6,632 chars; 843 English tokens | **368** chars/page average | explicit-size median 15 pt; min 8 pt | 2 tables, 0 OMML (some formulas are images), 25 image instances, notes = page numbers only | 🟢 [mlq] §3 |

Takeaways:

- 🟢 **No single "Gamma density" exists.** Average chars per page ranged from about 370 (S6, S8) to about 940 (S2: 9,359 / 10; its body-page median is 1,019) across decks, with body font sizes from 11 pt to 18 pt. The decks were measured by different authors with slightly different counting rules (e.g. S7 counts punctuation and newlines). The in-repo authors warn against using any one sample as a universal threshold ([alpha] §21, §25.3; [dens] §3.1).
- 🟡 Density looks template-driven. The densest decks (S2, template unknown; S3, Deal Review) use small type; lesson templates (S4, S5) are lighter, with 17–18 pt body text, short units and more white space ([alpha] §21, §27.7). The type hierarchy is set by the template ([alpha] §19.1).
- 🟢 **Retention.** S5's 10 cards kept about **16%** of the source's non-code English words (≈736 / ≈4,570) ([alpha] §27.3).
- 🟢 **Overflow handling.** In S5 every card had `--content-fit-scale: 1`, so no font was shrunk. The densest grid cards were fitted at the layout level instead (`data-layout-fit-active`). The "Minimum text size 18 pt" setting is the scale-to-fit **shrink floor**, not a per-role minimum ([alpha] §19.1, §27.7).
- 🟢 **Line discipline in S5.** H2 titles never wrapped (24–41 chars). No text block ran past 3 lines; most were 1–2 lines ([alpha] §27.7).
- 🟢 **Caveats.** Character counts are not information depth: English-heavy and Chinese-heavy text don't compare directly, and text inside images isn't counted. S2's 11 pt is the explicit-size median only, with theme inheritance not parsed ([dens] §3.1).

### 4.2 Per-card composition patterns

🟢 The case mapping below is from [dens] §3.2 (S2). The general principle in each row is the authors' generalisation.

| Pattern | S2 example (page, chars) | Principle |
|---|---|---|
| Concept framework | p2 (1,094): factor/characteristic/anomaly/alpha definitions with the base models and how they relate | Related definitions, their differences and the expressions form one frame |
| Multi-column lineage / comparison | p3 (1,019): CAPM → APT → FF3 → Carhart → FF5/q in columns | One comparison axis, many columns; no page per model |
| Test + explanation | p4 (1,082): GRS test and how premia are explained | A test question and its mechanism share a page |
| Problem + evidence | p5 (1,196): factor zoo, redundancy, data mining, multiple testing, evidence bar | One problem with its main evidence and several distinct supporting dimensions |
| Paired tables | p6 (902): classification table next to a per-factor scorecard | Short tables on a common dimension sit side by side |
| Method + implementation risk | p7 (917): portfolio construction + timing/crowding | Method and its risks under one operating frame |
| Boundary + worked example | p8 (996): US vs A-share applicability + a 2×3 sort example | Applicability next to a method or example, in two zones |
| Process with inputs/actions/checks/outputs | p9 (802): research → strategy workflow | Each step carries action, condition, check and output, not just a step name |
| High-information closing | p10 (1,101): 8-item checklist + model table + synthesis | A closing can be a dense summary, not 3–4 principles |

🟢 The same patterns turn up in other decks:

- **Same question, different supports.** S8 p5 lists non-stationarity, overlap, effective sample size and reflexivity as four parallel panels ([mlq] §12.1).
- **Inseparable mechanism.** S8 p7 runs regress → residual → standardise. S8 p12 shows uniqueness × decay × class weight ([mlq] §12.1).
- **Main figure + adjacent role comparison.** S8 p13 shows purge/embargo intervals plus a walk-forward vs CPCV comparison ([mlq] §12.1). 🟡 If S8 is the [tpl1st] deck, this page was rebuilt by a tester's card-scoped edit, not planned by Gamma ([tpl1st] §22.2).
- **Failure → fix → model.** S6 p8 has three blocks: failure cause, structural fix, GRU ([dl29]).
- **Explanation chain.** S7 p5 links Brief → IR → Layout → Theme on one page ([same] §3.1).

🟢 **Layout vocabulary that carries these patterns** (S5 GML DOM; [alpha] §27.6):

- text + image split at the card level (63/37, 30/70, 67/33)
- a full-width title over two panels, each with its own H3 (≈58/38, 49/49)
- collection grids (4×2 numbered cards, 2×4 one-sentence cards)
- vertical numbered steps
- a formula side-panel
- a takeaway sentence at the bottom of a panel
- 2-column native tables

🟡 Caveats on these patterns:

- They describe one or two decks each. [dens] states its mapping is "not a template for all future topics".
- [mlq] §12.1 adds that "able to merge" doesn't mean "must merge". S8 p17 (interpretation + data artefacts + monitoring) paid a compression cost.

---

## 5. Structured content

### 5.1 Charts, tables, infographics (what the docs say)

| Aspect | Detail | Marker / source |
|---|---|---|
| Parameters | None. No API parameter controls chart type, styling or data formatting. | 🟢 [charts], [scope] |
| Steering | Through `inputText` and `additionalInstructions` (Classic) or the prompt (agent). | 🟢 [charts], [brand] |
| Determinism | Non-deterministic; results vary between runs with identical input. Test a few runs to calibrate. | 🟢 [charts] |
| Tips | Name the chart type ("bar chart comparing X and Y"); supply explicit structured values (a table or bullets with numbers); reinforce the preference in `additionalInstructions` (bar for comparisons, pie for proportions); avoid category labels that look like numbers (`$100` may be read as data). | 🟢 [charts] |
| Illustrative prompt (from the docs, paraphrased) | Quarterly revenue Q1 $1.2M … Q4 $2.1M plus "display as a bar chart, quarters on x, revenue on y" is predictable; "Revenue data for 2024" + "include a chart" is not. | 🟢 [charts] |
| Tables | Supply rows, columns or key-value pairs. | 🟢 [charts] |
| Infographics (timelines, process flows) | Can be prompted for, but "the AI determines the final layout". | 🟢 [charts] |
| Predictability | Build the charts into a template (from-template / `templateId`) and generate new content into that structure. | 🟢 [charts], [scope] |
| Styling | The theme styles all structured content; there is also a Charts panel in Styles. | 🟢 [charts]; Styles panel 🟢 [alpha] §18 |
| Editor blocks | Add block offers Blocks, Images, Shapes, Layouts, Diagrams, Charts, Videos, Embeds, Forms; there are classic single-card quick actions such as "Add a chart" and "Make this more visual". | 🟢 [queue] §3.1, §4 |

### 5.2 Structured content observed hands-on

| Object | Observation | Marker / source |
|---|---|---|
| Native tables | S2: 3; S6: 1 (5 Qlib models + IC ranges); S8: 2; S5: 2 (both 2-column). S3 and S4: 0. Tables in exported PPTX are editable ("Editable tables" export toggle). | 🟢 [dens], [dl29], [mlq], [alpha] §3, §19.4, §27.6 |
| Table compression | S5: a threshold table collapsed into one bullet (only the monthly row and the 0.15 warning kept); a 5-row ranking-error table dropped; numeric examples in prose turned into native Example/Value tables. S8: a 5-row horizon table shrunk to 4 rows (the 5–10-day row dropped). | 🟢 [alpha] §27.3, [mlq] §5 |
| Data charts | Neither S3 nor S4 had a native data chart. No hands-on deck was documented with one. | 🟢 [alpha] §3, §21; 🔴 chart behaviour unobserved |
| Fabricated demo data | S10 generated a Month 0–3 retention table with invented values and no "illustrative" label until the user asked for one. | 🟢 [queue] §5 |
| Diagrams | S8 p8: a small triple-barrier diagram with no real price/time mechanism. S8 p13: a five-segment coloured interval diagram (🟡 probably from a card-scoped edit, [tpl1st] §22.2). S5: an ASCII flowchart became a native grid. | 🟢 [mlq] §5, §10; [alpha] §27.3 |
| Formulas | S5 kept 5 display + 1 inline KaTeX formula out of 23, choosing those that define reported statistics; √ was written as `^{1/2}`. S4 rendered √N as an image, which became plain `sqrt(N)` text after a repair. S6 and S8 had 0 native Office math (S8 had some formulas as images). S1 p3: a formula overlapped body text in the render. | 🟢 [alpha] §17.2, §19.3, §27.3; [five]; [mlq] §3; [fz] §4 |
| Code | See §3.5 (kept verbatim, explained, or omitted depending on run). | 🟢 |
| Speaker notes | Not used as a detail archive: 11 chars in S6, page numbers only in S8. | 🟢 [dl29], [mlq] §3 |

---

## 6. Templates and content

### 6.1 What a template controls

| Item | Behaviour | Type (Gamma's term) | Marker / source |
|---|---|---|---|
| Structure (Classic from-template) | Preserved by default; changes only when the prompt asks. | default | 🟢 [tpl], [brand] |
| Structure (agent `templateId`, MCP `generate_from_template`) | Follows the template only as far as the prompt asks. "Follow this template's structure and style exactly; only replace the content" keeps card order and layouts; a loose prompt lets the agent add, drop or reorder cards. | prompt-directed | 🟢 [brand], [mig] |
| Placeholder text | Text the prompt doesn't cover is **filled by the model, not left as-is**. | prompt-directed | 🟢 [brand] |
| Placeholder tokens | `[[client-name]]` is only a convention; any notation works if the intent is clear. | — | 🟢 [tpl] |
| Locked slides | Set in the app (per slide, in the template's instructions) and carried over unchanged. Honoured by generation, not by human editors. | default | 🟢 [brand] |
| Template / slide instructions | Template-level guidance (tone, audience, "always fill in the pricing table") and per-slide notes. Stored invisibly in the template, never shown in output, applied on every generation. No API parameter. | default | 🟢 [brand], [branded] |
| Per-element lock in a request | Does not exist. | — | 🟢 [brand] |
| Verbatim block outside a template | Include it in the prompt and say to keep it; this is prompt-directed and should be checked. | prompt-directed | 🟢 [brand] |
| Charts/tables in a template | Produced from the prompt; there are no chart parameters. | prompt-directed | 🟢 [brand] |
| Images | New images follow the template's original image source; AI `model` / `style` can be overridden. | default | 🟢 [tpl] |
| Theme | The template's own theme. `themeId` together with `templateId` returns 400; on Classic from-template, `themeId` replaces the template's theme. | default / enforced | 🟢 [brand] |
| Title | Classic: `title`, else inferred. Agent route: no `title` field, ask for it in the prompt. | — | 🟢 [tpl], [mig] |

### 6.2 What the template prompt means

- 🟢 **The Classic `prompt` covers the same operations as the in-app Remix feature** ([tpl]):
  - tailor to an audience
  - transform the subject
  - substitute placeholders
  - edit a card by number
  - add or remove cards
  - lock cards ("stay exactly as written")
  - swap images via URLs
  - populate from data (an intake form)
  - reorder sections

  These can be combined in one prompt, or the prompt can just describe the outcome.
- 🟢 **The MCP `generate_from_template` `prompt` can mix two kinds of text** ([mcp]):
  - **new material**, which is "included verbatim, not summarized"
  - **adaptation directives**

  Gamma fits the template's cards, layouts and images to the content, so callers should pass the user's request, not pick cards or write final copy.
- 🟡 For the caller, the from-template prompt is therefore both content and instructions, and nothing marks which is which. Gamma separates them by intent.
- 🟢 **Documented example run.** One brief across three templates ([branded]):
  - **Deck:** 8 cards in the template's order. The feature cards were filled from the brief, the pricing table got the two tiers.
  - **Release-notes document:** the template's sections, plus an FAQ written from the brief.
  - **Social post:** one card with a headline and three bullets.

  If the result drifts from the template, tighten the prompt ("keep every card, same order, same layouts").

---

## 7. Titles and naming

| Aspect | Behaviour | Marker / source |
|---|---|---|
| Gamma title | `title` (1–500 chars) sets it; if omitted, Gamma infers it from the generated content. | 🟢 [gen], [tpl] |
| Per-page title (`pages[]`) | Optional; also used to derive the URL slug when `path` is omitted. | 🟢 [classic], [mcp] |
| Card title | `get_gamma_outline` reports a card's title as **its first heading**, or empty if it has none. It also returns a ≤200-char `textPreview`, `hidden` and a visible-only `slideNumber`. | 🟢 [mcp] |
| `read_gamma` format | Plain text. A `Title: <gamma title>` line, then `=== Page N: <title> ===` for each page or card in order. Each body holds all human-readable content: text, images, videos, embeds, charts, tables, diagrams. No raw HTML/JSON. MCP-only. | 🟢 [mcp], [brand] |
| Agent self-description | The completed agent status includes `result.summary`, the agent's own description of what it built. | 🟢 [agentstatus], [branded] |
| Card names in analytics | `cardName` and `cardPosition` appear in card analytics; `cardName` is "Title of the card, or null if the card has no discernible title". | 🟢 [changelog], OpenAPI `CardAnalyticsEntry`; 🔴 whether `cardName` equals the first heading |

🟢 Titles observed in the hands-on decks:

- **They mostly name the topic or state one judgement.** S3: "Alpha Mining", "What Alpha Mining Is", "Operator Algebra, Alpha101 & Data Fields", "Evaluation Gauntlet", "Industrial Pipeline", "A-share Notes", "Mining Loop" ([alpha] §6.1). S7 titles mostly name the topic directly ([same] §3.1). Most S8 pages are organised around one clear judgement ([mlq] §4).
- **Assertion cards.** In the S9 outline, cards 4, 12, 15 and 19 are one-sentence claim cards, e.g. "search is cheap, validation is everything" ([simp] §1).
- **No meta-narration.** Titles and blocks state the evidence, condition or comparison directly, with no "this page will explain…" ([dl29]).
- **Brevity can over-generalise.** S6's "Never feed raw prices" is more absolute than the source's modelling conditions ([dl29]).
- **Line length.** In S5 every H2 was one line (24–41 chars). After merging, titles gained short Chinese term labels ([alpha] §27.2, §27.7).
- 🟡 Title length looks bounded by the template's title width: titles never wrapped in S5, and the S4 cover split a long title into several role-specific lines ([alpha] §17.2). 🔴 The inference rule isn't known.

---

## 8. Quality characteristics and failure modes

### 8.1 Strengths observed

- 🟢 **Editorial organisation.** One reader question per card; complementary mechanisms are related on the same card; a clear global storyline. S8: why it's hard → labels/features → weights/validation → models/positions → evaluation/monitoring ([mlq] §4).
- 🟢 **Fact fidelity was high where checked.** See §3.3: no fabricated numbers on the three S5 pages checked, and every listed number present in the S9 outline. S1 and S10 did add ungrounded material (§8.2).
- 🟢 **Consistent depth (S8).** In overview mode the level of explanation stays even across cards ([mlq] §4).
- 🟢 **Decisions are disclosed before generation.** In S5, "My calls to check" listed the language, code and imagery choices, and after merging the agent flagged the densest cards ([alpha] §27.2, §27.5).
- 🟢 **No filler.** In S4 no whole-paragraph filler was copied across cards to pad length ([alpha] §17.2).

### 8.2 Defects, omissions and ungrounded content

| Failure | Instance | Marker / source |
|---|---|---|
| Title count ≠ body count | S1 p6 says "Seven criteria" but lists 6. S1 p10 "Eight criteria" merged into 2 groups and lost failure-story/monitoring. S7 p10 title says 10 principles; the body has a few merged paragraphs. | 🟢 [fz] §4, [same] §3.3 |
| Missing table rows | S1 classification table: 7 of 8 families (Alternative data missing). S8 horizon table dropped the 5–10-day row. S7 p8 shows only the main workflow families, not the source's 16 rows. | 🟢 [fz] §3–4, [mlq] §10, [same] §3.3 |
| Partial enumeration | S1 text names 5 construction methods; the figure expands only 4. q/q5 models merged in S1 p10. | 🟢 [fz] §3–4 |
| Lost or weakened qualifiers | S5: "≈50 bps" lost the source's "one-way equivalent". S8 p11: neutralisation ("strip size") stated unconditionally; p12 class-weight applicability condition missing. S1 p3: "risk premia are permanent", a compressed source claim that reads as unconditional. | 🟢 [alpha] §27.3, [mlq] §10, [fz] §4 |
| Over-confident claims | S7 states architecture inferences as fact; "no Screenshot QA needed" is overstated. S7 dropped the condition that the agent is slower than the old generator. | 🟢 [same] §3.3 |
| Ungrounded additions | S1 p6 added the Harvey–Liu–Zhu reference and a t≥3 threshold that the source doesn't contain. S10 invented retention numbers without labelling them, and stated a generic "Month 0→1 churn >60–70%" threshold with no source. | 🟢 [fz] §4, [queue] §5 |
| Requested citations not delivered | S10's prompt asked for citations on factual claims; none appeared. | 🟢 [queue] §5 |
| Scope omissions in overview | S6 did not cover loss/training, HIST/TRA, A-share specifics or the worked example. S3 dropped the full code, some gate criteria and some numeric examples. S4 dropped economic-story examples and per-role duties. | 🟢 [dl29], [alpha] §7.3, §17.2 |
| Dropped conditions recovered only on repair | S4 p2 first omitted the near-independence condition for √N and restored it during a single-card fix. | 🟢 [alpha] §17.2 |
| Plan/receipt/canvas mismatch | S10 p1 lost the plan's two cohort types while the receipt claimed them. After an S10 edit, the receipt's quoted sentence differed from the canvas. In S4 the agent said "Text size is unchanged", but the export showed 26.5→28 pt, 21.5→23 pt and 16→14.5 pt. The agent's "every chapter covered / no omission" is not a visible-fact check. | 🟢 [queue] §3.2, §5; [alpha] §17.2, §19.3 |
| Layout-caused content defects | S4 p2 overflowed at first (the agent reported it; 9/10 cards passed). S8 G2 p13 box ran past the slide bottom and was fixed by a geometry-only edit in G3. S1 p3 formula overlapped text, and the render showed some dropped Chinese glyphs (local render; font substitution not ruled out). | 🟢 [alpha] §18, §19.3; [mlq] §2; [fz] §4 |
| Small or illegible elements | S8 explicit minimum 8 pt; S8 p8 diagram too small to show its mechanism. | 🟢 [mlq] §3, §10 |

🟢 Gamma's docs state the same limits: results aren't validated against the prompt or template, and integrators should check figures, names, required sections and exact wording, and tighten the prompt "if the agent condenses or rewrites too much" ([brand], [mig]).

---

## 9. Inferred content-planning algorithm

🟡 Everything in this section is inference from observable behaviour. Nothing here is a documented Gamma internal; each step lists its evidence.

| # | Step (inferred) | Evidence |
|---|---|---|
| 1 | **Classify the source.** Detect paired translations, code blocks, ASCII diagrams, tables, formulas and enumerations before planning. | S9 pre-selected "bilingual" after spotting EN/ZH pairs; S5 turned an ASCII flowchart into a grid and summarised code decisions ([simp] §1, [alpha] §27.3) |
| 2 | **Settle the treatment variables.** Language, text mode (condense / keep / expand), code and imagery are either asked about (Setup form) or decided and disclosed ("My calls to check"). Page count is not asked. | [alpha] §17.1, §27.2; [simp] §1 |
| 3 | **Segment by reader question.** About one card per independent question; large sections capped, short related ones merged; optional Part dividers for long decks. | 11 sections → 19–20 cards; 15 chapters → 20 + 4 dividers ([simp], [alpha] §17.1, §27.4) |
| 4 | **Write the outline as final copy, using a retention priority ladder.** (a) ordered processes, decision rules, numbers with units, formulas that define reported statistics, and enumerable items; (b) the qualifiers attached to kept numbers, usually; (c) one mechanism sentence per rule; (d) motivation, alternative comparisons and error examples are dropped first; (e) translations collapse to one copy or a label. | S5 kept 8/8, 9/9, 8/8 enumerations and 5 of 23 formulas, and cut motivation and error tables; ~16% word retention ([alpha] §27.3) |
| 5 | **Apply the account cap after planning.** The plan keeps its natural length; generation is capped. | Plans of 20 and 24 shown alongside "Free includes up to 10 slides" ([alpha] §17.1, §27.2) |
| 6 | **Write each card, then add images, check and polish.** Several cards at once, each written as a whole rather than streamed token by token. Polish lightly trims text. | API progress stages `queued / writing / imaging / checking / polishing / done / failed`, each a count, plus card `done` / `total` ([agentstatus] schema); UI "Writing slides → Adding images → Checking every slide → Polishing slides"; 2–4 cards in flight, whole-card writes, 1–4% trims ([alpha] §18, §27.5; [simp] §1) |
| 7 | **Fit the layout before shrinking text.** Rearrange spacing and layout first; the minimum text size only floors scale-to-fit. | `--content-fit-scale: 1` on every card; layout-fit flags on grid cards ([alpha] §27.7) |
| 8 | **Self-report, not verification.** The agent summarises its result in natural language; no deterministic coverage check is exposed. | `result.summary`; docs say results are not validated; receipts that contradicted the canvas ([brand], [queue], [alpha] §19.3) |

- 🟡 **The outline appears to be generated once and streamed.** Our team observed a single streaming outline, against roughly 72–150 model calls in our old pipeline ([simp] §2). The UI shows one stream; 🔴 how many model calls Gamma makes internally can't be observed.
- 🟡 **Template purpose seems to shape content policy.** Code was kept in full in a code template and omitted in a data-lesson template, and type size differs by template. This rests on two runs ([alpha] §27.9).
- 🔴 Not known: the model(s), the prompts, the internal schema (in S5 the Plan existed as `brief.xml` under an agent session path ([alpha] §27.2), but its schema wasn't inspected), and how Classic `amount` maps to card length.

---

## 10. Implications for AIMate

🟢 Our engine is already outline-first: `apps/cowork-server/lib/ppt-card-outline.mjs` writes cards (title plus points with `sourceUnitIds`) per topic. It has content modes `concise / standard / detailed`, length presets `quick / standard / full` (content caps of 10 / 16 / 28 cards) and an exact total clamped to 6–40. Its prompt already asks for "English | 中文" per-point bilingual lines and for keeping qualifiers on quantities.

- 🟢 **Mode mapping.** Our `concise / standard / detailed` modes are already written as "Condense / Keep / Expand" in `CARD_DENSITY` (`apps/cowork-server/lib/ppt-outline-cards.mjs`), the same three treatments as Gamma's UI options. 🟡 Gamma's separate `amount` axis suggests keeping **treatment** (how the source is handled) independent of **density** (how much goes on a card).
- 🟡 **Page count.** The web agent did not ask in the observed runs; its count follows the content (≈1 card per reader question, capped big sections), and an explicit count is a soft target. Our presets and the exact 6–40 range are stricter. Keep an exact count when the user names one, but let the auto mode follow the question count.
- 🟡 **Disclosure.** Adopt a "calls to check" list (language, code, omitted tables/sections, merges, dense cards) on the outline. This is cheap and covers Gamma's best-observed behaviour.
- 🟡 **Retention ladder.** Use the §9 step 4 ladder as the condense policy, and convert numeric examples into native tables.
- 🟡 **Don't copy Gamma's failures.** Add deterministic checks for "N items" in a title vs the visible count, table-row completeness, qualifier retention and unsourced numbers. These are exactly where Gamma slipped (§8.2).
- 🟡 **Density targets.** Use density profiles per template, not one Gamma number (S2's 1,019 chars/page median vs S5's ~75 words/page).

---

## Evidence limitations

- The docs describe the public API and MCP surface (fetched 2026-11-05). They say nothing about the web app's internal planner, prompts or models, and gamma.app's own bundle and traffic were not observed (Cloudflare challenge).
- The hands-on evidence is ten decks/runs from 2026-09-29 to 2026-10-22: five live Gamma 5 runs (S4, S5, S9, S10, and S8 if it is the [tpl1st] deck) and five user-supplied exports (S1–S3, S6, S7) whose engine and generation settings were not recorded.
- Most decks share a few inputs (alpha mining ×3, factor zoo ×2, ML quant, factor testing, DL tutorial, gamma.md) and are quantitative finance tutorials, mostly bilingual EN/ZH. Behaviour on other domains, single-language or short inputs is mostly untested (S10 is the only short-prompt run).
- Every run used a different template or an unrecorded one, so template effects and Gamma's own policy can't be separated; template-dependence claims rest on one or two runs.
- S4 and S5 were cut from 20/24 to 10 cards by the tester's merge instruction, so their density and retention figures are for a forced merge, not Gamma's own plan. S9's slides and S5's export were not captured; S8's G2 already contains card-scoped edits (🟡).
- Counts come from different authors' scripts (OOXML text, DOM innerText, word regexes) with different rules; cross-deck numbers are indicative only. Fidelity checks were spot checks (e.g. three S5 pages), not full fact audits.
- None of the hands-on runs used the Classic API, so every `textMode` / `amount` / `cardSplit` claim is documentation-only.

## Open questions

- 🔴 Numeric chars per card for each `textOptions.amount` level, and how `amount` interacts with `numCards`.
- 🔴 Whether `textOptions.language` translates under `preserve`, and how mixed-language input is treated without an explicit code.
- 🔴 What happens under Classic `preserve` + `cardSplit: auto` when the input is far longer than `numCards` cards can hold (truncate, densify, or overflow?).
- 🔴 What triggers the Setup form versus "My calls to check".
- 🔴 The rule for including a TOC slide or Part dividers.
- 🔴 How titles are inferred when `title` is omitted, and whether analytics `cardName` equals the card's first heading.
- 🔴 Whether `quality` (`lite / standard / max`) changes content selection or only polish. The docs only say it changes output and cost ([mig]).
- 🔴 Chart-type selection behaviour: no hands-on deck produced a native data chart.
- 🔴 How `read_gamma` serialises charts, tables and formulas inside a page body. The docs only list them as included.
- 🔴 Express mode, the Lite/Max effort levels and Research behaviour; none were run hands-on.
- 🔴 Whether the outline is produced by one model call or several (only a single stream is visible).
- 🔴 Whether S1 and S2 (both "The Factor Zoo", 10 pages, different page contents) came from two runs on the same input or from one run edited later; S1's file hash was not recorded.

## Sources

**Gamma developer docs** (fetched 2026-11-05 via `llms-full.txt`):

- [Generate from text][gen] · [POST /generations][classic] · [Generate from template][tpl] · [POST /generations/from-template][fromtpl]
- [POST /agent/generations][agent] · [GET /agent/generations/{id}][agentstatus] · [POST /agent/gammas/{id}/edits][edit]
- [Migrate from Classic to Gamma 5][mig] · [Brand, template, and editing controls][brand] · [Generate from approved templates][branded] · [Import a presentation][import]
- [Add charts and structured content][charts] · [Output languages][lang] · [Optimize image URLs][imgurl] · [Warnings][warn]
- [MCP tools reference][mcp] · [Set up the MCP server][mcpsetup] · [Review access and pricing][price] · [Explore the API][explore] · [API scope and limits][scope] · [Changelog][changelog]

**In-repo hands-on reviews** (all in `docs/research/`):

- [ppt-gamma-density-page-estimation-review-20261006.md][dens]: S2 density statistics and per-page composition
- [PPT_Outline_vs_Gamma_Simplification_20261022.md][simp]: S9 live outline run
- [ppt-dl29-gamma-semantic-comparison-20261013.md][dl29] and [ppt-five-point-gamma-comparison-20261013.md][five]: S6
- [ppt-gamma-ai-same-input-review-20261014.md][same]: S7
- [ppt-factor-zoo-content-depth-comparison.md][fz]: S1
- [ppt-ml-quant-24p-vs-gamma-18p-review-20261020.md][mlq]: S8
- [ppt-alpha-mining-layout-content-gamma-review-20261008.md][alpha]: S3, S4, S5
- [gamma-ai-editing-generation-queue-2026-09-29.md][queue]: S10
- [ppt-gamma-template-first-editor-workflow-audit-20261019.md][tpl1st]: the 11- and 18-page ML runs (the latter probably S8)

**Our engine:** `apps/cowork-server/lib/ppt-card-outline.mjs` and `apps/cowork-server/lib/ppt-outline-cards.mjs` (`CARD_DENSITY`).

[gen]: https://developers.gamma.app/guides/generate-api-parameters-explained.md
[classic]: https://developers.gamma.app/generations-classic/create-generation.md
[tpl]: https://developers.gamma.app/guides/create-from-template-api-parameters-explained.md
[fromtpl]: https://developers.gamma.app/generations-classic/create-from-template.md
[agent]: https://developers.gamma.app/agent-gamma-5/create-agent-generation.md
[agentstatus]: https://developers.gamma.app/agent-gamma-5/get-agent-generation-status.md
[edit]: https://developers.gamma.app/agent-gamma-5/edit-gamma.md
[mig]: https://developers.gamma.app/get-started/migrate-from-classic-to-gamma-5.md
[brand]: https://developers.gamma.app/build-with-gamma/brand-template-editing-controls.md
[branded]: https://developers.gamma.app/build-with-gamma/branded-template-workflow.md
[import]: https://developers.gamma.app/build-with-gamma/import-a-presentation.md
[charts]: https://developers.gamma.app/guides/charts-and-structured-content.md
[lang]: https://developers.gamma.app/reference/output-language-accepted-values.md
[imgurl]: https://developers.gamma.app/guides/image-url-best-practices.md
[warn]: https://developers.gamma.app/reference/warnings.md
[mcp]: https://developers.gamma.app/mcp/mcp-tools-reference.md
[mcpsetup]: https://developers.gamma.app/mcp/gamma-mcp-server.md
[price]: https://developers.gamma.app/get-started/access-and-pricing.md
[explore]: https://developers.gamma.app/get-started/understanding-the-api-options.md
[scope]: https://developers.gamma.app/reference/common-feature-requests.md
[changelog]: https://developers.gamma.app/reference/changelog.md
[dens]: ../ppt-gamma-density-page-estimation-review-20261006.md
[simp]: ../PPT_Outline_vs_Gamma_Simplification_20261022.md
[dl29]: ../ppt-dl29-gamma-semantic-comparison-20261013.md
[five]: ../ppt-five-point-gamma-comparison-20261013.md
[same]: ../ppt-gamma-ai-same-input-review-20261014.md
[fz]: ../ppt-factor-zoo-content-depth-comparison.md
[mlq]: ../ppt-ml-quant-24p-vs-gamma-18p-review-20261020.md
[alpha]: ../ppt-alpha-mining-layout-content-gamma-review-20261008.md
[queue]: ../gamma-ai-editing-generation-queue-2026-09-29.md
[tpl1st]: ../ppt-gamma-template-first-editor-workflow-audit-20261019.md
