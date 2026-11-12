/* Read full browser_cache_ttl payload, then attempt to set respect-existing-headers (0). */
import fs from 'node:fs';
const t = fs.readFileSync('C:/Users/HP/AppData/Roaming/xdg.config/.wrangler/config/default.toml', 'utf8');
const token = (t.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const Z = '192d055a6b7dc54a5c6ffae9faa81fb2';

const before = await fetch(`https://api.cloudflare.com/client/v4/zones/${Z}/settings/browser_cache_ttl`, { headers: H }).then((r) => r.json());
console.log('FULL BEFORE:', JSON.stringify(before).slice(0, 400));

const patch = await fetch(`https://api.cloudflare.com/client/v4/zones/${Z}/settings/browser_cache_ttl`, {
  method: 'PATCH', headers: H, body: JSON.stringify({ value: 0 }),
}).then((r) => r.json());
console.log('PATCH success:', patch.success, patch.errors || '', 'result:', JSON.stringify(patch.result));
