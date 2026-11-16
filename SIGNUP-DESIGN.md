# SIGNUP-DESIGN — website-created client accounts

Status: **built** (2026-11-16): `supabase/functions/panda-signup/` (logic in `handler.js`, shared with the tests), migration `202611160026_website_signup.sql`, the setup page in the portal, and `tests/website-signup.cjs`. The sections below are the original proposal; where the build differs, the "As built" list wins. Line references point at the tree on `feature/auto-onboarding` (HEAD `203981a`). The Laravel website's code is not in this repository, so everything about the website side is an assumption, marked as one.

**As built (differences from the proposal)**

- The product mapping is keyed by the website's **slug** (`panda_signup_products.slug`, for example `level-3-12-weeks`). Besides package and days, each row names the default `program_id`, `nutrition_id` and `checkin_day`, because the portal requires them; the six seeded rows use `plan_strength`, `nutrition_balanced` and Sunday.
- **Access starts when the client sets a password**, not at payment. Signup leaves `access_expires_on` empty; `panda_setup_finish` sets `start_date` to that day and calls `public.panda_extend_access(user_id, days)` once. That RPC is repeatable (it extends from the current expiry, or from today once access has passed) so renewals can reuse it. `panda_signups.access_start_due_at` (payment + 14 days) is recorded for a later job that starts unused access; the job is not built.
- A second order for an email that already has a client (or a live signup) is refused with 409 `email_exists`. Usernames are generated (email prefix + 4 digits).
- Setup-token errors use HTTP 410 (`token_invalid`, `token_expired`, `token_used`). Other codes added: `resent`, `setup_complete`, `not_found`, `setup_completed`, `account_inactive`, `setup_incomplete`, `method_not_allowed`, `origin_not_allowed`, `not_configured`. Signups are capped at `PANDA_SIGNUP_MAX_PER_HOUR` (default 60).
- Programme gating before the intake (open question 1) is **not** built.

**Goal.** After a successful payment, the website (Laravel on cPanel) asks the portal (Supabase) to create a client account and gets back a one-time link the client uses to set their own password. No coach is signed in when this call is made.

**Decisions proposed in this document**

| # | Decision |
|---|---|
| S1 | A **new Edge Function `panda-signup`**. Do not add the action to `panda-accounts`, because every path in that function assumes a signed-in Supabase user (§1). |
| S2 | The website authenticates with an **HMAC-signed request** using a shared key that is never sent over the wire. Each request carries a timestamp and a nonce (§2). |
| S3 | **Migration 026 lets `age`, `height`, `weight` and `goal_weight` be `null` unless `status` is `active`.** No placeholder values. The intake supplies the first three, and the coach sets `goal_weight` before activating the client (§3). |
| S4 | A **custom setup token** with a 48-hour expiry, stored only as a hash and consumed by an explicit POST from a portal page. Supabase's built-in links don't fit (§4). |
| S5 | **The website's order reference is the idempotency key.** It is the primary key of a new service-role-only table, `public.panda_signups` (§5). |
| S6 | Website SKUs map to portal packages through a **portal-side table, `public.panda_signup_products`**. An unknown SKU is refused, never given a default package (§6). |
| S7 | Every response carries a machine-readable `code` and a `retryable` flag. Retryable failures use 409/429/5xx. Permanent failures use 4xx (§7). |
| S8 | **The website sends the email** containing the link. The portal deliberately has no email delivery (`index.ts:1`, `docs/DEPLOY.md:31`) (§4.4). |

---

## 1. Existing function: `supabase/functions/panda-accounts/index.ts`

### 1.1 Environment

| Variable | Line | Use |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | 3–5 | Built in. The service key is the default credential for `request()` (`:12`). |
| `PANDA_AUTH_DOMAIN` | 6 | Defaults to `accounts.panda.invalid`. Auth "emails" are `username@domain`. **These are not real addresses.** |
| `PANDA_ALLOWED_ORIGINS` | 7 | A comma-separated list, trimmed, with empty entries dropped. |

`supabase/config.toml` sets `verify_jwt = false`, so the gateway does no checking. The function verifies every caller itself (`index.ts:2`).

### 1.2 Request pipeline (applies to every action)

1. **Origin check** (`:19–26`), described in §1.5.
2. `OPTIONS` returns 204. Any method other than `POST` returns 405 (`:27–28`).
3. **Caller authentication** (`:30–34`). The function requires `Authorization: Bearer <jwt>` (otherwise 401 "Sign in first."). It does not decode the token and trust it: it calls `GET /auth/v1/user` with the caller's token and the anon key, so Supabase Auth verifies the signature and expiry.
4. **Account gate** (`:35–43`). It loads `panda_accounts` for `caller.id` using the service key. If the row is missing or `active` is false, it returns 403. If `access_expires_on` is set, it calls `rpc/panda_access_status` **as the caller**, so expiry uses the same timezone rule as RLS (migration 022), and returns 403 when the state is `expired`.
5. A body larger than 40,000 characters returns 413 (`:44–46`).
6. Action dispatch.
7. **Every thrown error becomes HTTP 400** with the message text (`:94–97`). This includes Auth or PostgREST being unavailable, which `request()` turns into "The account service is unavailable." or "Account operation failed." (`:14–15`). A caller cannot tell a permanent failure from a transient one.

