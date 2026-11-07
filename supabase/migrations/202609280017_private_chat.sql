-- TRAIN WITH PANDA 0.9.15 · private coach/client messaging.
-- Written 2026-09-28 by Train With Panda: the 0.9.15 web build ships the "Messages" UI
-- (PandaChat, rpc/panda_chat_*, realtime on public.panda_chat_messages) but no migration.
-- Contract derived from the frontend (index.html 0.9.15, PandaChat.call / PandaCloud.chatRPC):
--   contacts()                       -> [{id,name,role}]
--   open(peer)                       -> "<thread id>"
--   inbox()                          -> [{id,peer_id,peer_name,peer_role,peer_active,last_message,last_at,unread}]
--   history(thread,page_size,before_id) -> [{id,thread_id,sender_id,body,created_at}] ascending
--   send(thread,message,request_id)  -> {id,thread_id,sender_id,body,created_at} (idempotent per request_id)
--   mark_read(thread,through_id)     -> {through_id}
-- Message ids are returned as text so BigInt()/Number() comparisons in the UI stay stable.
-- Additive: no existing table, function, policy or record is changed.
begin;

create table public.panda_chat_threads (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.panda_accounts(user_id) on delete cascade,
  client_id uuid not null references public.panda_accounts(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (coach_id, client_id),
  check (coach_id <> client_id)
);
create table public.panda_chat_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.panda_chat_threads(id) on delete cascade,
  sender_id uuid not null references public.panda_accounts(user_id) on delete cascade,
  request_id uuid not null,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  unique (sender_id, request_id)
);
create index panda_chat_messages_thread on public.panda_chat_messages(thread_id, id);
create table public.panda_chat_reads (
  thread_id uuid not null references public.panda_chat_threads(id) on delete cascade,
  user_id uuid not null references public.panda_accounts(user_id) on delete cascade,
  through_id bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

alter table public.panda_chat_threads enable row level security;
alter table public.panda_chat_messages enable row level security;
alter table public.panda_chat_reads enable row level security;
revoke all on public.panda_chat_threads, public.panda_chat_messages, public.panda_chat_reads from anon, authenticated;
-- Read access only: every write goes through the security-definer commands below.
-- The select grant is also what Realtime uses to filter postgres_changes per subscriber.
grant select on public.panda_chat_threads, public.panda_chat_messages, public.panda_chat_reads to authenticated;
grant all on public.panda_chat_threads, public.panda_chat_messages, public.panda_chat_reads to service_role;
grant usage, select on sequence public.panda_chat_messages_id_seq to service_role;

-- Participant check shared by policies and commands.
create function panda_private.chat_member(thread uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.panda_chat_threads t where t.id=thread and auth.uid() in (t.coach_id, t.client_id))
$$;
-- The signed-in account, or an error when the session is not usable.
create function panda_private.chat_actor() returns public.panda_accounts language plpgsql stable security definer set search_path='' as $$
declare a public.panda_accounts;
begin
 if not panda_private.ready() then raise exception 'Account unavailable. Sign in again.' using errcode='42501'; end if;
 select * into a from public.panda_accounts where user_id=auth.uid();
 return a;
end $$;
-- Display name: clients by their profile name, coaches by the brand's coach name (plus username when several coaches exist).
create function panda_private.chat_display(uid uuid) returns text language sql stable security definer set search_path='' as $$
 select case when a.role='coach'
  then coalesce(nullif(trim((select data->>'coach' from public.panda_records where kind='settings' and id='brand')),''),'Coach')
       || case when (select count(*) from public.panda_accounts where role='coach')>1 then ' · '||a.username else '' end
  else coalesce(nullif(trim((select data->>'name' from public.panda_records where kind='clients' and owner_id=a.user_id)),''),a.username) end
 from public.panda_accounts a where a.user_id=uid
$$;
create function panda_private.chat_thread(thread text) returns public.panda_chat_threads language plpgsql stable security definer set search_path='' as $$
declare t public.panda_chat_threads;
begin
 if thread is null or thread !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Conversation unavailable.'; end if;
 select * into t from public.panda_chat_threads where id=thread::uuid and auth.uid() in (coach_id, client_id);
 if t.id is null then raise exception 'Conversation unavailable.'; end if;
 return t;
end $$;
create function panda_private.chat_message_json(m public.panda_chat_messages) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',m.id::text,'thread_id',m.thread_id::text,'sender_id',m.sender_id::text,'body',m.body,'created_at',m.created_at)
$$;
revoke all on function panda_private.chat_member(uuid), panda_private.chat_actor(), panda_private.chat_display(uuid), panda_private.chat_thread(text), panda_private.chat_message_json(public.panda_chat_messages) from public, anon;
grant execute on function panda_private.chat_member(uuid), panda_private.chat_actor(), panda_private.chat_display(uuid), panda_private.chat_thread(text), panda_private.chat_message_json(public.panda_chat_messages) to authenticated;

create policy chat_thread_read on public.panda_chat_threads for select to authenticated using (panda_private.ready() and auth.uid() in (coach_id, client_id));
create policy chat_message_read on public.panda_chat_messages for select to authenticated using (panda_private.ready() and panda_private.chat_member(thread_id));
create policy chat_reads_read on public.panda_chat_reads for select to authenticated using (panda_private.ready() and user_id=auth.uid());

-- Coach: every client. Client: every active coach. Roles come from panda_accounts, never from the caller.
create function public.panda_chat_contacts() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me public.panda_accounts;
begin
 me:=panda_private.chat_actor();
 if me.role='coach' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',a.user_id::text,'name',panda_private.chat_display(a.user_id),'role','client') order by panda_private.chat_display(a.user_id), a.username)
   from public.panda_accounts a where a.role='client'),'[]'::jsonb);
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',a.user_id::text,'name',panda_private.chat_display(a.user_id),'role','coach') order by a.username)
  from public.panda_accounts a where a.role='coach' and a.active),'[]'::jsonb);
