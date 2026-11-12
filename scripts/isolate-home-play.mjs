/* Isolate: does the SAME browser play on /videos but fail on home? Inspect
 * home modal internals: currentSrc, readyState, duplicates, media errors. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9348;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\iso-prof',
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
let id = 0; const pending = new Map(); const netFail = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Network.loadingFailed') netFail.push({ url: String(m.params.blockedReason || '') + ' ' + String(m.params.errorText || ''), type: m.params.type });
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 160) });
  return r.result && r.result.value;
};

await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable');

/* 1. control: /videos modal plays? */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/videos' });
await wait(9000);
const ctrl = await evl(`(async () => {
  document.querySelector('.vidcard').click();
  await new Promise((r) => setTimeout(r, 2200));
  const v = document.querySelector('#modalPlayer video');
  if (!v) return JSON.stringify({ fail: 'no video' });
  try { await v.play(); } catch (e) { return JSON.stringify({ reject: String(e && e.name || e) }); }
  await new Promise((r) => setTimeout(r, 2500));
  return JSON.stringify({ t: +v.currentTime.toFixed(2), d: +v.duration.toFixed(1), err: v.error ? v.error.code : null });
})()`);
console.log('CONTROL /videos modal:', ctrl);

/* 2. home modal internals */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await wait(9000);
await evl(`document.querySelector('#railVideos .vidcard').click(); true`);
await wait(2500);
const home = await evl(`(() => {
  const ms = document.querySelectorAll('#modalPlayer');
  const vs = document.querySelectorAll('#modalPlayer video');
  const v = document.querySelector('#modalPlayer video');
  return JSON.stringify({
    modalCount: ms.length, videoCount: vs.length,
    src: v ? v.src.slice(-40) : null, currentSrc: v ? (v.currentSrc || '').slice(-40) : null,
    readyState: v ? v.readyState : null, networkState: v ? v.networkState : null,
    err: v && v.error ? v.error.code + ' ' + v.error.message : null,
    pause: v ? v.paused : null,
    srcAttr: v ? v.getAttribute('src') : null,
    hasSource: !!document.querySelector('#modalPlayer video source'),
  });
})()`);
console.log('HOME MODAL STATE:', home);
const vsrc = await evl(`document.querySelector('#modalPlayer video').src`);
/* 3. fetch the same URL from inside the page to check fetch/cors */
const fetchCheck = await evl(`fetch(${JSON.stringify(vsrc)}, { method: 'GET', headers: { Range: 'bytes=0-99' } }).then((r) => JSON.stringify({ status: r.status, type: r.headers.get('content-type') })).catch((e) => 'FETCH FAIL ' + String(e))`);
console.log('IN-PAGE FETCH of video URL:', fetchCheck);
console.log('NETWORK FAILURES:', JSON.stringify(netFail.slice(0, 12)));
ws.close(); chrome.kill(); process.exit(0);
