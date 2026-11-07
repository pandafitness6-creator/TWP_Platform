// Client access expiry (migrations 021-022): database enforcement in each client's own timezone,
// and the sign-in / warning / coach UI. Called from verify.cjs; each check reports through pass().
// Rule under test: access_expires_on is the LAST day of access; access ends at 00:00 the next day
// in the client's timezone (else the coach's default, else Asia/Colombo).
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const plusDays=(date,n)=>{const [y,m,d]=date.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10);};
// Independent of the app's helpers: today's date in a zone, straight from Node's ICU.
const zoneDay=(tz,offset=0,at=Date.now())=>plusDays(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(at),offset);
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ids={coach:id(1),legacy:id(2),open:id(3),expired:id(4),today:id(5),soon:id(6),paused:id(7),archived:id(8),honolulu:id(9),kiritimati:id(10),york:id(11),nozone:id(12)};
// Dates and zones whose end instant must agree between Postgres and the browser (DST included).
const endMatrix=[['2026-11-03','Asia/Dubai'],['2026-11-03','Asia/Colombo'],['2026-03-07','America/New_York'],['2026-03-08','America/New_York'],['2026-10-31','America/New_York'],['2026-11-01','America/New_York'],['2026-04-04','Australia/Sydney'],['2026-10-03','Australia/Sydney'],['2026-12-31','Pacific/Kiritimati'],['2026-06-15','America/St_Johns'],['2027-01-01','Pacific/Honolulu']];
const dayMatrix=[['2026-11-03T19:59:59Z','Asia/Dubai'],['2026-11-03T20:00:00Z','Asia/Dubai'],['2026-03-08T04:59:59Z','America/New_York'],['2026-03-08T05:00:00Z','America/New_York'],['2026-11-01T18:29:59Z','Asia/Colombo'],['2026-11-01T18:30:00Z','Asia/Colombo']];

// --- Database -------------------------------------------------------------
async function as(db,uid,task){await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}'`);try{return await task();}finally{await db.exec('reset role;reset request.jwt.claim.sub');}}
const one=async(db,sql,args)=>(await db.query(sql,args)).rows[0];
async function plans(db){
 return {
  pkg:(await one(db,"select id from panda_records where kind='packages' order by id limit 1")).id,
  prog:(await one(db,"select id from panda_records where kind='programs' and data->>'status'='published' and coalesce(data->>'plan_type','')<>'cardio' order by id limit 1")).id,
  nut:(await one(db,"select id from panda_records where kind='nutrition_plans' and data->>'status'='published' order by id limit 1")).id,
 };
}
const profile=(uid,p,extra={})=>({id:uid,name:'Client '+uid.slice(-2),email:'',location:'',goal:'Strength',occupation:'',activity_level:'',preferences:'',allergies:'',limitations:'',sex:'Not specified',age:30,height:170,weight:70,goal_weight:70,package_id:p.pkg,program_id:p.prog,nutrition_id:p.nut,status:'onboarding',start_date:'2026-01-01',end_date:'2026-12-31',checkin_day:'Sunday',training_days:3,steps_target:8000,sleep_target:8,cardio_minutes:0,cardio_days:0,favorites:[],read_articles:[],onboarding:{profile:false,guidelines:false,plans:false},...extra});
async function coachAccount(db){await db.query('insert into auth.users(id) values($1)',[ids.coach]);await db.query("insert into panda_accounts(user_id,username,role,active,must_change_password) values($1,'coach','coach',true,false)",[ids.coach]);}
// The real creation path (Edge Function -> panda_register_client), then the first-password step.
async function register(db,key,p,extra){const uid=ids[key];await db.query('insert into auth.users(id) values($1)',[uid]);await db.query('select panda_register_client($1,$2,$3)',[uid,'client.'+key,JSON.stringify(profile(uid,p,extra))]);await db.query('update panda_accounts set must_change_password=false where user_id=$1',[uid]);return uid;}
// The coach's Manage profile save (panda_save), the only way these fields change after creation.
async function coachEdit(db,uid,edit){
 const rec=await one(db,"select data,revision from panda_records where kind='clients' and id=$1",[uid]);const data=rec.data;edit(data);
 return as(db,ids.coach,()=>db.query('select panda_save($1::jsonb,$2)',[JSON.stringify([{kind:'clients',id:uid,data,revision:Number(rec.revision)}]),'Updated client profile']));
}
const setDefaultZone=(db,tz)=>db.query(`update panda_records set data=${tz?"data||jsonb_build_object('default_timezone',$1::text)":"data-'default_timezone'"} where kind='settings' and id='brand'`,tz?[tz]:[]);
const ready=(db,uid)=>as(db,uid,async()=>(await one(db,'select panda_private.ready() ok')).ok);
const status=(db,uid)=>as(db,uid,async()=>(await one(db,'select panda_access_status() s')).s);
const account=(db,uid)=>one(db,"select to_char(access_expires_on,'YYYY-MM-DD') expires,timezone,country_code from panda_accounts where user_id=$1",[uid]);
const dayIn=async(db,tz)=>(await one(db,"select to_char(panda_private.local_today($1),'YYYY-MM-DD') d",[tz])).d;

