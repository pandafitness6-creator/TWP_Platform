// Website signup (migration 026, supabase/functions/panda-signup, SIGNUP-DESIGN.md): the Edge Function's
// handler runs here against a stand-in for Supabase Auth and PostgREST that executes every RPC on a real
// PGlite database with all migrations. Called from verify.cjs; each check reports through pass().
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {JSDOM,VirtualConsole}=require('jsdom');
const {browser:{until,tick}}=require('./access-expiry.cjs');
const {helpers:{as,one,record,save,definition,coachAccount,install,filled}}=require('./client-intake.cjs');
const MIGRATION='202611160026_website_signup.sql';
const COACH='00000000-0000-4000-9000-000000000001';
const FUNCTION_URL='https://test.supabase.co/functions/v1/panda-signup';
const PORTAL='https://panda.test';
const KEY=crypto.randomBytes(32),OLD_KEY=crypto.randomBytes(32),TOKEN_KEY=crypto.randomBytes(32);
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-key',SUPABASE_ANON_KEY:'anon-key',PANDA_ALLOWED_ORIGINS:PORTAL,
 PANDA_SIGNUP_HMAC_KEYS:'k2:'+KEY.toString('base64')+',k1:'+OLD_KEY.toString('base64'),PANDA_SETUP_TOKEN_KEY:TOKEN_KEY.toString('base64'),PANDA_PORTAL_URL:PORTAL};
const sha256=x=>crypto.createHash('sha256').update(x).digest('hex');
const zoneDay=(tz,offset=0)=>{const d=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now()),[y,m,dd]=d.split('-').map(Number);return new Date(Date.UTC(y,m-1,dd+offset)).toISOString().slice(0,10);};

