/* Quick check: header icons render correctly (no mojibake) and the complete
 * specification renders on three listings. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9367;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\icon-prof',
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
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return JSON.stringify({ fail: 'eval error' });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');

for (const slug of ['plymouth-barracuda-1970', 'mercedes-amg-gle-53-coupe-2021', 'ford-f-150-2022']) {
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/' + slug });
  await wait(6000);
  const r = await evl(`(() => {
    const box = document.querySelector('#detailsBody');
    const head = document.querySelector('header') ? document.querySelector('header').innerText : '';
    return JSON.stringify({
      rows: box ? box.querySelectorAll('.d-table tr').length : 0,
      notVerified: box ? box.querySelectorAll('.chip-nv').length : -1,
      mojibake: document.body.innerText.split('').filter((c) => c === '\\u00c3' || c === '\\u00e2').length,
      head: head.replace(/\\s+/g,' ').slice(0, 60),
    });
  })()`);
  console.log(slug + ' -> ' + r);
}
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
await wait(6000);
const s = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('.tmp-shots/proof-header-icons.png', Buffer.from(s.data, 'base64'));
console.log('screenshot: .tmp-shots/proof-header-icons.png');
ws.close(); chrome.kill(); process.exit(0);