async function sql({PGlite,bootstrap,migrations},pass){
 // 1. Upgrade an existing install (through 020) with a client: 021 and 022 change nothing for it.
 const db=new PGlite();await db.exec(bootstrap);
 const through20=migrations.findIndex(([f])=>f.startsWith('202609290020'))+1;
 for(const [,text]of migrations.slice(0,through20))await db.exec(text);
 const p=await plans(db);await coachAccount(db);await register(db,'legacy',p);
 const records=async()=>JSON.stringify((await db.query("select kind,id,data,revision from panda_records where owner_id is not null order by kind,id")).rows);
 const before=await records();assert.equal(await ready(db,ids.legacy),true);
 for(const [,text]of migrations.slice(through20))await db.exec(text);
 assert.deepEqual({...await account(db,ids.legacy)},{expires:null,timezone:null,country_code:null});
 assert.equal(await records(),before);assert.equal(await ready(db,ids.legacy),true);assert.equal(await ready(db,ids.coach),true);
 await db.exec(migrations.at(-1)[1]);assert.equal(await ready(db,ids.legacy),true);assert.equal(await records(),before);
 let s=await status(db,ids.legacy);assert.equal(s.state,'ok');assert.equal(s.timezone,'Asia/Colombo');assert.equal(s.timezone_source,'default');
 pass('Migrations 021 and 022 upgrade an existing install: no expiry, no timezone (default Asia/Colombo), records and access unchanged; 022 re-runs safely');

 // 2. No expiry date: behaves exactly as before.
 await register(db,'open',p);
 assert.equal((await account(db,ids.open)).expires,null);assert.equal(await ready(db,ids.open),true);
 s=await status(db,ids.open);assert.equal(s.state,'ok');assert.equal(s.expires_on,null);assert.equal(s.days_left,null);assert.equal(s.ends_at,null);
 assert.equal((await as(db,ids.open,()=>one(db,"select count(*)::int n from panda_records where kind='clients'"))).n,1);
 pass('Client with no expiry date signs in and reads data as before (state ok, no days left)');

 // 3. The last day is fully usable in the client's zone; the day after it is not.
 const dubai=await dayIn(db,'Asia/Dubai');
 await register(db,'today',p,{country:'AE',timezone:'Asia/Dubai',access_expires_on:dubai});
 assert.deepEqual({...await account(db,ids.today)},{expires:dubai,timezone:'Asia/Dubai',country_code:'AE'});
 assert.equal(await ready(db,ids.today),true);
 s=await status(db,ids.today);assert.equal(s.state,'ok');assert.equal(s.days_left,0);assert.equal(s.today,dubai);assert.equal(s.timezone,'Asia/Dubai');assert.equal(s.timezone_source,'client');
 assert.equal(Date.parse(s.ends_at),Date.parse(plusDays(dubai,1)+'T00:00:00+04:00'));
 await register(db,'soon',p,{country:'AE',timezone:'Asia/Dubai',access_expires_on:plusDays(dubai,3)});assert.equal((await status(db,ids.soon)).days_left,3);
 pass('Expiry, country and timezone set at creation are copied to the account; the last day is fully usable (days left 0)');

 // 4. The exact boundary: 00:00 on the next day in the client's zone.
 const at=(instant,date,tz)=>one(db,"select $1::timestamptz < panda_private.access_ends_at($2::date,$3) open, to_char(panda_private.local_today($3,$1::timestamptz),'YYYY-MM-DD') as day",[instant,date,tz]);
 assert.deepEqual({...await at('2026-11-03T19:59:59.999Z','2026-11-03','Asia/Dubai')},{open:true,day:'2026-11-03'});
 assert.deepEqual({...await at('2026-11-03T20:00:00Z','2026-11-03','Asia/Dubai')},{open:false,day:'2026-11-04'});
 assert.deepEqual({...await at('2026-11-03T18:29:59Z','2026-11-03','Asia/Colombo')},{open:true,day:'2026-11-03'});
 assert.deepEqual({...await at('2026-11-03T18:30:00Z','2026-11-03','Asia/Colombo')},{open:false,day:'2026-11-04'});
 pass('Timezone boundary: open until 23:59:59 on the last day and closed from 00:00 the next day, in the client zone (Dubai 20:00 UTC, Colombo 18:30 UTC)');

 // 5. Expired: an existing session (valid JWT) loses every read, save and chat call.
 await register(db,'expired',p,{country:'AE',timezone:'Asia/Dubai'});await coachEdit(db,ids.expired,d=>{d.access_expires_on=plusDays(dubai,-1);});
 assert.equal(await ready(db,ids.expired),false);
 await as(db,ids.expired,async()=>{
  assert.equal((await one(db,'select count(*)::int n from panda_records')).n,0);
  assert.equal((await one(db,'select count(*)::int n from panda_events')).n,0);
  await assert.rejects(()=>db.query('select panda_save($1::jsonb)',[JSON.stringify([{kind:'activity',id:'a1',data:{id:'a1',client_id:ids.expired,date:dubai,steps:1,cardio:0,water:0,sleep:0},revision:0}])]),/Account unavailable/);
  await assert.rejects(()=>db.query('select panda_chat_contacts()'),/Account unavailable/);
  const own=await one(db,'select count(*)::int n, max(username) u from panda_accounts');assert.equal(own.n,1);assert.equal(own.u,'client.expired');
 });
 s=await status(db,ids.expired);assert.equal(s.state,'expired');assert.equal(s.days_left,-1);
 pass('Expired client: RLS blocks records, events, saves and chat for an already-issued session; status reports expired');

 // 6. Same date, different zones, different moments: Honolulu (UTC-10) and Kiritimati (UTC+14)
 //    are always exactly one calendar day apart, so this holds at any time the test runs.
 const hnl=await dayIn(db,'Pacific/Honolulu');
 await register(db,'honolulu',p,{country:'US',timezone:'Pacific/Honolulu',access_expires_on:hnl});
 await register(db,'kiritimati',p,{country:'KI',timezone:'Pacific/Kiritimati',access_expires_on:hnl});
 assert.equal(await ready(db,ids.honolulu),true);assert.equal(await ready(db,ids.kiritimati),false);
 const [sh,sk]=[await status(db,ids.honolulu),await status(db,ids.kiritimati)];assert.equal(sh.state,'ok');assert.equal(sk.state,'expired');
 assert.equal(Date.parse(sh.ends_at)-Date.parse(sk.ends_at),24*3600e3);
 pass('Two clients with the same date in different timezones expire at different moments (24 hours apart)');

 // 7. Daylight saving (America/New_York): the end instant follows the offset of that date.
 const ends=async(date,tz)=>Date.parse((await one(db,"select to_char(panda_private.access_ends_at($1::date,$2) at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') t",[date,tz])).t);
 assert.equal(await ends('2026-03-07','America/New_York'),Date.parse('2026-03-08T05:00:00Z'));
 assert.equal(await ends('2026-03-08','America/New_York'),Date.parse('2026-03-09T04:00:00Z'));
 assert.equal(await ends('2026-10-31','America/New_York'),Date.parse('2026-11-01T04:00:00Z'));
 assert.equal(await ends('2026-11-01','America/New_York'),Date.parse('2026-11-02T05:00:00Z'));
 const ny=await dayIn(db,'America/New_York');
 await register(db,'york',p,{country:'US',timezone:'America/New_York',access_expires_on:ny});assert.equal(await ready(db,ids.york),true);
 await coachEdit(db,ids.york,d=>{d.access_expires_on=plusDays(ny,-1);});assert.equal(await ready(db,ids.york),false);
 pass('Daylight saving: America/New_York ends at 05:00 UTC in winter and 04:00 UTC in summer; local last day open, day after closed');

 // 8. No timezone on the client: the coach's default applies, and follows a change of default.
 await register(db,'nozone',p,{access_expires_on:hnl});assert.equal((await account(db,ids.nozone)).timezone,null);
 await setDefaultZone(db,'Pacific/Kiritimati');assert.equal(await ready(db,ids.nozone),false);
 s=await status(db,ids.nozone);assert.equal(s.timezone,'Pacific/Kiritimati');assert.equal(s.timezone_source,'default');assert.equal(s.state,'expired');
 await setDefaultZone(db,'Pacific/Honolulu');assert.equal(await ready(db,ids.nozone),true);
 await setDefaultZone(db,null);assert.equal((await status(db,ids.nozone)).timezone,'Asia/Colombo');
 assert.equal(await ready(db,ids.honolulu),true);
 pass('No timezone set: the default timezone setting is used (and Asia/Colombo when none is set)');

 // 9. Invalid zones and countries are rejected for profiles, the default setting and accounts.
 for(const bad of ['Mars/Olympus','EST','Asia/Colombo; drop table x','',' '])if(bad.trim())await assert.rejects(()=>coachEdit(db,ids.open,d=>{d.timezone=bad;}),/valid IANA timezone/);
 await assert.rejects(()=>coachEdit(db,ids.open,d=>{d.timezone=5;}),/valid IANA timezone/);
 for(const bad of ['Lanka','lk','L1'])await assert.rejects(()=>coachEdit(db,ids.open,d=>{d.country=bad;}),/valid country/);
 await assert.rejects(()=>setDefaultZone(db,'Not/AZone'),/valid IANA timezone/);
 await assert.rejects(()=>db.query("update panda_accounts set timezone='Mars/Base' where user_id=$1",[ids.open]),/valid IANA timezone/);
 assert.deepEqual({...await account(db,ids.open)},{expires:null,timezone:null,country_code:null});
 pass('Invalid timezones (not IANA) and countries are rejected for client profiles, the default setting and accounts');

 // 10. Renewal re-opens access immediately; removing the date means no expiry.
 await coachEdit(db,ids.expired,d=>{d.access_expires_on=plusDays(dubai,30);});
 assert.equal(await ready(db,ids.expired),true);assert.equal((await status(db,ids.expired)).state,'ok');
 await coachEdit(db,ids.expired,d=>{delete d.access_expires_on;});assert.equal((await account(db,ids.expired)).expires,null);assert.equal(await ready(db,ids.expired),true);
 pass('Renewing or removing the expiry date restores access without a new login');

 // 11. Paused and archived are reported distinctly, and win over an expiry date.
 await register(db,'paused',p,{timezone:'Asia/Dubai'});await coachEdit(db,ids.paused,d=>{d.status='paused';d.access_expires_on=plusDays(dubai,-5);});
 assert.equal(await ready(db,ids.paused),false);assert.equal((await status(db,ids.paused)).state,'paused');
 await register(db,'archived',p);await coachEdit(db,ids.archived,d=>{d.status='archived';d.access_expires_on=plusDays(dubai,10);});
 assert.equal(await ready(db,ids.archived),false);assert.equal((await status(db,ids.archived)).state,'archived');
 pass('Paused and archived clients are blocked and reported as paused / archived (status takes precedence over expiry)');

 // 12. Clients can neither change their own date, country or zone nor see anyone else's.
 const rec=await one(db,"select data,revision from panda_records where kind='clients' and id=$1",[ids.soon]);
 await as(db,ids.soon,async()=>{
  for(const change of [{access_expires_on:plusDays(dubai,400)},{timezone:'Pacific/Honolulu'},{country:'US'}])
   await assert.rejects(()=>db.query('select panda_save($1::jsonb)',[JSON.stringify([{kind:'clients',id:ids.soon,data:{...rec.data,...change},revision:Number(rec.revision)}])]),/Only your coach/);
  await assert.rejects(()=>db.query('update panda_accounts set timezone=null'),/permission denied/);
  const rows=(await db.query('select user_id,access_expires_on,timezone from panda_accounts')).rows;assert.equal(rows.length,1);assert.equal(rows[0].user_id,ids.soon);
  assert.equal((await one(db,"select count(*)::int n from panda_records where kind='clients'")).n,1);
 });
 assert.deepEqual({...await account(db,ids.soon)},{expires:plusDays(dubai,3),timezone:'Asia/Dubai',country_code:'AE'});
 await db.exec('set role anon');await assert.rejects(()=>db.query('select panda_access_status()'));await db.exec('reset role');
 pass('RLS: a client reads only its own account row, cannot change its expiry date, country or timezone; anonymous callers cannot query access status');

 // 13. Invalid dates rejected; support details come from the coach's contact settings.
 for(const bad of ['2026-02-30','tomorrow',20261201])await assert.rejects(()=>coachEdit(db,ids.open,d=>{d.access_expires_on=bad;}),/valid access expiry date/);
 assert.equal((await account(db,ids.open)).expires,null);
 await db.query("update panda_records set data=data||'{\"email\":\"coach@example.test\",\"whatsapp\":\"+971 50 000 0000\"}'::jsonb where kind='settings' and id='brand'");
 s=await status(db,ids.paused);assert.equal(s.support.email,'coach@example.test');assert.equal(s.support.whatsapp,'+971 50 000 0000');
 pass('Invalid expiry dates are rejected; access status includes the coach support contact');

 // Reference values for the browser cross-check in ui().
 const reference={ends:[],days:[]};
 for(const [date,tz]of endMatrix)reference.ends.push([date,tz,await ends(date,tz)]);
 for(const [instant,tz]of dayMatrix)reference.days.push([instant,tz,(await one(db,"select to_char(panda_private.local_today($1,$2::timestamptz),'YYYY-MM-DD') d",[tz,instant])).d]);
 await db.close();
 return reference;
}

