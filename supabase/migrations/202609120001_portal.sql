-- TRAIN WITH PANDA 0.4.0 · Train With Panda
-- One coaching business per Supabase project. Never seed customer/demo accounts.
begin;
create schema if not exists panda_private;
revoke all on schema panda_private from public, anon, authenticated;
grant usage on schema panda_private to authenticated;

create table public.panda_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  role text not null default 'client' check (role in ('coach','client')),
  active boolean not null default true,
  must_change_password boolean not null default true,
  session_cutoff timestamptz not null default 'epoch',
  created_at timestamptz not null default now()
);
create table public.panda_records (
  kind text not null check (kind in ('clients','client_private','packages','foods','programs','nutrition_plans','checkins','checkin_private','measurements','activity','photos','articles','invoices','drafts','settings','plan_history','supplements')),
  id text not null check (length(id) between 1 and 100),
  owner_id uuid references public.panda_accounts(user_id) on delete cascade,
  data jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key(kind,id),
  check (octet_length(data::text) <= 1000000),
  check ((kind in ('clients','client_private','checkins','checkin_private','measurements','activity','photos','invoices','drafts','supplements')) = (owner_id is not null))
);
create index panda_records_owner on public.panda_records(owner_id,kind);
create table public.panda_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.panda_accounts(user_id) on delete cascade,
  owner_id uuid references public.panda_accounts(user_id) on delete cascade,
  label text not null,
  at timestamptz not null default now()
);
alter table public.panda_accounts enable row level security;
alter table public.panda_records enable row level security;
alter table public.panda_events enable row level security;
revoke all on public.panda_accounts, public.panda_records, public.panda_events from anon, authenticated;
grant select on public.panda_accounts, public.panda_records, public.panda_events to authenticated;
grant all on public.panda_accounts, public.panda_records, public.panda_events to service_role;
grant usage, select on sequence public.panda_events_id_seq to service_role;

create function panda_private.ready() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.panda_accounts where user_id=auth.uid() and active and not must_change_password and to_timestamp(coalesce((auth.jwt()->>'iat')::bigint,0)) >= session_cutoff)
$$;
create function panda_private.coach() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.panda_accounts where user_id=auth.uid() and active and not must_change_password and role='coach' and to_timestamp(coalesce((auth.jwt()->>'iat')::bigint,0)) >= session_cutoff)
$$;
create function panda_private.profile() returns jsonb language sql stable security definer set search_path='' as $$
 select data from public.panda_records where kind='clients' and owner_id=auth.uid()
$$;
create function panda_private.feature(wanted text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select data->'features' ? wanted from public.panda_records where kind='packages' and id=panda_private.profile()->>'package_id'),false)
$$;
create function panda_private.readable(k text, rid text, owner uuid, body jsonb) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if not panda_private.ready() then return false; end if;
 if panda_private.coach() then return true; end if;
 if k in ('client_private','checkin_private','invoices','plan_history') then return false; end if;
 if owner is not null then
  if owner is distinct from auth.uid() then return false; end if;
  if k in ('checkins','drafts') then return panda_private.feature('checkins'); end if;
  if k in ('photos','measurements') then return panda_private.feature('progress'); end if;
  if k='activity' then return panda_private.feature('activity'); end if;
  if k='supplements' then return panda_private.feature('supplements'); end if;
  return k='clients';
 end if;
 if k='packages' then return rid=panda_private.profile()->>'package_id'; end if;
 if k='programs' then return panda_private.feature('training') and rid=panda_private.profile()->>'program_id' and body->>'status'='published'; end if;
 if k='nutrition_plans' then return panda_private.feature('nutrition') and rid=panda_private.profile()->>'nutrition_id' and body->>'status'='published'; end if;
 if k='articles' then return panda_private.feature('education') and body->>'status'='published'; end if;
 if k='settings' then return rid in ('brand','measurement_defs','exercise_edits') or rid='roadmap' and panda_private.feature('roadmap') or rid in ('strategy','swaps') and panda_private.feature('nutrition'); end if;
 return k='foods' and panda_private.feature('nutrition');
