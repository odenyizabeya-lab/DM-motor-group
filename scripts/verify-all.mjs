import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };

const vehicles = await (await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles?select=id,slug,brand,model,year,status,cover_media_id&order=id.asc`, { headers: H })).json();
const media = await (await fetch(`${env.SUPABASE_URL}/rest/v1/media?select=id,vehicle_id,type,url,thumb_url,caption,position&order=vehicle_id.asc,position.asc`, { headers: H })).json();

const byVehicle = new Map();
for (const m of media) {
  if (!byVehicle.has(m.vehicle_id)) byVehicle.set(m.vehicle_id, []);
  byVehicle.get(m.vehicle_id).push(m);
}

const out = { vehicles: vehicles.length, media: media.length, videos: 0, posters: 0, failures: [], rows: [] };
for (const v of vehicles) {
  const ms = byVehicle.get(v.id) || [];
  const vids = ms.filter((m) => m.type === 'video');
  const imgs = ms.filter((m) => m.type === 'image');
  const cover = imgs.find((m) => m.id === v.cover_media_id) || null;
  const row = { id: v.id, slug: v.slug, title: `${v.brand} ${v.model} ${v.year}`, status: v.status, videos: vids.length, coverOk: !!cover, errors: [] };
  if (!vids.length) row.errors.push('no video');
  if (!cover) row.errors.push('no cover image');
  for (const vid of vids) {
    out.videos++;
    try {
      const r = await fetch(vid.url, { method: 'HEAD' });
      if (r.status !== 200) row.errors.push(`video ${vid.id} HEAD ${r.status}`);
      if (!(r.headers.get('content-type') || '').includes('video')) row.errors.push(`video ${vid.id} type ${r.headers.get('content-type')}`);
      const rr = await fetch(vid.url, { headers: { Range: 'bytes=0-2047' } });
      if (rr.status !== 206) row.errors.push(`video ${vid.id} range ${rr.status}`);
      const len = Number(r.headers.get('content-length'));
      if (!(len > 1000)) row.errors.push(`video ${vid.id} size ${len}`);
    } catch (e) {
      row.errors.push(`video ${vid.id} ${e.message}`);
    }
    if (vid.thumb_url) {
      out.posters++;
      try {
        const p = await fetch(vid.thumb_url, { method: 'HEAD' });
        if (p.status !== 200) row.errors.push(`poster ${vid.id} HEAD ${p.status}`);
        if (!(p.headers.get('content-type') || '').includes('image')) row.errors.push(`poster ${vid.id} type ${p.headers.get('content-type')}`);
      } catch (e) {
        row.errors.push(`poster ${vid.id} ${e.message}`);
      }
    } else {
      row.errors.push(`video ${vid.id} no thumb_url`);
    }
  }
  if (row.errors.length) out.failures.push(row);
  out.rows.push(row);
  console.log(`${row.errors.length ? 'FAIL' : 'OK  '} #${row.id} ${row.slug} videos=${row.videos} cover=${row.coverOk}${row.errors.length ? ' :: ' + row.errors.join('; ') : ''}`);
}
fs.writeFileSync('/tmp/verify-all.json', JSON.stringify(out, null, 2));
console.log(`\nVEHICLES=${out.vehicles} MEDIA=${out.media} VIDEOS=${out.videos} POSTERS=${out.posters} FAILURES=${out.failures.length}`);
