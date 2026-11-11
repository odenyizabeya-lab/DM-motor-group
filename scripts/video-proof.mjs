/* Final visual proof: mid-playback frame + home rail thumbs after slow scroll. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const BASE = 'https://dmmotorgroup.com';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\vid-final-prof',
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
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('.tmp-shots/' + name, Buffer.from(s.data, 'base64')); };

await send('Page.enable'); await send('Runtime.enable');

/* --- mid-playback frame from the videos page --- */
await send('Page.navigate', { url: BASE + '/videos' });
await wait(8000);
await evl(`document.querySelector('.vidcard').click(); true`);
await wait(2000);
const started = await evl(`(async () => {
  const v = document.querySelector('#modalPlayer video');
  await v.play();
  await new Promise((r) => setTimeout(r, 6000));
  return JSON.stringify({ paused: v.paused, t: +v.currentTime.toFixed(2), d: v.duration, readyState: v.readyState });
})()`);
console.log('MID-PLAY:', started);
await shot('proof-playing-midframe.png');

/* sample the video frame pixels to prove it is not black */
const pixel = await evl(`(() => {
  const v = document.querySelector('#modalPlayer video');
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const x = c.getContext('2d'); x.drawImage(v, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { sum += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
  return JSON.stringify({ avgBrightness: +(sum / n).toFixed(1), blackIf0: sum / n < 8 });
})()`);
console.log('FRAME PIXELS:', pixel);

/* --- home rail: slow horizontal scroll --- */
await evl(`location.href = '${BASE}/'`);
await wait(8000);
await evl(`(async () => {
  const rail = document.querySelector('#railVideos');
  if (!rail) return false;
  for (let x = 0; x <= rail.scrollWidth; x += 250) { rail.scrollLeft = x; await new Promise((r) => setTimeout(r, 500)); }
  return true;
})()`);
await wait(4000);
const rail = await evl(`(() => {
  const imgs = [...document.querySelectorAll('#railVideos .vidcard img')];
  return JSON.stringify({ total: imgs.length, ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length, never: imgs.filter((i) => !i.complete).length });
})()`);
console.log('HOME RAIL SLOW SCROLL:', rail);
await evl(`document.querySelector('#railVideos').scrollLeft = 400; true`);
await wait(1500);
await shot('proof-home-rail.png');

ws.close(); chrome.kill(); process.exit(0);
