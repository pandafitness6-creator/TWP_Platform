// Client archive timestamp (migration 024): clients.archived_at is set by the server when a client
// is archived, kept while archived, removed when un-archived, and cannot be set by anyone else.
// Called from verify.cjs; each check reports through pass().
const assert=require('node:assert/strict');
const {helpers:{as,one,record,save,definition,plans,profile,coachAccount,install}}=require('./client-intake.cjs');
const MIGRATION='202611140024_client_archived_at.sql';
const id=n=>'00000000-0000-4000-9100-'+String(n).padStart(12,'0');
const ids={coach:'00000000-0000-4000-9000-000000000001',amy:id(1),bo:id(2),cy:id(3),di:id(4)};
const FORGED='2001-01-01T00:00:00Z';
const client=async(db,uid)=>(await record(db,'clients',uid)).data;
const recent=(stamp,label)=>{assert.equal(typeof stamp,'string',label+': archived_at missing');const age=Date.now()-Date.parse(stamp);assert(age>=-5000&&age<120000,label+': archived_at is not the current time ('+stamp+')');};
async function register(db,uid,p,extra){await db.query('insert into auth.users(id) values($1)',[uid]);await db.query('select panda_register_client($1,$2,$3)',[uid,'client.'+uid.slice(-2),JSON.stringify(profile(uid,p,extra))]);await db.query('update panda_accounts set must_change_password=false where user_id=$1',[uid]);}
// The coach saves a client row through panda_save, as the portal does.
async function coachSave(db,uid,edit){const r=await record(db,'clients',uid);const data=edit({...r.data});return save(db,ids.coach,[{kind:'clients',id:uid,data,revision:r.revision}],'Updated client');}

