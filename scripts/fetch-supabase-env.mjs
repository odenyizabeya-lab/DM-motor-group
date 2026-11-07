/* Fetch Supabase project keys via Management API and write local env files.
 * Files written: .env (for local procedures) and .dev.vars (for wrangler pages dev).
 * Both are git-ignored; never committed. */
import { writeFile } from 'node:fs/promises';

const TOKEN = process.env.SB_MGMT_TOKEN;
const REF = 'gevxgqdevaanmxqzverv';
const H = { Authorization: `Bearer ${TOKEN}` };

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?unencrypted=true`, { headers: H })).json();
const pick = (name) => { for (const k of keys) if (k.name === name) return k.api_key || k.key; return ''; };
const env = {
  SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_ANON_KEY: pick('anon'),
  SUPABASE_SERVICE_KEY: pick('service_role'),
  SITE_URL: 'https://dmmotorgroup.com',
};
if (process.argv[2] === '--verify') {
  for (const k of Object.keys(env)) console.log(k, '->', String(env[k]).length, 'chars');
} else {
  const envTxt = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  await writeFile('.env.local', envTxt);
  await writeFile('.dev.vars', envTxt);
  console.log('written .env.local and .dev.vars; lengths:', Object.values(env).map((v) => String(v).length).join('/'));
}
