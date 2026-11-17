/* extra homepage shots: scrolled views (search panel, sections, footer) */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9413;
const BASE = 'http://127.0.0.1:8931';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--window-size=1440,960', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'hs-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
await send('Page.enable');
await send('Page.navigate', { url: BASE + '/' });
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 20000) { if (document.querySelector('#gridFeatured .vcard') && document.querySelector('#railVideos .vcard')) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()`);
await wait(1500);
const shots = [['data/home-sp-search.png', 'document.querySelector("#searchPanel").scrollIntoView({block:"center"})'],
  ['data/home-sp-photo.png', 'document.querySelector("#searchPanel").scrollIntoView({block:"center"}); [...document.querySelectorAll("#searchPanel .sp-tab")].find(b=>b.dataset.t==="photo").click()'],
  ['data/home-sections.png', 'document.querySelector("#secVideos").scrollIntoView()'],
  ['data/home-collection.png', 'document.querySelector("#secFeatured").scrollIntoView()'],
  ['data/home-footer.png', 'document.querySelector("#footer").scrollIntoView({block:"end"})']];
for (const [name, js] of shots) {
  await evl(js); await wait(900);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(name, Buffer.from(s.data, 'base64'));
  console.log('shot ->', name);
}
process.exit(0);
