/** Read-only PPTX inspection for the balance evaluation harness. Uses only the
 * Python standard library, so it runs with any python3 (no python-pptx). */
import { spawn } from 'node:child_process';

export const INSPECT_SCRIPT = String.raw`
import json, re, sys, zipfile
import xml.etree.ElementTree as ET
NS = {'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships','c':'http://schemas.openxmlformats.org/drawingml/2006/chart'}
P = '{%s}' % NS['p']; A = '{%s}' % NS['a']
def num(v):
    try: return int(v)
    except Exception: return None
def xfrm_of(el):
    x = el.find('.//a:xfrm', NS) if el.tag != A+'xfrm' else el
    if x is None:
        x = el.find('.//p:xfrm', NS)
    if x is None: return None
    off, ext = x.find('a:off', NS), x.find('a:ext', NS)
    if off is None or ext is None: return None
    box = [num(off.get('x')), num(off.get('y')), num(ext.get('cx')), num(ext.get('cy'))]
    ch_off, ch_ext = x.find('a:chOff', NS), x.find('a:chExt', NS)
    child = [num(ch_off.get('x')), num(ch_off.get('y')), num(ch_ext.get('cx')), num(ch_ext.get('cy'))] if ch_off is not None and ch_ext is not None else None
    return box, child
def apply(t, box):
    if box is None or None in box: return None
    x, y, w, h = box
    for (ox, oy, sx, sy, cx, cy) in reversed(t):
        x = ox + (x - cx) * sx; y = oy + (y - cy) * sy; w = w * sx; h = h * sy
    return [round(x), round(y), round(w), round(h)]
def text_of(body):
    paras = []
    sizes = []
    for para in body.findall('a:p', NS):
        paras.append(''.join(t.text or '' for t in para.iter(A+'t')))
        for rpr in list(para.iter(A+'rPr')) + list(para.iter(A+'endParaRPr')) + list(para.iter(A+'defRPr')):
            if rpr.get('sz'): sizes.append(int(rpr.get('sz')) / 100)
    return '\n'.join(paras).strip(), sizes
def walk(tree, t, out):
    for el in tree:
        tag = el.tag.split('}')[-1]
        if tag == 'grpSp':
            gx = el.find('p:grpSpPr/a:xfrm', NS)
            nt = t
            if gx is not None:
                got = xfrm_of(gx)
                if got and got[1] and None not in got[0] and None not in got[1] and got[1][2] and got[1][3]:
                    box, ch = got
                    nt = t + [(box[0], box[1], box[2] / ch[2], box[3] / ch[3], ch[0], ch[1])]
            walk(el, nt, out); continue
        if tag not in ('sp', 'pic', 'graphicFrame', 'cxnSp'): continue
        got = xfrm_of(el.find('p:spPr', NS) if tag in ('sp','pic','cxnSp') and el.find('p:spPr', NS) is not None else el)
        box = apply(t, got[0]) if got else None
        ph = el.find('.//p:nvPr/p:ph', NS)
        item = {'tag': tag, 'box': box, 'ph': (ph.get('type') or 'body') if ph is not None else None, 'name': (el.find('.//p:cNvPr', NS).get('name') if el.find('.//p:cNvPr', NS) is not None else '')}
        if tag == 'pic':
            item['kind'] = 'pic'; blip = el.find('.//a:blip', NS)
            item['embed'] = blip.get('{%s}embed' % NS['r']) if blip is not None else None
        elif tag == 'graphicFrame':
            tbl = el.find('.//a:tbl', NS)
            if tbl is not None:
                rows = [[text_of(tc.find('a:txBody', NS))[0] if tc.find('a:txBody', NS) is not None else '' for tc in tr.findall('a:tc', NS)] for tr in tbl.findall('a:tr', NS)]
                item.update(kind='table', rows=rows)
            elif el.find('.//c:chart', NS) is not None: item['kind'] = 'chart'
            else: item['kind'] = 'frame'
        elif tag == 'cxnSp': item['kind'] = 'connector'
        else:
            body = el.find('p:txBody', NS)
            text, sizes = text_of(body) if body is not None else ('', [])
            item.update(kind='text' if text else 'shape', text=text, maxSz=max(sizes) if sizes else None, minSz=min(sizes) if sizes else None)
        out.append(item)
z = zipfile.ZipFile(sys.argv[1])
pres = ET.fromstring(z.read('ppt/presentation.xml'))
size = pres.find('p:sldSz', NS)
rels = ET.fromstring(z.read('ppt/_rels/presentation.xml.rels'))
targets = {r.get('Id'): r.get('Target') for r in rels}
order = [targets[s.get('{%s}id' % NS['r'])] for s in pres.findall('p:sldIdLst/p:sldId', NS)]
slides = []
for target in order:
    name = 'ppt/' + target.lstrip('/').replace('ppt/', '') if not target.startswith('ppt/') else target
    root = ET.fromstring(z.read(name))
    rel_name = name.replace('slides/', 'slides/_rels/') + '.rels'
    media = {}
    if rel_name in z.namelist():
        for r in ET.fromstring(z.read(rel_name)): media[r.get('Id')] = r.get('Target')
    shapes = []
    tree = root.find('p:cSld/p:spTree', NS)
    if tree is not None: walk(tree, [], shapes)
    for s in shapes:
        if s.get('embed'): s['media'] = media.get(s['embed'])
    slides.append({'part': name, 'shapes': shapes})
print(json.dumps({'slideSize': {'cx': int(size.get('cx')), 'cy': int(size.get('cy'))}, 'slides': slides}, ensure_ascii=False))
`;

export function inspectPptx(file, python = process.env.PPT_TEST_PYTHON || 'python3') {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-c', INSPECT_SCRIPT, file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err = (err + data).slice(-4000); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`pptx inspection failed for ${file}: ${err}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`pptx inspection returned invalid JSON for ${file}`)); }
    });
  });
}
