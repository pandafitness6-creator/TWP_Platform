# INTAKE-DESIGN — the `client_intake` record kind

This document covers the record shape, migration `023`, the frontend wiring and the risks. It was first written as a proposal and has been **updated to match what was built** in `supabase/migrations/202611130023_client_intake.sql` and `202611140024_client_archived_at.sql` (§8). The database side is built and tested (`tests/client-intake.cjs`, `tests/client-archive.cjs`). The frontend wiring in §4 is not built yet. Line references point at the tree on `feature/auto-onboarding`.

**Decisions in this document**

| # | Decision |
|---|---|
| D1 | New client-owned kind `client_intake`. Record id = `owner_id` = the client's auth uuid. One intake per client. |
| D2 | Readable by the coach and by the owning client. Not gated by any package feature. |
| D3 | Clients can write it only while their profile is `onboarding` and the intake is still a draft, or after the coach reopens it. Once submitted it is locked for the client. |
| D4 | Name, gender, age, height, weight and goal stay on `clients` only. Intake writes them there, in the same atomic save. At submission the server copies them into a read-only snapshot. |
| D5 | Validation, the write window and server-stamped fields live in a new trigger. `panda_save` and `readable()` get four and one small text patches, applied by search-and-replace like migrations 009, 010 and 014. |
| D6 | When a save batch contains `client_intake`, the database replaces the event label with a fixed string, so no caller can put intake content into `panda_events`. |
| D7 | `health_flag` is computed by the server on every write from seven answers (§1.2). Nobody can set it. |
| D8 | Lifts record a type (`1rm`, `working_set` or `unknown`), with reps for a working set (§1.5). |
| D9 | `consent.health_data` is kept and must be `true` to submit (§1.10). |
| D10 | Retention is configurable in `settings/brand.intake_retention_months` (default 24 months after archive), and the server records each client's archive date in `clients.archived_at` (§8). No deletion job yet. |
| D11 | The coach can only change the status: reopen an intake, or open an empty reopened one for a client who has none. Answers and the server fields are refused (migration 025, §3.1). |

---

## 1. Schema

### 1.1 Shape rules

- **Strict shape.** Every group and every key below must be present in every write, drafts included. Unknown keys are rejected at every level. The frontend always sends the full skeleton.
- **Two levels of validation.** Types and ranges are always checked. A value may be `null` while `status` is `draft` or `reopened`. Completeness (the "Required" column) is checked only when `status` is `submitted`.
- **Size cap.** `octet_length(data::text) ≤ 65,536`. The table already allows 1 MB per row; intake needs far less.
- **Server-managed fields** (marked ⚙): `submitted_at`, `submitted_profile` and `health_flag`. The trigger removes whatever a client or a direct write sends for them and sets them itself. A coach who sends a different value is refused (migration 025); leaving them out is fine.
- **Personal data.** The six existing personal fields are **not** in this record (§5). Only neck and waist are stored here, because they have no other home that every package can write.

### 1.2 Top level

