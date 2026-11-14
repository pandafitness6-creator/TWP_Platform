// Client intake questionnaire (migration 023, INTAKE-DESIGN.md): record kind, write window,
// server-managed fields, validation and event-label privacy. Called from verify.cjs; each check
// reports through pass().
const assert=require('node:assert/strict');
const MIGRATION='202611130023_client_intake.sql';
const id=n=>'00000000-0000-4000-9000-'+String(n).padStart(12,'0');
const ids={coach:id(1),ana:id(2),ben:id(3),cara:id(4),dev:id(5),eli:id(6),fay:id(7),nut:id(8),gus:id(9)};
const CONDITIONS=['arthritis','back_pain','knee_pain','shin_splints','muscle_pain','foot_pain','light_headedness','chest_pain','epilepsy','diabetes','high_cholesterol','smoking','high_triglycerides','respiratory_disease','high_blood_pressure','coronary_disease','heart_disease','stroke','pregnancy','family_coronary_before_55'];
const EQUIPMENT=['barbells','dumbbells','squat_racks','benches','cable_machines','smith_machine','leg_press','glute_ham_raise','back_raise_45','cardio_equipment'];
const LABEL='Updated intake questionnaire';
const day=(offset=0)=>new Date(Date.now()+offset*864e5).toISOString().slice(0,10);

// --- Helpers ---------------------------------------------------------------
async function as(db,uid,task){await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}'`);try{return await task();}finally{await db.exec('reset role;reset request.jwt.claim.sub');}}
const one=async(db,sql,args)=>(await db.query(sql,args)).rows[0];
const copy=x=>JSON.parse(JSON.stringify(x));
const lift=(o={})=>({type:'unknown',value:null,unit:'kg',reps:null,estimated:false,...o});
const answer=(present=null,details='')=>({present,details});
// The empty skeleton the form always sends: every key present, answers null.
function blank(uid){return {id:uid,form_version:1,status:'draft',
 personal:{neck_cm:null,waist_cm:null},
 medical:{conditions:Object.fromEntries(CONDITIONS.map(k=>[k,null])),conditions_confirmed:null,injuries_past_5_years:answer(),ongoing_aches:answer(),exercise_contraindications:answer(),medications:answer()},
 training:{experience_years:null,lifts:{squat:lift(),bench_press:lift(),deadlift:lift()}},
 goals:{focus_muscles:[]},schedule:{days_per_week:null,minutes_per_session:null},
 equipment:{items:Object.fromEntries(EQUIPMENT.map(k=>[k,{available:null,details:''}])),notes:''},
 other:{notes:''},consent:{health_data:null}};}
// A complete, valid answer set (no health flag conditions).
function filled(uid,status='submitted'){const b=blank(uid);b.status=status;
 b.personal={neck_cm:35.5,waist_cm:80};
 for(const k of CONDITIONS)b.medical.conditions[k]=false;b.medical.conditions.back_pain=true;b.medical.conditions_confirmed=true;
 b.medical.injuries_past_5_years=answer(true,'Ankle sprain 2023, recovered');b.medical.ongoing_aches=answer(false);b.medical.exercise_contraindications=answer(false);b.medical.medications=answer(false);
 b.training={experience_years:2.5,lifts:{squat:lift({type:'1rm',value:100,estimated:true}),bench_press:lift({type:'working_set',value:60,reps:8}),deadlift:lift()}};
 b.goals.focus_muscles=['Glutes','Back'];b.schedule={days_per_week:3,minutes_per_session:60};
 for(const k of EQUIPMENT)b.equipment.items[k]={available:k!=='leg_press',details:''};b.equipment.items.dumbbells.details='up to 30 kg';
 b.consent.health_data=true;return b;}
const record=(db,kind,rid)=>one(db,'select data,revision::int revision from panda_records where kind=$1 and id=$2',[kind,rid]);
async function change(db,kind,rid,data){const r=await record(db,kind,rid);return {kind,id:rid,data,revision:r?r.revision:0};}
const save=(db,uid,changes,label='Saved changes')=>as(db,uid,()=>db.query('select panda_save($1::jsonb,$2)',[JSON.stringify(changes),label]));
const saveIntake=async(db,uid,owner,data,label)=>save(db,uid,[await change(db,'client_intake',owner,data)],label);
const intake=async(db,owner)=>(await record(db,'client_intake',owner))?.data;
const definition=async(db,fn)=>(await one(db,'select pg_get_functiondef($1::regprocedure) d',[fn])).d;
const constraint=async(db,name)=>(await one(db,"select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.panda_records'::regclass and conname=$1",[name])).d;

