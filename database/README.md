# Database contents

supabase/migrations/ is the authoritative, ordered installation and update history (22 files). FRESH-INSTALL.sql is a convenience concatenation for a NEW Supabase project only; choose it OR the CLI method in docs/DEPLOY.md.

The schema includes panda_accounts, panda_records, panda_events, private helper functions, RLS, validated/atomic save RPCs and private chat support. Content seeds include recipes, exercise catalogue references, education/training articles, food references and plan templates. User identities refer to Supabase Auth. Accounts/private customer records are intentionally absent; the owner creates the coach and clients in the new project.

This is not a dump of the previous live database. Auth settings and Function allowed origins must be set as documented. No existing production customer data or private uploads are supplied.

