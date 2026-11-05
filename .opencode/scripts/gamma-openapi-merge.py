"""Merge the OpenAPI blocks embedded in Gamma's llms-full.txt into one JSON file.

Usage: python3 -I gamma-openapi-merge.py <llms-full.txt> <out.json>
Each endpoint page in Gamma's GitBook docs embeds a one-line OpenAPI 3.0 document;
this collects every components.schemas entry and every path operation.
"""
import json, re, sys

src, out = sys.argv[1], sys.argv[2]
text = open(src, encoding='utf-8').read()
schemas, paths = {}, {}
for match in re.finditer(r'^\{"openapi".*$', text, re.M):
    try:
        doc = json.loads(match.group(0))
    except json.JSONDecodeError:
        continue
    schemas.update(doc.get('components', {}).get('schemas', {}))
    for path, ops in doc.get('paths', {}).items():
        for method, op in ops.items():
            paths[f'{method.upper()} {path}'] = op
json.dump({'schemas': schemas, 'paths': paths}, open(out, 'w', encoding='utf-8'), indent=1)
print(f'{len(schemas)} schemas, {len(paths)} operations -> {out}')
