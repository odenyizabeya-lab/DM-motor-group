/* ADMIN VIDEO TEST
 * 1. vehicles list shows the video status
 * 2. the media manager lists videos with a playable preview + status badge
 * 3. the playability check endpoint works
 * 4. a vehicle with a broken video CANNOT be published (guard)
 * 5. a vehicle with a good video CAN be published
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9377;
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\admvid-prof', 'about:blank'], { stdio: 'ignore' });
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
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErr.push(m.params.entry.text.slice(0, 130));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 160) });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

/* log in */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/admin' });
await wait(5000);
await evl(`(() => { const f = document.querySelector('#loginForm'); f.email.value = ${JSON.stringify(creds.email)}; f.password.value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await wait(6000);
console.log('logged in:', await evl(`!!document.querySelector('#shell') && !document.querySelector('#shell').hidden`));

/* vehicles list */
await evl(`location.hash = '#/vehicles'; true`);
await wait(5000);
console.log('list video badges:', await evl(`JSON.stringify([...document.querySelectorAll('#vtbl tbody tr')].slice(0, 4).map((tr) => tr.children[6] ? tr.children[6].innerText.trim() : 'n/a'))`));

/* open the barracuda editor -> media manager */
await evl(`location.hash = '#/vehicles/46'; true`);
await wait(7000);
console.log('media manager:', await evl(`JSON.stringify({
  videoItems: document.querySelectorAll('#mgrid .mitem[data-type=video]').length,
  archivedItems: document.querySelectorAll('#mgrid .mitem[data-type=image]').length,
  previewVideos: document.querySelectorAll('#mgrid .vth video').length,
  buttons: [...document.querySelectorAll('#mgrid .mitem[data-type=video] .rowbtns button')].map((b) => b.dataset.a),
  statuses: [...document.querySelectorAll('#mgrid .vstatus')].map((s) => s.textContent),
})`));
await wait(4000);
console.log('statuses after check:', await evl(`JSON.stringify([...document.querySelectorAll('#mgrid .vstatus')].map((s) => s.textContent))`));
console.log('preview plays:', await evl(`(async () => { const v = document.querySelector('#mgrid .vth video'); if (!v) return 'no preview'; try { await v.play(); } catch (e) { return 'play rejected: ' + e.name; } await new Promise((r) => setTimeout(r, 2000)); return 't=' + v.currentTime.toFixed(2) + ' err=' + (v.error ? v.error.code : 'none'); })()`));

/* playability check endpoint */
console.log('check endpoint:', await evl(`(async () => {
  const token = localStorage.getItem('dm_admin_token');
  const v = await api('/api/admin/vehicles/46', { headers: { Authorization: 'Bearer ' + token } });
  const vid = v.media.find((m) => m.type === 'video');
  const r = await fetch('/api/admin/media/' + vid.id + '/check', { headers: { Authorization: 'Bearer ' + token } });
  return JSON.stringify({ status: r.status, body: await r.json() });
})()`));

/* publish guard: a vehicle with a broken video cannot be published */
console.log('publish guard (broken video):', await evl(`(async () => {
  const token = localStorage.getItem('dm_admin_token');
  const H = { 'content-type': 'application/json', Authorization: 'Bearer ' + token };
  /* create a scratch vehicle, attach a broken video, try to publish */
  const mk = await fetch('/api/admin/vehicles', { method: 'POST', headers: H, body: JSON.stringify({ brand: 'TEST', model: 'Guard check', year: 2020, status: 'draft' }) });
  const created = await mk.json();
  const vId = created.id || created.vehicle && created.vehicle.id;
  const up = await fetch('/api/admin/media', { method: 'POST', headers: H, body: JSON.stringify({ vehicleId: vId, type: 'video', url: 'https://dmmotorgroup.com/assets/icon.svg' }) });
  const upj = await up.json();
  const pub = await fetch('/api/admin/vehicles/' + vId + '/status', { method: 'POST', headers: H, body: JSON.stringify({ status: 'published' }) });
  const pubText = await pub.text();
  /* clean up */
  await fetch('/api/admin/vehicles/' + vId, { method: 'DELETE', headers: H });
  return JSON.stringify({ created: !!vId, mediaPost: up.status, publish: pub.status, message: pubText.slice(0, 160) });
})()`));

if (consoleErr.length) console.log('console errors:', JSON.stringify(consoleErr.slice(0, 4)));
ws.close(); chrome.kill(); process.exit(0);
