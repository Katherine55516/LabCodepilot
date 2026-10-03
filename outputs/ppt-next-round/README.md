# PPT next-round evidence (2026-10-03)

Canonical deliverables from the actual PPT module workflow with a simulated LLM.

- `after/factor-zoo-original-template.pptx`: 22-page example using the original 12,342,631-byte user template, unchanged source images.
- `after/original-template-workflow.json`: actual page estimate, planning, run/DAG, simulated model requests, quality and export checks. 0 hard errors, 29 deterministic issues; passed_with_warnings is not full editorial approval.
- `rendered-final/factor-zoo-original-template.pdf`, `contact-sheet.png`: rendered final example. macOS CJK font discovery configured for LibreOffice; PowerPoint/Windows rendering unverified.
- `before/factor-zoo.pptx` / `after/factor-zoo.pptx`: same 4,191,988-byte template fixture for Before/After comparison (original template exceeded old limit).
- `before/working-tree.patch.gz`: changes atop f33b3c8 present when freezing Before.
- `{before,after}/{workflows,fast10,factor-timing,content}.json`: raw measurements. Version Update corrected measurements exclude base-deck creation.
- `benchmark-summary.json`: min/median/max and median deltas, all samples retained. N=3 per scenario/cache; no p95 claim.
- `after/factor-timing-contended-excluded.json`: excluded run with concurrent test load, retained for transparency.
- `ui/`: real dev-server CDP screenshots/checks; API route fixtures rather than a remote Cowork backend.
- `selftests-final.log`, `npm-test-final.log`, `smoke.log`, `ui-latest.log`, `e2e-full.log`: final validation. Full application E2E has 19 Chat/Search failures; PPT-specific tests passed.

Reproduction scripts: `scripts/ppt/benchmark-workflows.mjs`, `scripts/ppt/benchmark-content.mjs`, `scripts/ppt/verify-cdp.mts`, `outputs/run-factor-zoo-next-round.mjs` and its source-grounded simulation plan. Source Markdown and Gamma reference remain the user-provided files; pass local paths through documented arguments/environment variables. The optimized template fixture is adjacent in `outputs/`.

See `docs/research/ppt_next_round_audit.md`, `ppt_performance_benchmark.md`, `ppt_changes.md` for configuration, methodology, migration, root causes and unresolved validation. This folder's Git evidence is curated: repeated trial logs, CPU profiles, temporary render pages and unrelated historical outputs remain local and are not release deliverables. No production model latency or Gamma private implementation is asserted.

Committed terminal logs retain their results with ANSI controls and trailing whitespace removed. The frozen patch is gzip-compressed without changing its contents (`gzip -dc before/working-tree.patch.gz`).
