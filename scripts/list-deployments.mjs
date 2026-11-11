import fs from 'node:fs';
const t = fs.readFileSync('C:/Users/HP/AppData/Roaming/xdg.config/.wrangler/config/default.toml', 'utf8');
const token = (t.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
const ACC = 'fc62606d16cf7298c4c9a8a39c1b3412';
const H = { Authorization: 'Bearer ' + token };
const r = await fetch('https://api.cloudflare.com/client/v4/accounts/' + ACC + '/pages/projects/dm-motor-group/deployments?per_page=10', { headers: H }).then((x) => x.json());
for (const d of (r.result || []).slice(0, 10)) {
  const md = (d.deployment_trigger && d.deployment_trigger.metadata) || {};
  console.log(JSON.stringify({
    id: String(d.id).slice(0, 8),
    branch: md.branch,
    created: d.created_on,
    by: d.created_by,
    source: d.source || (d.deployment_trigger && d.deployment_trigger.type),
    commit: String(md.commit_hash || '').slice(0, 8),
    msg: String(md.commit_message || '').slice(0, 70),
  }));
}
