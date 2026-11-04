// Immutable application snapshot for UI verification; no user configuration copied.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=process.cwd(),id=Date.now().toString(36),target=path.join(root,'.codepilot','quality-routing-ui',id);
fs.mkdirSync(target,{recursive:true});
for(const name of ['src','public','themes','package.json','package-lock.json','next.config.ts','postcss.config.mjs'])if(fs.existsSync(path.join(root,name)))fs.cpSync(path.join(root,name),path.join(target,name),{recursive:true});
// Cache tuning belongs to this disposable QA build, not the product config.
const qaConfig=fs.readFileSync(target+'/next.config.ts','utf8').replace('    if (dev) {','    if (dev) {\n      config.cache = false; // Disposable UI verification snapshot only.');fs.writeFileSync(target+'/next.config.ts',qaConfig);
const config=JSON.parse(fs.readFileSync(root+'/tsconfig.json','utf8'));config.include=config.include.filter(value=>!value.startsWith('.next-ppt-'));fs.writeFileSync(target+'/tsconfig.json',JSON.stringify(config,null,2));
fs.writeFileSync(target+'/next-env.d.ts','/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n');
for(const name of ['node_modules','apps','packages','vendor'])if(fs.existsSync(path.join(root,name)))fs.symlinkSync(path.join(root,name),path.join(target,name),'dir');
const files={};function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else files[path.relative(target,file)]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}}
walk(target+'/src');const codeHash=crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');const manifest={root,target,codeHash,files,configurationOverrides:['Webpack development cache disabled in disposable snapshot; isolated distDir'],at:new Date().toISOString()};fs.writeFileSync(target+'/source-manifest.json',JSON.stringify(manifest,null,2));fs.writeFileSync(root+'/.codepilot/quality-routing-baseline/ui-snapshot.json',JSON.stringify(manifest,null,2));console.log({target,codeHash,files:Object.keys(files).length});
