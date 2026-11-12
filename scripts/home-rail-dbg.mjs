/* Debug home rail: card markup, click handler target, modal contents. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9346;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\home-dbg-prof',
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
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 200) });
  return r.result && r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await wait(9000);

const probe = await evl(`(() => {
  const rail = document.querySelector('#railVideos');
  if (!rail) return JSON.stringify({ fail: 'no rail' });
  const card = rail.querySelector('.vidcard');
  const img = card && card.querySelector('img');
  return JSON.stringify({
    cardCount: rail.querySelectorAll('.vidcard').length,
    firstCardHTML: card ? card.outerHTML.slice(0, 500) : null,
    imgSrc: img ? img.src : null,
    imgComplete: img ? img.complete : null,
    vidCacheHas77: !!(document.__vidCache && document.__vidCache[77]),
    vidCache77: document.__vidCache && document.__vidCache[77] ? { url: document.__vidCache[77].url.slice(-30), thumb: (document.__vidCache[77].thumbUrl || '').slice(-30) } : null,
  });
})()`);
console.log('RAIL PROBE:', probe);

/* click and inspect the modal */
const clickRes = await evl(`(async () => {
  const card = document.querySelector('#railVideos .vidcard');
  card.click();
  await new Promise((r) => setTimeout(r, 2500));
  const modal = document.querySelector('#modalPlayer');
  const v = modal && modal.querySelector('video');
  return JSON.stringify({
    modalExists: !!modal,
    modalHTML: modal ? modal.outerHTML.slice(0, 400) : null,
    videoSrc: v ? v.src.slice(-40) : null,
    videoError: v && v.error ? v.error.code + ' ' + v.error.message : null,
  });
})()`);
console.log('CLICK RESULT:', clickRes);

/* listen for image errors */
const errs = await evl(`(() => { const imgs = [...document.querySelectorAll('#railVideos img')]; return JSON.stringify(imgs.slice(0,8).map((i) => ({ src: i.src.slice(-34), complete: i.complete, nw: i.naturalWidth }))); })()`);
console.log('IMG STATE:', errs);

ws.close(); chrome.kill(); process.exit(0);
