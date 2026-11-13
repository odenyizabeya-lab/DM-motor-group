/* End-to-end test of the dealer-entered specification feature:
 * 1. log into the admin dashboard
 * 2. open the Specifications page and the editor for one vehicle
 * 3. type new numbers (mileage, registration year, engine number, VIN)
 * 4. save and confirm the PUBLIC vehicle page shows them
 * 5. reset and confirm the generated defaults return
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9371;
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\spec-admin-prof', 'about:blank'], { stdio: 'ignore' });
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
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 160) });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');

/* 1. log in */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/admin' });
await wait(5000);
await evl(`(() => { const f = document.querySelector('#loginForm'); f.email.value = ${JSON.stringify(creds.email)}; f.password.value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await wait(6000);
console.log('logged in:', await evl(`!!document.querySelector('#shell') && !document.querySelector('#shell').hidden`));

/* 2. specifications list */
await evl(`location.hash = '#/specifications'; true`);
await wait(5000);
console.log('spec page rows:', await evl(`document.querySelectorAll('#stbl tbody tr').length`));
console.log('spec page head:', await evl(`(document.querySelector('.pg-head h1')||{}).textContent`));

/* 3. open the editor for the Barracuda */
const slug = 'plymouth-barracuda-1970';
const vid = await evl(`(async () => { const r = await fetch('/api/admin/vehicles', { headers: { Authorization: 'Bearer ' + localStorage.getItem('dm_admin_token') } }); const rows = await r.json(); const v = rows.find((x) => x.slug === ${JSON.stringify(slug)}); return v ? v.id : 0; })()`);
console.log('barracuda id:', vid);
await evl(`location.hash = '#/specifications/' + ${vid}; true`);
await wait(5000);
console.log('editor inputs:', await evl(`document.querySelectorAll('#specForm input, #specForm textarea').length`));
console.log('prefilled mileage field:', await evl(`(document.querySelector('#specForm [name=mileage]')||{}).value`));
console.log('prefilled reg year:', await evl(`(document.querySelector('#specForm [name=registrationYear]')||{}).value`));

/* 4. type new numbers and save */
const NEW_MILEAGE = '82,500 km';
const NEW_REG = '1970';
const NEW_ENGNO = 'RB-440-ENG-0155';
await evl(`(() => {
  const f = document.querySelector('#specForm');
  f.mileage.value = ${JSON.stringify(NEW_MILEAGE)};
  f.registrationYear.value = ${JSON.stringify(NEW_REG)};
  f.engineNumber.value = ${JSON.stringify(NEW_ENGNO)};
  f.requestSubmit();
  return true;
})()`);
await wait(6000);
console.log('after save, hash:', await evl(`location.hash`));
console.log('toast:', await evl(`(document.querySelector('#toast')||{}).textContent`));

/* 5. check the public page */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/' + slug });
await wait(7000);
const pub = await evl(`(() => {
  const t = document.querySelector('#detailsBody').innerText;
  return JSON.stringify({
    hasMileage: t.includes(${JSON.stringify(NEW_MILEAGE)}),
    hasReg: t.includes(${JSON.stringify(NEW_REG)}),
    hasEngNo: t.includes(${JSON.stringify(NEW_ENGNO)}),
    dealerChip: document.querySelectorAll('#detailsBody .chip').length,
  });
})()`);
console.log('PUBLIC PAGE:', pub);

/* 6. reset back to the generated defaults */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/admin' });
await wait(5000);
await evl(`(() => { const f = document.querySelector('#loginForm'); f.email.value = ${JSON.stringify(creds.email)}; f.password.value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await wait(6000);
const reset = await evl(`(async () => {
  const token = localStorage.getItem('dm_admin_token');
  const r = await fetch('/api/admin/vehicles/' + ${vid} + '/spec', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  return 'reset status ' + r.status;
})()`);
console.log(reset);
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/' + slug });
await wait(7000);
console.log('AFTER RESET:', await evl(`(() => { const t = document.querySelector('#detailsBody').innerText; return JSON.stringify({ stillHasNewMileage: t.includes(${JSON.stringify(NEW_MILEAGE)}), backToGenerated: t.includes('Confirmed at handover') }); })()`));

ws.close(); chrome.kill(); process.exit(0);
