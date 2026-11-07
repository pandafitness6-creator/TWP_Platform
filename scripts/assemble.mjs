// Rebuild standalone/Train-With-Panda-Portal.html from src/. The standalone is
// generated and gitignored; `npm run build` runs this first (prebuild).
// The template holds the page without its JS, data globals, CSS, fonts and media:
// - each /*@js src/js/<file>*/ line inside the inline <script> is replaced by
//   that file minus its single final newline (data markers then sit in the JS);
// - /*@data src/data/<file>*/null is replaced by that file's exact bytes (the
//   null placeholder keeps the JS files valid before assembly);
// - /*@css src/css/<file>*/ (inside its <style> tag) is replaced by the file
//   minus its single final newline, after resolving its fonts;
// - /*@font src/fonts/<file>*/ (inside the CSS) is replaced by the font's base64;
// - each media payload is re-inserted from src/media as
//   <script type="text/plain" id="…">BASE64</script>, one per line.
// Every src/<kind>/manifest.json fixes the order its markers must appear in:
// execution order matters at runtime (JS, data, CSS cascade) and in the build
// (media bundles). Any mismatch is an error and nothing is written.
// Usage: node scripts/assemble.mjs [--out <file>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outArg=process.argv.indexOf('--out');
const out=path.resolve(outArg>0?process.argv[outArg+1]:path.join(root,'standalone/Train-With-Panda-Portal.html'));
const template=fs.readFileSync(path.join(root,'src/portal.template.html'),'utf8');
if(template.includes('\r'))throw Error('Template contains CR characters; src/ must use LF line endings.');
const read=(dir,file,enc)=>fs.readFileSync(path.join(root,dir,file),enc);
const label=e=>e.global?`${e.file} (${e.global})`:e.file;
// Read <dir>/manifest.json; every listed file must exist and every other file
// (bar manifest.json and README.md) must be listed.
const manifest=dir=>{
 const list=JSON.parse(read(dir,'manifest.json','utf8')),files=new Set(list.map(e=>e.file));
 if(files.size!==list.length)throw Error(`${dir}/manifest.json lists a file twice.`);
 for(const f of fs.readdirSync(path.join(root,dir)))if(f!=='manifest.json'&&f!=='README.md'&&!files.has(f))throw Error(`File not listed in ${dir}/manifest.json: ${dir}/${f}`);
 for(const e of list)if(!fs.existsSync(path.join(root,dir,e.file)))throw Error(`File missing: ${dir}/${label(e)}, listed in ${dir}/manifest.json.`);
 return list;
};
// The markers found must name the manifest's files in exactly manifest order.
const inOrder=(dir,list,found,kind,where='the template')=>{
 found.forEach((m,i)=>{
  if(!list[i])throw Error(`The ${kind} marker for ${m[1]} is not listed in ${dir}/manifest.json.`);
  if(m[1]!==list[i].file)throw Error(`The ${kind} markers are out of order: position ${i+1} in ${dir}/manifest.json is ${label(list[i])}, but ${where} has ${m[1]} there.`);
 });
 if(found.length<list.length)throw Error(`${where[0].toUpperCase()+where.slice(1)} is missing the ${kind} marker for ${dir}/${label(list[found.length])}.`);
};

// JS files: one marker per line, all inside the page's single inline <script>,
// concatenated in manifest order (that order is execution order).
const jsList=manifest('src/js'),jsRe=/^\/\*@js src\/js\/([^*]+)\*\/$/gm,jsFound=[...template.matchAll(jsRe)];
if(template.split('/*@js').length-1!==jsFound.length)throw Error('Every JS marker must be on a line of its own.');
inOrder('src/js',jsList,jsFound,'JS');
const scriptStart=template.indexOf('\n<script>\n'),scriptEnd=template.indexOf('</script>',scriptStart);
if(scriptStart<0||jsFound.some(m=>m.index<scriptStart||m.index>scriptEnd))throw Error('JS markers must all sit inside the inline <script>.');
const js=new Map(jsList.map(({file})=>{
 const text=read('src/js',file,'utf8');
 if(text.includes('\r'))throw Error(`src/js/${file} contains CR characters; src/ must use LF line endings.`);
 if(!text.endsWith('\n')||text.endsWith('\n\n'))throw Error(`src/js/${file} must end with exactly one newline (the assembler removes it).`);
 if(/<\/script/i.test(text))throw Error(`src/js/${file} contains "</script", which would end the inline script early.`);
 return [file,text.slice(0,-1)];
}));
const source=template.replace(jsRe,(_,f)=>js.get(f));

