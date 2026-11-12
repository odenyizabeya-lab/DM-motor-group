/* FINAL verification with the SW in control: fresh profile, navigate twice
 * (install + claim), confirm controller, then test:
 *  - manual video element on home
 *  - home rail modal click -> play
 *  - /videos modal click -> play
 *  - vehicle detail inline player -> play */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9355;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\final-sw-prof',
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

/* nav 1: install */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await wait(9000);
/* nav 2: controlled */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await wait(9000);

const ctl = await evl(`(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  return JSON.stringify({ controller: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null, regs: regs.map((r) => r.active ? r.active.scriptURL : r.scope) });
})()`);
console.log('SW STATE:', ctl);

const MANUAL = `(async () => {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = 'https://gevxgqdevaanmxqzverv.supabase.co/storage/v1/object/public/vehicle-media/v46/0912066fcfd5e3dac65c6bce5ca4ff43.mp4';
  document.body.appendChild(v);
  try {
    await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('metadata timeout')), 30000); v.onloadedmetadata = () => { clearTimeout(to); res(); }; v.onerror = () => { clearTimeout(to); rej(new Error('MediaError ' + (v.error ? v.error.code : '?'))); }; });
    await v.play();
    await new Promise((r) => setTimeout(r, 3000));
    const out = { t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null };
    v.remove();
    return JSON.stringify(out);
  } catch (e) { return JSON.stringify({ fail: String(e && e.message || e).slice(0, 80) }); }
})()`;

console.log('HOME MANUAL ELEMENT (SW controlled):', await evl(MANUAL));

/* home rail modal click */
const homeModal = await evl(`(async () => {
  document.querySelector('#railVideos .vidcard').click();
  await new Promise((r) => setTimeout(r, 2500));
  const v = document.querySelector('#modalPlayer video');
  if (!v) return JSON.stringify({ fail: 'no modal player' });
  try { await v.play(); } catch (e) { return JSON.stringify({ reject: String(e && e.name || e) }); }
  await new Promise((r) => setTimeout(r, 3000));
  const out = { t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null };
  document.querySelector('#modal .x') && document.querySelector('#modal .x').click();
  return JSON.stringify(out);
})()`);
console.log('HOME RAIL MODAL (SW controlled):', homeModal);

/* /videos modal */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/videos' });
await wait(9000);
const vidModal = await evl(`(async () => {
  document.querySelector('.vidcard').click();
  await new Promise((r) => setTimeout(r, 2500));
  const v = document.querySelector('#modalPlayer video');
  if (!v) return JSON.stringify({ fail: 'no modal player' });
  try { await v.play(); } catch (e) { return JSON.stringify({ reject: String(e && e.name || e) }); }
  await new Promise((r) => setTimeout(r, 3000));
  const out = { t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null };
  document.querySelector('#modal .x') && document.querySelector('#modal .x').click();
  return JSON.stringify(out);
})()`);
console.log('/videos MODAL (SW controlled):', vidModal);

/* vehicle detail inline player */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
await wait(9000);
const detail = await evl(`(async () => {
  const v = document.querySelector('.vidbox video');
  if (!v) return JSON.stringify({ fail: 'no inline video' });
  try { await v.play(); } catch (e) { return JSON.stringify({ reject: String(e && e.name || e) }); }
  await new Promise((r) => setTimeout(r, 3000));
  return JSON.stringify({ t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null });
})()`);
console.log('VEHICLE DETAIL PLAYER (SW controlled):', detail);

ws.close(); chrome.kill(); process.exit(0);
