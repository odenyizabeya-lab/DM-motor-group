/* End-to-end video playback test against the live site via CDP.
 * 1. Load /videos — check thumbnails render (naturalWidth) + failed requests.
 * 2. Click the first video card, wait for the modal player.
 * 3. Start playback: report readyState, duration, currentTime, error codes.
 * 4. Also test the home page video rail and a vehicle detail page player. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
const BASE = 'https://dmmotorgroup.com';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\vid-test-prof',
  'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try {
    const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
    target = list.find((t) => t.type === 'page');
  } catch {}
}
if (!target) { console.error('no target'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const netFail = []; const consoleErr = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Network.loadingFailed') netFail.push({ url: (m.params.blockedReason || '') + ' ' + (m.params.errorText || ''), type: m.params.type });
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErr.push(m.params.entry.text.slice(0, 160));
  if (m.method === 'Runtime.exceptionThrown') consoleErr.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 200));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable'); await send('Log.enable');

/* ---------- 1. videos page ---------- */
await send('Page.navigate', { url: BASE + '/videos' });
await wait(9000);
const page = await evl(`(async () => {
  const imgs = [...document.querySelectorAll('.vidcard img')];
  const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.slice(-60));
  const ok = imgs.filter((i) => i.complete && i.naturalWidth > 0).length;
  const pendingLoad = imgs.filter((i) => !i.complete).length;
  return JSON.stringify({ cards: document.querySelectorAll('.vidcard').length, imgs: imgs.length, ok: ok, broken: broken.slice(0,5), pendingLoad: pendingLoad });
})()`);
console.log('VIDEOS PAGE:', page);

/* screenshot the top of the videos page */
const shot1 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('.tmp-shots/live-videos-page.png', Buffer.from(shot1.data, 'base64'));

/* ---------- 2. click first card -> modal player ---------- */
await evl(`document.querySelector('.vidcard').click(); true`);
await wait(2500);
const modal = await evl(`(async () => {
  const v = document.querySelector('#modalPlayer video');
  if (!v) return JSON.stringify({ modalPlayer: false });
  return JSON.stringify({ modalPlayer: true, src: v.src.slice(-50), poster: (v.poster || '').slice(-50), readyState: v.readyState, networkState: v.networkState, error: v.error ? v.error.code : null });
})()`);
console.log('MODAL PLAYER:', modal);

/* ---------- 3. actual playback ---------- */
const play = await evl(`(async () => {
  const v = document.querySelector('#modalPlayer video');
  if (!v) return JSON.stringify({ error: 'no video element' });
  try { await v.play(); } catch (e) { return JSON.stringify({ playRejected: String(e) }); }
  await new Promise((r) => setTimeout(r, 3000));
  return JSON.stringify({ paused: v.paused, currentTime: v.currentTime, duration: v.duration, readyState: v.readyState, videoWidth: v.videoWidth, videoHeight: v.videoHeight, err: v.error ? v.error.code + '/' + v.error.message : null });
})()`);
console.log('PLAYBACK:', play);

/* ---------- 4. home page rail ---------- */
await evl(`location.href = '${BASE}/'`);
await wait(9000);
const home = await evl(`(async () => {
  const imgs = [...document.querySelectorAll('#railVideos .vidcard img')];
  const ok = imgs.filter((i) => i.complete && i.naturalWidth > 0).length;
  return JSON.stringify({ railCards: document.querySelectorAll('#railVideos .vidcard').length, imgs: imgs.length, thumbOk: ok });
})()`);
console.log('HOME RAIL:', home);

/* ---------- 5. vehicle detail player ---------- */
await evl(`location.href = '${BASE}/vehicles/plymouth-barracuda-1970'`);
await wait(9000);
const detail = await evl(`(async () => {
  const boxes = document.querySelectorAll('.vidbox video').length;
  const thumbed = [...document.querySelectorAll('.gthumbs img')].filter((i) => i.complete && i.naturalWidth > 0).length;
  return JSON.stringify({ detailVideoEls: boxes, galleryThumbsOk: thumbed });
})()`);
console.log('VEHICLE DETAIL:', detail);

/* click a video thumbnail in the gallery -> inline player, then play */
await evl(`(() => { const b = [...document.querySelectorAll('.gthumbs button')].find((x) => x.textContent.includes('video')); if (b) b.click(); return true; })()`);
await wait(3000);
const dplay = await evl(`(async () => {
  const v = document.querySelector('.gallery-main video');
  if (!v) return JSON.stringify({ inlinePlayer: false });
  try { await v.play(); } catch (e) { return JSON.stringify({ inlinePlayer: true, playRejected: String(e) }); }
  await new Promise((r) => setTimeout(r, 2500));
  return JSON.stringify({ inlinePlayer: true, paused: v.paused, currentTime: v.currentTime, duration: v.duration, videoWidth: v.videoWidth, err: v.error ? v.error.code : null });
})()`);
console.log('DETAIL PLAYBACK:', dplay);

const shot2 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('.tmp-shots/live-detail-player.png', Buffer.from(shot2.data, 'base64'));

console.log('\nNETWORK FAILURES:', JSON.stringify(netFail.filter((f) => /video|mp4|jpg|webp|supabase/i.test(f.url + f.type) || true).slice(0, 20)));
console.log('CONSOLE ERRORS:', JSON.stringify(consoleErr.slice(0, 15)));

import fs from 'node:fs';
ws.close(); chrome.kill(); process.exit(0);
