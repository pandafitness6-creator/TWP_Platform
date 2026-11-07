-- TRAIN WITH PANDA 0.9.15 · fix for panda_chat_send from 0017.
-- The parameter "request_id" (fixed by the frontend contract) collides with the column of the same name,
-- so PL/pgSQL raised 42702 "column reference request_id is ambiguous" on every send.
-- Same body as 0017, resolved with #variable_conflict use_column and function-qualified parameter access.
begin;
create or replace function public.panda_chat_send(thread text, message text, request_id text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare me public.panda_accounts; t public.panda_chat_threads; txt text; rid uuid; m public.panda_chat_messages; peer uuid;
begin
 me:=panda_private.chat_actor();
 t:=panda_private.chat_thread(panda_chat_send.thread);
 txt:=trim(coalesce(panda_chat_send.message,''));
 if length(txt) not between 1 and 4000 then raise exception 'Enter a message of 1 to 4000 characters.'; end if;
 if panda_chat_send.request_id is null or panda_chat_send.request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid request.'; end if;
 rid:=panda_chat_send.request_id::uuid;
 select * into m from public.panda_chat_messages x where x.sender_id=me.user_id and x.request_id=rid;
 if m.id is not null then
  if m.thread_id<>t.id or m.body<>txt then raise exception 'Request already used.'; end if;
  return panda_private.chat_message_json(m);
 end if;
 peer:=case when t.coach_id=me.user_id then t.client_id else t.coach_id end;
 if not exists(select 1 from public.panda_accounts a where a.user_id=peer and a.active) then raise exception 'This contact is inactive. Previous messages remain available.'; end if;
 insert into public.panda_chat_messages(thread_id,sender_id,request_id,body) values(t.id,me.user_id,rid,txt)
  on conflict (sender_id,request_id) do nothing returning * into m;
 if m.id is null then
  select * into m from public.panda_chat_messages x where x.sender_id=me.user_id and x.request_id=rid;
  if m.thread_id<>t.id or m.body<>txt then raise exception 'Request already used.'; end if;
 end if;
 -- The sender has read everything up to their own message.
 insert into public.panda_chat_reads(thread_id,user_id,through_id) values(t.id,me.user_id,m.id)
  on conflict (thread_id,user_id) do update set through_id=greatest(public.panda_chat_reads.through_id,excluded.through_id), updated_at=now();
 return panda_private.chat_message_json(m);
end $$;
revoke all on function public.panda_chat_send(text,text,text) from public, anon;
grant execute on function public.panda_chat_send(text,text,text) to authenticated;
commit;
