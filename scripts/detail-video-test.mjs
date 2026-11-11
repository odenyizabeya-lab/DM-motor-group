/* Test the inline video player on multiple vehicle detail pages. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9344;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\detail-vid-prof',
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
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 120) });
  return r.result && r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');

/* find vehicles that have videos, from the live videos API */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles' });
await wait(9000);
const vids = await evl(`fetch('/api/videos?per=18').then((x) => x.json()).then((j) => JSON.stringify(j.items.slice(0, 6).map((v) => v.slug)))`);
const slugs = JSON.parse(vids);
console.log('testing detail pages for', slugs.length, 'vehicles:', slugs.join(', '));

let ok = 0;
for (const slug of slugs) {
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/' + slug });
  await wait(8000);
  const r = await evl(`(async () => {
    const out = { slug: ${JSON.stringify(slug)} };
    const box = document.querySelector('.vidbox[data-vid-id] video');
    if (!box) { out.fail = 'no inline video element'; return JSON.stringify(out); }
    try { await box.play(); } catch (e) { out.fail = 'play rejected: ' + String(e).slice(0, 60); return JSON.stringify(out); }
    await new Promise((r) => setTimeout(r, 3000));
    out.t = +box.currentTime.toFixed(2);
    out.d = box.duration ? +box.duration.toFixed(1) : 0;
    out.advanced = box.currentTime > 0.5;
    out.err = box.error ? box.error.code : null;
    out.w = box.videoWidth;
    return JSON.stringify(out);
  })()`);
  const o = JSON.parse(r);
  const pass = !o.fail && o.advanced && !o.err;
  if (pass) ok++;
  console.log((pass ? 'DETAIL PLAY OK  ' : 'DETAIL FAIL     ') + o.slug + ' t=' + (o.t || 0) + 's/' + (o.d || '?') + 's' + (o.fail ? ' | ' + o.fail : ''));
}
console.log('\nDETAIL RESULT: ' + ok + '/' + slugs.length + ' vehicle pages play their video inline.');
ws.close(); chrome.kill(); process.exit(ok === slugs.length ? 0 : 1);
