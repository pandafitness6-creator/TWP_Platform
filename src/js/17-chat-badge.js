
/* Private chat has its own state. Online bodies/drafts never enter portal backup or localStorage. */
/* Unread counter for the Messages tab: polls the inbox every 30 s while signed in; PandaChat updates it live on the Messages page. */
window.PandaChatBadge=(()=>{
 let count=0,timer=null,busy=false,owner='';
 function apply(){document.querySelectorAll('[data-chat-unread]').forEach(n=>{n.textContent=count>99?'99+':String(count);n.hidden=!count;});}
 function set(n){count=Math.max(0,Number(n)||0);apply();}
 function active(){try{return !!(window.PandaServices?.online&&window.PandaCloud?.account&&PandaCloud.account.role===PandaServices.get().preferences.role);}catch{return false;}}
 async function poll(){if(busy||!active()||document.visibilityState==='hidden')return;busy=true;try{const rows=await PandaCloud.chatRPC('inbox');if(Array.isArray(rows))set(rows.reduce((n,t)=>n+Number(t.unread||0),0));}catch{}finally{busy=false;}}
 function stop(){if(timer){clearInterval(timer);timer=null;}owner='';count=0;apply();}
 function sync(){if(!active()){stop();return;}const who=PandaCloud.account.user_id;if(who!==owner){owner=who;count=0;apply();poll();}else apply();if(!timer)timer=setInterval(poll,30000);}
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')poll();});
 window.addEventListener('panda:cloud-status',e=>{if(e.detail==='ready')poll();else if(['signed-out','password-required','setup','demo'].includes(e.detail))stop();});
 return {apply,set,poll,sync,get count(){return count;}};
})();
