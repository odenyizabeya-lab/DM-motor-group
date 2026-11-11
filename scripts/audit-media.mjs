import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
const rows = await fetch(`${env.SUPABASE_URL}/rest/v1/media?type=eq.video&select=id,vehicle_id,url,thumb_url`, { headers: H }).then((r) => r.json());
console.log('video rows', rows.length);
let bad = 0;
for (const r of rows) {
  const checks = [];
  for (const u of [r.thumb_url, r.url]) {
    if (!u) { checks.push('(empty)'); continue; }
    const s = await fetch(u, { method: 'HEAD' }).then((x) => x.status).catch((e) => 'ERR ' + e.message);
    checks.push(s);
    if (s !== 200) bad++;
  }
  if (checks.some((s) => s !== 200 && s !== '(empty)')) console.log(`id=${r.id} v=${r.vehicle_id} thumb=${checks[0]} url=${checks[1]} ${r.thumb_url}`);
}
console.log('non-200 checks:', bad);
