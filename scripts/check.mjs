import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {readMediaIndex} from './media-index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release=JSON.parse(fs.readFileSync(path.join(root,'release.json')));
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const source=fs.readFileSync(path.join(root,release.standalone.file));
if(digest(source)!==release.standalone.sha256)throw Error('Standalone changed. Rebuild before deployment.');
for(const entry of release.files){const b=fs.readFileSync(path.join(root,'public',entry.name));if(b.length!==entry.bytes||digest(b)!==entry.sha256)throw Error('Changed public file: '+entry.name);if(b.length>25*1048576)throw Error('Asset too large: '+entry.name);if(entry.name.endsWith('.js'))new vm.Script(b.toString(),{filename:entry.name});}
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');let count=0;
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(!/\bsrc=/.test(m[1])&&!/\btype=["'](?:application\/json|text\/plain)/.test(m[1])){new vm.Script(m[2],{filename:'inline-'+count++});}}
const expected=new Map([...source.toString().matchAll(/<script\b([^>]*\btype=["']text\/plain["'][^>]*)>([\s\S]*?)<\/script>/gi)].map(m=>[m[1].match(/\bid=["']([^"']+)/)[1],m[2]]));
const restored=new Map(),document={createDocumentFragment(){return {append(n){restored.set(n.id,n.textContent)}}},createElement(){return {}},head:{append(){}}};
for(const f of release.files.filter(x=>x.name.endsWith('.js')))vm.runInNewContext(fs.readFileSync(path.join(root,'public',f.name),'utf8'),{document});
const external=new Map(),sourceResolver=readMediaIndex(source.toString()),publicResolver=readMediaIndex(html);
for(const item of release.external_media||[]){
 if(!item.id.startsWith('panda-library-image-')||!expected.has(item.id)||external.has(item.id)||restored.has(item.id))throw Error('Invalid external media ID: '+item.id);
 if(!/^media\/library\/[a-f0-9]{24}\.webp$/.test(item.name)||item.prefix!=='data:image/webp;base64,')throw Error('Invalid external media entry: '+item.id);
 const bytes=fs.readFileSync(path.join(root,'public',item.name)),entry=release.files.find(x=>x.name===item.name);
 if(!entry||bytes.length!==item.bytes||digest(bytes)!==item.sha256||entry.sha256!==item.sha256||entry.bytes!==item.bytes)throw Error('External media hash mismatch: '+item.id);
 if(!bytes.equals(Buffer.from(expected.get(item.id).replace(/\s/g,''),'base64')))throw Error('External media differs from source payload: '+item.id);
 if(!item.name.endsWith(item.sha256.slice(0,24)+'.webp'))throw Error('External filename is not content hashed: '+item.id);
 external.set(item.id,item);
}
if(expected.size!==restored.size+external.size)throw Error('Media count mismatch.');
if(release.media_payloads!==expected.size)throw Error('Release media total mismatch.');
for(const [id,text]of expected){
 if(id.startsWith('panda-library-image-')){if(!external.has(id))throw Error('Library image was not externalized: '+id);}
 else if(restored.get(id)!==text)throw Error('Media payload changed: '+id);
}
if(Object.keys(sourceResolver.index).length!==Object.keys(publicResolver.index).length)throw Error('Public media index has missing paths.');
const runtime={window:{},document:{getElementById:id=>restored.has(id)?{textContent:restored.get(id)}:null}};
vm.runInNewContext(html.slice(publicResolver.statementStart,publicResolver.statementEnd),runtime);
for(const [key,record]of Object.entries(sourceResolver.index)){
 const emitted=publicResolver.index[key],asset=external.get(record[0]);
 if(asset){
  if(JSON.stringify(emitted)!==JSON.stringify([record[0],record[1],'./'+asset.name]))throw Error('Invalid external resolver mapping: '+key);
  if(record[1]!==asset.prefix||runtime.window.PANDA_RESOLVE_ASSET(key)!=='./'+asset.name)throw Error('External image resolver failed: '+key);
 }else{
  if(JSON.stringify(emitted)!==JSON.stringify(record))throw Error('Original media index changed: '+key);
  if(runtime.window.PANDA_RESOLVE_ASSET(key)!==record[1]+expected.get(record[0]).trim())throw Error('Original media resolver failed: '+key);
 }
}
console.log(`PASS: release hashes, asset limits, ${count} inline scripts, ${restored.size} unchanged bundled payloads and ${external.size} byte-identical external library images. Supabase live setup is a separate deployment step.`);
