// Option D POC: export a stored deck as it stands (no publication) on the host
// and render it, to look at a deck a review has held back.
// Usage: COWORK_STATE_DIR=<state> node scripts/ppt/option-d-export.mjs <uid> <projectId> <outDir> [fontconfig]
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const [uid,id,out,fontconfig]=process.argv.slice(2),root=process.cwd();
const lib=name=>import(path.join(root,'apps/cowork-server/lib',name+'.mjs'));
const [store,fidelity,quality,{localPptRuntime}]=await Promise.all([lib('ppt-store'),lib('ppt-template-fidelity'),lib('ppt/quality-service'),import(path.join(root,'apps/cowork-server/test/ppt-local-runtime.mjs'))]);
const project=structuredClone(store.get(uid,id));if(!project?.deck)throw Error('no deck');
const reviewed=quality.reviewProject(project);
const runtime=localPptRuntime(out,'/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
const candidate={...reviewed.project,renderOutput:'/workspace/deck.pptx'};
const exported=await fidelity.renderTemplatePptx(candidate,runtime.io);
const pptx=runtime.host(candidate,'/workspace/deck.pptx'),dir=path.dirname(pptx),bin='/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override';
spawnSync(path.join(bin,'soffice'),['--headless','--convert-to','pdf','--outdir',dir,pptx],{timeout:300000,env:{...process.env,...(fontconfig?{FONTCONFIG_FILE:fontconfig}:{})}});
spawnSync(path.join(bin,'pdftoppm'),['-png','-r','60',path.join(dir,'deck.pdf'),path.join(dir,'page')]);
console.log(JSON.stringify({pptx,verification:exported?.exportVerification?.status,deterministicErrors:reviewed.deterministic.issues.filter(i=>i.severity==='error').length,pngs:fs.readdirSync(dir).filter(n=>n.endsWith('.png')).length}));
