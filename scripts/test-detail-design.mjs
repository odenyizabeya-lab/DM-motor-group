/* Visual verification of the detail-page luxury upgrade, against the local
 * preview of the BUILT dist. Checks:
 *  - card buttons read "VIEW DETAILS"
 *  - premium banners render on the detail page sections
 *  - NO <img>/photograph inside any banner (video-only policy)
 *  - video player still present and playing
 *  - console errors, horizontal scroll, zoom level
 *  - screenshots: desktop 1440 and mobile 390 */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9381;
const BASE = 'http://127.0.0.1:8931';
const slug = process.argv[2] || 'plymouth-barracuda-1970';

const run = async (w, h, out, label) => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', `--window-size=${w},${h}`,
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.env.TEMP}\\lux-${w}`, 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => { try { chrome.kill(); } catch {} });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await wait(250);
    try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
  }
  if (!target) { console.log('chrome failed to start'); chrome.kill(); return; }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push(m.params.entry.text.slice(0, 110));
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { fail: (r.exceptionDetails.exception?.description || 'eval error').slice(0, 150) };
    return r.result && r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });

  await send('Page.navigate', { url: `${BASE}/vehicles/${slug}` });
  await evl(`(async()=>{const t0=Date.now();while(Date.now()-t0<20000){if(document.querySelector('#videoMain .player video')&&document.querySelectorAll('.dbanner').length>=3)break;await new Promise(r=>setTimeout(r,200));}return true;})()`);
  await wait(2500);

  const checks = await evl(`(() => {
    const btns = [...document.querySelectorAll('.vcard .foot .btn-ghost')].slice(0,4).map(a=>a.textContent.trim());
    const banners = [...document.querySelectorAll('.dbanner')].map(b=>({
      t:(b.querySelector('h2')||{}).textContent||'', k:(b.querySelector('.db-kicker')||{}).textContent||'',
      imgs:b.querySelectorAll('img').length, glyph: !!b.querySelector('.db-glyph svg')}));
    const v = document.querySelector('#videoMain .player video');
    const vis = () => { const r = document.documentElement.getBoundingClientRect(); return { zw: document.documentElement.clientWidth, hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 }; };
    return {
      cardButtons: btns,
      bannerCount: banners.length, banners,
      videoPresent: !!v, videoPlaying: !!v && (!v.paused || v.readyState >= 2), videoVisible: !!v && v.offsetWidth > 100,
      photosInBanners: banners.reduce((a,b)=>a+b.imgs,0),
      imgAnywhere: document.querySelectorAll('#app img').length,
      keyfactsIcons: document.querySelectorAll('.keyfacts .kfi svg').length,
      specVariants: [...document.querySelectorAll('.d-sec')].map(s=>s.className.match(/dv-[a-z]+/)?.[0]).filter(Boolean),
      descCard: !!document.querySelector('.desc-card'),
      hscroll: vis().hscroll,
      zoom: (window.outerWidth / window.innerWidth).toFixed(2),
      dsecs: document.querySelectorAll('.d-sec').length,
      tables: document.querySelectorAll('.d-table, .spec-table').length,
    };
  })()`);
  console.log(`\n=== ${label} (${w}x${h}) ===`);
  console.log(JSON.stringify(checks, null, 1));
  console.log('console errors:', errs.length ? errs.slice(0, 4) : 'none');
  await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }).then((r) => {
    fs0(r && r.data ? r.data : null, out);
  });
  ws.close(); chrome.kill();
};
import fs from 'node:fs';
const fs0 = (b64, out) => { if (!b64) return console.log('screenshot failed'); fs.writeFileSync(out, Buffer.from(b64, 'base64')); console.log('screenshot ->', out); };

await run(1440, 900, 'data/design-desktop.png', 'desktop');
await run(390, 844, 'data/design-mobile.png', 'mobile');
process.exit(0);