### 1.3 Actions

| Action | Who | Requirements | What it does |
|---|---|---|---|
| `change_password` (`:47–58`) | Any active, unexpired account. This is the **only** action allowed while `must_change_password` is true. | `password` of 12–128 characters (`passwordCheck`, `:9–11`). `current_password` must be a string. | Re-authenticates with `grant_type=password` using the **current** password. A stale reset JWT is not enough. Then it `PUT /auth/v1/user` with the new password, sets `must_change_password=false`, calls `logout?scope=others`, and returns `{ok, session}`. |
| `create_client` (`:61–83`) | Coach only (gate below) | Described in §1.4 | Creates the Auth user and the portal records. |
| `reset_password` (`:84–92`) | Coach only | `password` of 12–128 characters. `user_id` must be an existing account with `role='client'`. | **First** sets `must_change_password=true` and `session_cutoff=now()`, which locks data access for existing tokens. Then it sets the new password through the admin API. |
| anything else | – | – | 400 "Unknown account action." |

**Coach gate** (`:59–60`). Before `create_client` or `reset_password`, the caller must have `role='coach'` and `must_change_password=false`, and the token's `iat` must be at or after `session_cutoff`. The `iat` comes from decoding the JWT locally, which is safe only because step 3 has already verified it. The `ready()`/`coach()` SQL gates (`202609120001_portal.sql:44–49`, later `202611020022_client_timezone.sql:42–44`) apply the same rules inside the database.

### 1.4 How `create_client` works today

Input: `{action:'create_client', username, password, profile}`. It is sent from `createClient()` in `src/js/16-cloud.js:207`, from the coach's "Create client & access" modal (`src/js/26-portal.js:307`).

1. **Username**: trimmed, lowercased, and must match `^[a-z0-9][a-z0-9._-]{2,31}$` (`:62–63`).
2. **Password**: 12–128 characters. The coach chooses it (the modal pre-fills `generatePassword()`) and hands it to the client in person ("No email is sent").
3. **Profile pre-checks in the function** (`:65–67`): `name` is a non-blank string of at most 80 characters, and `age`, `height`, `weight` and `goal_weight` are finite numbers within 16–100, 100–250, 20–400 and 20–400. `goal` and `email` are **not** checked here.
4. **Username uniqueness**: it reads `panda_accounts` first (`:68–69`). The `unique` constraint on `panda_accounts.username` is the real guard if two requests race.
5. **Auth user**: `POST /auth/v1/admin/users` with `{email: username@PANDA_AUTH_DOMAIN, password, email_confirm:true}` (`:70`).
6. **Profile assembly** (`:74–75`): the coach's object is spread first, then `id=uid`, **`status:'onboarding'` (forced)**, `favorites:[]`, `read_articles:[]` and `onboarding:{profile:false,guidelines:false,plans:false}` override it. `role`, `password` and `user_id` are deleted. Every other key the coach sent is kept, because the coach is trusted.
7. **`rpc/panda_register_client`** (service-role only, `202609120001_portal.sql:222–237`). In one transaction it:
   - runs `validate_profile(profile)` (§3.1);
   - checks `profile.id = uid`;
   - checks that the `packages`, `programs` and `nutrition_plans` rows named by `package_id`, `program_id` and `nutrition_id` exist;
   - inserts `panda_accounts(role='client', active=true, must_change_password=true)`;
   - inserts `clients` (without `coach_notes` and `supplements`), `supplements` and `client_private`.

   The insert also fires these triggers:
   - `panda_client_assignment_guard` (`202609150012_assignment_guard.sql`): `program_id` and `nutrition_id` must be **published**, and `checkin_day` must be a weekday.
   - `panda_client_access_sync` (022): checks the format of `access_expires_on`, `timezone` and `country`, and copies them onto `panda_accounts`.
   - `panda_client_archived_at` (024).
8. **Compensation** (`:76–81`): if the RPC fails, the function deletes the Auth user. If that delete also fails, it reports a possible orphan login. An orphan has no `panda_accounts` row, so it can authenticate but `ready()` is false and the function returns 403 at `:37`.
9. Returns `{ok:true, user_id, username}`.

No `panda_events` row is written. `actor_id` is `NOT NULL` and is not set on this path.

### 1.5 How `PANDA_ALLOWED_ORIGINS` is enforced

```ts
const allowed = !origin || origins.includes(origin);   // :20
if (allowed && origin) headers['Access-Control-Allow-Origin'] = origin;  // :22
if (!allowed) return reply({error:'This portal address is not enabled.'},403);  // :26, before OPTIONS handling
```

