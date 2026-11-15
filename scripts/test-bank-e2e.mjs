/* END-TO-END TEST: admin bank accounts + customer payment + admin approval. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9386;
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\bank-e2e-prof', 'about:blank'], { stdio: 'ignore' });
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
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErr.push(m.params.entry.text.slice(0, 120));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 160) });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

const login = async () => {
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/admin' });
  await wait(5000);
  await evl(`(() => { const f = document.querySelector('#loginForm'); f.email.value = ${JSON.stringify(creds.email)}; f.password.value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
  await wait(6000);
};

/* ---------- 1. ADMIN: add a bank account through the dashboard ---------- */
await login();
console.log('1. admin logged in:', await evl(`!!document.querySelector('#shell') && !document.querySelector('#shell').hidden`));
await evl(`location.hash = '#/bank_accounts'; true`);
await wait(4000);
console.log('   bank accounts page:', await evl(`(document.querySelector('.pg-head h1')||{}).textContent`));
console.log('   empty state shown:', await evl(`!!document.querySelector('#baTbl .empty')`));

await evl(`document.querySelector('#baNew').click(); true`);
await wait(2500);
console.log('   form opened:', await evl(`!!document.querySelector('#baForm')`));
await evl(`(() => {
  const f = document.querySelector('#baForm');
  f.bankName.value = 'Zenith Bank Nigeria';
  f.accountName.value = 'DM Motor Group Ltd';
  f.accountNumber.value = '0123456789';
  f.currency.value = 'NGN';
  f.country.value = 'Nigeria';
  f.branch.value = 'Lagos Island';
  f.swift.value = 'ZBNINGLA';
  f.iban.value = '';
  f.instructions.value = 'Send NGN only and quote the reference in your narration.';
  f.active.value = '1';
  f.requestSubmit();
  return true;
})()`);
await wait(4000);
console.log('   after save -> toast:', await evl(`(document.querySelector('#toast')||{}).textContent`));
console.log('   table row:', await evl(`(() => { const tr = document.querySelector('#baTbl tbody tr'); return tr ? tr.innerText.replace(/\\s+/g,' ').slice(0, 120) : 'NO ROW'; })()`));

/* ---------- 2. ADMIN: edit the account ---------- */
await evl(`document.querySelector('#baTbl [data-a=edit]').click(); true`);
await wait(3000);
await evl(`(() => { const f = document.querySelector('#baForm'); f.bankName.value = 'Zenith Bank Nigeria (Main)'; f.requestSubmit(); return true; })()`);
await wait(4000);
console.log('2. after edit -> row:', await evl(`(() => { const tr = document.querySelector('#baTbl tbody tr'); return tr ? tr.innerText.replace(/\\s+/g,' ').slice(0, 90) : 'NO ROW'; })()`));

/* ---------- 3. ADMIN: deactivate + activate ---------- */
await evl(`document.querySelector('#baTbl [data-a=toggle]').click(); true`);
await wait(3500);
console.log('3. after deactivate -> status cell:', await evl(`(() => { const tr = document.querySelector('#baTbl tbody tr'); return tr ? tr.children[7].innerText.trim() : 'NO ROW'; })()`));
const pubInactive = await fetch('https://dmmotorgroup.com/api/payment-methods/bank-accounts').then((r) => r.json());
console.log('   public sees this account while inactive:', pubInactive.accounts.some((a) => a.accountNumber === '0123456789'));
await evl(`document.querySelector('#baTbl [data-a=toggle]').click(); true`);
await wait(3500);
console.log('   after activate -> status cell:', await evl(`(() => { const tr = document.querySelector('#baTbl tbody tr'); return tr ? tr.children[7].innerText.trim() : 'NO ROW'; })()`));

