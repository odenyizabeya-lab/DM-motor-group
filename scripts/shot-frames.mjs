/* screenshot the framed banners + prose panel on a vehicle page */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9441;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1440,960', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sh-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8931/vehicles/plymouth-barracuda-1970' });
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 120000) { if (document.querySelector('#app .dbanner.db-hasframe')) return true; await new Promise(r => setTimeout(r, 250)); } return false; })()`);
await wait(1500);
const shots = [
  ['data/frames-spec-banner.png', `document.querySelectorAll('#app .dbanner')[0].scrollIntoView({block:'center'})`],
  ['data/frames-equip-banner.png', `document.querySelectorAll('#app .dbanner')[3].scrollIntoView({block:'center'})`],
  ['data/frames-prose-panel.png', `(document.querySelector('#app .d-sec.dv-interior') || document.querySelector('#app .d-sec.dv-condition')).scrollIntoView({block:'center'})`],
];
for (const [name, js] of shots) { await evl(js); await wait(900); const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(name, Buffer.from(s.data, 'base64')); console.log('shot ->', name); }
process.exit(0);