end $$;

-- One thread per coach/client pair; the caller is always one side of it.
create function public.panda_chat_open(peer text) returns jsonb language plpgsql security definer set search_path='' as $$
declare me public.panda_accounts; other public.panda_accounts; tid uuid; c uuid; k uuid;
begin
 me:=panda_private.chat_actor();
 if peer is null or peer !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Choose a contact.'; end if;
 select * into other from public.panda_accounts where user_id=peer::uuid;
 if other.user_id is null or other.role=me.role or (me.role='client' and not other.active) then raise exception 'Choose a contact.'; end if;
 if me.role='coach' then c:=me.user_id; k:=other.user_id; else c:=other.user_id; k:=me.user_id; end if;
 insert into public.panda_chat_threads(coach_id,client_id) values(c,k) on conflict (coach_id,client_id) do nothing;
 select id into tid from public.panda_chat_threads where coach_id=c and client_id=k;
 return to_jsonb(tid::text);
end $$;

create function public.panda_chat_inbox() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me public.panda_accounts;
begin
 me:=panda_private.chat_actor();
 return coalesce((
  select jsonb_agg(jsonb_build_object(
    'id',v.id::text,'peer_id',v.peer_id::text,'peer_name',panda_private.chat_display(v.peer_id),
    'peer_role',pa.role,'peer_active',coalesce(pa.active,false),
    'last_message',coalesce(lm.body,''),'last_at',lm.created_at,
    'unread',(select count(*) from public.panda_chat_messages m where m.thread_id=v.id and m.sender_id<>me.user_id
              and m.id>coalesce((select r.through_id from public.panda_chat_reads r where r.thread_id=v.id and r.user_id=me.user_id),0))
   ) order by lm.created_at desc nulls last, v.created_at desc)
  from (select t.id, t.created_at, case when t.coach_id=me.user_id then t.client_id else t.coach_id end as peer_id
        from public.panda_chat_threads t where me.user_id in (t.coach_id, t.client_id)) v
  left join public.panda_accounts pa on pa.user_id=v.peer_id
  left join lateral (select m.body, m.created_at from public.panda_chat_messages m where m.thread_id=v.id order by m.id desc limit 1) lm on true
 ),'[]'::jsonb);
end $$;

