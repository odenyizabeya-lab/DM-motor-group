/* Check zone-level Browser Cache TTL and try to set it to respect origin headers. */
import fs from 'node:fs';
const t = fs.readFileSync('C:/Users/HP/AppData/Roaming/xdg.config/.wrangler/config/default.toml', 'utf8');
const token = (t.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

const zs = await fetch('https://api.cloudflare.com/client/v4/zones?name=dmmotorgroup.com', { headers: H }).then((r) => r.json());
console.log('zones lookup success:', zs.success, zs.errors || '');
const zone = (zs.result || [])[0];
if (!zone) { console.log('NO ZONE ACCESS'); process.exit(0); }
console.log('zone:', zone.id, zone.name, 'plan:', zone.plan && zone.plan.name);

const ttl = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone.id}/settings/browser_cache_ttl`, { headers: H }).then((r) => r.json());
console.log('browser_cache_ttl BEFORE:', JSON.stringify(ttl.result));
