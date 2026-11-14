// Client intake in the browser data layer (INTAKE-DESIGN.md §4): the portal assembled from src/,
// signed in as the coach, against a backend that runs every REST call on a real PGlite database
// with all migrations. Restoring a backup made before the intake questionnaire keeps the intakes.
// Called from verify.cjs; each check reports through pass().
const assert=require('node:assert/strict');
const {browser:{portal,until,tick}}=require('./access-expiry.cjs');
const {helpers:{as,one,record,save,plans,profile,coachAccount,install}}=require('./client-intake.cjs');
const id=n=>'00000000-0000-4000-9200-'+String(n).padStart(12,'0');
const ids={coach:'00000000-0000-4000-9000-000000000001',ivy:id(1),jo:id(2)};

// The minimal draft skeleton the form sends (same shape as tests/client-intake.cjs).
const CONDITIONS=['arthritis','back_pain','knee_pain','shin_splints','muscle_pain','foot_pain','light_headedness','chest_pain','epilepsy','diabetes','high_cholesterol','smoking','high_triglycerides','respiratory_disease','high_blood_pressure','coronary_disease','heart_disease','stroke','pregnancy','family_coronary_before_55'];
const EQUIPMENT=['barbells','dumbbells','squat_racks','benches','cable_machines','smith_machine','leg_press','glute_ham_raise','back_raise_45','cardio_equipment'];
const lift={type:'unknown',value:null,unit:'kg',reps:null,estimated:false},answer={present:null,details:''};
const draft=uid=>({id:uid,form_version:1,status:'draft',personal:{neck_cm:36,waist_cm:null},
 medical:{conditions:Object.fromEntries(CONDITIONS.map(k=>[k,k==='chest_pain'?true:null])),conditions_confirmed:null,injuries_past_5_years:answer,ongoing_aches:answer,exercise_contraindications:answer,medications:answer},
 training:{experience_years:null,lifts:{squat:lift,bench_press:lift,deadlift:lift}},goals:{focus_muscles:[]},schedule:{days_per_week:null,minutes_per_session:null},
 equipment:{items:Object.fromEntries(EQUIPMENT.map(k=>[k,{available:null,details:''}])),notes:''},other:{notes:''},consent:{health_data:null}});

// Supabase stand-in: auth always signs in the coach; REST reads and RPCs run as the coach on PGlite.
// Calls are serialised because as() switches the role on the one connection.
function backend(db,saves){
 let chain=Promise.resolve();const run=task=>{const p=chain.then(task);chain=p.catch(()=>{});return p;};
 const coach=task=>run(()=>as(db,ids.coach,task));
 return async(path,body)=>{
  const u=new URL(path,'https://test.supabase.co'),p=u.pathname;
  if(p==='/auth/v1/token')return [200,{access_token:'h.'+Buffer.from('{"iat":1}').toString('base64')+'.s',refresh_token:'r',expires_in:3600,user:{id:ids.coach}}];
  if(p==='/auth/v1/logout')return [204];
  if(p==='/rest/v1/panda_accounts'&&u.searchParams.has('user_id'))return [200,(await coach(()=>db.query('select * from panda_accounts where user_id=$1',[ids.coach]))).rows];
  if(p==='/rest/v1/panda_accounts')return [200,(await coach(()=>db.query('select * from panda_accounts order by created_at'))).rows];
  if(p==='/rest/v1/panda_records'){const limit=Number(u.searchParams.get('limit')||500),offset=Number(u.searchParams.get('offset')||0);
   return [200,(await coach(()=>db.query('select kind,id,owner_id,data,revision::int revision from panda_records order by kind,id limit $1 offset $2',[limit,offset]))).rows];}
  if(p==='/rest/v1/panda_events'||p.startsWith('/rest/v1/rpc/panda_chat_'))return [200,[]];
  if(p==='/rest/v1/rpc/panda_access_status')return [200,(await coach(()=>one(db,'select panda_access_status() s'))).s];
  if(p==='/rest/v1/rpc/panda_save'){saves.push(body.changes);
   try{return [200,(await coach(()=>one(db,'select panda_save($1::jsonb,$2) r',[JSON.stringify(body.changes),body.label]))).r];}
   catch(e){return [400,{code:e.code,message:e.message}];}}
  return [404,{message:'Not in test backend: '+path}];
 };
}

