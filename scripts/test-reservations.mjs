/* Test the reservation flow, order tracking, invoice PDF and the admin
 * reservations page - on the live site. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9403;
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\res-prof', 'about:blank'], { stdio: 'ignore' });
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
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) failed.push(m.params.response.status + ' ' + m.params.response.url.replace('https://dmmotorgroup.com', '').slice(0, 50));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EVAL ERROR';
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

/* 1. customer reserves a vehicle */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
await wait(8000);
console.log('1. reserve button:', await evl(`!!document.querySelector('#btnReserve')`));
await evl(`document.querySelector('#btnReserve').click(); true`);
await wait(2500);
console.log('   modal:', await evl(`!!document.querySelector('#rsGo')`));
await evl(`(() => {
  document.querySelector('#rsName').value = 'Rita Buyer';
  document.querySelector('#rsEmail').value = 'rita@example.com';
  document.querySelector('#rsPhone').value = '+2348001112222';
  document.querySelector('#rsMsg').value = 'I would like to hold this car for 14 days.';
  document.querySelector('#rsGo').click();
  return true;
})()`);
await wait(4000);
console.log('   result:', await evl(`document.querySelector('#modal').innerText.replace(/\\s+/g,' ').slice(0, 190)`));
const resRef = await evl(`(() => { const m = document.querySelector('#modal').innerText; const x = m.match(/RES-\\d{8}-[A-Z0-9]+/); return x ? x[0] : 'NO REF'; })()`);
console.log('   reservation reference:', resRef);

/* 2. a second reservation for the same vehicle must be refused */
const second = await fetch('https://dmmotorgroup.com/api/reservations', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ vehicleId: 46, name: 'Second Buyer', email: 'second@example.com' }),
});
console.log('2. second reservation for the same car:', second.status, (await second.text()).slice(0, 130));

/* 3. admin sees it, moves it to deposit received (reserves the vehicle) */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/admin' });
await wait(5000);
await evl(`(() => { const f = document.querySelector('#loginForm'); f.email.value = ${JSON.stringify(creds.email)}; f.password.value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await wait(6000);
await evl(`location.hash = '#/reservations'; true`);
await wait(5000);
console.log('3. admin reservations page:', await evl(`(document.querySelector('.pg-head h1')||{}).textContent`));
console.log('   row:', await evl(`(() => { const c = document.querySelector('#rsList .enq-card'); return c ? c.innerText.replace(/\\s+/g,' ').slice(0, 150) : 'NO ROW'; })()`));
await evl(`window.prompt = () => 'Deposit verified in the NGN account.'; true`);
await evl(`(() => { const b = [...document.querySelectorAll('#rsList [data-rs]')].find((x) => x.dataset.stage === 'deposit_paid'); if (b) b.click(); return true; })()`);
await wait(4000);
console.log('   after deposit_paid:', await evl(`(() => { const c = document.querySelector('#rsList .enq-card'); return c ? c.innerText.replace(/\\s+/g,' ').slice(0, 110) : 'NO ROW'; })()`));

/* 4. the vehicle is now reserved */
const veh = await fetch('https://dmmotorgroup.com/api/vehicles/plymouth-barracuda-1970').then((r) => r.json());
console.log('4. vehicle status after the deposit:', veh.status);

/* 5. order tracking + invoice PDF */
const orders = await fetch('https://dmmotorgroup.com/api/admin/orders', { headers: { Authorization: 'Bearer ' + (await (await fetch('https://dmmotorgroup.com/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: creds.email, password: creds.password }) })).json()).token } }).then((r) => r.json());
console.log('5. admin orders:', Array.isArray(orders) ? orders.length : 'object', '| first stage:', (Array.isArray(orders) ? orders[0] : {}).stageLabel);
const oid = (Array.isArray(orders) ? orders[0] : {}).id;
const pdf = await fetch(`https://dmmotorgroup.com/api/admin/orders/${oid}/invoice.pdf`, { headers: { Authorization: 'Bearer ' + (await (await fetch('https://dmmotorgroup.com/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: creds.email, password: creds.password }) })).json()).token } });
const pdfBuf = Buffer.from(await pdf.arrayBuffer());
console.log('   invoice PDF:', pdf.status, pdf.headers.get('content-type'), pdfBuf.length + ' bytes |', pdfBuf.slice(0, 8).toString('ascii'), '| contains DM Motor Group:', pdfBuf.toString('latin1').includes('DM Motor Group'));

/* 6. customer account page tabs */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/account' });
await wait(6000);
console.log('6. account page (not signed in shows sign-in):', await evl(`!!document.querySelector('#loginForm') || !!document.querySelector('.acc-nav')`));
console.log('\nfailed requests:', failed.length ? JSON.stringify([...new Set(failed)].slice(0, 5)) : 'none');
ws.close(); chrome.kill(); process.exit(0);
