-- New plan assignments must refer to published content visible to the client.
-- Existing assignments and data are not rewritten.
begin;
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
 foreach field in array array['program_id','nutrition_id'] loop
  if previous is null or (new.data->>field) is distinct from (previous->>field) then
   plan_kind:=case field when 'program_id' then 'programs' else 'nutrition_plans' end;
   if not exists(select 1 from public.panda_records r where r.kind=plan_kind and r.id=new.data->>field and r.data->>'status'='published') then
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
commit;
