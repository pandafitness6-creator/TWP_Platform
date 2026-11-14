// Coach view of the client intake (25-intake.js coachView, 26-portal.js clientIntakeModal),
// driven through the assembled page signed in as the coach, against PGlite with every migration,
// so RLS, panda_save and the intake trigger all apply. Called from verify.cjs; each check
// reports through pass().
const assert=require('node:assert/strict');
const {browser:{portal,until,tick}}=require('./access-expiry.cjs');
const {helpers:{record,save,plans,profile,coachAccount,install,blank,filled}}=require('./client-intake.cjs');
const {backend}=require('./intake-restore.cjs');
const id=n=>'00000000-0000-4000-9400-'+String(n).padStart(12,'0');
const ids={coach:'00000000-0000-4000-9000-000000000001',ana:id(1),ben:id(2),cara:id(3),dev:id(4),eli:id(5),fay:id(6)};
const LABEL='Updated intake questionnaire';

async function register(db,key,p){
 const uid=ids[key];
 await db.query('insert into auth.users(id) values($1)',[uid]);
 await db.query('select panda_register_client($1,$2,$3)',[uid,'client.'+key,JSON.stringify(profile(uid,p,{name:key[0].toUpperCase()+key.slice(1)+' Client'}))]);
 await db.query('update panda_accounts set must_change_password=false where user_id=$1',[uid]);
 return uid;
}
// The client submits while onboarding; the coach then makes them active (as after onboarding).
async function submitted(db,uid,data){
 await save(db,uid,[{kind:'client_intake',id:uid,data,revision:0}],LABEL);
 await db.query(`update panda_records set data=jsonb_set(data,'{status}','"active"') where kind='clients' and id=$1`,[uid]);
}
const intakeRow=async(db,uid)=>(await record(db,'client_intake',uid))?.data;
// A browser signed in as `uid`. Every panda_save batch is kept in `saves`.
async function session(html,db,uid,login){
 const t=portal(html),saves=[],route=backend(db,saves,uid);await tick(150);
 t.w.fetch=async(url,options={})=>{const u=new URL(url),body=options.body?JSON.parse(options.body):undefined;const [status,data]=await route(u.pathname+u.search,body);return {ok:status<300,status,text:async()=>data===undefined?'':JSON.stringify(data)};};
 await until(()=>t.w.document.querySelector('[data-auth-form="login"]'),'login form');
 const f=t.w.document.querySelector('[data-auth-form="login"]');f.querySelector('[name="username"]').value=login;f.querySelector('[name="password"]').value='correct-password';
 f.dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true}));
 const d=t.w.document;
 return Object.assign(t,{saves,d,$:sel=>d.querySelector(sel),$$:sel=>[...d.querySelectorAll(sel)],
  go:async(hash,test,label)=>{t.w.location.hash=hash;await until(test,label);},
  modal:()=>d.querySelector('#modal').open?d.querySelector('#modal-content'):null});
}

