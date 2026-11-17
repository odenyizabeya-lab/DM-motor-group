/* capture exact console/log errors on a vehicle page */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9443;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'err-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded') console.log('[' + m.params.entry.level + ']', m.params.entry.text.slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.log('[console]', (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 300));
  if (m.method === 'Runtime.exceptionThrown') console.log('[exception]', JSON.stringify(m.params.exceptionDetails && m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails).slice(0, 300));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
for (const slug of process.argv.slice(2)) {
  console.log('=== ' + slug);
  await send('Page.navigate', { url: 'http://127.0.0.1:8931/vehicles/' + slug });
  await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 25000) { if (document.querySelector('#videoMain video')) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()`);
  await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 90000) { if (document.querySelector('#app .dbanner.db-hasframe') || !document.querySelector('#videoMain video')) return true; await new Promise(r => setTimeout(r, 300)); } return false; })()`);
  await wait(2500);
}
process.exit(0);
