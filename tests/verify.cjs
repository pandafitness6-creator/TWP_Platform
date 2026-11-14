const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {PGlite}=require('@electric-sql/pglite');
const {JSDOM,VirtualConsole}=require('jsdom');
const access=require('./access-expiry.cjs');
const intake=require('./client-intake.cjs');
const archive=require('./client-archive.cjs');
const intakeRestore=require('./intake-restore.cjs');
const root=process.argv[2]||path.resolve(__dirname,'..');
const checks=[];function pass(label){checks.push(label);console.log('PASS',label)}
(async()=>{
 const bootstrap=`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('iat',9999999999)$$;grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;`;
 const db=new PGlite();await db.exec(bootstrap);
 const files=fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();assert.equal(files.length,24);
 for(const f of files)await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8'));
 pass('All 24 migrations install into a fresh PostgreSQL test database');
 assert.equal((await db.query('select count(*)::int n from panda_accounts')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,0);pass('No customer or coach accounts seeded');
 const articles=(await db.query("select id,data from panda_records where kind='articles'")).rows;assert(articles.some(x=>/tempo/i.test(x.data.title)));assert(articles.some(x=>/how much weight/i.test(x.data.title)));assert(articles.some(x=>/how hard/i.test(x.data.title)));pass('All three v0.9.16 training articles seeded');
 assert((await db.query("select relrowsecurity from pg_class where relname='panda_records'")).rows[0].relrowsecurity);await db.exec('set role anon');await assert.rejects(()=>db.query('select * from panda_records'));await db.exec('reset role');pass('RLS enabled; anonymous record reads denied');
 const article=articles.find(x=>/tempo/i.test(x.data.title));await db.query("update panda_records set data=jsonb_set(data,'{title}','\"Custom coach title\"'::jsonb),revision=revision+1 where kind='articles' and id=$1",[article.id]);const before=JSON.stringify((await db.query("select id,data,revision from panda_records where kind='articles' order by id")).rows);await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',files[19]),'utf8'));assert.equal(JSON.stringify((await db.query("select id,data,revision from panda_records where kind='articles' order by id")).rows),before);pass('Migration 020 rerun preserves article records and coach edits');await db.close();
 const migrations=files.map(f=>[f,fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8')]);
 const reference=await access.sql({PGlite,bootstrap,migrations},pass);
 await intake.sql({PGlite,bootstrap,migrations},pass);
 await archive.sql({PGlite,bootstrap,migrations},pass);
 // Test what src/ assembles to now, not a missing or stale generated standalone.
 const assembled=path.join(os.tmpdir(),`panda-verify-${process.pid}.html`);
 execFileSync(process.execPath,[path.join(root,'scripts/assemble.mjs'),'--out',assembled],{stdio:'inherit'});
 const html=fs.readFileSync(assembled,'utf8').replace(/(<script\b[^>]*type="text\/plain"[^>]*>)[\s\S]*?(<\/script>)/g,'$1AA==$2');fs.rmSync(assembled);
 const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errors.push(e.message)});
 const dom=new JSDOM(html,{url:'https://panda.test/',runScripts:'dangerously',pretendToBeVisual:true,storageQuota:50000000,virtualConsole:vc,beforeParse(w){const Observer=w.MutationObserver;w.PANDA_TEST_OBSERVERS=[];w.MutationObserver=class extends Observer{constructor(cb){super(cb);w.PANDA_TEST_OBSERVERS.push(this)}};w.structuredClone=structuredClone;w.fetch=()=>Promise.reject(Error('Network disabled for local test'));w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.confirm=()=>true;}});
 await new Promise(r=>setTimeout(r,150));assert.equal(dom.window.PANDA_CONFIG.supabaseUrl,'');assert.equal(dom.window.PANDA_CONFIG.publishableKey,'');assert(dom.window.PandaPortal);assert.deepEqual(errors,[]);pass('Latest source initializes without JS runtime errors and without a backend connection');for(const observer of dom.window.PANDA_TEST_OBSERVERS)observer.disconnect();await new Promise(r=>setImmediate(r));dom.window.close();
 await access.ui(html,pass,reference);
 await intakeRestore.ui({PGlite,bootstrap,migrations},html,pass);
 const report={date:'2026-10-02',checks,limits:['No live deployment performed','Hosted Auth, Edge Function and two-client browser acceptance require customer accounts','Local DOM checks are not visual desktop/mobile testing']};
 fs.mkdirSync(path.join(root,'docs'),{recursive:true});fs.writeFileSync(path.join(root,'docs/VERIFICATION.json'),JSON.stringify(report,null,2)+'\n');
})().catch(e=>{console.error(e.message);process.exitCode=1});