| Field | Type | Rule | Required |
|---|---|---|---|
| `id` | string | must equal the record id and `owner_id` (the client's uuid) | always |
| `form_version` | integer | `1`. Increment it when the questions change, and the validator with it | always |
| `status` | string | `draft` \| `submitted` \| `reopened`. Only the coach may move an intake to `reopened`. A client sends `draft` or `submitted`; while the intake is `reopened` the client may also send `reopened`, and the server stores a client's `draft` as `reopened` until they submit (§3.1) | always |
| `submitted_at` ⚙ | string \| null | ISO timestamp stamped by the server when `status` changes to `submitted`; otherwise carried over from the previous version | – |
| `submitted_profile` ⚙ | object \| null | Snapshot of `clients.name, sex, age, height, weight, goal`, copied by the server when `status` changes to `submitted` | – |
| `health_flag` ⚙ | boolean | Recomputed on every write, drafts included. `true` when any of `medical.conditions.chest_pain`, `heart_disease`, `stroke`, `coronary_disease`, `light_headedness`, `pregnancy` or `medical.exercise_contraindications.present` is `true`; otherwise `false` (unanswered counts as `false`) | always |
| `personal` | object | §1.3 | always |
| `medical` | object | §1.4 | always |
| `training` | object | §1.5 | always |
| `goals` | object | §1.6 | always |
| `schedule` | object | §1.7 | always |
| `equipment` | object | §1.8 | always |
| `other` | object | §1.9 | always |
| `consent` | object | §1.10 (**an addition** to the requested questions) | always |

### 1.3 `personal`

| Field | Type | Rule | Required on submit |
|---|---|---|---|
| `neck_cm` | number \| null | 20–80, at most 1 decimal place | yes |
| `waist_cm` | number \| null | 40–250, at most 1 decimal place | yes |

Name, gender, age, height, weight and training goal are written to `clients` (§5).

### 1.4 `medical`

| Field | Type | Rule | Required on submit |
|---|---|---|---|
| `conditions` | object | exactly the 20 keys below, each `boolean \| null` | every key non-null |
| `conditions_confirmed` | boolean \| null | the client has reviewed the list ("none of these apply" is a real answer, not a skipped section) | must be `true` |
| `injuries_past_5_years` | object | `{present: boolean\|null, details: string ≤2000}` | `present` non-null; `details` non-blank if `present` |
| `ongoing_aches` | object | same shape | same |
| `exercise_contraindications` | object | same shape | same |
| `medications` | object | same shape | same |

`conditions` keys, one per checkbox:
`arthritis`, `back_pain`, `knee_pain`, `shin_splints`, `muscle_pain`, `foot_pain`, `light_headedness`, `chest_pain`, `epilepsy`, `diabetes`, `high_cholesterol`, `smoking`, `high_triglycerides`, `respiratory_disease` (asthma, emphysema or bronchitis), `high_blood_pressure`, `coronary_disease`, `heart_disease`, `stroke`, `pregnancy`, `family_coronary_before_55`.

### 1.5 `training`

| Field | Type | Rule | Required on submit |
|---|---|---|---|
| `experience_years` | number \| null | 0–80, in steps of 0.5 | yes |
| `lifts` | object | exactly `squat`, `bench_press`, `deadlift`, each with exactly the five keys below | – |
| `lifts.<lift>.type` | string | `1rm` \| `working_set` \| `unknown`. Always required, drafts included (UI default `unknown`) | always |
| `lifts.<lift>.value` | number \| null | `unknown`: must be `null`. Otherwise 0.01–600 if unit is `kg`, 0.01–1300 if `lb`, at most 2 decimal places | yes, unless `unknown` |
| `lifts.<lift>.unit` | string | `kg` \| `lb` | always (UI default `kg`) |
| `lifts.<lift>.reps` | integer \| null | `working_set`: 1–20 (may be `null` in a draft). `1rm` and `unknown`: must be `null` | yes, for `working_set` |
| `lifts.<lift>.estimated` | boolean | must be `false` when `type` is `unknown` | always |

A draft may hold a working set with no reps yet, so the client can save before filling them in; reps are required on submit.

### 1.6 `goals`

| Field | Type | Rule | Required on submit |
|---|---|---|---|
| `focus_muscles` | array of strings | 0–3 unique values from `Chest`, `Back`, `Shoulders`, `Biceps`, `Triceps`, `Forearms`, `Core`, `Glutes`, `Quads`, `Hamstrings`, `Calves` (the catalogue's `muscle_groups`, minus `Cardio` and `General`) | no (empty allowed) |

The training-goals text is `clients.goal` (§5).

### 1.7 `schedule`

| Field | Type | Rule | Required on submit |
|---|---|---|---|
| `days_per_week` | integer \| null | 1–7 | yes |
| `minutes_per_session` | integer \| null | 10–240 | yes |

These are the client's stated availability. They are deliberately **not** `clients.training_days`, which is a coach-set target that clients cannot write.

### 1.8 `equipment`

| Field | Type | Rule | Required on submit |
|---|---|---|---|
| `items` | object | exactly the 10 keys below, each `{available: boolean\|null, details: string ≤300}` | every `available` non-null |
| `notes` | string | ≤2000 (where they train, anything not listed) | no |

`items` keys: `barbells`, `dumbbells`, `squat_racks`, `benches`, `cable_machines`, `smith_machine`, `leg_press`, `glute_ham_raise`, `back_raise_45`, `cardio_equipment`. `details` holds the free-text description for each item, for example "dumbbells up to 30 kg" or "treadmill and bike".

### 1.9 `other`

| Field | Type | Rule | Required on submit |
|---|---|---|---|
| `notes` | string | ≤4000 | no |

### 1.10 `consent`

| Field | Type | Rule | Required on submit |
|---|---|---|---|
| `health_data` | boolean \| null | the client agrees that the coach may store and use this health information | must be `true` ("Agree to the health information consent before submitting") |

Health data is a special category in most privacy regimes. Decision: keep this group in `form_version` 1.

### 1.11 Example (submitted)

```json
{
  "id": "6f1c…-uuid", "form_version": 1, "status": "submitted",
  "submitted_at": "2026-11-20T08:14:03.512Z",
  "submitted_profile": {"name": "Sam Lee", "sex": "Female", "age": 34, "height": 168, "weight": 71.5, "goal": "Get stronger and run a 10 km"},
  "health_flag": false,
  "personal": {"neck_cm": 33.5, "waist_cm": 78},
  "medical": {
    "conditions": {"arthritis": false, "back_pain": true, "knee_pain": false, "...": false, "family_coronary_before_55": false},
    "conditions_confirmed": true,
    "injuries_past_5_years": {"present": true, "details": "Right ankle sprain 2023, fully recovered"},
    "ongoing_aches": {"present": true, "details": "Lower back stiffness after long drives"},
    "exercise_contraindications": {"present": false, "details": ""},
    "medications": {"present": false, "details": ""}
  },
  "training": {"experience_years": 2.5, "lifts": {
    "squat": {"type": "1rm", "value": 80, "unit": "kg", "reps": null, "estimated": true},
    "bench_press": {"type": "working_set", "value": 45, "unit": "kg", "reps": 8, "estimated": false},
    "deadlift": {"type": "unknown", "value": null, "unit": "kg", "reps": null, "estimated": false}}},
  "goals": {"focus_muscles": ["Glutes", "Back"]},
  "schedule": {"days_per_week": 3, "minutes_per_session": 60},
  "equipment": {"items": {"barbells": {"available": true, "details": ""}, "dumbbells": {"available": true, "details": "up to 30 kg"}, "...": {"available": false, "details": ""}}, "notes": "Commercial gym"},
  "other": {"notes": ""},
  "consent": {"health_data": true}
}
```

---

## 2. Migration

**New file:** `supabase/migrations/202611130023_client_intake.sql`. It runs in one transaction (`begin; … commit;`) and must be **safe to re-run**, because `tests/access-expiry.cjs:52` re-executes the last migration (see §7).

### 2.1 How it must be written: patch, don't replace

`panda_save` today is **003's source plus two patches**:

- 009 replaced the activity checks with `perform panda_private.validate_activity(body)`.
- 010 inserted the block marked `-- Panda hydration-only package guard.`, which lets nutrition-only clients record water only.

`readable()` is **003's source plus two patches**:

- 010 added `or panda_private.feature('nutrition')` to activity reads.
- 014 added `cardio_id` to programme reads.

None of these patched versions exists as a file. Copying either function from 003 (or from `FRESH-INSTALL.sql`) into a `create or replace` would silently remove that behaviour.

So 023 must:

1. Read the installed body with `pg_get_functiondef(...)`.
2. **Check the earlier patches are present.** Abort with `raise exception '… review migration 023'` if any is missing:
   - `panda_save`: `perform panda_private.validate_activity(body)` (009) and `-- Panda hydration-only package guard.` (010).
   - `readable()`: `panda_private.feature('activity') or panda_private.feature('nutrition')` (010) and `coalesce(panda_private.profile()->>'cardio_id','')` (014).
3. **Skip if already applied.** If the function already contains the 023 marker, do nothing (needed for re-runs).
4. For each anchor, confirm it occurs **exactly once** with the same `(length(def)-length(replace(def,orig,'')))/length(orig)` test that 009, 010 and 014 use. Then `replace` it.
5. `execute` the patched definition once, re-read it, and re-assert that all 023 replacements **and** the 009 and 010 markers are present.

All anchors below were checked against `202609130003_recipes.sql`: each occurs exactly once and none overlaps the 009, 010 or 014 edits.

### 2.2 Kind CHECK constraint

These constraints are named. 003 dropped the original unnamed ones and re-created them; 007 replaced the kind list.

```sql
alter table public.panda_records drop constraint if exists panda_records_kind_check;
alter table public.panda_records add constraint panda_records_kind_check check (kind in (
 'clients','client_private','packages','foods','programs','nutrition_plans','checkins','checkin_private',
 'measurements','activity','photos','articles','invoices','drafts','settings','plan_history','supplements',
 'recipes','recipe_assignments','recipe_images','supplement_templates','supplement_references',
 'client_intake'));
```

Preflight: before dropping, read `pg_get_constraintdef` and abort unless it lists exactly the 22 kinds above. If it doesn't, someone added a kind since 007, and hard-coding the list would drop it.

### 2.3 Ownership

**Table constraint** (last set in 003):

```sql
alter table public.panda_records drop constraint if exists panda_records_ownership_check;
alter table public.panda_records add constraint panda_records_ownership_check check ((kind in (
 'clients','client_private','checkins','checkin_private','measurements','activity','photos','invoices',
 'drafts','supplements','recipe_assignments','client_intake')) = (owner_id is not null));
```

Use the same preflight against the current 11 kinds.

**`panda_save` owner mapping** (patch A). The owner is taken from the record id, like `clients` and `drafts`:

```
orig: if k in ('clients','client_private','drafts','supplements') then owner:=rid::uuid;
new:  if k in ('clients','client_private','drafts','supplements','client_intake') then owner:=rid::uuid;
```

Existing `panda_save` checks then apply unchanged:
- `rid` must be a uuid;
- a client can only write `owner = auth.uid()`;
- the owner must be a `role='client'` account;
- `data.id` must equal `rid`.

### 2.4 `readable()`: coach and owning client, no package check

The coach branch already returns `true` first. In the owner branch, owner has already been checked against `auth.uid()`, so the patch only has to return before any feature check:

```
orig: if k in ('checkins','drafts') then return panda_private.feature('checkins'); end if;
new:  if k='client_intake' then return true; end if; -- Panda client intake.
  if k in ('checkins','drafts') then return panda_private.feature('checkins'); end if;
```

Marker for the re-run check: `-- Panda client intake.`

Result: the `record_read` RLS policy lets the owning client and coach accounts read the record, and nobody else. `ready()` still applies: the account must be active, the password changed and access not expired. `panda_save`'s client-side `readable()` check passes for the owner.

### 2.5 `panda_save`: which kinds clients may write

**Patch B: allow client writes.**

```
orig: k not in ('clients','checkins','measurements','activity','photos','drafts')
new:  k not in ('clients','checkins','measurements','activity','photos','drafts','client_intake')
```

This only allows client writes in principle. **When** they may write is enforced by the trigger (§2.6 and §3).

**Patch C: refuse deletion through `panda_save`.** This protects medical data from accidental deletion, for example by a backup restore (§7). Account deletion still cascades through the foreign key.

```
orig: if k in ('clients','packages','programs','nutrition_plans','foods','settings') then raise exception 'Referenced records cannot be deleted'; end if;
new:  if k in ('clients','packages','programs','nutrition_plans','foods','settings','client_intake') then raise exception 'Referenced records cannot be deleted'; end if;
```

Clients already cannot delete it, because it is not in their deletable list.

**Patch D: fixed event label.** See §6.

### 2.6 Validation and write-window trigger

New functions. Each is `create or replace` with `set search_path=''`, and `revoke all … from public, anon, authenticated` follows each one:

- `panda_private.intake_shape(o jsonb, keys text[]) returns boolean`. Returns true when `o` is an object with exactly `keys`. Use `CASE` on `jsonb_typeof` first, because SQL `and` does not guarantee short-circuiting.
- `panda_private.intake_bool(v, required)` and `panda_private.intake_number(v, lo, hi, step, required)`: a boolean, or a number in range that is a multiple of `step`; JSON `null` is accepted when not required. (Built instead of reusing `valid_number`, so steps such as 0.5 years and 0.01 kg are checked in one place.)
- `panda_private.validate_client_intake(b jsonb, submitting boolean) returns void`. Applies the §1 tables. It reuses `panda_private.valid_text`, plus `panda_private.valid_number` for non-null values (`b->'x'='null'::jsonb or valid_number(b->'x',lo,hi)`). Error messages name the field, never its value.
- `panda_private.guard_client_intake() returns trigger`, `security definer`:

As built (migration 023, section 5):

```sql
create or replace function panda_private.guard_client_intake() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous jsonb; profile jsonb; was text; next_status text; c jsonb; flag boolean;
begin
 -- panda_save upserts: BEFORE INSERT fires even when the row exists (see 012), so look it up.
 if tg_op='UPDATE' then previous:=old.data;
 else select r.data into previous from public.panda_records r where r.kind='client_intake' and r.id=new.id; end if;
 if jsonb_typeof(new.data) is distinct from 'object' or new.data->>'id' is distinct from new.id or new.owner_id::text is distinct from new.id then raise exception 'Invalid intake identity'; end if;
 was:=previous->>'status';
 next_status:=case when jsonb_typeof(new.data->'status')='string' then new.data->>'status' end;
 select r.data into profile from public.panda_records r where r.kind='clients' and r.id=new.id;
 -- Client sessions only. The service role has no auth.uid() (as in sync_client_access).
 if auth.uid() is not null and not panda_private.coach() then
  -- coalesce: with no intake yet (or no profile) a bare comparison is NULL, and NOT NULL never raises.
  if not coalesce((coalesce(was,'draft')='draft' and profile->>'status'='onboarding') or was='reopened',false) then
   raise exception '%',case when was='submitted' then 'Your intake has been submitted. Ask your coach to reopen it.' else 'Your intake is not open. Ask your coach to reopen it.' end using errcode='42501';
  end if;
  -- A reopened intake stays reopened until the client submits it: saving a draft must not
  -- close the window for a client who is no longer onboarding.
  if was='reopened' and next_status in ('draft','reopened') then
   next_status:='reopened';new.data:=jsonb_set(new.data,'{status}','"reopened"');
  elsif next_status is null or next_status not in ('draft','submitted') then raise exception 'Invalid intake status' using errcode='42501';
  end if;
 end if;
 -- Server-managed fields: whatever the caller sent is discarded.
 c:=new.data->'medical'->'conditions';
 flag:=coalesce(c->'chest_pain'='true'::jsonb,false) or coalesce(c->'heart_disease'='true'::jsonb,false)
  or coalesce(c->'stroke'='true'::jsonb,false) or coalesce(c->'coronary_disease'='true'::jsonb,false)
  or coalesce(c->'light_headedness'='true'::jsonb,false) or coalesce(c->'pregnancy'='true'::jsonb,false)
  or coalesce(new.data->'medical'->'exercise_contraindications'->'present'='true'::jsonb,false);
 new.data:=new.data-'submitted_at'-'submitted_profile'-'health_flag';
 if next_status='submitted' and was is distinct from 'submitted' then
  new.data:=new.data||jsonb_build_object('submitted_at',to_jsonb(now()),
   'submitted_profile',jsonb_build_object('name',profile->'name','sex',profile->'sex','age',profile->'age',
    'height',profile->'height','weight',profile->'weight','goal',profile->'goal'));
 else
  new.data:=new.data||jsonb_build_object('submitted_at',coalesce(previous->'submitted_at','null'::jsonb),
   'submitted_profile',coalesce(previous->'submitted_profile','null'::jsonb));
 end if;
 new.data:=new.data||jsonb_build_object('health_flag',flag);
 perform panda_private.validate_client_intake(new.data,next_status='submitted');
 return new;
end $$;
drop trigger if exists panda_client_intake_guard on public.panda_records;
create trigger panda_client_intake_guard before insert or update on public.panda_records
for each row when (new.kind='client_intake') execute function panda_private.guard_client_intake();
```

Notes on the trigger:

- **The window check must not be NULL.** The first draft of this design used `if not ((coalesce(was,'draft')='draft' and profile->>'status'='onboarding') or was='reopened')`. For an `active` client with no intake yet, that is `not (false or NULL)`, which is NULL, and an `IF` on NULL does not raise. Any active client could have created an intake. The built version wraps the condition in `coalesce(…, false)`, so an unknown answer means "closed". A test covers this case.
- **Reopened stays reopened.** In the first draft, a client's draft save on a reopened intake stored `draft`. For a client who is no longer `onboarding`, the next save then failed the window check, so they were locked out halfway through. The server now rewrites a client's `draft` (or `reopened`) on a reopened intake to `reopened`; only `submitted` closes it.
- **Two lock messages.** `was='submitted'`: "Your intake has been submitted. Ask your coach to reopen it." Anything else (no intake on an active client, a paused client): "Your intake is not open. Ask your coach to reopen it." Both use errcode `42501`.
- **`health_flag`** is computed with jsonb comparisons, so `null` and missing answers count as `false`. It is recomputed on every write, including the coach's, and is valid on drafts.

- **Double firing.** On an upsert of an existing row, the trigger runs twice: on the INSERT pass, and again on the UPDATE pass with `old` set. Both passes see the same previous row and the same `now()`, so the result is identical. `EXCLUDED` carries the INSERT pass's changes.
- **Snapshot timing.** `submitted_profile` reads `clients` inside the same transaction. The frontend sorts `clients` before `client_intake` in each batch (`16-cloud.js:181`; unknown kinds sort last), so the snapshot includes the profile edits made in the same submission.
- **Why a trigger.** Validation in a trigger keeps the `panda_save` patches to four one-line anchors. It also means direct service-role writes are validated too, and it follows the existing pattern (`validate_coaching_update`, `validate_studio_entry`, `guard_client_assignment`, `sync_client_access`).

### 2.7 Files touched outside the migration

| File | Change |
|---|---|
| `database/MIGRATION-ORDER.txt` | append `202611130023_client_intake.sql` |
| `database/FRESH-INSTALL.sql` | append `-- Migration: 202611130023_client_intake.sql` plus the file. No script generates it, so this is a manual concatenation. |
| `database/README.md`, `docs/DEPLOY.md` (lines 27, 29) | "22 migrations/files" → 23. Add an upgrade note: run the migration **before** deploying the frontend. |
| `tests/verify.cjs:10,12` | `assert.equal(files.length,22)` → 23, and the pass text |
| `tests/access-expiry.cjs:52` | pin the re-run to 022 by file name instead of `migrations.at(-1)` |
| new test | RLS and `panda_save` cases from §3 and §6 |
| `MANIFEST.json`, `MANIFEST.sha256` | regenerate with `npm run manifest` |

---

## 3. Write window

### 3.1 Recommended rule (D3)

| Who | When they can write | What they can set |
|---|---|---|
| Client | (`clients.status = 'onboarding'` **and** no intake yet or intake is `draft`) **or** intake is `reopened` | `status` ∈ {`draft`, `submitted`}, or `reopened` while it is reopened; a `draft` on a reopened intake is stored as `reopened`. All client fields; server fields are ignored |
| Coach (migration 025) | always | Existing intake: the same record with `status` unchanged or `reopened`. No intake: `status: 'reopened'` with the empty skeleton. Anything else is refused with `42501`, naming what cannot change: "The coach cannot change intake answers (health screening). Reopen the intake so the client can update them.", "The coach cannot change the submission date (submitted_at)." (and the same for `submitted_profile` and `health_flag`), "The coach can only reopen an intake. Only the client can save or submit it.", "The coach can only create an intake as reopened, for the client to fill in.", "The coach cannot fill in intake answers. Open an empty intake for the client to complete." |
| Client, intake `submitted` | refused with `42501` "Your intake has been submitted. Ask your coach to reopen it." | – |
| Client, any other state (for example `active` with no intake) | refused with `42501` "Your intake is not open. Ask your coach to reopen it." | – |

Consequences:

- Saving a draft is allowed during onboarding. Submitting locks the intake for the client, **even if the client is still `onboarding`**, so the coach never reviews a moving target.
- Clients who are already `active` when this ships (or whom the coach activates before they finish) cannot start an intake on their own. The coach "requests" one by creating the record as `reopened` with the empty skeleton (`panda_private.intake_is_blank`), or by setting an existing draft to `reopened`. The client can then save drafts as often as needed; the intake stays `reopened` until they submit.
- Pausing or archiving a client still blocks everything through `ready()`.
- The UI should offer **Save draft** per step, not autosave on every keystroke. Each save writes one `panda_events` row (§7).

### 3.2 Should the client be able to edit after submission?

**Recommendation: no.** Editing should be coach-mediated: the coach reopens the intake, and the client edits and resubmits.

| | Client can edit freely afterwards | Locked; coach reopens (recommended) |
|---|---|---|
| Data integrity | The record is overwritten in place. Only the current version exists, and the event log says only "Updated intake questionnaire". A disclosed condition (chest pain, pregnancy) can disappear after the coach has programmed around it, with no trace of what was there. | What the coach reviewed stays as submitted until the coach deliberately reopens it. Reopening is logged with the coach as actor. |
| Liability | Hard to show what the client declared when a plan was written. | `submitted_at` and `submitted_profile` are server-stamped and can't be forged by the client. |
| Freshness | Health changes can be reported immediately. | Risk of stale data. Mitigations: the coach reopens on request (chat), and a check-in question such as "any new injury or health change?" prompts it. |
| Abuse surface | Small. Clients can already write free text to their own profile. The risk is integrity, not access. | Smallest. |
| Complexity | Simpler trigger. | One extra state (`reopened`) and a coach "Reopen intake" action. |

Resubmitting replaces the previous submission. If the coach needs history, a later step can have the trigger append the outgoing submitted version to a server-managed `history` array (cap 10) that the client cannot modify. This is not needed for version 1.

---

## 4. Frontend wiring (`src/js/16-cloud.js`)

**Option chosen: treat it like the other per-client array kinds.**

| Where | Change | Why |
|---|---|---|
| `16-cloud.js:12` `arrays` | add `'client_intake'` | `assemble()` (`:135`, `:138`) then initialises `s.client_intake=[]` and pushes each loaded row. `flatten()` (`:153`) then emits `put('client_intake', row.id, row)` with no special case: no private split and no history split. Without this, `assemble()` silently drops the kind, because unknown kinds match no branch at `:138`. |
| `16-cloud.js:153` `flatten()` | `for(const row of s[type]||[])` | `flatten()` also runs on backup states during `restore()`. An older backup has no `client_intake` key, which would throw. |
| `16-cloud.js:181` commit `order` | optionally append `'client_intake'` after `'clients'` | It already sorts last as an unknown kind (index 99). Making it explicit documents the dependency the trigger snapshot relies on (§2.6). |
| `16-cloud.js:189` `restore()` | always copy `before.client_intake` into `after` before `commit` (since 025; before it, only when the backup had no `client_intake` key) | Intakes belong to the clients and are never restored. Otherwise the diff produces deletions (`data:null`), refused by Patch C, or answer changes, refused by 025, so the **whole restore would fail**. Carrying intakes over keeps restores working and never reverts medical data. |
| After a successful submit | reload with `snapshot()`, or patch `submitted_at` and `submitted_profile` into state | The server stamps these. Local state lacks them until reload. The diff stays correct either way, because both `before` and `after` lack them, but the UI would show "not submitted" until then. |

Related, outside `16-cloud.js`:

- `src/js/13-seed-coaching-recipes.js:118` `PandaRecipes.migrate`: add `if(!Array.isArray(s.client_intake))s.client_intake=[];`. This runs in `init`, `restore` and `bindCloud` (`15-services.js:58,65,70`), so local demo data and old backups get the key.
- `src/js/15-services.js:10-12` `validate()`: add `client_intake` as an optional array of plain objects (≤20,000 rows), to match the other kinds.
- The client's state holds only their own intake (RLS); the coach's holds all of them. Coach screens find a client's intake with `state.client_intake.find(x=>x.id===client.id)`.
- Route gating: don't wrap the intake screen in `allowed(feature)`. `allowed()` with no feature already returns `true` (`26-portal.js:30`), which matches D2.
- First login: `ready()` is false until `must_change_password` is cleared, so the intake can only load **after** the password change. Show it when `client().status==='onboarding'` and the intake is missing, `draft` or `reopened`. Derive the state from `client_intake.status`; don't add an `onboarding.intake` flag to `clients` (two sources of truth).

---

## 5. Existing fields on `clients`

**Recommendation: write to `clients` only. The intake record never stores its own editable copy.**

| Intake question | Stored in | Rule (already enforced by `validate_profile` and the UI) |
|---|---|---|
| Name | `clients.name` | text 1–80 |
| Gender | `clients.sex` | `Male` \| `Female` \| `Not specified`. Use these exact values: the calorie calculator reads them (`26-portal.js:365`). The database accepts any text, so the form must restrict it. |
| Age | `clients.age` | whole number 16–100 |
| Height (cm) | `clients.height` | 100–250 |
| Weight (kg) | `clients.weight` | 20–400 |
| Training goals | `clients.goal` | the UI caps it at 500 characters (the database at 6000) |

How:

- The intake form pre-fills these six from `client()`. The coach entered them at account creation, and they are required there.
- On **Save draft** or **Submit**, one `S.commit(s=>{…edit s.clients row… ; …upsert s.client_intake row…}, 'Updated intake questionnaire')` produces a single `panda_save` batch. It is atomic, so both records save or neither does.
- All six are already in the client-editable list (`202609130003_recipes.sql:124`), so the client may write them. **No change** to that list is needed.
- Divergence is impossible for current values, because there is only one copy. The **historical** question ("what did they declare at intake?") is answered by `submitted_profile`. The server copies it from `clients` at the moment of submission, and the client can't edit it. The UI must label it as "at intake", never present it as current.
- Neck and waist stay in the intake (`personal`) as **baseline** values. Do **not** also write a `measurements` row automatically:
  - `measurements` needs the `progress` feature, which the `essential` package lacks, so the save would fail for those clients.
  - A row already existing for the same date raises "A record already exists for this date".
  - The coach can copy baselines into measurements if wanted.
- Don't copy medical answers into `clients.limitations` or `clients.allergies`. Those appear on the profile and in printed plan documents.

---

## 6. Privacy: keeping medical data out of `panda_events`

What is visible where:

- `panda_events` stores `actor_id`, `owner_id`, `label` and `at`.
- `event_read` lets a client read every event whose `owner_id` is them, including the coach's actions. Clients see this as their audit list (`16-cloud.js:148`).
- The label comes from the caller (≤160 characters). It is the only free text in that table.

Controls:

1. **Database (authoritative). Patch D in `panda_save`**, right after the existing label-length check:

   ```
   orig: if length(label)>160 then raise exception 'Invalid change label'; end if;
   new:  if length(label)>160 then raise exception 'Invalid change label'; end if;
     -- Panda client intake: fixed event label.
     if exists(select 1 from jsonb_array_elements(changes) x where x->>'kind'='client_intake') then label:='Updated intake questionnaire'; end if;
   ```

   This covers the whole batch, so a `clients` + `client_intake` submission cannot carry intake text in its `clients` event either. `label` is a PL/pgSQL parameter and can be assigned; the new test must confirm this on the target Postgres version. The comment doubles as the re-run marker.

2. **Frontend.** Intake saves pass the constant `'Updated intake questionnaire'` (and `'Reopened intake questionnaire'` for the coach). The database overrides both anyway, so the coach's reopen also reads "Updated intake questionnaire". No label is ever built from form values.

3. **Errors.** `validate_client_intake` messages name the field ("Invalid medications details"), never the value. Errors are not stored, but they reach logs and toasts.

4. **Elsewhere.**
   - The coach backup export (`15-services.js:70`, `export:()=>JSON.stringify(state)`) will now contain medical data. Say so in the export UI and in `docs/DEPLOY.md`.
   - In local demo mode the data sits in `localStorage`. It is demo data only.

5. **Test.** As a client:
   - save a draft containing a sentinel string;
   - assert that `select label from panda_events` (as that client and as the coach) never contains it;
   - assert that every label for those saves equals the fixed string, even when the caller passes a custom label.

---

## 7. Risks to existing functionality

| # | Risk | Effect if missed | Mitigation |
|---|---|---|---|
| 1 | Re-creating `panda_save` or `readable()` from 003's source | Silently removes 009 (activity nulls), 010 (water-only guard, nutrition-only activity reads) and 014 (cardio plan reads). | Patch only, with the prerequisite and post-condition checks in §2.1. |
| 2 | A hard-coded kind or ownership list that misses a current kind | `add constraint` fails on existing rows, or future inserts of that kind are blocked. | Preflight against `pg_get_constraintdef` (§2.2, §2.3). |
| 3 | `tests/verify.cjs` asserts exactly 22 migrations | Test suite fails. | Update to 23. |
| 4 | `tests/access-expiry.cjs:52` re-runs `migrations.at(-1)` and calls it 022 | It would re-run 023 instead, under a misleading message, and fail if 023 isn't idempotent. | Make 023 re-runnable (drop-if-exists, markers, `create or replace`); pin the test to 022. |
| 5 | `FRESH-INSTALL.sql` not updated | New installs that use the SQL-editor path have no intake, and the frontend gets refused saves. | Append 023; update counts in the docs. |
| 6 | Frontend deployed before the migration | Intake saves fail: the kind check rejects it, or "Access denied" for clients. Loading is unaffected, because `assemble()` ignores unknown kinds. | Deploy order: migration, then frontend. The reverse (new database, old frontend) is harmless. |
| 7 | `restore()` with a backup whose intakes differ from the current ones (missing, older answers) | The diff deletes or rewrites intakes. Patch C and 025 refuse that, so the whole restore fails; without them, medical data is lost or reverted. | Always carry over `before.client_intake` (§4) **and** keep Patch C and 025. |
| 8 | `flatten()` on a state without `client_intake` | `TypeError` during restore or commit. | `s[type]||[]` plus the default in `PandaRecipes.migrate`. |
| 9 | A combined `clients` + `client_intake` batch | Any problem in the `clients` row (for example a coach-only field changed by mistake) fails the whole submission with "Only your coach can change assignments and access". | The form edits only the six fields on the client row; add a test for this. |
| 10 | Event volume | `panda_save` writes one event per record. Autosaving drafts would flood the audit list that both client and coach see. | Explicit save per step. |
| 11 | Constraint swap locks `panda_records` | `ACCESS EXCLUSIVE` while the new checks scan the table (photos and recipe images make it the largest table). Brief, but it blocks reads. | Run in a quiet window. Optionally add the constraints `NOT VALID`, then `VALIDATE CONSTRAINT`. |
| 12 | Trigger fires on every `panda_records` write | Negligible, because of `WHEN (new.kind='client_intake')`. Other `BEFORE` triggers run in name order and ignore this kind. | – |
| 13 | Revision conflicts | A coach reopening while the client is still on the form gives the client the existing 40001 "Someone updated this record" message. | Expected behaviour; no change. |
| 14 | Existing clients, already `active` | They cannot start an intake until the coach creates or reopens one (§3.1). | Coach action; mention it in the release notes. |
| 15 | Single-coach model | Every coach account can read every intake. This is the same as `client_private` today. | Accepted; note it if multiple coaches are ever supported. |
| 16 | Seeding the retention setting | Migration 023 adds `intake_retention_months` to `settings/brand` and raises its revision. A coach page open during the upgrade gets a refresh prompt on its next settings save. | Intended: without the bump, that page could save the brand record without the new key. |
| 17 | Clients archived before migration 024 | Their real archive date is unknown. | 024 stamps them with the upgrade time, so retention counts from the upgrade: data is kept longer, never deleted early. |
| 18 | Re-running 023 after 025 | 023 re-creates `guard_client_intake()` from its own source, which drops 025's coach patch: the coach could write answers again. | Re-run 025 after any re-run of 023. 025 is idempotent and its post-check confirms the patch. |

---

## 8. Retention

**Setting.** `settings/brand.intake_retention_months`: whole months, 1–120, to keep a client's intake after the client is archived. `null` or missing means no automatic deletion. Migration 023 seeds it to `24` (2 years) once, only if the key is absent, so it never overrides the coach's value. A trigger (`panda_intake_retention_guard`) rejects other values with "Intake retention must be a whole number of months from 1 to 120, or empty for no automatic deletion." `panda_private.intake_retention_months()` returns the value for a future job. Clients can read the brand record; the value is not sensitive.

**Archive date (migration 024).** `clients.archived_at` is an ISO timestamp, present only while `status` is `archived`. The trigger `panda_client_archived_at` (`panda_private.stamp_client_archive()`) works the same way as the intake guard:

- It looks up the stored row itself, because of the upsert double-firing (§2.6).
- It always discards the incoming `archived_at`, whoever sends it: client, coach or a direct write.
- Changing to `archived`: sets `now()`. Still `archived`: keeps the stored date. Any other status: removes the key. Archiving again records a new date.
- Clients cannot send the key at all: `panda_save` refuses client edits outside their personal fields. Migration 024's preflight checks that guard is still the exact one it was written against.
- No function is patched. 024 checks the 009, 010, 014 and 023 markers in `panda_save` and `readable()` before and after, stops with "review migration 024" if 023 is missing, and is safe to re-run.

**Deletion job (not built).** It would delete `client_intake` rows whose client has `archived_at` older than `intake_retention_months`, skipping all when the setting is empty. It must run as the service role and delete directly, because `panda_save` refuses intake deletion (Patch C). Until it exists, intakes are removed only when the client's account is deleted.

---

## 9. Open questions

1. Deletion job: where it runs (scheduled edge function or `pg_cron`) and whether the coach is warned before an intake is deleted.

Resolved: a `health_flag` intake is the coach's first attention item (`20-attention.js`); lifts store a type with reps for working sets (§1.5); `consent.health_data` is kept (§1.10); retention is 24 months after archive, configurable (§8).