// Data globals (their markers now sit in src/js).
const dataList=manifest('src/data'),dataRe=/\/\*@data src\/data\/([^*]+)\*\/null/g,dataFound=[...source.matchAll(dataRe)];
if(source.split('/*@data').length-1!==dataFound.length)throw Error('Every data marker must be written /*@data src/data/<file>*/null (the null keeps src/js valid JavaScript).');
inOrder('src/data',dataList,dataFound,'data','the assembled JS');
dataFound.forEach((m,i)=>{
 const before='window.'+dataList[i].global+'=';
 if(source.slice(m.index-before.length,m.index)!==before)throw Error(`Data marker for ${m[1]} must directly follow ${before}`);
});
const data=new Map(dataList.map(({file})=>{
 const text=read('src/data',file,'utf8');
 if(/\s$/.test(text))throw Error(`src/data/${file} ends with whitespace or a newline; data files must keep their exact original bytes (check the editor's "insert final newline").`);
 try{JSON.parse(text);}catch(e){throw Error(`src/data/${file} is not valid JSON: ${e.message}`);}
 return [file,text];
}));

// CSS blocks, each directly inside its own <style> tag.
const cssList=manifest('src/css'),cssRe=/\/\*@css src\/css\/([^*]+)\*\//g,cssFound=[...source.matchAll(cssRe)];
inOrder('src/css',cssList,cssFound,'CSS');
cssFound.forEach((m,i)=>{
 const tag=cssList[i].id?`<style id="${cssList[i].id}">`:'<style>',open=source.lastIndexOf('<style',m.index);
 if(source.slice(open,open+tag.length)!==tag||!/^\n*$/.test(source.slice(open+tag.length,m.index)))throw Error(`CSS marker for ${m[1]} must sit directly inside ${tag}.`);
});
const css=new Map(cssList.map(({file})=>{
 const text=read('src/css',file,'utf8');
 if(text.includes('\r'))throw Error(`src/css/${file} contains CR characters; src/ must use LF line endings.`);
 if(!text.endsWith('\n')||text.endsWith('\n\n'))throw Error(`src/css/${file} must end with exactly one newline (the assembler removes it; the template keeps the block's own boundary newlines).`);
 return [file,text.slice(0,-1)];
}));

// Fonts, referenced from the CSS in manifest order, each in its own @font-face.
const fontList=manifest('src/fonts'),fontRe=/\/\*@font src\/fonts\/([^*]+)\*\//g;
const fontFound=cssList.flatMap(({file})=>[...css.get(file).matchAll(fontRe)].map(m=>Object.assign(m,{cssFile:file})));
inOrder('src/fonts',fontList,fontFound,'font','the CSS');
fontFound.forEach((m,i)=>{
 const text=css.get(m.cssFile),face=text.slice(text.lastIndexOf('@font-face',m.index),m.index);
 const family=face.match(/font-family:\s*([A-Za-z]+);/)?.[1];
 if(family!==fontList[i].family)throw Error(`Font marker for ${m[1]} in src/css/${m.cssFile} sits in the @font-face for ${family}, expected ${fontList[i].family}.`);
});
const fonts=new Map(fontList.map(({file})=>[file,read('src/fonts',file).toString('base64')]));

const filled=source
 .replace(dataRe,(_,f)=>data.get(f))
 .replace(cssRe,(_,f)=>css.get(f).replace(fontRe,(_,g)=>fonts.get(g)));

// Media.
const marker='<!--@media src/media/manifest.json-->';
if(filled.split(marker).length!==2)throw Error('The media marker must appear exactly once in the template.');
const mediaDir=path.join(root,'src/media');
const files=JSON.parse(fs.readFileSync(path.join(mediaDir,'manifest.json'),'utf8'));
const listed=new Set(files);
for(const f of fs.readdirSync(mediaDir))if(f!=='manifest.json'&&!listed.has(f))throw Error('Media file missing from manifest: '+f);
const ids=new Set();
const tags=files.map(name=>{
 const id=name.replace(/\.(avif|webp|png|svg|mp4)$/,'');
 if(id===name||!/^panda-[A-Za-z0-9_-]+$/.test(id)||ids.has(id))throw Error('Invalid or duplicate media file: '+name);
 ids.add(id);
 return `<script type="text/plain" id="${id}">${fs.readFileSync(path.join(mediaDir,name)).toString('base64')}</script>`;
});
const html=filled.replace(marker,()=>tags.join('\n'));
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,html);
const sha256=crypto.createHash('sha256').update(html).digest('hex');
const shown=path.relative(root,out);
console.log(`Assembled ${shown.startsWith('..')?out:shown}: ${js.size} JS files, ${data.size} data globals, ${css.size} CSS blocks, ${fonts.size} fonts, ${tags.length} media payloads, ${Buffer.byteLength(html)} bytes, sha256 ${sha256}.`);
