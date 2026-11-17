/* Viewport screenshots at specific scroll positions to inspect detail. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9382;
const BASE = 'http://127.0.0.1:8931';
const slug = process.argv[2] || 'plymouth-barracuda-1970';
const w = 390, h = 844;

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', `--window-size=${w},${h}`,
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.env.TEMP}\\lux-shot`, 'about:blank'], { stdio: 'ignore' });
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
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: `${BASE}/vehicles/${slug}` });
await evl(`(async()=>{const t0=Date.now();while(Date.now()-t0<20000){if(document.querySelectorAll('.dbanner').length>=5)break;await new Promise(r=>setTimeout(r,200));}return true;})()`);
await wait(2000);

const shots = [
  ['data/shot-m-banner.png', `document.querySelector('.db-spec').scrollIntoView(); window.scrollBy(0,-12); 'ok'`],
  ['data/shot-m-panel.png', `document.querySelector('.dv-market').scrollIntoView(); window.scrollBy(0,-30); 'ok'`],
  ['data/shot-m-keyfacts.png', `document.querySelector('.keyfacts').scrollIntoView({block:'center'}); 'ok'`],
];
let n = 0;
for (const [out, js] of shots) {
  await evl(js); await wait(500);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
  console.log('shot ->', out); n++;
}
console.log(n, 'shots taken');
ws.close(); chrome.kill(); process.exit(0);
