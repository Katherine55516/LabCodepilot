// A PDF formula needs confirmation only on evidence of how it was extracted
// (Fable 2026-10-26): lost glyphs, a math font, script glyphs off the
// baseline on a line that carries math, or a fraction rule. Exact Unicode text
// in a text font ("²", "α" on the baseline) is read as written and only noted
// (the alpha_mining PDFs, ReportLab-built, were blocked by a correct "²").
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';import {extractFile} from './lib/ppt-source.mjs';
const out=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-pdf-math-')),python=process.env.PPT_TEST_PYTHON||process.env.PPT_PYTHON||'python3',runtime=localPptRuntime(out,python);
const ARIAL='/System/Library/Fonts/Supplemental/Arial.ttf';
// Each fixture is one page drawn with ReportLab: a list of [text, x, y, size, rise, font].
function pdf(name,draws,rules=[]){
 const file=path.join(out,name+'.pdf');
 const build=spawnSync(python,['-c',`import sys,json
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('Body',sys.argv[3]))
c=canvas.Canvas(sys.argv[1]);spec=json.loads(sys.argv[2])
for text,x,y,size,rise,font in spec['draws']:
    t=c.beginText(x,y);t.setFont(font,size);t.setRise(rise);t.textOut(text);c.drawText(t)
for x0,y,x1 in spec['rules']:c.line(x0,y,x1,y)
c.save()`,file,JSON.stringify({draws,rules}),ARIAL],{encoding:'utf8'});
 assert.equal(build.status,0,build.stderr);return file;
}
const read=async(name,file)=>(await extractFile({id:name,uid:'pdf-math'},name+'.pdf',fs.readFileSync(file),runtime.io)).mediaWarnings||[];
const required=warnings=>warnings.filter(w=>w.code==='source_pdf_math_requires_confirmation'&&w.required);
const advisory=warnings=>warnings.filter(w=>w.code==='source_pdf_math_text'&&!w.required);
const line=(text,y=700,size=14)=>[text,40,y,size,0,'Body'];
try{
 if(!fs.existsSync(ARIAL)){console.log('SKIP pdf math evidence: Arial.ttf missing');process.exit(0);}
 // Exact Unicode text: no required warning, an advisory note only.
 for(const [name,draws] of [
  ['arial-alpha',[line('Risk model α²')]],
  // alpha_mining 01 p3 and 10 p1-2 (ReportLab): "²" in body text, formulas written linearly.
  ['alpha-mining-01-p3',[line('The equal-weight portfolio variance is v²[rho+(1-rho)/N].',700,11),line('improvement = sqrt(N / (1 + (N-1)*rho))',680,11)]],
  ['alpha-mining-10-p1',[line('Pool variance falls as σ² ρ + σ²(1-ρ)/N for N equal-weight members.',700,11)]],
 ]){const w=await read(name,pdf(name,draws));assert.deepEqual(required(w),[],name+': exact text is read as written');assert.equal(advisory(w).length,1,name+': noted as plain-text math');}
 // Footnote markers are not formulas, even on a line with an operator.
 for(const [name,draws] of [
  ['footnote',[line('as shown in a footnote marker',700),['1',247,705,8,0,'Body']]],
  ['footnote-operator',[line('returns rise 5% + fees.',700),['1',190,705,8,0,'Body']]],
 ]){assert.deepEqual(required(await read(name,pdf(name,draws))),[],name);}
 // Typeset math evidence: each one alone is required.
 const cases=[
  ['script-sum',[['x',40,700,18,0,'Body'],['2',51,700,11,7,'Body'],[' + y',57,700,18,0,'Body'],['2',94,700,11,7,'Body']],[],'script_layout'],
  ['script-greek',[['σ',40,700,18,0,'Body'],['2',52,700,11,7,'Body'],[' measures dispersion',60,700,18,0,'Body']],[],'script_layout'],
  ['symbol-font',[line('Mean'),['a+b',90,700,14,0,'Symbol']],[],'math_font'],
  ['fraction',[['a + b',60,712,14,0,'Body'],['2',72,696,14,0,'Body'],line('ratio =',700)],[[58,708,98]],'fraction'],
  // pdfminer writes an unmapped glyph as "(cid:N)"; the fixture carries that output.
  ['undecodable',[line('Ratio (cid:12) of the pool')],[],'undecodable'],
 ];
 for(const [name,draws,rules,kind] of cases){
  const w=required(await read(name,pdf(name,draws,rules)));
  assert.equal(w.length,1,name+': required');assert.equal(w[0].evidence?.kind,kind,name+': '+JSON.stringify(w[0].evidence));
 }
 console.log('PASS pdf math evidence: exact Unicode math and footnote markers read clean (advisory only); undecodable glyphs, math fonts, script glyphs and fraction rules require confirmation');
}finally{fs.rmSync(out,{recursive:true,force:true});}
