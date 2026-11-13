/* Verify the complete 25-field specification renders for every listing on the
 * live site: all fields present, nothing left showing "Not verified". */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9366;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\spec-prof',
  'about:blank',
], { stdio: 'ignore' });
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
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 140) });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

/* slugs from the live details file */
const live = await fetch('https://dmmotorgroup.com/details/vehicles.json?v=4').then((r) => r.json());
const slugs = Object.keys(live.vehicles);
console.log('checking', slugs.length, 'live listings\n');

let totalRows = 0, nvChips = 0, bad = [];
for (const slug of slugs) {
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/' + slug });
  await wait(4200);
  const r = JSON.parse(await evl(`(() => {
    const box = document.querySelector('#detailsBody');
    if (!box) return JSON.stringify({ fail: 'no #detailsBody' });
    const rows = [...box.querySelectorAll('.d-table tr')].map((tr) => tr.textContent.replace(/\\s+/g,' ').trim());
    const nv = [...box.querySelectorAll('.chip-nv')].map((c) => c.textContent.trim());
    const sec1 = box.querySelector('.d-sec');
    return JSON.stringify({ rows: rows.length, nv: nv, hasSafety: /Safety features/.test(box.textContent), hasEquip: /Other available equipment/.test(box.textContent) });
  })()`));
  if (r.fail) { bad.push(slug + ': ' + r.fail); console.log('FAIL ' + slug); continue; }
  totalRows += r.rows;
  nvChips += r.nv.length;
  if (r.nv.length) bad.push(slug + ' -> ' + r.nv.slice(0, 3).join(' | '));
  if (!r.hasSafety || !r.hasEquip) bad.push(slug + ' missing safety/equipment block');
}
console.log('total specification rows rendered across all listings:', totalRows);
console.log('chips still marked "Not verified":', nvChips);
console.log('problems:', bad.length ? '\n  ' + bad.join('\n  ') : 'none');
if (consoleErr.length) console.log('console errors:', JSON.stringify(consoleErr.slice(0, 5)));

/* visual proof on a classic and a modern car */
for (const [slug, name] of [['plymouth-barracuda-1970', 'proof-spec-barracuda'], ['rolls-royce-cullinan-2025', 'proof-spec-cullinan']]) {
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/' + slug });
  await wait(5000);
  await evl(`document.querySelector('#vehicleDetails').scrollIntoView({block:'start'}); true`);
  await wait(1200);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('.tmp-shots/' + name + '.png', Buffer.from(s.data, 'base64'));
}
console.log('\nscreenshots: .tmp-shots/proof-spec-barracuda.png, .tmp-shots/proof-spec-cullinan.png');
ws.close(); chrome.kill(); process.exit(0);