- It is an exact string match on the `Origin` header, with no wildcard. `docs/DEPLOY.md:56` says never to use `*`.
- **A request without an `Origin` header is always allowed.** Server-to-server callers (curl, PHP, Laravel's HTTP client) don't send one. The allowlist is therefore browser CSRF and CORS hygiene, **not authentication**, and it would give the new website endpoint no protection.
- If the variable is empty, every browser request is refused with 403, and server requests still pass.
- A disallowed preflight gets 403 with no `Access-Control-Allow-Origin` header, so the browser blocks the call.

**Consequence for the new endpoint:** do not add the website's domain to `PANDA_ALLOWED_ORIGINS`. Its call is server-side, so the browser allowlist is irrelevant to it, and authentication has to come from §2.

---

## 2. Authentication

### 2.1 Options

| | A. Static secret header (`X-Panda-Signup-Key: <secret>`) | **B. HMAC-signed request (recommended)** | C. Service account (a Supabase Auth user with a new `role='website'`) | D. Service-role key on the website |
|---|---|---|---|---|
| Secret on the wire | Yes, in every request | No. Only a signature over this exact request is sent | Password at sign-in, then a 1-hour JWT plus a refresh token | Yes. Full database bypass |
| A captured request can be replayed | Indefinitely, with any body | Only within the timestamp window, only once (nonce), and only with the same body | Until the JWT expires (up to 1 hour), with any body | Forever |
| Leak impact | An attacker can create unlimited accounts | Same as A if the key leaks, but logs and proxies never contain the key | An attacker can create accounts. It also gives a real Supabase JWT that can be pointed at PostgREST, so RLS must give it nothing | **Total.** Read and write all medical data |
| Revocation | Rotate the secret on both sides | Rotate the key. A key id allows overlap | `active=false` or `session_cutoff`, with no redeploy | Rotate the project key, which breaks every server |
| Audit | None built in | Key id and nonce logged | Can be the `actor_id` in `panda_events` | None |
| Moving parts on cPanel | One header | About 15 lines of PHP | Password grant, token cache, refresh handling, clock handling | – |
| Schema impact | None | A small nonce table | `role` check `('coach','client')` and `ready()`/`coach()` need changes; a new role means auditing every RLS function | None |

**Recommendation: B.** It is as simple to operate as A, and it closes the two real weaknesses of A: the secret isn't exposed in logs, proxies or error reports, and captured requests can't be replayed. C adds a long-lived credential that is a real database principal, which increases risk on a shared-hosting box without adding security. D is never acceptable.

### 2.2 Signature scheme

Headers on `POST https://<project>.supabase.co/functions/v1/panda-signup`:

```
Content-Type: application/json
X-Panda-Key-Id: k1
X-Panda-Timestamp: 1763290000          (Unix seconds)
X-Panda-Nonce: 3f1c2c1e-…              (UUID v4, new for every attempt, retries included)
X-Panda-Signature: v1=<hex HMAC-SHA256(key, canonical)>
```

```
canonical = "v1\n" + timestamp + "\n" + nonce + "\nPOST\n/panda-signup\n" + hex(SHA-256(raw body bytes))
```

Verification in `panda-signup`, before any database work:

1. Look up the key by `X-Panda-Key-Id`. Accept the **current and the previous** key so they can be rotated without downtime.
2. Check `|now − timestamp| ≤ 300 s`.
3. Compute the expected signature over the **raw** body, before parsing JSON, and compare it in constant time (`crypto.subtle.verify('HMAC', …)`).
4. Insert the nonce into `public.panda_signup_nonces(nonce primary key, seen_at)`. A conflict means a replay, and the response is 409 `nonce_reused`. Delete rows older than 15 minutes as part of the same call.
5. Only then parse the body and act.

`[functions.panda-signup] verify_jwt = false` goes in `supabase/config.toml`, as for `panda-accounts`. Optional: reject any request that carries an `Origin` header, because the website never sends one.

### 2.3 Where the secrets live

| Secret | Portal side | Website side |
|---|---|---|
| `PANDA_SIGNUP_HMAC_KEYS` (for example `k1:<base64 32 bytes>,k0:<old>`) | `supabase secrets set … --project-ref …`, read with `Deno.env.get`. Never in `config.toml`, the repo or `.env.local`. **Do not name it `PANDA_PUBLIC_*`**: the build copies public values into the frontend (`.env.example:1`, `scripts/public-config.mjs`). | Laravel `.env` (`PANDA_SIGNUP_KEY_ID`, `PANDA_SIGNUP_KEY`), read only in `config/services.php`. The `.env` file must sit **outside the web root** (the cPanel document root must be Laravel's `/public`), with mode 600/640 and not in git. After `config:cache` the value also sits in `bootstrap/cache/config.php`, which needs the same protection. Never pass it to Blade or JavaScript, and never log request headers. |
| `PANDA_SETUP_TOKEN_KEY` (§4.3) | Supabase secret only | **Not shared** with the website |
| `PANDA_PORTAL_URL` (base for setup links) | Supabase secret or variable | – |
| Service-role key | Edge Function built-in only (as now) | **Never** |

Rotation: add `k2` to the portal's list, switch the website to `k2`, then remove `k1`.

### 2.4 Replay prevention, in layers

1. TLS, which is required.
2. The signature covers the body, so a captured signature can't be reused with a changed body.
3. A 5-minute timestamp window. The cPanel clock must be NTP-synced. Log the skew whenever a request is rejected.
4. A single-use nonce.
5. **Idempotency on `order_ref`** (§5). Even a perfect replay of a valid order cannot create a second account.

The nonce matters because the success response contains the setup link (§4.4). Without it, an exact replay within 5 minutes would return the link a second time.

---

## 3. The required fields

### 3.1 What is actually required today

The requested list ("name, email, age, height, weight and goal") does not match the code. The current `validate_profile` is the one in `202609140007_studio_library.sql:82–101`, which replaced 001's version wholesale and has had no later patches:

| Field | Rule | Required at payment? |
|---|---|---|
| `name` | string ≤ 80, non-blank after trim | yes. The website has it. |
| `email` | **any string ≤ 160. Empty is valid, and the format is not checked** | no. The coach modal labels it "Contact email (optional)". |
| `age` | number 16–100, whole | **blocks** |
| `height` | number 100–250 | **blocks** |
| `weight` | number 20–400 | **blocks** |
| `goal_weight` | number 20–400. **Not in the requested list, but required** | **blocks** |
| `goal` | **any string ≤ 6000. Empty is valid** (only the UI marks it `required`) | no |
| `location`, `occupation`, `activity_level`, `preferences`, `allergies`, `limitations`, `sex` | each must be **present** and a string ≤ 6000 (empty is valid) | no. Send `""`, and `sex: "Not specified"` |
| `favorites`, `read_articles` | arrays ≤ 1000 of strings ≤ 100. Favourites must exist in `catalogue_ids` or `exercise_edits` | no. Send `[]` |
| `onboarding` | an object with booleans `profile`, `guidelines`, `plans` | no. Send all `false` |

Rules outside `validate_profile` that a server-created profile must also meet:

- `panda_register_client`: `id = uid`, and the package, programme and nutrition plan rows exist.
- `guard_client_assignment` (012): the programme and nutrition plan are **published**, and `checkin_day` is a weekday.
- `sync_client_access` (022): formats of `access_expires_on`, `timezone` and `country`.
- `panda_save` on every later save (`202609130003_recipes.sql:116–120`): `status` is one of the four values, and there are no `coach_notes` or `supplements` keys.
- **The frontend's `validate()` runs over every client in the coach's state on every commit** (`src/js/15-services.js:20`, `:43`, called from `commit` at `:60`). It also requires valid `start_date` and `end_date` with `end ≥ start`, numeric `training_days`, `steps_target`, `sleep_target`, `cardio_minutes` and `cardio_days`, text `checkin_day` and `coach_notes`, and `supplements`, `favorites` and `read_articles` arrays. **If one server-created client fails these checks, the coach cannot save anything at all.**

So the server must build the full profile shape the portal uses (`blankProfile()`, `16-cloud.js:132`), not only the fields `validate_profile` checks. Only **four numbers** are genuinely missing at payment: `age`, `height`, `weight` and `goal_weight`.

### 3.2 Options

| | A. Placeholders (for example 30 / 170 / 70 / 70, as `blankProfile()` uses) | **B. Migration: the four numbers may be `null` unless `status='active'`** |
|---|---|---|
| Schema change | None | `validate_profile` (one function) plus one check in `guard_client_intake` |
| Frontend change | Small: hide the placeholders | Null-safe display and validation: `15-services.js:20`, `26-portal.js:247` (shows "null cm"), `:53`, `:219` (check-in weight default), `25-calories.js`, coach modal |
| Data truth | **Fake values look exactly like real ones.** They feed the calorie calculator, the goal-weight chart line, the check-in weight default (`26-portal.js:219`) and printed plans. | Unknown is stored as unknown |
| Intake interaction | The intake form pre-fills from `clients` (`25-intake.js:152`), so a client can submit 30 / 170 / 70 unchanged. The server then snapshots them into `submitted_profile` as **what the client declared** (INTAKE-DESIGN §5). That corrupts the record this design exists to protect. | The fields are blank, the form's `required` attributes force real values, and the snapshot is truthful |
| Can the coach tell? | Only with an extra marker flag, which is a second source of truth | `null` is the marker |
| Risk | Silent and long-lived | Loud: a missed null check shows "—" or fails visibly, and tests can find it |

**Recommendation: B.** The intake already collects age, height and weight from the client during `onboarding`, which is exactly the state these accounts start in. Placeholders would put invented numbers into the health record.

Migration 026 would:

1. **`validate_profile`**: each of `age`, `height`, `weight` and `goal_weight` may be JSON `null` when `b->>'status' <> 'active'`. Otherwise the current rules apply. Paused and archived are included so the coach can archive an abandoned signup that never filled them in. Because `panda_save` passes the whole body, **activating a client with any null is refused** in the same place as today ("Invalid client measurements"). Use the project's patch pattern: preflight the installed source against 007's text, replace, then post-check. Don't copy the function from `FRESH-INSTALL.sql`.
2. **`guard_client_intake`**: on a change to `submitted`, require non-null `age`, `height` and `weight` on the profile, with the message "Add your age, height and weight before submitting." `goal_weight` is not an intake question, and the coach sets it before activating.
3. The usual housekeeping: `MIGRATION-ORDER.txt`, `FRESH-INSTALL.sql`, `tests/verify.cjs:16` (`25` becomes `26`), `database/README.md` and the `docs/DEPLOY.md` counts.

The Edge Function's own range check (`index.ts:67`) is not affected, because `panda-signup` is a separate function.

**Deploy order:** migration 026, then the null-tolerant frontend, then enable `panda-signup`. No null rows exist until the endpoint is live.

---

## 4. Password setup link

### 4.1 How `must_change_password` works today

- The column defaults to `true` (`202609120001_portal.sql:13`), and `panda_register_client` sets it explicitly (`:230`).
- **RLS gate:** `ready()` and `coach()` require `not must_change_password`. Until it is cleared, the account can read and write nothing.
- **Frontend:** after sign-in, `16-cloud.js:168` loads the account. If the flag is set, it clears cloud state and signals `password-required`, and the UI shows the change-password form.
- **Clearing it:** only `change_password` (§1.3) clears it, and that action **requires the current password**. A client created by the website has a random password nobody knows, so **the existing path cannot be used**. A new consumption path is needed.
- **Setting it again:** the coach's `reset_password` sets it together with `session_cutoff=now()`.

### 4.2 Supabase Auth built-ins considered

| Built-in | Why it doesn't fit |
|---|---|
| `inviteUserByEmail` / `POST /auth/v1/admin/invite` | Supabase sends the email to the **Auth** address, which here is `username@accounts.panda.invalid`. Making it work means switching the whole login model to real email identities (frontend `username()`, the bootstrap script, `PANDA_AUTH_DOMAIN`). It also needs custom SMTP, because the default sender is heavily rate-limited. |
| `POST /auth/v1/admin/generate_link` (`type: recovery` or `magiclink`) | It returns a link without sending anything, which is closest. But: (1) the expiry is the project-wide email OTP setting, **which Supabase caps at 24 hours**, so 48 hours is impossible (check this in the dashboard; the cap applied when this was written); (2) generating a new link **overwrites** the previous token, so an idempotent retry would kill the link already emailed; (3) clicking it produces a signed-in session in the URL fragment, which the portal doesn't handle, and that session still can't clear the flag without a new "change password without the current one" action; (4) it is shared with coach-facing recovery settings. |
| Supabase's own "Reset password" email | Same email-address problem as invite. |

**Conclusion:** build a small custom token. It is about 60 lines of SQL plus one function action, and it gives an exact 48-hour expiry, idempotent re-issue and an explicit consume step.

### 4.3 Design

**Storage** (migration 026): `public.panda_setup_tokens`, with RLS enabled, **no policies**, all access revoked from `anon` and `authenticated`, and access only through `security definer` RPCs granted to `service_role`, the same model as `panda_register_client`.

| Column | Notes |
|---|---|
| `id uuid pk` | random |
| `user_id uuid not null references panda_accounts on delete cascade` | |
| `token_hash bytea unique not null` | SHA-256 of the token. **The raw token is never stored.** |
| `purpose text` | `website_signup` \| `resend` \| (later) `coach_invite` |
| `order_ref text null` | links to `panda_signups` |
| `created_at`, `expires_at timestamptz not null` | `expires_at = created_at + interval '48 hours'`, set by the DB clock |
| `consumed_at`, `revoked_at timestamptz null` | |
| partial unique index on `(user_id) where consumed_at is null and revoked_at is null` | at most one live token per user |

**Token value.** `token = base64url(HMAC-SHA256(PANDA_SETUP_TOKEN_KEY, id))`, which is 256 bits. Because it is derived from the row id and a key held only in the Edge Function:

- a database leak alone does not reveal any working link;
- **a retry of the same order can re-derive and return the same link** without storing it, so a duplicate webhook never invalidates an email already sent (§5).

**Link.** `https://<portal>/#setup=<token>`. Put the token in the **fragment**, so it never reaches Cloudflare logs or a `Referer` header. Add `<meta name="referrer" content="no-referrer">` to the setup view.

**Expiry.** It is checked in SQL with `now() < expires_at`, never by the Edge Function's clock, and is **not** extended by retries. After 48 hours the website (or later the coach) calls `resend_setup`, which revokes the live token and issues a new one.

**Consumption: never on GET.** Email security scanners pre-fetch links. Opening the page only shows a form ("Set your password", with the username displayed). Only the submit consumes the token:

`POST /functions/v1/panda-signup {action:'complete_setup', token, password}`. This is a browser call, so this action **does** require `Origin ∈ PANDA_ALLOWED_ORIGINS`. Signed website actions reject browser origins.

1. Check the password with `passwordCheck` (12–128).
2. `rpc/panda_setup_consume(hash)` runs as one statement: `update … set consumed_at=now() where token_hash=$1 and consumed_at is null and revoked_at is null and expires_at>now() returning user_id`. It also checks that the account is `role='client'`, `active`, and still has `must_change_password=true`. If no row comes back, it returns `token_invalid`, `token_expired` or `token_used`. Telling these apart is safe, because tokens can't be guessed.
3. `PUT /auth/v1/admin/users/{id}` with the password. **If this fails, set `consumed_at` back to null** and return 503 retryable, so the link isn't burned by an outage.
4. `PATCH panda_accounts set must_change_password=false, session_cutoff=now()`. If this step fails, the client has a password they know and the flag is still set. The existing first-login `change_password` screen then handles it, so the failure is recoverable.
5. Sign in with the password grant and return `{ok, username, session}`, the same response shape as `change_password` (`index.ts:57`). The client lands signed in, and the intake opens because the client's status is `onboarding` (INTAKE-DESIGN §4).

**Fallback for support.** The coach's existing `reset_password`, a temporary password handed over in person, still works for these accounts with no change.

**Housekeeping.** Delete consumed, revoked or expired tokens older than 30 days on each `create`.

### 4.4 Who sends the email

The response to `create_client` includes `setup_url` and `setup_expires_at`, and the **website sends the email** from its own mailer, along with the receipt. The portal has deliberately never sent email (`index.ts:1`), and the website already has the customer relationship, the templates and deliverability set up.

Alternative: `panda-signup` sends the email itself through a provider API. That adds a provider, a secret, templates and bounce handling to the portal. It does keep the link out of the website's logs and queue. If the website's job queue or logs might persist response bodies, choose this alternative.

---

## 5. Idempotency

### 5.1 Where the order reference lives

Store it in **`public.panda_signups`** (migration 026), using the same locked-down model: RLS enabled, no policies, service-role RPCs only.

| Column | Notes |
|---|---|
| `order_ref text primary key` | the website's order ID, `^[A-Za-z0-9._:-]{1,100}$`. **This is the idempotency key.** |
| `email_norm text not null` | lowercased and trimmed |
| `sku text not null`, `package_id text` | resolved through §6 |
| `username text unique`, `user_id uuid unique null` | recorded **before** and **after** the Auth user is created |
| `state text` | `claimed` → `created` → `completed`, or `failed` |
| `request_hash bytea` | SHA-256 of the normalised `{email, name, sku}`, to detect the same order sent with different data |
| `attempts int`, `last_error_code text`, `created_at`, `updated_at` | no PII in the error fields |

Alternatives that were rejected:

- **A key on the `clients` record.** The client can read it through RLS, any coach save could drop it, and it can't hold a clean `unique` constraint.
- **Website-side only.** That doesn't survive a lost response, where the portal succeeded but the website saw a timeout.

For coach visibility, a later UI can show "Created from website order X" by reading this table through a coach-only RPC.

### 5.2 Flow (one `create_client` call)

```
1. verify signature, timestamp, nonce                          (§2)
2. rpc panda_signup_claim(order_ref, email_norm, sku, request_hash)
   insert … on conflict (order_ref) do nothing → existing row?
     • state created/completed, same request_hash → 200 already_created
         (re-derive setup_url if the token is live; setup_completed:true if consumed;
          setup_expired:true if expired → website calls resend_setup)
     • same order_ref, different request_hash        → 409 order_conflict (not retryable)
     • state claimed, updated < 2 min ago            → 409 in_progress, Retry-After: 30
     • state claimed/failed and stale                → resume from the recorded step
   also: a client with this email already exists      → 409 email_exists (§8)
   also: SKU mapping valid                            → else 422 / 503 (§6)
3. choose username; record it on the claim row
4. POST /auth/v1/admin/users  {email: username@domain, password: <random 32 bytes, discarded>, email_confirm:true}
   record user_id on the claim row
5. rpc panda_signup_register(order_ref, uid, username, profile, token_id, token_hash)
   ONE transaction: perform panda_register_client(...); insert setup token; state='created'
   on failure → DELETE auth user (compensation, as index.ts:76–81); state='failed'
6. 201 created {username, package_id, setup_url, setup_expires_at}
```

Two webhooks arriving at the same moment race on the `order_ref` primary key, and exactly one claim wins. If the Edge Function dies between steps 4 and 5, the claim row already holds `username` and `user_id`, so a retry can delete or resume the orphaned Auth user instead of leaving it behind.

**On the website (assumed):** call the portal from a **queued job**, not inside the payment provider's webhook handler. Deduplicate payment-provider events on the website too. Send the setup email only on `created`, or on `already_created` when no email has been recorded as sent for that order.

---

## 6. Package mapping

### 6.1 What the portal has

Seeded packages (`202609120002_content.sql:3–5`, all `weeks: 12`, `price: null`):

| `package_id` | Name | Features |
|---|---|---|
| `essential` | Training Library | training, library, roadmap, education |
| `coaching` | Complete Coaching | all nine |
| `nutrition_only` | Nutrition Coaching | library, nutrition, supplements, progress, checkins, education, roadmap |

The coach can add or archive packages, and archived ones are hidden in the modal (`26-portal.js:307`). A client also **needs** a published `program_id`, a published `nutrition_id` and a `checkin_day`, not only a package. The website catalogue isn't in this repository, so the SKUs below are illustrative.

### 6.2 Mapping

`public.panda_signup_products`, locked down the same way:

| Column | Example |
|---|---|
| `sku text pk` (the website's identifier) | `web-complete-12w` |
| `package_id` | `coaching` |
| `program_id`, `nutrition_id`, `cardio_id null` | defaults to assign until the coach personalises |
| `checkin_day` | `Sunday` |
| `access_days int` | `84` → `access_expires_on = today(client tz) + access_days − 1`; `start_date`/`end_date` from the same |
| `active bool`, `updated_at` | |

The mapping lives on the portal side, so the coach can change default plans without a website deploy, and the website sends only its own SKU. A mapping stored as an environment variable would need a secrets change and redeploy for every change. Website-side IDs would duplicate the portal's IDs in two codebases.

`panda_signup_register` checks **at signup time** that:

- the SKU row exists and `active` is true;
- the package exists and is not `archived`;
- the plans exist and are `published`.

Optionally, extend `guard_assigned_plan_publication` (015) so a plan named in an active mapping can't be unpublished, as it already blocks unpublishing a plan assigned to a client.

### 6.3 Missing or wrong mapping

| Case | Response | Website action |
|---|---|---|
| SKU not in the table, or `active=false` | 422 `unknown_package`, `retryable:false` | Alert; hold the order for manual handling. **Never fall back to a default package**: the customer paid for something specific. After the mapping is added, re-sending the same `order_ref` is safe. |
| Mapping points at a missing or archived package, or a missing or unpublished plan | 503 `portal_configuration`, `retryable:true`, `Retry-After: 3600` | Retry with long backoff and alert the coach. It succeeds once fixed. |
| Mapping is valid but wrong (SKU → wrong package) | Undetectable by the portal | The response echoes `package_id`, and the website logs it and compares it with what it expected. Add a test per SKU. |

---

## 7. Failure handling

Every response body has the shape `{ok, code, retryable, message, request_id}`. `message` is for logs and never contains PII. The website branches on `code` and `retryable`, never on `message`.

| HTTP | `code` | Retry? | Meaning |
|---|---|---|---|
| 201 | `created` | – | Account created; `setup_url` returned |
| 200 | `already_created` | – | **Success.** Idempotent replay (§5.2) |
| 400 | `invalid_request` | no | Bad JSON, a missing or invalid field (for example a name over 80 characters or a bad email). Fix the data. |
| 401 | `bad_signature`, `stale_timestamp`, `unknown_key` | no (alert) | Wrong key or clock skew. Fix the configuration, then re-send with a **new** nonce and timestamp. |
| 409 | `nonce_reused` | yes, with a new nonce | The same nonce was reused. Usually a website bug. |
| 409 | `in_progress` | yes, honour `Retry-After` | Another request for this order is mid-flight |
| 409 | `order_conflict` | no (alert) | Same `order_ref` sent with different email, name or SKU |
| 409 | `email_exists` | no (manual) | A client with this email already exists (§8, renewals) |
| 413 | `too_large` | no | Body over the limit |
| 422 | `unknown_package` | no (manual) | §6.3 |
| 429 | `rate_limited` | yes, honour `Retry-After` | Volume guard (§8) |
| 503 | `portal_configuration` | yes, long backoff, alert | §6.3 |
| 503 | `upstream_unavailable` | yes, backoff | Auth or PostgREST returned 5xx or timed out. The compensation ran; state is `failed` and resumable. |
| 500 | `internal` | yes, limited, alert | Unexpected. Safe to retry because of idempotency. |

Website retry schedule, suggested: 1 min, 5 min, 30 min, 2 h, 6 h, then every 6 h up to 48 h, then a manual queue. Use a 30 s HTTP timeout. **Treat a timeout as retryable**: the portal may have succeeded, and the retry returns `already_created`. New Edge Function code must map errors to these codes explicitly, rather than reuse the catch-all 400 from `panda-accounts` (`index.ts:94–97`).

`complete_setup` (browser) uses the same envelope: `token_invalid`, `token_expired`, `token_used` and `weak_password` are not retryable, and `upstream_unavailable` (503) is retryable, with the token restored (§4.3).

---

## 8. Risks

| # | Risk | Effect | Mitigation |
|---|---|---|---|
| 1 | **Website key leaks** (shared cPanel hosting, a committed `.env`, a debug page) | Anyone can mint accounts with paid access | HMAC with rotation (§2). Alert when signups per hour exceed a threshold, with a 429 guard. Every account is traceable to an `order_ref`. The coach can archive any account. The website can't do more than create clients in mapped packages. |
| 2 | **Clients get content before the coach reviews them.** `onboarding` means `active=true`, so after setup the client sees the default programme straight away, before the intake's `health_flag` has been reviewed. | A client who declares heart disease or pregnancy can follow a default training plan | Map SKUs to a deliberately generic "starter" plan. Or decide (business) to gate programme reads until the intake is submitted. `health_flag` is already the coach's first attention item. **This needs a decision.** |
| 3 | A server-built profile fails the frontend's `validate()` | **The coach cannot save anything** (`15-services.js:20`, `:43`) | Build from the `blankProfile()` shape. Add a test that loads a website-created client into `PandaServices.validate`. |
| 4 | Null measurements (option B) reach code that expects numbers | "null cm" on screen, NaN in calorie targets | Ship the null-safe frontend before enabling the endpoint. Grep for `.age`, `.height`, `.weight` and `goal_weight` (§3.2). |
| 5 | **Same email, second order** (renewal, upgrade or gift) | A duplicate account, or a refused paid order | v1: 409 `email_exists` and manual handling. Later: a `renew` action that extends `access_expires_on` and changes `package_id`. Email isn't unique anywhere today, so the check is a lookup on `clients.data->>'email'` and `panda_signups.email_norm`. |
| 6 | The link is a bearer credential: forwarded email, a shared inbox, or a scanner fetching it | Account takeover before the client sets a password | 48-hour expiry, single use, consumed only by POST (scanners can't consume it), token in the fragment, and the client sees their username before setting the password. Accepted residual risk, the same as any emailed setup link. |
| 7 | The client never sets a password | An `onboarding` account with no usable login, and the access clock running | `resend_setup` from the website, and the coach's `reset_password` as fallback. Decide whether `access_expires_on` counts from payment (proposed) or from setup. |
| 8 | Orphaned Auth users after a partial failure | A login with no account row (harmless, since `ready()` is false), clutter | The claim row records `user_id` before step 5, compensation runs, and a retry resumes or cleans up. Add a periodic check of Auth users with no `panda_accounts` row. |
| 9 | Mapping drift: the coach archives a package or unpublishes a mapped plan | New signups fail | 503 `portal_configuration` with an alert, plus the optional guard in §6.2. |
| 10 | Clock skew on cPanel | Every request 401 `stale_timestamp` | NTP; the skew is reported in the error; a ±300 s window. |
| 11 | Login uses a **username**, but the customer knows their **email** | "I can't log in" | Show the username prominently on the setup page, in the email and in the response. Later: let the client choose a username at setup (this needs a rename of the Auth email and `panda_accounts.username`). Don't add an email-to-username lookup endpoint: it enables account enumeration. |
| 12 | Username generated from the email's local part | Mild leak of the email to anyone who sees the username (coach only today) | Use a sanitised prefix of at most 20 characters plus 4 random digits, retried on conflict, or a fully random username. |
| 13 | Migration 026 patches `validate_profile` and `guard_client_intake` | Silently dropping 025's coach patch, as in INTAKE-DESIGN risk 18 | Patch, don't replace. Preflight against 007's and 025's markers, and post-check. Update `tests/verify.cjs:16` and `FRESH-INSTALL.sql`. |
| 14 | No `panda_events` audit for server-created accounts (`actor_id` is `NOT NULL`) | The coach's activity list doesn't show signups | `panda_signups` is the audit trail. Optionally add an `actor` for system events later. |
| 15 | The portal trusts the website's claim that payment succeeded | Website bugs grant access | Send `amount`, `currency` and `paid_at` and store them on `panda_signups` for reconciliation. The portal doesn't verify payments. |
| 16 | Setup link or response bodies persisted in the website's queue or logs | A link usable by anyone with log access for 48 hours | Don't log response bodies, or choose the portal-sends-email alternative (§4.4). |

---

## 9. Open questions

1. Should a website-created client see their default programme before the coach reviews the intake (risk 2)?
2. Renewals and repeat purchases by the same email (risk 5): refuse, or extend?
3. Does the access period start at payment or when the password is set (risk 7)?
4. Who sends the email: the website (recommended) or the portal (§4.4)?
5. Should the client choose their username at setup (risk 11)?
6. What are the website's actual SKUs and durations? They are needed to seed `panda_signup_products`.
