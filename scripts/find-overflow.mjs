/* Find elements that overflow the viewport on a phone-sized screen. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9380;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\overflow-prof', 'about:blank'], { stdio: 'ignore' });
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
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });

for (const url of ['https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970', 'https://dmmotorgroup.com/', 'https://dmmotorgroup.com/vehicles', 'https://dmmotorgroup.com/videos']) {
  await send('Page.navigate', { url });
  await wait(6000);
  const r = await evl(`(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 2) {
        out.push({ tag: el.tagName.toLowerCase(), cls: (el.className && String(el.className).slice(0, 40)) || '', right: Math.round(r.right), w: Math.round(r.width) });
      }
    });
    return JSON.stringify({ vw, scrollW: document.documentElement.scrollWidth, offenders: out.slice(0, 8) });
  })()`);
  console.log(url.replace('https://dmmotorgroup.com', '') + ' -> ' + r);
}
ws.close(); chrome.kill(); process.exit(0);
