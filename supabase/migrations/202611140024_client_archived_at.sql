-- TRAIN WITH PANDA · Client archive timestamp (clients.archived_at), for intake retention.
-- settings/brand.intake_retention_months (023) counts from the day a client is archived. This
-- records that day. A trigger on the clients record sets data.archived_at when status changes to
-- 'archived', keeps it while the client stays archived, and removes the key when the client is
-- un-archived (any other status). The value is server-set only: whatever the coach, the client or
-- a direct write sends for archived_at is discarded.
-- No function is patched. panda_save and readable() are only checked, before and after, so this
-- migration stops if an earlier patch (009, 010, 014, 023) or the client-edit guard it relies on
-- has gone. No deletion job: see database/README.md.
-- Safe to re-run: clients already stamped keep their date.
begin;

-- 1. Preflight ----------------------------------------------------------------------------------
-- Clients cannot send archived_at: panda_save refuses client edits outside this exact list of
-- personal fields. Check that guard is still the one this migration was written against.
do $migration$
declare def text; p text;
 save_prereq constant text[]:=array[
  'perform panda_private.validate_activity(body)',                                    -- 009
  '-- Panda hydration-only package guard.',                                           -- 010
  '-- Panda client intake: fixed event label.',                                       -- 023
  $p$body->>'status' not in ('active','onboarding','paused','archived')$p$,
  $p$immutable:=array['name','email','location','goal','occupation','activity_level','preferences','allergies','limitations','sex','age','height','weight','goal_weight','favorites','read_articles','onboarding'];$p$,
  $p$if (body-immutable) is distinct from (old.data-immutable) then raise exception 'Only your coach can change assignments and access'$p$];
 read_prereq constant text[]:=array[
  $p$panda_private.feature('activity') or panda_private.feature('nutrition')$p$,      -- 010
  $p$coalesce(panda_private.profile()->>'cardio_id','')$p$,                           -- 014
  '-- Panda client intake.'];                                                         -- 023
begin
 if to_regprocedure('panda_private.guard_client_intake()') is null or to_regprocedure('panda_private.intake_retention_months()') is null then
  raise exception 'Migration 023 (client intake) is not installed; review migration 024';
 end if;
 select pg_get_functiondef('public.panda_save(jsonb,text)'::regprocedure) into def;
 foreach p in array save_prereq loop
  if position(p in def)=0 then raise exception 'panda_save is missing an expected check (%); review migration 024',left(p,80); end if;
 end loop;
 select pg_get_functiondef('panda_private.readable(text,text,uuid,jsonb)'::regprocedure) into def;
 foreach p in array read_prereq loop
  if position(p in def)=0 then raise exception 'readable() is missing an earlier patch (%); review migration 024',p; end if;
 end loop;
end $migration$;

-- 2. Server-set archive timestamp ---------------------------------------------------------------
create or replace function panda_private.stamp_client_archive() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous jsonb;
begin
 -- Panda client archive timestamp.
 if jsonb_typeof(new.data) is distinct from 'object' then return new; end if;
 -- panda_save upserts: BEFORE INSERT fires even when the row exists (see 012), so look it up.
 if tg_op='UPDATE' then previous:=old.data;
 else select r.data into previous from public.panda_records r where r.kind='clients' and r.id=new.id; end if;
 new.data:=new.data-'archived_at';
 if new.data->>'status'='archived' then
  -- Still archived: keep the original date. Newly archived (or never stamped): now.
  new.data:=new.data||jsonb_build_object('archived_at',
   case when previous->>'status'='archived' and jsonb_typeof(previous->'archived_at')='string'
    then previous->'archived_at' else to_jsonb(now()) end);
 end if;
 return new;
end $$;
revoke all on function panda_private.stamp_client_archive() from public,anon,authenticated;
drop trigger if exists panda_client_archived_at on public.panda_records;
create trigger panda_client_archived_at before insert or update on public.panda_records
for each row when (new.kind='clients') execute function panda_private.stamp_client_archive();

-- 3. Clients archived before this migration -----------------------------------------------------
-- Their archive date was never recorded. Start the retention clock now: the safe direction, since
-- data is kept longer and never deleted early. The trigger sets the value. The revision is not
-- bumped: a coach page holding the old row can still save it, and the trigger keeps this date.
-- Skipped on re-run.
update public.panda_records set data=data||jsonb_build_object('archived_at',to_jsonb(now()))
where kind='clients' and jsonb_typeof(data)='object' and data->>'status'='archived' and not data ? 'archived_at';

-- 4. Post-check ---------------------------------------------------------------------------------
do $migration$
declare def text; p text;
begin
 if not exists(select 1 from pg_trigger t where t.tgrelid='public.panda_records'::regclass and t.tgname='panda_client_archived_at' and not t.tgisinternal and t.tgenabled<>'D') then
  raise exception 'panda_client_archived_at trigger check failed after migration 024';
 end if;
 select pg_get_functiondef('panda_private.stamp_client_archive()'::regprocedure) into def;
 if position('-- Panda client archive timestamp.' in def)=0 then raise exception 'stamp_client_archive() check failed after migration 024'; end if;
 select pg_get_functiondef('public.panda_save(jsonb,text)'::regprocedure) into def;
 foreach p in array array['perform panda_private.validate_activity(body)','-- Panda hydration-only package guard.','-- Panda client intake: fixed event label.'] loop
  if position(p in def)=0 then raise exception 'panda_save check failed after migration 024 (%)',p; end if;
 end loop;
 select pg_get_functiondef('panda_private.readable(text,text,uuid,jsonb)'::regprocedure) into def;
 foreach p in array array[$p$panda_private.feature('activity') or panda_private.feature('nutrition')$p$,$p$coalesce(panda_private.profile()->>'cardio_id','')$p$,'-- Panda client intake.'] loop
  if position(p in def)=0 then raise exception 'readable() check failed after migration 024 (%)',p; end if;
 end loop;
 if exists(select 1 from public.panda_records r where r.kind='clients' and (r.data->>'status'='archived') <> (r.data ? 'archived_at')) then
  raise exception 'Client archive timestamps check failed after migration 024';
 end if;
end $migration$;
commit;
