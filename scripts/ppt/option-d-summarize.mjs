// Option D POC: summarize a live run directory written by option-d-live.mjs
// (card text against the D-4 budgets, native/theme pages, components, model
// calls and time), and render deck.pptx to PNGs plus a contact sheet.
// Usage: node scripts/ppt/option-d-summarize.mjs <runDir> [fontconfig]
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const [dir,fontconfig]=process.argv.slice(2);
const root=process.cwd();
const {pointBudgetRatio,labelProblem}=await import(path.join(root,'apps/cowork-server/lib/ppt-outline-cards.mjs'));
const outline=JSON.parse(fs.readFileSync(path.join(dir,'outline.json'),'utf8'));
const summary=JSON.parse(fs.readFileSync(path.join(dir,'summary.json'),'utf8'));
const points=outline.slice(1).flatMap(card=>card.points);
const ratios=points.map(point=>pointBudgetRatio(point.text));
const cards=outline.slice(1);
const report={
 pages:outline.length,cards:cards.length,points:points.length,
 pointsPerCard:Math.round(points.length/Math.max(1,cards.length)*10)/10,
 withinBudget:ratios.filter(r=>r<=1).length,within130:ratios.filter(r=>r<=1.3).length,maxRatio:Math.round(Math.max(0,...ratios)*100)/100,
 labelled:points.filter(point=>point.label).length,labelsValid:points.filter(point=>point.label&&!labelProblem(point.label,point.text)).length,
 cardsAllLabelled:cards.filter(card=>card.points.length>1&&card.points.every(point=>point.label)).length,
 numberedCards:cards.filter(card=>card.numbered).length,statementCards:cards.filter(card=>card.points.length===1).length,
 titleLengths:cards.map(card=>String(card.title).length),
 pageModes:summary.cardPages?.reduce((counts,page)=>{const key=page.mode?page.mode+(page.shape?':'+page.shape:''):'other';counts[key]=(counts[key]||0)+1;return counts;},{}),
 published:summary.published,status:summary.status,blocking:summary.blocking,seconds:summary.seconds,modelCalls:summary.modelCalls,calls:summary.calls,
};
const deck=path.join(dir,'deck.pptx');
if(fs.existsSync(deck)){
 const bin='/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override',render=path.join(dir,'render');
 fs.mkdirSync(render,{recursive:true});
 spawnSync(path.join(bin,'soffice'),['--headless','--convert-to','pdf','--outdir',render,deck],{timeout:300000,env:{...process.env,...(fontconfig?{FONTCONFIG_FILE:fontconfig}:{})}});
 const pdf=path.join(render,'deck.pdf');
 if(fs.existsSync(pdf)){
  spawnSync(path.join(bin,'pdftoppm'),['-png','-r','60',pdf,path.join(render,'page')]);
  const python='/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
  spawnSync(python,['-I','-c',`from PIL import Image\nimport glob,sys\nfiles=sorted(glob.glob(sys.argv[1]+'/page-*.png'))\nims=[Image.open(f) for f in files]\nw,h=ims[0].size\ncols=3;rows=(len(ims)+cols-1)//cols\nsheet=Image.new('RGB',(cols*w+(cols+1)*8,rows*h+(rows+1)*8),'#888')\nfor i,im in enumerate(ims): sheet.paste(im,(8+(i%cols)*(w+8),8+(i//cols)*(h+8)))\nsheet.save(sys.argv[1]+'/contact-sheet.png')`,render]);
  report.render=fs.readdirSync(render).filter(name=>name.endsWith('.png')).length;
 }
}
fs.writeFileSync(path.join(dir,'analysis.json'),JSON.stringify(report,null,1));
console.log(JSON.stringify(report,null,1));
