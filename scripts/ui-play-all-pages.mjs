/* Click-through UI test on the real /videos page, both pagination pages. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9343;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\ui-allvid-prof2',
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
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || 'eval error').slice(0, 120) });
  return r.result && r.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'https://dmmotorgroup.com/videos' });
await wait(9000);

const PLAY_FN = `(async (idx, label) => {
  const out = { label: label };
  try {
    const cards = document.querySelectorAll('.vidcard');
    if (!cards.length) { out.fail = 'no cards on page'; return JSON.stringify(out); }
    const c = cards[idx];
    if (!c) { out.fail = 'card index ' + idx + ' out of range (' + cards.length + ' cards)'; return JSON.stringify(out); }
    c.click();
    await new Promise((r) => setTimeout(r, 2000));
    const v = document.querySelector('#modalPlayer video');
    if (!v) { out.fail = 'modal player missing'; return JSON.stringify(out); }
    await v.play();
    await new Promise((r) => setTimeout(r, 3000));
    out.t = +v.currentTime.toFixed(2);
    out.d = v.duration ? +v.duration.toFixed(1) : 0;
    out.advanced = v.currentTime > 0.5;
    out.err = v.error ? v.error.code : null;
    out.w = v.videoWidth; out.h = v.videoHeight;
    const x = document.querySelector('#modal .x') || document.querySelector('#modal [class*=close]');
    if (x) x.click();
    await new Promise((r) => setTimeout(r, 700));
  } catch (e) { out.fail = String(e && e.message || e).slice(0, 100); }
  return JSON.stringify(out);
})`;

let ok = 0, total = 0;
const results = [];
async function playCard(idx, label) {
  total++;
  const r = await evl(PLAY_FN + '(' + idx + ',' + JSON.stringify(label) + ')');
  let o; try { o = JSON.parse(r); } catch { o = { label: label, fail: 'parse: ' + String(r).slice(0, 80) }; }
  const pass = !o.fail && o.advanced && !o.err;
  if (pass) ok++;
  results.push(pass);
  console.log((pass ? 'UI PLAY OK  ' : 'UI FAIL     ') + '[' + label + '] t=' + (o.t || 0) + 's/' + (o.d || '?') + 's' + (o.w ? ' ' + o.w + 'x' + o.h : '') + (o.fail ? ' | ' + o.fail : ''));
  await evl('document.body.style.overflow=""; document.querySelector("#lightbox") && (document.querySelector("#lightbox").hidden = true); true');
  return pass;
}

await playCard(0, 'page1-card1');
await playCard(8, 'page1-card9');
await playCard(17, 'page1-card18');

const pager = await evl(`(() => { const b = [...document.querySelectorAll('.pager button, #pager button')].find((x) => x.textContent.trim() === '2'); if (b) { b.click(); return '2'; } return null; })()`);
console.log('clicked pager button:', pager);
await wait(5000);
await playCard(0, 'page2-card1');
await playCard(16, 'page2-card17');

console.log('\nUI RESULT: ' + ok + '/' + total + ' real click-through plays succeeded.');
ws.close(); chrome.kill(); process.exit(ok === total ? 0 : 1);
