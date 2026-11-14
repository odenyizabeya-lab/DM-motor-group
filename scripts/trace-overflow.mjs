/* Trace which ancestor forces the detail page column wider than the viewport. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9381;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\chain-prof', 'about:blank'], { stdio: 'ignore' });
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
await send('Page.navigate', { url: 'https://dmmotorgroup.com'.replace('dmmotorgroup.com', 'dmmotorgroup.com') + '/vehicles/plymouth-barracuda-1970' });
await wait(7000);
console.log('ancestor chain of the wide button:');
console.log(await evl(`(() => {
  const btn = document.querySelector('#btnEnqMain');
  const out = [];
  let el = btn;
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.push(el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ').slice(0,2).join('.') +
      ' w=' + Math.round(r.width) + ' display=' + cs.display +
      (cs.display === 'grid' ? ' cols=' + cs.gridTemplateColumns : '') +
      (cs.display === 'flex' ? ' flexWrap=' + cs.flexWrap : ''));
    el = el.parentElement;
  }
  return out.join('\\n');
})()`));
console.log('\nlive stylesheet .detail-top rule:', await evl(`(() => {
  for (const ss of document.styleSheets) {
    try { for (const r of ss.cssRules) { if (r.cssText && r.cssText.includes('.detail-top') && r.cssText.includes('grid-template-columns')) return r.cssText.slice(0, 160); } } catch (e) {}
  }
  return 'not found';
})()`));
ws.close(); chrome.kill(); process.exit(0);
