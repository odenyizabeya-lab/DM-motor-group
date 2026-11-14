/* Load-speed and stability measurement for the video-only showroom. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9384;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\perf-prof', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return JSON.stringify({ fail: 'eval error' });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

for (const url of ['https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970', 'https://dmmotorgroup.com/', 'https://dmmotorgroup.com/videos']) {
  await send('Page.navigate', { url });
  const t0 = Date.now();
  await wait(1000);
  /* wait until the main video (or first preview) is actually playing */
  const playable = await evl(`(async () => {
    const start = Date.now();
    const v = document.querySelector('#videoMain .player video') || document.querySelector('video');
    if (!v) return { ok: false, ms: Date.now() - start, reason: 'no video element' };
    while (Date.now() - start < 12000) {
      if (!v.paused && v.currentTime > 0.05) return { ok: true, ms: Date.now() - start };
      await new Promise((r) => setTimeout(r, 150));
    }
    return { ok: false, ms: Date.now() - start, readyState: v.readyState, err: v.error ? v.error.code : null };
  })()`);
  const perf = await evl(`(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource');
    const total = res.reduce((a, r) => a + (r.transferSize || 0), 0);
    const videos = res.filter((r) => r.initiatorType === 'video' || /\.mp4/.test(r.name));
    return JSON.stringify({
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      resources: res.length,
      transferKB: Math.round(total / 1024),
      videoRequests: videos.length,
      videoKB: Math.round(videos.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024),
      images: res.filter((r) => r.initiatorType === 'img').length,
    });
  })()`);
  console.log(url.replace('https://dmmotorgroup.com', '') + ' -> playable in ' + playable.ms + 'ms | ' + perf);
}
ws.close(); chrome.kill(); process.exit(0);
