// Run locally with secret environment variables. Never publish this file in dist.
const base=process.env.PANDA_PUBLIC_SUPABASE_URL;
const secret=process.env.PANDA_SERVER_SERVICE_ROLE_KEY;
const username=(process.env.PANDA_BOOTSTRAP_USERNAME||'').trim().toLowerCase();
const password=process.env.PANDA_BOOTSTRAP_PASSWORD||'';
if(!base||!secret)throw Error('Missing project URL or server service-role key.');
if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)||password.length<12||password.length>128)throw Error('Set a valid coach username and a 12–128 character initial password.');
async function request(path,method='GET',body){
 const r=await fetch(base.replace(/\/$/,'')+path,{method,headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const text=await r.text();const data=text?JSON.parse(text):null;if(!r.ok)throw Error(data?.message||data?.msg||'Coach setup failed.');return data;
}
const coaches=await request('/rest/v1/panda_accounts?role=eq.coach&select=user_id');
if(coaches.length)throw Error('A coach already exists. No additional administrator was created.');
const result=await request('/auth/v1/admin/users','POST',{email:username+'@accounts.panda.invalid',password,email_confirm:true});
const id=result.id||result.user?.id;
try{await request('/rest/v1/panda_accounts','POST',{user_id:id,username,role:'coach',active:true,must_change_password:true});}
catch(err){try{await request('/auth/v1/admin/users/'+id,'DELETE');}catch{throw Error('Coach registration failed. Remove the orphan Auth account in the project dashboard.');}throw err;}
console.log('Initial coach account created. Use the locally chosen credentials and change the password at first sign-in.');
