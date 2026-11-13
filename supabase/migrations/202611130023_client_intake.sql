-- TRAIN WITH PANDA · Client intake questionnaire: the client_intake record kind (INTAKE-DESIGN.md).
-- One record per client: id = owner_id = the client's auth uuid. The coach and the owning client can
-- read it; no package feature is required. A client writes it while onboarding (as a draft) or after
-- the coach reopens it; submitting locks it again. Validation, the write window and the
-- server-managed fields (submitted_at, submitted_profile, health_flag) live in a trigger.
-- panda_save and readable() are PATCHED in place, never re-created from a file: their installed
-- bodies carry migrations 009, 010 and 014, which no single file contains.
-- Additive and safe to re-run: no customer record is rewritten.
begin;

-- 1. Record kinds and ownership -----------------------------------------------------------------
-- Preflight: the current lists must be exactly the ones this migration expects (022), or already
-- include client_intake (re-run). Anything else means a kind was added elsewhere: stop.
do $migration$
declare def text; have text[];
 old_kinds constant text[]:=array['clients','client_private','packages','foods','programs','nutrition_plans','checkins','checkin_private','measurements','activity','photos','articles','invoices','drafts','settings','plan_history','supplements','recipes','recipe_assignments','recipe_images','supplement_templates','supplement_references'];
 old_owned constant text[]:=array['clients','client_private','checkins','checkin_private','measurements','activity','photos','invoices','drafts','supplements','recipe_assignments'];
begin
 select pg_get_constraintdef(c.oid) into def from pg_constraint c where c.conrelid='public.panda_records'::regclass and c.conname='panda_records_kind_check';
 if def is null then raise exception 'panda_records_kind_check not found; review migration 023'; end if;
 select array_agg(m.r[1] order by m.r[1]) into have from regexp_matches(def,'''([a-z_]+)''','g') as m(r);
 if have=(select array_agg(x order by x) from unnest(old_kinds||'client_intake'::text) x) then null;
 elsif have=(select array_agg(x order by x) from unnest(old_kinds) x) then
  alter table public.panda_records drop constraint panda_records_kind_check;
  alter table public.panda_records add constraint panda_records_kind_check check (kind in ('clients','client_private','packages','foods','programs','nutrition_plans','checkins','checkin_private','measurements','activity','photos','articles','invoices','drafts','settings','plan_history','supplements','recipes','recipe_assignments','recipe_images','supplement_templates','supplement_references','client_intake'));
 else raise exception 'Unexpected record kinds in panda_records_kind_check: %; review migration 023',def;
 end if;

 select pg_get_constraintdef(c.oid) into def from pg_constraint c where c.conrelid='public.panda_records'::regclass and c.conname='panda_records_ownership_check';
 if def is null then raise exception 'panda_records_ownership_check not found; review migration 023'; end if;
 select array_agg(m.r[1] order by m.r[1]) into have from regexp_matches(def,'''([a-z_]+)''','g') as m(r);
 if have=(select array_agg(x order by x) from unnest(old_owned||'client_intake'::text) x) then null;
 elsif have=(select array_agg(x order by x) from unnest(old_owned) x) then
  alter table public.panda_records drop constraint panda_records_ownership_check;
  alter table public.panda_records add constraint panda_records_ownership_check check ((kind in ('clients','client_private','checkins','checkin_private','measurements','activity','photos','invoices','drafts','supplements','recipe_assignments','client_intake')) = (owner_id is not null));
 else raise exception 'Unexpected owned kinds in panda_records_ownership_check: %; review migration 023',def;
 end if;
end $migration$;

-- 2. readable(): the coach and the owning client, with no package check ------------------------
do $migration$
declare def text; p text;
 prereq constant text[]:=array[
  $p$panda_private.feature('activity') or panda_private.feature('nutrition')$p$,  -- 010
  $p$coalesce(panda_private.profile()->>'cardio_id','')$p$];                       -- 014
 marker constant text:=$m$if k='client_intake' then return true; end if; -- Panda client intake.$m$;
 orig constant text:=$o$if k in ('checkins','drafts') then return panda_private.feature('checkins'); end if;$o$;
begin
 select pg_get_functiondef('panda_private.readable(text,text,uuid,jsonb)'::regprocedure) into def;
 foreach p in array prereq loop
  if position(p in def)=0 then raise exception 'readable() is missing an earlier patch (%); review migration 023',p; end if;
 end loop;
 if position(marker in def)=0 then
  -- Owner branch: ownership is already checked against auth.uid() above this line.
  if (length(def)-length(replace(def,orig,'')))/length(orig)<>1 then raise exception 'Unexpected readable() source; review migration 023'; end if;
  execute replace(def,orig,marker||E'\n  '||orig);
  select pg_get_functiondef('panda_private.readable(text,text,uuid,jsonb)'::regprocedure) into def;
 end if;
 foreach p in array prereq||marker loop
  if position(p in def)=0 then raise exception 'readable() check failed after migration 023 (%)',p; end if;
 end loop;
