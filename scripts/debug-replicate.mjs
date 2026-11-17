import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9437;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'dc6-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __fail: (r.exceptionDetails.exception?.description || 'e').slice(0, 300) }; return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8931/' });
await wait(3000);
const testUrl = 'https://gevxgqdevaanmxqzverv.supabase.co/storage/v1/object/public/vehicle-media/v46/0912066fcfd5e3dac65c6bce5ca4ff43.mp4';
console.log(JSON.stringify(await evl(`(async () => {
  const log = {};
  const fp = String(${JSON.stringify(testUrl)}).split('').reduce((a, ch) => ((a * 31 + ch.charCodeAt(0)) & 0xffffff), 7);
  log.fp = fp;
  let cache = null;
  try { cache = await caches.open('dm-frames-v1'); log.openErr = null; } catch (e) { cache = null; log.openErr = String(e && (e.name + '::' + e.message)); }
  log.cacheIsNull = !cache;
  const base = '/__dmframes/999/' + fp;
  if (cache) {
    const hits = await Promise.all([0,1,2,3,4,5].map(async (i) => { try { const r = await cache.match(base + '-' + i + '.jpg'); return r ? 'hit' : 'miss'; } catch (e) { return 'err:' + String(e && e.message); } }));
    log.matches = hits;
  }
  const blobs = await vfExtract(${JSON.stringify(testUrl)});
  log.blobs = blobs.length;
  if (cache && blobs.length) {
    const puts = await Promise.all(blobs.map(async (b, i) => {
      try { await cache.put(base + '-' + i + '.jpg', new Response(b, { headers: { 'content-type': 'image/jpeg' } })); return 'put ok'; }
      catch (e) { return 'put ERR: ' + String(e && (e.name + '::' + e.message)); }
    }));
    log.puts = puts;
  } else { log.puts = 'SKIPPED cache=' + (!!cache) + ' len=' + blobs.length; }
  log.keysAfter = (await caches.open('dm-frames-v1').then(c => c.keys())).map(k => k.url);
  return log;
})()`), null, 1));
process.exit(0);
