import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {PYTHON_STDIN_ARGS,pythonStdinInput} from './lib/ppt-python-stdin.mjs';
import {_internals as importer} from './lib/ppt/import-pptx.mjs';import {_internals as render} from './lib/ppt-render.mjs';import {_internals as source} from './lib/ppt-source.mjs';
// Linux rejects any single argv string over 128 KiB (E2BIG), so embedded scripts travel on stdin.
const python=process.env.PPT_TEST_PYTHON||'python3',LIMIT=128*1024;
const run=(script,input,args=[])=>spawnSync(python,[...PYTHON_STDIN_ARGS,...args],{input:pythonStdinInput(script,input),encoding:'utf8'});
assert.ok(PYTHON_STDIN_ARGS.every(arg=>Buffer.byteLength(arg)<1024),'the bootstrap itself stays tiny');
const big='import sys,json\n'+'#\n'.repeat(LIMIT)+"d=json.load(sys.stdin)\nprint(json.dumps({'argv':sys.argv[1:],'main':__name__,'d':d}))";
const r=run(big,JSON.stringify({text:'中文 α²'}),['file.pptx']);assert.equal(r.status,0,r.stderr);
assert.deepEqual(JSON.parse(r.stdout),{argv:['file.pptx'],main:'__main__',d:{text:'中文 α²'}},'script past the argv limit runs as __main__ with its own args and JSON input');
const bytes=Buffer.from([0,255,10,13,0x89,0x50]),b=run("import sys\nprint(sys.stdin.buffer.read().hex())",bytes);
assert.equal(b.stdout.trim(),bytes.toString('hex'),'binary input reaches the script unchanged');
assert.equal(run('import sys\nprint(len(sys.stdin.read()))').stdout.trim(),'0','no input reads as empty');
const e=run("raise SystemExit('boom')");assert.equal(e.status,1);assert.match(e.stderr,/boom/,'script failures keep their exit status and message');
// Every embedded production script compiles through the bootstrap, whatever its size.
for(const [name,script] of [['import',importer.IMPORT_SCRIPT],['export',importer.EXPORT_SCRIPT],['render',render.SCRIPT],['source',source.SCRIPT]]){
  const c=run("import sys\nsrc=sys.stdin.read()\ncompile(src,'<string>','exec')\nprint(len(src.encode()))",script);
  assert.equal(c.status,0,`${name}: ${c.stderr}`);assert.equal(Number(c.stdout),Buffer.byteLength(script),`${name} script arrives intact`);
}
console.log(JSON.stringify({ok:true,exportScriptBytes:Buffer.byteLength(importer.EXPORT_SCRIPT),argvLimit:LIMIT}));
