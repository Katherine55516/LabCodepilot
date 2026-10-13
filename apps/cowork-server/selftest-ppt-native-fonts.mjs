import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {parseEmbeddedFonts} from './lib/ppt-native-fonts.mjs';import {FONT_SCRIPT} from './lib/ppt-fonts.mjs';
assert.throws(()=>parseEmbeddedFonts(Buffer.from('invalid ZIP')),/invalid_zip/);
const template=process.env.PPT_FONT_TEST_TEMPLATE;
if(template){
 const bytes=fs.readFileSync(template),fonts=parseEmbeddedFonts(bytes);assert.equal(fonts.length,3);assert.ok(fonts.some(f=>f.families.includes('Source Sans 3')&&f.weight===400));assert.ok(fonts.some(f=>f.families.includes('Libre Baskerville Bold')));assert.ok(fonts.every(f=>f.fsType===0));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-font-check-'));
 try{
  const code=FONT_SCRIPT+`\nimport os,json\nfrom pptx import Presentation\nos.environ.update(office_font_environment(${JSON.stringify(dir)},${JSON.stringify(template)}))\np=Presentation();slide=p.slides.add_slide(p.slide_layouts[6]);run=slide.shapes.add_textbox(0,0,1000000,1000000).text_frame.paragraphs[0].add_run();run.text='Alpha 因子收益';parts=font_runs(run,'Source Sans 3','Arial Unicode MS');result=[{'text':part.text,'font':family} for part,family in parts];assert result[0]['font']=='Source Sans 3';assert ''.join(item['text'] for item in result)==run._parent.text;assert resolve_font('Libre Baskerville Bold','Alpha Mining')=='Libre Baskerville';print(json.dumps(result,ensure_ascii=False))`;
  const result=spawnSync(process.env.PPT_TEST_PYTHON||'python3',['-c',code],{encoding:'utf8',timeout:90000});assert.equal(result.status,0,result.stderr);console.log(result.stdout.trim());
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
console.log('Bounded embedded-font parsing and template Latin/CJK cluster font preservation passed'+(template?' with actual template':' (actual-template check not requested)'));
