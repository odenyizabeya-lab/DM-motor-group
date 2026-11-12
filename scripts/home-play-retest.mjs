/* Re-test home rail playback carefully: play, pause, then play again. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9347;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\home-play-prof',
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
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await wait(9000);

/* open modal via real click */
await evl(`document.querySelector('#railVideos .vidcard').click(); true`);
await wait(3000);
for (let attempt = 1; attempt <= 3; attempt++) {
  const r = await evl(`(async () => {
    const v = document.querySelector('#modalPlayer video');
    if (!v) return JSON.stringify({ fail: 'no video' });
    try { v.pause(); v.load(); await v.play(); } catch (e) { return JSON.stringify({ attempt: ${attempt}, reject: String(e && e.name || e) }); }
    await new Promise((r) => setTimeout(r, 3500));
    return JSON.stringify({ attempt: ${attempt}, paused: v.paused, t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null, w: v.videoWidth, h: v.videoHeight });
  })()`);
  console.log('attempt ' + attempt + ':', r);
}
/* also check the next 3 cards in the rail */
for (const idx of [1, 2, 3]) {
  const r = await evl(`(async () => {
    const cards = document.querySelectorAll('#railVideos .vidcard');
    document.querySelector('#modal .x') && document.querySelector('#modal .x').click();
    await new Promise((r) => setTimeout(r, 600));
    cards[${idx}].click();
    await new Promise((r) => setTimeout(r, 2200));
    const v = document.querySelector('#modalPlayer video');
    if (!v) return JSON.stringify({ fail: 'no video', idx: ${idx} });
    try { await v.play(); } catch (e) { return JSON.stringify({ idx: ${idx}, reject: String(e && e.name || e) }); }
    await new Promise((r) => setTimeout(r, 3000));
    return JSON.stringify({ idx: ${idx}, t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null });
  })()`);
  console.log('rail card ' + idx + ':', r);
}
ws.close(); chrome.kill(); process.exit(0);