// --- Stand-in for Supabase ------------------------------------------------------------------------
// One queue for every database call: as() and `set role` switch the role on the single connection.
function queue(){let chain=Promise.resolve();return task=>{const p=chain.then(task);chain=p.catch(()=>{});return p;};}
const session=id=>({access_token:'h.'+Buffer.from(JSON.stringify({iat:1,sub:id})).toString('base64')+'.s',refresh_token:'r',expires_in:3600,token_type:'bearer',user:{id}});
function supabase(db,run){
 const users=new Map(),state={down:null,calls:[]};
 const json=(status,data)=>new Response(data===undefined?'':JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
 async function fetch(url,init={}){
  const u=new URL(url),p=u.pathname,method=init.method||'GET',body=init.body?JSON.parse(init.body):undefined,h=init.headers||{};
  state.calls.push(method+' '+p);
  if(state.down?.(method,p))return json(503,{message:'Service unavailable'});
  await state.before?.(method,p);
  const serviceKey=h.apikey==='service-key'&&h.Authorization==='Bearer service-key';
  if(p.startsWith('/rest/v1/rpc/')){
   if(!serviceKey)return json(401,{message:'Invalid API key'});
   const fn=p.slice('/rest/v1/rpc/'.length);assert.match(fn,/^panda_[a-z_]+$/);
   const names=Object.keys(body);
   try{return json(200,await run(async()=>{await db.exec('set role service_role');try{return (await db.query(`select public.${fn}(${names.map((k,i)=>`${k}=>$${i+1}`).join(',')}) r`,names.map(k=>body[k]))).rows[0].r;}finally{await db.exec('reset role');}}));}
   catch(e){return json(400,{code:e.code,message:e.message});}
  }
  if(p==='/auth/v1/admin/users'&&method==='POST'){
   if(!serviceKey)return json(401,{msg:'Invalid API key'});
   if(users.has(body.id)||[...users.values()].some(x=>x.email===body.email))return json(422,{code:'email_exists',msg:'A user with this email address has already been registered'});
   await run(()=>db.query('insert into auth.users(id) values($1)',[body.id]));users.set(body.id,{email:body.email,password:body.password});
   return json(200,{id:body.id,email:body.email});
  }
  const m=/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(p);
  if(m){
   if(!serviceKey)return json(401,{msg:'Invalid API key'});
   const user=users.get(m[1]);if(!user)return json(404,{code:'user_not_found',msg:'User not found'});
   if(method==='GET')return json(200,{id:m[1],email:user.email});
   if(method==='PUT'){user.password=body.password;return json(200,{id:m[1],email:user.email});}
   if(method==='DELETE'){users.delete(m[1]);await run(()=>db.query('delete from auth.users where id=$1',[m[1]]));return json(200,{});}
  }
  if(p==='/auth/v1/token'&&u.searchParams.get('grant_type')==='password'){
   if(h.apikey!=='anon-key')return json(401,{msg:'Invalid API key'});
   const found=[...users].find(([,x])=>x.email===body.email&&x.password===body.password);
   return found?json(200,session(found[0])):json(400,{error:'invalid_grant',error_description:'Invalid login credentials'});
  }
  return json(404,{message:'Not in test backend: '+method+' '+p});
 }
 return {fetch,users,state};
}
async function signupHandler(root,db,run,options={}){
 const {createHandler}=await import(pathToFileURL(path.join(root,'supabase/functions/panda-signup/handler.js')).href);
 const sb=supabase(db,run),logs=[];
 const handle=createHandler({env:{...env,...options.env},fetch:sb.fetch,now:options.now,log:(...a)=>logs.push(a.join(' '))});
 return {handle,sb,logs};
}

// --- Requests --------------------------------------------------------------------------------------
function signed(body,{key=KEY,keyId='k2',ts=Math.floor(Date.now()/1000),nonce=crypto.randomUUID(),raw=JSON.stringify(body),sent=raw,headers={}}={}){
 const sig=crypto.createHmac('sha256',key).update(`v1\n${ts}\n${nonce}\nPOST\n/panda-signup\n${sha256(raw)}`).digest('hex');
 return new Request(FUNCTION_URL,{method:'POST',headers:{'content-type':'application/json','x-panda-key-id':keyId,'x-panda-timestamp':String(ts),'x-panda-nonce':nonce,'x-panda-signature':'v1='+sig,...headers},body:sent});
}
const fromBrowser=(body,{origin=PORTAL,method='POST'}={})=>new Request(FUNCTION_URL,{method,headers:{'content-type':'application/json',apikey:'sb_publishable_test',...(origin?{origin}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});
const order=(n,extra={})=>({action:'create_client',order_ref:'WEB-'+n,email:`Buyer.${n}@Example.com`,name:`Buyer ${n}`,slug:'level-3-4-weeks',paid_at:new Date().toISOString(),amount:99,currency:'AED',...extra});
async function send(handle,req){const res=await handle(req);const text=await res.text();return {status:res.status,body:text?JSON.parse(text):null,headers:res.headers};}
const tokenOf=url=>new URL(url).hash.replace(/^#setup=/,'');

const signup=(db,ref)=>one(db,'select * from panda_signups where order_ref=$1',[ref]);
const accountRow=(db,username)=>one(db,"select user_id,username,role,active,must_change_password,to_char(access_expires_on,'YYYY-MM-DD') expires from panda_accounts where username=$1",[username]);
const counts=async db=>(await one(db,"select (select count(*)::int from panda_accounts where role='client') accounts,(select count(*)::int from auth.users) users,(select count(*)::int from panda_signups) signups"));

async function sql({PGlite,bootstrap,migrations,root},pass){
 const text=migrations.find(([f])=>f===MIGRATION)?.[1];assert(text,'Migration 026 is missing');

 // 1. Preflight: 026 refuses a database without 025's coach patch and changes nothing.
 {
  const db=new PGlite();await db.exec(bootstrap);
  for(const [f,t]of migrations)if(f<'202611150025')await db.exec(t);
  const before=await definition(db,'panda_private.validate_profile(jsonb)');
  await assert.rejects(()=>db.exec(text),/Migration 025 \(coach intake rule\) is not installed; review migration 026/);await db.exec('rollback');
  assert.equal(await definition(db,'panda_private.validate_profile(jsonb)'),before);
  assert.equal((await one(db,"select to_regclass('public.panda_signups') t")).t,null);
  // 023 re-run without 025: 026 stops and names the cause.
  await db.exec(migrations.find(([f])=>f.startsWith('202611150025'))[1]);
  await db.exec(migrations.find(([f])=>f.startsWith('202611130023'))[1]);
  await assert.rejects(()=>db.exec(text),/guard_client_intake\(\) lacks the 025 patch/);await db.exec('rollback');
  await db.close();
  pass('Migration 026 aborts before patching when 025 is missing or was undone by a 023 re-run, and leaves the database unchanged');
 }

 // 2. Fresh install: patches present once, earlier patches kept, re-runs change nothing.
 const db=await install(PGlite,bootstrap,migrations);
 const profileDef=await definition(db,'panda_private.validate_profile(jsonb)'),guardDef=await definition(db,'panda_private.guard_client_intake()'),saveDef=await definition(db,'public.panda_save(jsonb,text)');
 assert.equal(profileDef.split('-- Panda website signup: measurements may be null until the client is active (026).').length,2);
 assert(!profileDef.includes("valid_number(b->'age',16,100)"));assert(profileDef.includes("id in ('catalogue_ids','exercise_edits')"));
 assert.equal(guardDef.split('-- Panda website signup: measurements are required to submit the intake (026).').length,2);
 for(const marker of ['-- Panda client intake: coach may change the status only (025).','perform panda_private.check_coach_intake(previous,new.data);',"perform panda_private.validate_client_intake(new.data,next_status='submitted');"])assert(guardDef.includes(marker),'guard lacks '+marker);
 const products=async()=>JSON.stringify((await db.query('select slug,package_id,program_id,nutrition_id,checkin_day,access_days,active from panda_signup_products order by slug')).rows);
 const seeded=await products();
 await db.exec(text);
 assert.equal(await definition(db,'panda_private.validate_profile(jsonb)'),profileDef);assert.equal(await definition(db,'panda_private.guard_client_intake()'),guardDef);
 assert.equal(await definition(db,'public.panda_save(jsonb,text)'),saveDef);assert.equal(await products(),seeded);
 // database/README.md: after a 023 re-run, re-run 025 and then 026.
 for(const prefix of ['202611130023','202611150025','202611160026'])await db.exec(migrations.find(([f])=>f.startsWith(prefix))[1]);
 assert.equal(await definition(db,'panda_private.guard_client_intake()'),guardDef);
 pass('Migration 026 patches validate_profile and guard_client_intake in place (023 and 025 rules kept), re-runs without changes, and survives a 023 → 025 → 026 re-run');

 assert.deepEqual(JSON.parse(seeded).map(r=>[r.slug,r.package_id,r.access_days]),[['level-1-12-weeks','essential',84],['level-1-4-weeks','essential',28],['level-2-12-weeks','nutrition_only',84],['level-2-4-weeks','nutrition_only',28],['level-3-12-weeks','coaching',84],['level-3-4-weeks','coaching',28]]);
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  try{for(const t of ['panda_signup_products','panda_signups','panda_setup_tokens','panda_signup_nonces'])await assert.rejects(()=>db.query(`select * from ${t}`),/permission denied/);
   await assert.rejects(()=>db.query("select panda_extend_access('00000000-0000-4000-9000-000000000099',10)"),/permission denied/);
   await assert.rejects(()=>db.query("select panda_setup_check('x')"),/permission denied/);}
  finally{await db.exec('reset role');}
 }
 pass('The six website slugs are seeded (essential, nutrition_only, coaching × 28/84 days); signup tables and RPCs are closed to anon and signed-in users');

 // 3. The Edge Function handler.
 const run=queue();
 await coachAccount(db);
 const {handle,sb,logs}=await signupHandler(root,db,run);
 const first=await send(handle,signed(order(1)));
 assert.equal(first.status,201,JSON.stringify(first.body));assert.equal(first.body.code,'created');assert.equal(first.body.retryable,false);
 assert.match(first.body.username,/^buyer\.1-\d{4}$/);assert.equal(first.body.package_id,'coaching');
 assert.match(first.body.setup_url,/^https:\/\/panda\.test\/#setup=[A-Za-z0-9_-]{43}$/);
 const hoursLeft=(Date.parse(first.body.setup_expires_at)-Date.now())/36e5;assert(hoursLeft>47.9&&hoursLeft<=48,'expiry '+hoursLeft);
 const acc=await accountRow(db,first.body.username),uid=acc.user_id;
 assert.deepEqual({...acc,user_id:undefined},{user_id:undefined,username:first.body.username,role:'client',active:true,must_change_password:true,expires:null});
 const prof=(await record(db,'clients',uid)).data;
 assert.equal(prof.status,'onboarding');assert.equal(prof.name,'Buyer 1');assert.equal(prof.email,'buyer.1@example.com');
 for(const k of ['age','height','weight','goal_weight'])assert.equal(prof[k],null,k);
 assert.equal(prof.access_expires_on,undefined);assert.equal(prof.program_id,'plan_strength');assert.equal(prof.nutrition_id,'nutrition_balanced');assert.equal(prof.checkin_day,'Sunday');
 const s1=await signup(db,'WEB-1');assert.equal(s1.state,'created');assert.equal(s1.access_started_at,null);assert.equal(s1.access_days,28);
 assert.equal(s1.access_start_due_at.getTime()-s1.paid_at.getTime(),14*864e5);
 const stored=await one(db,'select token_hash,purpose from panda_setup_tokens where user_id=$1',[uid]);
 assert.equal(stored.token_hash,sha256(tokenOf(first.body.setup_url)));assert(!JSON.stringify(await db.query('select * from panda_setup_tokens')).includes(tokenOf(first.body.setup_url)),'raw token stored');
 assert(sb.users.get(uid).email===first.body.username+'@accounts.panda.invalid');
 assert(!logs.join('\n').includes('buyer'),'personal data logged');
 pass('A valid signed request creates an onboarding client (null measurements, mapped package and plans, no access expiry yet), a 48-hour setup link stored only as a hash, and an Auth user under the internal domain');

 const base=await counts(db);
 const refused=async(req,status,code)=>{const r=await send(handle,req);assert.equal(r.status,status,JSON.stringify(r.body));assert.equal(r.body.code,code);assert.equal(r.body.ok,false);assert.deepEqual(await counts(db),base);return r;};
 const body2=order(2);
 await refused(signed(body2,{sent:JSON.stringify({...body2,slug:'level-1-4-weeks'})}),401,'bad_signature');
 await refused(signed(body2,{key:crypto.randomBytes(32)}),401,'bad_signature');
 await refused(signed(body2,{keyId:'k9'}),401,'unknown_key');
 const unsigned=new Request(FUNCTION_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body2)});
 await refused(unsigned,401,'bad_signature');
 await refused(signed(body2,{headers:{origin:PORTAL}}),403,'origin_not_allowed');
 pass('Bad signatures are refused with 401 bad_signature (changed body, wrong key, unsigned), an unknown key id with unknown_key, and a signed request from a browser origin with 403; nothing is created');

 const stale=await refused(signed(body2,{ts:Math.floor(Date.now()/1000)-301}),401,'stale_timestamp');assert(stale.body.skew_seconds>=301);
 await refused(signed(body2,{ts:Math.floor(Date.now()/1000)+400}),401,'stale_timestamp');
 pass('Requests whose timestamp is more than 5 minutes old or ahead are refused with 401 stale_timestamp, and the skew is reported');

 const nonce=crypto.randomUUID();
 const once=await send(handle,signed(order(3),{nonce}));assert.equal(once.status,201);
 const replay=await send(handle,signed(order(3),{nonce}));assert.equal(replay.status,409);assert.equal(replay.body.code,'nonce_reused');assert.equal(replay.body.retryable,true);
 assert.equal(replay.body.setup_url,undefined);
 pass('Replaying a request with a nonce already seen is refused with 409 nonce_reused and returns no setup link');

 // Rotation: the previous key still verifies.
 const viaOld=await send(handle,signed(order(4),{key:OLD_KEY,keyId:'k1'}));assert.equal(viaOld.status,201);
 const again=await send(handle,signed(order(1)));
 assert.equal(again.status,200);assert.equal(again.body.code,'already_created');assert.equal(again.body.ok,true);
 assert.equal(again.body.setup_url,first.body.setup_url);assert.equal(again.body.username,first.body.username);assert.equal(again.body.setup_completed,false);
 assert.equal((await one(db,"select count(*)::int n from panda_accounts where username like 'buyer.1-%'")).n,1);
 const conflict=await send(handle,signed(order(1,{email:'someone.else@example.com'})));assert.equal(conflict.status,409);assert.equal(conflict.body.code,'order_conflict');assert.equal(conflict.body.retryable,false);
 pass('A duplicate order_ref returns 200 already_created with the same setup link and username (one account); the same order_ref with different details is 409 order_conflict; the previous signing key still works during rotation');

 const sameEmail=await send(handle,signed(order(5,{email:'BUYER.1@example.com'})));assert.equal(sameEmail.status,409);assert.equal(sameEmail.body.code,'email_exists');assert.equal(sameEmail.body.retryable,false);
 const unknown=await send(handle,signed(order(6,{slug:'level-9-1-weeks'})));assert.equal(unknown.status,422);assert.equal(unknown.body.code,'unknown_package');assert.equal(unknown.body.retryable,false);
 assert.equal(await signup(db,'WEB-6'),undefined);
 await db.query("update panda_signup_products set active=false where slug='level-1-4-weeks'");
 const inactive=await send(handle,signed(order(7,{slug:'level-1-4-weeks'})));assert.equal(inactive.status,422);assert.equal(inactive.body.code,'unknown_package');
 await db.query("update panda_signup_products set active=true where slug='level-1-4-weeks'");
 const bad=await send(handle,signed(order(8,{email:'not-an-email'})));assert.equal(bad.status,400);assert.equal(bad.body.code,'invalid_request');assert.equal(bad.body.field,'email');
 const extra=await send(handle,signed({...order(8),coach_notes:'x'}));assert.equal(extra.status,400);assert.equal(extra.body.field,'coach_notes');
 pass('A second order for an existing email is 409 email_exists; an unknown or inactive slug is 422 unknown_package with nothing stored; invalid or unexpected fields are 400 invalid_request naming the field');

 // Configuration problems are retryable; the Auth user is removed and the order resumes once fixed.
 await db.query("update panda_signup_products set program_id='studio_two_day_start' where slug='level-2-4-weeks'");
 const config=await send(handle,signed(order(9,{slug:'level-2-4-weeks'})));
 assert.equal(config.status,503);assert.equal(config.body.code,'portal_configuration');assert.equal(config.body.retryable,true);assert.equal(config.headers.get('retry-after'),'3600');
 assert.match(config.body.reason,/studio_two_day_start/);
 await db.query("update panda_signup_products set program_id='plan_strength' where slug='level-2-4-weeks'");
 // The mapping breaks after the claim and the Auth user: the database refuses the account in one
 // transaction, the Auth user is removed, and the same order resumes once the coach fixes it.
 sb.state.before=async(method,p)=>{if(p==='/rest/v1/rpc/panda_signup_register'){sb.state.before=null;await run(()=>db.query("update panda_signup_products set nutrition_id='studio_nutrition_everyday' where slug='level-2-12-weeks'"));}};
 const late=await send(handle,signed(order(10,{slug:'level-2-12-weeks'})));assert.equal(late.status,503);assert.equal(late.body.code,'portal_configuration');
 const broken=await signup(db,'WEB-10');assert.equal(broken.state,'failed');assert(!sb.users.has(broken.user_id),'Auth user left behind');
 assert.equal((await one(db,'select count(*)::int n from panda_accounts where user_id=$1',[broken.user_id])).n,0);
 await db.query("update panda_signup_products set nutrition_id='nutrition_balanced' where slug='level-2-12-weeks'");
 const fixed=await send(handle,signed(order(10,{slug:'level-2-12-weeks'})));assert.equal(fixed.status,201);assert.equal(fixed.body.package_id,'nutrition_only');assert.equal(fixed.body.username,broken.username);
 pass('A mapping that points at an unpublished plan is 503 portal_configuration (retryable, Retry-After, reason given); when it breaks mid-signup the account is rolled back and the Auth user removed; after the fix the same order succeeds');

 // Auth outage while creating the user: retryable, nothing left behind, and the retry succeeds.
 sb.state.down=(method,p)=>method==='POST'&&p==='/auth/v1/admin/users';
 const down=await send(handle,signed(order(12)));assert.equal(down.status,503);assert.equal(down.body.code,'upstream_unavailable');assert.equal(down.body.retryable,true);
 const s12=await signup(db,'WEB-12');assert.equal(s12.state,'failed');assert(!sb.users.has(s12.user_id));assert.equal((await one(db,'select count(*)::int n from auth.users where id=$1',[s12.user_id])).n,0);
 sb.state.down=null;
 const back=await send(handle,signed(order(12)));assert.equal(back.status,201);assert.equal(back.body.username,(await signup(db,'WEB-12')).username);
 // A crash after the Auth user was created: the claim goes stale, the retry reuses the same user.
 sb.state.down=(method,p)=>p==='/rest/v1/rpc/panda_signup_register';
 const lost=await send(handle,signed(order(13)));assert.equal(lost.status,503);
 const pending=await signup(db,'WEB-13');assert.equal(pending.state,'claimed');assert(sb.users.has(pending.user_id));
 sb.state.down=null;
 const soon=await send(handle,signed(order(13)));assert.equal(soon.status,409);assert.equal(soon.body.code,'in_progress');assert.equal(soon.headers.get('retry-after'),'30');
 await db.query("update panda_signups set updated_at=now()-interval '3 minutes' where order_ref='WEB-13'");
 const resumed=await send(handle,signed(order(13)));assert.equal(resumed.status,201,JSON.stringify(resumed.body));assert.equal((await accountRow(db,resumed.body.username)).user_id,pending.user_id);
 pass('An Auth outage is 503 upstream_unavailable and leaves no login; a lost response leaves the claim in progress (409 in_progress, Retry-After 30), and a later retry finishes with the same Auth user');

 // 4. The setup link.
 const token=tokenOf(first.body.setup_url),tokenRow=()=>one(db,'select consumed_at,finished_at,revoked_at from panda_setup_tokens where token_hash=$1',[sha256(token)]);
 for(const method of ['GET','HEAD','PUT']){const r=await handle(new Request(FUNCTION_URL+'?token='+token,{method,headers:{origin:PORTAL},...(method==='PUT'?{body:JSON.stringify({action:'complete_setup',token,password:'a-good-password-1'})}:{})}));assert.equal(r.status,405);}
 const check=await send(handle,fromBrowser({action:'check_setup',token}));
 assert.equal(check.status,200);assert.equal(check.body.username,first.body.username);assert.equal(check.headers.get('access-control-allow-origin'),PORTAL);
 assert.equal((await tokenRow()).consumed_at,null);assert.equal((await accountRow(db,first.body.username)).must_change_password,true);
 const foreign=await send(handle,fromBrowser({action:'check_setup',token},{origin:'https://evil.example'}));assert.equal(foreign.status,403);assert.equal(foreign.body.code,'origin_not_allowed');
 const weak=await send(handle,fromBrowser({action:'complete_setup',token,password:'short'}));assert.equal(weak.status,400);assert.equal(weak.body.code,'weak_password');
 assert.equal((await tokenRow()).consumed_at,null);
 pass('The setup token is never used by GET, HEAD or PUT (405); check_setup only reads it (returns the username, consumes nothing); other origins are refused; a weak password consumes nothing');

 // Password service outage: the link is given back.
 sb.state.down=(method,p)=>method==='PUT'&&p.startsWith('/auth/v1/admin/users/');
 const outage=await send(handle,fromBrowser({action:'complete_setup',token,password:'my-new-password-1'}));assert.equal(outage.status,503);assert.equal(outage.body.retryable,true);
 assert.equal((await tokenRow()).consumed_at,null);sb.state.down=null;
 const done=await send(handle,fromBrowser({action:'complete_setup',token,password:'my-new-password-1'}));
 assert.equal(done.status,200,JSON.stringify(done.body));assert.equal(done.body.code,'setup_complete');assert.equal(done.body.username,first.body.username);assert(done.body.session?.access_token);
 const opened=await accountRow(db,first.body.username),started=zoneDay('Asia/Colombo');
 assert.equal(opened.must_change_password,false);assert.equal(opened.expires,zoneDay('Asia/Colombo',27));
 const after=(await record(db,'clients',uid)).data;assert.equal(after.start_date,started);assert.equal(after.end_date,zoneDay('Asia/Colombo',27));assert.equal(after.access_expires_on,opened.expires);
 assert.equal(sb.users.get(uid).password,'my-new-password-1');
 const s1done=await signup(db,'WEB-1');assert.equal(s1done.state,'completed');assert(s1done.access_started_at);
 const cutoff=await one(db,"select session_cutoff=date_trunc('second',session_cutoff) whole from panda_accounts where user_id=$1",[uid]);assert.equal(cutoff.whole,true);
 assert.equal(await as(db,uid,async()=>(await one(db,'select panda_private.ready() ok')).ok),true);
 pass('complete_setup sets the password (an outage gives the link back), opens the account, starts the 28-day access period that day in the client’s timezone, and signs the client in');

 const usedAgain=await send(handle,fromBrowser({action:'complete_setup',token,password:'another-password-2'}));assert.equal(usedAgain.status,410);assert.equal(usedAgain.body.code,'token_used');assert.equal(usedAgain.body.retryable,false);
 assert.equal(sb.users.get(uid).password,'my-new-password-1');
 const usedCheck=await send(handle,fromBrowser({action:'check_setup',token}));assert.equal(usedCheck.body.code,'token_used');
 const replayDone=await send(handle,signed(order(1)));assert.equal(replayDone.body.code,'already_created');assert.equal(replayDone.body.setup_completed,true);assert.equal(replayDone.body.setup_url,null);
 assert.equal((await one(db,"select to_char(access_expires_on,'YYYY-MM-DD') e from panda_accounts where user_id=$1",[uid])).e,opened.expires);
 const resendDone=await send(handle,signed({action:'resend_setup',order_ref:'WEB-1'}));assert.equal(resendDone.status,409);assert.equal(resendDone.body.code,'setup_completed');
 pass('A consumed token is refused (410 token_used) and the password stays; replaying the order after setup reports setup_completed without a link, and access is not extended twice');

 // Expiry: 48 hours, checked by the database clock.
 const third=tokenOf(once.body.setup_url);
 await db.query("update panda_setup_tokens set expires_at=now()-interval '1 second' where token_hash=$1",[sha256(third)]);
 const expired=await send(handle,fromBrowser({action:'complete_setup',token:third,password:'my-new-password-3'}));assert.equal(expired.status,410);assert.equal(expired.body.code,'token_expired');
 assert.equal((await one(db,'select must_change_password m from panda_accounts where username=$1',[once.body.username])).m,true);
 const replayExpired=await send(handle,signed(order(3)));assert.equal(replayExpired.body.setup_expired,true);assert.equal(replayExpired.body.setup_url,null);
 const resent=await send(handle,signed({action:'resend_setup',order_ref:'WEB-3'}));assert.equal(resent.status,201);assert.equal(resent.body.code,'resent');assert.notEqual(resent.body.setup_url,once.body.setup_url);
 const newer=await send(handle,signed({action:'resend_setup',order_ref:'WEB-3'}));
 const replaced=await send(handle,fromBrowser({action:'check_setup',token:tokenOf(resent.body.setup_url)}));assert.equal(replaced.status,410);assert.equal(replaced.body.code,'token_invalid');
 const fresh=await send(handle,fromBrowser({action:'complete_setup',token:tokenOf(newer.body.setup_url),password:'my-new-password-3'}));assert.equal(fresh.status,200);
 const missing=await send(handle,signed({action:'resend_setup',order_ref:'WEB-404'}));assert.equal(missing.status,404);assert.equal(missing.body.code,'not_found');
 const garbage=await send(handle,fromBrowser({action:'check_setup',token:'A'.repeat(43)}));assert.equal(garbage.body.code,'token_invalid');
 pass('An expired token is refused (410 token_expired) and the account stays locked; resend_setup issues a new 48-hour link and the older links stop working; unknown tokens are token_invalid');

 // 5. Null measurements: allowed while onboarding, required to activate and to submit the intake.
 const cid=(await accountRow(db,fixed.body.username)).user_id;
 await db.query('update panda_accounts set must_change_password=false where user_id=$1',[cid]);
 const clientRow=async()=>{const r=await record(db,'clients',cid);return {kind:'clients',id:cid,data:r.data,revision:r.revision};};
 const activate=await clientRow();activate.data={...activate.data,status:'active'};
 await assert.rejects(()=>save(db,COACH,[activate]),/Invalid client measurements/);
 await assert.rejects(()=>save(db,cid,[{kind:'client_intake',id:cid,data:filled(cid),revision:0}]),/Add your age, height and weight before submitting/);
 const own=await clientRow();own.data={...own.data,age:34,height:168,weight:71.5};
 await save(db,cid,[own,{kind:'client_intake',id:cid,data:filled(cid),revision:0}],'Updated intake questionnaire');
 assert.deepEqual((await record(db,'client_intake',cid)).data.submitted_profile,{name:'Buyer 10',sex:'Not specified',age:34,height:168,weight:71.5,goal:''});
 const still=await clientRow();still.data={...still.data,status:'active'};
 await assert.rejects(()=>save(db,COACH,[still]),/Invalid client measurements/);
 still.data.goal_weight=65;await save(db,COACH,[still]);
 assert.equal((await record(db,'clients',cid)).data.status,'active');
 const archived=await record(db,'clients',(await accountRow(db,viaOld.body.username)).user_id);
 await save(db,COACH,[{kind:'clients',id:archived.data.id,data:{...archived.data,status:'archived'},revision:archived.revision}]);
 pass('Website-created clients may keep null measurements while onboarding (and can be archived), but the intake cannot be submitted without age, height and weight, and the coach cannot activate them until all four are set');

 // 6. panda_extend_access: repeatable; extends from the current expiry, or from today once it has passed.
 const ext=async(id,days)=>run(async()=>{await db.exec('set role service_role');try{return (await one(db,'select panda_extend_access($1,$2) r',[id,days])).r;}finally{await db.exec('reset role');}});
 const e1=await ext(uid,30);assert.equal(e1.previous_expires_on,opened.expires);assert.equal(e1.access_expires_on,zoneDay('Asia/Colombo',57));
 assert.equal((await one(db,"select to_char(access_expires_on,'YYYY-MM-DD') e from panda_accounts where user_id=$1",[uid])).e,zoneDay('Asia/Colombo',57));
 assert.equal((await record(db,'clients',uid)).data.end_date,zoneDay('Asia/Colombo',57));
 await db.query("update panda_records set data=data||jsonb_build_object('access_expires_on',$2::text) where kind='clients' and id=$1",[uid,zoneDay('Asia/Colombo',-10)]);
 const e2=await ext(uid,7);assert.equal(e2.access_expires_on,zoneDay('Asia/Colombo',6));
 assert.equal((await record(db,'clients',uid)).data.end_date,zoneDay('Asia/Colombo',57),'end_date never moves back');
 await assert.rejects(()=>ext(uid,0),/1 to 3660 days/);await assert.rejects(()=>ext(COACH,10),/Choose an existing client/);
 pass('panda_extend_access(user_id, days) is repeatable: it adds days to an unexpired period, restarts from today after expiry, keeps panda_accounts in step and never moves end_date back');

 await db.close();
}

// --- Browser ---------------------------------------------------------------------------------------
function portal(html,url,install){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errors.push(e.message);});
 const dom=new JSDOM(html,{url,runScripts:'dangerously',pretendToBeVisual:true,storageQuota:50000000,virtualConsole:vc,beforeParse(w){
  w.localStorage.setItem('panda:connection:v1',JSON.stringify({supabaseUrl:'https://test.supabase.co',publishableKey:'sb_publishable_test',authDomain:'accounts.panda.invalid',mode:'online'}));
  w.localStorage.setItem('panda.presentation.v1',JSON.stringify({language:'en',imagery:'male',confirmed:true}));
  const Observer=w.MutationObserver;w.PANDA_TEST_OBSERVERS=[];w.MutationObserver=class extends Observer{constructor(cb){super(cb);w.PANDA_TEST_OBSERVERS.push(this)}};
  w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};w.URL.createObjectURL=()=>'blob:test';w.URL.revokeObjectURL=()=>{};w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};w.confirm=()=>true;
  w.WebSocket=class{constructor(){this.readyState=0;}send(){}close(){}};
  install(w);
 }});
 return {w:dom.window,errors,close(){for(const o of dom.window.PANDA_TEST_OBSERVERS)o.disconnect();dom.window.close();}};
}
// The portal's REST calls run on PGlite as the signed-in user (from the stand-in token); the
// panda-signup function runs the real handler, with the browser's Origin.
function wire(db,run,handle,login){
 return w=>{w.fetch=async(url,options={})=>{
  const u=new URL(url),p=u.pathname,body=options.body?JSON.parse(options.body):undefined,headers=options.headers||{};
  const reply=(status,data)=>({ok:status<300,status,text:async()=>data===undefined?'':JSON.stringify(data)});
  if(p==='/functions/v1/panda-signup'){const res=await handle(new Request(FUNCTION_URL,{method:options.method,headers:{...headers,origin:PORTAL},body:options.body}));return reply(res.status,JSON.parse(await res.text()));}
  if(p==='/auth/v1/token')return login?reply(200,session(login)):reply(400,{error:'invalid_grant',error_description:'Invalid login credentials'});
  if(p==='/auth/v1/logout')return reply(204);
  const auth=String(headers.Authorization||'');let user=null;try{user=JSON.parse(Buffer.from(auth.split('.')[1],'base64').toString()).sub;}catch{}
  if(!user)return reply(401,{message:'JWT required'});
  const asUser=task=>run(()=>as(db,user,task));
  // PostgREST sends dates as YYYY-MM-DD.
  const accounts="select user_id,username,role,active,must_change_password,session_cutoff,created_at,to_char(access_expires_on,'YYYY-MM-DD') access_expires_on,timezone,country_code from panda_accounts";
  if(p==='/rest/v1/panda_accounts'&&u.searchParams.has('user_id'))return reply(200,(await asUser(()=>db.query(accounts+' where user_id=$1',[user]))).rows);
  if(p==='/rest/v1/panda_accounts')return reply(200,(await asUser(()=>db.query(accounts+' order by created_at'))).rows);
  if(p==='/rest/v1/panda_records'){const limit=Number(u.searchParams.get('limit')||500),offset=Number(u.searchParams.get('offset')||0);
   return reply(200,(await asUser(()=>db.query('select kind,id,owner_id,data,revision::int revision from panda_records order by kind,id limit $1 offset $2',[limit,offset]))).rows);}
  if(p==='/rest/v1/panda_events'||p.startsWith('/rest/v1/rpc/panda_chat_'))return reply(200,[]);
  if(p==='/rest/v1/rpc/panda_access_status')return reply(200,(await asUser(()=>one(db,'select panda_access_status() s'))).s);
  if(p==='/rest/v1/rpc/panda_save'){try{return reply(200,(await asUser(()=>one(db,'select panda_save($1::jsonb,$2) r',[JSON.stringify(body.changes),body.label]))).r);}catch(e){return reply(400,{code:e.code,message:e.message});}}
  return reply(404,{message:'Not in test backend: '+p});
 };};
}

