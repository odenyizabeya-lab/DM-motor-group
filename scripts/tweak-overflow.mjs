/* Try CSS tweaks live to remove the last 27px of horizontal overflow. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9383;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\tweak-prof', 'about:blank'], { stdio: 'ignore' });
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

console.log('nav parent chain:', await evl(`(() => {
  const nav = document.querySelector('#bottomNav');
  const chain = [];
  let el = nav;
  while (el) { chain.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ')[0] : '')); el = el.parentElement; }
  const cs = getComputedStyle(nav.parentElement || nav);
  return chain.join(' < ') + ' | parent transform=' + cs.transform + ' filter=' + cs.filter + ' contain=' + cs.contain + ' perspective=' + cs.perspective + ' willChange=' + cs.willChange;
})()`));

const trials = [
  ['baseline', ''],
  ['nav width:100%', '#bottomNav{width:100%}'],
  ['nav flex-basis 0', '#bottomNav a{flex:1 1 0% !important}'],
  ['nav font smaller', '#bottomNav a{font-size:9.5px}'],
  ['nav min-width 0 + width 100%', '#bottomNav{min-width:0;width:100%}'],
  ['body overflow-x clip', 'html,body{overflow-x:clip}'],
];
for (const [label, css] of trials) {
  const r = await evl(`(() => {
    document.querySelectorAll('#probe-style').forEach((s) => s.remove());
    if (${JSON.stringify(css)}) { const st = document.createElement('style'); st.id = 'probe-style'; st.textContent = ${JSON.stringify(css)}; document.head.appendChild(st); }
    const nav = document.querySelector('#bottomNav');
    return JSON.stringify({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, navW: Math.round(nav.getBoundingClientRect().width) });
  })()`);
  console.log(label.padEnd(28) + r);
}
ws.close(); chrome.kill(); process.exit(0);
