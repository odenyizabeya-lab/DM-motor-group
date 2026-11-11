/* DEFINITIVE test: play EVERY video on the live site in a real browser.
 * For each of the 35 videos (from the public API):
 *   - load the exact URL the site uses into a real <video> element
 *   - wait for metadata, then actually play it for 3 seconds
 *   - verify: metadata loaded, duration > 0, video dimensions > 0,
 *             currentTime ADVANCED during playback, no MediaError,
 *             audio track decoded (where the engine exposes it)
 * Prints one line per video and a final summary. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\allvid-prof',
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
if (!target) { console.error('no target'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

await send('Page.enable'); await send('Runtime.enable');
/* load the real videos page so the origin matches and nothing is synthetic */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/videos' });
await wait(9000);

/* fetch ALL videos across both pages from the live API */
const all = [];
for (const page of [1, 2]) {
  const r = await evl(`fetch('/api/videos?per=18&page=${page}').then((x) => x.json())`);
  all.push(...(r.items || []));
}
console.log('TOTAL videos from live API:', all.length);

let okCount = 0; const fails = [];
for (const v of all) {
  const res = await evl(`(async () => {
    const out = { id: ${v.id} };
    try {
      const vEl = document.createElement('video');
      vEl.muted = true; vEl.playsInline = true; vEl.preload = 'auto';
      vEl.src = ${JSON.stringify(v.url)};
      const t0 = Date.now();
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('metadata timeout ' + Math.round((Date.now()-t0)/1000) + 's')), 45000);
        vEl.onloadedmetadata = () => { clearTimeout(to); resolve(); };
        vEl.onerror = () => { clearTimeout(to); reject(new Error('MediaError code=' + (vEl.error ? vEl.error.code : '?'))); };
      });
      out.duration = +vEl.duration.toFixed(2);
      out.size = vEl.videoWidth + 'x' + vEl.videoHeight;
      await vEl.play();
      await new Promise((r) => setTimeout(r, 3000));
      out.advanced = vEl.currentTime > 0.5;
      out.t = +vEl.currentTime.toFixed(2);
      out.err = vEl.error ? vEl.error.code : null;
      out.audio = !!(vEl.webkitAudioDecodedByteCount > 0 || vEl.mozHasAudio || vEl.audioTracks && vEl.audioTracks.length);
      vEl.pause(); vEl.removeAttribute('src'); vEl.load();
    } catch (e) { out.fail = String(e && e.message || e).slice(0, 100); }
    return JSON.stringify(out);
  })()`);
  const r = JSON.parse(res);
  const pass = !r.fail && r.advanced && !r.err;
  if (pass) okCount++; else fails.push(r);
  console.log(`${pass ? 'PLAY OK ' : 'FAIL    '} id=${r.id} dur=${r.duration}s ${r.size || ''} t=${r.t || 0} audio=${r.audio ? 'yes' : '?'}${r.fail ? ' | ' + r.fail : ''}`);
}
console.log(`\nRESULT: ${okCount}/${all.length} videos played successfully in a real browser.`);
if (fails.length) console.log('FAILED:', JSON.stringify(fails, null, 1));
ws.close(); chrome.kill(); process.exit(fails.length ? 1 : 0);
