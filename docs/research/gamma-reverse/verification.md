# Verification record

> Part of the Gamma reverse-engineering set: [index](README.md)

Two checks were run before this set was committed (2026-11-05):

1. **REA observation.** [REA](https://github.com/morluto/rea) 6.8.0 is an MCP server and CLI that returns findings together with their evidence and limitations. Its browser lanes passively inspected what is publicly observable.
2. **Claim-by-claim review**, using REA's evidence-and-limitations standard. Every 🟢 claim must point at evidence (a docs page or schema, a REA evidence id, or an in-repo hands-on document) that supports it as stated. Anything weaker is downgraded or removed. Each report's corrections are listed in §2.

## 1. REA browser evidence

**Setup:** headless Chromium 153 with a loopback DevTools endpoint, one tab each on `https://gamma.app/` and `https://developers.gamma.app/`. Commands: `rea list-browser-targets`, then `rea inspect-web-page <endpoint> <targetId>`. Passive inspection only, with no interaction. The bot challenge was **not** worked around.

| Target | Evidence id | Title | Scripts | DOM nodes | Network requests after attach | Storage |
|---|---|---|---:|---:|---:|---|
| `https://gamma.app/` | `ev_70b82f1399cb50c64d2c0411bf446cfd53858c54452273970b798e73cc31edad` | "Just a moment..." (Cloudflare challenge) | 2: `/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1` (621,044 bytes) and one inline | 148 | 0 | empty (no local/session storage keys, no IndexedDB, no caches) |
| `https://developers.gamma.app/` | `ev_8092f4cb526ee9461ece481c465c6fccee2b647e32df61b5b09a2e15328f6f6e` | "Gamma Developer Docs \| Gamma" | 40 (GitBook) | 2,361 | 0 | — |

**Findings**

- 🟢 gamma.app serves only the challenge to automated browsers. No application bundle, route table, GraphQL schema or editor code is observable. The only app-origin link on the page is `https://gamma.app/manifest.json`.
- 🟢 developers.gamma.app is a GitBook site; its images are proxied through `/~gitbook/image?url=…gitbook.io…`. Its machine-readable `llms.txt` and `llms-full.txt` (6,583 lines, 58 sections, 25 operations, 77 schemas) are the primary corpus for this set.

**Limitations REA reported (verbatim categories)**

- Observation starts when REA attaches; earlier network and console activity is unavailable.
- Raw headers, bodies, cookies, storage values and WebSocket payloads are never retained.
- Source maps are reported as URLs only and are not fetched.
- Host platform and architecture were not observed.
- On gamma.app, sections were filtered by policy or limited by attach timing. That makes the "0 requests" figure a lower bound, not proof of no traffic.

**What would extend this (needs the owner's action):** a HAR recording of the user's own logged-in Gamma session. REA's `inspect-web-network-capture` and `environment-build` can analyze it offline and recover the app's internal API routes and request shapes. Without that capture, internal-API claims stay 🔴.

## 2. Claim-by-claim review results

Four independent reviewers each checked two reports against the corpus (`llms-full.txt` by line, `openapi-merged.json`), the in-repo hands-on studies and the AIMate code. They corrected the reports in place and added an `## Evidence limitations` section to each. Report 08 is generated mechanically from the OpenAPI blocks by `.opencode/scripts/gamma-api-reference.py`, so it was not reviewed claim by claim.

| Report | 🟢 claims checked | Corrected | Downgraded | Upgraded | Removed |
|---|---:|---:|---:|---:|---:|
| 01 Architecture and document model | ~51 | 16 | 4 | 1 | 0 |
| 02 Generation pipeline | ~210 | 13 | 3 | 0 | 2 |
| 03 Content handling | ~165 | 21 | 3 | 3 | 0 |
| 04 Media handling | ~215 | 15 | 1 | 0 | 0 |
| 05 Themes, templates, brand | ~120 | 9 | 3 | 1 | 0 |
| 06 Editing, import, export, collaboration | ~210 | 15 | 3 | 1 | 0 |
| 07 MCP, integrations, errors, limits | ~311 | 11 | 0 | 1 | 0 |
| 09 Gap analysis | 44 Gamma cells, ~60 AIMate claims, 8 facade rows | 21 | 2 | 0 | 0 |
| **Total** | **~1,390** | **121** | **19** | **7** | **2** |

### Corrections that changed a conclusion

- **The facade's agent create status:** the docs say `202`; the facade returned `200`. Code fixed in commit `23bc10e`, and reports 07 and 09 updated.
- **File id format:** documented ids are `g_`-prefixed (e.g. `g_l0mf2jvf1fpmi1v`). The MCP example `g5aykcic8ujm71s` sits inside a docs URL and may be a doc id (01).
- **Pages per file:** "up to 50" is the per-request limit of Classic `pages`; no per-file maximum is documented (01).
- **Card geometry:** "cards grow with content" was stated generally. The help-centre wording changed between sessions, and a fixed 1280×720 canvas was measured in one deck (01).
- **Which engine made which deck:** the measured decks are mixed. S4, S5, S9 and S10 are Gamma 5; S1–S3, S6 and S7 are user-supplied exports with the engine not recorded (03).
- **Density:** Factor Zoo deck S2 averages ≈940 characters per page (1,019 is its *body-page median*). Density is template-dependent and now marked 🟡 as a general claim (03, 09).
- **"Table of contents dropped":** true only for the S9 outline; other decks kept a contents or roadmap slide (03, overview).
- **"Never shrinks figures below legibility":** contradicted by 8 / 9.5 pt figure labels in the 18-page template-first deck (04, overview).
- **Overflow history in the template-first run:** it took *two* local edits before the re-export overflowed (542.07 pt glyphs on a 540 pt page), and a third, layout-only edit fixed it (04).
- **Image models:** 34 still-image models plus 4 video ids that do not generate video, not "~30" (01, 04, 09).
- **Languages:** 67 output codes, not "~60" (09).
- **AIMate code facts:** chrome slots allow limited repeats (≥5 pages apart, 2–3 times), not "no repeats" (04). Author outlines allow 3–100 cards; only the planner is limited to 6–40 (09). The built-in renderer is fixed at 12,192,000×6,858,000 EMU, while uploaded templates keep their own size (05). The preview renderer outputs SVG, so PNG export also needs a rasteriser (09).
- **Verbatim passages:** two passages longer than ~25 words were paraphrased (MCP `inputTextBreaks` guidance; the "appear then disappear on refresh" troubleshooting text).

### Inconsistencies inside Gamma's own docs (kept, flagged in the reports)

- Ultra image pricing: the pricing page says 30–125 credits per image, but the model table's Ultra rows start at 115 (04).
- Ideogram output sizes: non-OpenAI models are said to match the requested aspect ratio exactly, yet the Ideogram row lists 1280×768 and 768×1344 (04).
- `GET /gammas/{id}` is said to return a card count, but its schema has no such field (06).
- MCP `generate_from_template`: one page says it always runs the agent; others apply Classic eligibility rules (05).
- `webpage` dimensions: listed as `fluid` on the Warnings page; "do not apply" in the Generate guide (05).
- The `ErrorResponse` schema has no `code` field, although the prose cites machine codes (07).

