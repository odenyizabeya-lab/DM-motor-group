import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9501;
const BASE = process.env.BASE || 'http://127.0.0.1:8798';
const creds = JSON.parse(readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'dbg3-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 60 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evlRaw = async (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
console.log('raw readyState response:', JSON.stringify(await evlRaw('document.readyState')));
await send('Page.enable'); await send('Runtime.enable');

/* create probe */
const env = {};
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, ''); }
const SBURL = env.SUPABASE_URL, SVC = env.SUPABASE_SERVICE_KEY;
const create = await fetch(SBURL + '/rest/v1/ai_conversations', {
  method: 'POST', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC, 'content-type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ channel: 'web', customer_email: 'dbg@example.com', customer_name: 'Debug Buyer', subject: 'debug probe', status: 'open' }),
}).then((r) => r.json());
const probe = Array.isArray(create) ? create[0] : create;
console.log('probe id:', probe && probe.id);

await send('Page.navigate', { url: BASE + '/admin/' });
await wait(2000);
console.log('readyState:', await evl('document.readyState'));
console.log('title:', await evl('document.title'));
console.log('loginForm exists:', await evl('!!document.querySelector("#loginForm")'));
console.log('shell exists:', await evl('!!document.querySelector("#shell")'));
console.log('shell hidden prop:', await evl('document.querySelector("#shell") ? document.querySelector("#shell").hidden : "no element"'));
console.log('nav links:', await evl('[...document.querySelectorAll("#sidebar nav a")].map(a => a.getAttribute("href")).join(",")'));
await evl(`(() => { const f = document.querySelector('#loginForm'); if (!f) return 'no form'; f.querySelector('[name=email]').value = ${JSON.stringify(creds.email)}; f.querySelector('[name=password]').value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await wait(4000);
console.log('after login — shell hidden:', await evl('document.querySelector("#shell") ? document.querySelector("#shell").hidden : "no element"'));
console.log('after login — pg crumb:', JSON.stringify(await evl(`(document.querySelector('.crumb') || {}).textContent`)));
await evl(`location.hash = '#/messages'; renderRoute();`);
await wait(3000);
console.log('shell hidden:', await evl('document.querySelector("#shell").hidden'));
console.log('pg crumb:', JSON.stringify(await evl(`(document.querySelector('.crumb') || {}).textContent`)));
console.log('pg html slice:', JSON.stringify(await evl(`(document.querySelector('#pg') || {}).innerHTML.slice(0, 400)`)));
console.log('cards:', await evl(`document.querySelectorAll('.enq-card').length`));
process.exit(0);
