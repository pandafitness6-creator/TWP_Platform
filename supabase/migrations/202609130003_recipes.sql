-- TRAIN WITH PANDA 0.7.5: recipe masters, private client assignments and coach uploads.
-- Additive migration: existing accounts, data and permissions remain in place.
begin;
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.panda_records'::regclass and contype='c' and pg_get_constraintdef(oid) like '%kind%' loop
  execute format('alter table public.panda_records drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.panda_records add constraint panda_records_kind_check check (kind in ('clients','client_private','packages','foods','programs','nutrition_plans','checkins','checkin_private','measurements','activity','photos','articles','invoices','drafts','settings','plan_history','supplements','recipes','recipe_assignments','recipe_images'));
alter table public.panda_records add constraint panda_records_ownership_check check ((kind in ('clients','client_private','checkins','checkin_private','measurements','activity','photos','invoices','drafts','supplements','recipe_assignments')) = (owner_id is not null));
create or replace function panda_private.validate_recipe(b jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare f text; ingredient jsonb; value jsonb;
begin
 if jsonb_typeof(b) is distinct from 'object' or not coalesce(panda_private.valid_text(b->'id',100),false) or length(b->>'id')=0 or not coalesce(panda_private.valid_text(b->'name',150),false) or length(trim(b->>'name'))=0 then raise exception 'Invalid recipe title or identity'; end if;
 if coalesce(b->>'category','') not in ('Breakfast','Main meals','Plant-based','Snacks') or coalesce(b->>'status','') not in ('draft','published','archived') then raise exception 'Invalid recipe status or category'; end if;
 if not coalesce(panda_private.valid_number(b->'version',1,1000000),false) or (b->>'version')::numeric<>trunc((b->>'version')::numeric) or not coalesce(panda_private.valid_number(b->'servings',1,100),false) or (b->>'servings')::numeric<>trunc((b->>'servings')::numeric) or not coalesce(panda_private.valid_number(b->'minutes',1,1440),false) or not coalesce(panda_private.valid_number(b->'wait_minutes',0,10080),false) then raise exception 'Invalid recipe time, version or servings'; end if;
 foreach f in array array['name_ar','summary','summary_ar','notes','notes_ar'] loop
  if b ? f and not coalesce(panda_private.valid_text(b->f,case when f='name_ar' then 150 when f like 'summary%' then 600 else 4000 end),false) then raise exception 'Invalid recipe text'; end if;
 end loop;
 if not coalesce(panda_private.valid_text(b->'image',200),false) or (b->>'image'<>'' and b->>'image' !~ '^(assets/recipes/(0[1-9]|[1-3][0-9]|40)\.webp|recipe-image:[A-Za-z0-9_-]+)$') or (b->>'status'='published' and b->>'image'='') then raise exception 'Invalid recipe image reference'; end if;
 if jsonb_typeof(b->'ingredients') is distinct from 'array' then raise exception 'Invalid recipe ingredients'; end if;
 if jsonb_array_length(b->'ingredients') not between 1 and 30 then raise exception 'Use 1–30 ingredients'; end if;
 for ingredient in select * from jsonb_array_elements(b->'ingredients') loop
  if not coalesce(panda_private.valid_text(ingredient->'name',150),false) or length(trim(ingredient->>'name'))=0 or ingredient->>'unit' is distinct from 'g' or not coalesce(panda_private.valid_number(ingredient->'quantity',.1,10000),false) then raise exception 'Invalid ingredient portion'; end if;
  foreach f in array array['protein','carbs','fat','fiber'] loop
   if not coalesce(panda_private.valid_number(ingredient->f,0,100),false) then raise exception 'Invalid ingredient nutrients'; end if;
  end loop;
  if (ingredient->>'protein')::numeric+(ingredient->>'carbs')::numeric+(ingredient->>'fat')::numeric+(ingredient->>'fiber')::numeric>102 then raise exception 'Nutrients exceed ingredient weight'; end if;
  if ingredient ? 'name_ar' and not coalesce(panda_private.valid_text(ingredient->'name_ar',150),false) or ingredient ? 'allergens' and not coalesce(panda_private.valid_text(ingredient->'allergens',300),false) then raise exception 'Invalid ingredient text'; end if;
 end loop;
 foreach f in array array['steps','steps_ar','tags','allergens'] loop
  if jsonb_typeof(b->f) is distinct from 'array' then raise exception 'Invalid recipe detail list'; end if;
  if jsonb_array_length(b->f)>(case when f='tags' then 20 else 30 end) or f='steps' and jsonb_array_length(b->f)=0 then raise exception 'Invalid recipe detail count'; end if;
  for value in select * from jsonb_array_elements(b->f) loop
   if not coalesce(panda_private.valid_text(value,case when f='tags' then 60 when f='allergens' then 100 else 3000 end),false) or f='steps' and length(trim(value#>>'{}'))=0 then raise exception 'Invalid recipe detail text'; end if;
  end loop;
 end loop;
end $$;
revoke all on function panda_private.validate_recipe(jsonb) from public,anon;
grant execute on function panda_private.validate_recipe(jsonb) to authenticated;

create or replace function panda_private.readable(k text, rid text, owner uuid, body jsonb) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if not panda_private.ready() then return false; end if;
 if panda_private.coach() then return true; end if;
 if k in ('client_private','checkin_private','invoices','plan_history') then return false; end if;
 if owner is not null then
  if owner is distinct from auth.uid() then return false; end if;
  if k in ('checkins','drafts') then return panda_private.feature('checkins'); end if;
  if k in ('photos','measurements') then return panda_private.feature('progress'); end if;
  if k='activity' then return panda_private.feature('activity'); end if;
  if k='recipe_assignments' then return panda_private.feature('nutrition'); end if;
  if k='supplements' then return panda_private.feature('supplements'); end if;
  return k='clients';
 end if;
 if k='recipes' then return panda_private.feature('nutrition') and body->>'status'='published'; end if;
 if k='recipe_images' then return panda_private.feature('nutrition') and exists(
  select 1 from public.panda_records r where
   (r.kind='recipes' and r.data->>'status'='published' and r.data->>'image'=rid) or
   (r.kind='recipe_assignments' and r.owner_id=auth.uid() and r.data->'recipe'->>'image'=rid) or
   (r.kind='nutrition_plans' and r.id=panda_private.profile()->>'nutrition_id' and r.data->>'status'='published' and jsonb_path_query_array(r.data,'$.**.image') ? rid)
 ); end if;
 if k='packages' then return rid=panda_private.profile()->>'package_id'; end if;
 if k='programs' then return panda_private.feature('training') and rid=panda_private.profile()->>'program_id' and body->>'status'='published'; end if;
 if k='nutrition_plans' then return panda_private.feature('nutrition') and rid=panda_private.profile()->>'nutrition_id' and body->>'status'='published'; end if;
 if k='articles' then return panda_private.feature('education') and body->>'status'='published'; end if;
 if k='settings' then return rid in ('brand','measurement_defs','exercise_edits') or rid='roadmap' and panda_private.feature('roadmap') or rid in ('strategy','swaps') and panda_private.feature('nutrition'); end if;
 return k='foods' and panda_private.feature('nutrition');
end $$;
create or replace function public.panda_save(changes jsonb, label text default 'Saved changes') returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; old public.panda_records; body jsonb; k text; rid text; owner uuid; is_coach boolean;
 result jsonb='[]'; seq bigint; immutable text[]; f text; other public.panda_records; stamp text;
begin
 if not panda_private.ready() then raise exception 'Account unavailable. Sign in again.' using errcode='42501'; end if;
 is_coach:=panda_private.coach();
 if jsonb_typeof(changes)<>'array' or jsonb_array_length(changes)>500 then raise exception 'Invalid change batch'; end if;
 if length(label)>160 then raise exception 'Invalid change label'; end if;
 -- Serialise portal writes so version checks also cover concurrent inserts and dates.
 perform pg_advisory_xact_lock(8219034);
 for item in select value from jsonb_array_elements(changes) loop
  k:=item->>'kind'; rid:=item->>'id'; body:=item->'data';
  select * into old from public.panda_records where kind=k and id=rid for update;
  if coalesce(old.revision,0) <> coalesce((item->>'revision')::bigint,0) then raise exception 'This record changed on another device. Refresh before saving.' using errcode='40001'; end if;
  if k in ('client_private','checkin_private') and not is_coach then raise exception 'Coach access required' using errcode='42501'; end if;
  if not is_coach and (k not in ('clients','checkins','measurements','activity','photos','drafts') or (old.owner_id is not null and old.owner_id<>auth.uid())) then raise exception 'Access denied' using errcode='42501'; end if;
  if k in ('clients','client_private','drafts','supplements') then owner:=rid::uuid;
  elsif k in ('checkins','checkin_private','measurements','activity','photos','invoices','recipe_assignments') then owner:=coalesce(body->>'client_id',old.owner_id::text)::uuid;
  else owner:=null; end if;
  if old.owner_id is not null and owner is distinct from old.owner_id then raise exception 'Record owner cannot change'; end if;
  if not is_coach and owner is distinct from auth.uid() then raise exception 'Access denied' using errcode='42501'; end if;
  if owner is not null and not exists(select 1 from public.panda_accounts where user_id=owner and role='client') then raise exception 'Create the customer account first'; end if;
  if not is_coach and not panda_private.readable(k,rid,owner,coalesce(body,old.data)) then raise exception 'This area is not included in your package' using errcode='42501'; end if;
  if body is null or body='null'::jsonb then
   if k in ('clients','packages','programs','nutrition_plans','foods','settings') then raise exception 'Referenced records cannot be deleted'; end if;
   if not is_coach and k not in ('measurements','photos','activity','drafts') then raise exception 'This record cannot be removed' using errcode='42501'; end if;
   delete from public.panda_records where kind=k and id=rid;
   result:=result||jsonb_build_array(jsonb_build_object('kind',k,'id',rid,'revision',0)); continue;
  end if;
  if k not in ('settings','drafts') and (jsonb_typeof(body)<>'object' or body->>'id' is distinct from rid) then raise exception 'Invalid record identity'; end if;
  if k in ('programs','nutrition_plans') and coalesce(body->'versions','[]'::jsonb) <> '[]'::jsonb then raise exception 'Store plan history separately'; end if;
  if k='recipes' then
   perform panda_private.validate_recipe(body);
  elsif k='recipe_assignments' then
   perform panda_private.validate_recipe(body->'recipe');
   if body->'recipe'->>'status' is distinct from 'published' or body->>'recipe_id' is distinct from body->'recipe'->>'id' or body->>'recipe_version' is distinct from body->'recipe'->>'version' or body->>'client_id' is distinct from owner::text or not coalesce(panda_private.valid_number(body->'servings',.25,10),false) or not coalesce(panda_private.valid_text(body->'time',100),false) or not coalesce(panda_private.valid_text(body->'note',2000),false) then raise exception 'Invalid recipe assignment'; end if;
   if coalesce(body->>'assigned_at','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid recipe assignment date'; end if;
   perform (body->>'assigned_at')::date;
   if not exists(select 1 from public.panda_records c join public.panda_records p on p.kind='packages' and p.id=c.data->>'package_id' where c.kind='clients' and c.id=owner::text and p.data->'features' ? 'nutrition') then raise exception 'Client needs nutrition access'; end if;
   if exists(select 1 from public.panda_records r where r.kind='recipe_assignments' and r.owner_id=owner and r.id<>rid and r.data->>'recipe_id'=body->>'recipe_id') then raise exception 'A recipe is already assigned to this client'; end if;
  elsif k='recipe_images' then
   if rid !~ '^recipe-image:[A-Za-z0-9_-]+$' or not coalesce(panda_private.valid_text(body->'image',180000),false) or body->>'image' !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$' then raise exception 'Invalid recipe photograph'; end if;
  end if;
  if k='clients' then
   perform panda_private.validate_profile(body);
   if body ? 'coach_notes' or body ? 'supplements' then raise exception 'Private notes must be stored separately'; end if;
   if length(body->>'name') not between 1 and 80 or body->>'status' not in ('active','onboarding','paused','archived') then raise exception 'Invalid client profile'; end if;
   foreach f in array array['package_id','program_id','nutrition_id'] loop
    if not exists(select 1 from public.panda_records where kind=case f when 'package_id' then 'packages' when 'program_id' then 'programs' else 'nutrition_plans' end and id=body->>f) then raise exception 'Choose existing plans and package'; end if;
   end loop;
   if not is_coach then
    if old.id is null then raise exception 'Only the coach can create profiles'; end if;
    immutable:=array['name','email','location','goal','occupation','activity_level','preferences','allergies','limitations','sex','age','height','weight','goal_weight','favorites','read_articles','onboarding'];
    if (body-immutable) is distinct from (old.data-immutable) then raise exception 'Only your coach can change assignments and access' using errcode='42501'; end if;
   end if;
  elsif k='checkins' then
   if body ? 'coach_private' then raise exception 'Private feedback must be stored separately'; end if;
   if not is_coach then
    if old.id is not null then raise exception 'Submitted check-ins are read-only' using errcode='42501'; end if;
    if body->>'status' is distinct from 'submitted' or coalesce(body->>'coach_feedback','')<>'' or coalesce(body->>'reviewed_at','')<>'' then raise exception 'Coach review fields are protected' using errcode='42501'; end if;
   end if;
   foreach f in array array['energy','sleep_quality','hunger','digestion','stress'] loop
    if jsonb_typeof(body->f) is distinct from 'number' or (body->>f)::numeric not between 1 and 5 or (body->>f)::numeric<>trunc((body->>f)::numeric) then raise exception 'Invalid check-in rating'; end if;
   end loop;
   if (body->>'weight')::numeric not between 20 and 400 or (body->>'adherence')::numeric not between 0 and 100 or (body->>'sleep_hours')::numeric not between 0 and 24 then raise exception 'Invalid check-in values'; end if;
   if exists(select 1 from public.panda_records r where r.kind=k and r.owner_id=owner and r.id<>rid and date_trunc('week',(r.data->>'week')::date)=date_trunc('week',(body->>'week')::date)) then raise exception 'A check-in already exists for this week'; end if;
  elsif k in ('measurements','activity') then
   if exists(select 1 from public.panda_records r where r.kind=k and r.owner_id=owner and r.id<>rid and r.data->>'date'=body->>'date') then raise exception 'A record already exists for this date'; end if;
   if k='measurements' and jsonb_typeof(body->'values') is distinct from 'object' then raise exception 'Invalid measurement values'; end if;
   if k='activity' then
    foreach f in array array['steps','cardio','water','sleep'] loop
     if jsonb_typeof(body->f) is distinct from 'number' or (body->>f)::numeric<0 then raise exception 'Invalid activity value'; end if;
    end loop;
   end if;
  elsif k='photos' then
   if length(body->>'data')>500000 or (body->>'data') !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'Invalid progress photo'; end if;
  elsif k='settings' and rid not in ('brand','measurement_defs','exercise_edits','roadmap','strategy','swaps') then raise exception 'Unknown setting';
  elsif k='packages' and (jsonb_typeof(body->'features') is distinct from 'array' or not (body->'features' <@ '["training","library","nutrition","supplements","progress","checkins","activity","education","roadmap"]'::jsonb)) then raise exception 'Invalid package features';
  end if;
  if k='drafts' then
   if jsonb_typeof(body) is distinct from 'object' then raise exception 'Invalid draft'; end if;
   for f in select jsonb_object_keys(body) loop
    if not coalesce(panda_private.valid_text(body->f,6000),false) and not panda_private.valid_number(body->f,0,10000) then raise exception 'Invalid draft field'; end if;
   end loop;
  end if;
  if k='checkins' then
   if not panda_private.valid_number(body->'weight',20,400) or not panda_private.valid_number(body->'sleep_hours',0,24) or not panda_private.valid_number(body->'adherence',0,100) or not panda_private.valid_number(body->'training_days',0,7) or (body->>'training_days')::numeric<>trunc((body->>'training_days')::numeric) then raise exception 'Invalid check-in values'; end if;
   if body->>'status' not in ('submitted','reviewed') or body->>'week' is null or body->>'week' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid check-in week or status'; end if;
   perform (body->>'week')::date;
   foreach f in array array['training','nutrition','wins','challenges','questions','coach_feedback'] loop
    if body ? f and not coalesce(panda_private.valid_text(body->f,6000),false) then raise exception 'Invalid check-in feedback'; end if;
   end loop;
  end if;
  if k='measurements' then
   for f in select jsonb_object_keys(body->'values') loop
    if not exists(select 1 from public.panda_records r,jsonb_array_elements(r.data) d where r.kind='settings' and r.id='measurement_defs' and d->>'id'=f) then raise exception 'Unknown measurement'; end if;
    if f in ('blood_pressure','somatotype') then
     if not coalesce(panda_private.valid_text(body->'values'->f,100),false) then raise exception 'Invalid measurement text'; end if;
    elsif not panda_private.valid_number(body->'values'->f,case when f in ('weight','waist','height') then .1 else 0 end,case when f in ('weight','waist','height') then 1000 else 100000 end) then raise exception 'Invalid measurement value'; end if;
   end loop;
  end if;
  if k='activity' and (not panda_private.valid_number(body->'steps',0,100000) or not panda_private.valid_number(body->'cardio',0,1440) or not panda_private.valid_number(body->'water',0,15) or not panda_private.valid_number(body->'sleep',0,24)) then raise exception 'Invalid activity values'; end if;
  if k='photos' and (not coalesce(panda_private.valid_text(body->'pose',50),false) or not coalesce(panda_private.valid_text(body->'data',500000),false)) then raise exception 'Invalid photograph'; end if;
  if k in ('checkins','measurements','activity','photos') then
   if body->>'client_id' is distinct from owner::text then raise exception 'Invalid owner'; end if;
   stamp:=body->>'date';
   if stamp is null or stamp !~ '^\d{4}-\d{2}-\d{2}$' or stamp::date>current_date+1 then raise exception 'Invalid record date'; end if;
  end if;
  seq:=coalesce(old.revision,0)+1;
  insert into public.panda_records(kind,id,owner_id,data,revision) values(k,rid,owner,body,seq)
  on conflict(kind,id) do update set data=excluded.data,revision=excluded.revision,updated_at=now();
  -- Pausing/archiving blocks existing JWTs through the account row checked by RLS.
  if k='clients' and is_coach then update public.panda_accounts set active=(body->>'status' in ('active','onboarding')) where user_id=owner; end if;
  insert into public.panda_events(actor_id,owner_id,label) values(auth.uid(),owner,coalesce(label,'Saved changes'));
  result:=result||jsonb_build_array(jsonb_build_object('kind',k,'id',rid,'revision',seq));
 end loop;
 if exists(select 1 from public.panda_records r, lateral jsonb_path_query(r.data,'$.**.image') ref where r.kind in ('recipes','recipe_assignments','nutrition_plans','plan_history') and (ref#>>'{}') like 'recipe-image:%' and not exists(select 1 from public.panda_records image where image.kind='recipe_images' and image.id=ref#>>'{}')) then raise exception 'A recipe image is missing or still referenced'; end if;
 return result;
end $$;
revoke all on function public.panda_save(jsonb,text) from public,anon;
grant execute on function public.panda_save(jsonb,text) to authenticated;
commit;
