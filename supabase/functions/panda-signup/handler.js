// Train With Panda · Website signup and password setup (SIGNUP-DESIGN.md).
// Plain JavaScript so the same module runs in the Edge Function (Deno) and in the Node test suite.
//
// Two kinds of caller:
//  - The website's server (no Origin header), with an HMAC-signed request: create_client, resend_setup.
//  - The portal page in a browser (Origin in PANDA_ALLOWED_ORIGINS), with a setup token:
//    check_setup (read-only) and complete_setup (sets the password). Tokens are only ever used by POST.
// Every response: {ok, code, retryable, message, request_id, ...}. No request bodies, passwords,
// tokens, names or email addresses are logged.

const enc=new TextEncoder();
const SIGNED=new Set(['create_client','resend_setup']);
const TOKEN=new Set(['check_setup','complete_setup']);
const MAX_BODY=20000;
const WINDOW_SECONDS=300;

const MESSAGES={
 created:'Client account created.',
 already_created:'This order already has a client account.',
 resent:'A new setup link was issued. Earlier links for this order no longer work.',
 ok:'The setup link is valid.',
 setup_complete:'Password saved.',
 invalid_request:'The request is not valid.',
 bad_signature:'The request signature is not valid.',
 stale_timestamp:'The request timestamp is outside the allowed window.',
 unknown_key:'The signing key is not recognised.',
 nonce_reused:'This request nonce has already been used.',
 in_progress:'This order is already being processed. Retry shortly.',
 order_conflict:'This order reference was already used with different details.',
 email_exists:'A client account already exists for this email address.',
 unknown_package:'This package is not mapped to a portal package.',
 portal_configuration:'The portal package mapping needs attention before this order can be completed.',
 rate_limited:'Too many new accounts were requested in the last hour.',
 not_found:'No signup exists for this order.',
 setup_completed:'The client has already set a password.',
 too_large:'The request is too large.',
 method_not_allowed:'POST required.',
 origin_not_allowed:'This portal address is not enabled.',
 weak_password:'Use a password with 12–128 characters.',
 token_invalid:'This link is no longer valid. Use the newest link you received, or contact support.',
 token_expired:'This link has expired. Contact support for a new one.',
 token_used:'This link has already been used. Sign in with your username and password.',
 account_inactive:'This account is not active. Please contact the support team.',
 setup_incomplete:'Your password could not be saved. Please try again.',
 upstream_unavailable:'The account service is temporarily unavailable. Retry later.',
 not_configured:'The signup service is not configured.',
 internal:'The request could not be completed.'
};
// HTTP status and retry advice per code. Retryable codes use 409, 429 or 5xx.
const STATUS={created:201,already_created:200,resent:201,ok:200,setup_complete:200,
 invalid_request:400,weak_password:400,bad_signature:401,stale_timestamp:401,unknown_key:401,
 origin_not_allowed:403,account_inactive:403,not_found:404,method_not_allowed:405,
 nonce_reused:409,in_progress:409,order_conflict:409,email_exists:409,setup_completed:409,
 token_invalid:410,token_expired:410,token_used:410,too_large:413,unknown_package:422,rate_limited:429,
 internal:500,portal_configuration:503,upstream_unavailable:503,setup_incomplete:503,not_configured:503};
const RETRYABLE=new Set(['nonce_reused','in_progress','rate_limited','internal','portal_configuration','upstream_unavailable','setup_incomplete','not_configured']);
const RETRY_AFTER={in_progress:30,rate_limited:600,portal_configuration:3600,upstream_unavailable:60,setup_incomplete:5};

class Fail extends Error{constructor(code,extra={}){super(MESSAGES[code]||code);this.code=code;this.extra=extra;}}

const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const b64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function fromBase64(text){const s=atob(text.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,c=>c.charCodeAt(0));}
const sha256=async data=>hex(await crypto.subtle.digest('SHA-256',typeof data==='string'?enc.encode(data):data));
async function hmacKey(raw,usage){return crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,[usage]);}
function hexBytes(h){const out=new Uint8Array(h.length/2);for(let i=0;i<out.length;i++)out[i]=parseInt(h.slice(i*2,i*2+2),16);return out;}

// "k1:<base64>,k0:<base64>": current and previous keys, so they can be rotated without downtime.
function parseKeys(value){
 const keys=new Map();
 for(const part of String(value||'').split(',').map(x=>x.trim()).filter(Boolean)){
  const at=part.indexOf(':');if(at<1)throw Error('PANDA_SIGNUP_HMAC_KEYS entries must be id:base64key');
  const id=part.slice(0,at),raw=fromBase64(part.slice(at+1));
  if(!/^[A-Za-z0-9_-]{1,32}$/.test(id)||raw.length<32)throw Error('Each signing key needs an id and at least 32 bytes');
  keys.set(id,raw);
 }
 return keys;
}

