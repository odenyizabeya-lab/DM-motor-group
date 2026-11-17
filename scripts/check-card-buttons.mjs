/* Check showroom/home cards show the new VIEW DETAILS button. */
import { spawn } from 'node:child_process';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9385',
  `--user-data-dir=${process.env.TEMP}\\cards-prof`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let t = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try { t = (await fetch('http://127.0.0.1:9385/json').then((r) => r.json())).find((x) => x.type === 'page'); if (t) break; } catch {}
}
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const p = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.value; };
await send('Page.enable');
for (const path of ['/vehicles', '/']) {
  await send('Page.navigate', { url: 'http://127.0.0.1:8931' + path });
  await evl(`(async()=>{const t0=Date.now();while(Date.now()-t0<15000){if(document.querySelectorAll('.vcard').length>3)break;await new Promise(r=>setTimeout(r,200));}return true;})()`);
  const r = await evl(`(() => { const bs=[...document.querySelectorAll('.vcard .foot .btn-ghost')]; return { cards: document.querySelectorAll('.vcard').length, viewDetails: bs.filter(a=>/view details/i.test(a.textContent)).length, oldDetails: bs.filter(a=>a.textContent.trim()==='Details').length }; })()`);
  console.log(path.padEnd(10), JSON.stringify(r));
}
ws.close(); chrome.kill(); process.exit(0);
