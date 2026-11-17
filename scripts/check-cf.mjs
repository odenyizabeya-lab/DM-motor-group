import fs from 'node:fs';
const t = fs.readFileSync('C:/Users/HP/AppData/Roaming/xdg.config/.wrangler/config/default.toml', 'utf8');
const m = (t.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
console.log('token found:', !!m, 'len:', m && m.length);
const r = await fetch('https://api.cloudflare.com/client/v4/accounts/fc62606d16cf7298c4c9a8a39c1b3412/pages/projects/dm-motor-group/deployments?per_page=3', { headers: { Authorization: 'Bearer ' + m } }).then((x) => x.text());
console.log(r.slice(0, 600));
