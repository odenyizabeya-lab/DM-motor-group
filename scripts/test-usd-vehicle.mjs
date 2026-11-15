import { spawn } from 'node:child_process';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9391;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\usd-prof', 'about:blank'], { stdio: 'ignore' });
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
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EVAL ERROR: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 120);
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/rolls-royce-cullinan-2025' });
await wait(9000);
console.log('button present:', await evl(`!!document.querySelector('#btnPayBank')`));
console.log('page title:', await evl(`document.title`));
console.log('open + read fields:', await evl(`(async () => {
  const b = document.querySelector('#btnPayBank');
  if (!b) return 'NO BUTTON';
  b.click();
  await new Promise((r) => setTimeout(r, 3000));
  const amt = document.querySelector('#btAmount'), cur = document.querySelector('#btCurrency');
  if (!amt) return 'MODAL DID NOT OPEN';
  return JSON.stringify({ amount: amt.value, currency: cur.value, options: [...cur.options].slice(0, 8) });
})()`));
console.log('pick NGN:', await evl(`(async () => {
  const cur = document.querySelector('#btCurrency');
  cur.value = 'NGN';
  document.querySelector('#btFind').click();
  await new Promise((r) => setTimeout(r, 2500));
  const a = document.querySelector('#btAccounts');
  return JSON.stringify({ offered: a.querySelectorAll('.bt-acct').length, first: a.querySelector('.bt-acct') ? a.querySelector('.bt-acct').innerText.replace(/\\s+/g,' ').slice(0, 90) : a.innerText.slice(0, 90) });
})()`));
ws.close(); chrome.kill(); process.exit(0);