async function ui({PGlite,bootstrap,migrations},html,pass){
 // Database: two clients, each with a saved intake draft.
 const db=await install(PGlite,bootstrap,migrations);
 await coachAccount(db);const full=await plans(db,'coaching');
 for(const uid of [ids.ivy,ids.jo]){
  await db.query('insert into auth.users(id) values($1)',[uid]);
  await db.query('select panda_register_client($1,$2,$3)',[uid,'client.'+uid.slice(-2),JSON.stringify(profile(uid,full))]);
  await db.query('update panda_accounts set must_change_password=false where user_id=$1',[uid]);
  await save(db,uid,[{kind:'client_intake',id:uid,data:draft(uid),revision:0}],'Updated intake questionnaire');
 }
 const intakes=async()=>JSON.stringify((await db.query("select id,data,revision::int revision from panda_records where kind='client_intake' order by id")).rows);
 const stored=await intakes();assert.equal(JSON.parse(stored).length,2);

 // Browser: sign in as the coach.
 const t=portal(html),saves=[],route=backend(db,saves);await tick(150);
 // Close the window and database on failure too, or the open jsdom timers keep node running.
 try{
 t.w.fetch=async(url,options={})=>{const body=options.body?JSON.parse(options.body):undefined;const [status,data]=await route(new URL(url).pathname+new URL(url).search,body);return {ok:status<300,status,text:async()=>data===undefined?'':JSON.stringify(data)};};
 await until(()=>t.w.document.querySelector('[data-auth-form="login"]'),'login form');
 const f=t.w.document.querySelector('[data-auth-form="login"]');f.querySelector('[name="username"]').value='coach';f.querySelector('[name="password"]').value='correct-password';
 f.dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true}));
 const S=t.w.PandaServices;await until(()=>S.online&&S.get()?.client_intake?.length===2,'coach state with intakes');
 const loaded=S.get();
 assert.deepEqual(loaded.client_intake.map(x=>x.id).sort(),[ids.ivy,ids.jo]);
 assert.equal(loaded.client_intake.find(x=>x.id===ids.ivy).health_flag,true);
 pass('Coach portal loads client_intake records into state (assemble) with the server-set fields');

 // A backup made before the intake questionnaire: no client_intake key, plus one real change.
 const backup=JSON.parse(S.export());delete backup.client_intake;backup.brand={...backup.brand,coach:'Coach Restored'};
 saves.length=0;
 const restored=await S.restore(backup);
 assert.equal(saves.length,1);assert(saves[0].some(c=>c.kind==='settings'&&c.id==='brand'));
 assert(!saves.flat().some(c=>c.kind==='client_intake'),'restore sent an intake change');
 assert.equal(await intakes(),stored);
 assert.equal((await record(db,'settings','brand')).data.coach,'Coach Restored');
 assert.deepEqual(restored.client_intake.map(x=>x.id).sort(),[ids.ivy,ids.jo]);assert.deepEqual(S.get().client_intake,loaded.client_intake);
 pass('Restoring a backup without client_intake keeps every intake (no deletion sent, database unchanged) and still applies the backup\'s other changes');

 // Contrast: a backup that does list intakes, but none, would delete them; the database refuses and nothing changes.
 const empty=JSON.parse(S.export());empty.client_intake=[];empty.brand={...empty.brand,coach:'Coach Emptied'};
 saves.length=0;
 await assert.rejects(()=>S.restore(empty),/Referenced records cannot be deleted/);
 assert(saves.flat().some(c=>c.kind==='client_intake'&&c.data===null));
 assert.equal(await intakes(),stored);assert.equal((await record(db,'settings','brand')).data.coach,'Coach Restored');
 assert.equal(S.get().client_intake.length,2);
 pass('A backup with an empty client_intake list is refused as a whole (intakes cannot be deleted) and changes nothing');

 // Commit order: a batch with a profile edit and an intake saves the profile first.
 saves.length=0;
 await S.commit(s=>{s.clients.find(c=>c.id===ids.ivy).goal='Hypertrophy';const x=s.client_intake.find(r=>r.id===ids.ivy);x.status='reopened';},'Reopened intake questionnaire');
 assert.deepEqual(saves[0].map(c=>c.kind),['clients','client_intake']);
 assert.equal((await record(db,'client_intake',ids.ivy)).data.status,'reopened');
 pass('Commit sends clients before client_intake in one batch (flatten emits the intake)');

 // validate(): client_intake is optional; when present it must be an array of plain objects (≤20,000).
 const base=JSON.parse(S.export());
 const ok=s=>S.validate(s),bad=s=>assert.throws(()=>S.validate(s),/Invalid client_intake records/);
 assert(ok({...base,client_intake:undefined}));assert(ok(base));
 bad({...base,client_intake:{}});bad({...base,client_intake:[null]});bad({...base,client_intake:[[]]});bad({...base,client_intake:['x']});
 bad({...base,client_intake:Array.from({length:20001},()=>({}))});
 const {client_intake:_,...older}=base;assert.equal(JSON.stringify(t.w.PandaRecipes.migrate(older).client_intake),'[]');
 assert.equal(JSON.stringify(t.w.PandaRecipes.migrate({...base,client_intake:[{id:'a'}]}).client_intake),'[{"id":"a"}]');
 assert.deepEqual(t.errors,[]);
 pass('validate() accepts a missing or valid client_intake list and rejects other shapes or more than 20,000 rows; PandaRecipes.migrate defaults it to []');
 }finally{t.close();await db.close();}
}
module.exports={ui};
