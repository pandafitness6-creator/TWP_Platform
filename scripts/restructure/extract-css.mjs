// One-time migration (restructure stage 3): move the 9 <style> blocks out of
// src/portal.template.html into src/css/, and the 3 embedded woff fonts out of
// that CSS into src/fonts/.
// - Each CSS file holds the block's text exactly, minus the newlines at its very
//   start and end, plus one final newline (which assemble.mjs strips). The
//   template keeps those boundary newlines around /*@css src/css/<file>*/.
// - Each font's base64 is replaced by /*@font src/fonts/<file>*/ inside the CSS.
// Refuses to run if src/css exists. Verifies the round trip before writing.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const templateFile=path.join(root,'src/portal.template.html');
const cssDir=path.join(root,'src/css'),fontDir=path.join(root,'src/fonts');
if(fs.existsSync(cssDir)||fs.existsSync(fontDir))throw Error('src/css or src/fonts already exists; extraction has already run.');
const template=fs.readFileSync(templateFile,'utf8');
if(template.includes('/*@css')||template.includes('/*@font'))throw Error('Template already contains CSS or font markers.');
// In source order; ids must match the blocks found.
const names=[
 [null,'01-visual-system.css'],
 [null,'02-presentation-arabic.css'],
 ['panda-coaching-095','03-coaching-tools.css'],
 ['panda-studio-096','04-studio.css'],
 ['panda-supplement-097','05-supplements-and-updates.css'],
 ['panda-cards-0915','06-overview-meal-cards.css'],
 ['panda-chat-badge','07-chat-badge.css'],
 ['panda-meal-photo-tools','08-meal-photo-tools.css'],
 ['panda-chat-0915','09-chat-layout.css'],
];
const fontFiles={PandaDisplay:'panda-display.woff',PandaSans:'panda-sans.woff',PandaArabic:'panda-arabic.woff'};
const blocks=[...template.matchAll(/<style( id="[^"]+")?>([\s\S]*?)<\/style>/g)];
if(blocks.length!==names.length||template.split('<style').length-1!==names.length)throw Error('Expected exactly 9 <style> blocks.');
const fonts=[],css=[];
let out='',at=0;
blocks.forEach((m,i)=>{
 const [id,file]=names[i];
 if((m[1]||'')!==(id?` id="${id}"`:''))throw Error(`Block ${i+1} has attributes ${m[1]||'(none)'}, expected id ${id}.`);
 const content=m[2],lead=content.match(/^\n*/)[0],trail=content.match(/\n*$/)[0];
 let core=content.slice(lead.length,content.length-trail.length);
 core=core.replace(/(font-family:\s*([A-Za-z]+);\s*src:\s*url\("data:font\/woff;base64,)([A-Za-z0-9+/=]+)("\))/g,(_,pre,family,b64,post)=>{
  const bytes=Buffer.from(b64,'base64');
  if(bytes.toString('base64')!==b64||bytes.toString('latin1',0,4)!=='wOFF')throw Error('Font is not a canonical base64 woff: '+family);
  if(!fontFiles[family])throw Error('Unexpected font family: '+family);
  fonts.push({family,file:fontFiles[family],bytes});
  return `${pre}/*@font src/fonts/${fontFiles[family]}*/${post}`;
 });
 if(/data:font\/[a-z0-9]+;base64,(?!\/\*@font )/.test(core))throw Error('Unextracted font data URI left in block '+(i+1));
 css.push({id,file,text:core+'\n'});
 const tagStart=m.index+m[0].indexOf('>')+1;
 out+=template.slice(at,tagStart)+lead+`/*@css src/css/${file}*/`+trail;
 at=m.index+m[0].length-'</style>'.length;
});
out+=template.slice(at);
if(fonts.length!==3)throw Error('Expected 3 embedded fonts, found '+fonts.length);
// Round trip: resolve markers back and compare.
const back=out.replace(/\/\*@css src\/css\/([^*]+)\*\//g,(_,f)=>css.find(c=>c.file===f).text.slice(0,-1).replace(/\/\*@font src\/fonts\/([^*]+)\*\//g,(_,g)=>fonts.find(x=>x.file===g).bytes.toString('base64')));
if(back!==template)throw Error('Round trip failed; nothing written.');
fs.mkdirSync(cssDir);fs.mkdirSync(fontDir);
for(const c of css)fs.writeFileSync(path.join(cssDir,c.file),c.text);
for(const f of fonts)fs.writeFileSync(path.join(fontDir,f.file),f.bytes);
fs.writeFileSync(path.join(cssDir,'manifest.json'),JSON.stringify(css.map(({file,id})=>({file,id})),null,2)+'\n');
fs.writeFileSync(path.join(fontDir,'manifest.json'),JSON.stringify(fonts.map(({family,file})=>({family,file})),null,2)+'\n');
fs.writeFileSync(templateFile,out);
console.log(`Extracted ${css.length} CSS blocks into src/css and ${fonts.length} fonts into src/fonts; template ${Buffer.byteLength(out)} bytes.`);
