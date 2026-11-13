/* Dump Bing result text for one query to inspect extraction. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9362;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\mkt-dump-prof', 'about:blank'], { stdio: 'ignore' });
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
const q = process.argv[2] || '2019 Honda Civic used price value';
await send('Page.navigate', { url: 'https://www.bing.com/search?q=' + encodeURIComponent(q) + '&count=20' });
await wait(6000);
const body = await evl('document.body ? document.body.innerText : ""');
fs.writeFileSync('.tmp-scan/market/_bing-sample.txt', String(body));
const lines = String(body).split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
console.log('total lines:', lines.length, '| lines with $:', lines.filter((l) => l.includes('$')).length);
console.log('--- lines containing $ (first 25) ---');
for (const l of lines.filter((l) => l.includes('$')).slice(0, 25)) console.log('  * ' + l.slice(0, 200));
ws.close(); chrome.kill(); process.exit(0);
