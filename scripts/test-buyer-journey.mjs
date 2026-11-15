/* FULL BUYER JOURNEY TEST (live site)
 *  1. admin creates NGN + USD accounts
 *  2. a buyer pays in NGN (price 0 vehicle -> typed amount)
 *  3. the buyer uploads a receipt and checks the status later by reference
 *  4. the admin verifies, confirms, reserves the vehicle
 *  5. the buyer sees Confirmed
 *  6. security: wrong reference, bad lookup, staff-only routes
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9388;
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\journey-prof', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const consoleErr = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErr.push(m.params.entry.text.slice(0, 110));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 150) });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

const login = async () => {
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/admin' });
  await wait(5000);
  await evl(`(() => { const f = document.querySelector('#loginForm'); f.email.value = ${JSON.stringify(creds.email)}; f.password.value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
  await wait(6000);
};

/* 1. admin creates two accounts (NGN + USD) */
await login();
await evl(`location.hash = '#/bank_accounts'; true`);
await wait(3500);
const created = await evl(`(async () => {
  const out = [];
  const mk = async (vals) => {
    document.querySelector('#baNew').click();
    await new Promise((r) => setTimeout(r, 1200));
    const f = document.querySelector('#baForm');
    for (const [k, v] of Object.entries(vals)) { const el = f[k]; if (!el) continue; if (el.tagName === 'SELECT') el.value = v; else el.value = v; }
    f.requestSubmit();
    await new Promise((r) => setTimeout(r, 2500));
    return document.querySelector('#toast').textContent;
  };
  out.push(await mk({ bankName: 'Zenith Bank Nigeria', accountName: 'DM Motor Group Ltd', accountNumber: '0123456789', accountType: 'current', currency: 'NGN', country: 'Nigeria', branch: 'Lagos Island', swift: 'ZBNINGLA', instructions: 'Send NGN only.' }));
  out.push(await mk({ bankName: 'First Meridian Bank', accountName: 'DM Motor Group LLC', accountNumber: 'US-4477-8890', accountType: 'business', currency: 'USD', country: 'United States', swift: 'FMIBUS33', instructions: 'Wire only, quote the reference.' }));
  return JSON.stringify(out);
})()`);
console.log('1. admin created accounts:', created);
console.log('   rows now:', await evl(`document.querySelectorAll('#baTbl tbody tr').length`));

/* 2. buyer pays on a vehicle that has NO price (must type the amount) */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
await wait(7000);
await evl(`document.querySelector('#btnPayBank').click(); true`);
await wait(2500);
console.log('2. buyer sees the status lookup box:', await evl(`!!document.querySelector('#btLookupRef')`));
await evl(`(() => {
  document.querySelector('#btName').value = 'Ada Buyer';
  document.querySelector('#btEmail').value = 'ada@example.com';
  document.querySelector('#btCurrency').value = 'NGN';
  document.querySelector('#btAmount').value = '2500000';
  document.querySelector('#btFind').click();
  return true;
})()`);
await wait(2000);
console.log('   NGN account offered:', await evl(`(document.querySelector('#btAccounts .bt-acct')||{}).innerText ? 'yes' : 'NO'`));
await evl(`document.querySelector('#btContinue').click(); true`);
await wait(3500);
const info = JSON.parse(await evl(`JSON.stringify(window.__btPayment || {})`) || '{}');
console.log('   reference:', info.reference);

/* 3. buyer uploads a receipt */
const uploadOut = await evl(`(async () => {
  const bin = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], 'bank-receipt.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const input = document.querySelector('#btFile'); input.files = dt.files;
  document.querySelector('#btUpload').click();
  await new Promise((r) => setTimeout(r, 4000));
  return (document.querySelector('#btStep2') || {}).innerText ? document.querySelector('#btStep2').innerText.replace(/\\s+/g,' ').slice(0, 110) : 'NO RESULT';
})()`);
console.log('3. after receipt upload:', uploadOut);

/* 4. buyer checks the status with the reference (new feature) */
console.log('4. buyer status lookup by reference:', await evl(`(async () => {
  document.querySelector('#btLookupRef').value = ${JSON.stringify(info.reference || '')};
  document.querySelector('#btLookupBtn').click();
  await new Promise((r) => setTimeout(r, 2500));
  return (document.querySelector('#btLookupOut').innerText || '').replace(/\\s+/g,' ').slice(0, 130);
})()`));
console.log('   wrong reference:', await evl(`(async () => {
  document.querySelector('#btLookupRef').value = 'DMG-20200101-DEADBEEF';
  document.querySelector('#btLookupBtn').click();
  await new Promise((r) => setTimeout(r, 2000));
  return (document.querySelector('#btLookupOut').innerText || '').replace(/\\s+/g,' ').slice(0, 90);
})()`));

/* 5. admin verifies then confirms, and reserves the vehicle */
await login();
await evl(`location.hash = '#/payments'; true`);
await wait(4000);
console.log('5. admin sees the payment:', await evl(`(() => { const tr = document.querySelector('#payTbl tbody tr'); return tr ? tr.innerText.replace(/\\s+/g,' ').slice(0, 150) : 'NO ROW'; })()`));
await evl(`window.prompt = () => '2,500,000 NGN received in the NGN account'; window.confirm = () => true; true`);
await evl(`document.querySelector('#payTbl [data-a=verify]').click(); true`);
await wait(3500);
console.log('   after Verify ->', await evl(`(() => { const tr = document.querySelector('#payTbl tbody tr'); return tr ? tr.children[7].innerText.replace(/\\s+/g,' ').trim() : 'NO ROW'; })()`));
await evl(`document.querySelector('#payTbl [data-a=confirm]').click(); true`);
await wait(4000);
console.log('   after Confirm ->', await evl(`(() => { const tr = document.querySelector('#payTbl tbody tr'); return tr ? tr.children[7].innerText.replace(/\\s+/g,' ').trim() : 'NO ROW'; })()`));
const vehStatus = await evl(`(async () => {
  const t = localStorage.getItem('dm_admin_token');
  const rows = await (await fetch('/api/admin/vehicles', { headers: { Authorization: 'Bearer ' + t } })).json();
  const v = rows.find((x) => x.slug === 'plymouth-barracuda-1970');
  return v ? v.status : 'not found';
})()`);
console.log('   vehicle status after confirmation:', vehStatus);

/* 6. buyer sees Confirmed */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
await wait(6000);
await evl(`document.querySelector('#btnPayBank').click(); true`);
await wait(2500);
console.log('6. buyer status now:', await evl(`(async () => {
  document.querySelector('#btLookupRef').value = ${JSON.stringify(info.reference || '')};
  document.querySelector('#btLookupBtn').click();
  await new Promise((r) => setTimeout(r, 2500));
  return (document.querySelector('#btLookupOut').innerText || '').replace(/\\s+/g,' ').slice(0, 150);
})()`));

/* 7. security checks */
console.log('7. security:');
console.log('   admin payments without token ->', (await fetch('https://dmmotorgroup.com/api/admin/payments')).status);
console.log('   admin bank accounts without token ->', (await fetch('https://dmmotorgroup.com/api/admin/bank-accounts')).status);
console.log('   garbage reference lookup ->', (await fetch('https://dmmotorgroup.com/api/payments/lookup?reference=hello')).status);
console.log('   customer lookup of a real reference (no id) ->', (await fetch('https://dmmotorgroup.com/api/payments/lookup?reference=' + info.reference)).status);

console.log('\nconsole errors:', consoleErr.length ? JSON.stringify([...new Set(consoleErr)].slice(0, 4)) : 'none');
ws.close(); chrome.kill(); process.exit(0);
