/* Debug the admin spec save -> public page path step by step. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9372;
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\spec-dbg-prof', 'about:blank'], { stdio: 'ignore' });
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
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 200) });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');

await send('Page.navigate', { url: 'https://dmmotorgroup.com/admin' });
await wait(5000);
await evl(`(() => { const f = document.querySelector('#loginForm'); f.email.value = ${JSON.stringify(creds.email)}; f.password.value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await wait(6000);

console.log('defaults fetch:', await evl(`(async () => { const r = await fetch('/details/vehicles.json?v=4'); const j = await r.json(); const k = Object.keys(j.vehicles || {}); return JSON.stringify({ status: r.status, vehicles: k.length, hasSlug: k.includes('plymouth-barracuda-1970'), barracudaMileage: j.vehicles && j.vehicles['plymouth-barracuda-1970'] ? String(j.vehicles['plymouth-barracuda-1970'].spec.mileage).slice(0, 40) : null }); })()`));

await evl(`location.hash = '#/specifications/46'; true`);
await wait(6000);
console.log('form fields:', await evl(`JSON.stringify([...document.querySelectorAll('#specForm [name]')].map((e) => e.name))`));
console.log('mileage input value:', await evl(`JSON.stringify((document.querySelector('#specForm [name=mileage]')||{}).value)`));
console.log('defaults in page:', await evl(`JSON.stringify((window.SPEC_DEFAULTS && SPEC_DEFAULTS.vehicles && SPEC_DEFAULTS.vehicles['plymouth-barracuda-1970']) ? SPEC_DEFAULTS.vehicles['plymouth-barracuda-1970'].spec.mileage : 'NOT LOADED')`));

/* save through the API from the page */
console.log('save via API from admin page:', await evl(`(async () => {
  const token = localStorage.getItem('dm_admin_token');
  const r = await fetch('/api/admin/vehicles/46/spec', { method: 'PUT', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ spec: { mileage: '82,500 km (test)', registrationYear: '1970' } }) });
  return 'status ' + r.status + ' ' + (await r.text()).slice(0, 120);
})()`));

await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
await wait(8000);
console.log('public API spec:', await evl(`(async () => { const j = await (await fetch('/api/vehicles/plymouth-barracuda-1970')).json(); return JSON.stringify({ spec: j.spec, mileage: j.mileage }); })()`));
console.log('page mileage row:', await evl(`(() => { const rows = [...document.querySelectorAll('#detailsBody .d-table tr')].map((t) => t.textContent.replace(/\\s+/g, ' ').trim()); const m = rows.filter((r) => /^Mileage/i.test(r)); return JSON.stringify(m); })()`));

/* cleanup */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/admin' });
await wait(5000);
await evl(`(() => { const f = document.querySelector('#loginForm'); f.email.value = ${JSON.stringify(creds.email)}; f.password.value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await wait(5000);
console.log('cleanup:', await evl(`(async () => { const token = localStorage.getItem('dm_admin_token'); const r = await fetch('/api/admin/vehicles/46/spec', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }); return 'reset ' + r.status; })()`));

ws.close(); chrome.kill(); process.exit(0);
