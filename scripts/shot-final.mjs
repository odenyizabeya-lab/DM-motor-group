/* Final visual proof: mobile and desktop vehicle pages with the video playing. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9385;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\shot2-prof', 'about:blank'], { stdio: 'ignore' });
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
const evl = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
await send('Page.enable'); await send('Runtime.enable');

for (const [w, h, mobile, slug, name] of [
  [390, 844, true, 'plymouth-barracuda-1970', 'proof-mobile-video-only.png'],
  [1440, 900, false, 'mercedes-amg-gle-53-coupe-2021', 'proof-desktop-video-only.png'],
]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/' + slug });
  await wait(9000);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('.tmp-shots/' + name, Buffer.from(s.data, 'base64'));
  console.log(name + ' saved | playing: ' + await evl(`(() => { const v = document.querySelector('#videoMain .player video'); return v ? (!v.paused) + ' t=' + v.currentTime.toFixed(1) : 'no video'; })()`));
}
ws.close(); chrome.kill(); process.exit(0);
