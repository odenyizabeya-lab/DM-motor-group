import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9489;
const BASE = 'http://127.0.0.1:8798';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cd-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 60 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded') errs.push('[' + m.params.entry.level + '] ' + (m.params.entry.text || '').slice(0, 200));
  if (m.method === 'Runtime.exceptionThrown') errs.push('[exception] ' + String((m.params.exceptionDetails || {}).exception?.description || '').slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('[console] ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 300)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.error) return 'send-err'; const d = r.result || {}; if (d.exceptionDetails) return 'EVAL: ' + String((d.exceptionDetails.exception || {}).description || '').slice(0, 250); return d.result && d.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
const slug = (await fetch(BASE + '/api/vehicles?per=1&sort=newest').then((r) => r.json())).items[0].slug;
await send('Page.navigate', { url: `${BASE}/vehicles/${slug}` });
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 40000) { if (document.querySelector('#btnChatVehicle')) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()`);
await wait(800);
await evl(`document.querySelector('#btnChatVehicle').click()`);
await wait(3000);
console.log('opened:', await evl(`document.querySelector('#chatRoom').classList.contains('open')`));
console.log('convId:', await evl(`window.chatState ? window.chatState.conversationId : (typeof chatState !== 'undefined' ? chatState.conversationId : 'n/a')`));
await evl(`(() => { const ta = document.querySelector('#chatText'); ta.value = 'stub test from CDP'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#chatComposer').requestSubmit(); return true; })()`);
await wait(9000);
console.log('body text:', JSON.stringify((await evl(`(document.querySelector('#chatBody') || {}).innerText.replace(/\\s+/g, ' ').slice(0, 400)`))));
console.log('errors:', errs.length ? errs.join('\n') : '(none)');
process.exit(0);
