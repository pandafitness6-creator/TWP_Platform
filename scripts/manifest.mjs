// Write MANIFEST.json and MANIFEST.sha256: size and sha256 of every source file
// in the package, i.e. every file Git tracks or would add (tracked files plus
// untracked files that are not ignored), except the two manifests themselves.
// Generated outputs (the standalone, public/, release.json) are gitignored, so
// they are not listed; release.json records the hashes of each build instead.
// Text files are hashed with LF line endings, as Git checks them out.
// Usage: node scripts/manifest.mjs [--check]   (--check: fail if out of date)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let listed;
try{listed=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root}).toString();}
catch{throw Error('git ls-files failed; the manifest is built from the Git working tree.');}
const skip=new Set(['MANIFEST.json','MANIFEST.sha256']);
const paths=[...new Set(listed.split('\0').filter(Boolean))]
 .filter(p=>!skip.has(p)&&fs.existsSync(path.join(root,p)))
 .sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:a.toLowerCase()>b.toLowerCase()?1:a<b?-1:a>b?1:0);
// Hash what a checkout contains: .gitattributes stores text with LF and checks
// it out with LF, so a CRLF working copy (e.g. a file saved on Windows) is
// normalised first. Binary files are hashed as they are.
const attrs=new Map(),raw=execFileSync('git',['check-attr','-z','--stdin','text'],{cwd:root,input:paths.join('\0')}).toString().split('\0');
for(let i=0;i+2<raw.length;i+=3)attrs.set(raw[i],raw[i+2]);
const files=paths.map(p=>{
 let b=fs.readFileSync(path.join(root,p));
 const text=attrs.get(p);
 if((text==='set'||(text==='auto'&&!b.includes(0)))&&b.includes('\r\n'))b=Buffer.from(b.toString('latin1').replaceAll('\r\n','\n'),'latin1');
 return {path:p,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')};
});
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const json=JSON.stringify({version,files},null,2)+'\n';
const sums=files.map(f=>`${f.sha256}  ${f.path}\n`).join('');
const targets=[['MANIFEST.json',json],['MANIFEST.sha256',sums]];
if(process.argv.includes('--check')){
 const stale=targets.filter(([f,text])=>!fs.existsSync(path.join(root,f))||fs.readFileSync(path.join(root,f),'utf8')!==text).map(([f])=>f);
 if(stale.length)throw Error(`Out of date: ${stale.join(', ')}. Run npm run manifest.`);
 console.log(`Manifest up to date: ${files.length} files.`);
}else{
 for(const [f,text] of targets)fs.writeFileSync(path.join(root,f),text);
 console.log(`Wrote MANIFEST.json and MANIFEST.sha256: ${files.length} files, ${files.reduce((a,f)=>a+f.bytes,0)} bytes.`);
}
