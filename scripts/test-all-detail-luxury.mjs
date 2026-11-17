/* FULL regression after the design upgrade: every published vehicle page,
 * against the LOCAL preview of the built dist (API proxied to production).
 * Same checks as test-all-vehicle-pages: video plays, no photos, all
 * required elements — plus the new banner / VIEW DETAILS assertions. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9383;
const BASE = process.env.BASE || 'http://127.0.0.1:8931';

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.env.TEMP}\\alllux-prof`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const consoleErr = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErr.push(m.params.entry.text.slice(0, 120));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception?.description || 'eval error').slice(0, 150) });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

const slugs = (await fetch(BASE + '/api/vehicles?per=50').then((r) => r.json())).items.map((v) => v.slug);
console.log('checking', slugs.length, 'vehicle pages (local preview of built dist)\n');

const REQUIRED = `['#videoMain .player video','h1','.price','.avail','.keyfacts','.detail-desc','#btnWa','#btnEnqMain','[data-enq=inspection]','[data-enq=testdrive]','[data-enq=purchase]','[data-enq=delivery]','#btnFavD','#btnCmpD']`;

let bad = [], playing = 0, withImages = 0;
for (const slug of slugs) {
  consoleErr.length = 0;
  await send('Page.navigate', { url: BASE + '/vehicles/' + slug });
  await evl(`(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      if (document.querySelector('#videoMain .player video') || document.querySelector('.detail-info h1')) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  })()`);
  await wait(1200);
  const res = await evl(`(() => {
    const missing = ${REQUIRED}.filter(s => !document.querySelector(s));
    const v = document.querySelector('#videoMain .player video');
    const banners = document.querySelectorAll('.dbanner').length;
    const bannerImgs = document.querySelectorAll('.dbanner img').length;
    const viewDetails = [...document.querySelectorAll('.vcard .foot .btn-ghost')].every(a => /view details/i.test(a.textContent));
    const kfIcons = document.querySelectorAll('.keyfacts .kfi svg').length;
    const variants = document.querySelectorAll('.d-sec.dv-spec,.d-sec.dv-engine,.d-sec.dv-condition,.d-sec.dv-interior,.d-sec.dv-media,.d-sec.dv-market,.d-sec.dv-customer').length;
    return {
      missing, video: !!v, playing: !!v && !v.paused && !v.ended && v.readyState > 2,
      photos: document.querySelectorAll('#app img').length,
      banners, bannerImgs, viewDetails, kfIcons, variants,
      hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      errors: ${JSON.stringify('') /* filled below */},
    };
  })()`);
  const r = typeof res === 'string' ? JSON.parse(res) : res;
  r.errors = consoleErr.length;
  const ok = !r.missing.length && r.video && r.playing && r.photos === 0 && r.banners >= 4 &&
    r.bannerImgs === 0 && r.viewDetails && r.kfIcons === 8 && r.variants === 7 && !r.hscroll && r.errors === 0;
  if (r.video && r.playing) playing++;
  if (r.photos > 0) withImages++;
  if (!ok) bad.push({ slug, ...r });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${slug.padEnd(34)} video:${r.video ? 'Y' : 'N'} play:${r.playing ? 'Y' : 'N'} banners:${r.banners} kfIcons:${r.kfIcons} variants:${r.variants} viewDetails:${r.viewDetails ? 'Y' : 'N'} hscroll:${r.hscroll ? 'Y' : 'N'} errs:${r.errors}${r.missing.length ? ' missing:' + r.missing.join(',') : ''}`);
}
console.log(`\n${slugs.length - bad.length}/${slugs.length} pages PASS | videos playing: ${playing} | pages with photos: ${withImages}`);
if (bad.length) { console.log('\nFAILURES:'); for (const b of bad) console.log(JSON.stringify(b).slice(0, 260)); }
ws.close(); chrome.kill(); process.exit(bad.length ? 1 : 0);
