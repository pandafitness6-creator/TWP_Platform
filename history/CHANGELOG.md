# Release and change history

This history summarizes local release notes and migration filenames available with the supplied product. It is not an original commit log. No Git repository was present. The latest supplied stand is v0.9.16; no comparison against the live app was possible or performed.

| Version/step | Recorded changes |
| --- | --- |
| Early portal / migrations 001–002 | Supabase accounts, roles/RLS, protected records, validated saves, shipped base content. |
| 0.5.1–0.7.6 / migrations 003–004 | Recipe support and assignment/upload permissions; expanded recipes/articles. Exact intervening commit history unavailable. |
| 0.9.1 / migration 005 | Featured education guides. |
| 0.9.4 | Supplied deploy snapshot; earlier library baseline. Detailed original commit log unavailable. |
| 0.9.5 / migration 006 | Coaching education, food references, fiber, RIR/RPE and supplement/cardio validation. |
| 0.9.6 / migration 007 | Training/nutrition templates, Arabic guides, content editor and uploaded photos, individual assignment. |
| 0.9.7 / migration 008 | Six bilingual supplement templates and mobile client layout. |
| 0.9.8 | Supplied intermediate snapshot; no independent commit-level record. |
| 0.9.9 / migrations 009–010 | Water-only logging and nutrition access safeguards. |
| 0.9.10 / migration 011 | Fiber provenance/corrections, persisted route, Arabic labels and exercise classification. |
| 0.9.11 / migration 012 | Coach UI fixes and assigned-plan guards. |
| 0.9.12 | Calorie/macro calculator; library-update archive also present. |
| Exercise visibility / migration 013 | Exercise visibility controls. |
| 0.9.14 / migrations 014–016 | Cardio HQ, HIIT/warm-up/cool-down imagery, structured prescriptions, assigned-plan protection and swimming. |
| 0.9.15 / migrations 017–019 | Private chat and send correction, cardio templates, additional paired cardio images; supplied Web Build also contains unread-chat badge and meal-photo fixes. |
| 0.9.16 / migration 020 | Tempo, How Much Weight You Should Lift and How Hard You Should Train, each with EN/AR text and six chapters; three article covers. |
| Client access expiry / migration 021 | Optional per-client “access expires on” date (last day of access, UTC; empty = no expiry, so existing clients are unchanged). Enforced by RLS (`panda_private.ready`) and the account Edge Function. Sign-in explains expired, paused and archived accounts with the coach’s contact details; signed-in clients see 7/3/1-day warnings and are signed out with an explanation when access ends. Coach form with 1/3/6/12-month and renewal buttons, expiry shown in the client list and Access dialog, expiring clients listed in the coach’s next steps. |
| Client timezone / migration 022 | Access now ends at 00:00 after the last day in each client’s own timezone (was UTC). Country-first timezone choice for each client (searchable country, city list for multi-zone countries, manual override; never taken from the browser), installation default timezone in Settings (Asia/Colombo), server-side IANA validation, and the same rule in RLS, the status lookup, the account function, the client banner and the coach’s list. Warning banner fixed: it was rendered underneath the dashboard’s photo header and could not be seen; it now also states the exact end, e.g. “Your access ends at the end of 3 November (Dubai time)”. |
| Customer handover 2026-10-02 | Editable latest source reconstructed from public build; original backend connection and shop branding removed; full database and account function assembled; build now copies and hashes article PNGs; independent setup guide and package verification added. No feature redesign or production deployment. |

## Inspect frontend changes with Git

frontend-history.bundle contains three reconstructed frontend snapshots, each under standalone/Train-With-Panda-Portal.html. Commit author is the neutral Product Maintainer identity. Commit timestamps are reconstruction times, not original development dates. The bundle does not include original author metadata, original account configuration or backend history beyond the separately shipped migrations.

From the package root:

```sh
git clone history/frontend-history.bundle frontend-history
cd frontend-history
git log --oneline
git diff v0.9.14 v0.9.15 -- standalone/Train-With-Panda-Portal.html
git diff v0.9.15 v0.9.16 -- standalone/Train-With-Panda-Portal.html
```

The source snapshots carry embedded base64 media, so image changes can create large diffs. Historical snapshots are for review; use the complete latest package for deployment. SOURCE-PROVENANCE.json records input and reconstructed-source hashes.

