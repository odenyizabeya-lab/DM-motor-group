/* Measure specific page-head / hero / toolbar boxes at an emulated width. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const URL_ = process.argv[2] || 'https://dmmotorgroup.com/vehicles';
const WIDTH = +(process.argv[3] || 375);

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\lh-audit-prof2',
  'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try {
    const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
    target = list.find((t) => t.type === 'page');
  } catch {}
}
if (!target) { console.error('no target'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 2, mobile: true });
await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await wait(9000);

const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { sel: sel, left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), whiteSpace: cs.whiteSpace, display: cs.display };
    };
    return JSON.stringify({
      docW: document.documentElement.clientWidth,
      scrollW: document.documentElement.scrollWidth,
      els: ['.hero-kicker', '.hero-copy', '.hero', 'main.wrap-page', '.wrap-page', '.page-head', '.page-head h1', '.page-head h1 small', '.toolbar', '#sortSel', '#resCount', 'body'].map(pick),
    });
  })()`,
  returnByValue: true,
});
console.log(r.result.value);
ws.close(); chrome.kill(); process.exit(0);
