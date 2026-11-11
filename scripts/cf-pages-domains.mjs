import fs from 'node:fs';
const p = 'C:/Users/HP/AppData/Roaming/xdg.config/.wrangler/config/default.toml';
const t = fs.readFileSync(p, 'utf8');
const token = (t.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
if (!token) { console.log('NO TOKEN'); process.exit(1); }
const ACC = 'fc62606d16cf7298c4c9a8a39c1b3412';
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const proj = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/pages/projects/dm-motor-group`, { headers: H })).json();
console.log('PROJECT HTTP', proj.success, proj.errors?.map(e => e.message).join(';') || '');
if (proj.result) {
  console.log('project:', proj.result.name);
  console.log('subdomain:', proj.result.subdomain);
  console.log('domains:', JSON.stringify(proj.result.domains));
  console.log('canonical_deployment:', proj.result.canonical_deployment?.url || '');
}

const doms = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/pages/projects/dm-motor-group/domains`, { headers: H })).json();
console.log('\nDOMAINS HTTP', doms.success, doms.errors?.map(e => e.message).join(';') || '');
for (const d of doms.result || []) {
  console.log(`  ${d.name}  status=${d.status}  verification=${d.verification_data?.status || ''}  cert=${d.certificate_authority || ''}`);
}
