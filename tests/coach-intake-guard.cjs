// Migration 025: the coach may change only the status of a client_intake record (reopen it), or
// open an empty reopened intake for a client who has none. Called from verify.cjs; each check
// reports through pass().
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {helpers:{one,record,save,definition,plans,profile,coachAccount,install,blank,filled}}=require('./client-intake.cjs');
const MIGRATION='202611150025_coach_intake_status_only.sql',MARKER='-- Panda client intake: coach may change the status only (025).';
const id=n=>'00000000-0000-4000-9500-'+String(n).padStart(12,'0');
const ids={coach:'00000000-0000-4000-9000-000000000001',amy:id(1),bo:id(2),cy:id(3),di:id(4)};
const LABEL='Updated intake questionnaire';
const copy=x=>JSON.parse(JSON.stringify(x));

async function register(db,uid,p,status='onboarding'){
 await db.query('insert into auth.users(id) values($1)',[uid]);
 await db.query('select panda_register_client($1,$2,$3)',[uid,'client.'+uid.slice(-2),JSON.stringify(profile(uid,p,{status}))]);
 await db.query('update panda_accounts set must_change_password=false where user_id=$1',[uid]);
}
const intake=async(db,uid)=>(await record(db,'client_intake',uid))?.data;
// One coach write to an intake: the stored record changed by `edit`, at its current revision.
async function coachWrite(db,uid,edit){const r=await record(db,'client_intake',uid);const data=edit(r?copy(r.data):undefined);return save(db,ids.coach,[{kind:'client_intake',id:uid,data,revision:r?r.revision:0}],LABEL);}

