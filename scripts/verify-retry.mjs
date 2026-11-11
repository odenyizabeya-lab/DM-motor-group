import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };

const prev = JSON.parse(fs.readFileSync('/tmp/verify-all.json', 'utf8'));
const media = await (await fetch(`${env.SUPABASE_URL}/rest/v1/media?select=id,vehicle_id,type,url,thumb_url&order=vehicle_id.asc,position.asc`, { headers: H })).json();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function check(url, wantType) {
  let last;
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.status !== 200) { last = new Error(`HEAD ${r.status}`); }
      else if (wantType && !(r.headers.get('content-type') || '').includes(wantType)) { last = new Error(`type ${r.headers.get('content-type')}`); }
      else if (!(Number(r.headers.get('content-length')) > 1000)) { last = new Error(`size ${r.headers.get('content-length')}`); }
      else {
        const rr = await fetch(url, { headers: { Range: 'bytes=0-2047' } });
        if (rr.status !== 206) { last = new Error(`range ${rr.status}`); }
        else return { ok: true, len: Number(r.headers.get('content-length')), type: r.headers.get('content-type') };
      }
    } catch (e) { last = e; }
    await sleep(700 * (i + 1));
  }
  return { ok: false, error: last.message };
}

const out = { checked: 0, failures: [] };
for (const m of media) {
  for (const [url, kind, label] of [[m.url, m.type, `media ${m.id} ${m.type}`], [m.thumb_url, 'image', `media ${m.id} poster`]]) {
    if (!url) { out.failures.push({ label, error: 'missing url' }); continue; }
    const r = await check(url, kind);
    out.checked++;
    if (!r.ok) { out.failures.push({ label, error: r.error, url }); console.log('FAIL', label, r.error); }
    await sleep(120);
  }
}
fs.writeFileSync('/tmp/verify-retry.json', JSON.stringify(out, null, 2));
console.log(`CHECKED=${out.checked} FAILURES=${out.failures.length}`);
