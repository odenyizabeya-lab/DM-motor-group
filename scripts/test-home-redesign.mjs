/* HOMEPAGE REDESIGN regression — against the LOCAL preview of the built dist
 * (API proxied to production). Verifies:
 *  - topbar claims removed (Verified vehicles / Accurate descriptions / Escrow payments / Contact dealership)
 *  - the four stat cards removed (no .trust numbers on home)
 *  - exact new hero copy
 *  - search panel: 3 tabs, text search + live suggest finds real inventory
 *  - photo search: honest state via the real /api/search/visual endpoint
 *  - desktop + mobile: no console errors, no horizontal scroll, zoom 1.00
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9411;
const BASE = process.env.BASE || 'http://127.0.0.1:8931';

/* tiny valid JPEG (1x1 px) — enough to exercise the upload path (the API
 * validates mime/size and answers before any AI processing) */
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const tmpDir = mkdtempSync(join(tmpdir(), 'home-test-'));
const testJpg = join(tmpDir, 'test.jpg');
writeFileSync(testJpg, Buffer.from(JPEG_B64, 'base64'));

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--window-size=1440,960', `--remote-debugging-port=${PORT}`, `--user-data-dir=${tmpDir}\\prof`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
}
if (!target) { console.log('FAIL: chrome did not start'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const consoleErr = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErr.push(m.params.entry.text.slice(0, 160));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __fail: (r.exceptionDetails.exception?.description || 'eval error').slice(0, 200) };
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); ok ? pass++ : fail++; };

console.log('loading homepage (local preview of built dist)');
await send('Page.navigate', { url: BASE + '/' });
await evl(`(async () => { const t0 = Date.now();
  while (Date.now() - t0 < 20000) { if (document.querySelector('#searchPanel .sp-tab') && document.querySelector('#gridFeatured .vcard')) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()`);
await wait(1200);

/* --- static header (index.html) --- */
const hdr = await evl(`(() => {
  const tb = document.querySelector('#topbar')?.innerText || '';
  return {
    verified: /verified vehicles/i.test(tb),
    accurate: /accurate descriptions/i.test(tb),
    escrow: /escrow/i.test(tb),
    contact: /contact dealership/i.test(tb),
    phone: /\\+971/.test(tb),
    location: /dubai/i.test(tb),
  };
})()`);
check('topbar: no "Verified vehicles"', hdr && !hdr.verified);
check('topbar: no "Accurate descriptions"', hdr && !hdr.accurate);
check('topbar: no "Escrow payments"', hdr && !hdr.escrow);
check('topbar: no "Contact dealership" cta', hdr && !hdr.contact);
check('topbar: quiet factual items kept (phone/location)', hdr && hdr.phone && hdr.location);

/* --- stat cards --- */
const stats = await evl(`(() => ({
  trustBlocks: document.querySelectorAll('#app .trust').length,
  numbers: (document.querySelector('#app')?.innerText.match(/\\b(33|19|35)\\b/g) || []).length,
}))()`);
check('stat cards removed (#app .trust = 0)', stats && stats.trustBlocks === 0, 'found=' + (stats && stats.trustBlocks));

/* --- hero copy --- */
const hero = await evl(`(() => {
  const t = document.querySelector('.hero-lux')?.innerText || '';
  return {
    hasLux: !!document.querySelector('.hero-lux'),
    title: /DM Motor Group/i.test(t),
    tag: /Exceptional Automobiles\\. Distinctive Standards\\./i.test(t),
    desc: /carefully presented collection of exceptional automobiles/i.test(t),
    kicker: /International Automobile Dealership/i.test(t),
    cta: !!document.querySelector('.hero-lux a[href="/vehicles"]') && !!document.querySelector('.hero-lux a[href="/videos"]'),
    photoImgsOutsideBackdrop: [...document.querySelectorAll('.hero-lux img')].filter((i) => !i.closest('.hero-backdrop')).length,
  };
})()`);
check('hero: .hero-lux present', hero && hero.hasLux);
check('hero: exact title "DM Motor Group"', hero && hero.title);
check('hero: exact tagline', hero && hero.tag);
check('hero: supporting description', hero && hero.desc);
check('hero: kicker "International Automobile Dealership"', hero && hero.kicker);
check('hero: both CTAs', hero && hero.cta);
check('hero: no static vehicle photos in hero markup (video-only policy)', hero && hero.photoImgsOutsideBackdrop === 0, 'imgs outside backdrop=' + (hero && hero.photoImgsOutsideBackdrop));

/* --- search panel --- */
const sp = await evl(`(() => ({
  tabs: [...document.querySelectorAll('#searchPanel .sp-tab')].map(b => b.textContent.trim()),
  textInput: !!document.querySelector('#spQ'),
  goBtn: !!document.querySelector('#spGo'),
  photoInput: !!document.querySelector('#spPhoto'),
  videoInput: !!document.querySelector('#spVideo'),
  dropHints: [...document.querySelectorAll('#searchPanel .sp-drop b')].map(b => b.textContent.trim()),
  defaultPane: document.querySelector('#searchPanel .sp-pane.on')?.dataset.p,
}))()`);
check('search: 3 tabs render', sp && sp.tabs.length === 3, (sp && sp.tabs.join(' | ')) || 'none');
check('search: text input + Search button', sp && sp.textInput && sp.goBtn);
check('search: photo upload input', sp && sp.photoInput);
check('search: video upload input', sp && sp.videoInput);
check('search: upload instructions visible', sp && sp.dropHints.length === 2, (sp && sp.dropHints.join(' / ')) || '');
check('search: text pane is default', sp && sp.defaultPane === 'text');

