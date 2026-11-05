import json, sys, re
src, llms, out = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(src)); S, P = d['schemas'], d['paths']
# page URLs from llms.txt, keyed by "METHOD /path" title
urls = {}
for m in re.finditer(r'- \[([^\]]+)\]\((https://developers\.gamma\.app/[^)]+)\)', open(llms).read()):
    urls[m.group(1)] = m.group(2).removesuffix('.md')
def short(text, n=160):
    t = re.sub(r'\s+', ' ', (text or '')).strip()
    return (t[:n].rsplit(' ', 1)[0] + ' …') if len(t) > n else t
def esc(t): return str(t).replace('|', '\\|')
def tname(p):
    if not isinstance(p, dict): return ''
    if '$ref' in p: r = p['$ref'].split('/')[-1]; return f'[{r}](#schema-{r.lower()})'
    for k in ('allOf', 'anyOf', 'oneOf'):
        if k in p: return (' / ' if k != 'allOf' else ' & ').join(tname(x) for x in p[k]) + (' (nullable)' if p.get('nullable') else '')
    t = p.get('type', 'any')
    if t == 'array': return f'array of {tname(p.get("items", {})) or "any"}'
    return t + (' (nullable)' if p.get('nullable') else '')
def constraints(p):
    c = []
    if not isinstance(p, dict): return ''
    e = p.get('enum') or (p.get('items') or {}).get('enum')
    if e: c.append('enum: ' + ', '.join(f'`{x}`' for x in e))
    for k, lbl in (('minimum', 'min'), ('maximum', 'max'), ('minLength', 'minLen'), ('maxLength', 'maxLen'), ('minItems', 'minItems'), ('maxItems', 'maxItems'), ('default', 'default'), ('pattern', 'pattern')):
        if k in p: c.append(f'{lbl}: `{p[k]}`')
    return '; '.join(c)
def fields_table(schema, lines):
    props = schema.get('properties', {}); req = set(schema.get('required', []))
    if not props:
        lines.append(f'_Type: {tname(schema) or "object"}{(" — " + constraints(schema)) if constraints(schema) else ""}_'); lines.append(''); return
    lines += ['| Field | Type | Req | Constraints | Notes |', '|---|---|---|---|---|']
    for k, v in props.items():
        lines.append(f'| `{k}` | {esc(tname(v))} | {"yes" if k in req else ""} | {esc(constraints(v))} | {esc(short(v.get("description") if isinstance(v, dict) else ""))} |')
    lines.append('')
L = ['# Gamma public API reference (generated)', '',
     '> Part of the Gamma reverse-engineering set: [index](README.md)', '',
     '> 🟢 Generated mechanically from the OpenAPI blocks embedded in Gamma\'s developer docs (developers.gamma.app, `llms-full.txt`, fetched 2026-11-05) by `.opencode/scripts/gamma-api-reference.py`. Notes are shortened from Gamma\'s field descriptions; follow the endpoint link for the authoritative text. Server: `https://public-api.gamma.app`; auth header `X-API-KEY` (or OAuth Bearer).', '',
     f'**{len(P)} endpoints · {len(S)} schemas**', '', '## Endpoints', '', '| Method | Path | operationId | Summary |', '|---|---|---|---|']
order = sorted(P, key=lambda k: (k.split(' ')[1], k))
for k in order:
    m, path = k.split(' ', 1); op = P[k]
    title = f'{m} {path.removeprefix("/v1.0")}'
    link = urls.get(title)
    anchor = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
    L.append(f'| {m} | [`{path}`](#{anchor}) | `{op.get("operationId","")}` | {esc(short(op.get("description") or op.get("summary"), 110))} |')
L.append('')
for k in order:
    m, path = k.split(' ', 1); op = P[k]
    title = f'{m} {path.removeprefix("/v1.0")}'
    L += [f'### {title}', '']
    if urls.get(title): L += [f'Docs: {urls[title]}', '']
    L += [short(op.get('description'), 600), '']
    params = op.get('parameters', [])
    if params:
        L += ['**Parameters**', '', '| Name | In | Type | Req | Constraints | Notes |', '|---|---|---|---|---|---|']
        for p in params:
            sch = p.get('schema', {})
            L.append(f'| `{p.get("name")}` | {p.get("in")} | {esc(tname(sch))} | {"yes" if p.get("required") else ""} | {esc(constraints(sch))} | {esc(short(p.get("description"), 140))} |')
        L.append('')
    rb = op.get('requestBody')
    if rb:
        for ct, body in (rb.get('content') or {}).items():
            L += [f'**Request body** (`{ct}`): {tname(body.get("schema", {})) or "binary"}', '']
    for code, resp in (op.get('responses') or {}).items():
        content = resp.get('content') or {}
        schemas = ', '.join(tname(v.get('schema', {})) for v in content.values()) or '—'
        L.append(f'- **{code}** {esc(short(resp.get("description"), 160))} → {schemas}')
    L.append('')
L += ['## Schemas', '']
for name in sorted(S):
    L += [f'<a id="schema-{name.lower()}"></a>', f'### {name}', '']
    if S[name].get('description'): L += [short(S[name]['description'], 300), '']
    fields_table(S[name], L)
open(out, 'w').write('\n'.join(L) + '\n')
print(len(L), 'lines')
