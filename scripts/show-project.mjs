import fs from 'node:fs';
const t = fs.readFileSync('C:/Users/HP/AppData/Roaming/xdg.config/.wrangler/config/default.toml', 'utf8');
const token = (t.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
const ACC = 'fc62606d16cf7298c4c9a8a39c1b3412';
const H = { Authorization: 'Bearer ' + token };
const r = await fetch('https://api.cloudflare.com/client/v4/accounts/' + ACC + '/pages/projects/dm-motor-group', { headers: H }).then((x) => x.json());
const p = r.result;
console.log(JSON.stringify({
  name: p.name,
  production_branch: p.production_branch,
  build_config: p.build_config,
  source: (p.source || {}).config,
  domains: p.domains,
  canonical: (p.canonical_deployment || {}).id,
}, null, 1));