end $migration$;

-- 3. panda_save: patches A (owner), B (client writes), C (no deletion), D (fixed event label) ---
do $migration$
declare def text; p text; i int;
 prereq constant text[]:=array[
  'perform panda_private.validate_activity(body)',   -- 009
  '-- Panda hydration-only package guard.'];          -- 010
 marker constant text:='-- Panda client intake: fixed event label.';
 origs constant text[]:=array[
  $a$if k in ('clients','client_private','drafts','supplements') then owner:=rid::uuid;$a$,
  $b$k not in ('clients','checkins','measurements','activity','photos','drafts')$b$,
  $c$if k in ('clients','packages','programs','nutrition_plans','foods','settings') then raise exception 'Referenced records cannot be deleted'; end if;$c$,
  $d$if length(label)>160 then raise exception 'Invalid change label'; end if;$d$];
 repls constant text[]:=array[
  $a$if k in ('clients','client_private','drafts','supplements','client_intake') then owner:=rid::uuid;$a$,
  $b$k not in ('clients','checkins','measurements','activity','photos','drafts','client_intake')$b$,
  $c$if k in ('clients','packages','programs','nutrition_plans','foods','settings','client_intake') then raise exception 'Referenced records cannot be deleted'; end if;$c$,
  $d$if length(label)>160 then raise exception 'Invalid change label'; end if;
 -- Panda client intake: fixed event label. Clients read their own panda_events, so a batch that
 -- touches client_intake never stores a caller-supplied label, which could carry intake answers.
 if exists(select 1 from jsonb_array_elements(changes) x where x->>'kind'='client_intake') then label:='Updated intake questionnaire'; end if;$d$];
begin
 select pg_get_functiondef('public.panda_save(jsonb,text)'::regprocedure) into def;
 foreach p in array prereq loop
  if position(p in def)=0 then raise exception 'panda_save is missing an earlier patch (%); review migration 023',p; end if;
 end loop;
 if position(marker in def)=0 then
  for i in 1..array_length(origs,1) loop
   if (length(def)-length(replace(def,origs[i],'')))/length(origs[i])<>1 then raise exception 'Unexpected panda_save source at patch %; review migration 023',chr(64+i); end if;
   def:=replace(def,origs[i],repls[i]);
  end loop;
  execute def;
  select pg_get_functiondef('public.panda_save(jsonb,text)'::regprocedure) into def;
 end if;
 foreach p in array prereq||marker||repls loop
  if position(p in def)=0 then raise exception 'panda_save check failed after migration 023 (%)',left(p,80); end if;
 end loop;
end $migration$;

-- 4. Validation ---------------------------------------------------------------------------------
-- An object with exactly these keys. CASE first: SQL AND does not promise to short-circuit.
create or replace function panda_private.intake_shape(o jsonb, keys text[]) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(o)='object' then
  coalesce((select count(*)=cardinality(keys) and bool_and(k=any(keys)) from jsonb_object_keys(o) k),false)
 else false end
$$;
create or replace function panda_private.intake_bool(v jsonb, required boolean) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='boolean' or (not required and jsonb_typeof(v)='null'),false)
$$;
-- A number in [lo, hi] that is a multiple of step, or JSON null when not required.
create or replace function panda_private.intake_number(v jsonb, lo numeric, hi numeric, step numeric, required boolean) returns boolean
language sql immutable set search_path='' as $$
 select case jsonb_typeof(v)
  when 'null' then not required
  when 'number' then (v::text)::numeric between lo and hi and mod((v::text)::numeric,step)=0
  else false end
$$;

-- Types and ranges are always checked; completeness only when submitting. Messages name the
-- question, never the answer.
create or replace function panda_private.validate_client_intake(b jsonb, submitting boolean) returns void
language plpgsql set search_path='' as $$
declare
 conditions constant text[]:=array['arthritis','back_pain','knee_pain','shin_splints','muscle_pain','foot_pain','light_headedness','chest_pain','epilepsy','diabetes','high_cholesterol','smoking','high_triglycerides','respiratory_disease','high_blood_pressure','coronary_disease','heart_disease','stroke','pregnancy','family_coronary_before_55'];
 disclosures constant text[]:=array['injuries_past_5_years','ongoing_aches','exercise_contraindications','medications'];
 lifts constant text[]:=array['squat','bench_press','deadlift'];
 equipment constant text[]:=array['barbells','dumbbells','squat_racks','benches','cable_machines','smith_machine','leg_press','glute_ham_raise','back_raise_45','cardio_equipment'];
 muscles constant text[]:=array['Chest','Back','Shoulders','Biceps','Triceps','Forearms','Core','Glutes','Quads','Hamstrings','Calves'];
 k text; x jsonb; v jsonb; lift_type text; hi numeric; picked text[]:='{}';
