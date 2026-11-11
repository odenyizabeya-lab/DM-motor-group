/* Verify lazy thumbnails load when scrolled into view + capture visual proof. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;
const BASE = 'https://dmmotorgroup.com';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\vid-scroll-prof',
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
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: BASE + '/videos' });
await wait(8000);

/* scroll the whole page through every position so every lazy image enters the viewport */
await evl(`(async () => {
  for (let y = 0; y <= document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 350)); }
  window.scrollTo(0, 0);
  return true;
})()`);
await wait(3000);
const thumbs = await evl(`(() => {
  const imgs = [...document.querySelectorAll('.vidcard img')];
  return JSON.stringify({ total: imgs.length, ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length, neverLoaded: imgs.filter((i) => !i.complete).length });
})()`);
console.log('AFTER FULL SCROLL:', thumbs);

const s1 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('.tmp-shots/live-videos-verified.png', Buffer.from(s1.data, 'base64'));

/* play a video and screenshot mid-playback for visual proof */
await evl(`document.querySelector('.vidcard').click(); true`);
await wait(2500);
await evl(`(() => { const v = document.querySelector('#modalPlayer video'); if (v) v.play(); return true; })()`);
await wait(4000);
const playing = await evl(`(() => { const v = document.querySelector('#modalPlayer video'); return JSON.stringify({ paused: v.paused, t: v.currentTime.toFixed(2), d: v.duration, w: v.videoWidth, h: v.videoHeight }); })()`);
console.log('PLAYING:', playing);
const s2 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('.tmp-shots/live-video-playing.png', Buffer.from(s2.data, 'base64'));

/* home rail: scroll horizontally through the rail */
await evl(`location.href = '${BASE}/'`);
await wait(8000);
await evl(`(async () => {
  const rail = document.querySelector('#railVideos');
  if (rail) { for (let x = 0; x <= rail.scrollWidth; x += 500) { rail.scrollLeft = x; await new Promise((r) => setTimeout(r, 300)); } rail.scrollLeft = 0; }
  return true;
})()`);
await wait(2500);
const rail = await evl(`(() => {
  const imgs = [...document.querySelectorAll('#railVideos .vidcard img')];
  return JSON.stringify({ total: imgs.length, ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length });
})()`);
console.log('HOME RAIL AFTER H-SCROLL:', rail);
const s3 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('.tmp-shots/live-home-rail.png', Buffer.from(s3.data, 'base64'));

ws.close(); chrome.kill(); process.exit(0);
