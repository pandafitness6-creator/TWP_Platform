import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readMediaIndex} from './media-index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceFile=path.join(root,'standalone/Train-With-Panda-Portal.html');
const source=fs.readFileSync(sourceFile,'utf8');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const out=path.join(root,'public'),media=path.join(out,'media'),library=path.join(media,'library');
fs.mkdirSync(media,{recursive:true});
const articleSource=path.join(root,'assets/articles');if(fs.existsSync(articleSource))fs.cpSync(articleSource,path.join(media,'articles'),{recursive:true});
for(const f of fs.readdirSync(media))if(/^panda-media-[a-f0-9]+\.js$/.test(f))fs.unlinkSync(path.join(media,f));
fs.mkdirSync(library,{recursive:true});
for(const f of fs.readdirSync(library))if(/^[a-f0-9]{24}\.webp$/.test(f))fs.unlinkSync(path.join(library,f));
let html=source;const payloads=[];
html=html.replace(/<script\b([^>]*\btype=["']text\/plain["'][^>]*)>([\s\S]*?)<\/script>/gi,(full,attrs,body)=>{
 const id=attrs.match(/\bid=["']([^"']+)["']/)?.[1];
 if(!id||!/^panda-/.test(id)||!/^[A-Za-z0-9+/=\s]+$/.test(body))throw Error('Unexpected embedded asset block.');
 payloads.push([id,body]);return payloads.length===1?'<!--PANDA_MEDIA_BUNDLES-->':'';
});
if(!payloads.length)throw Error('No embedded media found.');
const ids=new Set(payloads.map(p=>p[0]));if(ids.size!==payloads.length)throw Error('Duplicate media IDs.');
// Only the new library images become independent, cacheable, lazily loaded files.
// The canonical standalone and all pre-existing media payloads remain unchanged.
const externalMedia=[],externalIds=new Set(),resolver=readMediaIndex(html);
const aliases=new Map();for(const [key,record]of Object.entries(resolver.index)){const list=aliases.get(record[0])||[];list.push(key);aliases.set(record[0],list);}
for(const [id,body]of payloads.filter(([id])=>id.startsWith('panda-library-image-'))){
 const keys=aliases.get(id);if(!keys?.length)throw Error('Unreferenced library payload: '+id);
 const prefix='data:image/webp;base64,';
 if(keys.some(key=>resolver.index[key][1]!==prefix))throw Error('Library media must be WebP: '+id);
 const encoded=body.replace(/\s/g,''),bytes=Buffer.from(encoded,'base64');
 if(bytes.toString('base64')!==encoded||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw Error('Invalid library WebP payload: '+id);
 const sha256=hash(bytes),name='media/library/'+sha256.slice(0,24)+'.webp';
 fs.writeFileSync(path.join(out,name),bytes);
 externalMedia.push({id,name,prefix,bytes:bytes.length,sha256});externalIds.add(id);
 for(const key of keys)resolver.index[key]=[id,prefix,'./'+name];
}
if(externalMedia.length){
 html=html.slice(0,resolver.start)+JSON.stringify(resolver.index)+html.slice(resolver.end);
 const lookup='if(!record)return key;const node=document.getElementById(record[0]);';
 if(html.split(lookup).length!==2)throw Error('Unexpected embedded resolver lookup.');
 html=html.replace(lookup,'if(!record)return key;if(record[2])return record[2];const node=document.getElementById(record[0]);');
}
const blocks=[],groups=[];let current=[],size=0;
for(const pair of payloads.filter(([id])=>!externalIds.has(id))){const bytes=Buffer.byteLength(JSON.stringify(pair));if(size+bytes>8*1024*1024&&current.length){groups.push(current);current=[];size=0;}current.push(pair);size+=bytes;}if(current.length)groups.push(current);
const bootstrap=pairs=>`/* TRAIN WITH PANDA · embedded media, generated from the standalone HTML. */\n(()=>{const rows=${JSON.stringify(pairs)};const fragment=document.createDocumentFragment();for(const [id,text] of rows){const node=document.createElement('script');node.id=id;node.type='text/plain';node.textContent=text;fragment.append(node);}document.head.append(fragment);})();\n`;
for(const group of groups){const code=bootstrap(group),filename='panda-media-'+hash(code).slice(0,16)+'.js';fs.writeFileSync(path.join(media,filename),code);blocks.push('media/'+filename);}
html=html.replace('<!--PANDA_MEDIA_BUNDLES-->',blocks.map(f=>`<script src="./${f}"></script>`).join('\n'));
html=html.replace('</head>',blocks.map(f=>`<link rel="preload" as="script" href="./${f}">`).join('\n')+'\n</head>');
let connected=false;const configPath=path.join(root,'deployment-config.json');
if(fs.existsSync(configPath)){
 const c=JSON.parse(fs.readFileSync(configPath,'utf8'));
 const {validatePublicConfig}=await import('./public-config.mjs');validatePublicConfig(c);
 const re=/window\.PANDA_CONFIG\s*=\s*\{[\s\S]*?\};/;
 if(!re.test(html))throw Error('Public configuration marker missing.');
 html=html.replace(re,()=>`window.PANDA_CONFIG = ${JSON.stringify(c)};`);connected=true;
}
fs.writeFileSync(path.join(out,'index.html'),html);
fs.writeFileSync(path.join(out,'_headers'),`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: public, max-age=0, must-revalidate\n/media/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
const files=[...new Set(['index.html','_headers',...blocks,...externalMedia.map(x=>x.name),...(fs.existsSync(articleSource)?fs.readdirSync(articleSource).map(f=>'media/articles/'+f):[])])].map(name=>{const b=fs.readFileSync(path.join(out,name));return {name,bytes:b.length,sha256:hash(b)};});
if(files.some(x=>x.bytes>25*1024*1024))throw Error('A public asset exceeds the Cloudflare Pages limit.');
fs.writeFileSync(path.join(root,'release.json'),JSON.stringify({version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,standalone:{file:'standalone/Train-With-Panda-Portal.html',bytes:Buffer.byteLength(source),sha256:hash(source)},public_configured:connected,deployed:false,backend_live_tested:false,media_payloads:payloads.length,external_media:externalMedia,files},null,2)+'\n');
console.log(`Built ${files.length} public files; ${payloads.length-externalMedia.length} embedded media payloads preserved in bundles; ${externalMedia.length} library images externalized byte-for-byte; largest asset ${(Math.max(...files.map(x=>x.bytes))/1048576).toFixed(2)} MiB.`);
