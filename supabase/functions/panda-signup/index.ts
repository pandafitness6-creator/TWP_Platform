// Train With Panda · Website signup Edge Function (SIGNUP-DESIGN.md).
// verify_jwt=false at the gateway: website calls are verified here by HMAC signature, and setup-page
// calls by a single-use setup token. The logic lives in handler.js so the Node test suite runs it too.
import {createHandler} from './handler.js';

const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'PANDA_AUTH_DOMAIN', 'PANDA_ALLOWED_ORIGINS',
  'PANDA_SIGNUP_HMAC_KEYS', 'PANDA_SETUP_TOKEN_KEY', 'PANDA_PORTAL_URL', 'PANDA_SIGNUP_MAX_PER_HOUR'];
const env: Record<string, string | undefined> = Object.fromEntries(names.map(name => [name, Deno.env.get(name)]));

Deno.serve(createHandler({env}));
