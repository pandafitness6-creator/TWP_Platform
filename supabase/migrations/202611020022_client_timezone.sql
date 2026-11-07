-- TRAIN WITH PANDA · Client access expiry in each client's own timezone.
-- access_expires_on stays the client's LAST day of access. Access now ends at 00:00 on the
-- following day in the client's timezone (021 used UTC). A client without a timezone uses the
-- installation default: settings/brand.default_timezone, else Asia/Colombo.
-- Additive and safe to re-run: two nullable columns, replaced functions, no rows rewritten.
begin;
alter table public.panda_accounts add column if not exists timezone text;
alter table public.panda_accounts add column if not exists country_code text;

-- IANA names only (Asia/Colombo, America/Argentina/Buenos_Aires, UTC), as known to this server.
create or replace function panda_private.valid_timezone(tz text) returns boolean language sql stable set search_path='' as $$
 select tz ~ '^(UTC|[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)+)$' and exists(select 1 from pg_catalog.pg_timezone_names where name=tz)
$$;
-- Validated when written (brand trigger below), so reading it in RLS stays a single lookup.
create or replace function panda_private.default_timezone() returns text language sql stable security definer set search_path='' as $$
 select coalesce((select nullif(btrim(r.data->>'default_timezone'),'') from public.panda_records r where r.kind='settings' and r.id='brand'),'Asia/Colombo')
$$;
-- The calendar date now in a timezone, and the instant access ends: 00:00 local on the day
-- after the expiry date. AT TIME ZONE applies that date's real offset, so DST is handled.
create or replace function panda_private.local_today(tz text, at timestamptz default now()) returns date language sql stable set search_path='' as $$
 select (at at time zone tz)::date
$$;
create or replace function panda_private.access_ends_at(expires date, tz text) returns timestamptz language sql stable set search_path='' as $$
 select (expires+1)::timestamp at time zone tz
$$;
revoke all on function panda_private.valid_timezone(text), panda_private.default_timezone(), panda_private.local_today(text,timestamptz), panda_private.access_ends_at(date,text) from public,anon;
grant execute on function panda_private.valid_timezone(text), panda_private.default_timezone(), panda_private.local_today(text,timestamptz), panda_private.access_ends_at(date,text) to authenticated;

-- Every writer of an account, the service role included, gets the same validation.
create or replace function panda_private.guard_account_timezone() returns trigger language plpgsql set search_path='' as $$
begin
 if new.timezone is not null and not panda_private.valid_timezone(new.timezone) then raise exception 'Choose a valid IANA timezone, for example Asia/Colombo.'; end if;
 if new.country_code is not null and new.country_code !~ '^[A-Z]{2}$' then raise exception 'Choose a valid country.'; end if;
 return new;
end $$;
revoke all on function panda_private.guard_account_timezone() from public,anon,authenticated;
drop trigger if exists panda_account_timezone_guard on public.panda_accounts;
create trigger panda_account_timezone_guard before insert or update of timezone, country_code on public.panda_accounts
for each row execute function panda_private.guard_account_timezone();

-- RLS gate: an already-issued session stops working at the client's local midnight.
create or replace function panda_private.ready() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.panda_accounts a where a.user_id=auth.uid() and a.active and not a.must_change_password and to_timestamp(coalesce((auth.jwt()->>'iat')::bigint,0)) >= a.session_cutoff and (a.access_expires_on is null or now() < panda_private.access_ends_at(a.access_expires_on,coalesce(a.timezone,panda_private.default_timezone()))))
$$;

