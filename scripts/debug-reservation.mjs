/* Debug the reservation success screen + check the account page sign-in form. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9404;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\resdbg-prof', 'about:blank'], { stdio: 'ignore' });
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
  if (r.exceptionDetails) return 'EVAL ERROR: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 140);
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');

/* account page while signed out */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/account' });
await wait(6000);
console.log('account (signed out) shows auth form:', await evl(`!!document.querySelector('#authForm')`));
console.log('account page heading:', await evl(`(document.querySelector('h1')||{}).textContent`));

/* reservation on a vehicle with no live reservation - use one with no reservation */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/rolls-royce-cullinan-2025' });
await wait(8000);
await evl(`document.querySelector('#btnReserve').click(); true`);
await wait(2500);
await evl(`(() => {
  document.querySelector('#rsName').value = 'Debug Buyer';
  document.querySelector('#rsEmail').value = 'debug@example.com';
  document.querySelector('#rsGo').click();
  return true;
})()`);
await wait(4000);
console.log('toast after submit:', await evl(`(document.querySelector('#toast')||{}).textContent`));
console.log('modal now shows:', await evl(`(document.querySelector('#modal')||{}).innerText ? document.querySelector('#modal').innerText.replace(/\\s+/g,' ').slice(0, 220) : 'NO MODAL'`));
console.log('window errors:', await evl(`window.__lastErr || 'none captured'`));
ws.close(); chrome.kill(); process.exit(0);