// --- Browser ----------------------------------------------------------------
// The page assembled from src/, signed in against a scripted Supabase stand-in.
function portal(html){
 const t={backend:()=>[404]},errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errors.push(e.message);});
 const dom=new JSDOM(html,{url:'https://panda.test/',runScripts:'dangerously',pretendToBeVisual:true,storageQuota:50000000,virtualConsole:vc,beforeParse(w){
  w.localStorage.setItem('panda:connection:v1',JSON.stringify({supabaseUrl:'https://test.supabase.co',publishableKey:'sb_publishable_test',authDomain:'accounts.panda.invalid',mode:'online'}));
  w.localStorage.setItem('panda.presentation.v1',JSON.stringify({language:'en',imagery:'male',confirmed:true}));
  const Observer=w.MutationObserver;w.PANDA_TEST_OBSERVERS=[];w.MutationObserver=class extends Observer{constructor(cb){super(cb);w.PANDA_TEST_OBSERVERS.push(this)}};
  w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};w.URL.createObjectURL=()=>'blob:test';w.URL.revokeObjectURL=()=>{};w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.confirm=()=>true;
  w.WebSocket=class{constructor(){this.readyState=0;}send(){}close(){}};
  w.fetch=async(url,options={})=>{const u=new URL(url),body=options.body?JSON.parse(options.body):undefined;const [status,data]=t.backend(u.pathname+u.search,body,options.method||'GET');return {ok:status<300,status,text:async()=>data===undefined?'':JSON.stringify(data)};};
 }});
 return Object.assign(t,{w:dom.window,errors,close(){for(const o of dom.window.PANDA_TEST_OBSERVERS)o.disconnect();dom.window.close();}});
}
const tick=(ms=30)=>new Promise(r=>setTimeout(r,ms));
async function until(test,label){for(let i=0;i<200;i++){if(test())return;await tick(20);}throw Error('Timed out: '+label);}
// A minimal coaching account: one client (and optionally the coach), the package and contact settings.
function backendFor(w,scenario){
 const uid=ids.open,tz=scenario.timezone||null,profile={...w.PandaCloud.blankProfile(),id:uid,name:'Test Client',goal:'Strength',age:30,height:170,weight:70,goal_weight:70,status:scenario.profileStatus||'active',...(scenario.expires?{access_expires_on:scenario.expires}:{}),...(tz?{timezone:tz,country:scenario.country||'AE'}:{})};delete profile.coach_notes;delete profile.supplements;
 const records=[{kind:'clients',id:uid,owner_id:uid,data:profile,revision:1},{kind:'packages',id:profile.package_id,data:{...w.PandaSeed.create().packages.find(x=>x.id===profile.package_id),features:[]},revision:1},{kind:'settings',id:'brand',data:{coach:'Coach Panda',name:'TRAIN WITH PANDA',contact:'Message me any time.',email:'coach@example.test',whatsapp:'+971500000000'},revision:1}];
 const clientRow={user_id:uid,username:'client.open',role:'client',active:scenario.active!==false,must_change_password:false,access_expires_on:scenario.expires||null,timezone:tz,country_code:tz?scenario.country||'AE':null,created_at:'2026-01-01'};
 const me=scenario.coach?{user_id:ids.coach,username:'coach',role:'coach',active:true,must_change_password:false,access_expires_on:null,timezone:null,country_code:null,created_at:'2026-01-01'}:clientRow;
 return (path,body,method)=>{
  if(path==='/auth/v1/token?grant_type=password')return body.password==='correct-password'?[200,{access_token:'h.'+Buffer.from('{"iat":1}').toString('base64')+'.s',refresh_token:'r',expires_in:3600,user:{id:me.user_id}}]:[400,{error:'invalid_grant',error_description:'Invalid login credentials'}];
  if(path.startsWith('/rest/v1/panda_accounts?user_id='))return [200,[me]];
  if(path==='/rest/v1/rpc/panda_access_status')return scenario.rpc===false?[404,{code:'PGRST202',message:'Could not find the function'}]:[200,scenario.status()];
  if(path.startsWith('/rest/v1/panda_records'))return [200,records];
  if(path.startsWith('/rest/v1/panda_accounts'))return [200,scenario.coach?[me,clientRow]:[]];
  if(path.startsWith('/rest/v1/panda_events')||path.startsWith('/rest/v1/rpc/panda_chat_'))return [200,[]];
  if(path.startsWith('/auth/v1/logout'))return [204];
  return [404,{message:'Not in test backend: '+method+' '+path}];
 };
}
async function signIn(w,password='correct-password'){
 await until(()=>w.document.querySelector('[data-auth-form="login"]'),'login form');
 const f=w.document.querySelector('[data-auth-form="login"]');f.querySelector('[name="username"]').value='client.open';f.querySelector('[name="password"]').value=password;
 f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
}
const support={coach:'Coach Panda',email:'coach@example.test',whatsapp:'+971500000000'};
const state=(name,extra={})=>()=>({state:name,expires_on:null,days_left:null,timezone:'Asia/Colombo',timezone_source:'default',support,...extra});
const input=(w,el,value,type='input')=>{el.value=value;el.dispatchEvent(new w.Event(type,{bubbles:true}));};