end $$;
-- Validate customer-controlled fields at the database boundary as well as in the UI.
create function panda_private.valid_number(v jsonb, lo numeric, hi numeric) returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(v)='number' then (v::text)::numeric between lo and hi else false end
$$;
create function panda_private.valid_text(v jsonb, lim integer) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(v)='string' and length(v#>>'{}')<=lim
$$;
create function panda_private.validate_profile(b jsonb) returns void language plpgsql security definer set search_path='' as $$
declare f text; v jsonb;
begin
 if not coalesce(panda_private.valid_text(b->'name',80),false) or length(trim(b->>'name'))=0 or not coalesce(panda_private.valid_text(b->'email',160),false) then raise exception 'Invalid client name or email'; end if;
 if not panda_private.valid_number(b->'age',16,100) or (b->>'age')::numeric<>trunc((b->>'age')::numeric) or not panda_private.valid_number(b->'height',100,250) or not panda_private.valid_number(b->'weight',20,400) or not panda_private.valid_number(b->'goal_weight',20,400) then raise exception 'Invalid client measurements'; end if;
 foreach f in array array['location','goal','occupation','activity_level','preferences','allergies','limitations','sex'] loop
  if not coalesce(panda_private.valid_text(b->f,6000),false) then raise exception 'Invalid client text'; end if;
 end loop;
 foreach f in array array['favorites','read_articles'] loop
  if jsonb_typeof(b->f) is distinct from 'array' or jsonb_array_length(b->f)>1000 then raise exception 'Invalid saved references'; end if;
  for v in select value from jsonb_array_elements(b->f) loop
   if not coalesce(panda_private.valid_text(v,100),false) then raise exception 'Invalid saved reference'; end if;
   if f='favorites' and not exists(select 1 from public.panda_records where kind='settings' and id='catalogue_ids' and data ? (v#>>'{}')) then raise exception 'Unknown exercise reference'; end if;
  end loop;
 end loop;
 if jsonb_typeof(b->'onboarding') is distinct from 'object' then raise exception 'Invalid onboarding values'; end if;
 foreach f in array array['profile','guidelines','plans'] loop
  if jsonb_typeof(b->'onboarding'->f) is distinct from 'boolean' then raise exception 'Invalid onboarding value'; end if;
 end loop;
end $$;

revoke all on all functions in schema panda_private from public,anon,authenticated;
grant execute on all functions in schema panda_private to authenticated;
create policy account_read on public.panda_accounts for select to authenticated using (user_id=auth.uid() or panda_private.coach());
create policy record_read on public.panda_records for select to authenticated using (panda_private.readable(kind,id,owner_id,data));
create policy event_read on public.panda_events for select to authenticated using (panda_private.ready() and (panda_private.coach() or owner_id=auth.uid()));

-- All writes go through this atomic, version-checked command. UI roles are never trusted.
create function public.panda_save(changes jsonb, label text default 'Saved changes') returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; old public.panda_records; body jsonb; k text; rid text; owner uuid; is_coach boolean;
 result jsonb='[]'; seq bigint; immutable text[]; f text; other public.panda_records; stamp text;
begin
 if not panda_private.ready() then raise exception 'Account unavailable. Sign in again.' using errcode='42501'; end if;
 is_coach:=panda_private.coach();
 if jsonb_typeof(changes)<>'array' or jsonb_array_length(changes)>500 then raise exception 'Invalid change batch'; end if;
 if length(label)>160 then raise exception 'Invalid change label'; end if;
 -- Serialise portal writes so version checks also cover concurrent inserts and dates.
 perform pg_advisory_xact_lock(8219034);
 for item in select value from jsonb_array_elements(changes) loop
  k:=item->>'kind'; rid:=item->>'id'; body:=item->'data';
  select * into old from public.panda_records where kind=k and id=rid for update;
  if coalesce(old.revision,0) <> coalesce((item->>'revision')::bigint,0) then raise exception 'This record changed on another device. Refresh before saving.' using errcode='40001'; end if;
  if k in ('client_private','checkin_private') and not is_coach then raise exception 'Coach access required' using errcode='42501'; end if;
  if not is_coach and (k not in ('clients','checkins','measurements','activity','photos','drafts') or (old.owner_id is not null and old.owner_id<>auth.uid())) then raise exception 'Access denied' using errcode='42501'; end if;
  if k in ('clients','client_private','drafts','supplements') then owner:=rid::uuid;
  elsif k in ('checkins','checkin_private','measurements','activity','photos','invoices') then owner:=coalesce(body->>'client_id',old.owner_id::text)::uuid;
  else owner:=null; end if;
  if old.owner_id is not null and owner is distinct from old.owner_id then raise exception 'Record owner cannot change'; end if;
  if not is_coach and owner is distinct from auth.uid() then raise exception 'Access denied' using errcode='42501'; end if;
  if owner is not null and not exists(select 1 from public.panda_accounts where user_id=owner and role='client') then raise exception 'Create the customer account first'; end if;
  if not is_coach and not panda_private.readable(k,rid,owner,coalesce(body,old.data)) then raise exception 'This area is not included in your package' using errcode='42501'; end if;
  if body is null or body='null'::jsonb then
   if k in ('clients','packages','programs','nutrition_plans','foods','settings') then raise exception 'Referenced records cannot be deleted'; end if;
   if not is_coach and k not in ('measurements','photos','activity','drafts') then raise exception 'This record cannot be removed' using errcode='42501'; end if;
   delete from public.panda_records where kind=k and id=rid;
   result:=result||jsonb_build_array(jsonb_build_object('kind',k,'id',rid,'revision',0)); continue;
  end if;
  if k not in ('settings','drafts') and (jsonb_typeof(body)<>'object' or body->>'id' is distinct from rid) then raise exception 'Invalid record identity'; end if;
  if k in ('programs','nutrition_plans') and coalesce(body->'versions','[]'::jsonb) <> '[]'::jsonb then raise exception 'Store plan history separately'; end if;
  if k='clients' then
   perform panda_private.validate_profile(body);
   if body ? 'coach_notes' or body ? 'supplements' then raise exception 'Private notes must be stored separately'; end if;
   if length(body->>'name') not between 1 and 80 or body->>'status' not in ('active','onboarding','paused','archived') then raise exception 'Invalid client profile'; end if;
   foreach f in array array['package_id','program_id','nutrition_id'] loop
    if not exists(select 1 from public.panda_records where kind=case f when 'package_id' then 'packages' when 'program_id' then 'programs' else 'nutrition_plans' end and id=body->>f) then raise exception 'Choose existing plans and package'; end if;
   end loop;
   if not is_coach then
    if old.id is null then raise exception 'Only the coach can create profiles'; end if;
    immutable:=array['name','email','location','goal','occupation','activity_level','preferences','allergies','limitations','sex','age','height','weight','goal_weight','favorites','read_articles','onboarding'];
    if (body-immutable) is distinct from (old.data-immutable) then raise exception 'Only your coach can change assignments and access' using errcode='42501'; end if;
   end if;
  elsif k='checkins' then
   if body ? 'coach_private' then raise exception 'Private feedback must be stored separately'; end if;
   if not is_coach then
    if old.id is not null then raise exception 'Submitted check-ins are read-only' using errcode='42501'; end if;
    if body->>'status' is distinct from 'submitted' or coalesce(body->>'coach_feedback','')<>'' or coalesce(body->>'reviewed_at','')<>'' then raise exception 'Coach review fields are protected' using errcode='42501'; end if;
   end if;
   foreach f in array array['energy','sleep_quality','hunger','digestion','stress'] loop
    if jsonb_typeof(body->f) is distinct from 'number' or (body->>f)::numeric not between 1 and 5 or (body->>f)::numeric<>trunc((body->>f)::numeric) then raise exception 'Invalid check-in rating'; end if;
   end loop;
   if (body->>'weight')::numeric not between 20 and 400 or (body->>'adherence')::numeric not between 0 and 100 or (body->>'sleep_hours')::numeric not between 0 and 24 then raise exception 'Invalid check-in values'; end if;
   if exists(select 1 from public.panda_records r where r.kind=k and r.owner_id=owner and r.id<>rid and date_trunc('week',(r.data->>'week')::date)=date_trunc('week',(body->>'week')::date)) then raise exception 'A check-in already exists for this week'; end if;
  elsif k in ('measurements','activity') then
   if exists(select 1 from public.panda_records r where r.kind=k and r.owner_id=owner and r.id<>rid and r.data->>'date'=body->>'date') then raise exception 'A record already exists for this date'; end if;
   if k='measurements' and jsonb_typeof(body->'values') is distinct from 'object' then raise exception 'Invalid measurement values'; end if;
   if k='activity' then
    foreach f in array array['steps','cardio','water','sleep'] loop
     if jsonb_typeof(body->f) is distinct from 'number' or (body->>f)::numeric<0 then raise exception 'Invalid activity value'; end if;
    end loop;
   end if;
  elsif k='photos' then
   if length(body->>'data')>500000 or (body->>'data') !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'Invalid progress photo'; end if;
  elsif k='settings' and rid not in ('brand','measurement_defs','exercise_edits','roadmap','strategy','swaps') then raise exception 'Unknown setting';
  elsif k='packages' and (jsonb_typeof(body->'features') is distinct from 'array' or not (body->'features' <@ '["training","library","nutrition","supplements","progress","checkins","activity","education","roadmap"]'::jsonb)) then raise exception 'Invalid package features';
  end if;
  if k='drafts' then
   if jsonb_typeof(body) is distinct from 'object' then raise exception 'Invalid draft'; end if;
   for f in select jsonb_object_keys(body) loop
    if not coalesce(panda_private.valid_text(body->f,6000),false) and not panda_private.valid_number(body->f,0,10000) then raise exception 'Invalid draft field'; end if;
   end loop;
  end if;
  if k='checkins' then
   if not panda_private.valid_number(body->'weight',20,400) or not panda_private.valid_number(body->'sleep_hours',0,24) or not panda_private.valid_number(body->'adherence',0,100) or not panda_private.valid_number(body->'training_days',0,7) or (body->>'training_days')::numeric<>trunc((body->>'training_days')::numeric) then raise exception 'Invalid check-in values'; end if;
   if body->>'status' not in ('submitted','reviewed') or body->>'week' is null or body->>'week' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid check-in week or status'; end if;
   perform (body->>'week')::date;
   foreach f in array array['training','nutrition','wins','challenges','questions','coach_feedback'] loop
    if body ? f and not coalesce(panda_private.valid_text(body->f,6000),false) then raise exception 'Invalid check-in feedback'; end if;
   end loop;
  end if;
  if k='measurements' then
   for f in select jsonb_object_keys(body->'values') loop
    if not exists(select 1 from public.panda_records r,jsonb_array_elements(r.data) d where r.kind='settings' and r.id='measurement_defs' and d->>'id'=f) then raise exception 'Unknown measurement'; end if;
    if f in ('blood_pressure','somatotype') then
     if not coalesce(panda_private.valid_text(body->'values'->f,100),false) then raise exception 'Invalid measurement text'; end if;
    elsif not panda_private.valid_number(body->'values'->f,case when f in ('weight','waist','height') then .1 else 0 end,case when f in ('weight','waist','height') then 1000 else 100000 end) then raise exception 'Invalid measurement value'; end if;
   end loop;
  end if;
  if k='activity' and (not panda_private.valid_number(body->'steps',0,100000) or not panda_private.valid_number(body->'cardio',0,1440) or not panda_private.valid_number(body->'water',0,15) or not panda_private.valid_number(body->'sleep',0,24)) then raise exception 'Invalid activity values'; end if;
  if k='photos' and (not coalesce(panda_private.valid_text(body->'pose',50),false) or not coalesce(panda_private.valid_text(body->'data',500000),false)) then raise exception 'Invalid photograph'; end if;
  if k in ('checkins','measurements','activity','photos') then
   if body->>'client_id' is distinct from owner::text then raise exception 'Invalid owner'; end if;
   stamp:=body->>'date';
   if stamp is null or stamp !~ '^\d{4}-\d{2}-\d{2}$' or stamp::date>current_date+1 then raise exception 'Invalid record date'; end if;
  end if;
  seq:=coalesce(old.revision,0)+1;
  insert into public.panda_records(kind,id,owner_id,data,revision) values(k,rid,owner,body,seq)
  on conflict(kind,id) do update set data=excluded.data,revision=excluded.revision,updated_at=now();
  -- Pausing/archiving blocks existing JWTs through the account row checked by RLS.
  if k='clients' and is_coach then update public.panda_accounts set active=(body->>'status' in ('active','onboarding')) where user_id=owner; end if;
  insert into public.panda_events(actor_id,owner_id,label) values(auth.uid(),owner,coalesce(label,'Saved changes'));
  result:=result||jsonb_build_array(jsonb_build_object('kind',k,'id',rid,'revision',seq));
 end loop;
 return result;
end $$;
revoke all on function public.panda_save(jsonb,text) from public,anon;
grant execute on function public.panda_save(jsonb,text) to authenticated;

-- Admin account creation is reserved for the server function's service key.
create function public.panda_register_client(uid uuid, login_name text, profile jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform panda_private.validate_profile(profile);
 if profile->>'id' is distinct from uid::text then raise exception 'Invalid profile ID'; end if;
 if not exists(select 1 from public.panda_records where kind='packages' and id=profile->>'package_id') or
    not exists(select 1 from public.panda_records where kind='programs' and id=profile->>'program_id') or
    not exists(select 1 from public.panda_records where kind='nutrition_plans' and id=profile->>'nutrition_id') then raise exception 'Assign existing plans and package'; end if;
 insert into public.panda_accounts(user_id,username,role,active,must_change_password) values(uid,login_name,'client',true,true);
 insert into public.panda_records(kind,id,owner_id,data) values
 ('clients',uid::text,uid,profile-array['coach_notes','supplements']),
 ('supplements',uid::text,uid,jsonb_build_object('id',uid::text,'items',coalesce(profile->'supplements','[]'::jsonb))),
 ('client_private',uid::text,uid,jsonb_build_object('id',uid::text,'coach_notes',coalesce(profile->>'coach_notes','')));
end $$;
revoke all on function public.panda_register_client(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.panda_register_client(uuid,text,jsonb) to service_role;
commit;
