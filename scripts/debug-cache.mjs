/* dump all caches + keys after loading a framed vehicle page */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9427;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'dc-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __fail: (r.exceptionDetails.exception?.description || 'e').slice(0, 200) }; return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
const slug = process.argv[2] || 'plymouth-barracuda-1970';
await send('Page.navigate', { url: 'http://127.0.0.1:8931/vehicles/' + slug });
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 90000) { if (document.querySelector('#app .dbanner.db-hasframe')) return true; await new Promise(r => setTimeout(r, 250)); } return false; })()`);
await wait(1500);
const dump = await evl(`(async () => {
  const names = await caches.keys();
  const out = {};
  for (const n of names) {
    const c = await caches.open(n);
    const keys = (await c.keys()).map(k => k.url);
    out[n] = { count: keys.length, sample: keys.filter(u => u.includes('dmframes')).slice(0, 4) };
  }
  /* probe the frame cache directly: open + put + match + delete */
  const probe = {};
  try {
    const c = await caches.open('dm-frames-v1');
    probe.opened = true;
    try {
      const r = await c.put('/__dmframes/probe/1.jpg', new Response(new Blob(['abc'], { type: 'image/jpeg' }));
      const hit = await c.match('/__dmframes/probe/1.jpg');
      probe.put = 'ok';
      probe.match = hit ? 'ok size=' + (await hit.blob()).size : 'MISS';
      await c.delete('/__dmframes/probe/1.jpg');
      probe.afterDelete = (await c.keys()).length;
    } catch (e) { probe.putError = String(e && e.message || e); }
  } catch (e) { probe.openError = String(e && e.message || e); }
  out.probe = probe;
  return out;
})()`);
console.log(JSON.stringify(dump, null, 1));
process.exit(0);
