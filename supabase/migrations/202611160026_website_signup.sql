-- TRAIN WITH PANDA · Website signup (SIGNUP-DESIGN.md).
-- After a payment the website asks the panda-signup Edge Function to create a client account and
-- return a one-time password-setup link. This migration adds:
--  1. validate_profile (PATCHED): age, height, weight and goal_weight may be JSON null unless the
--     client's status is 'active'. Activating a client still requires all four.
--  2. guard_client_intake (PATCHED): submitting the intake requires age, height and weight on the
--     clients record (they are null for website-created clients until the client answers).
--  3. Service-role-only tables: panda_signup_products (website slug -> package, plans, days),
--     panda_signups (one row per website order; order_ref is the idempotency key),
--     panda_setup_tokens (hashes of one-time setup tokens) and panda_signup_nonces (replay guard).
--  4. public.panda_extend_access(user_id, days): repeatable access extension. Signup calls it once,
--     when the client sets a password; renewals can call it again later.
--  5. The RPCs the Edge Function uses. All are security definer and executable by service_role only.
-- Patches follow the project rule: never re-create a patched function from an older file. Each patch
-- is applied in place at one anchor that must occur exactly once, after preflight checks, and is
-- skipped when its marker is already present. Safe to re-run. If 023 is ever re-run, re-run 025 and
-- then 026 afterwards: 023 re-creates guard_client_intake() without either patch.
begin;

-- 1. Preflight ----------------------------------------------------------------------------------
do $migration$
declare def text; p text;
 save_prereq constant text[]:=array[
  'perform panda_private.validate_activity(body)',                     -- 009
  '-- Panda hydration-only package guard.',                            -- 010
  '-- Panda client intake: fixed event label.',                        -- 023
  'perform panda_private.validate_profile(body);'];                    -- 003: the rule below reaches every save
 profile_anchor constant text:=$p$ if not panda_private.valid_number(b->'age',16,100) or (b->>'age')::numeric<>trunc((b->>'age')::numeric) or not panda_private.valid_number(b->'height',100,250) or not panda_private.valid_number(b->'weight',20,400) or not panda_private.valid_number(b->'goal_weight',20,400) then raise exception 'Invalid client measurements'; end if;$p$;
 profile_marker constant text:='-- Panda website signup: measurements may be null until the client is active (026).';
 intake_anchor constant text:=$p$ if next_status='submitted' and was is distinct from 'submitted' then$p$;
 intake_marker constant text:='-- Panda website signup: measurements are required to submit the intake (026).';
begin
 if to_regprocedure('public.panda_register_client(uuid,text,jsonb)') is null then
  raise exception 'panda_register_client is missing; review migration 026';
 end if;
 if to_regprocedure('panda_private.local_today(text,timestamp with time zone)') is null or to_regprocedure('panda_private.default_timezone()') is null
    or to_regprocedure('panda_private.sync_client_access()') is null then
  raise exception 'Migration 022 (client timezone) is not installed; review migration 026';
 end if;
 if to_regprocedure('panda_private.check_coach_intake(jsonb,jsonb)') is null then
  raise exception 'Migration 025 (coach intake rule) is not installed; review migration 026';
 end if;
 select pg_get_functiondef('public.panda_save(jsonb,text)'::regprocedure) into def;
 foreach p in array save_prereq loop
  if position(p in def)=0 then raise exception 'panda_save is missing an expected check (%); review migration 026',left(p,80); end if;
 end loop;
 select pg_get_functiondef('panda_private.validate_profile(jsonb)'::regprocedure) into def;
 -- 007's version: custom exercises are valid favourites.
 if position($p$id in ('catalogue_ids','exercise_edits')$p$ in def)=0 then
  raise exception 'validate_profile() is not the version migration 026 expects (007); review migration 026';
 end if;
 if position(profile_marker in def)=0 and (length(def)-length(replace(def,profile_anchor,'')))/length(profile_anchor)<>1 then
  raise exception 'Unexpected validate_profile() source; review migration 026';
 end if;
 select pg_get_functiondef('panda_private.guard_client_intake()'::regprocedure) into def;
 if position('-- Panda client intake: coach may change the status only (025).' in def)=0
    or position('perform panda_private.check_coach_intake(previous,new.data);' in def)=0 then
  raise exception 'guard_client_intake() lacks the 025 patch (re-run 025 after any re-run of 023); review migration 026';
 end if;
 if position(intake_marker in def)=0 and (length(def)-length(replace(def,intake_anchor,'')))/length(intake_anchor)<>1 then
  raise exception 'Unexpected guard_client_intake() source; review migration 026';
 end if;
