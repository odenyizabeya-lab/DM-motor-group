/* live check: one vehicle page on production gets decorated (client fallback) */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9447;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--window-size=1440,960',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'lv-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push(m.params.entry.text.slice(0, 150)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __fail: 1 }; return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/rolls-royce-cullinan-2025' });
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 25000) { if (document.querySelector('#videoMain video')) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()`);
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 90000) { if (document.querySelector('#app .dbanner.db-hasframe')) return true; await new Promise(r => setTimeout(r, 250)); } return false; })()`);
const r = await evl(`(() => ({ framed: document.querySelectorAll('#app .dbanner.db-hasframe').length, panels: document.querySelectorAll('#app .d-sec.hasframe').length, video: !!document.querySelector('#videoMain video'), vf: window.__vfLast || null }))()`);
console.log(JSON.stringify(r)); console.log('console errors:', errs.length, errs[0] || '');
process.exit(0);
