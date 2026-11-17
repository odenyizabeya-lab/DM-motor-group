/* smoke: main routes on local preview — console errors + hscroll */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9415, BASE = 'http://127.0.0.1:8931';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1280,900',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sm-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push(m.params.entry.text.slice(0, 120)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
for (const path of ['/vehicles', '/videos', '/contact', '/about', '/account', '/compare', '/favourites']) {
  errs.length = 0;
  await send('Page.navigate', { url: BASE + path });
  await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 10000) { if (document.querySelector('#app') && document.querySelector('#app').children.length) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()`);
  await wait(1000);
  const h = await evl(`(() => ({ h: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, claims: /verified vehicles/i.test(document.body.innerText.slice(0, 600)) }))()`);
  console.log(`${path.padEnd(14)} hscroll:${h && h.h ? 'Y' : 'N'} claims:${h && h.claims ? 'Y' : 'N'} errs:${errs.length}${errs.length ? ' ' + errs[0] : ''}`);
}
process.exit(0);
