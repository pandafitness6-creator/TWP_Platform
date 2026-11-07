-- TRAIN WITH PANDA 0.9.8: record water without inventing activity values.
-- Preserve existing records, package checks, ownership and revision checks.
begin;
create or replace function panda_private.validate_activity(b jsonb)
returns void language plpgsql set search_path='' as $$
declare f text; hi numeric;
begin
 if not panda_private.valid_number(b->'water',0,15) then raise exception 'Invalid water amount'; end if;
 foreach f in array array['steps','cardio','sleep'] loop
  -- Only explicit null means not recorded. Missing fields and strings are invalid.
  if b->f = 'null'::jsonb then continue; end if;
  hi:=case f when 'steps' then 100000 when 'cardio' then 1440 else 24 end;
  if not panda_private.valid_number(b->f,0,hi) then raise exception 'Invalid activity value'; end if;
 end loop;
end $$;
revoke all on function panda_private.validate_activity(jsonb) from public, anon, authenticated;

-- Modify only the two activity-validation sites in the installed RPC. Abort if
-- its implementation no longer matches, rather than replacing unrelated logic.
do $migration$
declare definition text; original text; replacement text;
begin
 select pg_get_functiondef('public.panda_save(jsonb,text)'::regprocedure) into definition;
 if position('perform panda_private.validate_activity(body)' in definition)>0 then return; end if;
 original:=$old$if jsonb_typeof(body->f) is distinct from 'number' or (body->>f)::numeric<0 then raise exception 'Invalid activity value'; end if;$old$;
 replacement:=$new$if f<>'water' and body->f='null'::jsonb then continue; end if;
     if jsonb_typeof(body->f) is distinct from 'number' or (body->>f)::numeric<0 then raise exception 'Invalid activity value'; end if;$new$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'Unexpected activity validation in panda_save; review migration 009';
 end if;
 definition:=replace(definition,original,replacement);
 original:=$old$if k='activity' and (not panda_private.valid_number(body->'steps',0,100000) or not panda_private.valid_number(body->'cardio',0,1440) or not panda_private.valid_number(body->'water',0,15) or not panda_private.valid_number(body->'sleep',0,24)) then raise exception 'Invalid activity values'; end if;$old$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'Unexpected activity bounds in panda_save; review migration 009';
 end if;
 definition:=replace(definition,original,'if k=''activity'' then perform panda_private.validate_activity(body); end if;');
 execute definition;
end $migration$;
commit;
