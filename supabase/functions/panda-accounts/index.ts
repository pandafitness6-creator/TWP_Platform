// Train With Panda · No email delivery, public signup or credentials in browser code.
// verify_jwt=false at the gateway: every call is verified here with Auth /user.
const base = Deno.env.get('SUPABASE_URL')!;
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const publicKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const domain = Deno.env.get('PANDA_AUTH_DOMAIN') || 'accounts.panda.invalid';
const origins = (Deno.env.get('PANDA_ALLOWED_ORIGINS') || '').split(',').map(x => x.trim()).filter(Boolean);
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;
function passwordCheck(value: unknown) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new Error('Use a password with 12–128 characters.');
}
async function request(path: string, method = 'GET', body?: unknown, token = secret, apikey = secret) {
  const res = await fetch(base + path, {method, headers: {apikey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const text = await res.text(); let data; try {data = text ? JSON.parse(text) : null;} catch {throw new Error('The account service is unavailable.');}
  if (!res.ok) throw new Error(data?.msg || data?.message || data?.error_description || 'Account operation failed.');
  return data;
}
Deno.serve(async req => {
  const origin = req.headers.get('Origin');
  const allowed = !origin || origins.includes(origin);
  const headers: Record<string,string> = {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  if (allowed && origin) headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type';
  headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers});
  if (!allowed) return reply({error:'This portal address is not enabled.'},403);
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (req.method !== 'POST') return reply({error:'POST required.'},405);
  try {
    const authorization = req.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) return reply({error:'Sign in first.'},401);
    const token = authorization.slice(7);
    // Never decode a JWT and trust it: ask Supabase Auth to verify the caller.
    const caller = await request('/auth/v1/user','GET',undefined,token,publicKey);
    const rows = await request('/rest/v1/panda_accounts?user_id=eq.'+encodeURIComponent(caller.id)+'&select=*');
    const account = rows[0];
    if (!account?.active) return reply({error:'This account is not active. Contact your coach.'},403);
    // Ask the database, as the caller, so expiry uses the same rule as RLS: the last day of
    // access ends at 00:00 the next day in the client's own timezone.
    if (account.access_expires_on) {
      const access = await request('/rest/v1/rpc/panda_access_status','POST',{},token,publicKey);
      if (access?.state === 'expired') return reply({error:'Your access has expired. If you have already paid, please contact the support team.'},403);
    }
    const raw = await req.text();
    if (raw.length > 40000) return reply({error:'Request too large.'},413);
    const body = JSON.parse(raw);
    if (body.action === 'change_password') {
      passwordCheck(body.password);
      // Re-authenticate with the CURRENT password; possession of a stale reset JWT is insufficient.
      if (typeof body.current_password !== 'string') throw new Error('Enter your current password.');
      const verified = await request('/auth/v1/token?grant_type=password','POST',{email:caller.email,password:body.current_password},publicKey,publicKey);
      if (verified.user?.id !== caller.id) return reply({error:'Unable to verify this account.'},403);
      await request('/auth/v1/user','PUT',{password:body.password},verified.access_token,publicKey);
      await request('/rest/v1/panda_accounts?user_id=eq.'+encodeURIComponent(caller.id),'PATCH',{must_change_password:false});
      // Revoke other refresh tokens after a password change. RLS uses the authoritative account row.
      await request('/auth/v1/logout?scope=others','POST',undefined,verified.access_token,publicKey);
      return reply({ok:true,session:verified});
    }
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    if (account.role !== 'coach' || account.must_change_password || Number(claims.iat)*1000 < Date.parse(account.session_cutoff)) return reply({error:'Coach access required.'},403);
    if (body.action === 'create_client') {
      const username = String(body.username || '').trim().toLowerCase();
      if (!usernamePattern.test(username)) throw new Error('Username: 3–32 letters, numbers, dots, underscores or hyphens.');
      passwordCheck(body.password);
      const p = body.profile;
      if (!p || typeof p.name !== 'string' || !p.name.trim() || p.name.length>80) throw new Error('Enter the client’s full name.');
      if (![p.age,p.height,p.weight,p.goal_weight].every(Number.isFinite) || p.age<16 || p.age>100 || p.height<100 || p.height>250 || p.weight<20 || p.weight>400 || p.goal_weight<20 || p.goal_weight>400) throw new Error('Check the client’s age, height and weight.');
      const existing = await request('/rest/v1/panda_accounts?username=eq.'+encodeURIComponent(username)+'&select=user_id');
      if (existing.length) throw new Error('This username is already in use.');
      const created = await request('/auth/v1/admin/users','POST',{email:username+'@'+domain,password:body.password,email_confirm:true});
      const uid = created.id || created.user?.id;
      if (!uid) throw new Error('The account could not be created.');
      // Explicit fields: a crafted request cannot assign an admin role or seed private records.
      const profile = {...p,id:uid,status:'onboarding',favorites:[],read_articles:[],onboarding:{profile:false,guidelines:false,plans:false}};
      delete profile.role; delete profile.password; delete profile.user_id;
      try {await request('/rest/v1/rpc/panda_register_client','POST',{uid,login_name:username,profile});}
      catch (error) {
        // Compensate for the cross-service Auth/DB boundary; never leave a usable orphan account.
        try {await request('/auth/v1/admin/users/'+uid,'DELETE');} catch {throw new Error('Account setup failed. An inactive orphan login may need removal by the project administrator.');}
        throw error;
      }
      return reply({ok:true,user_id:uid,username});
    }
    if (body.action === 'reset_password') {
      passwordCheck(body.password);
      const target = (await request('/rest/v1/panda_accounts?user_id=eq.'+encodeURIComponent(String(body.user_id))+'&select=*'))[0];
      if (!target || target.role !== 'client') throw new Error('Choose an existing client.');
      // Lock data access BEFORE changing the password. Old access tokens cannot read/write data.
      await request('/rest/v1/panda_accounts?user_id=eq.'+target.user_id,'PATCH',{must_change_password:true,session_cutoff:new Date().toISOString()});
      await request('/auth/v1/admin/users/'+target.user_id,'PUT',{password:body.password});
      return reply({ok:true,username:target.username});
    }
    return reply({error:'Unknown account action.'},400);
  } catch (err) {
    // No request payloads, passwords or session tokens are logged.
    return reply({error:err instanceof Error ? err.message : 'The request could not be completed.'},400);
  }
});
