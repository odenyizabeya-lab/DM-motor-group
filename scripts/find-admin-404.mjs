import { spawn } from 'node:child_process';
import fs from 'node:fs';
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9389;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\adm404-prof', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const failed = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) failed.push(m.params.response.status + ' ' + m.params.response.url.slice(0, 100));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
await send('Page.enable'); await send('Network.enable');
await send('Page.navigate', { url: 'https://dmmotorgroup.com/admin' });
await wait(5000);
await evl(`(() => { const f = document.querySelector('#loginForm'); f.email.value = ${JSON.stringify(creds.email)}; f.password.value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await wait(6000);
failed.length = 0;
await evl(`location.hash = '#/payments'; true`);
await wait(5000);
console.log('admin payments page failed requests:', failed.length ? failed.join(' | ') : 'none');
failed.length = 0;
await evl(`location.hash = '#/bank_accounts'; true`);
await wait(4000);
console.log('admin bank accounts page failed requests:', failed.length ? failed.join(' | ') : 'none');
ws.close(); chrome.kill(); process.exit(0);
