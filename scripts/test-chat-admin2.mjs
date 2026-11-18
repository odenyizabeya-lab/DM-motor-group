import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9503;
const BASE = process.env.BASE || 'http://127.0.0.1:8798';
const creds = JSON.parse(readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mc-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
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
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.error) return { __error: 'send' }; const d = r.result || {}; if (d.exceptionDetails) return { __error: String((d.exceptionDetails.exception?.description || 'e').slice(0, 180)) }; return d.result && d.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

/* create probe */
const env = {};
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, ''); }
const SBURL = env.SUPABASE_URL, SVC = env.SUPABASE_SERVICE_KEY;
const create = await fetch(SBURL + '/rest/v1/ai_conversations', {
  method: 'POST', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC, 'content-type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ channel: 'web', customer_email: 'finalcheck@example.com', customer_name: 'Final Check', subject: 'messaging verification probe', status: 'open' }),
}).then((r) => r.json());
const probe = Array.isArray(create) ? create[0] : create;
const convId = probe && probe.id;
console.log('probe conversation:', convId);
await fetch(SBURL + '/rest/v1/ai_messages', {
  method: 'POST', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC, 'content-type': 'application/json' },
  body: JSON.stringify({ conversation_id: convId, direction: 'inbound', channel: 'web', body_text: 'Verification probe: please confirm delivery arrangements.', status: 'received' }),
});

/* login + open messages page */
await send('Page.navigate', { url: BASE + '/admin/' });
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { if (typeof api === 'function') return true; await new Promise(r => setTimeout(r, 100)); } return false; })()`);
await evl(`(() => { const f = document.querySelector('#loginForm'); f.querySelector('[name=email]').value = ${JSON.stringify(creds.email)}; f.querySelector('[name=password]').value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
const loginPoll = await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { if (!document.querySelector('#shell').hidden) return { ok: true, shellHidden: false, hash: location.hash }; await new Promise(r => setTimeout(r, 200)); } return { ok: false, shellHidden: true, hash: location.hash, loginErr: (document.querySelector('#loginErr') || {}).textContent }; })()`);
console.log('login poll:', JSON.stringify(loginPoll));
await wait(1200);
await evl(`location.hash = '#/messages';`);
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 60000) { if ((document.querySelector('.crumb') || {}).textContent === 'People' || document.querySelectorAll('#pg .enq-card').length > 0) return true; await new Promise(r => setTimeout(r, 250)); } return false; })()`);
const page = await evl(`(() => ({ cards: document.querySelectorAll('#pg .enq-card').length, hasProbe: (document.querySelector('#pg') || {}).innerText.includes('Final Check'), crumb: (document.querySelector('.crumb') || {}).textContent, err: (document.querySelector('#pg') || {}).innerText.replace(/\\s+/g, ' ').slice(0, 400) }))()`);
console.log('messages page:', JSON.stringify(page));

/* open the thread */
await evl(`$$('.enq-card').find((c) => c.dataset.id === '${convId}') && $$('.enq-card').find((c) => c.dataset.id === '${convId}').click()`);
await wait(2000);
const thread = await evl(`(() => ({ text: (document.querySelector('.msg-thread') || {}).innerText.replace(/\\s+/g, ' ').slice(0, 220), reply: !!document.querySelector('#adminReply'), takeover: !!document.querySelector('#takeoverBtn') }))()`);
console.log('thread:', JSON.stringify(thread));

/* reply */
await evl(`(() => { const t = document.querySelector('#adminReply'); if (t) t.value = 'We will confirm delivery arrangements in writing within one business day.'; return true; })()`);
await evl(`document.querySelector('#replyBtn') && document.querySelector('#replyBtn').click()`);
await wait(2000);

/* reopen and toggle important + takeover */
await evl(`location.hash = '#/messages';`);
await wait(1800);
await evl(`$$('.enq-card').find((c) => c.dataset.id === '${convId}') && $$('.enq-card').find((c) => c.dataset.id === '${convId}').click()`);
await wait(1800);
await evl(`document.querySelector('#importantBtn') && document.querySelector('#importantBtn').click()`);
await wait(1500);

/* close the thread, then check DB */
await evl(`location.hash = '#/messages';`);
await wait(1800);
await evl(`$$('.enq-card').find((c) => c.dataset.id === '${convId}') && $$('.enq-card').find((c) => c.dataset.id === '${convId}').click()`);
await wait(1800);
const importantLabel = await evl(`document.querySelector('#importantBtn') ? document.querySelector('#importantBtn').textContent.trim() : 'gone'`);
console.log('important button after click:', importantLabel);

/* DB verification */
const verify = await fetch(SBURL + '/rest/v1/ai_conversations?id=eq.' + convId + '&select=status,human_takeover,important,message_count,customer_email', { headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } }).then((r) => r.json());
console.log('db:', JSON.stringify(verify[0] || {}));
const msgs = await fetch(SBURL + '/rest/v1/ai_messages?conversation_id=eq.' + convId + '&select=direction,body_text,status&order=id', { headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } }).then((r) => r.json());
console.log('messages:', msgs.map((m) => m.direction + ':' + m.status + ':' + m.body_text.slice(0, 40)).join(' | '));

/* cleanup */
await fetch(SBURL + '/rest/v1/ai_messages?conversation_id=eq.' + convId, { method: 'DELETE', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } });
await fetch(SBURL + '/rest/v1/ai_conversations?id=eq.' + convId, { method: 'DELETE', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } });
console.log('probe cleaned');
console.log('errors:', errs.length, errs[0] || '');
process.exit(0);
