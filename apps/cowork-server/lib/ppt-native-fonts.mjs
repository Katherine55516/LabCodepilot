/** Account-owned embedded EOT fonts, bounded ZIP/SFNT parsing. No URL fetches,
 * arbitrary filesystem paths, global font installation or model payloads. */
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as store from './ppt-store.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map();
function fontParts(bytes){
 const minimum=Math.max(0,bytes.length-65557);let end=-1;
 for(let i=bytes.length-22;i>=minimum;i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('native_font_invalid_zip');
 const count=bytes.readUInt16LE(end+10);let at=bytes.readUInt32LE(end+16),total=0;const fonts=[];
 for(let i=0;i<count;i++){
  if(at+46>bytes.length||bytes.readUInt32LE(at)!==0x02014b50)throw Error('native_font_invalid_directory');
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),size=bytes.readUInt32LE(at+20),expanded=bytes.readUInt32LE(at+24),nl=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42),name=bytes.subarray(at+46,at+46+nl).toString('utf8');at+=46+nl+extra+comment;
  if(!/^ppt\/fonts\/[a-zA-Z0-9_.-]+\.(?:fntdata|fnt)$/u.test(name))continue;
  if(fonts.length>=32||flags&1||![0,8].includes(method)||size>20*1024*1024||expanded>20*1024*1024||(total+=expanded)>64*1024*1024||offset+30>bytes.length||bytes.readUInt32LE(offset)!==0x04034b50)throw Error('native_font_package_limit');
  const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28);if(start+size>bytes.length)throw Error('native_font_invalid_part');
  const compressed=bytes.subarray(start,start+size),eot=method===8?inflateRawSync(compressed,{maxOutputLength:20*1024*1024}):compressed;
  // A MicroType Express font stays in the package and is not served (ppt-fonts.mjs).
  if(eot.length>=16&&eot.readUInt32LE(12)&4)continue;
  if(eot.length!==expanded||eot.length<82||eot.readUInt32LE(0)!==eot.length)throw Error('native_font_unsupported_eot');
  const length=eot.readUInt32LE(4);if(length<12||length>eot.length-82)throw Error('native_font_invalid_eot_size');
  fonts.push(Buffer.from(eot.subarray(eot.length-length)));
 }
 return fonts;
}
function details(bytes){
 const magic=bytes.subarray(0,4).toString('hex');if(!['00010000','4f54544f','74727565'].includes(magic))throw Error('native_font_unsupported_sfnt');
 const count=bytes.readUInt16BE(4),tables=new Map();if(count>128||12+count*16>bytes.length)throw Error('native_font_invalid_tables');
 for(let i=0;i<count;i++){const at=12+16*i,name=bytes.subarray(at,at+4).toString(),offset=bytes.readUInt32BE(at+8),length=bytes.readUInt32BE(at+12);if(offset+length>bytes.length)throw Error('native_font_invalid_table');tables.set(name,{offset,length});}
 const names=tables.get('name'),os2=tables.get('OS/2');if(!names||names.length<6)throw Error('native_font_missing_names');
 const base=names.offset,n=bytes.readUInt16BE(base+2),textBase=base+bytes.readUInt16BE(base+4),families=new Set();if(6+n*12>names.length)throw Error('native_font_invalid_name_table');
 for(let i=0;i<n;i++){const at=base+6+i*12,platform=bytes.readUInt16BE(at),id=bytes.readUInt16BE(at+6),length=bytes.readUInt16BE(at+8),offset=textBase+bytes.readUInt16BE(at+10);if(![1,4,16].includes(id)||offset+length>base+names.length)continue;let text;if(platform===0||platform===3){if(length%2)continue;text=Buffer.from(bytes.subarray(offset,offset+length)).swap16().toString('utf16le');}else if(platform===1)text=bytes.subarray(offset,offset+length).toString('latin1');else continue;
  if(text.length<=128&&/^[\p{L}\p{N} _.,()+-]+$/u.test(text))families.add(text);
 }
 const weight=os2&&os2.length>=10?bytes.readUInt16BE(os2.offset+4):400,fsType=os2&&os2.length>=10?bytes.readUInt16BE(os2.offset+8):0;
 if(!families.size)throw Error('native_font_empty_family');return {families:[...families],weight:Math.max(100,Math.min(900,weight)),fsType};
}
export function parseEmbeddedFonts(bytes){return fontParts(bytes).map(bytes=>({sha256:hash(bytes),bytes,...details(bytes)}));}
export function projectNativeFonts(project){
 if(!project.templateFidelity||!/^\w{32}$/u.test(project.template||''))return [];
 const owner=store.listTemplates('managed').some(t=>t.id===project.template)?'managed':project.uid;
 const bytes=store.readTemplate(owner,project.template),key=hash(bytes);
 if(key!==project.templateFidelity.sha256)throw Error('native_font_template_hash_changed');
 if(!cache.has(key)){if(cache.size>=24)cache.delete(cache.keys().next().value);cache.set(key,parseEmbeddedFonts(bytes));}
 return cache.get(key);
}
export function fontManifest(project){return projectNativeFonts(project).flatMap(font=>font.families.map(family=>({family,sha256:font.sha256,weight:font.weight,fsType:font.fsType,url:`/api/ppt/projects/${project.id}/native-fonts/${font.sha256}.ttf`})));}
export function withNativeFontCss(project,svg){
 const css=projectNativeFonts(project).flatMap(font=>font.families.filter(f=>svg.includes(f)).map(family=>`@font-face{font-family:${JSON.stringify(family)};font-weight:${font.weight};src:url(data:font/ttf;base64,${font.bytes.toString('base64')}) format('truetype');}`)).join('');
 return css?svg.replace(/(<svg\b[^>]*>)/u,'$1<defs><style>'+css+'</style></defs>'):svg;
}
