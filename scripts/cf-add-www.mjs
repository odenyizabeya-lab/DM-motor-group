import fs from 'node:fs';
const p = 'C:/Users/HP/AppData/Roaming/xdg.config/.wrangler/config/default.toml';
const t = fs.readFileSync(p, 'utf8');
const token = (t.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
const ACC = 'fc62606d16cf7298c4c9a8a39c1b3412';
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/pages/projects/dm-motor-group/domains`, {
  method: 'POST', headers: H, body: JSON.stringify({ name: 'www.dmmotorgroup.com' }),
});
const j = await res.json();
console.log('ADD www ->', res.status, j.success, j.errors?.map(e => e.message).join(';') || '');
if (j.result) console.log('  status:', j.result.status, 'verification:', j.result.verification_data?.status, 'cert:', j.result.certificate_authority);

// refresh all domains
const d = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/pages/projects/dm-motor-group/domains`, { headers: H })).json();
console.log('\nSTATUS:');
for (const x of d.result || []) console.log(`  ${x.name}  status=${x.status}  verification=${x.verification_data?.status || ''}`);
