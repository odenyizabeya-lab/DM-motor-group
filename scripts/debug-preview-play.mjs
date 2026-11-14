/* Probe why video previews are not autoplaying. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9376;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\prev-prof', 'about:blank'], { stdio: 'ignore' });
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
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 200) });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');

await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles' });
await wait(9000);
console.log('video count:', await evl(`document.querySelectorAll('video').length`));
console.log('first video state:', await evl(`(() => {
  const v = document.querySelector('video');
  if (!v) return 'none';
  const r = v.getBoundingClientRect();
  return JSON.stringify({ src: (v.currentSrc || v.src).slice(-28), paused: v.paused, muted: v.muted, readyState: v.readyState, networkState: v.networkState, err: v.error ? v.error.code : null, preload: v.preload, autoplay: v.autoplay, rect: { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }, bound: v.dataset.bound, autoplayFlag: v.dataset.autoplay });
})()`));
console.log('manual play attempt:', await evl(`(async () => {
  const v = document.querySelector('video');
  try { await v.play(); } catch (e) { return 'REJECTED: ' + (e && e.name) + ' ' + String(e.message).slice(0, 90); }
  await new Promise((r) => setTimeout(r, 2500));
  return JSON.stringify({ paused: v.paused, t: +v.currentTime.toFixed(2), err: v.error ? v.error.code : null, rs: v.readyState });
})()`));
console.log('observer present in page:', await evl(`typeof IntersectionObserver`));
console.log('play promise on 3 videos:', await evl(`(async () => {
  const out = [];
  for (const v of [...document.querySelectorAll('video')].slice(0, 3)) {
    try { await v.play(); out.push('ok'); } catch (e) { out.push(e.name); }
  }
  await new Promise((r) => setTimeout(r, 2000));
  return JSON.stringify({ results: out, states: [...document.querySelectorAll('video')].slice(0, 3).map((v) => ({ p: v.paused, t: +v.currentTime.toFixed(2), rs: v.readyState, ns: v.networkState, e: v.error ? v.error.code : null })) });
})()`));
ws.close(); chrome.kill(); process.exit(0);
