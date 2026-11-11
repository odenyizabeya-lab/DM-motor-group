/* Mobile-emulated (375px) playback test on the live site. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9339;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\vid-mobile-prof',
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
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'https://dmmotorgroup.com/videos' });
await wait(9000);

const cards = await evl(`(async () => {
  for (let y = 0; y <= 2200; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 400)); }
  const imgs = [...document.querySelectorAll('.vidcard img')];
  return JSON.stringify({ cards: document.querySelectorAll('.vidcard').length, ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length });
})()`);
console.log('MOBILE 375 VIDEOS PAGE:', cards);

await evl(`window.scrollTo(0,0); document.querySelector('.vidcard').click(); true`);
await wait(2500);
const play = await evl(`(async () => {
  const v = document.querySelector('#modalPlayer video');
  if (!v) return JSON.stringify({ error: 'no player' });
  await v.play();
  await new Promise((r) => setTimeout(r, 5000));
  return JSON.stringify({ paused: v.paused, t: +v.currentTime.toFixed(2), d: v.duration, w: v.videoWidth, h: v.videoHeight, err: v.error ? v.error.code : null });
})()`);
console.log('MOBILE PLAYBACK:', play);
const s = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('.tmp-shots/proof-mobile-playing.png', Buffer.from(s.data, 'base64'));
ws.close(); chrome.kill(); process.exit(0);
