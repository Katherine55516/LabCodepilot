/** Private host configuration for real native-export regression rendering.
 * The bundled headless office must see the same host CJK fonts as the UI. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
/** A sans TrueType file for synthetic fixtures: Arial on macOS, else its metric twin (Liberation Sans) or DejaVu Sans. */
export function sansFontFile(){
 const mac='/System/Library/Fonts/Supplemental/Arial.ttf';if(fs.existsSync(mac))return mac;
 const matched=spawnSync('fc-match',['-f','%{file}','Arial:style=Regular'],{encoding:'utf8'}).stdout?.trim();
 const found=[matched,'/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(file=>file&&/\.ttf$/iu.test(file)&&fs.existsSync(file));
 if(!found)throw Error('No sans TrueType font found; install Arial, Liberation Sans or DejaVu Sans.');
 return found;
}
export function prepareLocalPptFonts(output){
 output=path.resolve(output);
 const tools=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override');
 if(fs.existsSync(tools)&&!String(process.env.PATH).split(path.delimiter).includes(tools))process.env.PATH=tools+path.delimiter+process.env.PATH;
 const bundled=path.resolve(tools,'../../native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fontconfig/fonts.conf');
 if(process.platform!=='darwin'||!fs.existsSync(bundled)||(process.env.FONTCONFIG_FILE&&fs.existsSync(process.env.FONTCONFIG_FILE)))return;
 fs.mkdirSync(output,{recursive:true});const cache=path.join(output,'font-cache');fs.mkdirSync(cache,{recursive:true});
 const xml=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;');
 const dirs=[path.resolve(path.dirname(bundled),'../fonts/truetype'),'/System/Library/Fonts','/System/Library/Fonts/Supplemental','/Library/Fonts',path.join(os.homedir(),'Library/Fonts')];
 const file=path.join(output,'fonts.conf');fs.writeFileSync(file,`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include ignore_missing="yes">${xml(bundled)}</include>${dirs.map(d=>`<dir>${xml(d)}</dir>`).join('')}<cachedir>${xml(cache)}</cachedir></fontconfig>`);process.env.FONTCONFIG_FILE=file;
}