async function ui(html,pass,reference){
 // Rules shared by the banner, the coach form, the client list and the coach's next steps.
 {const t=portal(html);await tick(150);const x=t.w.PandaCloud.expiry;
  assert.deepEqual([8,7,4,3,2,1,0,-1,null].map(x.warningLevel),[0,7,7,3,3,1,1,0,0]);
  assert.equal(x.warningText(5,false),'Your access expires in 5 days.');assert.equal(x.warningText(1,false),'Your access expires in 1 day.');assert.equal(x.warningText(0,false),'Your access expires today.');
  const year=zoneDay('Asia/Dubai').slice(0,4);
  assert.equal(x.endText(year+'-11-03','Asia/Dubai','client',false),'Your access ends at the end of 3 November (Dubai time).');
  assert.equal(x.endText((Number(year)+1)+'-01-05','America/Chicago','coach',false),`The client’s access ends at the end of 5 January ${Number(year)+1} (Chicago time).`);
  assert.equal(x.zoneLabel('Asia/Colombo','LK'),'Sri Lanka, Colombo (UTC+5:30)');assert.equal(x.zoneLabel('America/Chicago','US'),'United States, Chicago (UTC-6/-5)');assert.equal(x.zoneLabel('America/Argentina/Buenos_Aires','AR'),'Argentina, Argentina / Buenos Aires (UTC-3)');
  assert.equal(x.addMonths('2026-11-01',1),'2026-12-01');assert.equal(x.addMonths('2026-01-31',1),'2026-02-28');assert.equal(x.addMonths('2026-11-30',3),'2027-02-28');
  for(const tz of ['Asia/Dubai','Pacific/Kiritimati','Pacific/Honolulu'])assert.equal(x.daysUntil(zoneDay(tz,3),tz),3);
  assert.equal(x.daysUntil('2026-11-03','Asia/Dubai',Date.parse('2026-11-03T19:59:59Z')),0);assert.equal(x.daysUntil('2026-11-03','Asia/Dubai',Date.parse('2026-11-03T20:00:00Z')),-1);
  assert.equal(x.validZone('Asia/Colombo'),true);assert.equal(x.validZone('Mars/Olympus'),false);assert.equal(x.validZone('EST'),false);
  // The browser and Postgres agree on the exact end instant and on "today" in each zone.
  for(const [date,tz,ms]of reference.ends)assert.equal(x.endsAt(date,tz),ms,`end of ${date} in ${tz}`);
  for(const [instant,tz,day]of reference.days)assert.equal(x.localDay(tz,Date.parse(instant)),day,`day at ${instant} in ${tz}`);
  assert.equal(Object.keys(t.w.PANDA_TIMEZONES).length>240&&t.w.PANDA_TIMEZONES.US.length>20&&t.w.PANDA_TIMEZONES.LK.join(),'Asia/Colombo');
  assert.deepEqual(t.errors,[]);t.close();}
 pass('Expiry rules in the browser: 7/3/1-day tiers, wording, zone labels, and end instants identical to Postgres in every tested zone (DST included)');

 const blockedCase=async(scenario,expected,label)=>{
  const t=portal(html);await tick(150);t.backend=backendFor(t.w,scenario);
  await signIn(t.w);await until(()=>t.w.document.querySelector('[data-access-blocked]'),label);
  const n=t.w.document.querySelector('[data-access-blocked]');assert.equal(n.querySelector('strong').textContent,expected);
  assert.equal(t.w.PandaCloud.ready,false);assert.equal(t.w.sessionStorage.getItem('panda:session:v1'),null);assert(t.w.document.querySelector('[data-auth-form="login"]'));
  const result={links:[...n.querySelectorAll('a')].map(a=>a.getAttribute('href'))};assert.deepEqual(t.errors,[]);t.close();return result;
 };
 let r=await blockedCase({active:true,expires:zoneDay('Asia/Dubai',-1),timezone:'Asia/Dubai',status:state('expired',{expires_on:zoneDay('Asia/Dubai',-1),days_left:-1,timezone:'Asia/Dubai'})},'Your access has expired. If you have already paid, please contact the support team.','expired notice');
 assert(r.links.includes('mailto:coach@example.test'));assert(r.links.includes('https://wa.me/971500000000'));
 pass('Expired login shows the expired message with the coach support contact and leaves no session behind');
 await blockedCase({active:false,profileStatus:'paused',status:state('paused')},'Your account is temporarily paused. Please contact the support team.','paused notice');
 pass('Paused login shows the paused message');
 await blockedCase({active:false,profileStatus:'archived',status:state('archived')},'Your account has been archived and is no longer active. Please contact the support team to restore access.','archived notice');
 pass('Archived login shows the archived message');
 await blockedCase({active:false,rpc:false},'Your account is not active. Please contact the support team.','legacy notice');
 await blockedCase({active:true,rpc:false,expires:zoneDay('Asia/Colombo',-1)},'Your access has expired. If you have already paid, please contact the support team.','legacy expired');
 pass('Without the status lookup (older database), inactive and expired accounts still get a clear message');

 {const t=portal(html);await tick(150);t.backend=backendFor(t.w,{status:state('ok')});
  await signIn(t.w,'wrong-password');await until(()=>t.w.document.querySelector('[data-auth-form="login"] .form-error')?.textContent,'credentials error');
  assert.equal(t.w.document.querySelector('[data-auth-form="login"] .form-error').textContent,'Invalid login credentials');assert.equal(t.w.document.querySelector('[data-access-blocked]'),null);
  assert.deepEqual(t.errors,[]);t.close();}
 pass('Wrong password still shows the normal credentials error, without an access notice');

 // Banner at 8, 7, 3, 2 and 1 days left and on the last day, in the client's zone (Dubai),
 // with the exact end and the coach's contact details; dismissal returns at the next sign-in.
 {const t=portal(html);await tick(150);const tz='Asia/Dubai',scenario={timezone:tz},$=s=>t.w.document.querySelector(s);
  const login=async days=>{scenario.expires=zoneDay(tz,days);scenario.status=state('ok',{expires_on:scenario.expires,days_left:days,timezone:tz,timezone_source:'client'});t.backend=backendFor(t.w,scenario);if(t.w.PandaCloud.ready)await t.w.PandaCloud.signOut();await signIn(t.w);await until(()=>t.w.PandaCloud.ready&&$('#main .hero'),'dashboard '+days);await tick(40);};
  for(const [days,level,headline]of [[8,null],[7,'7','Your access expires in 7 days.'],[3,'3','Your access expires in 3 days.'],[2,'3','Your access expires in 2 days.'],[1,'1','Your access expires in 1 day.'],[0,'1','Your access expires today.']]){
   await login(days);const b=$('[data-access-warning]');
   if(level===null){assert.equal(b,null,'no banner at 8 days');continue;}
   assert(b,'banner at '+days+' days');assert.equal(b.dataset.accessWarning,level);assert.equal(b.querySelector('strong').textContent,headline);
   const day=Number(scenario.expires.slice(8));assert.match(b.querySelectorAll('p')[1].textContent,new RegExp(`^Your access ends at the end of ${day} [A-Z][a-z]+( \\d{4})? \\(Dubai time\\)\\. If you have already paid, please contact the support team\\.$`));
   for(const href of ['mailto:coach@example.test','https://wa.me/971500000000'])assert(b.querySelector(`a[href="${href}"]`));
   assert($('[data-access-warning] + .hero, [data-access-warning] ~ .hero'),'banner sits before the hero');
  }
  $('[data-auth-action="dismiss-access-warning"]').click();await tick();assert.equal($('[data-access-warning]'),null);
  t.w.PandaPortal.render();await tick();assert.equal($('[data-access-warning]'),null);
  await t.w.PandaCloud.signOut();await signIn(t.w);await until(()=>t.w.PandaCloud.ready&&$('[data-access-warning]'),'banner after next sign-in');
  pass('Banner: none at 8 days; shown at 7, 3, 2, 1 days and on the last day with the exact end (Dubai time) and contacts; dismissed for the session, back at the next sign-in');
  // The zone comes from the server, not this browser: same date, Honolulu vs Kiritimati.
  const hnl=zoneDay('Pacific/Honolulu',1);for(const [zone,text]of [['Pacific/Honolulu','Your access expires in 1 day.'],['Pacific/Kiritimati','Your access expires today.']]){scenario.timezone=zone;scenario.expires=hnl;scenario.status=state('ok',{expires_on:hnl,timezone:zone,timezone_source:'client'});t.backend=backendFor(t.w,scenario);await t.w.PandaCloud.signOut();await signIn(t.w);await until(()=>t.w.PandaCloud.ready&&$('[data-access-warning]'),zone);assert.equal($('[data-access-warning] strong').textContent,text);}
  pass('Banner days come from the timezone sent by the server: the same date is 1 day away in Honolulu and the last day in Kiritimati');
  scenario.status=state('expired',{expires_on:hnl,timezone:'Pacific/Kiritimati'});await t.w.PandaCloud.checkAccess();await until(()=>$('[data-access-blocked="expired"]'),'mid-session expiry');
  assert.equal(t.w.PandaCloud.ready,false);assert.equal(t.w.sessionStorage.getItem('panda:session:v1'),null);
  assert.deepEqual(t.errors,[]);t.close();}
 pass('A client already signed in is signed out with the expired message once the server reports expiry');

 {const t=portal(html);await tick(150);t.backend=backendFor(t.w,{status:state('ok')});
  await signIn(t.w);await until(()=>t.w.PandaCloud.ready&&t.w.document.querySelector('#main .hero'),'dashboard');await tick(60);
  assert.equal(t.w.document.querySelector('[data-access-warning]'),null);assert.equal(t.w.PandaCloud.accessWarning(),null);
  assert.deepEqual(t.errors,[]);t.close();}
 pass('Client with no expiry date signs in to the dashboard with no warning banner');

 // Coach's Access dialog: the same end sentence in the client's zone.
 {const t=portal(html);await tick(150);const tz='America/Chicago',expires=zoneDay(tz,2);t.backend=backendFor(t.w,{coach:true,timezone:tz,country:'US',expires,status:state('ok')});
  await signIn(t.w);await until(()=>t.w.PandaCloud.ready,'coach sign-in');t.w.PandaAccountUI.access(ids.open);await tick();
  const text=t.w.document.querySelector('#modal').textContent;assert.match(text,/2 days left\. The client’s access ends at the end of \d+ [A-Z][a-z]+( \d{4})? \(Chicago time\)\./);assert.match(text,/Timezone: United States, Chicago \(UTC-6\/-5\)/);
  assert.deepEqual(t.errors,[]);t.close();}
 pass('Coach Access dialog shows days left and the exact end in the client’s timezone');

 // Coach form: country first, zones by city, manual override, quick lengths, list colours per zone.
 {const t=portal(html);await tick(150);const w=t.w,$=s=>w.document.querySelector(s),x=w.PandaCloud.expiry;
  w.PandaCloud.demo();await w.PandaServices.commit(s=>{s.preferences.role='coach';},'Opened coach workspace');w.location.hash='/clients';w.PandaPortal.render();await tick(50);
  const [a,b]=w.PandaServices.get().clients.map(c=>c.id),row=cid=>$(`[data-client-row="${cid}"] .board-client-copy`),client=cid=>w.PandaServices.get().clients.find(c=>c.id===cid);
  const edit=async cid=>{$(`[data-action="client-edit"][data-id="${cid}"]`).click();await tick(50);},save=async()=>{$('#modal form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick(200);};
  $('[data-action="client-new"]').click();await tick(50);
  assert.equal($('#modal [name="country_search"]').value,'Sri Lanka');assert.equal($('#modal [name="timezone"]').value,'Asia/Colombo');assert.match($('#modal .access-zone-fixed').textContent,/Sri Lanka, Colombo \(UTC\+5:30\)/);
  w.document.querySelector('#modal').close();
  assert.match(row(a).textContent,/No access expiry/);
  await edit(a);assert.equal($('#modal [name="country_search"]').value,'');assert.match($('#modal .access-zone-fixed').textContent,/Default · Colombo \(UTC\+5:30\)/);
  input(w,$('#modal [name="country_search"]'),'United States');await tick();
  const zoneSelect=$('#modal select[name="timezone"]');assert([...zoneSelect.options].some(o=>o.textContent==='United States, Chicago (UTC-6/-5)'));
  input(w,zoneSelect,'America/Chicago','change');input(w,$('#modal [name="access_expires_on"]'),zoneDay('America/Chicago',2));await tick();
  assert.match($('#modal [data-access-end]').textContent,/^The client’s access ends at the end of \d+ [A-Z][a-z]+( \d{4})? \(Chicago time\)\.$/);
  $('#modal [data-action="access-months"][data-months="3"]').click();await tick();assert.equal($('#modal [name="access_expires_on"]').value,x.addMonths(zoneDay('America/Chicago'),3));
  input(w,$('#modal [name="access_expires_on"]'),zoneDay('America/Chicago',2));await save();
  assert.equal(client(a).country,'US');assert.equal(client(a).timezone,'America/Chicago');assert.equal(client(a).access_expires_on,zoneDay('America/Chicago',2));
  w.PandaPortal.render();await tick(50);assert(row(a).querySelector('.tag.warning'),'amber within 7 days');
  await edit(a);assert.equal($('#modal [name="country_search"]').value,'United States');assert.equal($('#modal select[name="timezone"]').value,'America/Chicago');
  $('#modal [data-action="access-months"][data-months="1"]').click();await tick();assert.equal($('#modal [name="access_expires_on"]').value,x.addMonths(zoneDay('America/Chicago',2),1));
  input(w,$('#modal [name="country_search"]'),'Sri Lanka');await tick();assert.equal($('#modal [name="timezone"]').value,'Asia/Colombo');assert.match($('#modal .access-zone-fixed').textContent,/Sri Lanka, Colombo \(UTC\+5:30\)/);
  const override=$('#modal [data-zone-override]');override.checked=true;override.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();assert($('#modal select[name="timezone"]').options.length>400);
  input(w,$('#modal select[name="timezone"]'),'Asia/Dubai','change');input(w,$('#modal [name="country_search"]'),'Narnia');await tick();await save();
  assert.equal($('#modal .form-error').textContent,'Choose the client’s country from the list.');assert.equal(client(a).timezone,'America/Chicago');
  input(w,$('#modal [name="country_search"]'),'');await tick();$('#modal [data-action="access-clear"]').click();await tick();await save();
  assert.equal('country' in client(a),false);assert.equal('timezone' in client(a),false);assert.equal('access_expires_on' in client(a),false);
  // Same date, two zones: amber where it is the last day, red where it has already ended.
  const hnl=zoneDay('Pacific/Honolulu');await w.PandaServices.commit(s=>{Object.assign(s.clients.find(c=>c.id===a),{timezone:'Pacific/Honolulu',country:'US',access_expires_on:hnl});Object.assign(s.clients.find(c=>c.id===b),{timezone:'Pacific/Kiritimati',country:'KI',access_expires_on:hnl});},'Set access');
  w.PandaPortal.render();await tick(50);assert(row(a).querySelector('.tag.warning'));assert(row(b).querySelector('.tag.danger'));
  const steps=w.PandaAttention.derive(w.PandaServices.get(),w.PandaSeed.day()).items.filter(i=>i.id.startsWith('access:')).map(i=>i.title).join('|');
  assert.match(steps,/Access ended for/);assert.match(steps,/Access ending soon for/);
  assert.deepEqual(t.errors,[]);t.close();}
 pass('Coach form: country first (default Sri Lanka), zones by city for multi-zone countries, manual override, end sentence, quick lengths and renewal; list colours and next steps per client timezone');
}
module.exports={sql,ui};
