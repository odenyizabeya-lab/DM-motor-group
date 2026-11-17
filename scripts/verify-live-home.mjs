/* live production homepage verification */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9417;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--window-size=1440,960',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'live-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push(m.params.entry.text.slice(0, 140)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __fail: 1 }; return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 25000) { if (document.querySelector('#searchPanel .sp-tab') && document.querySelector('#gridFeatured .vcard')) return true; await new Promise(r => setTimeout(r, 250)); } return false; })()`);
await wait(1500);
const r = await evl(`(() => {
  const t = document.body.innerText;
  return {
    heroTitle: /DM Motor Group/.test((document.querySelector('.hero-title')||{}).innerText || ''),
    heroTag: /Exceptional Automobiles/.test(t), kicker: /INTERNATIONAL AUTOMOBILE DEALERSHIP/i.test(t),
    searchTabs: document.querySelectorAll('#searchPanel .sp-tab').length,
    trustBlocks: document.querySelectorAll('#app .trust').length,
    claims: /verified vehicles|accurate descriptions|escrow payments/i.test(document.querySelector('#topbar').innerText),
    stats33: /33 vehicles currently in stock/i.test(t),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
})()`);
console.log(JSON.stringify(r, null, 1)); console.log('console errors:', errs.length, errs[0] || '');
const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('data/home-live.png', Buffer.from(s.data, 'base64'));
process.exit(0);
