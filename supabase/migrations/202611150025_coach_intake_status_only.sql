-- TRAIN WITH PANDA · Client intake: the coach may change the status only (INTAKE-DESIGN.md §3.1).
-- Before this migration the coach could write any intake content, and the server-set fields were
-- silently replaced. Now a coach write to client_intake must be one of:
--  - an existing intake, unchanged except for its status, which may only become 'reopened';
--  - a new intake for a client who has none: status 'reopened' and the empty skeleton.
-- Anything else is refused with a message naming what cannot be changed: an answer section, the
-- submission date (submitted_at), the profile snapshot (submitted_profile) or the health flag.
-- Leaving submitted_at, submitted_profile or health_flag out is not a change: the server keeps them.
-- Clients, the service role and direct writes are unaffected.
-- guard_client_intake() (023) is PATCHED in place at one anchor. Re-running 023 re-creates that
-- function without this patch: re-run 025 afterwards. Safe to re-run; no record is rewritten.
begin;

-- 1. Preflight ----------------------------------------------------------------------------------
do $migration$
declare def text; p text;
 save_prereq constant text[]:=array[
  'perform panda_private.validate_activity(body)',   -- 009
  '-- Panda hydration-only package guard.',           -- 010
  '-- Panda client intake: fixed event label.',       -- 023
  $p$'drafts','client_intake') or (old.owner_id$p$];  -- 023 patch B
 guard_prereq constant text[]:=array[
  $p$if auth.uid() is not null and not panda_private.coach() then$p$,
  $p$new.data:=new.data-'submitted_at'-'submitted_profile'-'health_flag';$p$,
  $p$perform panda_private.validate_client_intake(new.data,next_status='submitted');$p$];
 anchor constant text:=' -- Server-managed fields: whatever the caller sent is discarded.';
 marker constant text:='-- Panda client intake: coach may change the status only (025).';
