const BASE = (process.argv[2] || 'https://dmmotorgroup.com').replace(/\/+$/, '');
const out = { base: BASE, checks: [], failures: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, attempt = 0) {
  try {
    const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    const text = await r.text();
    return { status: r.status, text, headers: r.headers };
  } catch (e) {
    if (attempt < 3) { await sleep(1500 * (attempt + 1)); return get(url, attempt + 1); }
    throw e;
  }
}
function record(name, ok, detail = '') {
  out.checks.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) out.failures.push({ name, detail });
}

// health
let r = await get(`${BASE}/api/health`);
record('api/health', r.status === 200 && r.text.includes('"ok":true'), `${r.status}`);

// videos API
r = await get(`${BASE}/api/videos?per=50`);
let vids = {};
try { vids = JSON.parse(r.text); } catch {}
record('/api/videos status', r.status === 200, `${r.status}`);
record('/api/videos total=35', Number(vids.total) === 35, `total=${vids.total}`);
record('/api/videos items=35', (vids.items || []).length === 35, `items=${(vids.items || []).length}`);
const noThumb = (vids.items || []).filter((v) => !v.thumbUrl);
record('/api/videos all items have thumb', noThumb.length === 0, `missing=${noThumb.length}`);

// vehicles API
r = await get(`${BASE}/api/vehicles?per=100`);
let vs = {};
try { vs = JSON.parse(r.text); } catch {}
record('/api/vehicles total=33', Number(vs.total) === 33, `total=${vs.total}`);
const pubs = (vs.items || []).filter((v) => v.status === 'published');
record('/api/vehicles published=33', pubs.length === 33, `published=${pubs.length}`);
const withCover = pubs.filter((v) => v.cover);
record('all published have cover', withCover.length === pubs.length, `with=${withCover.length}/${pubs.length}`);
const withVid = pubs.filter((v) => v.videoCount > 0);
record('all published have videoCount>0', withVid.length === pubs.length, `with=${withVid.length}/${pubs.length}`);

// pages
for (const path of ['/', '/vehicles', '/videos', '/about', '/contact']) {
  r = await get(BASE + path);
  record(`page ${path}`, r.status === 200 && /<html/i.test(r.text), `${r.status} len=${r.text.length}`);
}

// every detail page + its first video/poster playable
for (const v of pubs) {
  r = await get(`${BASE}/vehicles/${v.slug}`);
  record(`detail /vehicles/${v.slug}`, r.status === 200 && r.text.includes(v.slug), `${r.status}`);
  const d = JSON.parse(r.text.includes('__DATA__') ? '{}' : '{}'); // pages are SPA; rely on API below
  const api = await get(`${BASE}/api/vehicles/${v.slug}`);
  let detail = {};
  try { detail = JSON.parse(api.text); } catch {}
  const vidsArr = detail.videos || [];
  record(`api detail ${v.slug}`, api.status === 200 && vidsArr.length === v.videoCount, `${api.status} videos=${vidsArr.length}`);
  if (vidsArr[0]) {
    const vid = vidsArr[0];
    const head = await fetch(vid.url, { method: 'HEAD' });
    record(`video head ${v.slug}`, head.status === 200 && (head.headers.get('content-type') || '').includes('video'), `${head.status} ${head.headers.get('content-length')}b`);
    const range = await fetch(vid.url, { headers: { Range: 'bytes=0-1023' } });
    record(`video range ${v.slug}`, range.status === 206, `${range.status}`);
    const p = await fetch(vid.thumbUrl || detail.cover, { method: 'HEAD' });
    record(`poster head ${v.slug}`, p.status === 200 && (p.headers.get('content-type') || '').includes('image'), `${p.status}`);
  }
  await sleep(80);
}

// sanity: no $0 price rendering for POA listings on the videos page HTML isn't SPA-rendered; check app.js served
r = await get(`${BASE}/app.js`);
record('app.js served with priceText', r.status === 200 && r.text.includes('priceText'), `${r.status}`);

console.log(`\nTOTAL CHECKS=${out.checks.length} FAILURES=${out.failures.length}`);
if (out.failures.length) { console.log(JSON.stringify(out.failures, null, 2)); process.exitCode = 1; }