async function ui({PGlite,bootstrap,migrations,root},html,pass){
 const db=await install(PGlite,bootstrap,migrations),run=queue();
 await coachAccount(db);
 const {handle}=await signupHandler(root,db,run);
 const made=await send(handle,signed(order(21)));assert.equal(made.status,201);
 const token=tokenOf(made.body.setup_url),uid=(await accountRow(db,made.body.username)).user_id;

 // Coach: the website-created client loads and passes validate(); saving still works.
 {
  const t=portal(html,PORTAL+'/',wire(db,run,handle,COACH));
  try{
   await tick(150);
   await until(()=>t.w.document.querySelector('[data-auth-form="login"]'),'login form');
   const f=t.w.document.querySelector('[data-auth-form="login"]');f.querySelector('[name="username"]').value='coach';f.querySelector('[name="password"]').value='correct-password';
   f.dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true}));
   const S=t.w.PandaServices;await until(()=>S.online&&S.get()?.clients?.some(c=>c.id===uid),'coach state with the website client');
   const c=S.get().clients.find(x=>x.id===uid);assert.equal(c.age,null);assert.equal(c.status,'onboarding');
   assert(S.validate(S.get()));
   await S.commit(s=>{s.brand={...s.brand,coach:'Coach After Signup'};},'Updated brand');
   assert.equal((await record(db,'settings','brand')).data.coach,'Coach After Signup');
   assert.throws(()=>S.validate({...S.get(),clients:S.get().clients.map(x=>x.id===uid?{...x,status:'active'}:x)}),/Add the client’s age, height, current weight and goal weight before setting them to active/);
   assert.deepEqual(t.errors,[]);
  }finally{await tick(300);t.close();}
  pass('A website-created client (null measurements) loads into the coach portal and passes PandaServices.validate, so the coach can keep saving; validate refuses to activate it before the measurements are set');
 }

 // Client: the setup link opens the password form, shows the username, and signs the client in.
 {
  const t=portal(html,PORTAL+'/#setup='+token,wire(db,run,handle,null));
  try{
   assert.equal(t.w.location.hash,'#/');assert.equal(t.w.sessionStorage.getItem('panda:setup:v1'),token);
   const form=()=>t.w.document.querySelector('[data-auth-form="setup-password"]');
   await until(()=>form()&&!form().hidden,'setup form');
   assert.equal(form().querySelector('[name="setup_username"]').value,made.body.username);
   assert.equal((await one(db,'select consumed_at from panda_setup_tokens where token_hash=$1',[sha256(token)])).consumed_at,null);
   form().querySelector('[name="password"]').value='client-password-1';form().querySelector('[name="confirm"]').value='client-password-2';
   form().dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true}));
   await until(()=>/do not match/.test(form()?.querySelector('.form-error')?.textContent||''),'mismatch message');
   form().querySelector('[name="password"]').value='client-password-1';form().querySelector('[name="confirm"]').value='client-password-1';
   form().dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true}));
   const S=t.w.PandaServices;await until(()=>t.w.PandaCloud.ready&&S.get()?.clients?.length===1,'client portal');
   assert.equal(t.w.PandaCloud.account.username,made.body.username);assert.equal(t.w.PandaCloud.setupToken,null);assert.equal(t.w.sessionStorage.getItem('panda:setup:v1'),null);
   assert.equal((await accountRow(db,made.body.username)).must_change_password,false);
   assert.deepEqual(t.errors,[]);
  }finally{await tick(300);t.close();}
  // A used link opened again explains itself.
  const t2=portal(html,PORTAL+'/#setup='+token,wire(db,run,handle,null));
  try{
   await until(()=>/already been used/.test(t2.w.document.querySelector('[data-setup-status]')?.textContent||''),'used-link message');
   assert(t2.w.document.querySelector('[data-auth-form="setup-password"]').hidden);
   t2.w.document.querySelector('[data-auth-action="cancel-setup"]').click();
   await until(()=>t2.w.document.querySelector('[data-auth-form="login"]'),'login form after cancel');
   assert.equal(t2.w.PandaCloud.setupToken,null);
  }finally{await tick(300);t2.close();}
  pass('The setup link opens a "Set your password" form showing the username (the token leaves the address bar and is not used until submit); saving signs the client in; a used link says so and leads back to sign-in');
 }
 await tick(100);await db.close();
}
module.exports={sql,ui};
