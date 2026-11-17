import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9433;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'dc4-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
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
/* navigate to the app shell — same context where vfGetFrames runs */
await send('Page.navigate', { url: 'http://127.0.0.1:8931/' });
await wait(3000);
for (const step of [
  `typeof caches`,
  `(async () => { try { const c = await caches.open('dm-frames-v1'); return 'open ok'; } catch (e) { return 'open ERR: ' + String(e && (e.message || e)); } })()`,
  `(async () => { try { const c = await caches.open('dm-frames-v1'); await c.put('/__dmframes/probe/1.jpg', new Response(new Blob(['abc'], { type: 'image/jpeg' }))); return 'put ok'; } catch (e) { return 'put ERR: ' + String(e && (e.message || e)); } })()`,
]) console.log(JSON.stringify(await evl(step)));
process.exit(0);
