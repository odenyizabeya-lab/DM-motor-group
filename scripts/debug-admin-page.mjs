import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9453;
const BASE = 'http://127.0.0.1:8931';
const creds = JSON.parse(readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1440,960',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ay-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded') logs.push('[' + m.params.entry.level + '] ' + m.params.entry.text.slice(0, 150));
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + JSON.stringify(m.params.exceptionDetails && m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || '').slice(0, 300)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EVALERR: ' + (r.exceptionDetails.exception?.description || '').slice(0, 200); return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Page.navigate', { url: BASE + '/admin' });
await wait(1500);
console.log('after load:', JSON.stringify(await evl(`({ shellHidden: document.querySelector('#shell').hidden, loginVisible: !document.querySelector('#loginScreen').hidden, err: document.querySelector('#loginErr') && document.querySelector('#loginErr').textContent })`)));
await evl(`(() => { const f = document.querySelector('#loginForm'); f.querySelector('[name=email]').value = ${JSON.stringify(creds.email)}; f.querySelector('[name=password]').value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await wait(4000);
console.log('after login:', JSON.stringify(await evl(`({ shellHidden: document.querySelector('#shell').hidden, hash: location.hash, pg: (document.querySelector('#pg') || {}).innerHTML ? document.querySelector('#pg').innerHTML.slice(0, 80) : '', whoami: (document.querySelector('#whoami') || {}).textContent })`)));
await evl(`location.hash = '#/youtube';`);
await wait(1500);
console.log('pg after hash nav:', JSON.stringify(await evl(`(document.querySelector('#pg') || {}).innerHTML ? document.querySelector('#pg').innerHTML.slice(0, 200) : 'EMPTY'`)));
console.log('logs:', logs.slice(0, 8).join('\n') || '(none)');
process.exit(0);
