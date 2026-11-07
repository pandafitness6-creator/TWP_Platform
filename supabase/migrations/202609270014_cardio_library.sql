-- TRAIN WITH PANDA · library update 27.09.2026
-- 1. Clients may read a cardio plan assigned separately from their training plan (clients.cardio_id → programs).
-- 2. The assignment guard requires a published cardio plan; an empty cardio_id removes the plan.
-- 3. The new catalogue exercise IDs (HIIT, warm-up, cool-down) become valid saved favourites.
-- Additive: no records are rewritten except the catalogue_ids setting, which only grows.
begin;
do $migration$
declare definition text; original text; replacement text;
begin
 select pg_get_functiondef('panda_private.readable(text,text,uuid,jsonb)'::regprocedure) into definition;
 original:=$old$if k='programs' then return panda_private.feature('training') and rid=panda_private.profile()->>'program_id' and body->>'status'='published'; end if;$old$;
 replacement:=$new$if k='programs' then return panda_private.feature('training') and (rid=panda_private.profile()->>'program_id' or rid=coalesce(panda_private.profile()->>'cardio_id','')) and body->>'status'='published'; end if;$new$;
 if position(replacement in definition)=0 then
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then raise exception 'Unexpected programme read access; review migration 014'; end if;
  execute replace(definition,original,replacement);
 end if;
end $migration$;

create or replace function panda_private.guard_client_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
declare field text; plan_kind text; previous jsonb;
begin
 if new.kind<>'clients' then return new; end if;
 -- panda_save uses INSERT ... ON CONFLICT UPDATE. Its BEFORE INSERT trigger
 -- runs even for an existing profile, so compare against that stored profile.
 if tg_op='UPDATE' then previous:=old.data;
 else select r.data into previous from public.panda_records r where r.kind='clients' and r.id=new.id;
 end if;
 foreach field in array array['program_id','nutrition_id','cardio_id'] loop
  if previous is null or (new.data->>field) is distinct from (previous->>field) then
   if field='cardio_id' and coalesce(new.data->>'cardio_id','')='' then continue; end if;
   plan_kind:=case field when 'nutrition_id' then 'nutrition_plans' else 'programs' end;
   if not exists(select 1 from public.panda_records r where r.kind=plan_kind and r.id=new.data->>field and r.data->>'status'='published' and (field<>'cardio_id' or r.data->>'plan_type'='cardio')) then
    raise exception 'Publish a plan before assigning it to a client.';
   end if;
  end if;
 end loop;
 if previous is null or (new.data->>'checkin_day') is distinct from (previous->>'checkin_day') then
  if coalesce(lower(btrim(new.data->>'checkin_day')),'') not in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday') then
   raise exception 'Choose a check-in day.';
  end if;
 end if;
 return new;
end $$;
revoke all on function panda_private.guard_client_assignment() from public,anon,authenticated;
drop trigger if exists panda_client_assignment_guard on public.panda_records;
create trigger panda_client_assignment_guard before insert or update on public.panda_records
for each row execute function panda_private.guard_client_assignment();

update public.panda_records
set data=(select coalesce(jsonb_agg(distinct x),'[]'::jsonb) from jsonb_array_elements(data || $ids$["lib_hiit_01_l1","lib_hiit_01_l2","lib_hiit_01_l3","lib_hiit_02_l1","lib_hiit_02_l2","lib_hiit_02_l3","lib_hiit_03_l1","lib_hiit_03_l2","lib_hiit_03_l3","lib_hiit_04_l1","lib_hiit_04_l2","lib_hiit_04_l3","lib_hiit_05_l1","lib_hiit_05_l2","lib_hiit_05_l3","lib_hiit_06_l1","lib_hiit_06_l2","lib_hiit_06_l3","lib_hiit_07_l1","lib_hiit_07_l2","lib_hiit_07_l3","lib_hiit_08_l1","lib_hiit_08_l2","lib_hiit_08_l3","lib_hiit_09_l1","lib_hiit_09_l2","lib_hiit_09_l3","lib_hiit_10_l1","lib_hiit_10_l2","lib_hiit_10_l3","lib_hiit_11_l1","lib_hiit_11_l2","lib_hiit_11_l3","lib_hiit_12_l1","lib_hiit_12_l2","lib_hiit_12_l3","lib_hiit_13_l1","lib_hiit_13_l2","lib_hiit_13_l3","lib_hiit_14_l1","lib_hiit_14_l2","lib_hiit_14_l3","lib_hiit_15_l1","lib_hiit_15_l2","lib_hiit_15_l3","lib_hiit_16_l1","lib_hiit_16_l2","lib_hiit_16_l3","lib_hiit_17_l1","lib_hiit_17_l2","lib_hiit_17_l3","lib_hiit_18_l1","lib_hiit_18_l2","lib_hiit_18_l3","lib_hiit_19_l1","lib_hiit_19_l2","lib_hiit_19_l3","lib_hiit_20_l1","lib_hiit_20_l2","lib_hiit_20_l3","lib_warm_01","lib_warm_02","lib_warm_03","lib_warm_04","lib_warm_05","lib_warm_06","lib_warm_07","lib_warm_08","lib_warm_09","lib_warm_10","lib_cool_01","lib_cool_02","lib_cool_03","lib_cool_04","lib_cool_05","lib_cool_06","lib_cool_07","lib_cool_08","lib_cool_09","lib_cool_10"]$ids$::jsonb) x)
where kind='settings' and id='catalogue_ids';
commit;
