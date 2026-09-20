import { spawn } from 'node:child_process';
import * as orch from '../orchestrator.mjs';
import { ensureDeckV3, stableId } from './ir.mjs';

const IMPORT_SCRIPT = String.raw`
import base64, io, json, os, sys
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
raw=sys.stdin.buffer.read(); prs=Presentation(io.BytesIO(raw)); slides=[]
target=os.path.join(os.environ.get('PPT_EXTERNAL_DIR','/workspace/external'),'original.pptx'); os.makedirs(os.path.dirname(target), exist_ok=True)
with open(target+'.part','wb') as f: f.write(raw)
os.replace(target+'.part',target)
for slide_index, slide in enumerate(prs.slides):
    shapes=[]
    for shape in slide.shapes:
        item={'shapeId': int(shape.shape_id), 'name': shape.name, 'x': int(shape.left), 'y': int(shape.top), 'width': int(shape.width), 'height': int(shape.height), 'kind':'foreign', 'locked':True}
        if shape.has_text_frame:
            item.update({'kind':'text','locked':False,'text':shape.text,'isTitle': bool(slide.shapes.title is shape)})
        elif shape.has_table:
            item.update({'kind':'table','rows':[[cell.text for cell in row.cells] for row in shape.table.rows], 'locked':True})
        elif shape.has_chart:
            item.update({'kind':'chart','locked':True})
        elif shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
            image=shape.image
            if len(image.blob) <= 1500000:
                subtype='png' if image.ext.lower()=='png' else 'jpeg'
                item.update({'kind':'image','dataUrl':'data:image/'+subtype+';base64,'+base64.b64encode(image.blob).decode(),'locked':False})
        shapes.append(item)
    slides.append({'index':slide_index,'shapes':shapes})
print(json.dumps({'width':int(prs.slide_width),'height':int(prs.slide_height),'slides':slides,'path':target},ensure_ascii=False))
`;

const EXPORT_SCRIPT = String.raw`
import json, os, sys
from pptx import Presentation
data=json.load(sys.stdin); original=data['original']; prs=Presentation(original)
by_slide={int(item['nativeSlideIndex']):item for item in data['slides'] if item.get('nativeSlideIndex') is not None}
for slide_index, slide in enumerate(prs.slides):
    update=by_slide.get(slide_index)
    if not update: continue
    by_shape={int(node['nativeShapeId']):node for node in update.get('nodes',[]) if node.get('nativeShapeId') is not None}
    for shape in slide.shapes:
        node=by_shape.get(int(shape.shape_id))
        if not node: continue
        geometry=node.get('geometry') or {}
        for key in ('x','y','width','height'):
            if key in geometry: setattr(shape, {'x':'left','y':'top','width':'width','height':'height'}[key], int(geometry[key]))
        if shape.has_text_frame and node.get('type')=='text':
            value=str((node.get('content') or {}).get('text') or '')
            runs=[run for paragraph in shape.text_frame.paragraphs for run in paragraph.runs]
            if runs:
                runs[0].text=value
                for run in runs[1:]: run.text=''
            else: shape.text=value
target=os.environ.get('PPT_OUTPUT','/workspace/presentation.pptx'); tmp=target+'.part'; prs.save(tmp); os.replace(tmp,target)
print(json.dumps({'slides':len(prs.slides),'path':target,'bytes':os.path.getsize(target),'preservedOriginal':True}))
`;

function runPython(project, script, input, max = 12_000_000) {
  return orch.ensureContainer(project.id, project.uid, orch.KIND_PPT).then(({ name }) => new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', '-u', String(orch.AGENT_UID), name, 'python3', '-c', script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', chunk => { out += chunk; if (out.length > max) child.kill(); });
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-3000); });
    child.on('error', reject);
    child.on('close', code => { if (code) reject(new Error(`PPTX fidelity operation failed: ${err.slice(-500)}`)); else { try { resolve(JSON.parse(out)); } catch { reject(new Error('PPTX fidelity operation returned invalid JSON')); } } });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  }));
}

export async function importEditablePptx(project, bytes, hash) {
  const manifest = await runPython(project, IMPORT_SCRIPT, bytes);
  const slides = manifest.slides.map(item => {
    const slideId = stableId('slide', hash, item.index);
    return {
      id: slideId, nativeSlideIndex: item.index, layoutId: 'summary', layoutRef: 'summary', role: item.index === 0 ? 'cover' : 'content',
      nodes: item.shapes.map(shape => ({
        id: stableId('node', hash, item.index, shape.shapeId), type: shape.kind,
        semanticRole: shape.isTitle ? 'title' : shape.kind === 'text' ? 'native-text' : 'visual',
        slotId: 'absolute', styleRef: 'native', locked: shape.locked,
        geometry: { x: shape.x, y: shape.y, width: shape.width, height: shape.height },
        nativeRef: { slideIndex: item.index, shapeId: shape.shapeId, name: shape.name },
        content: shape.kind === 'text' ? { text: shape.text } : shape.kind === 'image' ? { dataUrl: shape.dataUrl } : shape.kind === 'table' ? { rows: shape.rows } : { label: shape.name },
      })),
    };
  });
  project.deck = ensureDeckV3({ schemaVersion: 3, deckId: stableId('deck', hash), slides });
  project.outline = project.deck.slides.map((slide, index) => ({ id: slide.id, title: slide.title || `Slide ${index + 1}`, focus: '', refs: [] }));
  project.pages = slides.length;
  project.externalPptx = { mode: 'preserve', sha256: hash, originalPath: manifest.path, width: manifest.width, height: manifest.height, importedAt: new Date().toISOString() };
  return project;
}

export async function renderImportedPptx(project) {
  const slides = project.deck.slides.filter(slide => Number.isInteger(slide.nativeSlideIndex)).map(slide => ({
    nativeSlideIndex: slide.nativeSlideIndex,
    nodes: slide.nodes.filter(node => node.nativeRef).map(node => ({ type: node.type, nativeShapeId: node.nativeRef.shapeId, content: node.content, geometry: node.geometry })),
  }));
  return runPython(project, EXPORT_SCRIPT, JSON.stringify({ original: project.externalPptx.originalPath, slides }));
}

export const _internals = { IMPORT_SCRIPT, EXPORT_SCRIPT };
