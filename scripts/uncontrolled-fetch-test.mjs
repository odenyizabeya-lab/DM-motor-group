/* Fetch the MP4 from an UNCONTROLLED page (example.com) to see if the
 * request itself is fine, bypassing our service worker entirely. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9354;
const MP4 = 'https://gevxgqdevaanmxqzverv.supabase.co/storage/v1/object/public/vehicle-media/v46/0912066fcfd5e3dac65c6bce5ca4ff43.mp4';
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\uncontrolled-prof',
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
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'error').slice(0, 200);
  return r.result && r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
/* example.com is NOT controlled by dmmotorgroup.com's service worker */
await send('Page.navigate', { url: 'https://example.com/' });
await wait(6000);

const probe = await evl(`(async () => {
  const out = { controlled: !!navigator.serviceWorker.controller };
  try {
    const r = await fetch(${JSON.stringify(MP4)}, { mode: 'no-cors' });
    out.noCorsFetch = 'OK status=' + r.status + ' type=' + r.type + ' ct=' + r.headers.get('content-type');
  } catch (e) { out.noCorsFetch = 'THREW ' + e.name + ': ' + e.message.slice(0, 90); }
  try {
    const r = await fetch(${JSON.stringify(MP4)}, { mode: 'cors' });
    out.corsFetch = 'OK status=' + r.status + ' ct=' + r.headers.get('content-type') + ' acao=' + r.headers.get('access-control-allow-origin');
  } catch (e) { out.corsFetch = 'THREW ' + e.name + ': ' + e.message.slice(0, 90); }
  try {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.src = ${JSON.stringify(MP4)};
    document.body.appendChild(v);
    await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('timeout')), 30000); v.onloadedmetadata = () => { clearTimeout(to); res(); }; v.onerror = () => { clearTimeout(to); rej(new Error('MediaError ' + (v.error ? v.error.code : '?'))); }; });
    out.videoMetadata = 'OK duration=' + v.duration + ' size=' + v.videoWidth + 'x' + v.videoHeight;
    await v.play();
    await new Promise((r) => setTimeout(r, 3000));
    out.videoPlay = 't=' + v.currentTime.toFixed(2) + ' err=' + (v.error ? v.error.code : null);
  } catch (e) { out.video = 'FAIL ' + String(e && e.message || e).slice(0, 90); }
  return JSON.stringify(out);
})()`);
console.log('UNCONTROLLED PAGE PROBE:', probe);
ws.close(); chrome.kill(); process.exit(0);
