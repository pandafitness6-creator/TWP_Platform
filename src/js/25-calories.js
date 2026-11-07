/* Coach calorie + macro planning. Screenshot reference: 30 y, 76 kg, 180 cm,
   male, light, -20%, protein 2 g/kg, fat 1 g/kg -> 1914 kcal, 152/76/156 g. */
window.PandaCalories=(()=>{
 const activityRows=[['Sedentary',1.2,'Mostly seated · little exercise'],['Light',1.375,'Light · some walking / 1–3 sessions'],['Moderate',1.55,'Moderate · regular movement / 3–5 sessions'],['High',1.725,'High · active days / 6–7 sessions'],['Very high',1.9,'Very high · physical work + training']];
 function activity(value){const key=String(value||'').trim().toLowerCase();const aliases={'sedentary':1.2,'mostly seated':1.2,'light':1.375,'lightly active':1.375,'light activity':1.375,'moderate':1.55,'moderately active':1.55,'moderate activity':1.55,'high':1.725,'very active':1.725,'high activity':1.725,'very high':1.9,'extremely active':1.9,'very high activity':1.9};return aliases[key]??'';}
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 function calculate(d){
  for(const k of ['weight','height','age','coefficient','activity','adjust','protein_factor','fat_factor'])assert(d[k]!=null&&String(d[k]).trim()!==''&&Number.isFinite(Number(d[k])),'Complete all calculation fields.');
  const base=PandaCoaching.calculate(d),pf=Number(d.protein_factor),ff=Number(d.fat_factor);
  assert(pf>=.5&&pf<=3.5&&ff>=.3&&ff<=2,'Check protein (0.5–3.5 g/kg) and fat (0.3–2 g/kg).');
  const goals={loss:-20,maintain:0,gain:10};assert(Object.hasOwn(goals,d.goal)||d.goal==='custom','Choose a goal.');
  assert(d.goal==='custom'||Number(d.adjust)===goals[d.goal],'The goal and adjustment do not match. Select Custom to change the percentage.');
  const hasOverride=d.target_override!=null&&String(d.target_override).trim()!=='';
  const target=hasOverride?Number(d.target_override):base.target;
  assert(Number.isInteger(target)&&target>=1200&&target<=10000,'Enter a whole calorie target from 1,200 to 10,000, or leave it blank.');
  const protein=Math.round(Number(d.weight)*pf),fat=Math.round(Number(d.weight)*ff),remaining=target-protein*4-fat*9;
  assert(remaining>=0,'Protein and fat exceed the calorie target. Reduce the multipliers or revise the target.');
  const carbs=Math.round(remaining/4);
  return {...base,estimated:base.target,target,protein,fat,carbs,macroCalories:protein*4+fat*9+carbs*4,input:{...base.input,goal:d.goal,protein_factor:pf,fat_factor:ff,target_override:hasOverride?target:null}};
 }
 function snapshot(result){return {method:'Mifflin–St Jeor',calculated_at:new Date().toISOString(),inputs:structuredClone(result.input),resting:result.resting,maintenance:result.maintenance,estimated:result.estimated,targets:{calories:result.target,protein:result.protein,carbs:result.carbs,fat:result.fat}};}
 function updatePlan(plan,result){plan.targets={...plan.targets,calories:result.target,protein:result.protein,carbs:result.carbs,fat:result.fat};plan.calorie_calculation=snapshot(result);}
 return {activityRows,activity,calculate,snapshot,updatePlan};
})();
