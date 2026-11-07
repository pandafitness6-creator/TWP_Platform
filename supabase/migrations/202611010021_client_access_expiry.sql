-- TRAIN WITH PANDA · Optional client access expiry.
-- Additive: access_expires_on is nullable and NULL means "no expiry", so every
-- existing account keeps exactly its current access. No rows are rewritten.
-- The date is the client's LAST day of access, compared in UTC everywhere.
begin;
alter table public.panda_accounts add column if not exists access_expires_on date;

-- One clock for every expiry comparison (RLS, RPCs, Edge Function): the UTC calendar date.
create or replace function panda_private.today() returns date language sql stable set search_path='' as $$
 select (now() at time zone 'utc')::date
$$;
revoke all on function panda_private.today() from public,anon;
grant execute on function panda_private.today() to authenticated;

-- RLS gate for every record, event and chat read and for every save: an expired
-- client's existing JWT stops working at the end of the last day, without a job.
create or replace function panda_private.ready() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.panda_accounts where user_id=auth.uid() and active and not must_change_password and to_timestamp(coalesce((auth.jwt()->>'iat')::bigint,0)) >= session_cutoff and (access_expires_on is null or access_expires_on >= panda_private.today()))
$$;

-- The coach edits the date on the client profile (panda_save / panda_register_client);
-- this keeps the enforced account column in step. Clients cannot change it: panda_save
-- already rejects any client edit outside their personal profile fields.
create or replace function panda_private.sync_client_access() returns trigger language plpgsql security definer set search_path='' as $$
declare v text; expires date;
begin
 if new.kind<>'clients' then return new; end if;
 if jsonb_typeof(new.data->'access_expires_on') not in ('string','null') then raise exception 'Choose a valid access expiry date.'; end if;
 v:=nullif(btrim(coalesce(new.data->>'access_expires_on','')),'');
 if v is not null then
  if v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid access expiry date.'; end if;
  begin expires:=v::date; exception when others then raise exception 'Choose a valid access expiry date.'; end;
  if to_char(expires,'YYYY-MM-DD')<>v or expires not between date '2000-01-01' and date '2100-12-31' then raise exception 'Choose a valid access expiry date.'; end if;
 end if;
 update public.panda_accounts set access_expires_on=expires where user_id=new.owner_id and role='client' and access_expires_on is distinct from expires;
 return new;
end $$;
revoke all on function panda_private.sync_client_access() from public,anon,authenticated;
drop trigger if exists panda_client_access_sync on public.panda_records;
create trigger panda_client_access_sync after insert or update on public.panda_records
for each row when (new.kind='clients') execute function panda_private.sync_client_access();

-- Why the signed-in account can or cannot use the portal, so sign-in can explain it.
-- Returns only the caller's own state and the coach's published contact details.
create or replace function public.panda_access_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.panda_accounts; profile_status text; brand jsonb; today date:=panda_private.today();
begin
 select * into a from public.panda_accounts where user_id=auth.uid();
 if a.user_id is null then return jsonb_build_object('state','inactive','today',today); end if;
 if a.role='client' then select r.data->>'status' into profile_status from public.panda_records r where r.kind='clients' and r.owner_id=a.user_id; end if;
 select r.data into brand from public.panda_records r where r.kind='settings' and r.id='brand';
 return jsonb_build_object(
  'state',case when not a.active then case when profile_status in ('paused','archived') then profile_status else 'inactive' end
               when a.access_expires_on is not null and a.access_expires_on<today then 'expired' else 'ok' end,
  'expires_on',a.access_expires_on,
  'days_left',a.access_expires_on-today,
  'today',today,
  'support',jsonb_strip_nulls(jsonb_build_object('coach',nullif(btrim(brand->>'coach'),''),'email',nullif(btrim(brand->>'email'),''),'phone',nullif(btrim(brand->>'phone'),''),'whatsapp',nullif(btrim(brand->>'whatsapp'),''),'hours',nullif(btrim(brand->>'hours'),''),'hours_ar',nullif(btrim(brand->>'hours_ar'),''))));
end $$;
revoke all on function public.panda_access_status() from public,anon;
grant execute on function public.panda_access_status() to authenticated;
commit;
