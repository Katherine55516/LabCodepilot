/** Private host configuration for real native-export regression rendering.
 * The bundled headless office must see the same host CJK fonts as the UI. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
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
