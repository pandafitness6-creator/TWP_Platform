/* Client intake questionnaire (INTAKE-DESIGN.md): the client's six-step form, its read-only view
   and the rules that decide when it shows. The value rules mirror validate_client_intake
   (migration 023), which re-checks every save; messages name the question, never the answer. */
(function(){'use strict';
const U=window.PandaUI,{esc:e,icon,field,area,select}=U;
const ar=()=>window.PandaExperience?.get().language==='ar',tr=(en,arabic)=>ar()?arabic:en;
const CONDITIONS=[['arthritis','Arthritis'],['back_pain','Back pain'],['knee_pain','Knee pain'],['shin_splints','Shin splints'],['muscle_pain','Muscle pain'],['foot_pain','Foot pain'],['light_headedness','Light-headedness or dizziness'],['chest_pain','Chest pain'],['epilepsy','Epilepsy'],['diabetes','Diabetes'],['high_cholesterol','High cholesterol'],['smoking','Smoking'],['high_triglycerides','High triglycerides'],['respiratory_disease','Asthma, emphysema or bronchitis'],['high_blood_pressure','High blood pressure'],['coronary_disease','Coronary disease'],['heart_disease','Heart disease'],['stroke','Stroke'],['pregnancy','Pregnancy'],['family_coronary_before_55','Family history of heart disease before 55']];
const FLAGGED=['chest_pain','heart_disease','stroke','coronary_disease','light_headedness','pregnancy'];
const DISCLOSURES=[['injuries_past_5_years','Injuries in the past 5 years','Include injuries that have healed.'],['ongoing_aches','Ongoing aches or pains','Anything that bothers you regularly, during or outside training.'],['exercise_contraindications','Exercise restrictions from a doctor','Has a doctor or physiotherapist told you to avoid any exercise or movement?'],['medications','Regular medication','Medication that may affect training, such as for blood pressure or blood sugar.']];
const LIFTS=[['squat','Squat'],['bench_press','Bench press'],['deadlift','Deadlift']];
const LIFT_TYPES=[['unknown','I don’t know'],['1rm','One-rep max'],['working_set','Recent working set']];
const EQUIPMENT=[['barbells','Barbells'],['dumbbells','Dumbbells'],['squat_racks','Squat racks'],['benches','Benches'],['cable_machines','Cable machines'],['smith_machine','Smith machine'],['leg_press','Leg press'],['glute_ham_raise','Glute-ham raise'],['back_raise_45','45° back raise'],['cardio_equipment','Cardio equipment']];
const MUSCLES=['Chest','Back','Shoulders','Biceps','Triceps','Forearms','Core','Glutes','Quads','Hamstrings','Calves'];
const SEXES=['Male','Female','Not specified'];
const STEPS=[['about','About you'],['health','Health screening'],['training','Training background'],['goals','Your goals'],['schedule','Your schedule'],['gym','Your gym']];
const PROFILE=['name','sex','age','height','weight','goal'];
const LABEL='Updated intake questionnaire';
const clone=structuredClone,label=(list,key)=>list.find(x=>x[0]===key)?.[1]||key;

// --- Record -------------------------------------------------------------------------------------
function blank(uid){
 const answer=()=>({present:null,details:''}),lift=()=>({type:'unknown',value:null,unit:'kg',reps:null,estimated:false});
 return {id:uid,form_version:1,status:'draft',submitted_at:null,submitted_profile:null,health_flag:false,
  personal:{neck_cm:null,waist_cm:null},
  medical:{conditions:Object.fromEntries(CONDITIONS.map(([k])=>[k,null])),conditions_confirmed:null,...Object.fromEntries(DISCLOSURES.map(([k])=>[k,answer()]))},
  training:{experience_years:null,lifts:Object.fromEntries(LIFTS.map(([k])=>[k,lift()]))},
  goals:{focus_muscles:[]},schedule:{days_per_week:null,minutes_per_session:null},
  equipment:{items:Object.fromEntries(EQUIPMENT.map(([k])=>[k,{available:null,details:''}])),notes:''},
  other:{notes:''},consent:{health_data:null}};
}
const find=(state,uid)=>(state.client_intake||[]).find(x=>x.id===uid);
const flag=x=>FLAGGED.some(k=>x.medical.conditions[k]===true)||x.medical.exercise_contraindications.present===true;

// Who may write it now: the same window the database enforces (guard_client_intake).
function open(x,profile){return x?.status==='reopened'||(profile?.status==='onboarding'&&(!x||x.status==='draft'));}
// Shown automatically (from Home) while onboarding and not yet submitted.
function due(state,profile){if(!profile||profile.status!=='onboarding')return false;const x=find(state,profile.id);return !x||['draft','reopened'].includes(x.status);}
function attention(state,profile){
 const x=find(state,profile.id);
 if(x?.status==='reopened')return {id:'intake',kind:'action',icon:'list',title:'Update your intake questionnaire',detail:'Your coach reopened it for changes.',cta:'Open intake',route:'intake'};
 if(!due(state,profile))return null;
 return {id:'intake',kind:x?'draft':'action',icon:'list',title:x?'Finish your intake questionnaire':'Complete your intake questionnaire',detail:'Your coach uses it to plan your training safely.',cta:x?'Continue intake':'Start intake',route:'intake'};
}

// --- Completeness -------------------------------------------------------------------------------
// Questions still unanswered in one step, by name. Step 4 (focus muscles) is optional.
function missing(i,x,p){
 const out=[];
 if(i===0){
  if(!String(p.name||'').trim())out.push('Full name');if(!SEXES.includes(p.sex))out.push('Gender');
  for(const [k,t] of [['age','Age'],['height','Height'],['weight','Weight']])if(typeof p[k]!=='number')out.push(t);
  if(!String(p.goal||'').trim())out.push('Training goals');
  if(x.personal.neck_cm==null)out.push('Neck measurement');if(x.personal.waist_cm==null)out.push('Waist measurement');
 }
 if(i===1){
  if(CONDITIONS.some(([k])=>x.medical.conditions[k]==null))out.push('Medical conditions list');
  if(x.medical.conditions_confirmed!==true)out.push('Confirm the medical conditions list');
  for(const [k,t] of DISCLOSURES){const a=x.medical[k];if(a.present==null)out.push(t);else if(a.present&&!a.details.trim())out.push('Details for '+t.toLowerCase());}
 }
 if(i===2){
  if(x.training.experience_years==null)out.push('Years of training experience');
  for(const [k,t] of LIFTS){const l=x.training.lifts[k];if(l.type!=='unknown'&&l.value==null)out.push(t+' weight');if(l.type==='working_set'&&l.reps==null)out.push(t+' reps');}
 }
 if(i===4){if(x.schedule.days_per_week==null)out.push('Training days per week');if(x.schedule.minutes_per_session==null)out.push('Minutes per session');}
 if(i===5){
  if(EQUIPMENT.some(([k])=>x.equipment.items[k].available==null))out.push('Equipment you can use');
  if(x.consent.health_data!==true)out.push('Health information consent');
 }
 return out;
}
const complete=(i,x,p)=>i===3?x.goals.focus_muscles.length>0:!missing(i,x,p).length;
// Everything the database requires before it accepts a submission, with its step number.
function problems(x,p){return STEPS.flatMap((_,i)=>missing(i,x,p).map(m=>({step:i,label:m})));}
function problemText(list){
 const shown=list.slice(0,4).map(m=>tr(m.label+' (step '+(m.step+1)+')',translate(m.label)+' (الخطوة '+(m.step+1)+')')).join(', ');
 return tr('Before you submit, answer: ','قبل الإرسال، أجب عن: ')+shown+(list.length>4?tr(' and '+(list.length-4)+' more.',' و'+(list.length-4)+' أخرى.'):'.');
}
// Resume: the first step with unanswered questions (the optional step 4 is never "unfinished").
function resumeStep(x,p){const r=x||blank(p.id);const i=STEPS.findIndex((_,n)=>n!==3&&missing(n,r,p).length);return i<0?5:i;}

// --- Reading a step ------------------------------------------------------------------------------
const value=(f,name)=>{const el=f.elements.namedItem(name);return el?String(el.value??'').trim():'';};
const checked=(f,name)=>!!f.elements.namedItem(name)?.checked;
const yes=(f,name)=>({yes:true,no:false})[value(f,name)]??null;
const onStep=(v,step)=>{const k=v/step;return Math.abs(k-Math.round(k))<1e-9;};
function number(f,name,lo,hi,step,message,required=false){
 const raw=value(f,name);if(raw===''){if(required)throw Error(message);return null;}
 const v=Number(raw);if(!Number.isFinite(v)||v<lo||v>hi||!onStep(v,step))throw Error(message);return v;
}
function text(f,name,max,message){const v=value(f,name);if(v.length>max)throw Error(message);return v;}
// Returns the record with this step's answers, and the six profile fields for step 1.
function read(f,i,current,p){
 const x=clone(current||blank(p.id));x.status=x.status==='reopened'?'reopened':'draft';
 let profile=null;
 if(i===0){
  const name=text(f,'name',80,'Enter your full name (up to 80 characters).');if(!name)throw Error('Enter your full name (up to 80 characters).');
  const sex=value(f,'sex');if(!SEXES.includes(sex))throw Error('Choose your gender.');
  profile={name,sex,
   age:number(f,'age',16,100,1,'Enter your age as a whole number from 16 to 100.',true),
   height:number(f,'height',100,250,0.1,'Enter a height of 100–250 cm.',true),
   weight:number(f,'weight',20,400,0.1,'Enter a weight of 20–400 kg.',true),
   goal:text(f,'goal',500,'Keep your training goals to 500 characters.')};
  x.personal.neck_cm=number(f,'neck_cm',20,80,0.1,'Enter a neck measurement of 20–80 cm, to one decimal place.');
  x.personal.waist_cm=number(f,'waist_cm',40,250,0.1,'Enter a waist measurement of 40–250 cm, to one decimal place.');
 }
 if(i===1){
  const confirmed=checked(f,'conditions_confirmed');
  for(const [k] of CONDITIONS)x.medical.conditions[k]=checked(f,'condition.'+k)?true:confirmed?false:null;
  x.medical.conditions_confirmed=confirmed?true:null;
  for(const [k,t] of DISCLOSURES)x.medical[k]={present:yes(f,k+'.present'),details:text(f,k+'.details',2000,'Keep the details for '+t.toLowerCase()+' to 2,000 characters.')};
 }
 if(i===2){
  x.training.experience_years=number(f,'experience_years',0,80,0.5,'Enter your training experience as 0–80 years, in half years.');
  for(const [k,t] of LIFTS){
   const type=value(f,k+'.type'),unit=value(f,k+'.unit');
   if(!LIFT_TYPES.some(([v])=>v===type))throw Error('Choose what your '+t.toLowerCase()+' weight is.');
   if(!['kg','lb'].includes(unit))throw Error('Choose kg or lb for your '+t.toLowerCase()+'.');
   const max=unit==='kg'?600:1300,l={type,value:null,unit,reps:null,estimated:false};
   if(type!=='unknown'){l.value=number(f,k+'.value',0.01,max,0.01,'Enter a '+t.toLowerCase()+' weight above 0 and up to '+max+' '+unit+'.');l.estimated=checked(f,k+'.estimated');}
   if(type==='working_set')l.reps=number(f,k+'.reps',1,20,1,'Enter 1–20 reps for your '+t.toLowerCase()+' working set.');
   x.training.lifts[k]=l;
  }
 }
 if(i===3){
  const picked=[...f.querySelectorAll('[name="focus_muscles"]:checked')].map(el=>el.value);
  if(picked.length>3)throw Error('Choose up to 3 focus muscle groups.');
  x.goals.focus_muscles=MUSCLES.filter(m=>picked.includes(m));
 }
 if(i===4){
  x.schedule.days_per_week=number(f,'days_per_week',1,7,1,'Choose 1–7 training days per week.');
  x.schedule.minutes_per_session=number(f,'minutes_per_session',10,240,1,'Enter 10–240 minutes per session, in whole minutes.');
 }
 if(i===5){
  for(const [k,t] of EQUIPMENT)x.equipment.items[k]={available:yes(f,'equipment.'+k),details:text(f,'equipment.'+k+'.details',300,'Keep the details for '+t.toLowerCase()+' to 300 characters.')};
  x.equipment.notes=text(f,'equipment_notes',2000,'Keep your gym notes to 2,000 characters.');
  x.other.notes=text(f,'other_notes',4000,'Keep your other notes to 4,000 characters.');
  x.consent.health_data=checked(f,'consent')?true:null;
 }
 return {intake:x,profile};
}
// Local demo only: the database sets these itself and ignores what a browser sends.
function stampLocal(x,p){x.submitted_at=new Date().toISOString();x.submitted_profile=Object.fromEntries(PROFILE.map(k=>[k,p[k]]));x.health_flag=flag(x);}

// --- Form ---------------------------------------------------------------------------------------
const group=(legend,body,hint='')=>`<fieldset class="checkin-section intake-group"><legend>${e(legend)}</legend>${hint?`<p class="caption">${e(hint)}</p>`:''}${body}</fieldset>`;
const grid=body=>`<div class="intake-grid">${body}</div>`;
const n=v=>v==null?'':v;
const yesNo=(name,legend,v,hint='')=>`<fieldset class="intake-question"><legend>${e(legend)}</legend>${hint?`<p class="caption">${e(hint)}</p>`:''}<div class="intake-yesno">${[['yes','Yes',true],['no','No',false]].map(([val,t,b])=>`<label class="check-label"><input type="radio" name="${e(name)}" value="${val}" ${v===b?'checked':''}>${t}</label>`).join('')}</div></fieldset>`;
const radios=(name,label,v)=>`<div class="intake-yesno" role="radiogroup" aria-label="${e(label)}">${[['yes','Yes',true],['no','No',false]].map(([val,t,b])=>`<label class="check-label"><input type="radio" name="${e(name)}" value="${val}" ${v===b?'checked':''}>${t}</label>`).join('')}</div>`;
const box=(name,text,on,extra='')=>`<label class="check-label"><input type="checkbox" name="${e(name)}" ${on?'checked':''} ${extra}>${e(text)}</label>`;
function stepBody(i,x,p){
 if(i===0)return group('Your details',grid(field('Full name','name',p.name||'','text','required maxlength="80" autocomplete="name"')+select('Gender','sex',SEXES.includes(p.sex)?p.sex:'Not specified',SEXES.map(s=>[s,s]))+field('Age','age',n(p.age),'number','required min="16" max="100" step="1" inputmode="numeric"')+field('Height · cm','height',n(p.height),'number','required min="100" max="250" step="0.1" inputmode="decimal"')+field('Current weight · kg','weight',n(p.weight),'number','required min="20" max="400" step="0.1" inputmode="decimal"')),'Your coach set these up with you. Correct anything that has changed.')
  +group('Training goals',area('What would you like to achieve?','goal',p.goal||'','maxlength="500"'))
  +group('Measurements',grid(field('Neck · cm','neck_cm',n(x.personal.neck_cm),'number','min="20" max="80" step="0.1" inputmode="decimal"')+field('Waist · cm','waist_cm',n(x.personal.waist_cm),'number','min="40" max="250" step="0.1" inputmode="decimal"')),'Measure the neck just below the Adam’s apple and the waist at the navel, relaxed.');
 if(i===1)return group('Medical conditions',`<div class="intake-choices">${CONDITIONS.map(([k,t])=>box('condition.'+k,t,x.medical.conditions[k]===true)).join('')}</div>`+box('conditions_confirmed','I have read the whole list. Anything I have not ticked does not apply to me.',x.medical.conditions_confirmed===true),'Tick every condition that applies to you now or has applied in the past.')
  +`<div class="notice with-icon">${icon('info')}<p>${e('If you have chest pain, dizziness or a heart condition, check with your doctor before you start a new training plan.')}</p></div>`
  +DISCLOSURES.map(([k,t,hint])=>group(t,radios(k+'.present',t,x.medical[k].present)+area('Details · required if yes',k+'.details',x.medical[k].details,'maxlength="2000"'),hint)).join('');
 if(i===2)return group('Experience',field('Years of training experience','experience_years',n(x.training.experience_years),'number','min="0" max="80" step="0.5" inputmode="decimal"'),'Count the years you have trained regularly, in half years. Enter 0 if you are new to training.')
  +LIFTS.map(([k,t])=>{const l=x.training.lifts[k],off=l.type==='unknown';return group(t,`<div class="intake-lift" data-intake-lift="${k}">${select('What is this weight?',k+'.type',l.type,LIFT_TYPES,'data-intake-lift-type')}${field('Weight',k+'.value',n(l.value),'number',`min="0.01" max="1300" step="0.01" inputmode="decimal" ${off?'disabled':''}`)}${select('Unit',k+'.unit',l.unit,[['kg','kg'],['lb','lb']],off?'disabled':'')}<div data-intake-reps ${l.type==='working_set'?'':'hidden'}>${field('Reps',k+'.reps',n(l.reps),'number','min="1" max="20" step="1" inputmode="numeric"')}</div>${box(k+'.estimated','This is an estimate',l.estimated,off?'disabled':'')}</div>`,'A one-rep max is the most you can lift once. A working set is a recent heavy set: enter the weight and the reps.');}).join('');
 if(i===3)return group('Focus muscle groups',`<div class="intake-choices" data-intake-muscles>${MUSCLES.map(m=>box('focus_muscles',m,x.goals.focus_muscles.includes(m),`value="${m}" ${x.goals.focus_muscles.length>=3&&!x.goals.focus_muscles.includes(m)?'disabled':''}`)).join('')}</div>`,'Choose up to 3 muscle groups you would most like to develop. This step is optional.');
 if(i===4)return group('Your availability',grid(select('Training days per week','days_per_week',n(x.schedule.days_per_week),[['','Choose'],...[1,2,3,4,5,6,7].map(d=>[d,String(d)])])+field('Minutes per session','minutes_per_session',n(x.schedule.minutes_per_session),'number','min="10" max="240" step="1" inputmode="numeric"')),'How often and how long you can realistically train. Your coach sets your plan from this.');
 return group('Equipment',`<div class="intake-equipment">${EQUIPMENT.map(([k,t])=>{const it=x.equipment.items[k];return `<div class="intake-equipment-item">${yesNo('equipment.'+k,t,it.available)}${field('Details · optional','equipment.'+k+'.details',it.details,'text','maxlength="300"')}</div>`;}).join('')}</div>`,'Tell your coach what you can use where you train. Add details such as “dumbbells up to 30 kg”.')
  +group('Notes',area('Where you train and anything not listed','equipment_notes',x.equipment.notes,'maxlength="2000"')+area('Anything else your coach should know','other_notes',x.other.notes,'maxlength="4000"'))
  +group('Consent',box('consent','I agree that my coach may store and use this health information to plan my coaching.',x.consent.health_data===true));
}
function form(x,p,i){
 const r=x||blank(p.id),done=STEPS.map((_,n)=>complete(n,r,p)),count=done.filter(Boolean).length,last=i===STEPS.length-1;
 const steps=`<nav class="tabs intake-steps" aria-label="${e(tr('Intake steps','خطوات الاستبيان'))}">${STEPS.map(([,t],n)=>`<button type="button" class="tab ${n===i?'active':''}" data-action="intake-step" data-step="${n}" ${n===i?'aria-current="step"':''}>${done[n]?icon('check'):`<span class="intake-step-number">${n+1}</span>`}<span>${e(t)}</span></button>`).join('')}</nav>`;
 const progress=`<div class="checkin-progress"><div class="between"><strong>${e(tr('Step '+(i+1)+' of 6 · '+STEPS[i][1],'الخطوة '+(i+1)+' من 6 · '+translate(STEPS[i][1])))}</strong><span class="caption">${e(tr(count+' of 6 steps complete',count+' من 6 خطوات مكتملة'))}</span></div><progress max="6" value="${count}" aria-label="${e(tr('Intake steps completed','الخطوات المكتملة'))}" aria-valuetext="${e(tr(count+' of 6 steps complete',count+' من 6 خطوات مكتملة'))}"></progress></div>`;
 const outstanding=last?problems(r,p):[];
 const ready=last?(outstanding.length?`<div class="notice with-icon intake-outstanding">${icon('list')}<div><p>${e(tr('Still to answer before you can submit:','ما زال عليك الإجابة قبل الإرسال:'))}</p><ul>${outstanding.map(m=>`<li><button type="button" class="text-link" data-action="intake-step" data-step="${m.step}">${e(m.label)}</button> <span class="caption">· ${e(STEPS[m.step][1])}</span></li>`).join('')}</ul><p class="caption">${e('This list shows your saved answers. Save this step to update it.')}</p></div></div>`:`<div class="notice with-icon">${icon('check')}<p>${e('Everything required is answered. Submit when you are ready.')}</p></div>`):'';
 const buttons=`<div class="form-actions intake-actions">${i>0?`<button type="button" class="btn" data-action="intake-nav" data-step="${i-1}">${icon('back')} ${e('Previous step')}</button>`:''}${i>=3&&!last?`<button type="button" class="btn" data-action="intake-nav" data-step="${i+1}">${e('Skip for now')}</button>`:''}<button type="button" class="btn" data-action="intake-save">${e('Save draft')}</button>${last?`<button type="button" class="btn primary" data-action="intake-submit">${icon('check')} ${e('Submit intake')}</button>`:`<button type="submit" class="btn primary">${e('Save and continue')} ${icon('arrow')}</button>`}</div>`;
 return `<div class="intake" data-intake>${progress}${steps}<section class="panel intake-panel"><div class="panel-head"><h2>${e(STEPS[i][1])}</h2>${i>=3?`<span class="caption">${e(i===5?'Optional until you submit':'Optional for now')}</span>`:''}</div><form data-form="intake" data-step="${i}" novalidate><p class="form-save-state" data-save-state role="status">${e(x?(x.status==='reopened'?'Your coach reopened your intake. Save each step, then submit again.':'Your saved answers are shown.'):'Your answers are kept when you save a step.')}</p>${stepBody(i,r,p)}${ready}<p class="form-error" role="alert"></p>${buttons}</form></section></div>`;
}

// --- Read-only view -----------------------------------------------------------------------------
const rows=items=>`<dl class="info-grid">${items.map(([a,b])=>`<div><dt>${e(a)}</dt><dd>${e(b==null||b===''?'Not answered':b)}</dd></div>`).join('')}</dl>`;
const yn=v=>v===true?'Yes':v===false?'No':null;
function liftText(l){if(l.type==='unknown')return 'Not known';const w=l.value==null?'?':l.value+' '+l.unit;return (l.type==='1rm'?'One-rep max · '+w:'Working set · '+w+' × '+(l.reps??'?'))+(l.estimated?' (estimate)':'');}
function summary(x,p){
 const snap=x.submitted_profile||p,ticked=CONDITIONS.filter(([k])=>x.medical.conditions[k]===true).map(([,t])=>t);
 return [
  ['About you',rows([['Full name',snap.name],['Gender',snap.sex],['Age',snap.age],['Height',snap.height==null?null:snap.height+' cm'],['Weight',snap.weight==null?null:snap.weight+' kg'],['Training goals',snap.goal],['Neck',x.personal.neck_cm==null?null:x.personal.neck_cm+' cm'],['Waist',x.personal.waist_cm==null?null:x.personal.waist_cm+' cm']])],
  ['Health screening',rows([['Medical conditions',ticked.length?ticked.join(', '):x.medical.conditions_confirmed?'None of the listed conditions':null],...DISCLOSURES.map(([k,t])=>[t,x.medical[k].present==null?null:yn(x.medical[k].present)+(x.medical[k].details?' · '+x.medical[k].details:'')])])],
  ['Training background',rows([['Years of training experience',x.training.experience_years],...LIFTS.map(([k,t])=>[t,liftText(x.training.lifts[k])])])],
  ['Your goals',rows([['Focus muscle groups',x.goals.focus_muscles.join(', ')||'None chosen']])],
  ['Your schedule',rows([['Training days per week',x.schedule.days_per_week],['Minutes per session',x.schedule.minutes_per_session]])],
  ['Your gym',rows([...EQUIPMENT.map(([k,t])=>[t,x.equipment.items[k].available==null?null:yn(x.equipment.items[k].available)+(x.equipment.items[k].details?' · '+x.equipment.items[k].details:'')]),['Notes',x.equipment.notes],['Anything else',x.other.notes],['Health information consent',x.consent.health_data?'Agreed':null]])]
 ].map(([t,b])=>`<section class="panel intake-summary"><div class="panel-head"><h2>${e(t)}</h2></div>${b}</section>`).join('');
}
function readOnly(x,p,preview){
 const when=x?.submitted_at?U.date(x.submitted_at.slice(0,10)):'';
 const message=preview?'Preview only. The client fills in the intake questionnaire from their own account.'
  :x?.status==='submitted'?'Your intake questionnaire has been submitted'+(when?' on '+when:'')+'. It is now read-only. If anything changes, ask your coach to reopen it so you can update your answers.'
  :'Your intake questionnaire is not open. Ask your coach to reopen it if you need to add or change answers.';
 return `<div class="notice with-icon intake-locked">${icon(preview?'shield':x?.status==='submitted'?'check':'info')}<p>${e(message)}</p></div>${x?`<div class="intake-summaries section">${summary(x,p)}</div>`:''}`;
}
// Profile page status line.
function status(x,p){if(!x)return open(x,p)?'Not started':'Not requested';return x.status==='submitted'?'Submitted'+(x.submitted_at?' on '+U.date(x.submitted_at.slice(0,10)):''):x.status==='reopened'?'Reopened by your coach':'Draft saved';}

// Lift fields follow the chosen type; at most three focus muscles can be ticked.
function sync(el){
 const lift=el.closest?.('[data-intake-lift]');
 if(lift&&el.matches('[data-intake-lift-type]')){const k=lift.dataset.intakeLift,type=el.value,off=type==='unknown';for(const name of [k+'.value',k+'.unit',k+'.estimated']){const input=lift.querySelector(`[name="${name}"]`);if(input)input.disabled=off;}const reps=lift.querySelector('[data-intake-reps]');if(reps)reps.hidden=type!=='working_set';window.PandaSelects?.enhance(lift);}
 const muscles=el.closest?.('[data-intake-muscles]');
 if(muscles){const boxes=[...muscles.querySelectorAll('[name="focus_muscles"]')],count=boxes.filter(b=>b.checked).length;boxes.forEach(b=>{b.disabled=count>=3&&!b.checked;});}
}
const translate=s=>window.PandaI18n?.translate?window.PandaI18n.translate(s):s;

window.PandaIntake={STEPS,CONDITIONS,EQUIPMENT,LIFTS,MUSCLES,LABEL,blank,find,open,due,attention,missing,complete,problems,problemText,resumeStep,read,stampLocal,form,readOnly,status,sync,flag};

(dictionary=>{for(const [k,v] of Object.entries(dictionary))if(!Object.hasOwn(window.PandaI18n.dictionary,k))window.PandaI18n.dictionary[k]=v;})({"About you":"معلومات عنك","Health screening":"الفحص الصحي","Training background":"الخلفية التدريبية","Your goals":"أهدافك","Your schedule":"جدولك","Your gym":"صالتك الرياضية","Your details":"بياناتك","Your coach set these up with you. Correct anything that has changed.":"أعدّ مدربك هذه البيانات معك. صحّح أي شيء تغيّر.","Full name":"الاسم الكامل","Gender":"الجنس","Age":"العمر","Height · cm":"الطول · سم","Current weight · kg":"الوزن الحالي · كغ","Training goals":"أهداف التدريب","What would you like to achieve?":"ماذا تريد أن تحقق؟","Measurements":"القياسات","Neck · cm":"الرقبة · سم","Waist · cm":"الخصر · سم","Measure the neck just below the Adam’s apple and the waist at the navel, relaxed.":"قِس الرقبة أسفل تفاحة آدم مباشرة، والخصر عند السرة وأنت مسترخٍ.","Medical conditions":"الحالات الصحية","Tick every condition that applies to you now or has applied in the past.":"ضع علامة على كل حالة تنطبق عليك الآن أو انطبقت عليك سابقاً.","I have read the whole list. Anything I have not ticked does not apply to me.":"قرأت القائمة كاملة. ما لم أضع عليه علامة لا ينطبق عليّ.","If you have chest pain, dizziness or a heart condition, check with your doctor before you start a new training plan.":"إذا كنت تعاني من ألم في الصدر أو دوار أو حالة في القلب، فاستشر طبيبك قبل بدء خطة تدريب جديدة.","Arthritis":"التهاب المفاصل","Back pain":"ألم الظهر","Knee pain":"ألم الركبة","Shin splints":"آلام عظم الساق","Muscle pain":"ألم العضلات","Foot pain":"ألم القدم","Light-headedness or dizziness":"الدوخة أو الدوار","Chest pain":"ألم الصدر","Epilepsy":"الصرع","Diabetes":"السكري","High cholesterol":"ارتفاع الكوليسترول","Smoking":"التدخين","High triglycerides":"ارتفاع الدهون الثلاثية","Asthma, emphysema or bronchitis":"الربو أو انتفاخ الرئة أو التهاب الشعب الهوائية","High blood pressure":"ارتفاع ضغط الدم","Coronary disease":"مرض الشريان التاجي","Heart disease":"أمراض القلب","Stroke":"السكتة الدماغية","Pregnancy":"الحمل","Family history of heart disease before 55":"تاريخ عائلي لأمراض القلب قبل سن 55","Injuries in the past 5 years":"إصابات خلال السنوات الخمس الماضية","Include injuries that have healed.":"اذكر الإصابات التي شُفيت أيضاً.","Ongoing aches or pains":"آلام أو أوجاع مستمرة","Anything that bothers you regularly, during or outside training.":"أي شيء يزعجك بانتظام أثناء التدريب أو خارجه.","Exercise restrictions from a doctor":"قيود على التمارين من الطبيب","Has a doctor or physiotherapist told you to avoid any exercise or movement?":"هل نصحك طبيب أو أخصائي علاج طبيعي بتجنب أي تمرين أو حركة؟","Regular medication":"الأدوية المنتظمة","Medication that may affect training, such as for blood pressure or blood sugar.":"الأدوية التي قد تؤثر في التدريب، مثل أدوية ضغط الدم أو سكر الدم.","Details · required if yes":"التفاصيل · مطلوبة عند الإجابة بنعم","Experience":"الخبرة","Years of training experience":"سنوات الخبرة في التدريب","Count the years you have trained regularly, in half years. Enter 0 if you are new to training.":"احسب السنوات التي تدربت فيها بانتظام، بأنصاف السنوات. أدخل 0 إذا كنت جديداً على التدريب.","Squat":"السكوات","Bench press":"ضغط البنش","Deadlift":"الرفعة الميتة","What is this weight?":"ما هذا الوزن؟","I don’t know":"لا أعرف","One-rep max":"أقصى وزن لتكرار واحد","Recent working set":"مجموعة عمل حديثة","Weight":"الوزن","Unit":"الوحدة","Reps":"التكرارات","This is an estimate":"هذا تقدير","A one-rep max is the most you can lift once. A working set is a recent heavy set: enter the weight and the reps.":"أقصى وزن لتكرار واحد هو أثقل وزن يمكنك رفعه مرة واحدة. مجموعة العمل هي مجموعة ثقيلة حديثة: أدخل الوزن والتكرارات.","Focus muscle groups":"المجموعات العضلية المستهدفة","Choose up to 3 muscle groups you would most like to develop. This step is optional.":"اختر حتى 3 مجموعات عضلية تود تطويرها أكثر. هذه الخطوة اختيارية.","Your availability":"أوقاتك المتاحة","Training days per week":"أيام التدريب أسبوعياً","Minutes per session":"الدقائق في كل جلسة","Choose":"اختر","How often and how long you can realistically train. Your coach sets your plan from this.":"كم مرة وكم من الوقت يمكنك التدريب فعلياً. يبني مدربك خطتك على ذلك.","Equipment":"المعدات","Tell your coach what you can use where you train. Add details such as “dumbbells up to 30 kg”.":"أخبر مدربك بما يمكنك استخدامه حيث تتدرب. أضف تفاصيل مثل «دمبل حتى 30 كغ».","Details · optional":"التفاصيل · اختياري","Barbells":"البار الحديدي","Dumbbells":"الدمبل","Squat racks":"حوامل السكوات","Benches":"المقاعد","Cable machines":"أجهزة الكابل","Smith machine":"جهاز سميث","Leg press":"جهاز دفع الأرجل","Glute-ham raise":"جهاز رفع الألوية والخلفية","45° back raise":"جهاز تمديد الظهر 45°","Cardio equipment":"أجهزة الكارديو","Notes":"ملاحظات","Where you train and anything not listed":"مكان تدريبك وأي شيء غير مذكور","Anything else your coach should know":"أي شيء آخر يجب أن يعرفه مدربك","Consent":"الموافقة","I agree that my coach may store and use this health information to plan my coaching.":"أوافق على أن يحفظ مدربي هذه المعلومات الصحية ويستخدمها لتخطيط تدريبي.","Previous step":"الخطوة السابقة","Skip for now":"تخطَّ الآن","Save draft":"حفظ المسودة","Save and continue":"حفظ ومتابعة","Submit intake":"إرسال الاستبيان","Optional for now":"اختياري حالياً","Optional until you submit":"اختياري حتى الإرسال","Your saved answers are shown.":"تظهر إجاباتك المحفوظة.","Your answers are kept when you save a step.":"تُحفظ إجاباتك عند حفظ كل خطوة.","Your coach reopened your intake. Save each step, then submit again.":"أعاد مدربك فتح الاستبيان. احفظ كل خطوة ثم أرسله مجدداً.","This list shows your saved answers. Save this step to update it.":"تعرض هذه القائمة إجاباتك المحفوظة. احفظ هذه الخطوة لتحديثها.","Everything required is answered. Submit when you are ready.":"تمت الإجابة عن كل ما هو مطلوب. أرسل عندما تكون جاهزاً.","Your intake questionnaire":"استبيان البداية","Intake questionnaire":"استبيان البداية","Tell your coach about your health, training and routine. Save each step as you go.":"أخبر مدربك عن صحتك وتدريبك وروتينك. احفظ كل خطوة أثناء تقدمك.","Not answered":"لم تتم الإجابة","Not known":"غير معروف","None of the listed conditions":"لا شيء من الحالات المذكورة","None chosen":"لم يتم الاختيار","Agreed":"تمت الموافقة","Anything else":"أي شيء آخر","Neck":"الرقبة","Waist":"الخصر","Preview only. The client fills in the intake questionnaire from their own account.":"معاينة فقط. يملأ العميل استبيان البداية من حسابه.","Your intake questionnaire is not open. Ask your coach to reopen it if you need to add or change answers.":"استبيان البداية غير مفتوح. اطلب من مدربك إعادة فتحه إذا احتجت إلى إضافة إجابات أو تغييرها.","Not started":"لم يبدأ","Not requested":"غير مطلوب","Draft saved":"تم حفظ المسودة","Reopened by your coach":"أعاد مدربك فتحه","Update your intake questionnaire":"حدّث استبيان البداية","Your coach reopened it for changes.":"أعاد مدربك فتحه لإجراء تغييرات.","Open intake":"فتح الاستبيان","Finish your intake questionnaire":"أكمل استبيان البداية","Complete your intake questionnaire":"املأ استبيان البداية","Your coach uses it to plan your training safely.":"يستخدمه مدربك لتخطيط تدريبك بأمان.","Continue intake":"متابعة الاستبيان","Start intake":"بدء الاستبيان","Open intake questionnaire":"فتح استبيان البداية","View your answers":"عرض إجاباتك","Open a client view":"افتح عرض العميل","Clients fill in the intake questionnaire from their own account.":"يملأ العملاء استبيان البداية من حساباتهم.","Your intake is not open. Ask your coach to reopen it.":"الاستبيان غير مفتوح. اطلب من مدربك إعادة فتحه.","Previous step":"الخطوة السابقة","Draft saved.":"تم حفظ المسودة.","No new changes to save.":"لا توجد تغييرات جديدة للحفظ.","Intake submitted. Your coach will review it.":"تم إرسال الاستبيان. سيراجعه مدربك.","Medical conditions list":"قائمة الحالات الصحية","Confirm the medical conditions list":"أكّد قائمة الحالات الصحية","Neck measurement":"قياس الرقبة","Waist measurement":"قياس الخصر","Equipment you can use":"المعدات التي يمكنك استخدامها","Health information consent":"الموافقة على المعلومات الصحية","Enter your full name (up to 80 characters).":"أدخل اسمك الكامل (حتى 80 حرفاً).","Choose your gender.":"اختر جنسك.","Enter your age as a whole number from 16 to 100.":"أدخل عمرك رقماً صحيحاً من 16 إلى 100.","Enter a height of 100–250 cm.":"أدخل طولاً بين 100 و250 سم.","Enter a weight of 20–400 kg.":"أدخل وزناً بين 20 و400 كغ.","Keep your training goals to 500 characters.":"اجعل أهداف تدريبك في حدود 500 حرف.","Enter a neck measurement of 20–80 cm, to one decimal place.":"أدخل قياس الرقبة بين 20 و80 سم بمنزلة عشرية واحدة.","Enter a waist measurement of 40–250 cm, to one decimal place.":"أدخل قياس الخصر بين 40 و250 سم بمنزلة عشرية واحدة.","Enter your training experience as 0–80 years, in half years.":"أدخل خبرتك التدريبية من 0 إلى 80 سنة، بأنصاف السنوات.","Choose up to 3 focus muscle groups.":"اختر حتى 3 مجموعات عضلية مستهدفة.","Choose 1–7 training days per week.":"اختر من 1 إلى 7 أيام تدريب أسبوعياً.","Enter 10–240 minutes per session, in whole minutes.":"أدخل من 10 إلى 240 دقيقة لكل جلسة، بدقائق كاملة.","Keep your gym notes to 2,000 characters.":"اجعل ملاحظات صالتك في حدود 2,000 حرف.","Keep your other notes to 4,000 characters.":"اجعل ملاحظاتك الأخرى في حدود 4,000 حرف.","Submit your intake questionnaire? You can’t change it afterwards unless your coach reopens it.":"هل تريد إرسال استبيان البداية؟ لا يمكنك تغييره بعد ذلك إلا إذا أعاد مدربك فتحه.","Leave this step without saving? Choose Cancel, then Save draft to keep your answers.":"هل تريد مغادرة هذه الخطوة دون حفظ؟ اختر إلغاء، ثم حفظ المسودة للاحتفاظ بإجاباتك."});
})();
