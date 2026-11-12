/* Capture console errors + CSP violations + detailed network events during a
 * failing home-rail playback. */
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9350;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\csp-prof',
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
const consoleMsgs = []; const netEvents = []; const reqIds = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded') consoleMsgs.push({ level: m.params.entry.level, text: m.params.entry.text.slice(0, 200), src: m.params.entry.source });
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) consoleMsgs.push({ level: m.params.type, text: (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 200) });
  if (m.method === 'Network.requestWillBeSent') {
    const rq = m.params.request || {};
    reqIds.set(m.params.requestId, rq.url || '?');
    if (/mp4|supabase/.test(rq.url || '')) netEvents.push({ ev: 'req', url: rq.url.slice(-46), range: (rq.headers && rq.headers.Range || '').slice(0, 24), mode: rq.mode || '' });
  }
  if (m.method === 'Network.responseReceived') {
    const rs = m.params.response || {};
    const rurl = m.params.type === 'Media' ? (reqIds.get(m.params.requestId) || '') : (rs.url || '');
    if (/mp4|supabase/.test(rurl)) netEvents.push({ ev: 'res', url: rurl.slice(-46), status: rs.status, type: m.params.type, fromDiskCache: rs.fromDiskCache });
  }
  if (m.method === 'Network.loadingFailed') netEvents.push({ ev: 'FAIL', url: (reqIds.get(m.params.requestId) || '?').slice(-46), err: m.params.errorText, blocked: m.params.blockedReason || '', type: m.params.type });
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 160) });
  return r.result && r.result.value;
};

await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await wait(9000);
consoleMsgs.length = 0; netEvents.length = 0;

await evl(`document.querySelector('#railVideos .vidcard').click(); true`);
await wait(3000);
const play = await evl(`(async () => {
  const v = document.querySelector('#modalPlayer video');
  try { await v.play(); } catch (e) { return 'play rejected: ' + (e && e.name); }
  await new Promise((r) => setTimeout(r, 2000));
  return JSON.stringify({ t: v.currentTime, err: v.error ? v.error.code : null });
})()`);
console.log('PLAY RESULT:', play);
console.log('CONSOLE/LOG MESSAGES:', JSON.stringify(consoleMsgs, null, 1));
console.log('MEDIA NETWORK EVENTS:', JSON.stringify(netEvents, null, 1));
ws.close(); chrome.kill(); process.exit(0);