async function sql({PGlite,bootstrap,migrations},pass){
 const text=migrations.find(([f])=>f===MIGRATION)?.[1];assert(text,'Migration 024 is missing');
 const upTo=prefix=>migrations.filter(([f])=>f<prefix);

 // 1. Prerequisite: 024 refuses a database without 023 and changes nothing.
 {
  const db=await install(PGlite,bootstrap,upTo('202611130023'));
  await assert.rejects(()=>db.exec(text),/Migration 023 \(client intake\) is not installed; review migration 024/);await db.exec('rollback');
  assert.equal((await one(db,"select count(*)::int n from pg_trigger where tgname='panda_client_archived_at'")).n,0);
  assert.equal((await one(db,"select to_regprocedure('panda_private.stamp_client_archive()') f")).f,null);
  await db.close();
  pass('Migration 024 aborts when migration 023 is missing, and leaves the database unchanged');
 }

 // 2. Upgrade from 023 with a client already archived: backfilled once, functions untouched, re-runnable.
 const db=await install(PGlite,bootstrap,upTo('202611140024'));
 await coachAccount(db);
 const full=await plans(db,'coaching');
 await register(db,ids.amy,full,{status:'active'});await register(db,ids.bo,full,{status:'onboarding'});
 await register(db,ids.cy,full,{status:'active'});await register(db,ids.di,full,{status:'archived'});
 const fns=['public.panda_save(jsonb,text)','panda_private.readable(text,text,uuid,jsonb)'];
 const defs=await Promise.all(fns.map(f=>definition(db,f)));
 const diBefore=await record(db,'clients',ids.di);assert(!('archived_at' in diBefore.data));
 await db.exec(text);
 assert.deepEqual(await Promise.all(fns.map(f=>definition(db,f))),defs);
 const di=await record(db,'clients',ids.di);recent(di.data.archived_at,'backfill');assert.equal(di.revision,diBefore.revision);
 for(const uid of [ids.amy,ids.bo,ids.cy])assert(!('archived_at' in await client(db,uid)));
 const snapshot=async()=>JSON.stringify((await db.query("select kind,id,data,revision from panda_records where kind='clients' order by id")).rows);
 const populated=await snapshot();await db.exec(text);assert.equal(await snapshot(),populated);
 pass('Migration 024 leaves panda_save and readable() unchanged, stamps clients archived before the upgrade once (no revision bump), and re-runs without changes');

 // 3. Set on archive, kept while archived.
 await coachSave(db,ids.amy,c=>({...c,status:'archived'}));
 const stamp=(await client(db,ids.amy)).archived_at;recent(stamp,'archive');
 await coachSave(db,ids.amy,c=>({...c,goal:'Maintain'}));assert.equal((await client(db,ids.amy)).archived_at,stamp);
 const stale={...await client(db,ids.amy)};delete stale.archived_at;
 await save(db,ids.coach,[{kind:'clients',id:ids.amy,data:{...stale,location:'Kandy'},revision:(await record(db,'clients',ids.amy)).revision}]);
 assert.equal((await client(db,ids.amy)).archived_at,stamp);
 pass('Archiving a client records archived_at; later saves of the archived client keep the original date, even when the row sent omits it');

 // 4. Cleared on un-archive, by any status other than archived; re-archiving restamps.
 await coachSave(db,ids.amy,c=>({...c,status:'active'}));assert(!('archived_at' in await client(db,ids.amy)));
 await coachSave(db,ids.amy,c=>({...c,status:'archived'}));const again=(await client(db,ids.amy)).archived_at;recent(again,'re-archive');
 await coachSave(db,ids.amy,c=>({...c,status:'paused'}));assert(!('archived_at' in await client(db,ids.amy)));
 await coachSave(db,ids.di,c=>({...c,status:'onboarding'}));assert(!('archived_at' in await client(db,ids.di)));
 pass('Un-archiving (to active, paused or onboarding) removes archived_at; archiving again records a new date');

 // 5. The coach cannot forge it.
 await coachSave(db,ids.cy,c=>({...c,archived_at:FORGED}));assert(!('archived_at' in await client(db,ids.cy)));
 await coachSave(db,ids.cy,c=>({...c,status:'archived',archived_at:FORGED}));const cy=(await client(db,ids.cy)).archived_at;assert.notEqual(cy,FORGED);recent(cy,'coach archive');
 await coachSave(db,ids.cy,c=>({...c,archived_at:FORGED}));assert.equal((await client(db,ids.cy)).archived_at,cy);
 await coachSave(db,ids.cy,c=>({...c,archived_at:null}));assert.equal((await client(db,ids.cy)).archived_at,cy);
 pass('The coach cannot set, change or clear archived_at: a value sent on an active client is dropped, on an archived client it is replaced by the server date');

 // 6. The client cannot write it, and a direct write is overwritten too.
 await assert.rejects(()=>clientSave(db,ids.bo,c=>({...c,archived_at:FORGED})),/Only your coach can change assignments and access/);
 await assert.rejects(()=>clientSave(db,ids.bo,c=>({...c,status:'archived'})),/Only your coach can change assignments and access/);
 await assert.rejects(()=>as(db,ids.bo,()=>db.query(`update panda_records set data=data||'{"archived_at":"${FORGED}"}' where kind='clients' and id=$1`,[ids.bo])),/permission denied/);
 assert(!('archived_at' in await client(db,ids.bo)));
 await db.query(`update panda_records set data=data||'{"archived_at":"${FORGED}"}' where kind='clients' and id=$1`,[ids.bo]);assert(!('archived_at' in await client(db,ids.bo)));
 await db.query(`update panda_records set data=data||'{"archived_at":"${FORGED}"}' where kind='clients' and id=$1`,[ids.cy]);assert.equal((await client(db,ids.cy)).archived_at,cy);
 await coachSave(db,ids.bo,c=>({...c,goal:'Run 5 km'}));
 await save(db,ids.bo,[{kind:'clients',id:ids.bo,data:{...await client(db,ids.bo),goal:'Run 10 km'},revision:(await record(db,'clients',ids.bo)).revision}]);
 assert.equal((await client(db,ids.bo)).goal,'Run 10 km');
 pass('A client cannot send archived_at or archive themselves, cannot update the row directly, and still saves their own profile; direct database writes cannot set it either');
 await db.close();
}
// The client saving their own clients row through panda_save.
async function clientSave(db,uid,edit){const r=await record(db,'clients',uid);return save(db,uid,[{kind:'clients',id:uid,data:edit({...r.data}),revision:r.revision}],'Updated profile');}
module.exports={sql};
