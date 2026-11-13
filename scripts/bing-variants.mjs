/* Try Bing URL variants for a multi-word query. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9363;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\mkt-var-prof', 'about:blank'], { stdio: 'ignore' });
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

const urls = [
  'https://www.bing.com/search?q=2019+Honda+Civic+used+price&format=rss',
  'https://www.bing.com/search?q=%222019+Honda+Civic%22+used+price+value',
  'https://search.marcia.cc/search?q=test',
  'https://search.brave.com/search?q=2019+Honda+Civic+used+price',
  'https://www.startpage.com/sp/search?query=2019+Honda+Civic+used+price',
  'https://www.ecosia.org/search?q=2019+Honda+Civic+used+price',
];
for (const u of urls) {
  try {
    await send('Page.navigate', { url: u });
    await wait(5000);
    const title = await evl('document.title');
    const body = String(await evl('document.body ? document.body.innerText : ""'));
    const lines = body.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const priced = lines.filter((l) => /\$[\d,]{3,}/.test(l));
    console.log('\n### ' + u.slice(8, 55) + ' | title=' + String(title).slice(0, 50) + ' | lines=' + lines.length + ' | $lines=' + priced.length);
    for (const l of priced.slice(0, 4)) console.log('   * ' + l.slice(0, 190));
  } catch (e) { console.log('### ' + u.slice(8, 55) + ' ERROR ' + String(e).slice(0, 80)); }
  await wait(1500);
}
ws.close(); chrome.kill(); process.exit(0);
