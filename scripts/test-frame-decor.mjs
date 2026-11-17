/* VIDEO FRAME DECOR test — against local preview of built dist.
 * Verifies for real:
 *  1. frames are extracted from the vehicle's own video and applied to all
 *     5 section banners + prose info cards
 *  2. per-vehicle isolation (different vehicle → own cache keys)
 *  3. caching works (2nd visit served from IndexedDB, no re-extraction)
 *  4. fallback: bad video → banners untouched
 *  5. original video untouched & still primary; no <img> vehicle photos
 *     anywhere (frames are CSS backgrounds only)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9421;
const BASE = 'http://127.0.0.1:8931';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,960',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'fr-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push(m.params.entry.text.slice(0, 140)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __fail: (r.exceptionDetails.exception?.description || 'eval').slice(0, 160) }; return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); ok ? pass++ : fail++; };
const openVehicle = async (slug, timeoutMs = 120000) => {
  await send('Page.navigate', { url: `${BASE}/vehicles/${slug}` });
  await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 20000) { if (document.querySelector('#videoMain video')) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()`);
  await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < ${timeoutMs}) { if (document.querySelector('#app .dbanner.db-hasframe')) return true; await new Promise(r => setTimeout(r, 250)); } return false; })()`);
  await wait(1000);
};

const list = (await fetch(BASE + '/api/vehicles?per=6&sort=newest').then((r) => r.json())).items;
const vehA = list[0], vehB = list[1] || list[0];
console.log('testing vehicles:', vehA.slug, '(id', vehA.id + ')', '/', vehB.slug, '(id', vehB.id + ')\n');

/* ---- 1. extraction & application (vehicle A, first visit = real extraction) ---- */
const tFirst = Date.now();
await openVehicle(vehA.slug);
const firstMs = Date.now() - tFirst;
let r = await evl(`(() => ({
  banners: document.querySelectorAll('#app .dbanner').length,
  framed: document.querySelectorAll('#app .dbanner.db-hasframe').length,
  panels: document.querySelectorAll('#app .d-sec.dv-condition, #app .d-sec.dv-interior, #app .d-sec.dv-market, #app .d-sec.dv-customer').length,
  panelsFramed: document.querySelectorAll('#app .d-sec.hasframe').length,
  videoPlaying: (() => { const v = document.querySelector('#videoMain video'); return !!v && !v.paused; })(),
  imgs: document.querySelectorAll('#app img').length,
  vfLast: window.__vfLast || null,
}))()`);
check('A: all 5 section banners carry frames', r && r.banners === 5 && r.framed === 5, `banners=${r && r.banners} framed=${r && r.framed}`);
const fullBgs = await evl(`(() => [...document.querySelectorAll('#app .dbanner .db-frame')].map(d => d.style.backgroundImage))()`);
check('A: banner frame backgrounds actually set', fullBgs && fullBgs.length === 5 && fullBgs.every((b) => b.startsWith('url("blob:')));
check('A: banner frames use DIFFERENT frames', fullBgs && new Set(fullBgs).size >= 3, `distinct=${fullBgs && new Set(fullBgs).size}`);
check('A: prose info cards carry faint frames', r && r.panels >= 3 && r.panelsFramed === r.panels, `panels=${r && r.panels} framed=${r && r.panelsFramed}`);
check('A: main video still playing (primary presentation intact)', r && r.videoPlaying);
check('A: zero <img> vehicle photos (frames are CSS backgrounds only)', r && r.imgs === 0);
check('A: first visit extracted (fromCache=false)', r && r.vfLast && r.vfLast.fromCache === false, JSON.stringify(r && r.vfLast));
check('A: no console errors', errs.length === 0, errs[0] || '');

/* IndexedDB keys belong to THIS vehicle */
const keys = await evl(`vfCacheKeys()`);
check('A: frames cached in IndexedDB for this vehicle', keys && keys.some((k) => String(k).includes('__dmframes/' + vehA.id + '/')), `keys=${JSON.stringify(keys)}`);

/* frame blob dimensions (real extraction quality) */
const dims = await evl(`(async () => {
  const key = (await vfCacheKeys()).find(k => String(k).includes('__dmframes/' + ${JSON.stringify(String(vehA.id))} + '/'));
  if (!key) return null;
  const blobs = await vfCacheGet(key);
  const bmp = await createImageBitmap(blobs[0]);
  return { w: bmp.width, h: bmp.height, n: blobs.length };
})()`);
check('A: cached frame is a real high-res image', dims && dims.w >= 400 && dims.h >= 300, dims ? `${dims.w}x${dims.h} ×${dims.n}` : 'none');

/* ---- 2. second visit: served from IndexedDB, no re-extraction ---- */
errs.length = 0;
const tRe = Date.now();
await openVehicle(vehA.slug, 20000);
const reMs = Date.now() - tRe;
const re = await evl(`(() => ({ framed: document.querySelectorAll('#app .dbanner.db-hasframe').length, vfLast: window.__vfLast || null }))()`);
check('A revisit: frames re-applied from IndexedDB (no re-extraction)', re && re.framed === 5 && re.vfLast && re.vfLast.fromCache === true, `${reMs}ms ${JSON.stringify(re && re.vfLast)}`);

/* ---- 3. isolation: vehicle B gets its own cache keys ---- */
errs.length = 0;
await openVehicle(vehB.slug);
const keysB = await evl(`vfCacheKeys()`);
const bKeys = (keysB || []).filter((k) => String(k).includes('__dmframes/' + vehB.id + '/'));
const aKeys = (keysB || []).filter((k) => String(k).includes('__dmframes/' + vehA.id + '/'));
check('B: banners framed with own video frames', (await evl(`(() => document.querySelectorAll('#app .dbanner.db-hasframe').length)()`)) === 5);
check('isolation: cache holds SEPARATE entries for both vehicles', aKeys.length > 0 && bKeys.length > 0, `A(${vehA.id})=${aKeys.length} B(${vehB.id})=${bKeys.length}`);

/* ---- 4. fallback: broken video URL → nothing changes ---- */
const before = await evl(`(() => ({ framed: document.querySelectorAll('#app .dbanner.db-hasframe').length }))()`);
const fb = await evl(`(async () => {
  const b = document.querySelectorAll('#app .dbanner.db-hasframe').length;
  await decorateVehicleWithFrames(999999, 'https://gevxgqdevaanmxqzverv.supabase.co/storage/v1/object/public/vehicle-media/nope/nope.mp4');
  return { framed: document.querySelectorAll('#app .dbanner.db-hasframe').length };
})()`);
check('fallback: bad video leaves existing banners untouched', fb && !fb.__fail && fb.framed === before.framed, `framed still=${fb && fb.framed}`);

/* ---- screenshots ---- */
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('data/frames-banner.png', Buffer.from(shot.data, 'base64'));
await evl(`document.querySelector('#app .d-sec.dv-condition')?.scrollIntoView({block:'center'})`);
await wait(700);
const shot2 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('data/frames-panel.png', Buffer.from(shot2.data, 'base64'));
console.log('\nscreenshots: data/frames-banner.png, data/frames-panel.png');

/* ---- 5. mobile sanity on vehicle A ---- */
await openVehicle(vehA.slug, 60000);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wait(1200);
const mob = await evl(`(() => ({ h: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, framed: document.querySelectorAll('#app .dbanner.db-hasframe').length }))()`);
check('mobile 390: no horizontal scroll, frames intact', mob && !mob.h && mob.framed === 5);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