async function plans(db,pkg){return {
 pkg,
 prog:(await one(db,"select id from panda_records where kind='programs' and data->>'status'='published' and coalesce(data->>'plan_type','')<>'cardio' order by id limit 1")).id,
 nut:(await one(db,"select id from panda_records where kind='nutrition_plans' and data->>'status'='published' order by id limit 1")).id};}
const profile=(uid,p,extra={})=>({id:uid,name:'Client '+uid.slice(-2),email:'',location:'',goal:'Strength',occupation:'',activity_level:'',preferences:'',allergies:'',limitations:'',sex:'Not specified',age:30,height:170,weight:70,goal_weight:70,package_id:p.pkg,program_id:p.prog,nutrition_id:p.nut,status:'onboarding',start_date:'2026-01-01',end_date:'2026-12-31',checkin_day:'Sunday',training_days:3,steps_target:8000,sleep_target:8,cardio_minutes:0,cardio_days:0,favorites:[],read_articles:[],onboarding:{profile:false,guidelines:false,plans:false},...extra});
async function coachAccount(db){await db.query('insert into auth.users(id) values($1)',[ids.coach]);await db.query("insert into panda_accounts(user_id,username,role,active,must_change_password) values($1,'coach','coach',true,false)",[ids.coach]);}
async function register(db,key,p,extra){const uid=ids[key];await db.query('insert into auth.users(id) values($1)',[uid]);await db.query('select panda_register_client($1,$2,$3)',[uid,'client.'+key,JSON.stringify(profile(uid,p,extra))]);await db.query('update panda_accounts set must_change_password=false where user_id=$1',[uid]);return uid;}
async function install(PGlite,bootstrap,migrations){const db=new PGlite();await db.exec(bootstrap);for(const [,text]of migrations)await db.exec(text);return db;}

