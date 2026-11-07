window.PandaLoginVideo=(()=>{
 'use strict';
 const key='panda.login-video.paused.v1';
 const mediaQuery=window.matchMedia?.('(prefers-reduced-motion: reduce)');
 let active=null,serial=0,paused=false;
 try{paused=localStorage.getItem(key)==='true';}catch{}
 const tr=(en,ar)=>window.PandaExperience?.get().language==='ar'?ar:en;
 const reduced=()=>{
  let saved=false;
  try{saved=!!window.PandaServices?.get()?.preferences?.reduced_motion||localStorage.getItem('panda:reduced-motion')==='true';}catch{}
  return !!(mediaQuery?.matches||document.body.classList.contains('reduced-motion')||saved);
 };
 const glyph=play=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${play?'<path d="M8 4v16l12-8z"/>':'<path d="M6 4h4v16H6zm8 0h4v16h-4z"/>'}</svg>`;
 function markup(){
  return `<div class="auth-film" data-login-film aria-hidden="true">${window.PandaUI.img('assets/login-video/poster.webp','Athlete walking into the Panda gym','auth-photo',true)}<video class="auth-video" muted loop playsinline preload="none" disablepictureinpicture disableremoteplayback tabindex="-1" aria-hidden="true"></video></div><button type="button" class="auth-video-control" data-login-video-toggle data-no-translate hidden></button><span class="auth-video-note" data-login-video-note data-no-translate hidden></span>`;
 }
 function wantsPlayback(a){return active===a&&a.root.isConnected&&!paused&&!reduced()&&!document.hidden&&a.inView&&!a.failed&&!a.blocked;}
 function controls(a){
  if(active!==a)return;
  const still=reduced(),waiting=a.loading&&!paused;
  a.button.hidden=still||a.failed;
  a.note.hidden=!still&&!a.failed;
  a.note.textContent=still?tr('Still image · reduced motion','صورة ثابتة · حركة مخفّضة'):tr('Still image','صورة ثابتة');
  const isPaused=paused||a.blocked;
  const label=isPaused?tr('Play video','تشغيل الفيديو'):tr('Pause video','إيقاف الفيديو مؤقتًا');
  a.button.setAttribute('aria-label',label);
  a.button.setAttribute('aria-pressed',String(isPaused));
  a.button.innerHTML=glyph(isPaused)+`<span>${label}</span>`;
  a.root.dataset.loading=String(waiting);
 }
 function release(a){
  a.request=++serial;a.loading=false;
  a.video.pause();a.video.removeAttribute('src');a.video.load();
  a.root.classList.remove('is-playing');
  if(a.url){URL.revokeObjectURL(a.url);a.url=null;}
 }
 function destroy(){
  if(!active)return;
  const a=active;active=null;
  a.observer?.disconnect();release(a);
 }
 async function play(a){
  if(!wantsPlayback(a)||!a.url||!a.video.paused)return;
  const request=a.request;
  try{await a.video.play();}
  catch(error){
   if(active!==a||request!==a.request||error?.name==='AbortError'||!wantsPlayback(a))return;
   a.blocked=true;controls(a);
  }
 }
 async function load(a){
  if(a.loading||a.url||!wantsPlayback(a))return;
  a.loading=true;const request=a.request=++serial;controls(a);
  try{
   const item=window.PANDA_LOGIN_VIDEOS[a.gender];
   const content=document.getElementById(item.id)?.textContent.trim();
   if(!content)throw Error('Embedded film missing');
   const parts=[];
   // Small decoding batches keep the language selector and login fields responsive.
   for(let offset=0;offset<content.length;offset+=262144){
    if(active!==a||request!==a.request)return;
    const binary=atob(content.slice(offset,offset+262144));
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    parts.push(bytes);
    if(offset+262144<content.length)await new Promise(resolve=>setTimeout(resolve,0));
   }
   if(active!==a||request!==a.request)return;
   a.url=URL.createObjectURL(new Blob(parts,{type:'video/mp4'}));
   a.video.src=a.url;a.video.load();a.loading=false;
   controls(a);play(a);
  }catch(error){
   if(active!==a||request!==a.request)return;
   a.loading=false;a.failed=true;release(a);controls(a);
  }
 }
 function sync(){
  const root=document.querySelector('[data-login-film]');
  if(!root||!document.body.classList.contains('auth-gate')){destroy();return;}
  const gender=window.PandaExperience?.get().imagery==='female'?'female':'male';
  if(!active||active.root!==root){
   destroy();
   const story=root.parentElement,video=root.querySelector('video');
   const a=active={root,video,button:story.querySelector('[data-login-video-toggle]'),note:story.querySelector('[data-login-video-note]'),gender,url:null,request:++serial,loading:false,blocked:false,failed:false,inView:true};
   video.muted=true;video.defaultMuted=true;video.loop=true;video.playsInline=true;
   video.addEventListener('playing',()=>{
    if(!wantsPlayback(a)){video.pause();return;}
    root.classList.add('is-playing');a.blocked=false;controls(a);
   });
   video.addEventListener('error',()=>{if(active!==a||!a.url)return;a.failed=true;release(a);controls(a);});
   if(window.IntersectionObserver){
    a.observer=new IntersectionObserver(entries=>{if(active!==a)return;a.inView=entries.some(entry=>entry.isIntersecting);sync();},{threshold:.01});
    a.observer.observe(root);
   }
  }
  const a=active;
  if(a.gender!==gender){release(a);a.gender=gender;a.blocked=false;a.failed=false;}
  a.root.dataset.imagery=gender;
  if(reduced()){if(a.url||a.loading)release(a);controls(a);return;}
  if(!wantsPlayback(a))a.video.pause();
  else if(a.url)play(a);
  else load(a);
  controls(a);
 }
 document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-login-video-toggle]');
  if(!button||!active||button!==active.button)return;
  paused=!(paused||active.blocked);active.blocked=false;
  try{localStorage.setItem(key,String(paused));}catch{}
  sync();
 });
 document.addEventListener('visibilitychange',sync);
 window.addEventListener('pagehide',destroy);
 window.addEventListener('pageshow',sync);
 mediaQuery?.addEventListener?.('change',sync);
 new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
 return Object.freeze({markup,sync,destroy});
})();
