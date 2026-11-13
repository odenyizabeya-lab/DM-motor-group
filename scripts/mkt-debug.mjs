/* Debug: what does the browser see for a DDG lite search? */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9361;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\mkt-debug-prof', 'about:blank'], { stdio: 'ignore' });
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
for (const u of ['https://lite.duckduckgo.com/lite/?q=2019+Honda+Civic+used+price', 'https://html.duckduckgo.com/html/?q=2019+Honda+Civic+used+price', 'https://www.bing.com/search?q=2019+Honda+Civic+used+price']) {
  await send('Page.navigate', { url: u });
  await wait(5000);
  const title = await evl('document.title');
  const body = await evl('document.body ? document.body.innerText.slice(0,400) : "NO BODY"');
  console.log('\n### ' + u.slice(0, 60) + '\n title: ' + title + '\n body: ' + String(body).replace(/\s+/g, ' ').slice(0, 300));
  await wait(2000);
}
ws.close(); chrome.kill(); process.exit(0);