/* ---------- 4. CUSTOMER: checkout flow on a vehicle page ---------- */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
await wait(7000);
console.log('4. customer page has the bank transfer button:', await evl(`!!document.querySelector('#btnPayBank')`));
await evl(`document.querySelector('#btnPayBank').click(); true`);
await wait(3000);
console.log('   modal open:', await evl(`!!document.querySelector('#modal .modal-card')`));
await evl(`(() => {
  document.querySelector('#btName').value = 'Ada Customer';
  document.querySelector('#btEmail').value = 'ada@example.com';
  document.querySelector('#btPhone').value = '+2348000000000';
  document.querySelector('#btCurrency').value = 'NGN';
  document.querySelector('#btAmount').value = '2500000';
  document.querySelector('#btFind').click();
  return true;
})()`);
await wait(2500);
console.log('   accounts offered to the customer:', await evl(`JSON.stringify([...document.querySelectorAll('#btAccounts .bt-acct')].map((a) => a.innerText.replace(/\\s+/g,' ').slice(0, 60)))`));
console.log('   copy button present:', await evl(`!!document.querySelector('#btAccounts .bt-copy')`));
await evl(`document.querySelector('#btContinue').click(); true`);
await wait(3500);
const ref = await evl(`(() => { const m = document.querySelector('#btStep2'); const t = m ? m.innerText : ''; const mm = t.match(/DMG-[0-9A-Z-]+/); return mm ? mm[0] : 'NO REFERENCE'; })()`);
console.log('   reference generated:', ref);
const payInfo = JSON.parse(await evl(`JSON.stringify(window.__btPayment || {})`) || '{}');
console.log('   payment id:', payInfo.id);
console.log('   reference + account shown:', await evl(`(() => { const m = document.querySelector('#btStep2'); return m ? m.innerText.replace(/\\s+/g,' ').slice(0, 150) : ''; })()`));
console.log('   copy reference button:', await evl(`!!document.querySelector('#btCopyRef')`));

/* ---------- 5. CUSTOMER: upload a receipt ---------- */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upload = await evl(`(async () => {
  const res = await fetch('/api/payments/' + ${JSON.stringify('')} , { method: 'POST' });
  return 'skip';
})()`).catch(() => 'skip');
/* upload through the UI: build a File and dispatch it */
const uploaded = await evl(`(async () => {
  const bin = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], 'receipt.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const input = document.querySelector('#btFile'); input.files = dt.files;
  document.querySelector('#btUpload').click();
  await new Promise((r) => setTimeout(r, 4000));
  const m = document.querySelector('#btStep2');
  return m ? m.innerText.replace(/\\s+/g,' ').slice(0, 180) : 'no step2';
})()`);
console.log('5. after receipt upload:', uploaded);

/* ---------- 6. ADMIN: see the payment and approve it ---------- */
await login();
await evl(`location.hash = '#/payments'; true`);
await wait(4500);
console.log('6. admin payments page:', await evl(`(document.querySelector('.pg-head h1')||{}).textContent`));
console.log('   row:', await evl(`(() => { const tr = document.querySelector('#payTbl tbody tr'); return tr ? tr.innerText.replace(/\\s+/g,' ').slice(0, 200) : 'NO ROW'; })()`));
console.log('   status before approval:', await evl(`(() => { const tr = document.querySelector('#payTbl tbody tr'); return tr ? tr.children[7].innerText.trim() : ''; })()`));

/* confirm (the prompt is overridden) */
await evl(`window.prompt = () => '2,500,000 NGN received'; true`);
await evl(`document.querySelector('#payTbl [data-a=confirm]').click(); true`);
await wait(4500);
console.log('   status after approval:', await evl(`(() => { const tr = document.querySelector('#payTbl tbody tr'); return tr ? tr.children[7].innerText.replace(/\\s+/g,' ').trim() : 'NO ROW'; })()`));
console.log('   toast:', await evl(`(document.querySelector('#toast')||{}).textContent`));

/* ---------- 7. customer checks the status ---------- */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
await wait(6000);
const custStatus = await evl(`(async () => {
  const r = await fetch('/api/payments/' + ${JSON.stringify(payInfo.id || 1)} + '?reference=' + encodeURIComponent(${JSON.stringify(payInfo.reference || ref)}));
  const j = await r.json();
  return JSON.stringify({ status: j.status, label: j.statusLabel, note: j.reviewNote });
})()`);
console.log('7. customer status after approval:', custStatus);

console.log('\nconsole errors:', consoleErr.length ? JSON.stringify([...new Set(consoleErr)].slice(0, 5)) : 'none');
ws.close(); chrome.kill(); process.exit(0);
