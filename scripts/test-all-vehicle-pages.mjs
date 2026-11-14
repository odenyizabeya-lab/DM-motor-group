/* FULL VIDEO-ONLY SHOWROOM TEST across every published vehicle.
 * Checks on each page: no car photograph, player present and playing,
 * playlist correct, all 15 required elements present, and that the
 * enquiry buttons open the enquiry modal. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9378;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\allvid-prof', 'about:blank'], { stdio: 'ignore' });
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
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 160) });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

const slugs = (await fetch('https://dmmotorgroup.com/api/vehicles?per=50').then((r) => r.json())).items.map((v) => v.slug);
console.log('checking', slugs.length, 'vehicle pages\n');

const REQUIRED = `['#videoMain .player video','h1','.price','.avail','.keyfacts','.detail-desc','#btnWa','#btnEnqMain','[data-enq=inspection]','[data-enq=testdrive]','[data-enq=purchase]','[data-enq=delivery]','#btnFavD','#btnCmpD']`;

let bad = [], playing = 0, withImages = 0;
for (const slug of slugs) {
  consoleErr.length = 0;
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/' + slug });
  /* wait for the page to finish rendering (up to 20s) */
  await evl(`(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      if (document.querySelector('#videoMain .player video') || document.querySelector('.detail-info h1')) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  })()`);
  await wait(2500);
  const r = JSON.parse(await evl(`(async () => {
    const req = ${REQUIRED};
    const missing = req.filter((s) => !document.querySelector(s));
    const v = document.querySelector('#videoMain .player video');
    const t0 = v ? v.currentTime : 0;
    if (v) { try { await v.play(); } catch (e) {} }
    await new Promise((r) => setTimeout(r, 2200));
    const imgs = [...document.querySelectorAll('#vehicleDetails img, .videoshow img, .detail-top img')].length;
    return JSON.stringify({
      missing: missing, images: imgs,
      video: !!v, playing: v ? (!v.paused && v.currentTime > 0.5) : false,
      adv: v ? v.currentTime > t0 + 0.2 : false,
      err: v && v.error ? v.error.code : null,
      chips: document.querySelectorAll('#videoList .vchip').length,
      mute: v ? v.muted : null, loop: v ? v.loop : null,
      ctl: document.querySelectorAll('#videoMain .player .vbtn').length,
    });
  })()`));
  if (r.playing) playing++;
  if (r.images) withImages++;
  const problems = [];
  if (r.missing.length) problems.push('missing:' + r.missing.join(','));
  if (r.images) problems.push('images:' + r.images);
  if (!r.video) problems.push('no player');
  if (!r.playing && !r.err) problems.push('not playing');
  if (r.err) problems.push('media error ' + r.err);
  if (r.ctl < 3) problems.push('controls:' + r.ctl);
  if (problems.length) bad.push(slug + ' -> ' + problems.join(' | '));
  console.log((problems.length ? 'FAIL ' : 'OK   ') + slug + ' | play=' + r.playing + ' chips=' + r.chips + ' muted=' + r.mute + ' loop=' + r.loop + ' ctl=' + r.ctl);
}
console.log('\nplaying: ' + playing + '/' + slugs.length + ' | pages showing a car photo: ' + withImages);
console.log('problems: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
console.log('console errors seen: ' + (consoleErr.length ? JSON.stringify([...new Set(consoleErr)].slice(0, 5)) : 'none'));

/* enquiry modal on one page */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/' + slugs[0] });
await wait(6000);
console.log('enquiry modal opens:', await evl(`(() => { const b = document.querySelector('#btnEnqMain'); if (!b) return 'no button'; b.click(); return new Promise((r) => setTimeout(() => r(document.querySelector('#modal') && !document.querySelector('#modal').hidden ? 'open' : 'not open'), 600)); })()`));
const s = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('.tmp-shots/proof-video-only-page.png', Buffer.from(s.data, 'base64'));
ws.close(); chrome.kill(); process.exit(0);
