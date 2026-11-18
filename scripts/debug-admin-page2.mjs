import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9505;
const BASE = process.env.BASE || 'http://127.0.0.1:8798';
const creds = JSON.parse(readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mcx-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 60 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push((m.params.entry.text || '').slice(0, 160));
  if (m.method === 'Runtime.exceptionThrown') errs.push('uncaught: ' + String((m.params.exceptionDetails || {}).exception?.description || '').slice(0, 300)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __fail: String((r.exceptionDetails.exception?.description || 'e').slice(0, 200)) }; return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

await send('Page.navigate', { url: BASE + '/admin/' });
await wait(1200);
await evl(`(() => { const f = document.querySelector('#loginForm'); f.querySelector('[name=email]').value = ${JSON.stringify(creds.email)}; f.querySelector('[name=password]').value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await wait(3200);
console.log('after login shellHidden:', await evl('document.querySelector("#shell").hidden'));
await evl(`location.hash = '#/messages'; renderRoute();`);
await wait(2500);
console.log('crumb:', await evl(`(document.querySelector('.crumb') || {}).textContent`));
console.log('pg innerHTML (first 800):', await evl(`(document.querySelector('#pg') || {}).innerHTML.slice(0, 800)`));
console.log('errors:', errs.length ? errs.join('\n') : '(none)');
process.exit(0);
