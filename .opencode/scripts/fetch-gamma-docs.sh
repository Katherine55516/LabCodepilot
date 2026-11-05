#!/usr/bin/env bash
# Refresh the local Gamma docs corpus used by the gamma-reverse agents.
# Output: .opencode/cache/gamma/{llms.txt,llms-full.txt,section-ranges.txt,openapi-merged.json}
# Only developers.gamma.app is fetched. gamma.app itself sits behind a bot
# challenge; the agents are instructed not to work around it.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cache="$root/.opencode/cache/gamma"
mkdir -p "$cache"
for f in llms.txt llms-full.txt; do
  curl -fsS -A "AIMate-research/1.0" "https://developers.gamma.app/$f" -o "$cache/$f"
done
awk 'BEGIN{p=0} /^# /{if(p) print t" (lines "p"-"NR-1")"; p=NR; t=$0} END{print t" (lines "p"-"NR")"}' \
  "$cache/llms-full.txt" > "$cache/section-ranges.txt"
python3 -I "$root/.opencode/scripts/gamma-openapi-merge.py" "$cache/llms-full.txt" "$cache/openapi-merged.json"
echo "corpus: $(wc -l < "$cache/llms-full.txt") lines, $(wc -l < "$cache/section-ranges.txt") sections in $cache"
