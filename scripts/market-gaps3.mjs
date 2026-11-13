/* Bing (browser) for the 3 remaining market gaps, reading the results container. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9364;
const QS = [
  ['byd-seal-2023', '"2023 BYD Seal" price MSRP'],
  ['plymouth-barracuda-1970', '"1970 Plymouth Barracuda" price value auction'],
  ['bugatti-chiron-super-sport', '"Bugatti Chiron Super Sport 300+" price'],
];
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\mkt-gap-prof', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;
await send('Page.enable'); await send('Runtime.enable');
for (const [key, q] of QS) {
  await send('Page.navigate', { url: 'https://www.bing.com/search?q=' + encodeURIComponent(q) });
  await wait(7000);
  const txt = await evl(`(document.querySelector('#b_results') || document.body).innerText`);
  const lines = String(txt || '').split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const priced = lines.filter((l) => /\$[\d,]{3,}/.test(l));
  console.log('\n=== ' + key + ' | lines=' + lines.length + ' priced=' + priced.length);
  for (const l of priced.slice(0, 8)) console.log('  * ' + l.slice(0, 200));
  await wait(2500);
}
ws.close(); chrome.kill(); process.exit(0);