export function createHandler({env,fetch:fetchImpl=globalThis.fetch,now=()=>Date.now(),log=(...a)=>console.error(...a)}){
 const base=String(env.SUPABASE_URL||'').replace(/\/$/,''),service=env.SUPABASE_SERVICE_ROLE_KEY,anon=env.SUPABASE_ANON_KEY;
 const domain=env.PANDA_AUTH_DOMAIN||'accounts.panda.invalid';
 const origins=String(env.PANDA_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
 const maxPerHour=Number(env.PANDA_SIGNUP_MAX_PER_HOUR||60);
 let config=null,configError=null;
 try{
  const portal=new URL(String(env.PANDA_PORTAL_URL||''));
  if(portal.protocol!=='https:'||portal.search||portal.hash)throw Error('PANDA_PORTAL_URL must be an https address without query or fragment');
  const tokenKey=fromBase64(String(env.PANDA_SETUP_TOKEN_KEY||''));
  if(tokenKey.length<32)throw Error('PANDA_SETUP_TOKEN_KEY needs at least 32 bytes');
  if(!base||!service||!anon)throw Error('Supabase URL and keys are missing');
  config={keys:parseKeys(env.PANDA_SIGNUP_HMAC_KEYS),tokenKey,portal:portal.origin+portal.pathname.replace(/\/$/,'')};
  if(!config.keys.size)throw Error('PANDA_SIGNUP_HMAC_KEYS is empty');
 }catch(err){configError=err.message;}

 // --- Supabase calls ------------------------------------------------------------------------
 async function call(path,{method='GET',body,token=service,apikey=service}={}){
  let res;
  try{res=await fetchImpl(base+path,{method,headers:{apikey,Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});}
  catch{throw new Fail('upstream_unavailable');}
  const text=await res.text();let data=null;try{data=text?JSON.parse(text):null;}catch{}
  return {status:res.status,ok:res.ok,data};
 }
 const upstream=r=>new Fail(r.status>=500||r.status===429?'upstream_unavailable':'internal');
 async function rpc(fn,args){const r=await call('/rest/v1/rpc/'+fn,{method:'POST',body:args});if(!r.ok)throw upstream(r);return r.data;}

 // --- Tokens --------------------------------------------------------------------------------
 // The token is derived from its row id with a key only this function holds: a database copy
 // alone reveals no working link, and a retried order gets the same link back.
 async function token(id){return b64url(await crypto.subtle.sign('HMAC',await hmacKey(config.tokenKey,'sign'),enc.encode('panda-setup:v1:'+id)));}
 const link=t=>config.portal+'/#setup='+t;
 async function issue(){const id=crypto.randomUUID(),t=await token(id);return {id,token:t,hash:await sha256(t)};}

 // --- Website requests -----------------------------------------------------------------------
 async function verify(req,raw){
  const h=k=>req.headers.get(k)||'';
  const keyId=h('x-panda-key-id'),ts=h('x-panda-timestamp'),nonce=h('x-panda-nonce'),sig=h('x-panda-signature');
  const key=config.keys.get(keyId);if(!key)throw new Fail('unknown_key');
  if(!/^\d{9,11}$/.test(ts))throw new Fail('stale_timestamp');
  const skew=Math.round(now()/1000-Number(ts));if(Math.abs(skew)>WINDOW_SECONDS)throw new Fail('stale_timestamp',{skew_seconds:skew});
  if(!/^v1=[0-9a-f]{64}$/.test(sig)||!/^[A-Za-z0-9_-]{16,128}$/.test(nonce))throw new Fail('bad_signature');
  const canonical='v1\n'+ts+'\n'+nonce+'\nPOST\n/panda-signup\n'+await sha256(raw);
  // crypto.subtle.verify compares in constant time.
  if(!await crypto.subtle.verify('HMAC',await hmacKey(key,'verify'),hexBytes(sig.slice(3)),enc.encode(canonical)))throw new Fail('bad_signature');
  if(!await rpc('panda_signup_nonce',{p_nonce:nonce}))throw new Fail('nonce_reused');
  return keyId;
 }
 function only(body,allowed){for(const k of Object.keys(body))if(!allowed.includes(k))throw new Fail('invalid_request',{field:k});}
 const orderRef=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9._:-]{1,100}$/.test(v))throw new Fail('invalid_request',{field:'order_ref'});return v;};

 async function createClient(body){
  only(body,['action','order_ref','email','name','slug','paid_at','amount','currency']);
  const order_ref=orderRef(body.order_ref);
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  if(email.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Fail('invalid_request',{field:'email'});
  const name=typeof body.name==='string'?body.name.trim().replace(/\s+/g,' '):'';
  if(!name||name.length>80)throw new Fail('invalid_request',{field:'name'});
  const slug=body.slug;if(typeof slug!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug))throw new Fail('invalid_request',{field:'slug'});
  let paid=now();
  if(body.paid_at!==undefined){paid=Date.parse(body.paid_at);if(typeof body.paid_at!=='string'||!Number.isFinite(paid)||paid>now()+86400000)throw new Fail('invalid_request',{field:'paid_at'});}
  if(body.amount!==undefined&&(typeof body.amount!=='number'||!Number.isFinite(body.amount)||body.amount<0))throw new Fail('invalid_request',{field:'amount'});
  if(body.currency!==undefined&&(typeof body.currency!=='string'||!/^[A-Z]{3}$/.test(body.currency)))throw new Fail('invalid_request',{field:'currency'});
  const request_hash=await sha256(JSON.stringify([email,name,slug]));

  const begin=await rpc('panda_signup_begin',{p_order_ref:order_ref,p_email:email,p_name:name,p_slug:slug,p_request_hash:request_hash,p_paid_at:new Date(paid).toISOString(),p_amount:body.amount??null,p_currency:body.currency??null,p_max_per_hour:maxPerHour});
  if(begin.code==='already_created'){
   const live=begin.token_id?await token(begin.token_id):null;
   return {code:'already_created',order_ref,username:begin.username,package_id:begin.package_id,setup_url:live?link(live):null,
    setup_expires_at:live?begin.token_expires_at:null,setup_completed:!!begin.completed,setup_expired:!begin.completed&&!live};
  }
  if(begin.code==='portal_configuration')throw new Fail('portal_configuration',{reason:begin.reason});
  if(begin.code!=='proceed')throw new Fail(begin.code);

  // Auth user. The id comes from the claim row, so a retry after a crash finds the same user.
  const uid=begin.user_id,login=begin.username+'@'+domain;
  const created=await call('/auth/v1/admin/users',{method:'POST',body:{id:uid,email:login,password:b64url(crypto.getRandomValues(new Uint8Array(24)))+'aA1!',email_confirm:true}});
  if(!created.ok){
   const existing=created.status>=500?null:await call('/auth/v1/admin/users/'+uid);
   if(!(existing?.ok&&existing.data?.email===login)){
    await rpc('panda_signup_failed',{p_order_ref:order_ref,p_code:'auth_create_'+created.status}).catch(()=>{});
    throw upstream(created);
   }
  }
  const t=await issue();
  // A transport error here leaves the outcome unknown, so nothing is removed: the claim stays
  // 'claimed' and a retry either finds the account ('already_created') or resumes.
  const result=await rpc('panda_signup_register',{p_order_ref:order_ref,p_token_id:t.id,p_token_hash:t.hash});
  if(result.code==='invalid_state')throw new Fail('in_progress');
  if(result.code!=='created'){
   // The database refused and rolled back the account (the claim is now 'failed'). Compensate for
   // the Auth/database boundary: never leave a login without its account.
   await removeUser(uid);
   if(result.code==='portal_configuration')throw new Fail('portal_configuration',{reason:result.reason});
   if(result.code==='unknown_package')throw new Fail('unknown_package');
   log('panda-signup register failed',result.reason);throw new Fail('internal');
  }
  return {code:'created',order_ref,username:result.username,package_id:result.package_id,setup_url:link(t.token),setup_expires_at:result.token_expires_at};
 }
 async function removeUser(uid){const r=await call('/auth/v1/admin/users/'+uid,{method:'DELETE'}).catch(()=>null);if(!r?.ok&&r?.status!==404)log('panda-signup: an Auth user may need removal',uid);}

 async function resendSetup(body){
  only(body,['action','order_ref']);
  const order_ref=orderRef(body.order_ref),t=await issue();
  const r=await rpc('panda_signup_resend',{p_order_ref:order_ref,p_token_id:t.id,p_token_hash:t.hash});
  if(r.code!=='resent')throw new Fail(r.code);
  return {code:'resent',order_ref,username:r.username,setup_url:link(t.token),setup_expires_at:r.token_expires_at};
 }

 // --- Browser requests (setup page) ------------------------------------------------------------
 async function tokenHash(body){if(typeof body.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.token))throw new Fail('token_invalid');return sha256(body.token);}
 async function checkSetup(body){
  only(body,['action','token']);
  const r=await rpc('panda_setup_check',{p_token_hash:await tokenHash(body)});
  if(r.code!=='ok')throw new Fail(r.code);
  return {code:'ok',username:r.username,setup_expires_at:r.expires_at};
 }
 async function completeSetup(body){
  only(body,['action','token','password']);
  const hash=await tokenHash(body);
  if(typeof body.password!=='string'||body.password.length<12||body.password.length>128)throw new Fail('weak_password');
  const r=await rpc('panda_setup_consume',{p_token_hash:hash});
  if(r.code!=='ok')throw new Fail(r.code);
  const set=await call('/auth/v1/admin/users/'+r.user_id,{method:'PUT',body:{password:body.password}});
  if(!set.ok){
   // Give the link back so an outage does not burn it.
   await rpc('panda_setup_release',{p_token_hash:hash}).catch(()=>{});
   if(set.status===422)throw new Fail('weak_password',{detail:set.data?.msg||set.data?.message});
   throw new Fail(set.status>=500||set.status===429?'upstream_unavailable':'setup_incomplete');
  }
  let finished;
  try{finished=await rpc('panda_setup_finish',{p_token_hash:hash});}catch{throw new Fail('setup_incomplete');}
  if(finished.code!=='ok')throw new Fail('setup_incomplete');
  // Sign the client in with the password they just chose, as change_password does in panda-accounts.
  const s=await call('/auth/v1/token?grant_type=password',{method:'POST',body:{email:r.username+'@'+domain,password:body.password},token:anon,apikey:anon}).catch(()=>null);
  return {code:'setup_complete',username:r.username,access_expires_on:finished.access_expires_on,session:s?.ok?s.data:null};
 }

 // --- Entry point ---------------------------------------------------------------------------
 return async function handle(req){
  const request_id=crypto.randomUUID();
  const origin=req.headers.get('Origin');
  const allowedOrigin=!!origin&&origins.includes(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Referrer-Policy':'no-referrer'};
  if(allowedOrigin){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='apikey, authorization, content-type, x-client-info';headers['Access-Control-Allow-Methods']='POST, OPTIONS';}
  const reply=(code,extra={})=>{
   const ok=STATUS[code]<300,h={...headers};if(RETRY_AFTER[code])h['Retry-After']=String(RETRY_AFTER[code]);
   return new Response(JSON.stringify({ok,code,retryable:RETRYABLE.has(code),message:MESSAGES[code]||code,request_id,...extra}),{status:STATUS[code]||500,headers:h});
  };
  if(origin&&!allowedOrigin)return reply('origin_not_allowed');
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  // Never act on GET: email scanners pre-fetch links.
  if(req.method!=='POST')return reply('method_not_allowed');
  if(configError){log('panda-signup not configured:',configError);return reply('not_configured');}
  try{
   const bytes=new Uint8Array(await req.arrayBuffer());
   if(bytes.length>MAX_BODY)return reply('too_large');
   const signed=req.headers.has('x-panda-signature');
   let keyId=null;
   if(signed){
    // Website requests come from a server; a browser can never send one.
    if(origin)return reply('origin_not_allowed');
    keyId=await verify(req,bytes);
   }
   let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Fail('invalid_request');}
   if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.action!=='string')throw new Fail('invalid_request');
   let result;
   if(SIGNED.has(body.action)){
    if(!signed)throw new Fail('bad_signature');
    result=body.action==='create_client'?await createClient(body):await resendSetup(body);
   }else if(TOKEN.has(body.action)){
    if(signed)throw new Fail('invalid_request');
    result=body.action==='check_setup'?await checkSetup(body):await completeSetup(body);
   }else throw new Fail('invalid_request',{field:'action'});
   const {code,...rest}=result;
   if(keyId)log('panda-signup',body.action,code,'key',keyId,'request',request_id);
   return reply(code,rest);
  }catch(err){
   if(err instanceof Fail){
    if(['bad_signature','unknown_key','stale_timestamp','portal_configuration','internal','not_configured'].includes(err.code))log('panda-signup',err.code,'request',request_id,err.extra?.skew_seconds??'',err.extra?.reason??'');
    return reply(err.code,err.extra);
   }
   log('panda-signup internal error','request',request_id,err?.name||'');
   return reply('internal');
  }
 };
}