begin
 submitting:=coalesce(submitting,false);
 if octet_length(b::text)>65536 then raise exception 'The intake is too large'; end if;
 if not panda_private.intake_shape(b,array['id','form_version','status','submitted_at','submitted_profile','health_flag','personal','medical','training','goals','schedule','equipment','other','consent']) then raise exception 'Invalid intake structure'; end if;
 if not coalesce(panda_private.valid_text(b->'id',100),false) then raise exception 'Invalid intake identity'; end if;
 if b->'form_version' is distinct from '1'::jsonb then raise exception 'Unsupported intake form version'; end if;
 if jsonb_typeof(b->'status') is distinct from 'string' or b->>'status' not in ('draft','submitted','reopened') then raise exception 'Invalid intake status'; end if;
 if jsonb_typeof(b->'submitted_at') not in ('string','null') or jsonb_typeof(b->'submitted_profile') not in ('object','null') or jsonb_typeof(b->'health_flag') is distinct from 'boolean' then raise exception 'Invalid intake server fields'; end if;

 -- Personal (name, sex, age, height, weight and goal live on the clients record).
 x:=b->'personal';
 if not panda_private.intake_shape(x,array['neck_cm','waist_cm']) then raise exception 'Invalid personal details'; end if;
 if not panda_private.intake_number(x->'neck_cm',20,80,0.1,submitting) then raise exception 'Enter a neck measurement of 20–80 cm'; end if;
 if not panda_private.intake_number(x->'waist_cm',40,250,0.1,submitting) then raise exception 'Enter a waist measurement of 40–250 cm'; end if;

 -- Medical.
 x:=b->'medical';
 if not panda_private.intake_shape(x,array['conditions','conditions_confirmed','injuries_past_5_years','ongoing_aches','exercise_contraindications','medications']) then raise exception 'Invalid medical details'; end if;
 if not panda_private.intake_shape(x->'conditions',conditions) then raise exception 'Invalid medical conditions list'; end if;
 foreach k in array conditions loop
  if not panda_private.intake_bool(x->'conditions'->k,submitting) then raise exception 'Answer the medical condition: %',replace(k,'_',' '); end if;
 end loop;
 if not panda_private.intake_bool(x->'conditions_confirmed',submitting) or (submitting and x->'conditions_confirmed' is distinct from 'true'::jsonb) then raise exception 'Confirm the medical conditions list'; end if;
 foreach k in array disclosures loop
  v:=x->k;
  if not panda_private.intake_shape(v,array['present','details']) or not panda_private.intake_bool(v->'present',submitting) or not coalesce(panda_private.valid_text(v->'details',2000),false) then raise exception 'Answer the question: %',replace(k,'_',' '); end if;
  if submitting and v->'present'='true'::jsonb and length(btrim(v->>'details'))=0 then raise exception 'Add details for: %',replace(k,'_',' '); end if;
 end loop;

 -- Training history.
 x:=b->'training';
 if not panda_private.intake_shape(x,array['experience_years','lifts']) then raise exception 'Invalid training history'; end if;
 if not panda_private.intake_number(x->'experience_years',0,80,0.5,submitting) then raise exception 'Enter training experience of 0–80 years, in half years'; end if;
 if not panda_private.intake_shape(x->'lifts',lifts) then raise exception 'Invalid lifts'; end if;
 foreach k in array lifts loop
  v:=x->'lifts'->k;
  if not panda_private.intake_shape(v,array['type','value','unit','reps','estimated']) then raise exception 'Invalid % entry',replace(k,'_',' '); end if;
  lift_type:=case when jsonb_typeof(v->'type')='string' then v->>'type' end;
  if lift_type is null or lift_type not in ('1rm','working_set','unknown') then raise exception 'Choose a % type',replace(k,'_',' '); end if;
  if jsonb_typeof(v->'unit') is distinct from 'string' or v->>'unit' not in ('kg','lb') then raise exception 'Choose kg or lb for %',replace(k,'_',' '); end if;
  if jsonb_typeof(v->'estimated') is distinct from 'boolean' then raise exception 'Invalid % estimate',replace(k,'_',' '); end if;
  if lift_type='unknown' then
   if v->'value'<>'null'::jsonb then raise exception 'Leave the % weight empty when it is unknown',replace(k,'_',' '); end if;
   if v->'estimated'<>'false'::jsonb then raise exception 'An unknown % cannot be an estimate',replace(k,'_',' '); end if;
  else
   hi:=case v->>'unit' when 'kg' then 600 else 1300 end;
   if not panda_private.intake_number(v->'value',0.01,hi,0.01,submitting) then raise exception 'Enter a % weight above 0 and up to % %',replace(k,'_',' '),hi,v->>'unit'; end if;
  end if;
  if lift_type='working_set' then
   if not panda_private.intake_number(v->'reps',1,20,1,submitting) then raise exception 'Enter 1–20 reps for the % working set',replace(k,'_',' '); end if;
  elsif v->'reps'<>'null'::jsonb then raise exception 'Reps apply only to a % working set',replace(k,'_',' ');
  end if;
 end loop;

 -- Goals (the goal text itself is clients.goal).
 x:=b->'goals';
 if not panda_private.intake_shape(x,array['focus_muscles']) or jsonb_typeof(x->'focus_muscles') is distinct from 'array' or jsonb_array_length(x->'focus_muscles')>3 then raise exception 'Choose up to 3 focus muscle groups'; end if;
 for v in select value from jsonb_array_elements(x->'focus_muscles') loop
  if jsonb_typeof(v) is distinct from 'string' or not ((v#>>'{}')=any(muscles)) or (v#>>'{}')=any(picked) then raise exception 'Choose up to 3 different focus muscle groups from the list'; end if;
  picked:=picked||(v#>>'{}');
 end loop;

 -- Schedule (the client's availability, not the coach's training_days target).
 x:=b->'schedule';
 if not panda_private.intake_shape(x,array['days_per_week','minutes_per_session']) then raise exception 'Invalid schedule'; end if;
 if not panda_private.intake_number(x->'days_per_week',1,7,1,submitting) then raise exception 'Enter 1–7 training days per week'; end if;
 if not panda_private.intake_number(x->'minutes_per_session',10,240,1,submitting) then raise exception 'Enter 10–240 minutes per session'; end if;

 -- Equipment.
 x:=b->'equipment';
 if not panda_private.intake_shape(x,array['items','notes']) or not panda_private.intake_shape(x->'items',equipment) or not coalesce(panda_private.valid_text(x->'notes',2000),false) then raise exception 'Invalid equipment details'; end if;
 foreach k in array equipment loop
  v:=x->'items'->k;
  if not panda_private.intake_shape(v,array['available','details']) or not panda_private.intake_bool(v->'available',submitting) or not coalesce(panda_private.valid_text(v->'details',300),false) then raise exception 'Answer the equipment question: %',replace(k,'_',' '); end if;
 end loop;

 -- Other.
 if not panda_private.intake_shape(b->'other',array['notes']) or not coalesce(panda_private.valid_text(b->'other'->'notes',4000),false) then raise exception 'Invalid other notes'; end if;

 -- Consent: required to submit.
 if not panda_private.intake_shape(b->'consent',array['health_data']) or not panda_private.intake_bool(b->'consent'->'health_data',false) then raise exception 'Invalid consent answer'; end if;
 if submitting and b->'consent'->'health_data' is distinct from 'true'::jsonb then raise exception 'Agree to the health information consent before submitting'; end if;
end $$;

-- 5. Write window and server-managed fields -----------------------------------------------------
create or replace function panda_private.guard_client_intake() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous jsonb; profile jsonb; was text; next_status text; c jsonb; flag boolean;
begin
 -- panda_save upserts: BEFORE INSERT fires even when the row exists (see 012), so look it up.
 if tg_op='UPDATE' then previous:=old.data;
 else select r.data into previous from public.panda_records r where r.kind='client_intake' and r.id=new.id; end if;
 if jsonb_typeof(new.data) is distinct from 'object' or new.data->>'id' is distinct from new.id or new.owner_id::text is distinct from new.id then raise exception 'Invalid intake identity'; end if;
 was:=previous->>'status';
 next_status:=case when jsonb_typeof(new.data->'status')='string' then new.data->>'status' end;
 select r.data into profile from public.panda_records r where r.kind='clients' and r.id=new.id;
 -- Client sessions only. The service role has no auth.uid() (as in sync_client_access).
 if auth.uid() is not null and not panda_private.coach() then
  -- coalesce: with no intake yet (or no profile) a bare comparison is NULL, and NOT NULL never raises.
  if not coalesce((coalesce(was,'draft')='draft' and profile->>'status'='onboarding') or was='reopened',false) then
   raise exception '%',case when was='submitted' then 'Your intake has been submitted. Ask your coach to reopen it.' else 'Your intake is not open. Ask your coach to reopen it.' end using errcode='42501';
  end if;
  -- A reopened intake stays reopened until the client submits it: saving a draft must not
  -- close the window for a client who is no longer onboarding.
  if was='reopened' and next_status in ('draft','reopened') then
   next_status:='reopened';new.data:=jsonb_set(new.data,'{status}','"reopened"');
  elsif next_status is null or next_status not in ('draft','submitted') then raise exception 'Invalid intake status' using errcode='42501';
  end if;
 end if;
 -- Server-managed fields: whatever the caller sent is discarded.
 c:=new.data->'medical'->'conditions';
 flag:=coalesce(c->'chest_pain'='true'::jsonb,false) or coalesce(c->'heart_disease'='true'::jsonb,false)
  or coalesce(c->'stroke'='true'::jsonb,false) or coalesce(c->'coronary_disease'='true'::jsonb,false)
  or coalesce(c->'light_headedness'='true'::jsonb,false) or coalesce(c->'pregnancy'='true'::jsonb,false)
  or coalesce(new.data->'medical'->'exercise_contraindications'->'present'='true'::jsonb,false);
 new.data:=new.data-'submitted_at'-'submitted_profile'-'health_flag';
 if next_status='submitted' and was is distinct from 'submitted' then
  new.data:=new.data||jsonb_build_object('submitted_at',to_jsonb(now()),
   'submitted_profile',jsonb_build_object('name',profile->'name','sex',profile->'sex','age',profile->'age',
    'height',profile->'height','weight',profile->'weight','goal',profile->'goal'));
 else
  new.data:=new.data||jsonb_build_object('submitted_at',coalesce(previous->'submitted_at','null'::jsonb),
   'submitted_profile',coalesce(previous->'submitted_profile','null'::jsonb));
 end if;
 new.data:=new.data||jsonb_build_object('health_flag',flag);
 perform panda_private.validate_client_intake(new.data,next_status='submitted');
 return new;
end $$;
drop trigger if exists panda_client_intake_guard on public.panda_records;
create trigger panda_client_intake_guard before insert or update on public.panda_records
for each row when (new.kind='client_intake') execute function panda_private.guard_client_intake();

-- 6. Retention period (configurable; no deletion job yet) ---------------------------------------
-- settings/brand.intake_retention_months: whole months (1–120) to keep a client's intake after the
-- client is archived. Missing or null means no automatic deletion. Seeded once at 24 (2 years).
create or replace function panda_private.guard_intake_retention() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(new.data)='object' and new.data ? 'intake_retention_months' and new.data->'intake_retention_months'<>'null'::jsonb
    and not panda_private.intake_number(new.data->'intake_retention_months',1,120,1,true) then
  raise exception 'Intake retention must be a whole number of months from 1 to 120, or empty for no automatic deletion.';
 end if;
 return new;
end $$;
drop trigger if exists panda_intake_retention_guard on public.panda_records;
create trigger panda_intake_retention_guard before insert or update on public.panda_records
for each row when (new.kind='settings' and new.id='brand') execute function panda_private.guard_intake_retention();
-- For the future deletion job: the configured period, or null when none is set.
create or replace function panda_private.intake_retention_months() returns integer
language sql stable security definer set search_path='' as $$
 select case when jsonb_typeof(r.data->'intake_retention_months')='number' then (r.data->>'intake_retention_months')::integer end
 from public.panda_records r where r.kind='settings' and r.id='brand'
$$;
-- Bump the revision so a coach page loaded before this migration refreshes instead of saving the
-- brand record without the new key. Skipped on re-run, and never overrides the coach's value.
update public.panda_records set data=data||'{"intake_retention_months":24}'::jsonb,revision=revision+1,updated_at=now()
where kind='settings' and id='brand' and jsonb_typeof(data)='object' and not data ? 'intake_retention_months';

revoke all on function panda_private.intake_shape(jsonb,text[]),panda_private.intake_bool(jsonb,boolean),
 panda_private.intake_number(jsonb,numeric,numeric,numeric,boolean),panda_private.validate_client_intake(jsonb,boolean),
 panda_private.guard_client_intake(),panda_private.guard_intake_retention(),panda_private.intake_retention_months()
 from public,anon,authenticated;
commit;
