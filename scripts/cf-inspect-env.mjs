import fs from 'node:fs';
const t = fs.readFileSync('C:/Users/HP/AppData/Roaming/xdg.config/.wrangler/config/default.toml', 'utf8');
const tok = (t.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
const ACC = 'fc62606d16cf7298c4c9a8a39c1b3412';
const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/pages/projects/dm-motor-group`, { headers: { Authorization: `Bearer ${tok}` } });
const j = await r.json();
const dc = (j.result && j.result.deployment_configs) || {};
for (const envName of ['production', 'preview']) {
  const ev = (dc[envName] && dc[envName].env_vars) || {};
  console.log(`--- ${envName} ---`);
  for (const [k, v] of Object.entries(ev)) {
    console.log(k, 'type=' + v.type, 'valueLen=' + String(v.value || '').length);
  }
}
