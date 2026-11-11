/* Configure the Pages project's production environment variables.
 * IMPORTANT: the Pages API returns secret values redacted. Never merge the
 * redacted objects back — always send explicit values from a trusted source.
 * Usage: node scripts/cf-set-pages-env.mjs [KEY=VALUE ...] */
import fs from 'node:fs';
import crypto from 'node:crypto';

const PROJECT = 'dm-motor-group';
const ACC = 'fc62606d16cf7298c4c9a8a39c1b3412';
const TOKEN_PATH = 'C:/Users/HP/AppData/Roaming/xdg.config/.wrangler/config/default.toml';
const KEY_FILE = new URL('../worker/.ai-internal-key', import.meta.url);
const ENV_FILE = new URL('../.env.local', import.meta.url);

const token = (fs.readFileSync(TOKEN_PATH, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
if (!token) { console.error('No wrangler OAuth token found.'); process.exit(1); }

const local = {};
for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) local[m[1]] = m[2].trim();
}

let internalKey = '';
try { internalKey = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch {}
if (!internalKey) {
  internalKey = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(new URL('../worker', import.meta.url), { recursive: true });
  fs.writeFileSync(KEY_FILE, internalKey);
  console.log('Generated new internal key at worker/.ai-internal-key');
}

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY'];
for (const k of required) if (!local[k]) { console.error(`Missing ${k} in .env.local`); process.exit(1); }

const envVars = {
  SUPABASE_URL: { value: local.SUPABASE_URL, type: 'secret_text' },
  SUPABASE_ANON_KEY: { value: local.SUPABASE_ANON_KEY, type: 'secret_text' },
  SUPABASE_SERVICE_KEY: { value: local.SUPABASE_SERVICE_KEY, type: 'secret_text' },
  SITE_URL: { value: local.SITE_URL || 'https://dmmotorgroup.com', type: 'secret_text' },
  AI_INTERNAL_KEY: { value: internalKey, type: 'secret_text' },
  AI_TICK_URL: { value: 'https://dmmotorgroup.com/api/internal/ai/tick', type: 'plain_text' },
};
for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf('=');
  if (i > 0) envVars[arg.slice(0, i)] = { value: arg.slice(i + 1), type: 'secret_text' };
}

const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const patch = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/pages/projects/${PROJECT}`, {
  method: 'PATCH', headers: H,
  body: JSON.stringify({ deployment_configs: { production: { env_vars: envVars } } }),
});
const pj = await patch.json();
console.log('PATCH', patch.status, pj.success, (pj.errors || []).map((e) => e.message).join('; '));
console.log('Configured keys:', Object.keys(envVars).join(', '));