begin
 if to_regprocedure('panda_private.guard_client_intake()') is null or to_regprocedure('panda_private.validate_client_intake(jsonb,boolean)') is null
    or to_regprocedure('panda_private.intake_shape(jsonb,text[])') is null then
  raise exception 'Migration 023 (client intake) is not installed; review migration 025';
 end if;
 if to_regprocedure('panda_private.stamp_client_archive()') is null
    or not exists(select 1 from pg_trigger t where t.tgrelid='public.panda_records'::regclass and t.tgname='panda_client_archived_at' and not t.tgisinternal) then
  raise exception 'Migration 024 (client archive date) is not installed; review migration 025';
 end if;
 if not exists(select 1 from pg_trigger t where t.tgrelid='public.panda_records'::regclass and t.tgname='panda_client_intake_guard' and not t.tgisinternal and t.tgenabled<>'D') then
  raise exception 'The client intake trigger (023) is missing or disabled; review migration 025';
 end if;
 select pg_get_functiondef('public.panda_save(jsonb,text)'::regprocedure) into def;
 foreach p in array save_prereq loop
  if position(p in def)=0 then raise exception 'panda_save is missing an earlier patch (%); review migration 025',left(p,80); end if;
 end loop;
 select pg_get_functiondef('panda_private.guard_client_intake()'::regprocedure) into def;
 foreach p in array guard_prereq loop
  if position(p in def)=0 then raise exception 'guard_client_intake() is not the version migration 025 expects (%); review migration 025',left(p,80); end if;
 end loop;
 if position(marker in def)=0 and (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 then
  raise exception 'Unexpected guard_client_intake() source; review migration 025';
 end if;
end $migration$;

-- 2. The rules ----------------------------------------------------------------------------------
-- The empty skeleton the portal sends (25-intake.js blank()): no answer given. Key sets are left
-- to validate_client_intake, which runs after this in the same trigger.
create or replace function panda_private.intake_is_blank(x jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(x)='object' and jsonb_typeof(x->'medical')='object' and jsonb_typeof(x->'medical'->'conditions')='object'
   and jsonb_typeof(x->'training')='object' and jsonb_typeof(x->'training'->'lifts')='object'
   and jsonb_typeof(x->'equipment')='object' and jsonb_typeof(x->'equipment'->'items')='object' then
  coalesce(
   x->'form_version'='1'::jsonb
   and x->'personal'='{"neck_cm":null,"waist_cm":null}'::jsonb
   and (select bool_and(v='null'::jsonb) from jsonb_each(x->'medical'->'conditions') e(k,v))
   and (x->'medical')-'conditions'='{"conditions_confirmed":null,"injuries_past_5_years":{"present":null,"details":""},"ongoing_aches":{"present":null,"details":""},"exercise_contraindications":{"present":null,"details":""},"medications":{"present":null,"details":""}}'::jsonb
   and (x->'training')-'lifts'='{"experience_years":null}'::jsonb
   and (select bool_and(v='{"type":"unknown","value":null,"unit":"kg","reps":null,"estimated":false}'::jsonb) from jsonb_each(x->'training'->'lifts') e(k,v))
   and x->'goals'='{"focus_muscles":[]}'::jsonb
   and x->'schedule'='{"days_per_week":null,"minutes_per_session":null}'::jsonb
   and (x->'equipment')-'items'='{"notes":""}'::jsonb
   and (select bool_and(v='{"available":null,"details":""}'::jsonb) from jsonb_each(x->'equipment'->'items') e(k,v))
   and x->'other'='{"notes":""}'::jsonb
   and x->'consent'='{"health_data":null}'::jsonb,false)
 else false end
$$;

-- A coach write: previous is the stored intake (null when there is none), incoming what was sent.
create or replace function panda_private.check_coach_intake(previous jsonb, incoming jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare
 sections constant text[][]:=array[['form_version','form version'],['personal','about you'],['medical','health screening'],
  ['training','training background'],['goals','goals'],['schedule','schedule'],['equipment','gym and equipment'],
  ['other','other notes'],['consent','health information consent']];
 next_status text; i int;
begin
 if jsonb_typeof(incoming) is distinct from 'object' then raise exception 'Invalid intake identity'; end if;
 next_status:=case when jsonb_typeof(incoming->'status')='string' then incoming->>'status' end;
 if previous is null then
  if next_status is distinct from 'reopened' then
   raise exception 'The coach can only create an intake as reopened, for the client to fill in.' using errcode='42501';
  end if;
  if incoming ? 'submitted_at' and incoming->'submitted_at'<>'null'::jsonb then
   raise exception 'The coach cannot set the submission date (submitted_at).' using errcode='42501';
  end if;
  if incoming ? 'submitted_profile' and incoming->'submitted_profile'<>'null'::jsonb then
   raise exception 'The coach cannot set the submitted profile snapshot (submitted_profile).' using errcode='42501';
  end if;
  if incoming ? 'health_flag' and incoming->'health_flag'<>'false'::jsonb then
   raise exception 'The coach cannot set the health flag (health_flag). The server sets it from the client''s answers.' using errcode='42501';
  end if;
  if not panda_private.intake_is_blank(incoming) then
   raise exception 'The coach cannot fill in intake answers. Open an empty intake for the client to complete.' using errcode='42501';
  end if;
  return;
 end if;
 if next_status is null or (next_status<>'reopened' and next_status is distinct from previous->>'status') then
  raise exception 'The coach can only reopen an intake. Only the client can save or submit it.' using errcode='42501';
 end if;
 if incoming ? 'submitted_at' and incoming->'submitted_at' is distinct from coalesce(previous->'submitted_at','null'::jsonb) then
  raise exception 'The coach cannot change the submission date (submitted_at).' using errcode='42501';
 end if;
 if incoming ? 'submitted_profile' and incoming->'submitted_profile' is distinct from coalesce(previous->'submitted_profile','null'::jsonb) then
  raise exception 'The coach cannot change the submitted profile snapshot (submitted_profile).' using errcode='42501';
 end if;
 if incoming ? 'health_flag' and incoming->'health_flag' is distinct from coalesce(previous->'health_flag','false'::jsonb) then
  raise exception 'The coach cannot change the health flag (health_flag). The server sets it from the client''s answers.' using errcode='42501';
 end if;
 for i in 1..array_length(sections,1) loop
  if incoming->sections[i][1] is distinct from previous->sections[i][1] then
   raise exception 'The coach cannot change intake answers (%). Reopen the intake so the client can update them.',sections[i][2] using errcode='42501';
  end if;
 end loop;
 -- Any other key is refused by validate_client_intake's strict shape.
end $$;
revoke all on function panda_private.intake_is_blank(jsonb),panda_private.check_coach_intake(jsonb,jsonb) from public,anon,authenticated;

-- 3. Patch guard_client_intake(): run the coach rules before the server fields are replaced ------
do $migration$
declare def text;
 anchor constant text:=' -- Server-managed fields: whatever the caller sent is discarded.';
 marker constant text:='-- Panda client intake: coach may change the status only (025).';
begin
 select pg_get_functiondef('panda_private.guard_client_intake()'::regprocedure) into def;
 if position(marker in def)=0 then
  execute replace(def,anchor,' '||marker||E'\n if auth.uid() is not null and panda_private.coach() then perform panda_private.check_coach_intake(previous,new.data); end if;\n'||anchor);
 end if;
end $migration$;

-- 4. Post-check ---------------------------------------------------------------------------------
do $migration$
declare def text; p text;
 marker constant text:='-- Panda client intake: coach may change the status only (025).';
begin
 select pg_get_functiondef('panda_private.guard_client_intake()'::regprocedure) into def;
 if (length(def)-length(replace(def,marker,'')))/length(marker)<>1
    or position('perform panda_private.check_coach_intake(previous,new.data);' in def)=0 then
  raise exception 'guard_client_intake() check failed after migration 025';
 end if;
 -- The coach rules must run before the server fields are stripped, and the client rules must stay.
 if position(marker in def)>position($p$new.data:=new.data-'submitted_at'-'submitted_profile'-'health_flag';$p$ in def) then
  raise exception 'guard_client_intake() patch is in the wrong place after migration 025';
 end if;
 foreach p in array array[$p$if auth.uid() is not null and not panda_private.coach() then$p$,$p$perform panda_private.validate_client_intake(new.data,next_status='submitted');$p$] loop
  if position(p in def)=0 then raise exception 'guard_client_intake() lost a 023 rule after migration 025 (%)',left(p,80); end if;
 end loop;
 if not exists(select 1 from pg_trigger t where t.tgrelid='public.panda_records'::regclass and t.tgname='panda_client_intake_guard' and not t.tgisinternal and t.tgenabled<>'D') then
  raise exception 'panda_client_intake_guard trigger check failed after migration 025';
 end if;
 if to_regprocedure('panda_private.check_coach_intake(jsonb,jsonb)') is null or to_regprocedure('panda_private.intake_is_blank(jsonb)') is null then
  raise exception 'Coach intake rule functions are missing after migration 025';
 end if;
end $migration$;
commit;
