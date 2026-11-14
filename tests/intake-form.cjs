// Client intake form (25-intake.js), driven through the assembled page signed in as a client,
// against PGlite with every migration, so RLS, panda_save and the intake trigger all apply.
// Called from verify.cjs; each check reports through pass().
const assert=require('node:assert/strict');
const {browser:{portal,until,tick}}=require('./access-expiry.cjs');
const {helpers:{as,one,record,save,plans,profile,coachAccount,install,blank,filled}}=require('./client-intake.cjs');
const {backend}=require('./intake-restore.cjs');
const id=n=>'00000000-0000-4000-9300-'+String(n).padStart(12,'0');
const ids={kai:id(1),lia:id(2),max:id(3)};
const LABEL='Updated intake questionnaire';

async function register(db,uid,key,p,extra={},mustChange=false){
 await db.query('insert into auth.users(id) values($1)',[uid]);
 await db.query('select panda_register_client($1,$2,$3)',[uid,'client.'+key,JSON.stringify(profile(uid,p,{name:key[0].toUpperCase()+key.slice(1)+' Client',...extra}))]);
 if(!mustChange)await db.query('update panda_accounts set must_change_password=false where user_id=$1',[uid]);
}
// A browser signed in as one client. Every REST path requested is kept in `paths`.
async function open(html,db,uid,login){
 const t=portal(html),saves=[],paths=[],route=backend(db,saves,uid);await tick(150);
 t.w.fetch=async(url,options={})=>{const u=new URL(url),body=options.body?JSON.parse(options.body):undefined;paths.push(u.pathname);const [status,data]=await route(u.pathname+u.search,body);return {ok:status<300,status,text:async()=>data===undefined?'':JSON.stringify(data)};};
 await until(()=>t.w.document.querySelector('[data-auth-form="login"]'),'login form');
 const f=t.w.document.querySelector('[data-auth-form="login"]');f.querySelector('[name="username"]').value=login;f.querySelector('[name="password"]').value='correct-password';
 f.dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true}));
 const d=t.w.document,form=()=>d.querySelector('[data-form="intake"]'),el=name=>form().elements.namedItem(name);
 const fire=(node,...types)=>types.forEach(type=>node.dispatchEvent(new t.w.Event(type,{bubbles:true})));
 return Object.assign(t,{saves,paths,d,form,
  step:()=>form()?Number(form().dataset.step):null,
  error:()=>form()?.querySelector('.form-error')?.textContent||'',
  set(name,value){const node=el(name);node.value=value;fire(node,'input','change');},
  tick(name,on=true){const node=form().querySelector(`[name="${name}"]`);node.checked=on;fire(node,'input','change');},
  pick(name,value){const node=form().querySelector(`[name="${name}"][value="${value}"]`);node.checked=true;fire(node,'input','change');},
  box(name,value){const node=form().querySelector(`[name="${name}"][value="${value}"]`);node.checked=true;fire(node,'input','change');},
  click(selector){d.querySelector(selector).click();},
  next(){form().querySelector('[type="submit"]').click();}});
}
const intakeRow=async(db,uid)=>(await record(db,'client_intake',uid))?.data;
const clientRow=async(db,uid)=>(await record(db,'clients',uid)).data;

