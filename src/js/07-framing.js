/* Subject-aware cropping. Coordinates describe a protected region in the original photograph. */
window.PandaFraming=(()=>{
 const faces={
  female:{dashboard:[.60,.00,.77,.25],training:[.60,.00,.77,.26],library:[.62,.00,.79,.25],progress:[.59,.00,.77,.26],checkins:[.60,.00,.76,.28],education:[.58,.01,.79,.37],login:[.59,.00,.76,.27],brand:[.58,.00,.77,.27]},
  male:{dashboard:[.60,.00,.77,.25],training:[.57,.00,.76,.27],library:[.57,.00,.75,.25],progress:[.58,.00,.79,.26],checkins:[.58,.01,.76,.29],education:[.56,.00,.79,.37],login:[.59,.00,.77,.27],brand:[.59,.00,.77,.27]}
 };
 function region(path){const m=path.match(/assets\/cast\/(male|female)\/(\w+)\.webp/);if(m&&faces[m[1]][m[2]]){const box=[...faces[m[1]][m[2]]];box[3]=m[2]==='education'?.74:.54;return {box,anchor:[.68,.20]};}if(path==='assets/placements/nutrition-hero.webp')return {box:[.66,.36,.985,.86],anchor:[.81,.61],food:true};return null;}
 function heroRegion(path){const wallpaper=window.PANDA_CAST?.wallpapers?.regions?.[path];if(wallpaper){if(/dashboard-(male|female)/.test(path))return {box:[wallpaper.box[0],wallpaper.box[1],wallpaper.box[2],.46],anchor:[wallpaper.anchor[0],.20],protectsFace:true};return wallpaper;}const m=path.match(/assets\/cast\/(male|female)\/(\w+)\.webp/);if(m&&faces[m[1]][m[2]])return {box:[...faces[m[1]][m[2]]],anchor:[.68,.18],protectsFace:true};if(path==='assets/placements/nutrition-hero.webp')return {box:[.70,.39,.965,.74],anchor:[.81,.56],food:true};return region(path);}
 function heroStyle(path){const resolved=window.PandaExperience?.resolve(path)||path,r=heroRegion(resolved),size=window.PANDA_CAST?.image_sizes?.[resolved]||window.PANDA_MEDIA?.image_sizes?.[path];const ratio=size?.width&&size?.height?size.width/size.height:resolved.includes('nutrition-hero')?16/9:1.5;return `--hero-subject-span:${r?r.box[3]-r.box[1]+.04:.31};--hero-photo-ratio:${ratio}`;}
 function crop(nw,nh,w,h,box,anchor){
  if(!nw||!nh||!w||!h)return null;
  const scale=Math.max(w/nw,h/nh),vx=Math.min(1,w/scale/nw),vy=Math.min(1,h/scale/nh);
  function axis(visible,lo,hi,point,target){const room=1-visible;if(room<.00001)return {pos:50,offset:0};const low=Math.max(0,hi-visible+.012),high=Math.min(room,lo-.012);const wanted=point-visible*target;const offset=low<=high?Math.max(low,Math.min(high,wanted)):Math.max(0,Math.min(room,(lo+hi-visible)/2));return {pos:offset/room*100,offset};}
  const x=axis(vx,box[0],box[2],anchor[0],.72),y=axis(vy,box[1],box[3],anchor[1],.30);
  return {x:x.pos,y:y.pos,visible:[x.offset,y.offset,x.offset+vx,y.offset+vy],fits:box[2]-box[0]<=vx&&box[3]-box[1]<=vy};
 }
 const watched=new Set();let queued=0;
 function placement(hw,iw,ih,nw,nh,fit,r,rtl){if(!rtl)return hw-iw;const scale=Math.max(iw/nw,ih/nh),lo=(r.box[0]-fit.visible[0])*nw*scale,hi=(r.box[2]-fit.visible[0])*nw*scale,point=(r.anchor[0]-fit.visible[0])*nw*scale;return Math.max(hw*.025-lo,Math.min(hw*.975-hi,hw*.25-point));}
 function frame(img){
  const path=window.PandaExperience?.resolve(img.dataset.mediaSource||'')||img.dataset.mediaResolved||'',isHero=img.classList.contains('hero-image'),r=isHero?heroRegion(path):region(path);if(!r||!img.naturalWidth||!img.naturalHeight)return;
  const rect=img.getBoundingClientRect();if(!rect.width||!rect.height)return;
  // Wallpaper always fills the masthead. Height and focal point protect faces, never a reduced photo width.
  if(isHero){img.style.removeProperty('max-width');img.style.removeProperty('left');const safe=heroStyle(path);for(const part of safe.split(';')){const [key,value]=part.split(':');img.parentElement.style.setProperty(key,value);}}
  const b=img.getBoundingClientRect(),fit=crop(img.naturalWidth,img.naturalHeight,b.width,b.height,r.box,r.anchor);if(!fit)return;
  img.style.objectPosition=fit.x.toFixed(3)+'% '+fit.y.toFixed(3)+'%';img.dataset.framed='true';
 }
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(entries=>entries.forEach(entry=>frame(entry.target))):null;
 function refresh(root=document){for(const old of watched)if(!old.isConnected){observer?.unobserve(old);watched.delete(old);}root.querySelectorAll('img.hero-image,.education-grid img.article-image,.teaser>img,.brand-panel>img,.program>img').forEach(img=>{if(!watched.has(img)){watched.add(img);observer?.observe(img);img.addEventListener('load',()=>frame(img));}frame(img);});}
 function schedule(){if(queued)return;queued=requestAnimationFrame(()=>{queued=0;refresh();});}
 document.addEventListener('DOMContentLoaded',()=>{refresh();const root=document.getElementById('main');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});});
 window.addEventListener('resize',schedule,{passive:true});
 return {refresh,schedule,crop,region,heroRegion,heroStyle,placement};
})();
