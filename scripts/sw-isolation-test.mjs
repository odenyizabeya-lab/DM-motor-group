/* Experiment: unregister SW -> reload home -> does playback work?
 * Then re-register and compare, to prove/disprove SW interference. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9349;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\sw-prof',
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

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await wait(9000);
const swState = await evl(`navigator.serviceWorker.getRegistrations().then((rs) => JSON.stringify(rs.map((r) => ({ scope: r.scope, active: !!r.active, script: r.active ? r.active.scriptURL : null }))))`);
console.log('SW REGISTRATIONS:', swState);

/* unregister + clear caches */
await evl(`navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))).then((x) => caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => JSON.stringify(x)))`);
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await wait(9000);
const noSwPlay = await evl(`(async () => {
  const hasSw = !!(await navigator.serviceWorker.getRegistrations()).length;
  document.querySelector('#railVideos .vidcard').click();
  await new Promise((r) => setTimeout(r, 2500));
  const v = document.querySelector('#modalPlayer video');
  if (!v) return JSON.stringify({ fail: 'no video', hasSw });
  try { await v.play(); } catch (e) { return JSON.stringify({ hasSw, reject: String(e && e.name || e) }); }
  await new Promise((r) => setTimeout(r, 3000));
  return JSON.stringify({ hasSw, paused: v.paused, t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null });
})()`);
console.log('HOME WITHOUT SW:', noSwPlay);
ws.close(); chrome.kill(); process.exit(0);
