import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9509;
const BASE = 'http://127.0.0.1:8798';
const creds = JSON.parse(readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mcb-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 60 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EVAL: ' + String(r.exceptionDetails?.exception?.description || 'e').slice(0, 200); return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Page.navigate', { url: BASE + '/admin/' });
await wait(2500);
console.log('typeof api:', await evl('typeof api'));
console.log('loginForm onsubmit bound:', await evl('typeof (document.querySelector("#loginForm") || {}).onsubmit'));
console.log('api version markers:', await evl('typeof renderRoute + "," + typeof boot'));
/* submit the form and watch network */
await send('Network.enable');
await evl(`(() => { const f = document.querySelector('#loginForm'); f.querySelector('[name=email]').value = ${JSON.stringify(creds.email)}; f.querySelector('[name=password]').value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await wait(3500);
console.log('shell hidden after login:', await evl('document.querySelector("#shell") ? document.querySelector("#shell").hidden : "null"'));
console.log('loginErr:', JSON.stringify(await evl('(document.querySelector("#loginErr") || {}).textContent')));
console.log('whoami:', JSON.stringify(await evl('(document.querySelector("#whoami") || {}).textContent')));
process.exit(0);
