import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9425;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'dbg-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push(m.params.entry.text.slice(0, 200)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __fail: (r.exceptionDetails.exception?.description || 'eval').slice(0, 300) };
  return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8931/' });
await wait(2000);
/* run the real extraction against a REAL vehicle video, step by step */
const out = await evl(`(async () => {
  const steps = {};
  try {
    const inv = await fetch('/api/vehicles?per=1&sort=newest').then(r => r.json());
    const url = inv.items[0].mainVideo;
    steps.url = url.slice(0, 80);
    const vid = document.createElement('video');
    vid.crossOrigin = 'anonymous'; vid.muted = true; vid.preload = 'auto';
    vid.src = url;
    await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('load timeout')), 20000); vid.onloadedmetadata = () => { clearTimeout(to); res(); }; vid.onerror = () => { clearTimeout(to); rej(new Error('video onerror — ' + (vid.error && vid.error.code))); }; });
    steps.metadata = { dur: vid.duration, w: vid.videoWidth, h: vid.videoHeight };
    vid.currentTime = Math.min(2, vid.duration * 0.3);
    await new Promise((res) => { vid.onseeked = res; setTimeout(res, 5000); });
    await new Promise(r => setTimeout(r, 300));
    const c = document.createElement('canvas');
    c.width = 640; c.height = Math.round(640 * vid.videoHeight / vid.videoWidth);
    const ctx = c.getContext('2d');
    ctx.drawImage(vid, 0, 0, c.width, c.height);
    steps.drawn = true;
    try { const d = ctx.getImageData(0, 0, 8, 8); steps.readPixels = 'ok len=' + d.data.length; }
    catch (e) { steps.readPixels = 'TAINTED: ' + e.message; }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
    steps.blob = blob ? blob.size + ' bytes' : 'null';
    return steps;
  } catch (e) { return { ...steps, error: String(e && e.message || e) }; }
})()`);
console.log(JSON.stringify(out, null, 1));
console.log('console errors:', errs.length, errs.slice(0, 3));
process.exit(0);
