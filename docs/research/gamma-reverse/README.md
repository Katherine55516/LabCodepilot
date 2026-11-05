# Gamma reverse-engineering report set

> Overview (one file): [../gamma-reverse-engineering-20261105.md](../gamma-reverse-engineering-20261105.md) · Gamma-compatible API built from it: [handover](../../handover/ppt-gamma-compat.md)

A detailed, verified reverse engineering of Gamma (gamma.app), the AI presentation product, as of 2026-11-05: its architecture, generation workflow, and how it handles content, media, themes and templates, editing, import and export, plus the API, MCP and limits. Each report is compared against AIMate's PPT engine.

## Method

- **Evidence**
  - Gamma's public developer docs: `llms-full.txt`, 6,583 lines, with 25 OpenAPI operations and 77 schemas.
  - This repo's hands-on Gamma sessions (ten measured decks, S1–S10).
  - Passive browser observation with [REA](https://github.com/morluto/rea).
- **Not used**
  - Gamma's code, which is closed source.
  - The gamma.app web app, which shows automated browsers only a Cloudflare challenge. That was not bypassed.
- **Markers:** 🟢 confirmed (cited), 🟡 inferred (evidence stated), 🔴 unknown. Every report ends with *Evidence limitations*, *Open questions* and *Sources*.
- **Verification:** four independent reviewers checked about 1,390 🟢 claims and made 121 corrections, 19 downgrades, 7 upgrades and 2 removals. See [verification.md](verification.md).
- **Reproducible with [OpenCode](https://github.com/anomalyco/opencode):**
  - The project ships `.opencode/agents/gamma-reverse.md` (orchestrator), `gamma-domain.md` (writes one report) and `gamma-verify.md` (read-only fact checker), plus the `/reverse-gamma` command.
  - With your own model key, `opencode run --command reverse-gamma [report names]` refreshes the corpus (`.opencode/scripts/fetch-gamma-docs.sh`), regenerates 08 and re-runs and re-verifies the reports.

## Reports

| # | Report | Lines | Scope |
|---|---|---:|---|
| 01 | [Architecture and document model](01-architecture-and-document-model.md) | 205 | What is observable; File → Page → Card → Block; formats and geometry; editor; reconstructed service architecture; permissions; id catalogue |
| 02 | [Generation pipeline](02-generation-pipeline.md) | 707 | Gamma 5 agent and Classic field by field; job lifecycle and progress stages; in-app flow (Plan/Express, review, build, queue); polling, rate limits, concurrency; pricing; migration; changelog; inferred internals |
| 03 | [Content handling](03-content-handling.md) | 532 | textMode, amount, tone, audience, 67 languages, instructions; card splitting; outline semantics across decks S1–S10; density and composition; charts and tables; placeholders and locks; titles; failure modes |
| 04 | [Media handling](04-media-handling.md) | 618 | 10 image sources; accent images; input image URLs (fetch, re-host, silent skip); 34 image models and credits; `POST /images`; logos; charts, video, embeds; media in import and export; observed decks |
| 05 | [Themes, templates, brand](05-themes-templates-brand.md) | 563 | Theme vs template; catalogues; template workflows, instructions, locked slides; layout system; header/footer spec; Styles panel; sharing |
| 06 | [Editing, import, export, collaboration](06-editing-import-export-collaboration.md) | 659 | API and UI AI edits; manual editing; import (26 MIME types, intents); export; read and search; comments; analytics; archive and delete |
| 07 | [MCP, integrations, errors, limits](07-mcp-integrations-errors-limits.md) | 723 | MCP server and 24 tools; OAuth; integrations; complete error, warning and limit tables; pricing; dated changelog |
| 08 | [API reference (generated)](08-api-reference.md) | 1,313 | All 25 endpoints and 77 schemas, generated from the OpenAPI blocks |
| 09 | [Gap analysis vs AIMate](09-aimate-gap-analysis.md) | 128 | Area-by-area comparison with code pointers and P0–P2 priorities |
| — | [Verification record](verification.md) | — | REA evidence and the claim-review results |

## Extending the evidence

The internals (the app's own API, document schema, collaboration transport) stay 🔴 without new evidence. The legitimate next step is a HAR capture of your own logged-in Gamma session, analysed offline with REA's `inspect-web-network-capture` and `environment-build`.
