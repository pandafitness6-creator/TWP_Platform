import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validatePublicConfig} from './public-config.mjs';
const c={mode:'online',supabaseUrl:process.env.PANDA_PUBLIC_SUPABASE_URL||'',publishableKey:process.env.PANDA_PUBLIC_SUPABASE_KEY||'',authDomain:'accounts.panda.invalid'};
validatePublicConfig(c);
fs.writeFileSync(fileURLToPath(new URL('../deployment-config.json',import.meta.url)),JSON.stringify(c,null,2)+'\n');
console.log('Public connection values configured. Run npm run build.');
