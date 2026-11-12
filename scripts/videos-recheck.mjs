/* Re-verify /videos modal playback (SW-controlled), with a proper wait for
 * cards to render before clicking. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9358;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\vids-recheck-prof',
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
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 160) });
  return r.result && r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'https://dmmotorgroup.com/videos' });
await wait(9000);
await send('Page.navigate', { url: 'https://dmmotorgroup.com/videos' });
await wait(9000);
console.log('SW:', await evl(`navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : 'none'`));
const r = await evl(`(async () => {
  const cards = document.querySelectorAll('.vidcard');
  if (!cards.length) return JSON.stringify({ fail: 'no cards rendered' });
  cards[0].click();
  await new Promise((r) => setTimeout(r, 2500));
  const v = document.querySelector('#modalPlayer video');
  if (!v) return JSON.stringify({ fail: 'no modal player' });
  try { await v.play(); } catch (e) { return JSON.stringify({ reject: String(e && e.name || e) }); }
  await new Promise((r) => setTimeout(r, 3000));
  return JSON.stringify({ cards: cards.length, t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null });
})()`);
console.log('/videos MODAL:', r);
ws.close(); chrome.kill(); process.exit(0);
