import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

/** Unknown runtime roots (user skills, CLI locations) are not application assets.
 * NFT represents them as a literal root-level wildcard-directory prefix. Next uses contains
 * matching: the lookbehind anchors that prefix so globs with an assets directory prefix remain traceable.
 * Explicit files and all statically rooted dependency globs stay untouched. */
export function limitUnresolvedRuntimeTrace(config:{plugins?:unknown[]}){
 let updated=0;
 for(const candidate of config.plugins||[]){
  if(!candidate||typeof candidate!=='object'||candidate.constructor.name!=='TraceEntryPointsPlugin')continue;
  const plugin=candidate as {traceIgnores?:string[]};
  if(!Array.isArray(plugin.traceIgnores))throw new Error('Next trace plugin contract changed: expected traceIgnores before runtime-root glob expansion');
  const expression='(?<![\\s\\S])\\*\\*/\\*/**';
  if(!plugin.traceIgnores.includes(expression)){plugin.traceIgnores.push(expression);updated++;}
 }
 return updated;
}

/** Turbopack 16.2 omits instrumentation from its route exclude pass. Apply only
 * the project-local test exclusions before Next copies the standalone files. */
export async function prunePptTestBuildTrace({projectDir,distDir}:{projectDir:string;distDir:string}){
 const trace=path.join(distDir,'server','instrumentation.js.nft.json');
 let data:{version:number;files:string[]};
 try{data=JSON.parse(await readFile(trace,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {removed:0,missing:true};throw error;}
 const roots=['outputs','.ppt-build','.playwright-mcp'].map(name=>path.resolve(projectDir,name)+path.sep);
 const files=data.files.filter(file=>!roots.some(root=>path.resolve(path.dirname(trace),file).startsWith(root)));
 await writeFile(trace,JSON.stringify({...data,files}));
 return {removed:data.files.length-files.length,missing:false};
}
