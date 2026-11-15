/* Edge cases: a currency with no account, amount pre-fill, price 0 vehicle. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9390;
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\edge-prof', 'about:blank'], { stdio: 'ignore' });
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
  if (r.exceptionDetails) return JSON.stringify({ fail: 'eval error' });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');

/* create ONLY a NGN account */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/admin' });
await wait(5000);
await evl(`(() => { const f = document.querySelector('#loginForm'); f.email.value = ${JSON.stringify(creds.email)}; f.password.value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await wait(6000);
await evl(`location.hash = '#/bank_accounts'; true`);
await wait(3000);
await evl(`(async () => {
  document.querySelector('#baNew').click();
  await new Promise((r) => setTimeout(r, 1200));
  const f = document.querySelector('#baForm');
  f.bankName.value = 'Zenith Bank Nigeria'; f.accountName.value = 'DM Motor Group Ltd';
  f.accountNumber.value = '0123456789'; f.currency.value = 'NGN'; f.country.value = 'Nigeria';
  f.requestSubmit();
  return true;
})()`);
await wait(3500);
console.log('accounts:', await evl(`document.querySelectorAll('#baTbl tbody tr').length`));

/* a USD-priced vehicle: no USD account available */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/rolls-royce-cullinan-2025' });
await wait(7000);
console.log('1. USD vehicle - amount prefilled:', await evl(`(async () => {
  document.querySelector('#btnPayBank').click();
  await new Promise((r) => setTimeout(r, 2500));
  return JSON.stringify({ amount: document.querySelector('#btAmount').value, currency: document.querySelector('#btCurrency').value });
})()`));
console.log('   buyer selects NGN (the only account we have):', await evl(`(async () => {
  document.querySelector('#btCurrency').value = 'NGN';
  document.querySelector('#btFind').click();
  await new Promise((r) => setTimeout(r, 2000));
  const a = document.querySelector('#btAccounts');
  return JSON.stringify({ offered: a.querySelectorAll('.bt-acct').length, text: a.innerText.replace(/\\s+/g,' ').slice(0, 80) });
})()`));

/* now check a vehicle whose price is 0 */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/mercedes-amg-gle-53-coupe-red-2021' });
await wait(7000);
console.log('2. price-0 vehicle - amount field:', await evl(`(async () => {
  document.querySelector('#btnPayBank').click();
  await new Promise((r) => setTimeout(r, 2500));
  return JSON.stringify({ amount: document.querySelector('#btAmount').value, currency: document.querySelector('#btCurrency').value });
})()`));

/* and a currency with no account at all (EUR) */
console.log('3. currency with no account (EUR):', await evl(`(async () => {
  document.querySelector('#btCurrency').value = 'EUR';
  document.querySelector('#btFind').click();
  await new Promise((r) => setTimeout(r, 2000));
  const a = document.querySelector('#btAccounts');
  return JSON.stringify({ text: a.innerText.replace(/\\s+/g,' ').slice(0, 110), accounts: a.querySelectorAll('.bt-acct').length, findBtnDisabled: document.querySelector('#btFind').disabled });
})()`));

ws.close(); chrome.kill(); process.exit(0);
