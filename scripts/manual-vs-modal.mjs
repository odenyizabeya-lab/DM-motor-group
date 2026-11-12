/* Discriminate: manual <video> element (no click/modal) on home vs /videos.
 * Then click-created modal element comparison. Same browser profile. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9352;
const URL_V = 'https://gevxgqdevaanmxqzverv.supabase.co/storage/v1/object/public/vehicle-media/v46/0912066fcfd5e3dac65c6bce5ca4ff43.mp4';
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\manual-prof',
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

const MANUAL = `(async () => {
  const out = {};
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = ${JSON.stringify(URL_V)};
  document.body.appendChild(v);
  try {
    await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('metadata timeout')), 30000); v.onloadedmetadata = () => { clearTimeout(to); res(); }; v.onerror = () => { clearTimeout(to); rej(new Error('MediaError ' + (v.error ? v.error.code : '?'))); }; });
    out.duration = +v.duration.toFixed(2); out.size = v.videoWidth + 'x' + v.videoHeight;
    await v.play();
    await new Promise((r) => setTimeout(r, 3000));
    out.t = +v.currentTime.toFixed(2); out.err = v.error ? v.error.code : null;
    v.remove();
  } catch (e) { out.fail = String(e && e.message || e).slice(0, 100); }
  return JSON.stringify(out);
})()`;

for (const [page, label] of [['https://dmmotorgroup.com/', 'HOME'], ['https://dmmotorgroup.com/videos', 'VIDEOS']]) {
  await send('Page.navigate', { url: page });
  await wait(9000);
  console.log(label + ' MANUAL ELEMENT:', await evl(MANUAL));
  /* and the modal path */
  const modal = await evl(page.endsWith('/videos') ? `(async () => {
    document.querySelector('.vidcard').click();
    await new Promise((r) => setTimeout(r, 2500));
    const v = document.querySelector('#modalPlayer video');
    try { await v.play(); } catch (e) { return JSON.stringify({ reject: String(e && e.name || e) }); }
    await new Promise((r) => setTimeout(r, 3000));
    return JSON.stringify({ t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null });
  })()` : `(async () => {
    document.querySelector('#railVideos .vidcard').click();
    await new Promise((r) => setTimeout(r, 2500));
    const v = document.querySelector('#modalPlayer video');
    try { await v.play(); } catch (e) { return JSON.stringify({ reject: String(e && e.name || e) }); }
    await new Promise((r) => setTimeout(r, 3000));
    return JSON.stringify({ t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null });
  })()`);
  console.log(label + ' MODAL PATH:', modal);
}
ws.close(); chrome.kill(); process.exit(0);
