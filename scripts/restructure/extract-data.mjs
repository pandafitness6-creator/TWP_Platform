// One-time migration (restructure stage 2): move the 18 pure-JSON
// window.PANDA_* data globals out of src/portal.template.html into
// src/data/<name>.json, byte-for-byte as they appear (no re-serialising:
// several contain forms like 0.0 or ", " that JSON.stringify would change).
// Each value is replaced in place by /*@data src/data/<name>.json*/ and
// src/data/manifest.json records the globals in template order.
// Refuses to run if src/data already exists. Verifies the round trip first.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const templateFile=path.join(root,'src/portal.template.html'),dataDir=path.join(root,'src/data');
if(fs.existsSync(dataDir))throw Error('src/data already exists; extraction has already run.');
const template=fs.readFileSync(templateFile,'utf8');
if(template.includes('/*@data'))throw Error('Template already contains data markers.');
const globals=['PANDA_MEDIA','PANDA_CAST','PANDA_LOGIN_VIDEOS','PANDA_AR_ARTICLES','PANDA_PLAN_LIBRARY','PANDA_CARDIO_TEMPLATES','PANDA_SUPPLEMENT_PLANS','PANDA_ARTICLE_IMAGES','PANDA_CATALOGUE','PANDA_LIBRARY_EXTENSION','PANDA_CARDIO_EXTENSION','PANDA_SEED_BASE','PANDA_RECIPE_SEED','PANDA_RECIPE_INGREDIENTS','PANDA_EDUCATION_095','PANDA_CARDIO_METHODS','PANDA_CARDIO_INTENSITIES','PANDA_CARDIO_DEFAULTS'];
// End of the JSON value starting at `start` (an opening { or [), string-aware.
const valueEnd=start=>{
 let depth=0,inString=false,escaped=false;
 for(let i=start;i<template.length;i++){
  const c=template[i];
  if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
  if(c==='"'){inString=true;continue;}
  if(c==='{'||c==='[')depth++;
  if((c==='}'||c===']')&&--depth===0)return i+1;
 }
 throw Error('Unterminated JSON value at offset '+start);
};
const entries=globals.map(global=>{
 const key='window.'+global+'=';
 if(template.split(key).length!==2)throw Error('Expected exactly one assignment: '+key);
 const start=template.indexOf(key)+key.length;
 if(!'{['.includes(template[start]))throw Error('Not a JSON literal: '+global);
 const end=valueEnd(start),text=template.slice(start,end);
 if(template[end]!==';')throw Error('Assignment does not end after the JSON value: '+global);
 JSON.parse(text);
 return {global,file:global.toLowerCase().replaceAll('_','-')+'.json',start,end,text};
});
for(let i=1;i<entries.length;i++)if(entries[i].start<entries[i-1].end)throw Error('Globals are not listed in template order: '+entries[i].global);
let out='',at=0;
for(const e of entries){out+=template.slice(at,e.start)+`/*@data src/data/${e.file}*/`;at=e.end;}
out+=template.slice(at);
const back=out.replace(/\/\*@data src\/data\/([a-z0-9-]+\.json)\*\//g,(_,f)=>entries.find(e=>e.file===f).text);
if(back!==template)throw Error('Round trip failed; nothing written.');
fs.mkdirSync(dataDir);
for(const e of entries)fs.writeFileSync(path.join(dataDir,e.file),e.text);
fs.writeFileSync(path.join(dataDir,'manifest.json'),JSON.stringify(entries.map(({global,file})=>({global,file})),null,2)+'\n');
fs.writeFileSync(templateFile,out);
console.log(`Extracted ${entries.length} data globals into src/data (${entries.reduce((a,e)=>a+Buffer.byteLength(e.text),0)} bytes); template ${Buffer.byteLength(out)} bytes.`);