/* --- text search: live suggest against REAL inventory --- */
const sugg = await evl(`(async () => {
  const q = document.querySelector('#spQ'); if (!q) return { fail: 'no input' };
  q.value = 'Cullinan';
  q.dispatchEvent(new Event('input', { bubbles: true }));
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) { if (!document.querySelector('#spSuggest').hidden && document.querySelector('#spSuggest .sp-srow')) break; await new Promise(r => setTimeout(r, 200)); }
  const s = document.querySelector('#spSuggest');
  const rows = [...s.querySelectorAll('.sp-srow')].map(r => r.textContent.replace(/\\s+/g, ' ').trim());
  return { hidden: s.hidden, rows };
})()`);
check('text search: live suggest finds "Cullinan" in real inventory', sugg && !sugg.__fail && !sugg.hidden && sugg.rows.length > 0 && /Cullinan/i.test(sugg.rows.join(' ')), sugg && sugg.rows ? sugg.rows[0] : (sugg && sugg.__fail || 'no rows'));

/* click first suggestion routes to the vehicle page */
const nav1 = await evl(`(async () => {
  document.querySelector('#spSuggest .sp-srow').click();
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) { if (location.pathname.startsWith('/vehicles/')) return location.pathname; await new Promise(r => setTimeout(r, 200)); }
  return null;
})()`);
check('text search: suggestion click opens the real vehicle page', !!nav1, nav1 || 'no navigation');

/* back home; Enter routes to /vehicles?q= */
await send('Page.navigate', { url: BASE + '/' });
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 15000) { if (document.querySelector('#spQ')) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()`);
await wait(600);
const nav2 = await evl(`(async () => {
  const q = document.querySelector('#spQ'); q.value = 'G-Class';
  q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) { if (location.pathname === '/vehicles') return location.search; await new Promise(r => setTimeout(r, 200)); }
  return null;
})()`);
check('text search: Enter routes to /vehicles?q=…', nav2 === '?q=G-Class', nav2 || 'no navigation');

/* --- photo search: honest NO_KEY state (SIMULATED 503 — the real route is
 * built into dist/_worker.js (checked below) but production does not have it
 * until deploy, so the preview proxy answers 404. The stub reproduces the
 * exact 503 NO_KEY body the deployed worker returns when no AI key is set.) --- */
await send('Page.navigate', { url: BASE + '/' });
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 15000) { if (document.querySelector('#spPhoto')) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()`);
await wait(600);
await evl(`(() => {
  const realFetch = window.fetch;
  window.fetch = (url, opts) => {
    if (String(url).includes('/api/search/visual')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'Visual search is being prepared. Text search is fully available, or contact the dealership and we will find the vehicle for you.', code: 'NO_KEY' }), { status: 503, headers: { 'content-type': 'application/json' } }));
    }
    return realFetch(url, opts);
  };
  return true;
})()`);
await evl(`(() => { [...document.querySelectorAll('#searchPanel .sp-tab')].find(b => b.dataset.t === 'photo').click(); return true; })()`);
const doc = await send('DOM.getDocument', {});
const photoNode = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#spPhoto' });
await send('DOM.setFileInputFiles', { files: [testJpg], nodeId: photoNode.nodeId });
let visual = null;
for (let i = 0; i < 30; i++) {
  await wait(1000);
  visual = await evl(`(() => {
    const rs = document.querySelector('#spResults');
    return { preparing: /visual search is being prepared/i.test(rs.innerText || ''), txt: (rs.innerText || '').slice(0, 260) };
  })()`);
  if (visual && visual.preparing) break;
}
check('photo search: honest "being prepared" state shown (simulated 503 NO_KEY)', visual && visual.preparing, visual && visual.txt.split('\n').filter(Boolean).slice(0, 2).join(' | '));
const workerHasRoute = (await import('node:fs')).readFileSync('dist/_worker.js', 'utf8').includes('/api/search/visual');
check('real /api/search/visual route exists in the built worker', workerHasRoute);

/* --- video search state: honest wording present in the upload panel --- */
const vid = await evl(`(() => {
  [...document.querySelectorAll('#searchPanel .sp-tab')].find(b => b.dataset.t === 'video').click();
  const p = document.querySelector('#searchPanel .sp-pane[data-p="video"]');
  return { open: p.classList.contains('on'), hint: p.querySelector('.sp-drophint')?.textContent.trim() };
})()`);
check('video search: tab opens with "analyse the visible frames" wording', vid && vid.open && /visible frames/i.test(vid.hint || ''));

/* --- page health --- */
const health = await evl(`(() => ({
  hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  zoom: document.body.style.zoom || '1.00',
}))()`);
check('desktop 1440: no horizontal scroll', health && !health.hscroll);
check('zoom is 1.00', health && String(health.zoom) === '1.00');
const errs = consoleErr.length;
check('desktop: 0 console errors', errs === 0, errs ? consoleErr[0] : '');

/* --- mobile 390 --- */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wait(1200);
const mob = await evl(`(() => ({ hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  spVisible: !!document.querySelector('#searchPanel') && document.querySelector('#searchPanel').offsetParent !== null,
  heroVisible: !!document.querySelector('.hero-lux') && document.querySelector('.hero-lux').offsetParent !== null }))()`);
check('mobile 390: no horizontal scroll', mob && !mob.hscroll);
check('mobile 390: hero + search panel visible', mob && mob.spVisible && mob.heroVisible);
const mobErrs = consoleErr.length;
check('mobile: no new console errors', mobErrs === errs, mobErrs ? consoleErr[0] : '');

/* --- screenshots --- */
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
await wait(800);
const shotD = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('data/home-desktop.png', Buffer.from(shotD.data, 'base64'));
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wait(800);
const shotM = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('data/home-mobile.png', Buffer.from(shotM.data, 'base64'));
console.log('\nscreenshots: data/home-desktop.png, data/home-mobile.png');

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
