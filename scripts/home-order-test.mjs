/* Mobile 375px test of the NEW home page layout:
 * - position of #secVideos (should be right after trust stats, near the top)
 * - rail thumbs load after the rail enters the viewport
 * - one real playback through the site's own UI
 * Also spot-check desktop 1440 position. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9345;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\home-order-prof',
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
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 140) });
  return r.result && r.result.value;
};

async function testHome(width, height, mobile, label) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
  await wait(9000);
  const pos = await evl(`(() => {
    const sec = document.querySelector('#secVideos');
    if (!sec) return JSON.stringify({ fail: 'no #secVideos on page' });
    const order = [...document.querySelectorAll('section.section')].map((s) => s.id || s.className).slice(0, 5);
    return JSON.stringify({ top: Math.round(sec.getBoundingClientRect().top + scrollY), viewportH: innerHeight, firstSections: order });
  })()`);
  console.log(label + ' SECTION ORDER/POSITION:', pos);

  /* scroll the rail into view and let lazy thumbs load */
  await evl(`document.querySelector('#secVideos').scrollIntoView({block:'center'}); true`);
  await wait(1200);
  await evl(`(async () => { const rail = document.querySelector('#railVideos'); for (let x = 0; x <= rail.scrollWidth; x += 300) { rail.scrollLeft = x; await new Promise((r) => setTimeout(r, 350)); } rail.scrollLeft = 0; return true; })()`);
  await wait(3000);
  const thumbs = await evl(`(() => { const imgs = [...document.querySelectorAll('#railVideos img')]; return JSON.stringify({ total: imgs.length, ok: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length }); })()`);
  console.log(label + ' RAIL THUMBS:', thumbs);

  /* click the first card -> modal -> play */
  await evl(`window.scrollTo(0,0); document.querySelector('#railVideos .vidcard').click(); true`);
  await wait(2500);
  const play = await evl(`(async () => {
    const v = document.querySelector('#modalPlayer video');
    if (!v) return JSON.stringify({ fail: 'modal player missing' });
    await v.play();
    await new Promise((r) => setTimeout(r, 4000));
    const out = { t: +v.currentTime.toFixed(2), d: v.duration ? +v.duration.toFixed(1) : 0, advanced: v.currentTime > 0.5, err: v.error ? v.error.code : null, w: v.videoWidth, h: v.videoHeight };
    return JSON.stringify(out);
  })()`);
  console.log(label + ' HOME PLAYBACK:', play);
}

await testHome(375, 812, true, 'MOBILE-375');
await testHome(1440, 900, false, 'DESKTOP-1440');

ws.close(); chrome.kill(); process.exit(0);