async function ui({PGlite,bootstrap,migrations},html,pass){
 const db=await install(PGlite,bootstrap,migrations);
 await coachAccount(db);const full=await plans(db,'coaching');
 for(const key of ['ana','ben','cara','dev','eli','fay'])await register(db,key,full);
 // ana: not started (onboarding). ben: draft. cara: submitted with flagged answers.
 // dev: submitted, no flag (back pain only). eli: submitted, then reopened by the coach.
 // fay: already active with no intake, so she cannot start one on her own.
 await save(db,ids.ben,[{kind:'client_intake',id:ids.ben,data:blank(ids.ben),revision:0}],LABEL);
 const flaggedAnswers=filled(ids.cara);flaggedAnswers.medical.conditions.chest_pain=true;flaggedAnswers.medical.conditions.pregnancy=true;
 await submitted(db,ids.cara,flaggedAnswers);await submitted(db,ids.dev,filled(ids.dev));await submitted(db,ids.eli,filled(ids.eli));
 await db.query(`update panda_records set data=jsonb_set(data,'{status}','"active"') where kind='clients' and id=$1`,[ids.fay]);
 const e=await record(db,'client_intake',ids.eli);await save(db,ids.coach,[{kind:'client_intake',id:ids.eli,data:{...e.data,status:'reopened'},revision:e.revision}],LABEL);
 assert.equal((await intakeRow(db,ids.cara)).health_flag,true);assert.equal((await intakeRow(db,ids.dev)).health_flag,false);
 const windows=[];
 try{
 const t=await session(html,db,ids.coach,'coach');windows.push(t);
 const S=t.w.PandaServices;await until(()=>S.online&&S.get()?.client_intake?.length===4,'coach state with intakes');

 // 1. Intake state on the Clients page, one per client.
 await t.go('#/clients',()=>t.$$('[data-client-row]').length===6,'clients page');
 const state=key=>t.$(`[data-client-row="${ids[key]}"] [data-intake-state]`);
 const expected={ana:['none','Intake: not started'],ben:['draft','Intake: draft'],cara:['submitted','Intake: submitted'],dev:['submitted','Intake: submitted'],eli:['reopened','Intake: reopened'],fay:['none','Intake: not started']};
 for(const [key,[k,text]] of Object.entries(expected)){assert.equal(state(key).dataset.intakeState,k,key);assert.equal(state(key).querySelector('.tag').textContent.trim(),text,key);}
 const ar=t.w.PandaI18n.dictionary;for(const text of ['Intake: not started','Intake: draft','Intake: submitted','Intake: reopened','Health flag','Health screening flag','Reopen intake','About the client','Gym and equipment','Weight at intake','Review health flag'])assert(ar[text],'Arabic for '+text);
 pass('The Clients page shows each client\'s intake state (not started, draft, submitted, reopened), with Arabic labels for every new coach string');

 // 2. The coach reads any client's intake, read-only, in coach wording, with the at-intake snapshot.
 const sent=t.saves.length;
 t.$(`[data-client-row="${ids.dev}"] [data-action="client-intake"]`).click();await until(()=>t.modal()?.querySelector('[data-intake-coach]'),'dev intake modal');
 let m=t.modal();
 assert.deepEqual([...m.querySelectorAll('.intake-summary h3')].map(h=>h.textContent),['About the client','Health screening','Training background','Goals','Schedule','Gym and equipment']);
 assert.doesNotMatch(m.textContent,/About you|Your goals|Your schedule|Your gym|your answers/i);
 assert.match(m.textContent,/Submitted on /);assert.match(m.textContent,/Weight at intake\s*70 kg/);assert.match(m.textContent,/Neck at intake\s*35\.5 cm/);assert.match(m.textContent,/Back pain/);
 assert.equal(m.querySelectorAll('input,select,textarea,form').length,0);assert.equal(m.querySelector('[data-action^="intake-"]'),null);
 t.$('#modal [data-action="close"]')?.click();
 // From a dashboard card, a draft: the profile part is labelled as the current profile, not "at intake".
 await t.go('#/coach',()=>t.$('.overview-client'),'coach home');
 const card=t.$$('.overview-client').find(c=>c.querySelector(`[data-action="client-intake"][data-id="${ids.ben}"]`));
 card.querySelector('[data-action="client-intake"]').click();await until(()=>t.modal()?.querySelector('[data-intake-coach="draft"]'),'ben intake modal');
 m=t.modal();assert.match(m.textContent,/Weight · current profile/);assert.doesNotMatch(m.textContent,/Weight at intake/);assert.match(m.textContent,/Draft\. The client has not submitted it yet\./);
 assert.equal(m.querySelector('[data-action="client-intake-reopen"]'),null);
 assert.equal(t.saves.length,sent);
 pass('The coach opens any client\'s intake from the Clients page or a dashboard card: six sections in coach wording, submitted date, and the profile snapshot labelled "at intake" (or "current profile" for a draft)');

 // 3. Health flag: the warning, the markers and the attention item appear for cara, not for dev.
 await t.go('#/clients',()=>t.$$('[data-client-row]').length===6,'clients page again');
 const rowFlag=key=>[...t.$(`[data-client-row="${ids[key]}"]`).querySelectorAll('.tag.danger')].some(x=>x.textContent.trim()==='Health flag');
 assert.equal(rowFlag('cara'),true);for(const key of ['ana','ben','dev','eli','fay'])assert.equal(rowFlag(key),false,key);
 t.$(`[data-client-row="${ids.cara}"] [data-action="client-intake"]`).click();await until(()=>t.modal()?.querySelector('[data-intake-coach="submitted"]')&&t.modal().textContent.includes('Cara'),'cara intake modal');
 const warning=t.modal().querySelector('.intake-health-flag');assert(warning,'health warning shown');
 assert.equal(t.modal().querySelector('.intake-coach').firstElementChild,warning);
 assert.match(warning.textContent,/Declared: chest pain, pregnancy\./);assert.match(warning.textContent,/medical clearance from a doctor before you write or assign a training plan/);
 t.$('#modal [data-action="close"]')?.click();
 t.$(`[data-client-row="${ids.dev}"] [data-action="client-intake"]`).click();await until(()=>t.modal()?.textContent.includes('Dev Client'),'dev modal again');
 assert.equal(t.modal().querySelector('.intake-health-flag'),null);t.$('#modal [data-action="close"]')?.click();
 await t.go('#/coach',()=>t.$('.overview-client'),'coach home again');
 const cardFor=key=>t.$$('.overview-client').find(c=>c.querySelector(`[data-action="client-intake"][data-id="${ids[key]}"]`));
 assert(cardFor('cara').querySelector('.intake-flag-marker'));assert.equal(cardFor('dev').querySelector('.intake-flag-marker'),null);
 const items=t.w.PandaAttention.derive(S.get(),new Date().toISOString().slice(0,10)).items;
 assert.equal(items[0].id,'health:'+ids.cara);assert.equal(items.filter(x=>x.id.startsWith('health:')).length,1);assert.match(items[0].detail,/chest pain, pregnancy\. Medical clearance is needed before a plan is written\./);
 assert.match(t.$('#main').textContent,/Review health flag/);
 pass('A health flag shows a warning at the top of the intake naming the declared conditions and asking for medical clearance before a plan; flagged clients get a marker on the Clients page and dashboard card and come first in the coach\'s attention items (none of this appears for an unflagged intake)');

 // 4. The coach cannot edit answers: no form in the coach UI, and the coach's own intake route shows none.
 await t.go('#/intake',()=>/Open a client view/.test(t.$('#main').textContent),'coach intake route');
 assert.equal(t.$('[data-form="intake"]'),null);
 assert.equal(t.saves.length,sent);
 pass('The coach cannot edit intake answers: the intake view has no form controls, opening it sends nothing, and the coach has no intake form of their own');

 // 5. Reopen: confirmed first, then only the status changes.
 await t.go('#/clients',()=>t.$$('[data-client-row]').length===6,'clients page for reopen');
 t.$(`[data-client-row="${ids.cara}"] [data-action="client-intake"]`).click();await until(()=>t.modal()?.querySelector('[data-action="client-intake-reopen"]'),'reopen button');
 const before=await record(db,'client_intake',ids.cara);
 const asked=[];t.w.confirm=text=>{asked.push(text);return false;};
 t.modal().querySelector('[data-action="client-intake-reopen"]').click();await until(()=>asked.length===1,'reopen confirm');await tick(60);
 assert.match(asked[0],/Reopen Cara Client’s intake questionnaire\?/);assert.equal(t.saves.length,sent);assert.equal((await intakeRow(db,ids.cara)).status,'submitted');
 t.w.confirm=()=>true;
 t.modal().querySelector('[data-action="client-intake-reopen"]').click();await until(()=>t.modal()?.querySelector('[data-intake-coach="reopened"]'),'reopened modal');
 assert.equal(t.saves.length,sent+1);assert.deepEqual(t.saves.at(-1).map(c=>[c.kind,c.id]),[['client_intake',ids.cara]]);
 const after=await record(db,'client_intake',ids.cara);
 assert.equal(after.data.status,'reopened');assert.deepEqual({...after.data,status:'submitted'},before.data);assert.equal(after.revision,before.revision+1);
 assert.equal(t.modal().querySelector('[data-action="client-intake-reopen"]'),null);assert.match(t.modal().textContent,/Reopened\. Waiting for the client.*Last submitted on/s);
 assert.equal(t.$(`[data-client-row="${ids.cara}"] [data-intake-state]`).dataset.intakeState,'reopened');
 assert.deepEqual(t.errors,[]);
 pass('Reopen intake asks for confirmation (nothing is sent if cancelled), then changes only the status to reopened; answers, submitted date and snapshot are kept, and the list updates');

 // 6. The reopened intake is writable by the client again, and they can resubmit.
 t.close();windows.length=0;
 const c=await session(html,db,ids.cara,'client.cara');windows.push(c);
 const form=()=>c.$('[data-form="intake"]');
 await until(()=>c.w.PandaServices.online&&c.$('#main'),'client signed in');
 await c.go('#/intake',()=>form(),'client intake form');
 assert.match(c.$('[data-save-state]').textContent,/Your coach reopened your intake/);
 const neck=form().elements.namedItem('neck_cm');if(neck){neck.value='36';for(const type of ['input','change'])neck.dispatchEvent(new c.w.Event(type,{bubbles:true}));}
 else{c.$('[data-action="intake-step"][data-step="0"]').click();await until(()=>form()?.elements.namedItem('neck_cm'),'step 1');const n=form().elements.namedItem('neck_cm');n.value='36';for(const type of ['input','change'])n.dispatchEvent(new c.w.Event(type,{bubbles:true}));}
 c.$('[data-action="intake-save"]').click();await until(()=>c.saves.length===1&&!c.$('[data-save-state][data-state="dirty"]'),'client draft saved');
 let x=await intakeRow(db,ids.cara);assert.equal(x.status,'reopened');assert.equal(x.personal.neck_cm,36);
 c.$('[data-action="intake-step"][data-step="5"]').click();await until(()=>form()&&Number(form().dataset.step)===5,'last step');
 c.$('[data-action="intake-submit"]').click();await until(()=>c.$('.intake-locked'),'resubmitted');
 x=await intakeRow(db,ids.cara);assert.equal(x.status,'submitted');assert.equal(x.health_flag,true);
 assert.deepEqual(c.errors,[]);
 pass('After the coach reopens it, the client can edit the intake again (drafts stay reopened) and resubmit it');

 // 7. An active client with no intake: the coach opens one for them; an onboarding client needs no action.
 c.close();windows.length=0;
 const k=await session(html,db,ids.coach,'coach');windows.push(k);
 await until(()=>k.w.PandaServices.online&&k.w.PandaServices.get()?.client_intake?.length===4,'coach again');
 await k.go('#/clients',()=>k.$$('[data-client-row]').length===6,'clients page, second coach session');
 k.$(`[data-client-row="${ids.ana}"] [data-action="client-intake"]`).click();await until(()=>k.modal()?.querySelector('[data-intake-coach="none"]'),'ana modal');
 assert.match(k.modal().textContent,/The client sees the questionnaire when they sign in/);assert.equal(k.modal().querySelector('[data-action="client-intake-reopen"]'),null);
 k.$(`[data-client-row="${ids.fay}"] [data-action="client-intake"]`).click();await until(()=>k.modal()?.textContent.includes('past onboarding'),'fay modal');
 const open=k.modal().querySelector('[data-action="client-intake-reopen"]');assert.equal(open.textContent.trim(),'Open intake for the client');
 open.click();await until(()=>k.modal()?.querySelector('[data-intake-coach="reopened"]'),'fay intake opened');
 x=await intakeRow(db,ids.fay);assert.equal(x.status,'reopened');assert.equal(x.submitted_at,null);assert.equal(x.health_flag,false);
 k.close();windows.length=0;
 const fay=await session(html,db,ids.fay,'client.fay');windows.push(fay);
 await until(()=>fay.w.PandaServices.online&&fay.$('#main'),'fay signed in');await fay.go('#/intake',()=>fay.$('[data-form="intake"]'),'fay intake form');
 assert.deepEqual(k.errors,[]);assert.deepEqual(fay.errors,[]);
 pass('For an active client with no intake the coach can open one (stored as an empty reopened intake the client can then fill in); an onboarding client needs no action');
 }finally{for(const w of windows)w.close();await db.close();}
}
module.exports={ui};
