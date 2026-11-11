import fs from 'node:fs';
const t = fs.readFileSync('C:/Users/HP/AppData/Roaming/xdg.config/.wrangler/config/default.toml', 'utf8');
const token = (t.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
const r = await fetch('https://api.cloudflare.com/client/v4/accounts/fc62606d16cf7298c4c9a8a39c1b3412/pages/projects/dm-motor-group', {
  headers: { Authorization: 'Bearer ' + token },
}).then((x) => x.json());
console.log('success:', r.success);
console.log('errors:', JSON.stringify(r.errors));
if (r.result) console.log('canonical:', (r.result.canonical_deployment || {}).id);
