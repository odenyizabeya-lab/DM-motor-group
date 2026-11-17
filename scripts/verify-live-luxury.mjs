/* FINAL live verification of the design upgrade on production. */
import { spawn } from 'node:child_process';

/* 1. static checks */
for (const p of ['/', '/vehicles', '/videos', '/about', '/terms', '/vehicles/plymouth-barracuda-1970']) {
  const r = await fetch('https://dmmotorgroup.com' + p);
  console.log('  page', p.padEnd(34), r.status);
}
const h = await (await fetch('https://dmmotorgroup.com/')).text();
console.log('  live asset refs:', (h.match(/app\.js\?v=\d+/) || [])[0], (h.match(/styles\.css\?v=\d+/) || [])[0], '| mojibake:', (h.match(/â€/g) || []).length);
const css = await (await fetch('https://dmmotorgroup.com/styles.css?v=21')).text();
console.log('  live styles v21 has luxury upgrade:', ['.dbanner', '.dv-market', '.desc-card', '.kfi'].map((s) => s + '=' + css.includes(s)).join(' '));
const appjs = await (await fetch('https://dmmotorgroup.com/app.js?v=27')).text();
console.log('  live app v27 has banners + view details:', ['dBanner', 'View details', 'db-glyph'].map((s) => s + '=' + appjs.includes(s)).join(' '));

/* 2. behaviour checks in headless chrome */
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900',
  '--remote-debugging-port=9386', `--user-data-dir=${process.env.TEMP}\\live-lux`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let t = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try { t = (await fetch('http://127.0.0.1:9386/json').then((r) => r.json())).find((x) => x.type === 'page'); if (t) break; } catch {}
}
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const p = new Map(); const errs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push(m.params.entry.text.slice(0, 100));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { fail: 1 } : r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
await evl(`(async()=>{const t0=Date.now();while(Date.now()-t0<20000){if(document.querySelectorAll('.dbanner').length>=5&&document.querySelector('#videoMain .player video'))break;await new Promise(r=>setTimeout(r,200));}return true;})()`);
const live = await evl(`(async()=>{
  /* give the video a moment to start */
  const t1=Date.now(); while(Date.now()-t1<15000){const v=document.querySelector('#videoMain .player video'); if(v&&!v.paused&&!v.ended&&v.readyState>2)break; await new Promise(r=>setTimeout(r,300));}
  const bs=[...document.querySelectorAll('.vcard .foot .btn-ghost')];
  return {
    banners: document.querySelectorAll('.dbanner').length,
    bannerPhotos: document.querySelectorAll('.dbanner img').length,
    bannerImgsAnywhere: document.querySelectorAll('#app img').length,
    videoPlaying: (()=>{const v=document.querySelector('#videoMain .player video');return !!v&&!v.paused&&!v.ended&&v.readyState>2})(),
    kfIcons: document.querySelectorAll('.keyfacts .kfi svg').length,
    variants: document.querySelectorAll('.d-sec[class*=dv-]').length,
    descCard: !!document.querySelector('.desc-card'),
    viewDetailsSample: bs.slice(0,3).map(a=>a.textContent.trim()),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    zoom: (window.outerWidth / window.innerWidth).toFixed(2),
  };
})()`);
console.log('\n  LIVE detail page:', JSON.stringify(live, null, 1));
console.log('  console errors:', errs.length ? errs.slice(0, 3) : 'none');
ws.close(); chrome.kill(); process.exit(0);
