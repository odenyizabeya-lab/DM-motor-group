/* Purge the zone edge cache for /sw.js (zone-level API). */
import fs from 'node:fs';
const t = fs.readFileSync('C:/Users/HP/AppData/Roaming/xdg.config/.wrangler/config/default.toml', 'utf8');
const token = (t.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const Z = '192d055a6b7dc54a5c6ffae9faa81fb2';

const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${Z}/purge_cache`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ files: ['https://dmmotorgroup.com/sw.js', 'https://www.dmmotorgroup.com/sw.js'] }),
}).then((x) => x.json());
console.log('purge success:', r.success, 'errors:', JSON.stringify(r.errors), 'result:', JSON.stringify(r.result));
