/* Re-check the two pages that did not report "playing" — locally AND live,
 * with a generous wait, to distinguish timing from a real breakage. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9384;
const slugs = ['plymouth-barracuda-1970', 'mercedes-benz-s-class-coupe-2019'];

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.env.TEMP}\\vidcheck-prof`, 'about:blank'], { stdio: 'ignore' });
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
  if (r.exceptionDetails) return { fail: (r.exceptionDetails.exception?.description || '').slice(0, 140) };
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');

for (const BASE of ['http://127.0.0.1:8931', 'https://dmmotorgroup.com']) {
  for (const slug of slugs) {
    await send('Page.navigate', { url: BASE + '/vehicles/' + slug });
    await evl(`(async()=>{const t0=Date.now();while(Date.now()-t0<20000){if(document.querySelector('#videoMain .player video'))break;await new Promise(r=>setTimeout(r,200));}return true;})()`);
    /* up to 20s for the video to actually start */
    const st = await evl(`(async()=>{
      const t0=Date.now();
      while(Date.now()-t0<20000){
        const v=document.querySelector('#videoMain .player video');
        if(v&&!v.paused&&!v.ended&&v.readyState>2) return {playing:true,afterMs:Date.now()-t0,src:(v.currentSrc||'').slice(0,80)};
        await new Promise(r=>setTimeout(r,300));
      }
      const v=document.querySelector('#videoMain .player video');
      return {playing:false, ready:v?v.readyState:'none', paused:v?v.paused:'-', net:v?v.networkState:'-',
        err:v&&v.error?v.error.code+':'+v.error.message:'none', src:v?(v.currentSrc||'').slice(0,90):'-'};
    })()`);
    console.log(BASE.replace(/https?:\/\//, '').slice(0, 18).padEnd(18), slug.padEnd(34), JSON.stringify(st));
  }
}
ws.close(); chrome.kill(); process.exit(0);
