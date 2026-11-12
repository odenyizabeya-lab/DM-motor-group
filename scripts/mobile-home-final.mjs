/* Mobile 375px final test: SW-controlled (2 navs), home rail position,
 * thumbs, modal playback + screenshot. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9356;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\mobile-final-prof',
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

const ctl = await evl(`navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : 'none'`);
console.log('MOBILE SW:', ctl);

const pos = await evl(`(() => {
  const sec = document.querySelector('#secVideos');
  const order = [...document.querySelectorAll('section.section')].map((s) => s.id).slice(0, 4);
  return JSON.stringify({ railTop: Math.round(sec.getBoundingClientRect().top + scrollY), viewportH: innerHeight, sections: order });
})()`);
console.log('MOBILE SECTION ORDER/POSITION:', pos);

await evl(`document.querySelector('#secVideos').scrollIntoView({block:'center'}); true`);
await wait(1500);
await evl(`(async () => { const rail = document.querySelector('#railVideos'); for (let x = 0; x <= rail.scrollWidth; x += 300) { rail.scrollLeft = x; await new Promise((r) => setTimeout(r, 350)); } rail.scrollLeft = 0; return true; })()`);
await wait(3000);
const thumbs = await evl(`(() => { const imgs = [...document.querySelectorAll('#railVideos img')]; return JSON.stringify({ total: imgs.length, ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length }); })()`);
console.log('MOBILE RAIL THUMBS:', thumbs);

await evl(`window.scrollTo(0,0); document.querySelector('#railVideos .vidcard').click(); true`);
await wait(2500);
const play = await evl(`(async () => {
  const v = document.querySelector('#modalPlayer video');
  if (!v) return JSON.stringify({ fail: 'no player' });
  try { await v.play(); } catch (e) { return JSON.stringify({ reject: String(e && e.name || e) }); }
  await new Promise((r) => setTimeout(r, 4000));
  return JSON.stringify({ paused: v.paused, t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null });
})()`);
console.log('MOBILE PLAYBACK:', play);
const s = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('.tmp-shots/proof-mobile-home-fixed.png', Buffer.from(s.data, 'base64'));
console.log('screenshot saved: .tmp-shots/proof-mobile-home-fixed.png');
ws.close(); chrome.kill(); process.exit(0);
