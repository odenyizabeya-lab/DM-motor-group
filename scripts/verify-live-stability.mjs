/* live production smoke: home + 3 vehicle pages + System Health endpoint chain */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9481;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'lv2-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
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
for (const path of ['/', '/vehicles/plymouth-barracuda-1970', '/vehicles/mercedes-maybach-gls-600-2022', '/vehicles/rolls-royce-cullinan-2025']) {
  errs.length = 0;
  await send('Page.navigate', { url: 'https://dmmotorgroup.com' + path });
  await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 20000) { if (document.querySelector('#app') && document.querySelector('#app').children.length > 3) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()`);
  await wait(1500);
  const r = await evl(`(() => ({ title: document.title.slice(0, 70), video: !!document.querySelector('#videoMain video'), errs: ${'0'} }))()`);
  console.log(path.padEnd(42), 'title=' + (r && r.title) + ' video=' + (r && r.video) + ' consoleErrors=' + errs.length, errs[0] || '');
}
const health = await fetch('https://dmmotorgroup.com/api/health').then((r) => r.json());
console.log('health:', 'ok=' + health.ok, 'dbMs=' + health.db.ms, 'storageMs=' + health.storage.ms);
process.exit(0);
