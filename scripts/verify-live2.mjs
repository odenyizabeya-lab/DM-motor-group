const BASE = (process.argv[2] || 'https://edd46d61.dm-motor-group-9dq.pages.dev').replace(/\/+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
  if (!cond) fails.push(`${name} :: ${detail}`);
};
async function jget(path) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(BASE + path); return { status: r.status, json: await r.json() }; }
    catch { await sleep(1000 * (i + 1)); }
  }
  return { status: 0, json: null };
}

const health = await jget('/api/health');
ok('api/health', health.status === 200 && health.json?.ok === true, `${health.status}`);

const vids = await jget('/api/videos?per=50');
ok('/api/videos total=35', vids.json?.total === 35, `total=${vids.json?.total}`);
ok('/api/videos items=35', (vids.json?.items || []).length === 35, `items=${(vids.json?.items || []).length}`);
ok('/api/videos pages(per=18)=2', (await jget('/api/videos?per=18')).json?.pages === 2);
ok('/api/videos all thumbs', (vids.json?.items || []).every((v) => v.thumbUrl), '');
ok('/api/videos unique ids', new Set((vids.json?.items || []).map((v) => v.id)).size === 35);

const vs = await jget('/api/vehicles?per=100');
const items = vs.json?.items || [];
ok('/api/vehicles total=33', vs.json?.total === 33, `total=${vs.json?.total}`);
ok('all published', items.every((v) => v.status === 'published'), `${items.filter((v) => v.status !== 'published').length} not published`);
ok('all have covers', items.every((v) => v.cover), '');
ok('all videoCount>0', items.every((v) => v.videoCount > 0), '');
ok('sum videoCount=35', items.reduce((n, v) => n + v.videoCount, 0) === 35, `sum=${items.reduce((n, v) => n + v.videoCount, 0)}`);

let detailFails = 0;
for (const v of items) {
  const d = await jget(`/api/vehicles/${v.slug}`);
  const vidsInDetail = (d.json?.media || []).filter((m) => m.type === 'video');
  const imgs = (d.json?.media || []).filter((m) => m.type === 'image');
  if (d.status !== 200 || vidsInDetail.length !== v.videoCount || !imgs.length) {
    detailFails++;
    console.log(`FAIL detail ${v.slug} status=${d.status} videos=${vidsInDetail.length}/${v.videoCount} images=${imgs.length}`);
  }
  await sleep(60);
}
ok('all 33 detail APIs expose their videos + cover image', detailFails === 0, `bad=${detailFails}`);

// playback of every video URL, using a retry
let playFails = 0, checked = 0;
for (const item of vids.json?.items || []) {
  let good = false, last = '';
  for (let i = 0; i < 5 && !good; i++) {
    try {
      const h = await fetch(item.url, { method: 'HEAD' });
      const r = await fetch(item.url, { headers: { Range: 'bytes=0-2047' } });
      const p = await fetch(item.thumbUrl, { method: 'HEAD' });
      good = h.status === 200 && /video/.test(h.headers.get('content-type') || '') && r.status === 206
        && p.status === 200 && /image/.test(p.headers.get('content-type') || '');
      if (!good) last = `h=${h.status} r=${r.status} p=${p.status}`;
    } catch (e) { last = e.message; }
    if (!good) await sleep(800 * (i + 1));
  }
  checked++;
  if (!good) { playFails++; console.log(`FAIL play ${item.slug} ${last}`); }
  await sleep(100);
}
ok(`playback ${checked}/35 videos (HEAD 200 + Range 206 + poster 200)`, playFails === 0, `bad=${playFails}`);

console.log(`\nFAILURES=${fails.length}`);
if (fails.length) process.exitCode = 1;
