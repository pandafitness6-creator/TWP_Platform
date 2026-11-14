
window.PANDA_TIMEZONES=/*@data src/data/panda-timezones.json*/null;
/* Panda cloud adapter. Only publishable credentials belong in this file.
   Auth: Supabase password endpoints. Data: RLS + atomic revision-checked RPC.
   No customer records or passwords are written to localStorage. */
(function () {
'use strict';
const configKey='panda:connection:v1', sessionKey='panda:session:v1';
let config={...window.PANDA_CONFIG}, session=null, account=null, accountRows=[], revisions=new Map(), busy=false, refreshPromise=null;
let mode=config.mode==='demo'?'demo':'online', connected=false, status='signed-out';
let access=null, blocked=null, accessTimer=null, endTimer=null, accessCheck=null, dismissed='';
const arrays=['clients','packages','foods','programs','nutrition_plans','checkins','measurements','activity','photos','articles','invoices','recipes','recipe_assignments','supplement_templates','supplement_references','client_intake'];
const settings=['brand','strategy','roadmap','swaps','measurement_defs','exercise_edits'];
const clone=structuredClone, equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b), key=(k,id)=>k+'/'+id;
try {const saved=JSON.parse(localStorage.getItem(configKey)||'null');if(saved&&!config.supabaseUrl)config={...config,...saved};}catch{}
try {const saved=JSON.parse(sessionStorage.getItem(sessionKey)||'null');if(saved?.project===config.supabaseUrl)session=saved.session;}catch{}
function configured(){return !!config.supabaseUrl&&!!config.publishableKey;}
function publicConfig(input){
 const url=new URL(String(input.supabaseUrl).trim());
 if(url.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/.test(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Use your HTTPS Supabase project URL.');
 const token=String(input.publishableKey).trim();
 if(token.startsWith('sb_secret_'))throw Error('Use the publishable key. A secret key must never be entered here.');
 if(!token.startsWith('sb_publishable_')){try{if(JSON.parse(atob(token.split('.')[1])).role!=='anon')throw Error();}catch{throw Error('Use a publishable key or the legacy anon key.');}}
 return {supabaseUrl:url.origin,publishableKey:token,authDomain:'accounts.panda.invalid',mode:'online'};
}
function saveSession(value){session=value;try{if(value)sessionStorage.setItem(sessionKey,JSON.stringify({project:config.supabaseUrl,session:value}));else sessionStorage.removeItem(sessionKey);}catch{/* This tab still works when sessionStorage is unavailable. */}}
function signal(value){status=value;window.dispatchEvent?.(new CustomEvent('panda:cloud-status',{detail:value}));}
async function raw(path,options={},auth=true){
 if(!configured())throw Error('Connect your Supabase project first.');
 const token=auth?session?.access_token:config.publishableKey;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const res=await fetch(config.supabaseUrl+path,{method:options.method||'GET',headers:{apikey:config.publishableKey,...(auth?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',...options.headers},...(options.body===undefined?{}:{body:JSON.stringify(options.body)}),cache:'no-store',signal:controller.signal});
  const text=await res.text();let data;try{data=text?JSON.parse(text):null;}catch{throw Error('The server returned an unreadable response.');}
  if(!res.ok){const err=Error(data?.error_description||data?.msg||data?.message||data?.error||'The request failed.');err.status=res.status;err.code=data?.code;throw err;}
  return data;
 }catch(err){if(err.name==='AbortError')throw Error('The connection timed out. Your form is still here; try again.');if(err instanceof TypeError)throw Error('No connection. Reconnect before saving; your form is still here.');throw err;}finally{clearTimeout(timer);}
}
async function validSession(){
 if(!session)throw Error('Please sign in.');
 if(session.expires_at*1000>Date.now()+45000)return;
 if(!refreshPromise)refreshPromise=(async()=>{try{const s=await raw('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}},false);saveSession({...s,expires_at:s.expires_at||Math.floor(Date.now()/1000)+s.expires_in});}catch(err){if(err.status===400||err.status===401){saveSession(null);connected=false;signal('signed-out');}throw err;}finally{refreshPromise=null;}})();
 await refreshPromise;
}
async function api(path,options){await validSession();return raw(path,options,true);}
async function list(table){const all=[];for(let offset=0;;offset+=500){const rows=await api('/rest/v1/'+table+'?select=*&order='+ (table==='panda_records'?'kind.asc,id.asc':table==='panda_events'?'id.desc':'created_at.asc')+'&limit=500&offset='+offset);all.push(...rows);if(rows.length<500||table==='panda_events')break;if(all.length>20000)throw Error('The portal contains too many records for this view.');}return all;}
function username(value){const v=String(value||'').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(v))throw Error('Enter the username from your coach (3–32 characters).');return v;}
// Access expiry. RLS (panda_private.ready) enforces it; this code only explains it.
// access_expires_on is the client's LAST day of access. Access ends at 00:00 the next day in the
// client's timezone: the account's IANA zone from the server, else the coach's default, else
// Asia/Colombo. Dates are worked out with Intl in that zone, never in the browser's own zone.
const warningKey='panda:access-warning:v1',DEFAULT_TZ='Asia/Colombo';
const accessMessages={expired:'Your access has expired. If you have already paid, please contact the support team.',paused:'Your account is temporarily paused. Please contact the support team.',archived:'Your account has been archived and is no longer active. Please contact the support team to restore access.',inactive:'Your account is not active. Please contact the support team.'};
const arabic=()=>window.PandaExperience?.get().language==='ar';
const ymd=(y,m,d)=>new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10);
const wallFormats=new Map();
function wall(tz,at){let f=wallFormats.get(tz);if(!f){f=new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'});wallFormats.set(tz,f);}const p={};for(const x of f.formatToParts(at))p[x.type]=Number(x.value);return p;}
const offsetMinutes=(tz,at)=>{const p=wall(tz,at);return Math.round((Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(at/1000)*1000)/60000);};
function validZone(tz){if(typeof tz!=='string'||!/^(UTC|[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+)$/.test(tz))return false;try{new Intl.DateTimeFormat('en',{timeZone:tz});return true;}catch{return false;}}
const zoneOf=tz=>validZone(tz)?tz:DEFAULT_TZ;
const defaultZone=brand=>zoneOf(brand?.default_timezone);
function localDay(tz,at=Date.now()){const p=wall(zoneOf(tz),at);return ymd(p.year,p.month,p.day);}
const addDays=(date,n)=>{const [y,m,d]=date.split('-').map(Number);return ymd(y,m,d+n);};
// The instant of 00:00 local on the day after `date`; the offset is re-read at that instant for DST.
function endsAt(date,tz){tz=zoneOf(tz);const [y,m,d]=date.split('-').map(Number),midnight=Date.UTC(y,m-1,d+1);let t=midnight-offsetMinutes(tz,midnight)*60000;t=midnight-offsetMinutes(tz,t)*60000;return t;}
const daysUntil=(date,tz,at=Date.now())=>date?Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(localDay(tz,at)+'T00:00:00Z'))/864e5):null;
function addMonths(date,months){const [y,m,d]=date.split('-').map(Number),last=new Date(Date.UTC(y,m+months,0)).getUTCDate();return new Date(Date.UTC(y,m-1+months,Math.min(d,last))).toISOString().slice(0,10);}
const warningLevel=days=>typeof days!=='number'||days<0?0:days<=1?1:days<=3?3:days<=7?7:0;
// Labels: "Sri Lanka, Colombo (UTC+5:30)", "United States, Chicago (UTC-6/-5)".
const cityName=tz=>tz==='UTC'?'UTC':tz.split('/').slice(1).join(' / ').replace(/_/g,' ');
function offsetLabel(tz,year=new Date().getUTCFullYear()){const f=m=>(m<0?'-':'+')+Math.floor(Math.abs(m)/60)+(Math.abs(m)%60?':'+String(Math.abs(m)%60).padStart(2,'0'):''),a=offsetMinutes(tz,Date.UTC(year,0,15)),b=offsetMinutes(tz,Date.UTC(year,6,15)),lo=Math.min(a,b),hi=Math.max(a,b);return 'UTC'+f(lo)+(lo===hi?'':'/'+f(hi));}
function countryName(code,ar=arabic()){try{return new Intl.DisplayNames([ar?'ar':'en'],{type:'region'}).of(code)||code;}catch{return code;}}
const zoneLabel=(tz,country)=>(country?countryName(country)+', ':'')+cityName(tz)+' ('+offsetLabel(tz)+')';
function countries(){const data=window.PANDA_TIMEZONES||{},ar=arabic();return Object.keys(data).map(code=>({code,name:countryName(code,ar),zones:data[code]})).sort((a,b)=>a.name.localeCompare(b.name,ar?'ar':'en'));}
function zoneName(tz){try{return new Intl.DateTimeFormat('ar',{timeZone:tz,timeZoneName:'longGeneric'}).formatToParts(Date.now()).find(x=>x.type==='timeZoneName')?.value||tz;}catch{return tz;}}
function warningText(days,ar=arabic()){
 if(ar)return days<=0?'تنتهي صلاحية وصولك اليوم.':'تنتهي صلاحية وصولك خلال '+(days===1?'يوم واحد':days===2?'يومين':days+' أيام')+'.';
 return days<=0?'Your access expires today.':'Your access expires in '+days+(days===1?' day.':' days.');
}
// "Your access ends at the end of 3 November (Dubai time)." The year is added when it is not this year.
function endText(date,tz,who='client',ar=arabic()){
 tz=zoneOf(tz);const [y,m,d]=date.split('-').map(Number),day=new Intl.DateTimeFormat(ar?'ar':'en-GB',{timeZone:'UTC',day:'numeric',month:'long',...(String(y)===localDay(tz).slice(0,4)?{}:{year:'numeric'})}).format(Date.UTC(y,m-1,d,12));
 if(ar)return (who==='client'?'ينتهي وصولك':'ينتهي وصول العميل')+' في نهاية '+day+' ('+zoneName(tz)+').';
 return (who==='client'?'Your access ends':'The client’s access ends')+' at the end of '+day+' ('+cityName(tz)+' time).';
}
const paidText=(ar=arabic())=>ar?'إذا كنت قد دفعت بالفعل، يرجى التواصل مع فريق الدعم.':'If you have already paid, please contact the support team.';
async function accessStatus(){
 // Until migration 021 is applied the RPC does not exist; keep the earlier behaviour then.
 try{return await api('/rest/v1/rpc/panda_access_status',{method:'POST',body:{}});}catch(err){if(err.status===404||err.code==='PGRST202')return null;throw err;}
}
function accessState(){
 if(!account)return 'inactive';
 if(access?.state&&access.state!=='ok')return accessMessages[access.state]?access.state:'inactive';
 if(!account.active)return 'inactive';
 // Before migration 022 the status has no zone; fall back to the same rule with the default zone.
 return account.access_expires_on&&Date.now()>=endsAt(account.access_expires_on,access?.timezone||account.timezone)?'expired':'ok';
}
async function block(state){
 blocked={state,message:accessMessages[state],support:access?.support||null};
 // The server already refuses this session; ending it here stops silent retries.
 try{if(session)await raw('/auth/v1/logout?scope=local',{method:'POST'});}catch{}
 clearInterval(accessTimer);accessTimer=null;clearTimeout(endTimer);endTimer=null;saveSession(null);account=null;accountRows=[];access=null;connected=false;revisions.clear();PandaServices.clearCloud();signal('signed-out');
}
async function loadAccount(){
 const rows=await api('/rest/v1/panda_accounts?user_id=eq.'+encodeURIComponent(session.user.id)+'&select=*');account=rows[0]||null;
 access=account?await accessStatus():null;
 const state=accessState();if(state!=='ok'){await block(state);throw Error(blocked.message);}
 return account;
}
// A signed-in client is re-checked every few minutes and when the tab returns, so a
// session that outlives its last day is closed with an explanation instead of failing saves.
function checkAccess(){
 if(!connected||account?.role!=='client')return Promise.resolve();
 if(!accessCheck)accessCheck=(async()=>{try{const next=await accessStatus();if(next&&connected){access=next;const state=accessState();if(state!=='ok')await block(state);else scheduleEnd();}}catch{/* Offline is not proof of expiry; RLS still refuses an expired session. */}finally{accessCheck=null;}})();
 return accessCheck;
}
document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible')checkAccess();});
// The zone always comes from the server (panda_access_status), never from this browser.
const accessZone=()=>access?.timezone||account?.timezone;
const warningId=()=>account&&access?.expires_on?account.user_id+'|'+access.expires_on+'|'+warningLevel(daysUntil(access.expires_on,accessZone())):'';
function accessWarning(){
 if(!connected||account?.role!=='client'||!access?.expires_on)return null;
 const tz=zoneOf(accessZone()),days=daysUntil(access.expires_on,tz),level=warningLevel(days);if(!level)return null;
 let hidden=dismissed===warningId();try{hidden=hidden||sessionStorage.getItem(warningKey)===warningId();}catch{}
 return {days,level,expires_on:access.expires_on,timezone:tz,text:warningText(days),detail:endText(access.expires_on,tz)+' '+paidText(),dismissed:hidden};
}
// Re-check at the exact end of access (00:00 next day in the client's zone) if that is today.
function scheduleEnd(){clearTimeout(endTimer);endTimer=null;if(account?.role!=='client'||!access?.expires_on)return;const ms=endsAt(access.expires_on,accessZone())-Date.now();if(ms>0&&ms<864e5)endTimer=setTimeout(checkAccess,ms+2000);}
// Dismissed for this browser session only. Signing in again shows it again.
function dismissWarning(){dismissed=warningId();try{sessionStorage.setItem(warningKey,dismissed);}catch{}}
function resetWarning(){dismissed='';try{sessionStorage.removeItem(warningKey);}catch{}}
function blankProfile(){return {id:'',name:account?.username||'Coach',email:'',location:'',age:30,sex:'Not specified',height:170,weight:70,goal_weight:70,goal:'',occupation:'',activity_level:'',preferences:'',allergies:'',limitations:'',package_id:'coaching',program_id:'plan_strength',nutrition_id:'nutrition_balanced',status:'onboarding',start_date:PandaSeed.day(),end_date:PandaSeed.day(84),checkin_day:'Sunday',training_days:3,steps_target:8000,sleep_target:8,cardio_minutes:0,cardio_days:0,coach_notes:'',supplements:[],favorites:[],read_articles:[],onboarding:{profile:false,guidelines:false,plans:false}};}
function assemble(records,events=[]){
 // Start with a structural scaffold, not sample customers or personal history.
 const s=PandaSeed.create();for(const name of arrays)s[name]=[];s.drafts={};s.recipe_images={};s.exercise_edits={};s.audit=[];
 s.strategy=s.strategy.map(([title])=>[title,'']);s.roadmap=s.roadmap.map(p=>({...p,text:''}));s.swaps=[];
 revisions=new Map();const notes=[],histories=[];
 for(const rec of records){revisions.set(key(rec.kind,rec.id),rec.revision);if(arrays.includes(rec.kind))s[rec.kind].push(clone(rec.data));else if(rec.kind==='settings'&&settings.includes(rec.id))s[rec.id]=clone(rec.data);else if(rec.kind==='recipe_images')s.recipe_images[rec.id]=rec.data.image;else if(rec.kind==='drafts')s.drafts[rec.id]=clone(rec.data);else if(['client_private','checkin_private','supplements'].includes(rec.kind))notes.push(rec);else if(rec.kind==='plan_history')histories.push(rec);}
 for(const c of s.clients){c.coach_notes='';c.supplements=[];}
 for(const c of s.checkins)c.coach_private='';
 for(const x of notes){const row=s[x.kind==='checkin_private'?'checkins':'clients'].find(c=>c.id===x.id);if(row){if(x.kind==='supplements')row.supplements=x.data.items;else row[x.kind==='checkin_private'?'coach_private':'coach_notes']=x.data[x.kind==='checkin_private'?'coach_private':'coach_notes']||'';}}
 for(const h of histories){const row=s[h.data.type]?.find(p=>p.id===h.data.plan_id);if(row)row.versions=h.data.versions;}
 // Restricted or unpublished plans are represented by content-free placeholders.
 for(const c of s.clients){for(const [type,field] of [['programs','program_id'],['nutrition_plans','nutrition_id'],['programs','cardio_id']])if(c[field]&&!s[type].some(p=>p.id===c[field]))s[type].push({id:c[field],name:'Plan being prepared',status:'draft',version:0,versions:[],notes:'',weeks:1,sessions:[],variants:[],targets:{calories:0,protein:0,carbs:0,fat:0,fiber:0,water:0},_restricted:true});}
 const previous=window.PandaServices?.online?PandaServices.get().preferences:null;
 const selected=account.role==='client'?account.user_id:(s.clients.some(c=>c.id===previous?.client_id)?previous.client_id:s.clients[0]?.id||'');
 s.preferences={role:account.role==='coach'?(previous?.role||'coach'):'client',client_id:selected,reduced_motion:previous?.reduced_motion??(localStorage.getItem('panda:reduced-motion')==='true')};
 s.audit=events.map(x=>({id:String(x.id),label:x.label,at:x.at,role:x.actor_id===account.user_id?account.role:'coach'})).slice(0,150);
 return s;
}
function flatten(s){
 const out=new Map(),put=(kind,id,data)=>out.set(key(kind,id),{kind,id,data:clone(data)});
 for(const type of arrays)for(const row of s[type]||[]){
  if(row._restricted)continue;const data=clone(row);
  if(type==='clients'){
   if(account.role==='coach')put('client_private',row.id,{id:row.id,coach_notes:data.coach_notes||''});delete data.coach_notes;
   if(account.role==='coach'||revisions.has(key('supplements',row.id)))put('supplements',row.id,{id:row.id,items:data.supplements});delete data.supplements;
  }
  if(type==='checkins'){if(account.role==='coach')put('checkin_private',row.id,{id:row.id,client_id:row.client_id,coach_private:data.coach_private||''});delete data.coach_private;}
  if(['programs','nutrition_plans'].includes(type)){if(account.role==='coach')put('plan_history',type+':'+row.id,{id:type+':'+row.id,type,plan_id:row.id,versions:data.versions||[]});data.versions=[];}
  put(type,row.id,data);
 }
 for(const name of settings)if(account.role==='coach'||revisions.has(key('settings',name)))put('settings',name,s[name]);
 for(const [id,data]of Object.entries(s.drafts))put('drafts',id,data);for(const [id,image]of Object.entries(s.recipe_images))put('recipe_images',id,{id,image});
 return out;
}
async function snapshot(){
 await loadAccount();if(account.must_change_password){connected=false;PandaServices.clearCloud();signal('password-required');return null;}
 const [records,events,accounts]=await Promise.all([list('panda_records'),list('panda_events'),list('panda_accounts')]);accountRows=accounts;
 const state=assemble(records,events);PandaServices.bindCloud(state,{commit,restore});connected=true;if(account.role==='client'&&!accessTimer)accessTimer=setInterval(checkAccess,300000);scheduleEnd();signal('ready');return state;
}
async function commit(before,after,label){
 if(busy)throw Error('A save is already in progress. Please wait.');
 if(!connected)throw Error('Sign in again before saving.');
 if(account.role==='client'&&(after.preferences.role!=='client'||after.preferences.client_id!==account.user_id))throw Error('This account can only open its own client portal.');
 const a=flatten(before),b=flatten(after),changes=[];
 for(const [id,rec]of b)if(!a.has(id)||!equal(a.get(id).data,rec.data))changes.push({...rec,revision:revisions.get(id)||0});
 for(const [id,rec]of a)if(!b.has(id))changes.push({...rec,data:null,revision:revisions.get(id)||0});
 if(before.preferences.reduced_motion!==after.preferences.reduced_motion)try{localStorage.setItem('panda:reduced-motion',String(after.preferences.reduced_motion));}catch{}
 if(!changes.length)return;
 // client_intake after clients: at submission the intake trigger copies the profile into submitted_profile,
 // so a batch that edits both must save the profile first.
 const order=['foods','packages','programs','nutrition_plans','articles','settings','plan_history','clients','client_intake'];changes.sort((x,y)=>(order.includes(x.kind)?order.indexOf(x.kind):99)-(order.includes(y.kind)?order.indexOf(y.kind):99));
 busy=true;signal('saving');
 try{
  const result=await api('/rest/v1/rpc/panda_save',{method:'POST',body:{changes,label:label.slice(0,160)}});
  for(const r of result)if(r.revision)revisions.set(key(r.kind,r.id),r.revision);else revisions.delete(key(r.kind,r.id));
  signal('saved');
 }catch(err){signal('error');if(err.code==='42501')checkAccess();if(err.code==='40001')throw Error('Someone updated this record. Keep this form open, copy any unsaved text, then refresh the portal and retry.');throw err;}finally{busy=false;}
}
async function restore(before,after){if(account.role!=='coach')throw Error('Ask your coach to restore a backup.');if(!equal(before.clients.map(x=>x.id).sort(),after.clients.map(x=>x.id).sort()))throw Error('This backup must contain the same customer accounts. Restore data only; accounts are managed separately.');
 // Intakes are never restored: they belong to the clients. The database refuses to delete them and
 // (migration 025) refuses any coach change but a reopen, so restoring them would fail the whole restore.
 after=clone(after);after.client_intake=clone(before.client_intake||[]);
 await commit(before,after,'Restored portal data');return after;}
async function accountCommand(action,body){return api('/functions/v1/panda-accounts',{method:'POST',body:{action,...body}});}
async function signIn(login,password){
 if(!configured())throw Error('The portal has not been connected yet.');publicConfig(config);blocked=null;resetWarning();
 const s=await raw('/auth/v1/token?grant_type=password',{method:'POST',body:{email:username(login)+'@'+config.authDomain,password}},false);
 saveSession({...s,expires_at:s.expires_at||Math.floor(Date.now()/1000)+s.expires_in});mode='online';await snapshot();
}
async function signOut(){if(busy)throw Error('Wait for the current save to finish.');try{if(session)await api('/auth/v1/logout?scope=local',{method:'POST'});}finally{clearInterval(accessTimer);accessTimer=null;clearTimeout(endTimer);endTimer=null;resetWarning();saveSession(null);account=null;accountRows=[];access=null;connected=false;revisions.clear();PandaServices.clearCloud();signal('signed-out');}}
async function changePassword(current,password){
 if(password.length<12||password.length>128)throw Error('Use 12–128 characters for your password.');if(password===current)throw Error('Choose a different password.');
 const r=await accountCommand('change_password',{current_password:current,password});saveSession({...r.session,expires_at:r.session.expires_at||Math.floor(Date.now()/1000)+r.session.expires_in});await snapshot();
}
async function createClient(profile,login,password){const check=PandaServices.get();check.clients.push(clone(profile));if(!check.preferences.client_id)check.preferences.client_id=profile.id;PandaServices.validate(check);const result=await accountCommand('create_client',{profile,username:username(login),password});try{await snapshot();}catch(err){result.refresh_error=err.message;}return result;}
async function resetPassword(user_id,password){return accountCommand('reset_password',{user_id,password});}
async function start(){if(mode==='demo')return;if(!configured()){signal('setup');return;}if(session){try{await snapshot();}catch(err){connected=false;signal('signed-out');throw err;}}}
function configure(values){config={...config,...publicConfig(values)};blocked=null;localStorage.setItem(configKey,JSON.stringify(config));saveSession(null);mode='online';signal('signed-out');}
function demo(){mode='demo';blocked=null;connected=false;PandaServices.clearCloud();signal('demo');}
function generatePassword(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#';const bytes=crypto.getRandomValues(new Uint32Array(20));return [...bytes].map(x=>chars[x%chars.length]).join('');}
// The caller cannot choose an API route or impersonate the authenticated sender.
const chatCommands=new Set(['contacts','open','inbox','history','send','mark_read']);
async function chatRPC(command,args={}){if(!connected||!chatCommands.has(command))throw Error('Sign in before opening messages.');return api('/rest/v1/rpc/panda_chat_'+command,{method:'POST',body:args});}
function watchChat(onChange,onStatus){
 let stopped=false,socket=null,retry=null,heartbeat=null,joinTimer=null,ref=0,join='',topic='',pendingHeartbeat=null,attempt=0;
 const report=value=>{if(!stopped)onStatus?.(value);};
 function cleanup(){clearTimeout(joinTimer);clearInterval(heartbeat);pendingHeartbeat=null;if(socket){const old=socket;socket=null;old.onopen=old.onmessage=old.onclose=old.onerror=null;old.close();}}
 function send(event,payload={},channel=topic){if(socket?.readyState===1){const id=String(++ref);socket.send(JSON.stringify({topic:channel,event,payload,ref:id,join_ref:channel===topic?join:null}));return id;}}
 function reconnect(){cleanup();if(stopped)return;report('reconnecting');clearTimeout(retry);retry=setTimeout(connect,Math.min(30000,1000*2**Math.min(attempt++,5)));}
 async function connect(){
  if(stopped)return;
  try{await validSession();if(stopped||!connected)return;const actor=session.user.id;topic='realtime:panda-private-chat-'+actor;
   const ws=new WebSocket(config.supabaseUrl.replace(/^https:/,'wss:')+'/realtime/v1/websocket?apikey='+encodeURIComponent(config.publishableKey)+'&vsn=1.0.0');socket=ws;report('connecting');
   ws.onopen=()=>{if(stopped||socket!==ws)return;join=String(++ref);ws.send(JSON.stringify({topic,event:'phx_join',payload:{config:{broadcast:{ack:false,self:false},presence:{enabled:false},postgres_changes:[{event:'INSERT',schema:'public',table:'panda_chat_messages'}],private:false},access_token:session.access_token},ref:join,join_ref:join}));joinTimer=setTimeout(reconnect,12000);};
   ws.onmessage=event=>{if(stopped||socket!==ws)return;let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message.event==='phx_reply'&&message.ref===pendingHeartbeat)pendingHeartbeat=null;
    if(message.event==='phx_reply'&&message.ref===join){clearTimeout(joinTimer);if(message.payload?.status!=='ok'){reconnect();return;}attempt=0;report('live');onChange?.();clearInterval(heartbeat);heartbeat=setInterval(async()=>{if(stopped||socket!==ws)return;if(pendingHeartbeat){reconnect();return;}try{await validSession();if(stopped||socket!==ws)return;send('access_token',{access_token:session.access_token});pendingHeartbeat=send('heartbeat',{},'phoenix');}catch{reconnect();}},25000);}
    if(message.topic===topic&&message.event==='postgres_changes')onChange?.();
    if(message.event==='phx_error'||message.event==='phx_close'||(message.event==='system'&&message.payload?.status==='error'))reconnect();
   };ws.onerror=reconnect;ws.onclose=reconnect;
  }catch{reconnect();}
 }
 connect();return ()=>{stopped=true;clearTimeout(retry);cleanup();};
}

window.PandaCloud={chatRPC,watchChat,configured,configure,publicConfig,start,signIn,signOut,changePassword,createClient,resetPassword,refresh:snapshot,demo,blankProfile,generatePassword,checkAccess,accessWarning,dismissWarning,
 expiry:{DEFAULT_TZ,defaultZone,validZone,localDay,addDays,endsAt,daysUntil,addMonths,warningLevel,warningText,endText,paidText,offsetLabel,cityName,countryName,zoneLabel,countries,messages:accessMessages},get access(){return access?clone(access):null},get blocked(){return blocked?clone(blocked):null},
 get mode(){return mode},get ready(){return connected},get account(){return account?clone(account):null},get accounts(){return clone(accountRows)},get status(){return status},get busy(){return busy},get settings(){return {supabaseUrl:config.supabaseUrl,publishableKey:config.publishableKey,authDomain:config.authDomain}}};
})();
