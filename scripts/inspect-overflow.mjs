/* Inspect the two remaining overflow elements precisely. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9382;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\inspect-prof', 'about:blank'], { stdio: 'ignore' });
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
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
await wait(7000);
console.log(await evl(`(() => {
  const out = [];
  for (const sel of ['#bottomNav', '.install-android', '.btn.btn-gold.wide', 'nav']) {
    const el = document.querySelector(sel);
    if (!el) { out.push(sel + ': not found'); continue; }
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    out.push(sel + ' -> rect=' + JSON.stringify({ l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }) +
      ' pos=' + cs.position + ' left=' + cs.left + ' right=' + cs.right + ' width=' + cs.width + ' transform=' + cs.transform + ' display=' + cs.display + ' overflowX=' + cs.overflowX + ' minWidth=' + cs.minWidth);
  }
  out.push('body scrollW=' + document.body.scrollWidth + ' html scrollW=' + document.documentElement.scrollWidth + ' clientW=' + document.documentElement.clientWidth);
  out.push('fixed elements: ' + [...document.querySelectorAll('body *')].filter((e) => getComputedStyle(e).position === 'fixed').map((e) => e.id || e.className).join(' | '));
  return out.join('\\n');
})()`));
ws.close(); chrome.kill(); process.exit(0);