end $migration$;

-- 2. Measurements may be null until the client is active ----------------------------------------
-- JSON null is accepted only while the status is not 'active'; a missing key is still refused.
create or replace function panda_private.valid_measure(v jsonb, lo numeric, hi numeric, whole boolean, status text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(case jsonb_typeof(v)
  when 'null' then status is distinct from 'active'
  when 'number' then (v::text)::numeric between lo and hi and (not whole or (v::text)::numeric=trunc((v::text)::numeric))
  else false end,false)
$$;
revoke all on function panda_private.valid_measure(jsonb,numeric,numeric,boolean,text) from public,anon;
grant execute on function panda_private.valid_measure(jsonb,numeric,numeric,boolean,text) to authenticated;

do $migration$
declare def text;
 anchor constant text:=$p$ if not panda_private.valid_number(b->'age',16,100) or (b->>'age')::numeric<>trunc((b->>'age')::numeric) or not panda_private.valid_number(b->'height',100,250) or not panda_private.valid_number(b->'weight',20,400) or not panda_private.valid_number(b->'goal_weight',20,400) then raise exception 'Invalid client measurements'; end if;$p$;
 marker constant text:='-- Panda website signup: measurements may be null until the client is active (026).';
begin
 select pg_get_functiondef('panda_private.validate_profile(jsonb)'::regprocedure) into def;
 if position(marker in def)=0 then
  execute replace(def,anchor,' '||marker||$p$
 if not panda_private.valid_measure(b->'age',16,100,true,b->>'status') or not panda_private.valid_measure(b->'height',100,250,false,b->>'status') or not panda_private.valid_measure(b->'weight',20,400,false,b->>'status') or not panda_private.valid_measure(b->'goal_weight',20,400,false,b->>'status') then raise exception 'Invalid client measurements'; end if;$p$);
 end if;
end $migration$;

-- 3. The intake cannot be submitted without age, height and weight ------------------------------
do $migration$
declare def text;
 anchor constant text:=$p$ if next_status='submitted' and was is distinct from 'submitted' then$p$;
 marker constant text:='-- Panda website signup: measurements are required to submit the intake (026).';
begin
 select pg_get_functiondef('panda_private.guard_client_intake()'::regprocedure) into def;
 if position(marker in def)=0 then
  execute replace(def,anchor,' '||marker||$p$
 if next_status='submitted' and was is distinct from 'submitted' and (jsonb_typeof(profile->'age') is distinct from 'number' or jsonb_typeof(profile->'height') is distinct from 'number' or jsonb_typeof(profile->'weight') is distinct from 'number') then
  raise exception 'Add your age, height and weight before submitting.';
 end if;
$p$||anchor);
 end if;
end $migration$;

-- 4. Tables (service role only) -----------------------------------------------------------------
-- Website product slug -> what the client gets. Maintained by the coach or administrator (SQL or the
-- Supabase table editor). Unknown or inactive slugs are refused; there is no default package.
create table if not exists public.panda_signup_products (
 slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
 package_id text not null,
 program_id text not null,
 nutrition_id text not null,
 cardio_id text,
 checkin_day text not null default 'Sunday' check (checkin_day in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
 access_days integer not null check (access_days between 1 and 3660),
 active boolean not null default true,
 updated_at timestamptz not null default now()
);
-- One row per website order. order_ref is the idempotency key.
create table if not exists public.panda_signups (
 order_ref text primary key check (order_ref ~ '^[A-Za-z0-9._:-]{1,100}$'),
 email_norm text not null check (length(email_norm) between 3 and 160 and email_norm=lower(btrim(email_norm))),
 name text not null check (length(btrim(name)) between 1 and 80),
 slug text not null,
 package_id text,
 access_days integer check (access_days between 1 and 3660),
 request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
 username text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
 user_id uuid not null unique,
 state text not null default 'claimed' check (state in ('claimed','created','completed','failed')),
 paid_at timestamptz not null,
 amount numeric check (amount>=0),
 currency text check (currency ~ '^[A-Z]{3}$'),
 -- Access starts when the client sets a password (panda_setup_finish). A later job (not built) may
 -- start it at access_start_due_at, 14 days after payment, for clients who never set one.
 access_started_at timestamptz,
 access_start_due_at timestamptz not null,
 attempts integer not null default 1,
 last_error_code text check (length(last_error_code)<=200),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists panda_signups_email on public.panda_signups(email_norm);
create index if not exists panda_signups_access_due on public.panda_signups(access_start_due_at) where access_started_at is null;
-- Setup tokens: only the SHA-256 of each token is stored.
create table if not exists public.panda_setup_tokens (
 id uuid primary key,
 user_id uuid not null references public.panda_accounts(user_id) on delete cascade,
 token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
 purpose text not null check (purpose in ('website_signup','resend')),
 order_ref text references public.panda_signups(order_ref) on delete cascade,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 consumed_at timestamptz,
 finished_at timestamptz,
 revoked_at timestamptz
);
-- At most one usable token per client.
create unique index if not exists panda_setup_tokens_live on public.panda_setup_tokens(user_id) where consumed_at is null and revoked_at is null;
-- Request nonces seen in the last 15 minutes (the signature window is 5).
create table if not exists public.panda_signup_nonces (
 nonce text primary key check (nonce ~ '^[A-Za-z0-9_-]{16,128}$'),
 seen_at timestamptz not null default now()
);
alter table public.panda_signup_products enable row level security;
alter table public.panda_signups enable row level security;
alter table public.panda_setup_tokens enable row level security;
alter table public.panda_signup_nonces enable row level security;
revoke all on public.panda_signup_products, public.panda_signups, public.panda_setup_tokens, public.panda_signup_nonces from public, anon, authenticated;
grant select, insert, update, delete on public.panda_signup_products, public.panda_signups, public.panda_setup_tokens, public.panda_signup_nonces to service_role;

-- Seed mapping. Default plans are the seeded published ones (as blankProfile() in 16-cloud.js);
-- the coach can change them. Existing rows are never overwritten.
insert into public.panda_signup_products(slug,package_id,program_id,nutrition_id,checkin_day,access_days) values
 ('level-1-4-weeks','essential','plan_strength','nutrition_balanced','Sunday',28),
 ('level-1-12-weeks','essential','plan_strength','nutrition_balanced','Sunday',84),
 ('level-2-4-weeks','nutrition_only','plan_strength','nutrition_balanced','Sunday',28),
 ('level-2-12-weeks','nutrition_only','plan_strength','nutrition_balanced','Sunday',84),
 ('level-3-4-weeks','coaching','plan_strength','nutrition_balanced','Sunday',28),
 ('level-3-12-weeks','coaching','plan_strength','nutrition_balanced','Sunday',84)
on conflict (slug) do nothing;

-- 5. Access extension (repeatable) --------------------------------------------------------------
-- Adds `days` days of access. From the current expiry if it has not passed yet; otherwise starting
-- today in the client's timezone (today counts as day 1). Writes clients.access_expires_on, which
-- the 022 trigger copies to panda_accounts, and moves end_date forward (never back).
create or replace function public.panda_extend_access(user_id uuid, days integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=panda_extend_access.user_id; n integer:=panda_extend_access.days;
 acc public.panda_accounts; prof jsonb; tz text; today date; cur date; expires date; ends date;
begin
 if n is null or n<1 or n>3660 then raise exception 'Access can be extended by 1 to 3660 days.'; end if;
 select * into acc from public.panda_accounts a where a.user_id=uid and a.role='client' for update;
 if acc.user_id is null then raise exception 'Choose an existing client.'; end if;
 select r.data into prof from public.panda_records r where r.kind='clients' and r.id=uid::text for update;
 if prof is null then raise exception 'The client profile is missing.'; end if;
 tz:=coalesce(acc.timezone,panda_private.default_timezone());
 today:=panda_private.local_today(tz);
 cur:=nullif(btrim(coalesce(prof->>'access_expires_on','')),'')::date;
 expires:=case when cur is null or cur<today then today-1 else cur end+n;
 ends:=greatest(coalesce(case when prof->>'end_date' ~ '^\d{4}-\d{2}-\d{2}$' then (prof->>'end_date')::date end,expires),expires);
 update public.panda_records r set data=r.data||jsonb_build_object('access_expires_on',to_char(expires,'YYYY-MM-DD'),'end_date',to_char(ends,'YYYY-MM-DD')),
  revision=r.revision+1,updated_at=now()
 where r.kind='clients' and r.id=uid::text;
 return jsonb_build_object('user_id',uid,'previous_expires_on',cur,'access_expires_on',expires,'days',n,'timezone',tz);
end $$;

-- 6. Edge Function RPCs -------------------------------------------------------------------------
-- Why a product mapping cannot be used right now (null when it can).
create or replace function panda_private.signup_product_problem(p public.panda_signup_products) returns text
language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 select x.data into r from public.panda_records x where x.kind='packages' and x.id=p.package_id;
 if r is null then return 'Package '||p.package_id||' does not exist.'; end if;
 if r->'archived'='true'::jsonb then return 'Package '||p.package_id||' is archived.'; end if;
 select x.data into r from public.panda_records x where x.kind='programs' and x.id=p.program_id;
 if r is null or r->>'status' is distinct from 'published' or r->>'plan_type'='cardio' then return 'Training plan '||p.program_id||' is missing, not published or a cardio plan.'; end if;
 r:=null;select x.data into r from public.panda_records x where x.kind='nutrition_plans' and x.id=p.nutrition_id;
 if r is null or r->>'status' is distinct from 'published' then return 'Nutrition plan '||p.nutrition_id||' is missing or not published.'; end if;
 if p.cardio_id is not null then
  r:=null;select x.data into r from public.panda_records x where x.kind='programs' and x.id=p.cardio_id;
  if r is null or r->>'status' is distinct from 'published' or r->>'plan_type' is distinct from 'cardio' then return 'Cardio plan '||p.cardio_id||' is missing, not published or not a cardio plan.'; end if;
 end if;
 return null;
end $$;

-- Replay guard for signed website requests.
create or replace function public.panda_signup_nonce(p_nonce text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 delete from public.panda_signup_nonces where seen_at<now()-interval '15 minutes';
 insert into public.panda_signup_nonces(nonce) values(p_nonce) on conflict do nothing;
 return found;
end $$;

-- Claim an order (or find it again). Returns {code}: proceed | already_created | in_progress |
-- order_conflict | email_exists | unknown_package | portal_configuration | rate_limited.
create or replace function public.panda_signup_begin(p_order_ref text, p_email text, p_name text, p_slug text, p_request_hash text,
 p_paid_at timestamptz, p_amount numeric, p_currency text, p_max_per_hour integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.panda_signups; p public.panda_signup_products; t public.panda_setup_tokens; existing boolean; problem text; base text; candidate text; i integer;
begin
 -- Signups are rare: one lock serialises every claim, so duplicate webhooks and two orders for the
 -- same email cannot both pass the checks below.
 perform pg_advisory_xact_lock(hashtext('panda_signup'));
 select * into s from public.panda_signups where order_ref=p_order_ref for update;
 existing:=s.order_ref is not null;
 if existing then
  if s.request_hash<>p_request_hash then return jsonb_build_object('code','order_conflict'); end if;
  if s.state in ('created','completed') then
   select * into t from public.panda_setup_tokens x where x.order_ref=s.order_ref and x.revoked_at is null order by x.created_at desc limit 1;
   return jsonb_build_object('code','already_created','username',s.username,'package_id',s.package_id,'completed',s.state='completed',
    'token_id',case when t.id is not null and t.consumed_at is null and t.expires_at>now() then t.id end,
    'token_expires_at',case when t.id is not null and t.consumed_at is null and t.expires_at>now() then t.expires_at end);
  end if;
  if s.state='claimed' and s.updated_at>now()-interval '2 minutes' then return jsonb_build_object('code','in_progress'); end if;
 else
  if p_max_per_hour is not null and (select count(*) from public.panda_signups where created_at>now()-interval '1 hour')>=p_max_per_hour then
   return jsonb_build_object('code','rate_limited');
  end if;
  if exists(select 1 from public.panda_records r where r.kind='clients' and lower(btrim(r.data->>'email'))=p_email)
     or exists(select 1 from public.panda_signups x where x.email_norm=p_email and x.state<>'failed') then
   return jsonb_build_object('code','email_exists');
  end if;
 end if;
 select * into p from public.panda_signup_products x where x.slug=p_slug and x.active;
 if p.slug is null then return jsonb_build_object('code','unknown_package'); end if;
 problem:=panda_private.signup_product_problem(p);
 if problem is not null then
  if existing then update public.panda_signups set state='failed',last_error_code='portal_configuration',updated_at=now() where order_ref=p_order_ref; end if;
  return jsonb_build_object('code','portal_configuration','reason',problem);
 end if;
 if existing then
  -- A stale claim or a failed attempt: resume with the same user id and username.
  update public.panda_signups set state='claimed',attempts=attempts+1,package_id=p.package_id,access_days=p.access_days,last_error_code=null,updated_at=now()
  where order_ref=p_order_ref;
  return jsonb_build_object('code','proceed','user_id',s.user_id,'username',s.username,'resume',true);
 end if;
 -- Username: a cleaned prefix of the email's local part plus four random digits.
 base:=left(regexp_replace(regexp_replace(lower(split_part(p_email,'@',1)),'[^a-z0-9._-]','','g'),'^[^a-z0-9]+',''),20);
 if length(base)<2 then base:='client'; end if;
 for i in 1..50 loop
  candidate:=base||'-'||lpad(floor(random()*10000)::integer::text,4,'0');
  exit when not exists(select 1 from public.panda_accounts a where a.username=candidate) and not exists(select 1 from public.panda_signups x where x.username=candidate);
  candidate:=null;
 end loop;
 if candidate is null then candidate:='client-'||substr(md5(random()::text),1,12); end if;
 insert into public.panda_signups(order_ref,email_norm,name,slug,package_id,access_days,request_hash,username,user_id,paid_at,amount,currency,access_start_due_at)
 values(p_order_ref,p_email,p_name,p_slug,p.package_id,p.access_days,p_request_hash,candidate,gen_random_uuid(),p_paid_at,p_amount,p_currency,p_paid_at+interval '14 days')
 returning * into s;
 return jsonb_build_object('code','proceed','user_id',s.user_id,'username',s.username,'resume',false);
end $$;

-- Record a failure outside the database (for example Auth refusing the user).
create or replace function public.panda_signup_failed(p_order_ref text, p_code text) returns void
language sql security definer set search_path='' as $$
 update public.panda_signups set state='failed',last_error_code=left(p_code,200),updated_at=now() where order_ref=p_order_ref and state='claimed'
$$;

-- Create the portal account for a claimed order (the Auth user already exists) and its setup token.
-- One transaction. Refusals return {code} and mark the claim 'failed', so the caller removes the
-- Auth user; nothing of the account remains.
create or replace function public.panda_signup_register(p_order_ref text, p_token_id uuid, p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.panda_signups; p public.panda_signup_products; problem text; profile jsonb; today date; expires timestamptz; state_code text;
begin
 perform pg_advisory_xact_lock(hashtext('panda_signup'));
 select * into s from public.panda_signups where order_ref=p_order_ref for update;
 if s.order_ref is null or s.state<>'claimed' then return jsonb_build_object('code','invalid_state','state',s.state); end if;
 select * into p from public.panda_signup_products x where x.slug=s.slug and x.active;
 if p.slug is null then
  update public.panda_signups set state='failed',last_error_code='unknown_package',updated_at=now() where order_ref=p_order_ref;
  return jsonb_build_object('code','unknown_package');
 end if;
 problem:=panda_private.signup_product_problem(p);
 if problem is not null then
  update public.panda_signups set state='failed',last_error_code='portal_configuration',updated_at=now() where order_ref=p_order_ref;
  return jsonb_build_object('code','portal_configuration','reason',problem);
 end if;
 today:=panda_private.local_today(panda_private.default_timezone());
 -- The full profile shape the portal uses (blankProfile() in 16-cloud.js), so the coach's
 -- validate() accepts it. Measurements stay null until the client answers the intake.
 profile:=jsonb_build_object('id',s.user_id::text,'name',btrim(s.name),'email',s.email_norm,'location','','age',null,'sex','Not specified',
  'height',null,'weight',null,'goal_weight',null,'goal','','occupation','','activity_level','','preferences','','allergies','','limitations','',
  'package_id',p.package_id,'program_id',p.program_id,'nutrition_id',p.nutrition_id,'status','onboarding',
  'start_date',to_char(today,'YYYY-MM-DD'),'end_date',to_char(today+p.access_days-1,'YYYY-MM-DD'),'checkin_day',p.checkin_day,
  'training_days',3,'steps_target',8000,'sleep_target',8,'cardio_minutes',0,'cardio_days',0,'coach_notes','','supplements','[]'::jsonb,
  'favorites','[]'::jsonb,'read_articles','[]'::jsonb,'onboarding',jsonb_build_object('profile',false,'guidelines',false,'plans',false));
 if p.cardio_id is not null then profile:=profile||jsonb_build_object('cardio_id',p.cardio_id); end if;
 begin
  perform public.panda_register_client(s.user_id,s.username,profile);
  insert into public.panda_setup_tokens(id,user_id,token_hash,purpose,order_ref,expires_at)
  values(p_token_id,s.user_id,p_token_hash,'website_signup',s.order_ref,now()+interval '48 hours') returning expires_at into expires;
 exception when others then
  -- Plan or package rules (raise exception) are configuration; anything else is unexpected.
  state_code:=case when sqlstate='P0001' then 'portal_configuration' else 'register_failed' end;
  update public.panda_signups set state='failed',last_error_code=left(state_code||': '||sqlerrm,200),updated_at=now() where order_ref=p_order_ref;
  return jsonb_build_object('code',state_code,'reason',sqlerrm);
 end;
 update public.panda_signups set state='created',package_id=p.package_id,access_days=p.access_days,last_error_code=null,updated_at=now() where order_ref=p_order_ref;
 -- Housekeeping: used, replaced or expired tokens older than 30 days.
 delete from public.panda_setup_tokens where created_at<now()-interval '30 days' and (consumed_at is not null or revoked_at is not null or expires_at<now());
 return jsonb_build_object('code','created','username',s.username,'package_id',p.package_id,'token_expires_at',expires);
end $$;

-- A new setup link for an order whose client has not set a password. Earlier links stop working.
create or replace function public.panda_signup_resend(p_order_ref text, p_token_id uuid, p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.panda_signups; expires timestamptz;
begin
 perform pg_advisory_xact_lock(hashtext('panda_signup'));
 select * into s from public.panda_signups where order_ref=p_order_ref for update;
 if s.order_ref is null or s.state='failed' then return jsonb_build_object('code','not_found'); end if;
 if s.state='completed' then return jsonb_build_object('code','setup_completed'); end if;
 if s.state<>'created' then return jsonb_build_object('code','in_progress'); end if;
 update public.panda_setup_tokens set revoked_at=now() where user_id=s.user_id and revoked_at is null and finished_at is null;
 insert into public.panda_setup_tokens(id,user_id,token_hash,purpose,order_ref,expires_at)
 values(p_token_id,s.user_id,p_token_hash,'resend',s.order_ref,now()+interval '48 hours') returning expires_at into expires;
 return jsonb_build_object('code','resent','username',s.username,'token_expires_at',expires);
end $$;

-- Shared token checks. A token that was consumed but whose setup did not finish (an outage between
-- the steps of complete_setup) may be used again until it expires.
create or replace function panda_private.setup_token_state(t public.panda_setup_tokens, a public.panda_accounts) returns text
language sql stable set search_path='' as $$
 select case
  when t.id is null or t.revoked_at is not null then 'token_invalid'
  when t.finished_at is not null then 'token_used'
  when t.expires_at<=now() then 'token_expired'
  when a.user_id is null or a.role<>'client' then 'token_invalid'
  when not a.active then 'account_inactive'
  when not a.must_change_password then 'token_used'
  else 'ok' end
$$;

-- Read-only: is this token usable, and for which username? Consumes nothing.
create or replace function public.panda_setup_check(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.panda_setup_tokens; a public.panda_accounts; state text;
begin
 select * into t from public.panda_setup_tokens where token_hash=p_token_hash;
 select * into a from public.panda_accounts x where x.user_id=t.user_id;
 state:=panda_private.setup_token_state(t,a);
 if state<>'ok' then return jsonb_build_object('code',state); end if;
 return jsonb_build_object('code','ok','username',a.username,'expires_at',t.expires_at);
end $$;

-- Step 1 of complete_setup: mark the token consumed.
create or replace function public.panda_setup_consume(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.panda_setup_tokens; a public.panda_accounts; state text;
begin
 select * into t from public.panda_setup_tokens where token_hash=p_token_hash for update;
 select * into a from public.panda_accounts x where x.user_id=t.user_id;
 state:=panda_private.setup_token_state(t,a);
 if state<>'ok' then return jsonb_build_object('code',state); end if;
 update public.panda_setup_tokens set consumed_at=coalesce(consumed_at,now()) where id=t.id;
 return jsonb_build_object('code','ok','user_id',t.user_id,'username',a.username);
end $$;

-- Undo step 1 when the password could not be set, so an outage does not burn the link.
create or replace function public.panda_setup_release(p_token_hash text) returns void
language sql security definer set search_path='' as $$
 update public.panda_setup_tokens set consumed_at=null where token_hash=p_token_hash and finished_at is null and revoked_at is null
$$;

-- Step 3 of complete_setup (after the password is set): open the account and start access.
-- Idempotent. The session cutoff is truncated to the second because JWT iat is in whole seconds:
-- the client's sign-in right after this must not fall before it.
create or replace function public.panda_setup_finish(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.panda_setup_tokens; s public.panda_signups; extended jsonb; today date; tz text;
begin
 select * into t from public.panda_setup_tokens where token_hash=p_token_hash for update;
 if t.id is null or t.consumed_at is null or t.revoked_at is not null then return jsonb_build_object('code','token_invalid'); end if;
 if t.finished_at is null then
  update public.panda_accounts set must_change_password=false,session_cutoff=date_trunc('second',now()) where user_id=t.user_id;
  update public.panda_setup_tokens set finished_at=now() where id=t.id;
 end if;
 select * into s from public.panda_signups where order_ref=t.order_ref for update;
 if s.order_ref is not null and s.access_started_at is null then
  -- The access period starts now: start_date is today in the client's timezone.
  select coalesce(a.timezone,panda_private.default_timezone()) into tz from public.panda_accounts a where a.user_id=t.user_id;
  today:=panda_private.local_today(tz);
  update public.panda_records r set data=r.data||jsonb_build_object('start_date',to_char(today,'YYYY-MM-DD')),revision=r.revision+1,updated_at=now()
  where r.kind='clients' and r.id=t.user_id::text;
  extended:=public.panda_extend_access(t.user_id,s.access_days);
  update public.panda_signups set state='completed',access_started_at=now(),updated_at=now() where order_ref=s.order_ref;
 end if;
 return jsonb_build_object('code','ok','access_expires_on',(select a.access_expires_on from public.panda_accounts a where a.user_id=t.user_id));
end $$;

revoke all on function public.panda_extend_access(uuid,integer), public.panda_signup_nonce(text),
 public.panda_signup_begin(text,text,text,text,text,timestamptz,numeric,text,integer), public.panda_signup_failed(text,text),
 public.panda_signup_register(text,uuid,text), public.panda_signup_resend(text,uuid,text), public.panda_setup_check(text),
 public.panda_setup_consume(text), public.panda_setup_release(text), public.panda_setup_finish(text),
 panda_private.signup_product_problem(public.panda_signup_products),
 panda_private.setup_token_state(public.panda_setup_tokens,public.panda_accounts) from public, anon, authenticated;
grant execute on function public.panda_extend_access(uuid,integer), public.panda_signup_nonce(text),
 public.panda_signup_begin(text,text,text,text,text,timestamptz,numeric,text,integer), public.panda_signup_failed(text,text),
 public.panda_signup_register(text,uuid,text), public.panda_signup_resend(text,uuid,text), public.panda_setup_check(text),
 public.panda_setup_consume(text), public.panda_setup_release(text), public.panda_setup_finish(text) to service_role;

-- 7. Post-check ---------------------------------------------------------------------------------
do $migration$
declare def text; p text; tbl text; fn text;
 profile_marker constant text:='-- Panda website signup: measurements may be null until the client is active (026).';
 intake_marker constant text:='-- Panda website signup: measurements are required to submit the intake (026).';
begin
 select pg_get_functiondef('panda_private.validate_profile(jsonb)'::regprocedure) into def;
 if (length(def)-length(replace(def,profile_marker,'')))/length(profile_marker)<>1 or position($p$panda_private.valid_measure(b->'goal_weight',20,400,false,b->>'status')$p$ in def)=0
    or position($p$panda_private.valid_number(b->'age',16,100)$p$ in def)>0 or position($p$id in ('catalogue_ids','exercise_edits')$p$ in def)=0 then
  raise exception 'validate_profile() check failed after migration 026';
 end if;
 select pg_get_functiondef('panda_private.guard_client_intake()'::regprocedure) into def;
 if (length(def)-length(replace(def,intake_marker,'')))/length(intake_marker)<>1 then raise exception 'guard_client_intake() check failed after migration 026'; end if;
 -- 023's rules and 025's patch must have survived.
 foreach p in array array['-- Panda client intake: coach may change the status only (025).','perform panda_private.check_coach_intake(previous,new.data);',
  $p$if auth.uid() is not null and not panda_private.coach() then$p$,$p$perform panda_private.validate_client_intake(new.data,next_status='submitted');$p$] loop
  if position(p in def)=0 then raise exception 'guard_client_intake() lost an earlier rule after migration 026 (%)',left(p,80); end if;
 end loop;
 if position(intake_marker in def)>position($p$ if next_status='submitted' and was is distinct from 'submitted' then$p$ in def) then
  raise exception 'guard_client_intake() patch is in the wrong place after migration 026';
 end if;
 select pg_get_functiondef('public.panda_save(jsonb,text)'::regprocedure) into def;
 foreach p in array array['perform panda_private.validate_activity(body)','-- Panda hydration-only package guard.','-- Panda client intake: fixed event label.'] loop
  if position(p in def)=0 then raise exception 'panda_save check failed after migration 026 (%)',p; end if;
 end loop;
 foreach tbl in array array['panda_signup_products','panda_signups','panda_setup_tokens','panda_signup_nonces'] loop
  if not (select c.relrowsecurity from pg_class c where c.oid=('public.'||tbl)::regclass) then raise exception 'RLS is off on % after migration 026',tbl; end if;
  foreach p in array array['anon','authenticated'] loop
   if has_table_privilege(p,'public.'||tbl,'select') or has_table_privilege(p,'public.'||tbl,'insert') or has_table_privilege(p,'public.'||tbl,'update') or has_table_privilege(p,'public.'||tbl,'delete') then
    raise exception '% can access % after migration 026',p,tbl;
   end if;
  end loop;
 end loop;
 foreach fn in array array['public.panda_extend_access(uuid,integer)','public.panda_signup_nonce(text)','public.panda_signup_begin(text,text,text,text,text,timestamptz,numeric,text,integer)',
  'public.panda_signup_failed(text,text)','public.panda_signup_register(text,uuid,text)','public.panda_signup_resend(text,uuid,text)','public.panda_setup_check(text)',
  'public.panda_setup_consume(text)','public.panda_setup_release(text)','public.panda_setup_finish(text)'] loop
  if has_function_privilege('anon',fn,'execute') or has_function_privilege('authenticated',fn,'execute') or not has_function_privilege('service_role',fn,'execute') then
   raise exception 'Unexpected execute privilege on % after migration 026',fn;
  end if;
 end loop;
 if (select count(*) from public.panda_signup_products where slug in ('level-1-4-weeks','level-1-12-weeks','level-2-4-weeks','level-2-12-weeks','level-3-4-weeks','level-3-12-weeks'))<>6 then
  raise exception 'Product mapping seed check failed after migration 026';
 end if;
end $migration$;
commit;
