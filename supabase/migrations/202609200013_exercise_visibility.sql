-- Hiding a catalogue exercise stores a marker entry in the exercise_edits
-- setting that carries only its identity and the hidden flag. The studio
-- validator from 0.9.6 demanded a name, muscle groups and instructions for
-- every entry, so every hide attempt failed with
-- "Invalid exercise name or instructions". Marker entries are now accepted;
-- entries that carry content of their own are validated as before.
-- Additive: no records are rewritten.
begin;
create or replace function panda_private.validate_studio_entry() returns trigger language plpgsql set search_path='' as $$
declare k text; v jsonb; x jsonb; f text; ds text; start_date date; end_date date;
begin
 if new.kind='articles' then
  if new.data ? 'photos' then
   if jsonb_typeof(new.data->'photos') is distinct from 'object' then raise exception 'Invalid article photographs';end if;
   perform panda_private.validate_photo_variants(new.data->'photos'->'cover');
   if new.data->'photos' ? 'chapters' then
    if jsonb_typeof(new.data->'photos'->'chapters') is distinct from 'object' then raise exception 'Invalid chapter photographs';end if;
    for k,v in select * from jsonb_each(new.data->'photos'->'chapters') loop
     if k !~ '^\d{1,2}$' or k::int>49 then raise exception 'Invalid photograph chapter';end if;
     perform panda_private.validate_photo_variants(v);
    end loop;
   end if;
  end if;
  foreach f in array array['title_ar','summary_ar','category_ar'] loop
   if new.data ? f and not coalesce(panda_private.valid_text(new.data->f,case when f='summary_ar' then 600 else 200 end),false) then raise exception 'Invalid Arabic article text';end if;
  end loop;
  if new.data ? 'sections_ar' then
   if jsonb_typeof(new.data->'sections_ar') is distinct from 'array' or jsonb_array_length(new.data->'sections_ar')>50 then raise exception 'Invalid Arabic chapters';end if;
   for x in select value from jsonb_array_elements(new.data->'sections_ar') loop
    if jsonb_typeof(x) is distinct from 'array' or jsonb_array_length(x)<>2 or not coalesce(panda_private.valid_text(x->0,200),false) or not coalesce(panda_private.valid_text(x->1,20000),false) then raise exception 'Invalid Arabic chapter text';end if;
   end loop;
  end if;
 elsif new.kind='settings' and new.id='exercise_edits' then
  if jsonb_typeof(new.data) is distinct from 'object' then raise exception 'Invalid exercise references';end if;
  for k,v in select * from jsonb_each(new.data) loop
   if jsonb_typeof(v) is distinct from 'object' then raise exception 'Invalid exercise references';end if;
   if v ? 'hidden' and jsonb_typeof(v->'hidden') is distinct from 'boolean' then raise exception 'Invalid exercise visibility';end if;
   if k like 'custom_ex_%' and (k !~ '^custom_ex_[A-Za-z0-9_-]+$' or v->>'exercise_id' is distinct from k) then raise exception 'Invalid custom exercise identity';end if;
   if k not like 'custom_ex_%' and v->'hidden'='true'::jsonb and coalesce(v->>'exercise_id',k)=k
      and not exists(select 1 from jsonb_object_keys(v) as t(entry_key) where t.entry_key not in ('exercise_id','hidden')) then
    continue;
   end if;
   if not coalesce(panda_private.valid_text(v->'name',160),false) or coalesce(length(trim(v->>'name')),0)=0 or jsonb_typeof(v->'muscle_groups') is distinct from 'array' or jsonb_typeof(v->'instructions') is distinct from 'array' then raise exception 'Invalid exercise name or instructions';end if;
   perform panda_private.validate_photo_variants(v->'photos');
  end loop;
 elsif new.kind='supplement_templates' then
  if not coalesce(panda_private.valid_text(new.data->'name',150),false) or coalesce(length(trim(new.data->>'name')),0)=0 or new.data->>'status' not in ('draft','published') or new.data->>'status' is null then raise exception 'Invalid supplement template';end if;
  if jsonb_typeof(new.data->'items') is distinct from 'array' or jsonb_array_length(new.data->'items')>40 then raise exception 'Use up to 40 supplement entries';end if;
  if new.data->>'status'='published' and jsonb_array_length(new.data->'items')=0 then raise exception 'A published template needs entries';end if;
  for x in select value from jsonb_array_elements(new.data->'items') loop
   if jsonb_typeof(x) is distinct from 'object' or coalesce(length(trim(x->>'name')),0)=0 then raise exception 'Name every supplement';end if;
   foreach f in array array['name','dose','timing','purpose','notes'] loop
    if x ? f and not coalesce(panda_private.valid_text(x->f,3000),false) then raise exception 'Invalid supplement text';end if;
   end loop;
   if new.data->>'status'='published' and (coalesce(length(trim(x->>'dose')),0)=0 or coalesce(length(trim(x->>'timing')),0)=0) then raise exception 'Published templates need amounts and timing';end if;
   if x ? 'status' and x->>'status' not in ('active','paused') then raise exception 'Invalid supplement status';end if;
   start_date:=null;end_date:=null;
   foreach f in array array['start_date','end_date'] loop
    ds:=x->>f;
    if x ? f and jsonb_typeof(x->f) is distinct from 'string' then raise exception 'Invalid supplement date';end if;
    if coalesce(ds,'')<>'' then
     if ds !~ '^\d{4}-\d{2}-\d{2}$' or to_char(ds::date,'YYYY-MM-DD')<>ds then raise exception 'Invalid supplement date';end if;
     if f='start_date' then start_date:=ds::date;else end_date:=ds::date;end if;
    end if;
   end loop;
   if start_date>end_date then raise exception 'Invalid supplement date range';end if;
  end loop;
 elsif new.kind='supplement_references' then
  if not coalesce(panda_private.valid_text(new.data->'name',150),false) or coalesce(length(trim(new.data->>'name')),0)=0 then raise exception 'Invalid reference name';end if;
  foreach f in array array['purpose','category','notes'] loop
   if not coalesce(panda_private.valid_text(new.data->f,3000),false) then raise exception 'Invalid reference text';end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function panda_private.validate_studio_entry() from public,anon,authenticated;
commit;