-- The coach sets expiry, country and timezone on the client profile; this copies them to the
-- account that RLS reads. Clients cannot set them: panda_save refuses client edits outside their
-- personal fields, and this trigger refuses it again for any non-coach session.
create or replace function panda_private.sync_client_access() returns trigger language plpgsql security definer set search_path='' as $$
declare v text; expires date; tz text; cc text;
begin
 if new.kind='settings' then
  if new.id='brand' then
   if jsonb_typeof(new.data->'default_timezone') not in ('string','null') then raise exception 'Choose a valid IANA timezone, for example Asia/Colombo.'; end if;
   tz:=nullif(btrim(coalesce(new.data->>'default_timezone','')),'');
   if tz is not null and not panda_private.valid_timezone(tz) then raise exception 'Choose a valid IANA timezone, for example Asia/Colombo.'; end if;
  end if;
  return new;
 end if;
 if new.kind<>'clients' then return new; end if;
 if jsonb_typeof(new.data->'access_expires_on') not in ('string','null') then raise exception 'Choose a valid access expiry date.'; end if;
 v:=nullif(btrim(coalesce(new.data->>'access_expires_on','')),'');
 if v is not null then
  if v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid access expiry date.'; end if;
  begin expires:=v::date; exception when others then raise exception 'Choose a valid access expiry date.'; end;
  if to_char(expires,'YYYY-MM-DD')<>v or expires not between date '2000-01-01' and date '2100-12-31' then raise exception 'Choose a valid access expiry date.'; end if;
 end if;
 if jsonb_typeof(new.data->'timezone') not in ('string','null') then raise exception 'Choose a valid IANA timezone, for example Asia/Colombo.'; end if;
 if jsonb_typeof(new.data->'country') not in ('string','null') then raise exception 'Choose a valid country.'; end if;
 tz:=nullif(btrim(coalesce(new.data->>'timezone','')),'');
 cc:=nullif(btrim(coalesce(new.data->>'country','')),'');
 if tz is not null and not panda_private.valid_timezone(tz) then raise exception 'Choose a valid IANA timezone, for example Asia/Colombo.'; end if;
 if cc is not null and cc !~ '^[A-Z]{2}$' then raise exception 'Choose a valid country.'; end if;
 if tg_op='UPDATE' and auth.uid() is not null and not panda_private.coach() and (
  (old.data->>'access_expires_on') is distinct from (new.data->>'access_expires_on') or
  (old.data->>'timezone') is distinct from (new.data->>'timezone') or
  (old.data->>'country') is distinct from (new.data->>'country')) then
  raise exception 'Only your coach can change assignments and access' using errcode='42501';
 end if;
 update public.panda_accounts set access_expires_on=expires, timezone=tz, country_code=cc
 where user_id=new.owner_id and role='client' and (access_expires_on,timezone,country_code) is distinct from (expires,tz,cc);
 return new;
end $$;
revoke all on function panda_private.sync_client_access() from public,anon,authenticated;
drop trigger if exists panda_client_access_sync on public.panda_records;
create trigger panda_client_access_sync after insert or update on public.panda_records
for each row when (new.kind in ('clients','settings')) execute function panda_private.sync_client_access();

-- The caller's own access state, worked out in the caller's timezone.
create or replace function public.panda_access_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.panda_accounts; profile_status text; brand jsonb; tz text; today date; ends timestamptz;
begin
 select * into a from public.panda_accounts where user_id=auth.uid();
 if a.user_id is null then return jsonb_build_object('state','inactive'); end if;
 if a.role='client' then select r.data->>'status' into profile_status from public.panda_records r where r.kind='clients' and r.owner_id=a.user_id; end if;
 select r.data into brand from public.panda_records r where r.kind='settings' and r.id='brand';
 tz:=coalesce(a.timezone,panda_private.default_timezone());
 today:=panda_private.local_today(tz);
 if a.access_expires_on is not null then ends:=panda_private.access_ends_at(a.access_expires_on,tz); end if;
 return jsonb_build_object(
  'state',case when not a.active then case when profile_status in ('paused','archived') then profile_status else 'inactive' end
               when ends is not null and now()>=ends then 'expired' else 'ok' end,
  'expires_on',a.access_expires_on,
  'days_left',a.access_expires_on-today,
  'today',today,
  'timezone',tz,
  'timezone_source',case when a.timezone is null then 'default' else 'client' end,
  'ends_at',ends,
  'support',jsonb_strip_nulls(jsonb_build_object('coach',nullif(btrim(brand->>'coach'),''),'email',nullif(btrim(brand->>'email'),''),'phone',nullif(btrim(brand->>'phone'),''),'whatsapp',nullif(btrim(brand->>'whatsapp'),''),'hours',nullif(btrim(brand->>'hours'),''),'hours_ar',nullif(btrim(brand->>'hours_ar'),''))));
end $$;
revoke all on function public.panda_access_status() from public,anon;
grant execute on function public.panda_access_status() to authenticated;
commit;
