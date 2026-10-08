# Gamma density / page-estimation review — 2026-10-06

Analysis only. No production module or prototype changed, no new deck generated, no commit made.

- `density-analysis.json`: native PPTX extraction, page size, text/table counts, font and text-frame metrics. `actualTextChars` excludes whitespace and synthetic table separators. Legacy-compatible `visibleChars` includes serialized table pipes; both retained to explain historical benchmark differences.
- `inspect-density.py`: reproducible extraction with python-pptx. Frame rectangle union is allocated area, not rendered glyph area. Explicit font stats do not resolve all theme inheritance.
- `estimate-experiments.mjs` / `.json`: calls current module estimator with controlled variants, no LLM requests, no production state writes. Budget variants are arithmetic counterfactuals, not changes to production code. The full-source-in-prompt probe exceeds the production prompt length limit; the 10k prompt/paste pair is the legal-length comparison.
- `gamma-contact.png`, `gamma-01.png`…`gamma-10.png` and `The-Factor-Zoo (1).pdf`: local LibreOffice render of the provided reference. Used for visual inspection, not exported as a new presentation.

Main report: `docs/research/ppt-gamma-density-page-estimation-review-20261006.md`.