-- Newest page first from the database, delivered oldest-to-newest for the log.
create function public.panda_chat_history(thread text, page_size integer default 50, before_id text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.panda_chat_threads; n integer; before bigint;
begin
 perform panda_private.chat_actor();
 t:=panda_private.chat_thread(thread);
 n:=least(greatest(coalesce(page_size,50),1),200);
 if before_id is not null and before_id<>'' then
  if before_id !~ '^\d{1,18}$' then raise exception 'Conversation unavailable.'; end if;
  before:=before_id::bigint;
 end if;
 return coalesce((select jsonb_agg(panda_private.chat_message_json(m) order by m.id)
  from (select * from public.panda_chat_messages x where x.thread_id=t.id and (before is null or x.id<before) order by x.id desc limit n) m),'[]'::jsonb);
end $$;

-- Sender and thread come from the session, never from the request. request_id makes retries safe.
create function public.panda_chat_send(thread text, message text, request_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare me public.panda_accounts; t public.panda_chat_threads; body text; rid uuid; m public.panda_chat_messages; peer uuid;
begin
 me:=panda_private.chat_actor();
 t:=panda_private.chat_thread(thread);
 body:=trim(coalesce(message,''));
 if length(body) not between 1 and 4000 then raise exception 'Enter a message of 1 to 4000 characters.'; end if;
 if request_id is null or request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid request.'; end if;
 rid:=request_id::uuid;
 select * into m from public.panda_chat_messages where sender_id=me.user_id and public.panda_chat_messages.request_id=rid;
 if m.id is not null then
  if m.thread_id<>t.id or m.body<>body then raise exception 'Request already used.'; end if;
  return panda_private.chat_message_json(m);
 end if;
 peer:=case when t.coach_id=me.user_id then t.client_id else t.coach_id end;
 if not exists(select 1 from public.panda_accounts where user_id=peer and active) then raise exception 'This contact is inactive. Previous messages remain available.'; end if;
 insert into public.panda_chat_messages(thread_id,sender_id,request_id,body) values(t.id,me.user_id,rid,body)
  on conflict (sender_id,request_id) do nothing returning * into m;
 if m.id is null then
  select * into m from public.panda_chat_messages where sender_id=me.user_id and public.panda_chat_messages.request_id=rid;
  if m.thread_id<>t.id or m.body<>body then raise exception 'Request already used.'; end if;
 end if;
 -- The sender has read everything up to their own message.
 insert into public.panda_chat_reads(thread_id,user_id,through_id) values(t.id,me.user_id,m.id)
  on conflict (thread_id,user_id) do update set through_id=greatest(public.panda_chat_reads.through_id,excluded.through_id), updated_at=now();
 return panda_private.chat_message_json(m);
end $$;

create function public.panda_chat_mark_read(thread text, through_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare me public.panda_accounts; t public.panda_chat_threads; upto bigint; top bigint;
begin
 me:=panda_private.chat_actor();
 t:=panda_private.chat_thread(thread);
 if through_id is null or through_id !~ '^\d{1,18}$' then raise exception 'Conversation unavailable.'; end if;
 select coalesce(max(id),0) into top from public.panda_chat_messages where thread_id=t.id;
 upto:=least(through_id::bigint, top);
 insert into public.panda_chat_reads(thread_id,user_id,through_id) values(t.id,me.user_id,upto)
  on conflict (thread_id,user_id) do update set through_id=greatest(public.panda_chat_reads.through_id,excluded.through_id), updated_at=now();
 return jsonb_build_object('through_id',upto::text);
end $$;

revoke all on function public.panda_chat_contacts(), public.panda_chat_open(text), public.panda_chat_inbox(), public.panda_chat_history(text,integer,text), public.panda_chat_send(text,text,text), public.panda_chat_mark_read(text,text) from public, anon;
grant execute on function public.panda_chat_contacts(), public.panda_chat_open(text), public.panda_chat_inbox(), public.panda_chat_history(text,integer,text), public.panda_chat_send(text,text,text), public.panda_chat_mark_read(text,text) to authenticated;

-- Realtime: the UI subscribes to INSERTs on panda_chat_messages; RLS above limits delivery to the two participants.
do $$
begin
 if exists (select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
  if not exists (select 1 from pg_catalog.pg_publication where pubname='supabase_realtime' and puballtables)
     and not exists (select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='panda_chat_messages') then
   alter publication supabase_realtime add table public.panda_chat_messages;
  end if;
 else
  create publication supabase_realtime for table public.panda_chat_messages;
 end if;
end $$;
commit;
