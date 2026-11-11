/* Debug the home video rail: does it scroll? do lazy thumbs load? */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9338;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\rail-debug-prof',
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
const evl = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await wait(9000);

const probe = await evl(`(() => {
  const rail = document.querySelector('#railVideos');
  if (!rail) return JSON.stringify({ rail: false });
  const cs = getComputedStyle(rail);
  const rect = rail.getBoundingClientRect();
  const cards = [...rail.children].map((c) => {
    const b = c.getBoundingClientRect();
    const img = c.querySelector('img');
    return { complete: img ? img.complete : null, nw: img ? img.naturalWidth : null, loading: img ? img.loading : null, src: img ? img.src.slice(-40) : '', left: Math.round(b.left), visible: b.width > 0 };
  });
  return JSON.stringify({
    rail: true,
    display: cs.display, overflowX: cs.overflowX, scrollW: rail.scrollWidth, clientW: rail.clientWidth, scrollLeft: rail.scrollLeft,
    railTop: Math.round(rect.top), viewportH: innerHeight, inViewport: rect.top < innerHeight && rect.bottom > 0,
    cards: cards,
  });
})()`);
console.log('RAIL PROBE:', probe);

/* scroll page down so the rail is in view, then scroll the rail */
await evl(`document.querySelector('#railVideos').scrollIntoView({block:'center'}); true`);
await wait(1500);
await evl(`(async () => {
  const rail = document.querySelector('#railVideos');
  for (let x = 0; x <= rail.scrollWidth; x += 200) { rail.scrollLeft = x; await new Promise((r) => setTimeout(r, 400)); }
  rail.scrollLeft = 0;
  return rail.scrollLeft;
})()`);
await wait(4000);
const after = await evl(`(() => {
  const imgs = [...document.querySelectorAll('#railVideos img')];
  return JSON.stringify({ ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, never: imgs.filter((i) => !i.complete).length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length, total: imgs.length });
})()`);
console.log('AFTER RAIL VISIBLE + SCROLL:', after);

/* also test: what happens on a plain vertical page scroll to bottom? */
await evl(`(async () => { for (let y = 0; y <= document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 300)); } return true; })()`);
await wait(4000);
const after2 = await evl(`(() => {
  const imgs = [...document.querySelectorAll('#railVideos img')];
  return JSON.stringify({ ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, never: imgs.filter((i) => !i.complete).length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length, total: imgs.length });
})()`);
console.log('AFTER FULL PAGE SCROLL:', after2);

ws.close(); chrome.kill(); process.exit(0);
