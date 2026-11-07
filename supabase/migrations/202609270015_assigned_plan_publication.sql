-- Preserve access when an already published plan is assigned to clients.
-- No records are rewritten. Reassignment and unpublishing can share one transaction.
begin;
create or replace function panda_private.guard_assigned_plan_publication()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.panda_records p
   where p.kind=new.kind and p.id=new.id
     and p.data->>'status' is distinct from 'published')
 and exists(select 1 from public.panda_records c where c.kind='clients' and
   ((new.kind='nutrition_plans' and c.data->>'nutrition_id'=new.id)
    or (new.kind='programs' and (c.data->>'program_id'=new.id or c.data->>'cardio_id'=new.id)))) then
  raise exception 'This plan is assigned to clients. Give them another plan before setting it to draft.';
 end if;
 return new;
end $$;
revoke all on function panda_private.guard_assigned_plan_publication() from public,anon,authenticated;
drop trigger if exists panda_assigned_plan_publication_guard on public.panda_records;
create constraint trigger panda_assigned_plan_publication_guard
after update on public.panda_records deferrable initially deferred
for each row when (old.kind in ('programs','nutrition_plans')
 and old.data->>'status'='published' and new.data->>'status' is distinct from 'published')
execute function panda_private.guard_assigned_plan_publication();
commit;
