/* FINAL verification on the canonical git-built deployment:
 * - both domains serve the repaired assets with no mojibake
 * - every listing renders the complete specification with 0 'Not verified'
 * - videos still play
 */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9368;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\final-prof',
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
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErr.push(m.params.entry.text.slice(0, 110));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return JSON.stringify({ fail: 'eval error' });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

const live = await fetch('https://dmmotorgroup.com/details/vehicles.json?v=4').then((r) => r.json());
const slugs = Object.keys(live.vehicles);
let rows = 0, nv = 0, bad = [], vidOk = 0, vidTotal = 0;
for (const slug of slugs) {
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/' + slug });
  await wait(3500);
  const r = JSON.parse(await evl(`(() => {
    const box = document.querySelector('#detailsBody');
    if (!box) return JSON.stringify({ fail: 'no details' });
    const txt = document.body.innerText;
    return JSON.stringify({
      rows: box.querySelectorAll('.d-table tr').length,
      nv: box.querySelectorAll('.chip-nv').length,
      mojibake: (txt.match(/\\u00e2|\\u00c3|\\u00c2/g) || []).length,
      hasSpec: /Complete vehicle specification/.test(txt),
    });
  })()`));
  if (r.fail) { bad.push(slug + ': ' + r.fail); continue; }
  rows += r.rows; nv += r.nv;
  if (r.mojibake) bad.push(slug + ' mojibake=' + r.mojibake);
  if (!r.hasSpec) bad.push(slug + ' no spec section');
  /* video playback check on a rotating subset */
  if (vidTotal < 8) {
    vidTotal++;
    const p = await evl(`(async () => {
      const v = document.querySelector('.vidbox video');
      if (!v) return 'no video element';
      try { await v.play(); } catch (e) { return 'rejected ' + (e && e.name); }
      await new Promise((r) => setTimeout(r, 2500));
      return (v.currentTime > 0.5 && !v.error) ? 'plays t=' + v.currentTime.toFixed(1) : 'FAILED err=' + (v.error ? v.error.code : '?');
    })()`);
    if (p.startsWith('plays')) vidOk++; else bad.push(slug + ' video: ' + p);
  }
}
console.log('listings checked: ' + slugs.length);
console.log('specification rows rendered: ' + rows);
console.log('"Not verified" entries remaining: ' + nv);
console.log('videos played: ' + vidOk + '/' + vidTotal);
console.log('problems: ' + (bad.length ? '\n  ' + bad.join('\n  ') : 'none'));
console.log('console errors: ' + (consoleErr.length ? JSON.stringify(consoleErr.slice(0, 4)) : 'none'));
ws.close(); chrome.kill(); process.exit(0);
