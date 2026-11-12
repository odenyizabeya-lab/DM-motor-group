/* Probe SW cache primitives with cross-origin no-cors requests (what media
 * elements issue), plus fetch() behaviour. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9353;
const MP4 = 'https://gevxgqdevaanmxqzverv.supabase.co/storage/v1/object/public/vehicle-media/v46/0912066fcfd5e3dac65c6bce5ca4ff43.mp4';
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\cache-probe-prof',
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
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await wait(9000);

const probe = await evl(`(async () => {
  const out = {};
  const req = new Request(${JSON.stringify(MP4)}, { mode: 'no-cors', headers: { Range: 'bytes=0-1023' } });
  try {
    const hit = await caches.match(req);
    out.cacheMatch = hit ? ('HIT ' + hit.status) : 'MISS (no throw)';
  } catch (e) { out.cacheMatch = 'THREW ' + e.name + ': ' + e.message.slice(0, 80); }
  try {
    const r = await fetch(req);
    out.fetch = 'OK status=' + r.status + ' type=' + r.type + ' ct=' + r.headers.get('content-type');
  } catch (e) { out.fetch = 'THREW ' + e.name + ': ' + e.message.slice(0, 80); }
  const keys = await caches.keys();
  out.caches = keys;
  for (const k of keys) {
    const c = await caches.open(k);
    const reqs = await c.keys();
    out[k + '_entries'] = reqs.length;
    out[k + '_sample'] = reqs.slice(0, 6).map((r) => r.url.slice(-40));
  }
  return JSON.stringify(out);
})()`);
console.log('CACHE PRIMITIVE PROBE:', probe);
ws.close(); chrome.kill(); process.exit(0);
