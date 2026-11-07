export function validatePublicConfig(c){
 const u=new URL(c.supabaseUrl);let valid=String(c.publishableKey||'').startsWith('sb_publishable_');
 if(!valid)try{valid=JSON.parse(Buffer.from(c.publishableKey.split('.')[1],'base64url')).role==='anon';}catch{}
 if(u.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/.test(u.hostname)||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('Use the HTTPS Supabase project URL.');
 if(!valid||String(c.publishableKey).startsWith('sb_secret_')||/[<>]/.test(c.publishableKey))throw Error('Only a public publishable/anon key is allowed.');
 if(c.mode!=='online'||c.authDomain!=='accounts.panda.invalid'||Object.keys(c).some(k=>!['mode','supabaseUrl','publishableKey','authDomain'].includes(k)))throw Error('Unexpected public connection settings.');
}