async function ui({PGlite,bootstrap,migrations},html,pass){
 const db=await install(PGlite,bootstrap,migrations);
 await coachAccount(db);const full=await plans(db,'coaching');
 await register(db,ids.kai,'kai',full);await register(db,ids.lia,'lia',full);await register(db,ids.max,'max',full,{},true);
 const windows=[];
 try{
 // 1. First sign-in after the password change: Home opens the intake at step 1, pre-filled.
 let t=await open(html,db,ids.kai,'client.kai');windows.push(t);
 await until(()=>t.form()&&t.w.location.hash==='#/intake','intake after sign-in');
 assert.equal(t.step(),0);assert.equal(t.form().elements.namedItem('name').value,'Kai Client');assert.equal(t.form().elements.namedItem('goal').value,'Strength');
 assert.equal(t.d.querySelectorAll('.intake-steps .tab').length,6);assert.match(t.d.querySelector('.intake-steps .tab.active').textContent,/About you/);
 assert(!t.paths.some(p=>p==='/rest/v1/rpc/panda_save'));
 pass('An onboarding client with no intake lands on the intake (step 1 of 6) after signing in, with the profile fields pre-filled');

 // 2. Save draft on step 1: one panda_save batch, clients first, then the intake; the step stays open.
 t.set('neck_cm','36.5');t.set('waist_cm','81');t.set('goal','Run 10 km and get stronger');t.set('weight','72.5');
 t.click('[data-action="intake-save"]');await until(()=>t.saves.length===1&&t.form()&&!t.form().querySelector('[data-save-state][data-state="dirty"]'),'step 1 draft');
 assert.deepEqual(t.saves[0].map(c=>c.kind),['clients','client_intake']);
 let x=await intakeRow(db,ids.kai);assert.equal(x.status,'draft');assert.equal(x.personal.neck_cm,36.5);assert.equal(x.personal.waist_cm,81);
 let c=await clientRow(db,ids.kai);assert.equal(c.goal,'Run 10 km and get stronger');assert.equal(c.weight,72.5);
 assert.deepEqual((await db.query('select distinct label from panda_events where owner_id=$1',[ids.kai])).rows.map(r=>r.label),[LABEL]);
 assert.equal(t.step(),0);
 // Unchanged step: "Save and continue" moves on without another save.
 t.next();await until(()=>t.step()===1,'step 2');assert.equal(t.saves.length,1);
 pass('Save draft on a step sends one atomic batch (clients, then client_intake) with the fixed event label; continuing without changes saves nothing');

 // 3. Step 2 saved with "Save and continue": only the intake changes.
 t.tick('condition.back_pain');t.tick('conditions_confirmed');
 t.pick('injuries_past_5_years.present','yes');t.set('injuries_past_5_years.details','Sprained ankle in 2023, recovered');
 for(const k of ['ongoing_aches','exercise_contraindications','medications'])t.pick(k+'.present','no');
 t.next();await until(()=>t.step()===2,'step 3');
 assert.deepEqual(t.saves[1].map(c=>c.kind),['client_intake']);
 x=await intakeRow(db,ids.kai);assert.equal(x.medical.conditions.back_pain,true);assert.equal(x.medical.conditions.arthritis,false);assert.equal(x.medical.conditions_confirmed,true);assert.equal(x.medical.injuries_past_5_years.present,true);
 pass('Save and continue on step 2 saves only the intake and opens step 3; unticked conditions are saved as "no" once the list is confirmed');

 // 4. Resume: a new sign-in opens the first unfinished step with the saved answers.
 t.close();windows.length=0;
 t=await open(html,db,ids.kai,'client.kai');windows.push(t);
 await until(()=>t.form(),'intake on return');assert.equal(t.step(),2);assert.match(t.d.querySelector('.intake-steps .tab.active').textContent,/Training background/);
 assert.equal(t.d.querySelectorAll('.intake-steps .tab .icon').length,2);
 pass('Returning to the intake resumes at the first unfinished step (step 3), with steps 1 and 2 marked complete');

 // 5. Field-level validation names the question, never the answer, and nothing is sent.
 t.set('experience_years','2.5');t.set('squat.type','1rm');t.set('squat.value','100');t.tick('squat.estimated');
 t.set('bench_press.type','working_set');t.set('bench_press.value','60');t.set('bench_press.reps','25');
 const sent=t.saves.length;t.click('[data-action="intake-save"]');await until(()=>t.error(),'reps error');
 assert.equal(t.error(),'Enter 1–20 reps for your bench press working set.');assert(!t.error().includes('25'));assert.equal(t.saves.length,sent);
 t.set('bench_press.reps','8');t.next();await until(()=>t.step()===3,'step 4');
 x=await intakeRow(db,ids.kai);
 assert.deepEqual(x.training.lifts.squat,{type:'1rm',value:100,unit:'kg',reps:null,estimated:true});
 assert.deepEqual(x.training.lifts.bench_press,{type:'working_set',value:60,unit:'kg',reps:8,estimated:false});
 assert.deepEqual(x.training.lifts.deadlift,{type:'unknown',value:null,unit:'kg',reps:null,estimated:false});
 pass('Invalid answers are refused in the browser with a message that names the question (not the value); valid lifts save in the agreed shape');

 // 6. Steps 4–6 can be skipped; submit is blocked until everything required, including consent, is answered.
 t.box('focus_muscles','Glutes');t.box('focus_muscles','Back');t.next();await until(()=>t.step()===4,'step 5');
 t.click('[data-action="intake-nav"][data-step="5"]');await until(()=>t.step()===5,'skip to step 6');
 for(const k of ['barbells','dumbbells','squat_racks','benches','cable_machines','smith_machine','glute_ham_raise','back_raise_45','cardio_equipment'])t.pick('equipment.'+k,'yes');
 t.pick('equipment.leg_press','no');t.set('equipment.dumbbells.details','Up to 30 kg');
 t.click('[data-action="intake-save"]');await until(()=>!t.form().querySelector('[data-save-state][data-state="dirty"]')&&t.d.querySelector('.intake-outstanding'),'step 6 draft');
 let before=t.saves.length;
 t.click('[data-action="intake-submit"]');await until(()=>t.error(),'submit blocked');
 assert.equal(t.error(),'Before you submit, answer: Training days per week (step 5), Minutes per session (step 5), Health information consent (step 6).');
 assert.equal(t.saves.length,before);assert.equal((await intakeRow(db,ids.kai)).status,'draft');
 t.click('.intake-outstanding [data-action="intake-step"][data-step="4"]');await until(()=>t.step()===4,'back to schedule');
 t.set('days_per_week','3');t.set('minutes_per_session','60');t.next();await until(()=>t.step()===5,'gym again');
 before=t.saves.length;t.click('[data-action="intake-submit"]');await until(()=>t.error(),'consent required');
 assert.equal(t.error(),'Before you submit, answer: Health information consent (step 6).');
 assert.equal(t.saves.length,before);assert.equal((await intakeRow(db,ids.kai)).status,'draft');
 pass('Steps 4–6 can be skipped and finished later; Submit is blocked in the browser, with nothing sent, until consent (and the rest of what the database requires) is answered');

 // 7. Submit, then read-only.
 t.tick('consent');t.click('[data-action="intake-submit"]');await until(()=>t.d.querySelector('.intake-locked'),'read-only after submit');
 x=await intakeRow(db,ids.kai);assert.equal(x.status,'submitted');assert(x.submitted_at);assert.equal(x.submitted_profile.goal,'Run 10 km and get stronger');assert.equal(x.submitted_profile.weight,72.5);assert.equal(x.consent.health_data,true);assert.equal(x.health_flag,false);
 assert.match(t.d.querySelector('.intake-locked').textContent,/has been submitted.*ask your coach to reopen it/is);
 assert.equal(t.form(),null);assert.equal(t.d.querySelectorAll('.intake-summary').length,6);assert.equal(t.d.querySelector('[data-action="intake-save"]'),null);
 t.w.location.hash='#/dashboard';await tick(80);assert.equal(t.w.location.hash,'#/dashboard');
 t.w.location.hash='#/profile';await until(()=>/Submitted on/.test(t.d.querySelector('#main').textContent),'profile status');
 assert.deepEqual(t.errors,[]);
 pass('Submitting stores the intake as submitted (server-stamped snapshot); the page becomes read-only and explains that the coach can reopen it; Home no longer redirects');

 // 8. Atomic: when the intake part is refused, the profile change in the same batch is rolled back.
 t.close();windows.length=0;
 await save(db,ids.lia,[{kind:'client_intake',id:ids.lia,data:blank(ids.lia),revision:0}],LABEL);
 t=await open(html,db,ids.lia,'client.lia');windows.push(t);await until(()=>t.form()&&t.step()===0,'lia intake');
 // Behind the page's back the intake is submitted (same revision), so the client may no longer write it.
 await db.query("update panda_records set data=$1 where kind='client_intake' and id=$2",[JSON.stringify(filled(ids.lia)),ids.lia]);
 t.set('name','Lia Renamed');t.set('neck_cm','34');const sentBefore=t.saves.length;
 t.click('[data-action="intake-save"]');await until(()=>t.error(),'refused batch');
 assert.equal(t.saves.length,sentBefore+1);assert.deepEqual(t.saves.at(-1).map(c=>c.kind),['clients','client_intake']);
 assert.match(t.error(),/Your intake has been submitted\. Ask your coach to reopen it\./);
 assert.equal((await clientRow(db,ids.lia)).name,'Lia Client');assert.equal((await intakeRow(db,ids.lia)).status,'submitted');
 assert.deepEqual(t.errors,[]);
 pass('The profile fields and the intake save atomically: when the database refuses the intake, the profile change in the same batch is not saved either');

 // 9. Not before the password change: no records load and no intake shows.
 t.close();windows.length=0;
 t=await open(html,db,ids.max,'client.max');windows.push(t);
 await until(()=>t.d.querySelector('[data-auth-form="password"]'),'password change form');await tick(80);
 assert.equal(t.form(),null);assert(!t.paths.includes('/rest/v1/panda_records'));assert.deepEqual(t.errors,[]);
 pass('A client who must still change their password sees the password form, not the intake (no records are loaded)');
 }finally{for(const w of windows)w.close();await db.close();}
}
module.exports={ui};
