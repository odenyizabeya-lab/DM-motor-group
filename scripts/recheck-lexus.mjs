/* Re-check the Lexus listing specifically with a longer wait. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9369;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + process.env.TEMP + '\\\\lexus-prof', 'about:blank'], { stdio: 'ignore' });
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
for (const attempt of [1, 2]) {
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/lexus-ux-250h-2019' });
  await wait(9000);
  console.log('attempt ' + attempt + ': ' + await evl(`(() => {
    const box = document.querySelector('#detailsBody');
    return JSON.stringify({
      hasBox: !!box, rows: box ? box.querySelectorAll('.d-table tr').length : 0,
      nv: box ? box.querySelectorAll('.chip-nv').length : -1,
      placeholder: box ? box.textContent.trim().slice(0, 40) : 'no box',
      title: document.title.slice(0, 40),
    });
  })()`));
}
ws.close(); chrome.kill(); process.exit(0);
