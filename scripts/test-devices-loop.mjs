/* Device matrix + loop + unavailable-message test.
 * - 375 (Android), 390 (iPhone), 768 (tablet), 1440 (desktop)
 * - no zoom, no horizontal scroll, video keeps its box, no distortion
 * - a video that ends replays (loop) and a two-video playlist advances
 * - a broken video shows "Vehicle video currently unavailable" and no photo
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9379;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\dev-prof', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
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
await send('Page.enable'); await send('Runtime.enable');

const DEVICES = [[375, 812, 'Android phone'], [390, 844, 'iPhone 14'], [768, 1024, 'iPad portrait'], [1440, 900, 'Desktop']];
for (const [w, h, label] of DEVICES) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 800 });
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
  await wait(6000);
  const r = await evl(`(() => {
    const v = document.querySelector('#videoMain .player video');
    const box = document.querySelector('#videoMain');
    const b = v ? v.getBoundingClientRect() : null;
    return JSON.stringify({
      zoom: +(visualViewport ? visualViewport.scale : 1).toFixed(3),
      hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      boxW: box ? Math.round(box.getBoundingClientRect().width) : 0,
      vw: b ? Math.round(b.width) : 0, vh: b ? Math.round(b.height) : 0,
      natural: v ? v.videoWidth + 'x' + v.videoHeight : '',
      fits: b ? (b.width <= box.getBoundingClientRect().width + 1 && b.height <= box.getBoundingClientRect().height + 1) : false,
      playing: v ? !v.paused : false,
      imgs: document.querySelectorAll('img').length,
    });
  })()`);
  console.log(label + ' (' + w + 'x' + h + '): ' + r);
}

/* loop: seek near the end of a short video and confirm it restarts */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/byd-seal-2023' });
await wait(7000);
console.log('LOOP TEST:', await evl(`(async () => {
  const v = document.querySelector('#videoMain .player video');
  if (!v) return 'no video';
  await new Promise((r) => setTimeout(r, 1500));
  const dur = v.duration || 0;
  v.currentTime = Math.max(0, dur - 0.6);
  await new Promise((r) => setTimeout(r, 2500));
  const after = v.currentTime;
  return JSON.stringify({ duration: +dur.toFixed(1), afterSeek: +after.toFixed(2), restarted: after < 3 || after > dur - 0.5, paused: v.paused, loopAttr: v.loop });
})()`));

/* playlist advance: click video 2 on a two-video vehicle */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/mercedes-amg-gle-53-coupe-2021' });
await wait(7000);
console.log('PLAYLIST TEST:', await evl(`(async () => {
  const chips = [...document.querySelectorAll('#videoList .vchip')];
  if (chips.length < 2) return 'no playlist';
  const first = document.querySelector('#videoMain .player video').currentSrc;
  chips[1].click();
  await new Promise((r) => setTimeout(r, 2500));
  const v = document.querySelector('#videoMain .player video');
  return JSON.stringify({ chips: chips.length, switched: v.currentSrc !== first, onChip: chips[1].classList.contains('on'), playing: !v.paused, t: +v.currentTime.toFixed(2) });
})()`));

/* unavailable message: point a video at a broken url and confirm the message */
console.log('UNAVAILABLE TEST:', await evl(`(async () => {
  const v = document.querySelector('#videoMain .player video');
  if (!v) return 'no video';
  v.src = 'https://dmmotorgroup.com/assets/icon.svg';
  v.load();
  await new Promise((r) => setTimeout(r, 2500));
  const msg = document.querySelector('#videoMain .vid-none');
  return JSON.stringify({ message: msg ? msg.textContent.trim() : 'NO MESSAGE', photos: document.querySelectorAll('#videoMain img').length });
})()`));

ws.close(); chrome.kill(); process.exit(0);