async function sql({PGlite:PG=PGlite,bootstrap,migrations},pass){
 const text=migrations.find(([f])=>f===MIGRATION)?.[1];assert(text,'Migration 025 is missing');
 const upto=prefix=>migrations.filter(([f])=>f<prefix);

 // 1. Preflight: 025 needs 023 and 024, and changes nothing when either is missing.
 for(const [before,message] of [['202611130023',/Migration 023 \(client intake\) is not installed/],['202611140024',/Migration 024 \(client archive date\) is not installed/]]){
  const db=new PG();await db.exec(bootstrap);for(const [,t]of upto(before))await db.exec(t);
  const guard=before>'202611130023'?await definition(db,'panda_private.guard_client_intake()'):null;
  await assert.rejects(()=>db.exec(text),message);await db.exec('rollback');
  assert.equal((await one(db,"select to_regprocedure('panda_private.check_coach_intake(jsonb,jsonb)') f")).f,null);
  if(guard)assert.equal(await definition(db,'panda_private.guard_client_intake()'),guard);
  await db.close();
 }
 pass('Migration 025 stops before changing anything when migration 023 or 024 is not installed');

 // 2. Fresh install: the patch is in once, before the server fields are replaced; re-running changes nothing.
 const db=await install(PG,bootstrap,migrations);
 try{
 const guard=await definition(db,'panda_private.guard_client_intake()');
 assert.equal(guard.split(MARKER).length,2);
 assert(guard.indexOf(MARKER)<guard.indexOf(`new.data:=new.data-'submitted_at'-'submitted_profile'-'health_flag';`));
 assert(guard.includes('if auth.uid() is not null and not panda_private.coach() then'));
 await db.exec(text);assert.equal(await definition(db,'panda_private.guard_client_intake()'),guard);
 // Re-running 023 re-creates the guard without the patch; re-running 025 puts it back.
 await db.exec(migrations.find(([f])=>f.startsWith('202611130023'))[1]);assert(!(await definition(db,'panda_private.guard_client_intake()')).includes(MARKER));
 await db.exec(text);assert.equal(await definition(db,'panda_private.guard_client_intake()'),guard);
 pass('Migration 025 patches guard_client_intake() once, ahead of the server-field handling, keeps the 023 client rules, re-runs without changes, and restores its patch if 023 is re-run');

 // Clients: amy and bo submit while onboarding; cy is active with no intake; di is onboarding with a draft.
 await coachAccount(db);const full=await plans(db,'coaching');
 for(const uid of [ids.amy,ids.bo,ids.di])await register(db,uid,full);await register(db,ids.cy,full,'active');
 for(const uid of [ids.amy,ids.bo])await save(db,uid,[{kind:'client_intake',id:uid,data:filled(uid),revision:0}],LABEL);
 const draft=blank(ids.di);draft.personal.neck_cm=33;await save(db,ids.di,[{kind:'client_intake',id:ids.di,data:draft,revision:0}],LABEL);
 const amy=await record(db,'client_intake',ids.amy);assert.equal(amy.data.status,'submitted');assert(amy.data.submitted_at);

 // 3. The coach cannot change an answer, in any section, with or without a reopen in the same write.
 const answers=[
  ['about you',x=>{x.personal.waist_cm=90;}],
  ['health screening',x=>{x.medical.conditions.chest_pain=true;}],
  ['health screening',x=>{x.medical.medications={present:true,details:'Added by coach'};}],
  ['training background',x=>{x.training.experience_years=10;}],
  ['goals',x=>{x.goals.focus_muscles=['Chest'];}],
  ['schedule',x=>{x.schedule.days_per_week=6;}],
  ['gym and equipment',x=>{x.equipment.notes='Coach note';}],
  ['other notes',x=>{x.other.notes='Coach note';}],
  ['health information consent',x=>{x.consent.health_data=false;}],
  ['form version',x=>{x.form_version=2;}]];
 for(const [section,edit] of answers)for(const status of ['submitted','reopened'])
  await assert.rejects(()=>coachWrite(db,ids.amy,x=>{edit(x);x.status=status;return x;}),new RegExp(`The coach cannot change intake answers \\(${section}\\)\\. Reopen the intake so the client can update them\\.`),section+' / '+status);
 await assert.rejects(()=>coachWrite(db,ids.di,x=>{x.personal.neck_cm=40;x.status='reopened';return x;}),/cannot change intake answers \(about you\)/);
 await assert.rejects(()=>coachWrite(db,ids.amy,x=>({...x,surprise:true})),/Invalid intake structure/);
 await assert.rejects(()=>coachWrite(db,ids.di,x=>({...x,status:'submitted'})),/The coach can only reopen an intake\. Only the client can save or submit it\./);
 await assert.rejects(()=>coachWrite(db,ids.amy,x=>({...x,status:'draft'})),/can only reopen an intake/);
 assert.deepEqual(await record(db,'client_intake',ids.amy),amy);
 pass('The coach cannot change any intake answer (each section is named in the refusal), add a key, or set the status to draft or submitted; the intake is unchanged');

 // 4. The coach cannot forge the server-set fields, on an existing intake or a new one.
 const forged=[
  ['submission date \\(submitted_at\\)',x=>{x.submitted_at='2020-01-01T00:00:00Z';}],
  ['submission date \\(submitted_at\\)',x=>{x.submitted_at=null;}],
  ['submitted profile snapshot \\(submitted_profile\\)',x=>{x.submitted_profile={...x.submitted_profile,weight:55};}],
  ['submitted profile snapshot \\(submitted_profile\\)',x=>{x.submitted_profile=null;}],
  ['health flag \\(health_flag\\)',x=>{x.health_flag=true;}]];
 for(const [what,edit] of forged)await assert.rejects(()=>coachWrite(db,ids.amy,x=>{edit(x);x.status='reopened';return x;}),new RegExp('The coach cannot change the '+what));
 const fresh=o=>coachWrite(db,ids.cy,()=>({...blank(ids.cy),status:'reopened',...o}));
 await assert.rejects(()=>fresh({submitted_at:'2020-01-01T00:00:00Z'}),/The coach cannot set the submission date \(submitted_at\)/);
 await assert.rejects(()=>fresh({submitted_profile:{name:'Forged'}}),/The coach cannot set the submitted profile snapshot \(submitted_profile\)/);
 await assert.rejects(()=>fresh({health_flag:true}),/The coach cannot set the health flag \(health_flag\)/);
 assert.deepEqual(await record(db,'client_intake',ids.amy),amy);assert.equal(await intake(db,ids.cy),undefined);
 pass('The coach cannot forge submitted_at, submitted_profile or health_flag (changed or cleared), on an existing intake or a new one, and each refusal names the field');

 // 5. The coach can still reopen: only the status changes, and the server fields are kept.
 await coachWrite(db,ids.amy,x=>({...x,status:'reopened'}));
 let r=await record(db,'client_intake',ids.amy);
 assert.deepEqual({...r.data,status:'submitted'},amy.data);assert.equal(r.revision,amy.revision+1);
 // Leaving the server fields out is not a change either; a draft can be reopened; reopened again is a no-op save.
 const bo=await record(db,'client_intake',ids.bo);
 await coachWrite(db,ids.bo,x=>{delete x.submitted_at;delete x.submitted_profile;delete x.health_flag;return {...x,status:'reopened'};});
 r=await record(db,'client_intake',ids.bo);assert.deepEqual({...r.data,status:'submitted'},bo.data);
 await coachWrite(db,ids.di,x=>({...x,status:'reopened'}));assert.equal((await intake(db,ids.di)).status,'reopened');
 await coachWrite(db,ids.di,x=>x);assert.equal((await intake(db,ids.di)).status,'reopened');
 // The client can then edit and resubmit, as before.
 const edited=filled(ids.amy,'draft');edited.schedule.days_per_week=5;await save(db,ids.amy,[{kind:'client_intake',id:ids.amy,data:edited,revision:(await record(db,'client_intake',ids.amy)).revision}],LABEL);
 assert.equal((await intake(db,ids.amy)).schedule.days_per_week,5);assert.equal((await intake(db,ids.amy)).status,'reopened');
 await save(db,ids.amy,[{kind:'client_intake',id:ids.amy,data:filled(ids.amy),revision:(await record(db,'client_intake',ids.amy)).revision}],LABEL);
 assert.equal((await intake(db,ids.amy)).status,'submitted');
 pass('The coach can still reopen a submitted intake or a draft (only the status changes; answers, submitted_at, the snapshot and the flag are kept), and the client can then edit and resubmit');

 // 6. The coach can open an intake for a client who has none, empty and reopened only.
 await assert.rejects(()=>fresh({status:'draft'}),/The coach can only create an intake as reopened, for the client to fill in\./);
 await assert.rejects(()=>fresh({status:'submitted'}),/can only create an intake as reopened/);
 for(const edit of [x=>{x.personal.neck_cm=35;},x=>{x.medical.conditions.pregnancy=false;},x=>{x.training.lifts.squat.unit='lb';},x=>{x.consent.health_data=true;},x=>{x.goals.focus_muscles=['Back'];}]){
  const b={...blank(ids.cy),status:'reopened'};edit(b);
  await assert.rejects(()=>coachWrite(db,ids.cy,()=>b),/The coach cannot fill in intake answers\. Open an empty intake for the client to complete\./);
 }
 assert.equal(await intake(db,ids.cy),undefined);
 await fresh({});
 const c=await intake(db,ids.cy);assert.equal(c.status,'reopened');assert.equal(c.submitted_at,null);assert.equal(c.submitted_profile,null);assert.equal(c.health_flag,false);
 const mine=blank(ids.cy);mine.personal.neck_cm=36;await save(db,ids.cy,[{kind:'client_intake',id:ids.cy,data:mine,revision:(await record(db,'client_intake',ids.cy)).revision}],LABEL);
 assert.equal((await intake(db,ids.cy)).personal.neck_cm,36);
 pass('The coach can open an empty reopened intake for a client who has none (any answer, or another status, is refused), and the client can then fill it in');
 }finally{await db.close();}
}
module.exports={sql};
