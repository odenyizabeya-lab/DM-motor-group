/* Consolidated final verification, SW-controlled fresh profile:
 * - controller is /sw.js?v=12
 * - home rail: position, thumbs, modal play, overlay hidden while playing
 * - /videos modal play
 * - detail inline play
 * - screenshot mid-playback */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9357;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\final2-prof',
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
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 160) });
  return r.result && r.result.value;
};

await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await wait(9000);
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await wait(9000);
console.log('SW CONTROLLER:', await evl(`navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : 'none'`));

const pos = await evl(`(() => { const s = document.querySelector('#secVideos'); return JSON.stringify({ railTop: Math.round(s.getBoundingClientRect().top + scrollY), vh: innerHeight }); })()`);
console.log('HOME RAIL POSITION:', pos);

await evl(`document.querySelector('#secVideos').scrollIntoView({block:'center'}); true`);
await wait(1200);
const thumbs = await evl(`(() => { const imgs = [...document.querySelectorAll('#railVideos img')]; return JSON.stringify({ total: imgs.length, ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length }); })()`);
console.log('HOME RAIL THUMBS:', thumbs);

await evl(`window.scrollTo(0,0); document.querySelector('#railVideos .vidcard').click(); true`);
await wait(2500);
const play = await evl(`(async () => {
  const v = document.querySelector('#modalPlayer video');
  if (!v) return JSON.stringify({ fail: 'no player' });
  try { await v.play(); } catch (e) { return JSON.stringify({ reject: String(e && e.name || e) }); }
  await new Promise((r) => setTimeout(r, 4000));
  const ov = document.querySelector('#modalPlayer .voverlay');
  return JSON.stringify({ paused: v.paused, t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null, overlayOpacity: ov ? getComputedStyle(ov).opacity : 'n/a', overlayPointer: ov ? getComputedStyle(ov).pointerEvents : 'n/a' });
})()`);
console.log('HOME RAIL PLAYBACK:', play);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('.tmp-shots/final-mobile-playing.png', Buffer.from(shot.data, 'base64'));

/* /videos modal */
await evl(`document.querySelector('#modal .x') && document.querySelector('#modal .x').click(); true`);
await wait(800);
await send('Page.navigate', { url: 'https://dmmotorgroup.com/videos' });
await wait(9000);
const vids = await evl(`(async () => {
  const cards = document.querySelectorAll('.vidcard');
  document.querySelector('.vidcard').click();
  await new Promise((r) => setTimeout(r, 2500));
  const v = document.querySelector('#modalPlayer video');
  if (!v) return JSON.stringify({ fail: 'no player' });
  try { await v.play(); } catch (e) { return JSON.stringify({ reject: String(e && e.name || e) }); }
  await new Promise((r) => setTimeout(r, 3000));
  return JSON.stringify({ cards: cards.length, t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null });
})()`);
console.log('/videos PLAYBACK:', vids);

/* detail */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
await wait(9000);
const det = await evl(`(async () => {
  const v = document.querySelector('.vidbox video');
  if (!v) return JSON.stringify({ fail: 'no inline video' });
  try { await v.play(); } catch (e) { return JSON.stringify({ reject: String(e && e.name || e) }); }
  await new Promise((r) => setTimeout(r, 3000));
  return JSON.stringify({ t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null });
})()`);
console.log('DETAIL PLAYBACK:', det);
console.log('screenshot: .tmp-shots/final-mobile-playing.png');
ws.close(); chrome.kill(); process.exit(0);
