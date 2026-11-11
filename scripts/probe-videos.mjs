/* Fetch every video row and inspect the real bytes: status, size, content-type,
 * MP4 brand and codec boxes, plus a HEAD/GET on the poster image. */
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY };
const rows = await fetch(env.SUPABASE_URL + '/rest/v1/media?type=eq.video&select=id,vehicle_id,url,thumb_url&order=id.desc', { headers: H }).then((r) => r.json());

function mp4Info(buf) {
  /* walk top-level boxes; find ftyp brand and moov trak mdia hdlr/codec */
  const view = buf;
  const u32 = (o) => (view[o] << 24 | view[o + 1] << 16 | view[o + 2] << 8 | view[o + 3]) >>> 0;
  const ascii = (o, n) => Buffer.from(view.slice(o, o + n)).toString('ascii');
  let brand = '', codecs = [], ftypSize = 0;
  if (ascii(4, 4) === 'ftyp') { brand = ascii(8, 4); ftypSize = u32(0); }
  /* scan for moov -> trak -> mdia -> minf -> stbl -> stsd entries within first 400KB */
  const limit = Math.min(buf.length, 500000);
  for (let o = ftypSize || 0; o + 8 <= limit;) {
    const size = u32(o); const type = ascii(o + 4, 4);
    if (size < 8) break;
    if (type === 'moov') {
      /* search inside moov for stsd / avc1 / hev1 / hvc1 / vp09 / av01 */
      const inner = buf.slice(o, Math.min(o + size, limit));
      const s = inner.toString('latin1');
      for (const c of ['avc1', 'avc3', 'hev1', 'hvc1', 'vp09', 'av01', 'mp4a', 'Opus', 'ec-3', 'ac-3']) {
        if (s.includes(c) && !codecs.includes(c)) codecs.push(c);
      }
      break;
    }
    o += size;
  }
  return { brand: brand || '?', codecs: codecs.join('+') || 'none-found' };
}

const out = [];
for (const v of rows) {
  const rec = { id: v.id, veh: v.vehicle_id };
  try {
    /* first 2 MB is enough for moov in most web-optimised files; ask with range */
    const r = await fetch(v.url, { headers: { Range: 'bytes=0-2097151' } });
    rec.status = r.status;
    rec.ctype = r.headers.get('content-type');
    rec.len = r.headers.get('content-range') || r.headers.get('content-length');
    rec.ar = r.headers.get('accept-ranges');
    const buf = Buffer.from(await r.arrayBuffer());
    rec.bytes = buf.length;
    if (v.url.endsWith('.mp4')) Object.assign(rec, mp4Info(buf), { head: buf.slice(4, 12).toString('ascii') });
    else rec.head = buf.slice(0, 12).toString('ascii');
    const p = await fetch(v.thumb_url, { method: 'GET' });
    rec.thumb = p.status + ' ' + (p.headers.get('content-type') || '');
    await p.arrayBuffer();
  } catch (e) { rec.error = String(e).slice(0, 120); }
  out.push(rec);
  console.log(JSON.stringify(rec));
}
const bad = out.filter((r) => r.status !== 200 && r.status !== 206);
console.log('\nnon-200:', bad.length, 'of', out.length);
