import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync('/tmp/upload-results.json', 'utf8'));
const v = r.results[0].videos[0];
const base = v.url.replace(/\/[^/]+$/, '');
const poster = base.replace(/\.mp4$/, '') + '-poster.jpg';
async function head(url, label) {
  const res = await fetch(url, { method: 'HEAD' });
  console.log(label, res.status, res.headers.get('content-type'), res.headers.get('content-length'), res.headers.get('accept-ranges'));
}
async function range(url) {
  const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log('RANGE', res.status, 'bytes=' + buf.length, 'content-range=' + res.headers.get('content-range'));
}
console.log('VIDEO', v.url);
await head(v.url, 'HEAD video');
await range(v.url);
await head(poster, 'HEAD poster');
const api = await fetch('https://dmotor-group-9dq.pages.dev/api/videos?per=50');
const j = await api.json();
console.log('API /api/videos', api.status, 'total=' + j.total, JSON.stringify(j.items?.[0] || null).slice(0, 300));
const det = await fetch('https://dmotor-group-9dq.pages.dev/api/vehicles/lexus-ux-250h-2019');
const d = await det.json();
console.log('DETAIL', det.status, d.brand, d.model, d.year, 'videoCount=' + d.videoCount, 'cover=' + d.cover);
