import {test}from 'node:test';
import {execFileSync}from 'node:child_process';
import {mkdtempSync,rmSync}from 'node:fs';
import {tmpdir}from 'node:os';
import {join}from 'node:path';
test('Gamma comparison preserves semantic relationships and native formula geometry',()=>{
  const state=mkdtempSync(join(tmpdir(),'ppt-gamma-semantic-'));
  try{execFileSync(process.execPath,['apps/cowork-server/selftest-ppt-gamma-semantic.mjs'],{cwd:process.cwd(),env:{...process.env,COWORK_STATE_DIR:state},encoding:'utf8',timeout:120000});}finally{rmSync(state,{recursive:true,force:true});}
});
