---
description: Refresh the Gamma reverse-engineering reports (all, or the report names given as arguments)
agent: gamma-reverse
---
Refresh the Gamma reverse-engineering report set in docs/research/gamma-reverse/.

Corpus refresh output:
!`bash .opencode/scripts/fetch-gamma-docs.sh`

Current index:
@docs/research/gamma-reverse/README.md

Reports to refresh: $ARGUMENTS (empty means all). Follow your workflow: regenerate 08-api-reference.md, dispatch gamma-domain per report in parallel, then gamma-verify on each, apply fixes, update the index, and summarise what changed since the last run.
