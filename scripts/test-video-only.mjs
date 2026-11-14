/* VIDEO-ONLY SHOWROOM + STABILITY TEST (live site)
 * For each page: count static car images, count playing videos, check the
 * detail page player, playlist, autoplay, loop, controls and that nothing
 * zooms or shifts the layout. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9375;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\vonly-prof', 'about:blank'], { stdio: 'ignore' });
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
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErr.push(m.params.entry.text.slice(0, 110));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 160) });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

const AUDIT = `(() => {
  const imgs = [...document.querySelectorAll('img')];
  const vids = [...document.querySelectorAll('video')];
  const playing = vids.filter((v) => !v.paused && v.currentTime > 0).length;
  return JSON.stringify({
    images: imgs.length,
    imageSrcs: imgs.map((i) => (i.currentSrc || i.src || '').slice(-34)).slice(0, 4),
    videos: vids.length,
    playing: playing,
    zoom: +(visualViewport ? visualViewport.scale : 1).toFixed(3),
    bodyOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  });
})()`;

for (const [label, url] of [['HOME', 'https://dmmotorgroup.com/'], ['VEHICLES', 'https://dmmotorgroup.com/vehicles'], ['VIDEOS', 'https://dmmotorgroup.com/videos']]) {
  consoleErr.length = 0;
  await send('Page.navigate', { url });
  await wait(9000);
  await evl(`(async () => { for (let y = 0; y <= 2500; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 350)); } window.scrollTo(0, 0); return true; })()`);
  await wait(2500);
  console.log(label + ': ' + await evl(AUDIT));
  if (consoleErr.length) console.log('  console errors: ' + JSON.stringify(consoleErr.slice(0, 3)));
}

/* detail page: one video and a two-video vehicle */
for (const slug of ['plymouth-barracuda-1970', 'mercedes-amg-gle-53-coupe-2021']) {
  consoleErr.length = 0;
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/' + slug });
  await wait(9000);
  const detail = await evl(`(async () => {
    const imgs = [...document.querySelectorAll('img')];
    const player = document.querySelector('#videoMain .player video');
    const chips = [...document.querySelectorAll('#videoList .vchip')].map((b) => b.textContent.trim().slice(0, 28));
    const ctrls = document.querySelectorAll('#videoMain .player .vbtn').length;
    let advanced = false, muted = null, looped = null;
    if (player) {
      const t0 = player.currentTime;
      await new Promise((r) => setTimeout(r, 2500));
      advanced = player.currentTime > t0 + 0.3;
      muted = player.muted; looped = player.loop;
    }
    return JSON.stringify({
      images: imgs.length, gallery: !!document.querySelector('#gallery'),
      hasPlayer: !!player, playing: player ? !player.paused : null,
      advanced: advanced, muted: muted, loop: looped,
      controls: ctrls, playlist: chips,
      unavailable: (document.querySelector('.vid-none') || {}).textContent || null,
    });
  })()`);
  console.log('DETAIL ' + slug + ': ' + detail);
  if (consoleErr.length) console.log('  console errors: ' + JSON.stringify(consoleErr.slice(0, 3)));
}

/* stability: scroll the detail page and measure layout shift */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
await wait(8000);
const cls = await evl(`(async () => {
  let cls = 0;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  const w0 = document.documentElement.clientWidth, s0 = document.documentElement.scrollWidth;
  for (let y = 0; y <= 4000; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 800));
  return JSON.stringify({ cls: +cls.toFixed(4), widthBefore: w0, widthAfter: document.documentElement.clientWidth, hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, scale: +(visualViewport ? visualViewport.scale : 1).toFixed(3) });
})()`);
console.log('STABILITY: ' + cls);

const s = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('.tmp-shots/proof-video-only-detail.png', Buffer.from(s.data, 'base64'));
console.log('screenshot: .tmp-shots/proof-video-only-detail.png');
ws.close(); chrome.kill(); process.exit(0);
