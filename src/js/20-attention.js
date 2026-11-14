
/* Derived next steps. No task store, synthetic deadlines or changes to client data. */
(function(){'use strict';
function derive(state,today){
 const client=state.clients.find(c=>c.id===state.preferences.client_id),pack=state.packages.find(p=>p.id===client?.package_id),has=key=>key==='library'||!!pack?.features.includes(key),items=[];
 if(state.preferences.role==='coach'){
  // Health screening flags come first: these clients need medical clearance before a plan is written (25-intake.js).
  if(window.PandaIntake)state.clients.filter(c=>c.status!=='archived').forEach(c=>{const item=PandaIntake.healthItem(state,c);if(item)items.push(item);});
  state.checkins.filter(c=>c.status==='submitted').sort((a,b)=>a.week.localeCompare(b.week)).forEach(c=>items.push({id:'review:'+c.id,kind:'action',icon:'checkins',title:'Review '+(state.clients.find(x=>x.id===c.client_id)?.name||'client')+'’s check-in',detail:'Week of '+c.week,cta:'Open review',action:'review',data:{id:c.id}}));
  // Clients who can still be active but whose access ends within 7 days or has ended, in each client's own timezone.
  const expiry=window.PandaCloud?.expiry;if(expiry)state.clients.filter(c=>c.access_expires_on&&['active','onboarding'].includes(c.status)).map(c=>[c,expiry.daysUntil(c.access_expires_on,expiry.validZone(c.timezone)?c.timezone:expiry.defaultZone(state.brand))]).filter(([,d])=>d<=7).sort((a,b)=>a[1]-b[1]).forEach(([c,d])=>items.push({id:'access:'+c.id,kind:'action',icon:'clock',title:(d<0?'Access ended for ':'Access ending soon for ')+c.name,detail:d<0?'Expired after '+c.access_expires_on+' · renew or archive':d===0?'Last day of access is today':'Access ends in '+d+(d===1?' day':' days')+' · '+c.access_expires_on,cta:'Renew access',action:'client-edit',data:{id:c.id}}));
  for(const type of ['programs','nutrition_plans'])state[type].filter(p=>p.status==='draft').forEach(p=>items.push({id:'draft:'+p.id,kind:'draft',icon:'edit',title:'Finish '+p.name,detail:type==='programs'?(p.plan_type==='cardio'?'Cardio plan · unpublished draft':'Training plan · unpublished draft'):'Nutrition plan · unpublished draft',cta:'Continue editing',action:'plan-edit',data:{id:p.id,type}}));
  return {items,checkin:null,next:items[0]||{kind:'reference',icon:'user',title:'Your clients, in one place',detail:'Review profiles and assigned plans.',cta:'View clients',route:'clients'}};
 }
 const thisWeek=PandaServices.weekStart(today),record=state.checkins.find(x=>x.client_id===client.id&&PandaServices.weekStart(x.week)===thisWeek),draft=state.drafts[client.id],weekday=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].indexOf(PandaCoaching.weekday(client.checkin_day)),due=weekday<0?null:(()=>{const date=new Date(thisWeek+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+weekday);return date.toISOString().slice(0,10);})();
 let checkin=has('checkins')?record?{kind:record.status==='reviewed'?'complete':'waiting',label:record.status==='reviewed'?'Coach reviewed':'Sent to your coach',icon:record.status==='reviewed'?'check':'clock',detail:record.status==='reviewed'?'Your feedback is available in Weekly check-in.':'Your coach’s review is pending.'}:draft&&Object.keys(draft).length?{kind:'draft',label:'Draft saved',icon:'edit',detail:'Pick up where you left off.'}:due&&today>=due&&today>=client.start_date?{kind:'action',label:'Check-in due',icon:'checkins',detail:today===due?'Your weekly check-in is due today.':'Complete this week’s check-in.'}:{kind:'reference',label:due?'Next check-in · '+PandaCoaching.weekday(client.checkin_day):'Weekly check-in',icon:'clock',detail:due?'Due '+due:'Your coach will confirm the schedule.'}:null;
 // The intake questionnaire comes first while it is due or reopened (25-intake.js).
 const intake=['active','onboarding'].includes(client.status)&&window.PandaIntake?.attention(state,client);if(intake)items.push(intake);
 if(['active','onboarding'].includes(client.status)){
  const remaining=['profile','guidelines','plans'].filter(key=>!client.onboarding[key]);
  if(remaining.length)items.push({id:'onboarding',kind:'action',icon:'list',title:'Complete your setup',detail:remaining.length+' confirmations left in your coaching roadmap.',cta:'Continue setup',route:'roadmap'});
  if(checkin&&['draft','action'].includes(checkin.kind))items.push({id:'checkin',kind:checkin.kind,icon:checkin.icon,title:checkin.kind==='draft'?'Finish your weekly check-in':'Your weekly check-in is due',detail:checkin.detail,cta:checkin.kind==='draft'?'Continue check-in':'Complete check-in',route:'checkins'});
 }else if(checkin&&!record)checkin={kind:'reference',label:'Coaching '+client.status,icon:'info',detail:'Your coach can confirm your next steps.'};
 const training=state.programs.find(p=>p.id===client.program_id),nutrition=state.nutrition_plans.find(p=>p.id===client.nutrition_id);
 const reference=has('training')&&training?.status==='published'?{kind:'reference',icon:'workouts',title:'Your training plan is ready',detail:training.sessions.length+' sessions · '+training.name,cta:'Open training plan',route:'training'}:has('nutrition')&&nutrition?.status==='published'?{kind:'reference',icon:'nutrition',title:'Your nutrition plan is ready',detail:nutrition.name,cta:'Open nutrition plan',route:'nutrition'}:{kind:'reference',icon:'library',title:'Explore your exercise guides',detail:'Technique, setup and movement references.',cta:'Open exercise library',route:'library'};
 return {items,checkin,next:items[0]||reference};
}
window.PandaAttention={derive};
})();
