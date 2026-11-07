
/* Anatomical raster and traced regions adapted from the user-supplied Atlas Workout Log 2.7.1.
   One shared SVG coordinate system preserves alignment at every size. */
(function(){'use strict';
const profile={height:516,front:161,back:439,
    frontParts:[
      ['traps','upper','M3 69 Q13 80 43 90 L23 97 Q10 90 3 69Z'],
      ['shoulders','front','M38 93 Q62 83 69 101 L72 125 Q62 111 51 106Z'],
      ['chest','upper','M3 102 Q15 94 38 97 L50 109 Q27 105 3 113Z'],
      ['chest','lower','M3 115 Q31 105 50 111 Q50 129 28 138 Q7 143 3 133Z'],
      ['biceps','front','M57 122 Q75 139 76 169 L71 180 Q57 172 52 139Z'],
      ['forearms','outer','M79 174 Q91 185 93 210 L96 236 L90 239 Q85 215 78 196Z'],
      ['forearms','inner','M72 181 Q76 205 86 224 L89 240 L83 240 Q71 221 65 204Z'],
      ['core','side','M27 144 Q39 144 43 137 Q44 166 33 188 L27 217 L15 230 Q22 205 23 169Z'],
      ['core','rectus','M2 141 Q12 140 22 148 L21 163 Q11 157 2 158Z M2 161 Q12 157 21 164 L20 179 L2 179Z M2 182 L20 182 L18 196 L2 196Z M2 199 L18 199 Q16 229 2 236Z'],
      ['quads','outer','M41 222 Q58 252 54 294 L46 324 Q40 315 40 291 Q43 261 36 246Z'],
      ['quads','middle','M32 236 Q43 268 36 303 L29 332 Q23 319 26 292Z'],
      ['quads','inner','M19 271 Q22 306 29 330 Q24 347 17 341 Q10 321 15 295Z']
    ],
    backParts:[
      ['traps','upper','M2 47 Q16 70 45 89 Q28 91 19 111 L2 137Z'],
      ['traps','lower','M2 140 L20 112 L25 114 Q18 146 2 166Z'],
      ['shoulders','rear','M46 90 Q66 88 73 104 L73 124 Q62 110 51 106Z'],
      ['back','upper','M26 106 Q43 105 52 122 Q42 132 26 128Z'],
      ['back','lat','M25 131 Q43 132 53 122 Q49 153 28 177 L5 199 L3 170Z'],
      ['back','lower','M3 201 L27 176 Q26 193 39 206 Q20 206 3 223Z'],
      ['triceps','rear','M55 122 Q70 127 73 158 L77 176 Q67 180 61 157 L51 140Z'],
      ['forearms','outer','M79 173 Q89 182 90 209 L94 237 L88 239 Q82 214 77 194Z'],
      ['forearms','inner','M73 182 Q77 204 83 223 L87 240 L81 240 Q70 218 65 201Z'],
      ['glutes','upper','M8 224 Q28 203 42 215 L46 233 Q26 224 8 237Z'],
      ['glutes','main','M6 238 Q29 213 45 234 Q50 250 48 268 Q25 267 7 258Z'],
      ['hamstrings','outer','M47 270 Q59 298 52 328 L43 349 Q40 326 42 306Z'],
      ['hamstrings','inner','M10 265 Q23 270 38 269 Q37 300 28 329 L22 347 Q14 329 15 303Z'],
      ['calves','outer','M41 354 Q53 370 54 390 Q52 407 44 412 Q37 402 37 385Z'],
      ['calves','inner','M27 351 Q34 367 35 385 Q35 402 27 410 Q20 406 20 390 Q20 370 27 351Z'],
      ['calves','soleus','M19 399 Q22 415 28 417 L32 454 L25 455Z M54 398 Q54 425 44 453 L38 454 L43 418Z']
    ]};
const groups=Object.freeze({traps:'Back',shoulders:'Shoulders',chest:'Chest',biceps:'Biceps',triceps:'Triceps',forearms:'Forearms',core:'Core',quads:'Quads',back:'Back',glutes:'Glutes',hamstrings:'Hamstrings',calves:'Calves'});
const views=Object.freeze({both:'Both sides',front:'Front',back:'Back'});
const {esc,asset}=PandaUI;
function figure(selected='',view='both',counts={}){
 view=Object.hasOwn(views,view)?view:'both';
 const box=view==='front'?`38 0 244 ${profile.height}`:view==='back'?`318 0 244 ${profile.height}`:`0 0 600 ${profile.height}`;
 let regions='';
 for(const side of ['front','back']){
  if(view!=='both'&&view!==side)continue;
  const parts=profile[side+'Parts'];
  for(const key of new Set(parts.map(part=>part[0]))){
   const group=groups[key],active=selected===group,label=(key==='traps'?'Trapezius · Back':group)+' · '+views[side]+' · '+(counts[group]||0)+' matching exercises';
   regions+=`<g class="panda-muscle-region" data-action="muscle-filter" data-group="${group}" data-region="${key}" data-view="${side}" role="button" tabindex="0" aria-label="${esc(label)}" aria-pressed="${active}" aria-controls="library-results"><title>${esc(label)}</title>`;
   for(const [,part,d] of parts.filter(x=>x[0]===key))for(const sign of [-1,1])regions+=`<path data-part="${part}" transform="translate(${profile[side]} 0) scale(${sign} 1)" d="${d}"/>`;
   regions+='</g>';
  }
 }
 return `<svg class="panda-anatomy-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${box}" preserveAspectRatio="xMidYMid meet" role="group" aria-labelledby="panda-anatomy-title" aria-describedby="panda-anatomy-help"><title id="panda-anatomy-title">Select a muscle group</title><image width="600" height="${profile.height}" href="${esc(asset('assets/anatomy/body-reference.webp'))}" preserveAspectRatio="none" aria-hidden="true"/>${regions}</svg><div class="panda-anatomy-captions" aria-hidden="true">${(view==='both'?['front','back']:[view]).map(v=>`<span>${views[v]}</span>`).join('')}</div>`;
}
function render(selected='',view='both',counts={}){
 return `<div class="panda-anatomy"><div class="panda-anatomy-controls" role="group" aria-label="Anatomy view">${Object.entries(views).map(([key,label])=>`<button type="button" data-action="muscle-view" data-view="${key}" aria-pressed="${view===key}" aria-controls="panda-anatomy-stage">${label}</button>`).join('')}</div><div id="panda-anatomy-stage" class="panda-anatomy-stage" data-view="${view}">${figure(selected,view,counts)}</div><p id="panda-anatomy-help" class="caption">Tap a muscle or use the muscle-group filter.</p></div>`;
}
function updateView(host,selected,view,counts){
 const stage=host?.querySelector('#panda-anatomy-stage');if(!stage)return;
 stage.dataset.view=view;stage.innerHTML=figure(selected,view,counts);
 host.querySelectorAll('[data-action="muscle-view"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
}
window.PandaAnatomy=Object.freeze({render,figure,updateView,groups,views});
})();
