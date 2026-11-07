-- TRAIN WITH PANDA 0.9.9: hydration for nutrition-only clients.
-- Preserve the installed RPC, all record data and migration 009.
begin;
do $migration$
declare definition text; original text; replacement text;
begin
 select pg_get_functiondef('panda_private.readable(text,text,uuid,jsonb)'::regprocedure) into definition;
 original:=$old$if k='activity' then return panda_private.feature('activity'); end if;$old$;
 replacement:=$new$if k='activity' then return panda_private.feature('activity') or panda_private.feature('nutrition'); end if;$new$;
 if position(replacement in definition)=0 then
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then raise exception 'Unexpected activity read access; review migration 010'; end if;
  execute replace(definition,original,replacement);
 end if;
 select pg_get_functiondef('public.panda_save(jsonb,text)'::regprocedure) into definition;
 if position('-- Panda hydration-only package guard.' in definition)>0 then return; end if;
 original:=$old$  if body is null or body='null'::jsonb then$old$;
 replacement:=$new$  -- Panda hydration-only package guard.
  if k='activity' and not is_coach and not panda_private.feature('activity') then
   if body is null or body='null'::jsonb then raise exception 'Activity access required'; end if;
   if old.id is not null then
    if (body-'water') is distinct from (old.data-'water') then raise exception 'Only water can be changed with nutrition access'; end if;
   elsif (body-'id'-'client_id'-'date'-'water') is distinct from '{"steps":null,"cardio":null,"sleep":null,"habits":{},"notes":""}'::jsonb then
    raise exception 'Only water can be recorded with nutrition access';
   end if;
  end if;
  if body is null or body='null'::jsonb then$new$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then raise exception 'Unexpected activity write access; review migration 010'; end if;
 execute replace(definition,original,replacement);
end $migration$;
commit;
