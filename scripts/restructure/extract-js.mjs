// One-time migration (restructure stage 4): split the inline <script> of
// src/portal.template.html into 26 files in src/js/, in original order.
// Ranges are line numbers of the v0.9.16 standalone (PLAN.md §4.4); every range
// holds whole top-level statements, with the comments and blank lines before a
// statement attached to it. Unit 5427-5599 (four modules sharing a closure) and
// PandaPortal stay whole. Each file holds its lines exactly, ending with one
// newline; the template keeps one /*@js src/js/<file>*/ line per file, plus the
// script's own blank first line and three blank last lines.
// Refuses to run if src/js exists. Verifies the round trip before writing.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const templateFile=path.join(root,'src/portal.template.html'),jsDir=path.join(root,'src/js');
if(fs.existsSync(jsDir))throw Error('src/js already exists; extraction has already run.');
const template=fs.readFileSync(templateFile,'utf8');
if(template.includes('/*@js'))throw Error('Template already contains JS markers.');
const files=[
 [4609,'01-resolve-asset.js'],[4610,'02-config.js'],[4613,'03-media-cast.js'],[4621,'04-login-video.js'],
 [4739,'05-experience.js'],[4777,'06-brand.js'],[4780,'07-framing.js'],[4813,'08-arabic.js'],
 [5322,'09-i18n.js'],[5392,'10-plan-data.js'],[5398,'11-studio.js'],[5412,'12-catalogue.js'],
 [5426,'13-seed-coaching-recipes.js'],[5600,'14-cardio-options.js'],[5605,'15-services.js'],[5675,'16-cloud.js'],
 [5828,'17-chat-badge.js'],[5843,'18-chat.js'],[5902,'19-guides.js'],[6103,'20-attention.js'],
 [6126,'21-selects.js'],[6163,'22-ui.js'],[6293,'23-anatomy.js'],[6359,'24-account-ui.js'],
 [6417,'25-calories.js'],[6441,'26-portal.js'],
];
const firstLine=4608,lastLine=7067,lastCode=7064; // script body in the v0.9.16 standalone
const open='\n<script>\n',close='</script>';
if(template.split(open).length!==2)throw Error('Expected exactly one bare <script> tag.');
const start=template.indexOf(open)+open.length,end=template.indexOf(close,start);
const lines=template.slice(start,end).split('\n'); // body ends with \n, so the last entry is ''
if(lines.length!==lastLine-firstLine+2||lines.at(-1)!=='')throw Error(`Script body has ${lines.length-1} lines, expected ${lastLine-firstLine+1}.`);
const at=n=>lines[n-firstLine];
if(at(firstLine)!==''||[lastCode+1,lastCode+2,lastCode+3].some(n=>at(n)!==''))throw Error('Script body boundaries are not the expected blank lines.');
const js=files.map(([from,file],i)=>{
 const to=(files[i+1]?.[0]??lastCode+1)-1;
 if(to<from||at(to)==='')throw Error(`Range ${from}-${to} for ${file} is empty or ends with a blank line.`);
 return {file,text:lines.slice(from-firstLine,to-firstLine+1).join('\n')+'\n'};
});
const body='\n'+js.map(j=>`/*@js src/js/${j.file}*/\n`).join('')+'\n\n\n';
const out=template.slice(0,start)+body+template.slice(end);
const back=out.replace(/^\/\*@js src\/js\/([^*]+)\*\/$/gm,(_,f)=>js.find(j=>j.file===f).text.slice(0,-1));
if(back!==template)throw Error('Round trip failed; nothing written.');
fs.mkdirSync(jsDir);
for(const j of js)fs.writeFileSync(path.join(jsDir,j.file),j.text);
fs.writeFileSync(path.join(jsDir,'manifest.json'),JSON.stringify(js.map(({file})=>({file})),null,2)+'\n');
fs.writeFileSync(templateFile,out);
console.log(`Extracted ${js.length} JS files into src/js; template ${Buffer.byteLength(out)} bytes.`);
