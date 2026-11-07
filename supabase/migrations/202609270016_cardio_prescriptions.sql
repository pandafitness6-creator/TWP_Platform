-- Cardio HQ: structured prescriptions, assignment type guards and catalogue ID.
-- Existing free-text cardio rows remain valid; no plan or assignment is rewritten.
begin;
create or replace function panda_private.validate_cardio_program(p jsonb)
returns void language plpgsql set search_path='' as $$
declare d jsonb; x jsonb; c jsonb; f text; n numeric; lim integer;
begin
 if jsonb_typeof(p->'sessions') is distinct from 'array' then raise exception 'Invalid training sessions'; end if;
 for d in select value from jsonb_array_elements(p->'sessions') loop
  if jsonb_typeof(d->'exercises') is distinct from 'array' then raise exception 'Invalid training exercises'; end if;
  for x in select value from jsonb_array_elements(d->'exercises') loop
   if not (x ? 'cardio') then continue; end if;
   c:=x->'cardio';
   if jsonb_typeof(c) is distinct from 'object' or p->>'plan_type' is distinct from 'cardio' then raise exception 'Invalid cardio prescription'; end if;
   for f in select jsonb_object_keys(c) loop
    if f not in ('method','intensity','duration','frequency_per_week','speed','incline_resistance','distance_target','step_target','recovery') then raise exception 'Unknown cardio prescription field'; end if;
   end loop;
   if c ? 'method' and (jsonb_typeof(c->'method') is distinct from 'string' or c->>'method' not in ('','walking','treadmill','stationary_bike','elliptical','stair_climber','rowing_machine','swimming','outdoor_running','outdoor_cycling','hiit','sports_active_lifestyle')) then raise exception 'Choose a valid cardio method and intensity'; end if;
   if c ? 'intensity' and (jsonb_typeof(c->'intensity') is distinct from 'string' or c->>'intensity' not in ('','liss','miss','hiit','daily_activity')) then raise exception 'Choose a valid cardio method and intensity'; end if;
   foreach f in array array['duration','speed','incline_resistance','distance_target','step_target','recovery'] loop
    lim:=case f when 'incline_resistance' then 120 when 'recovery' then 300 else 60 end;
    if c ? f and (jsonb_typeof(c->f) is distinct from 'string' or length(c->>f)>lim) then raise exception 'Check cardio prescription text and limits'; end if;
   end loop;
   if c ? 'frequency_per_week' and c->'frequency_per_week'<>'null'::jsonb then
    if jsonb_typeof(c->'frequency_per_week') is distinct from 'number' then raise exception 'Cardio frequency must be a whole number from 1 to 14 per week'; end if;
    n:=(c->>'frequency_per_week')::numeric;
    if n<1 or n>14 or n<>trunc(n) then raise exception 'Cardio frequency must be a whole number from 1 to 14 per week'; end if;
   end if;
   if p->>'status'='published' and (coalesce(c->>'method','')='' or coalesce(c->>'intensity','')='' or length(btrim(coalesce(c->>'duration','')))=0 or coalesce(c->'frequency_per_week','null'::jsonb)='null'::jsonb) then raise exception 'Set cardio method, duration, frequency per week and intensity before publishing'; end if;
  end loop;
 end loop;
end $$;
create or replace function panda_private.validate_cardio_update()
returns trigger language plpgsql set search_path='' as $$
declare x jsonb;
begin
 if new.kind='programs' then perform panda_private.validate_cardio_program(new.data);
 elsif new.kind='plan_history' and new.data->>'type'='programs' then
  if jsonb_typeof(new.data->'versions') is distinct from 'array' then raise exception 'Invalid plan history'; end if;
  for x in select value from jsonb_array_elements(new.data->'versions') loop perform panda_private.validate_cardio_program(x->'snapshot'); end loop;
 end if;
 return new;
end $$;
revoke all on function panda_private.validate_cardio_program(jsonb),panda_private.validate_cardio_update() from public,anon,authenticated;
drop trigger if exists panda_cardio_update on public.panda_records;
create trigger panda_cardio_update before insert or update on public.panda_records for each row execute function panda_private.validate_cardio_update();

-- Reject new assignments of cardio plans to the strength-programme slot.
-- The existing guard already preserves unchanged legacy assignments.
do $migration$
declare definition text; original text; replacement text;
begin
 select pg_get_functiondef('panda_private.guard_client_assignment()'::regprocedure) into definition;
 original:=$old$(field<>'cardio_id' or r.data->>'plan_type'='cardio')$old$;
 replacement:=$new$(field<>'cardio_id' or r.data->>'plan_type'='cardio') and (field<>'program_id' or coalesce(r.data->>'plan_type','')<>'cardio')$new$;
 if position(replacement in definition)=0 then
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then raise exception 'Unexpected assignment guard; review migration 016'; end if;
  execute replace(definition,original,replacement);
 end if;
end $migration$;

-- Deferred so a coach can atomically reassign clients and change a plan type.
create or replace function panda_private.guard_assigned_plan_type()
returns trigger language plpgsql security definer set search_path='' as $$
declare cardio boolean;
begin
 select coalesce(p.data->>'plan_type','')='cardio' into cardio from public.panda_records p where p.kind='programs' and p.id=new.id;
 if exists(select 1 from public.panda_records c where c.kind='clients' and ((cardio and c.data->>'program_id'=new.id) or (not cardio and c.data->>'cardio_id'=new.id))) then raise exception 'This plan is assigned to clients. Reassign it before changing its type.'; end if;
 return new;
end $$;
revoke all on function panda_private.guard_assigned_plan_type() from public,anon,authenticated;
drop trigger if exists panda_assigned_plan_type_guard on public.panda_records;
create constraint trigger panda_assigned_plan_type_guard after update on public.panda_records deferrable initially deferred
for each row when (new.kind='programs' and (coalesce(old.data->>'plan_type','')='cardio') is distinct from (coalesce(new.data->>'plan_type','')='cardio'))
execute function panda_private.guard_assigned_plan_type();

update public.panda_records
set data=(select coalesce(jsonb_agg(distinct x),'[]'::jsonb) from jsonb_array_elements(data || '["lib_cardio_swimming_01"]'::jsonb) x)
where kind='settings' and id='catalogue_ids';
commit;
