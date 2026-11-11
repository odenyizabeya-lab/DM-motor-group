/* Launch headless Chrome with a 375px-emulated viewport and report every
   element whose bounding box extends past the right edge of the document. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const URL_ = process.argv[2] || 'https://dmmotorgroup.com/';
const WIDTH = +(process.argv[3] || 375);

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\lh-audit-prof',
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
if (!target) { console.error('chrome did not open a debug target'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 2, mobile: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_ });
await wait(9000); /* let the SPA render */

const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const docW = document.documentElement.clientWidth;
    const out = [];
    document.querySelectorAll('*').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width && (b.right > docW + 2 || b.left < -2)) {
        out.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').slice(0, 60),
          left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width),
          text: (el.textContent || '').trim().slice(0, 60),
        });
      }
    });
    return JSON.stringify({ docW: docW, scrollW: document.documentElement.scrollWidth, over: out.slice(0, 40) });
  })()`,
  returnByValue: true,
});
console.log(r.result.value);
ws.close(); chrome.kill(); process.exit(0);
