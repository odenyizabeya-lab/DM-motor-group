import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9439;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'dc7-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __fail: (r.exceptionDetails.exception?.description || 'e').slice(0, 300) }; return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8931/vehicles/plymouth-barracuda-1970' });
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 90000) { if (document.querySelector('#app .dbanner.db-hasframe')) return true; await new Promise(r => setTimeout(r, 250)); } return false; })()`);
await wait(1000);
console.log(JSON.stringify(await evl(`(async () => {
  const key = (await vfCacheKeys())[0];
  const blobs = await vfCacheGet(key);
  const info = { key, isArray: Array.isArray(blobs), n: blobs ? blobs.length : 0 };
  if (blobs && blobs.length) {
    const b = blobs[0];
    info.type = b.constructor.name; info.size = b.size; info.mime = b.type;
    try { const bmp = await createImageBitmap(b); info.bmp = bmp.width + 'x' + bmp.height; }
    catch (e) { info.bmpErr = String(e && (e.name + '::' + e.message)); }
  }
  return info;
})()`), null, 1));
process.exit(0);
