// One-time migration (restructure stage 1): move the embedded media payloads
// out of standalone/Train-With-Panda-Portal.html into src/media/ as binary
// files, and write src/portal.template.html with a single marker in their place.
// Refuses to run if src/media already exists. Verifies that the result
// reassembles to the identical standalone before writing anything.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sourceFile=path.join(root,'standalone/Train-With-Panda-Portal.html');
const mediaDir=path.join(root,'src/media'),templateFile=path.join(root,'src/portal.template.html');
if(fs.existsSync(mediaDir))throw Error('src/media already exists; extraction has already run.');
const source=fs.readFileSync(sourceFile,'utf8');
if(source.includes('\r'))throw Error('Standalone contains CR characters; check out with LF first.');
const marker='<!--@media src/media/manifest.json-->';
if(source.includes(marker))throw Error('Marker already present in the standalone.');
const lines=source.split('\n'),re=/^<script type="text\/plain" id="(panda-[A-Za-z0-9_-]+)">([A-Za-z0-9+/=]*)<\/script>$/;
const hits=lines.map((l,i)=>re.test(l)?i:-1).filter(i=>i>=0);
const first=hits[0],last=hits[hits.length-1];
if(hits.length!==last-first+1)throw Error('Media payload lines are not contiguous.');
if((source.match(/<script\b[^>]*type=["']text\/plain["']/gi)||[]).length!==hits.length)throw Error('Media payloads found outside the contiguous block.');
const type=b=>{
 if(b.toString('latin1',4,12)==='ftypavif')return 'avif';
 if(b.toString('latin1',0,4)==='RIFF'&&b.toString('latin1',8,12)==='WEBP')return 'webp';
 if(b.toString('latin1',0,4)==='\x89PNG')return 'png';
 if(b.toString('latin1',4,8)==='ftyp')return 'mp4';
 if(/^\s*<(\?xml|svg)/.test(b.toString('utf8',0,200)))return 'svg';
 throw Error('Unknown media type.');
};
const media=hits.map(i=>{
 const [,id,b64]=lines[i].match(re),bytes=Buffer.from(b64,'base64');
 if(bytes.toString('base64')!==b64)throw Error('Non-canonical base64, cannot round-trip: '+id);
 return {name:id+'.'+type(bytes),bytes};
});
const template=[...lines.slice(0,first),marker,...lines.slice(last+1)].join('\n');
const rebuilt=template.replace(marker,()=>media.map(m=>`<script type="text/plain" id="${m.name.replace(/\.[a-z0-9]+$/,'')}">${m.bytes.toString('base64')}</script>`).join('\n'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
if(hash(rebuilt)!==hash(source))throw Error('Round trip failed; nothing written.');
fs.mkdirSync(mediaDir,{recursive:true});
for(const m of media)fs.writeFileSync(path.join(mediaDir,m.name),m.bytes);
fs.writeFileSync(path.join(mediaDir,'manifest.json'),JSON.stringify(media.map(m=>m.name),null,2)+'\n');
fs.writeFileSync(templateFile,template);
const counts=media.reduce((a,m)=>{const t=m.name.split('.').pop();a[t]=(a[t]||0)+1;return a;},{});
console.log(`Extracted ${media.length} payloads from lines ${first+1}-${last+1} into src/media (${JSON.stringify(counts)}); template ${Buffer.byteLength(template)} bytes.`);