async function sql({PGlite,bootstrap,migrations},pass){
 const text=migrations.find(([f])=>f===MIGRATION)?.[1];assert(text,'Migration 023 is missing');

 // 1. Prerequisites: 023 refuses to patch a database that lacks an earlier patch, and changes nothing.
 {
  const db=new PGlite();await db.exec(bootstrap);
  for(const [f,t]of migrations)if(f<'202609270014')await db.exec(t);   // 001-013: 009 and 010, but not 014
  await assert.rejects(()=>db.exec(text),/readable\(\) is missing an earlier patch \(coalesce\(panda_private\.profile\(\)->>'cardio_id',''\)\)/);await db.exec('rollback');
  assert(!(await constraint(db,'panda_records_kind_check')).includes('client_intake'));
  assert(!(await definition(db,'public.panda_save(jsonb,text)')).includes('client_intake'));
  await db.close();
  pass('Migration 023 aborts before patching when an earlier patch (014) is missing, and leaves the database unchanged');
 }

 // 2. Fresh install: every earlier patch is still present after 023, and 023 re-runs without changes.
 const db=await install(PGlite,bootstrap,migrations);
 const save_=await definition(db,'public.panda_save(jsonb,text)'),read_=await definition(db,'panda_private.readable(text,text,uuid,jsonb)');
 for(const marker of ['perform panda_private.validate_activity(body)','-- Panda hydration-only package guard.','-- Panda client intake: fixed event label.',"'drafts','client_intake') or (old.owner_id","'supplements','client_intake') then owner:=rid::uuid;","'settings','client_intake') then raise exception 'Referenced records cannot be deleted'"])assert(save_.includes(marker),'panda_save lacks: '+marker);
 for(const marker of ["panda_private.feature('activity') or panda_private.feature('nutrition')","coalesce(panda_private.profile()->>'cardio_id','')","if k='client_intake' then return true; end if; -- Panda client intake."])assert(read_.includes(marker),'readable() lacks: '+marker);
 assert.equal(save_.split('-- Panda client intake: fixed event label.').length,2);assert.equal(read_.split('-- Panda client intake.').length,2);
 assert((await constraint(db,'panda_records_kind_check')).includes("'client_intake'"));assert((await constraint(db,'panda_records_ownership_check')).includes("'client_intake'"));
 const brand=await record(db,'settings','brand');assert.equal(brand.data.intake_retention_months,24);
 await db.exec(text);
 assert.equal(await definition(db,'public.panda_save(jsonb,text)'),save_);assert.equal(await definition(db,'panda_private.readable(text,text,uuid,jsonb)'),read_);
 assert.deepEqual(await record(db,'settings','brand'),brand);
 pass('Migration 023 keeps the 009, 010 and 014 patches, applies patches A–D and the readable() patch exactly once, and re-runs without changes');

 // Accounts: onboarding clients on the complete, training-only and nutrition-only packages, and one active client.
 await coachAccount(db);
 const full=await plans(db,'coaching'),essential=await plans(db,'essential'),nutrition=await plans(db,'nutrition_only');
 for(const key of ['ana','dev','eli','fay','gus'])await register(db,key,full);
 await register(db,'ben',essential);await register(db,'nut',nutrition);await register(db,'cara',full,{status:'active'});
 const clientsRow=async uid=>(await record(db,'clients',uid)).data;

 // 3. Draft while onboarding; visibility; no package gating.
 await saveIntake(db,ids.ana,ids.ana,blank(ids.ana));
 await saveIntake(db,ids.ben,ids.ben,blank(ids.ben));
 let a=await intake(db,ids.ana);assert.equal(a.status,'draft');assert.equal(a.submitted_at,null);assert.equal(a.submitted_profile,null);assert.equal(a.health_flag,false);
 for(const [uid,mine] of [[ids.ana,ids.ana],[ids.ben,ids.ben]])await as(db,uid,async()=>{const rows=(await db.query("select id from panda_records where kind='client_intake'")).rows;assert.deepEqual(rows.map(r=>r.id),[mine]);});
 assert.equal((await as(db,ids.coach,()=>one(db,"select count(*)::int n from panda_records where kind='client_intake'"))).n,2);
 await assert.rejects(()=>saveIntake(db,ids.ana,ids.ben,blank(ids.ben)),/Access denied/);
 await assert.rejects(()=>saveIntake(db,ids.ben,ids.ben,{...blank(ids.ben),status:'reopened'}),/Invalid intake status/);
 pass('Client saves a draft while onboarding; only that client and the coach can read it; no package feature needed (training-only package); clients cannot write another client\'s intake or set reopened');

 // 4. Submitting requires completeness and consent, then locks the intake for the client.
 const noConsent=filled(ids.ana);noConsent.consent.health_data=false;
 await assert.rejects(()=>saveIntake(db,ids.ana,ids.ana,noConsent),/health information consent/);
 noConsent.consent.health_data=null;await assert.rejects(()=>saveIntake(db,ids.ana,ids.ana,noConsent),/health information consent/);
 const incomplete=filled(ids.ana);incomplete.personal.neck_cm=null;await assert.rejects(()=>saveIntake(db,ids.ana,ids.ana,incomplete),/neck measurement/);
 const unconfirmed=filled(ids.ana);unconfirmed.medical.conditions_confirmed=false;await assert.rejects(()=>saveIntake(db,ids.ana,ids.ana,unconfirmed),/Confirm the medical conditions list/);
 const undescribed=filled(ids.ana);undescribed.medical.medications=answer(true,'  ');await assert.rejects(()=>saveIntake(db,ids.ana,ids.ana,undescribed),/Add details for: medications/);
 const draftNoConsent=filled(ids.ana,'draft');draftNoConsent.consent.health_data=null;await saveIntake(db,ids.ana,ids.ana,draftNoConsent);
 await saveIntake(db,ids.ana,ids.ana,filled(ids.ana));
 a=await intake(db,ids.ana);assert.equal(a.status,'submitted');assert(Date.parse(a.submitted_at)>0);
 assert.deepEqual(a.submitted_profile,{name:'Client 02',sex:'Not specified',age:30,height:170,weight:70,goal:'Strength'});
 const firstSubmission=a.submitted_at;
 await assert.rejects(()=>saveIntake(db,ids.ana,ids.ana,filled(ids.ana,'draft')),/has been submitted\. Ask your coach to reopen it/);
 await assert.rejects(()=>saveIntake(db,ids.ana,ids.ana,filled(ids.ana)),/has been submitted/);
 await assert.rejects(()=>as(db,ids.ana,async()=>db.query("update panda_records set data=data where kind='client_intake'")),/permission denied/);
 pass('Submitting needs every answer, confirmation and the consent tick; the server stamps the time and profile snapshot; the client then cannot write, through panda_save or directly');

 // 5. The coach reopens; the client can write and resubmit; it locks again. Active clients need the coach to open one.
 const reopened=copy(a);reopened.status='reopened';await saveIntake(db,ids.coach,ids.ana,reopened,'Reopened intake questionnaire');
 a=await intake(db,ids.ana);assert.equal(a.status,'reopened');assert.equal(a.submitted_at,firstSubmission);
 const edited=filled(ids.ana,'draft');edited.schedule.days_per_week=4;await saveIntake(db,ids.ana,ids.ana,edited);
 a=await intake(db,ids.ana);assert.equal(a.schedule.days_per_week,4);assert.equal(a.status,'reopened');
 await saveIntake(db,ids.ana,ids.ana,filled(ids.ana));
 a=await intake(db,ids.ana);assert.equal(a.status,'submitted');assert(Date.parse(a.submitted_at)>=Date.parse(firstSubmission));
 await assert.rejects(()=>saveIntake(db,ids.ana,ids.ana,filled(ids.ana,'draft')),/has been submitted/);
 await assert.rejects(()=>saveIntake(db,ids.cara,ids.cara,blank(ids.cara)),/is not open\. Ask your coach to reopen it/);
 await saveIntake(db,ids.coach,ids.cara,{...blank(ids.cara),status:'reopened'});
 await saveIntake(db,ids.cara,ids.cara,blank(ids.cara));assert.equal((await intake(db,ids.cara)).status,'reopened');
 await saveIntake(db,ids.cara,ids.cara,filled(ids.cara,'draft'));assert.equal((await intake(db,ids.cara)).status,'reopened');
 await saveIntake(db,ids.cara,ids.cara,filled(ids.cara));assert.equal((await intake(db,ids.cara)).status,'submitted');
 await assert.rejects(()=>saveIntake(db,ids.cara,ids.cara,filled(ids.cara,'draft')),/has been submitted/);
 pass('Coach sets an intake to reopened and the client can edit (it stays reopened while they save drafts) and resubmit, after which it locks again; an active client can only start an intake the coach has opened');

 // 6. Event labels never carry intake answers, whatever label the caller sends.
 const sentinel='SENTINEL-NITROGLYCERIN-7731';
 const secret=filled(ids.ben,'draft');secret.medical.medications=answer(true,sentinel);secret.other.notes=sentinel;
 await saveIntake(db,ids.ben,ids.ben,secret,'Medications: '+sentinel);
 const benProfile=await clientsRow(ids.ben);benProfile.weight=71;
 await save(db,ids.ben,[await change(db,'clients',ids.ben,benProfile),await change(db,'client_intake',ids.ben,{...secret,status:'draft'})],sentinel);
 await saveIntake(db,ids.coach,ids.ben,{...(await intake(db,ids.ben)),status:'reopened'},'Coach note: '+sentinel);
 for(const viewer of [ids.ben,ids.coach]){
  const labels=(await as(db,viewer,()=>db.query('select label from panda_events where owner_id=$1 order by id',[ids.ben]))).rows.map(r=>r.label);
  assert(labels.length>=4,'expected intake events for this client');
  assert(labels.every(l=>!l.includes(sentinel)),'an event label contains intake text');
  assert.deepEqual(labels.slice(-4),[LABEL,LABEL,LABEL,LABEL]);
 }
 assert.equal((await one(db,'select count(*)::int n from panda_events where label like $1',['%'+sentinel+'%'])).n,0);
 pass('Intake answers never reach panda_events: batches containing client_intake get the fixed label, even with a custom label or a clients change in the same batch, as client and as coach');

 // 7. A clients + client_intake batch saves atomically.
 const devProfile=await clientsRow(ids.dev);devProfile.weight=82;devProfile.goal='Run 10 km';
 await save(db,ids.dev,[await change(db,'clients',ids.dev,devProfile),await change(db,'client_intake',ids.dev,filled(ids.dev))],LABEL);
 assert.equal((await clientsRow(ids.dev)).weight,82);const d=await intake(db,ids.dev);assert.equal(d.status,'submitted');
 assert.equal(d.submitted_profile.weight,82);assert.equal(d.submitted_profile.goal,'Run 10 km');
 const eliBefore=await record(db,'clients',ids.eli),eliProfile=copy(eliBefore.data);eliProfile.weight=90;
 const badLift=filled(ids.eli,'draft');badLift.training.lifts.deadlift=lift({value:150});
 await assert.rejects(async()=>save(db,ids.eli,[await change(db,'clients',ids.eli,eliProfile),await change(db,'client_intake',ids.eli,badLift)]),/deadlift weight empty/);
 const coachOnly=copy(eliBefore.data);coachOnly.weight=90;coachOnly.training_days=5;
 await assert.rejects(async()=>save(db,ids.eli,[await change(db,'clients',ids.eli,coachOnly),await change(db,'client_intake',ids.eli,blank(ids.eli))]),/Only your coach can change/);
 assert.deepEqual(await record(db,'clients',ids.eli),eliBefore);assert.equal(await intake(db,ids.eli),undefined);
 pass('A clients + client_intake batch saves atomically: both records commit together (snapshot includes the new profile), and a failure in either record rolls back both');

 // 8. Lift and shape validation.
 const withLift=(o,status='draft')=>{const b=filled(ids.fay,status);b.training.lifts.squat=lift(o);return b;};
 const rejects=(data,re)=>assert.rejects(()=>saveIntake(db,ids.fay,ids.fay,data),re);
 await rejects(withLift({type:'unknown',value:100}),/squat weight empty when it is unknown/);
 await rejects(withLift({type:'unknown',estimated:true}),/unknown squat cannot be an estimate/);
 await rejects(withLift({type:'working_set',value:80,reps:null},'submitted'),/1–20 reps for the squat working set/);
 await rejects(withLift({type:'working_set',value:80,reps:25}),/1–20 reps/);
 await rejects(withLift({type:'working_set',value:80,reps:2.5}),/1–20 reps/);
 await rejects(withLift({type:'1rm',value:120,reps:5}),/Reps apply only to a squat working set/);
 await rejects(withLift({type:'unknown',reps:5}),/Reps apply only/);
 await rejects(withLift({type:'1rm',value:700}),/squat weight above 0 and up to 600 kg/);
 await rejects(withLift({type:'1rm',value:0}),/squat weight/);
 await rejects(withLift({type:'1rm',value:100,unit:'stone'}),/kg or lb/);
 await rejects(withLift({type:'max',value:100}),/Choose a squat type/);
 await rejects(withLift({type:'1rm',value:100,estimated:'yes'}),/estimate/);
 await rejects({...withLift({type:'1rm',value:100}),training:{...filled(ids.fay).training,lifts:{squat:lift(),bench_press:lift()}}},/Invalid lifts/);
 await saveIntake(db,ids.fay,ids.fay,withLift({type:'1rm',value:700,unit:'lb'}));
 await saveIntake(db,ids.fay,ids.fay,withLift({type:'working_set',value:80,reps:null}));
 const extra=blank(ids.fay);extra.surprise=true;await rejects(extra,/Invalid intake structure/);
 const missing=blank(ids.fay);delete missing.equipment;await rejects(missing,/Invalid intake structure/);
 const extraMed=blank(ids.fay);extraMed.medical.conditions.migraine=true;await rejects(extraMed,/Invalid medical conditions list/);
 const muscles=m=>{const b=blank(ids.fay);b.goals.focus_muscles=m;return b;};
 await rejects(muscles(['Chest','Back','Core','Glutes']),/up to 3/);await rejects(muscles(['Cardio']),/from the list/);await rejects(muscles(['Chest','Chest']),/different/);
 await rejects({...blank(ids.fay),form_version:2},/Unsupported intake form version/);
 pass('Lift validation: unknown rejects a weight, reps or estimate; a submitted working set needs 1–20 whole reps; 1RM rejects reps; kg/lb limits; the strict shape rejects unknown or missing keys and invalid focus muscles');

 // 9. health_flag is computed by the server; client input is ignored.
 const flagged=async mutate=>{const b=blank(ids.fay);mutate(b);await saveIntake(db,ids.fay,ids.fay,b);return (await intake(db,ids.fay)).health_flag;};
 assert.equal(await flagged(b=>{b.health_flag=true;}),false);
 for(const k of ['chest_pain','heart_disease','stroke','coronary_disease','light_headedness','pregnancy'])assert.equal(await flagged(b=>{b.medical.conditions[k]=true;b.health_flag=false;}),true,k);
 assert.equal(await flagged(b=>{b.medical.exercise_contraindications=answer(true,'');b.health_flag=false;}),true);
 assert.equal(await flagged(b=>{for(const k of CONDITIONS)b.medical.conditions[k]=!['chest_pain','heart_disease','stroke','coronary_disease','light_headedness','pregnancy'].includes(k);b.medical.exercise_contraindications=answer(false);}),false);
 assert.equal(await flagged(b=>{b.submitted_at='2020-01-01T00:00:00Z';b.submitted_profile={name:'Forged'};}),false);
 let f=await intake(db,ids.fay);assert.equal(f.submitted_at,null);assert.equal(f.submitted_profile,null);
 const coachFlag=blank(ids.fay);coachFlag.health_flag=true;await saveIntake(db,ids.coach,ids.fay,coachFlag);assert.equal((await intake(db,ids.fay)).health_flag,false);
 pass('health_flag is set by the server from chest pain, heart disease, stroke, coronary disease, light-headedness, pregnancy or a contraindication; values sent for it, submitted_at or submitted_profile are ignored');

 // 10. Intakes cannot be deleted through panda_save.
 await assert.rejects(async()=>save(db,ids.cara,[{kind:'client_intake',id:ids.cara,data:null,revision:(await record(db,'client_intake',ids.cara)).revision}]),/Referenced records cannot be deleted/);
 await assert.rejects(async()=>save(db,ids.coach,[{kind:'client_intake',id:ids.cara,data:null,revision:(await record(db,'client_intake',ids.cara)).revision}]),/Referenced records cannot be deleted/);
 assert(await intake(db,ids.cara));
 pass('Neither the client nor the coach can delete an intake through panda_save');

 // 11. Regression: 010's water-only guard still applies after 023.
 const activity=(rid,date,o)=>({kind:'activity',id:rid,data:{id:rid,client_id:ids.nut,date,water:1.5,steps:null,cardio:null,sleep:null,habits:{},notes:'',...o},revision:0});
 await save(db,ids.nut,[activity('act_nut_1',day())]);
 await assert.rejects(()=>save(db,ids.nut,[activity('act_nut_2',day(-1),{steps:5000})]),/Only water can be recorded with nutrition access/);
 pass('Migration 010 still applies after 023: a nutrition-only client records water, but not steps');

 // 12. Retention period is configurable in settings/brand and validated.
 const coachBrand=async value=>{const r=await record(db,'settings','brand');const data={...r.data};if(value===undefined)delete data.intake_retention_months;else data.intake_retention_months=value;return save(db,ids.coach,[{kind:'settings',id:'brand',data,revision:r.revision}],'Updated settings');};
 const months=async()=>(await one(db,'select panda_private.intake_retention_months() m')).m;
 assert.equal(await months(),24);
 for(const bad of [0,121,1.5,'24'])await assert.rejects(()=>coachBrand(bad),/Intake retention must be a whole number of months/);
 await coachBrand(36);assert.equal(await months(),36);
 await coachBrand(null);assert.equal(await months(),null);
 await coachBrand(30);
 pass('Intake retention is settings/brand.intake_retention_months (seeded 24): 1–120 whole months or empty for none; invalid values are rejected');

 // 13. Re-running 023 on a populated database changes nothing.
 const snapshot=async()=>JSON.stringify((await db.query("select kind,id,data,revision from panda_records where owner_id is not null or (kind='settings' and id='brand') order by kind,id")).rows);
 const before=await snapshot();await db.exec(text);assert.equal(await snapshot(),before);assert.equal(await months(),30);
 pass('Re-running migration 023 on a database with intakes leaves every client record and the coach\'s retention setting unchanged');
 await db.close();
}
module.exports={sql,helpers:{as,one,record,save,definition,plans,profile,coachAccount,install,blank,filled}};
