import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9467;
const BASE = 'http://127.0.0.1:8798';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1280,900',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'dbg2-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded') errs.push('[' + m.params.entry.level + '] ' + m.params.entry.text.slice(0, 200));
  if (m.method === 'Runtime.exceptionThrown') errs.push('[exception] ' + String(m.params.exceptionDetails?.exception?.description || '').slice(0, 240));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('[console] ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 240)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EVALERR ' + (r.exceptionDetails.exception?.description || '').slice(0, 150); return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
const slug = (await fetch(BASE + '/api/vehicles?per=1&sort=newest').then((r) => r.json())).items[0].slug;
console.log('slug:', slug);
await send('Page.navigate', { url: BASE + '/vehicles/' + slug });
await wait(6000);
console.log('body text:', JSON.stringify((await evl(`(document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400)`))));
console.log('app html len:', JSON.stringify(await evl(`(document.querySelector('#app') || {}).innerHTML ? document.querySelector('#app').innerHTML.length : 'none'`)));
console.log('sw regs:', JSON.stringify(await evl(`navigator.serviceWorker.getRegistrations().then(rs => rs.map(r => r.active && r.active.scriptURL))`)));
console.log('sw state:', JSON.stringify(await evl(`({ sw: 'serviceWorker' in navigator, controller: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null })`)));
console.log('errors:', errs.length ? errs.slice(0, 10).join('\n') : '(none)');
process.exit(0);
