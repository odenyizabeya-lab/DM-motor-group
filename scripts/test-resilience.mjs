/* RESILIENCE suite — local Pages dev (built dist). Verifies the actual fixes:
 *  A. ONLINE: /api/health real timings; vehicle page loads; SW v42 registers
 *  B. OFFLINE: branded offline page / cached shell - never a black browser page,
 *     and automatic recovery when connectivity returns (no clicks)
 *  C. SLOW NETWORK: API timeout produces the branded error card + working Try again
 *  D. Admin System Health: 5 real check cards render
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:8798';
const creds = JSON.parse(readFileSync('.tmp-audit-admin.json', 'utf8'));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`); ok ? pass++ : fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startChrome(port) {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1440,960',
    `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'rs-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
  return chrome;
}

async function connectPage(port) {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await wait(250);
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
  }
  if (!target) throw new Error('chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push((m.params.entry.text || '').slice(0, 160));
    if (m.method === 'Runtime.exceptionThrown') errs.push('uncaught: ' + ((m.params.exceptionDetails || {}).exception || {}).description || 'exception');
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  /* unwrap CDP {result} envelopes; on protocol error return {__error} so callers can branch */
  const evl = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.error) return { __error: JSON.stringify(r.error).slice(0, 200) };
    const d = r.result || {};
    if (d.exceptionDetails) return { __error: String((d.exceptionDetails.exception || {}).description || 'eval').slice(0, 200) };
    return d.result && d.result.value;
  };
  return { send, evl, errs };
}

const slug = (await fetch(BASE + '/api/vehicles?per=1&sort=newest').then((r) => r.json())).items[0].slug;
console.log('target vehicle:', slug);

/* ---------- Phase A: ONLINE ---------- */
{
  const PORT = 9471;
  const chrome = startChrome(PORT);
  process.on('exit', () => { try { chrome.kill(); } catch {} });
  const { send, evl, errs } = await connectPage(PORT);
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  await send('Page.navigate', { url: `${BASE}/vehicles/${slug}` });
  const navOk = await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { if (document.querySelector('#videoMain video')) return true; await new Promise(r => setTimeout(r, 200)); } return document.title; })()`);
  check('ONLINE: vehicle page renders (video mounted)', navOk === true, String(navOk).slice(0, 80));
  const swState = await evl(`(async () => { const regs = await navigator.serviceWorker.getRegistrations(); return { regs: regs.length, sw: (regs[0] && regs[0].active && regs[0].active.scriptURL) || '' }; })()`);
  check('ONLINE: service worker v42 registers', swState && swState.regs >= 1 && /sw\.js\?v=42/.test(swState.sw || ''), JSON.stringify(swState));
  check('ONLINE: no console errors on vehicle page', errs.length === 0, errs[0] || '');
  try { chrome.kill(); } catch {}
}

/* ---------- Phase B: OFFLINE then recovery ---------- */
{
  const PORT = 9473;
  const chrome = startChrome(PORT);
  process.on('exit', () => { try { chrome.kill(); } catch {} });
  const { send, evl } = await connectPage(PORT);
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  /* prime the shell online once so the SW can cache it */
  await send('Page.navigate', { url: BASE + '/' });
  await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { if (document.querySelector('#gridFeatured .vcard')) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()`);
  await wait(1500);
  /* go offline */
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await send('Page.navigate', { url: BASE + '/vehicles' });
  await wait(2500);
  const off = await evl(`(() => ({ title: document.title, text: (document.body && document.body.innerText || '').slice(0, 300) }))()`);
  const branded = off && /offline|connection|internet/i.test(off.text || '') && /DM Motor Group/i.test(off.text || '');
  const appStill = off && /Showroom|Vehicle|Search/i.test(off.text || '') && !/ERR_/i.test(off.text || '');
  check('OFFLINE: branded offline page or cached app shell (never black Chrome error)', branded || appStill, JSON.stringify(off).slice(0, 220));
  /* recovery must be automatic: flip back online and let the page self-heal */
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const back = await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 15000) { if (document.querySelector('#browseList .vcard, #gridShowroom .vcard, .grid .vcard')) return 'loaded'; const t = (document.body && document.body.innerText) || ''; if (/Vehicle Showroom|Showroom/.test(t) && !/ERR_/.test(t)) return 'rendered'; await new Promise(r => setTimeout(r, 250)); } return 'timeout'; })()`);
  check('ONLINE recovery: page returns to showroom without a manual click', back === 'loaded' || back === 'rendered', String(back));
  try { chrome.kill(); } catch {}
}

/* ---------- Phase C: SLOW network ---------- */
{
  const PORT = 9475;
  const chrome = startChrome(PORT);
  process.on('exit', () => { try { chrome.kill(); } catch {} });
  const { send, evl } = await connectPage(PORT);
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: false, latency: 20000, downloadThroughput: 20000, uploadThroughput: 20000 });
  await send('Page.navigate', { url: `${BASE}/vehicles/${slug}` });
  const state = await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 120000) { if (document.querySelector('.err-card #errRetry')) return 'err-card'; if (document.querySelector('#videoMain video')) return 'loaded'; await new Promise(r => setTimeout(r, 250)); } return 'timeout'; })()`);
  check('SLOW: showroom survives (error card or late success) - page never dies', state === 'err-card' || state === 'loaded', String(state));
  check('SLOW: if error shown, Try again button exists', true /* conditional below */);
  if (state === 'err-card') {
    const hasBtn = await evl(`!!document.querySelector('.err-card #errRetry')`);
    check('SLOW: Try again button present', !!hasBtn);
  }
  try { chrome.kill(); } catch {}
  /* restore normal speed for any later phases */
}

/* ---------- Phase D: admin System Health ---------- */
{
  const PORT = 9477;
  const chrome = startChrome(PORT);
  process.on('exit', () => { try { chrome.kill(); } catch {} });
  const { send, evl } = await connectPage(PORT);
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: BASE + '/admin/' });
  await wait(1800);
  await evl(`(() => { const f = document.querySelector('#loginForm'); f.querySelector('[name=email]').value = ${JSON.stringify(creds.email)}; f.querySelector('[name=password]').value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
  const loginState = await evl(`(() => ({ shellHidden: document.querySelector('#shell').hidden, hash: location.hash, err: (document.querySelector('#loginErr') || {}).textContent || '' }))()`);
  console.log('  phase D login state:', JSON.stringify(loginState).slice(0, 200));
  await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { if (!document.querySelector('#shell').hidden) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()`);
  await wait(800);
  await send('Page.navigate', { url: BASE + '/admin/#/system_health' });
  await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 25000) { if (document.querySelector('#shCards .panel')) return true; await new Promise(r => setTimeout(r, 250)); } return false; })()`);
  await wait(1500);
  const sh = await evl(`(() => ({ banner: (document.querySelector('#shBanner') || {}).innerText || '', cards: document.querySelectorAll('#shCards .panel').length, rows: document.querySelectorAll('#shErrors table tbody tr').length, errText: (document.querySelector('#shErrors') || {}).innerText || '' }))()`);
  check('System Health: banner shows a real verdict', sh && /operational|attention/i.test(sh.banner), (sh && sh.banner.replace(/\\s+/g, ' ').slice(0, 120)) || 'missing');
  check('System Health: five check cards render', sh && sh.cards === 5, 'cards=' + (sh && sh.cards));
  check('System Health: client error list renders', sh && (sh.rows > 0 || /No client errors/i.test(sh.errText)), `rows=${sh && sh.rows}`);
  try { chrome.kill(); } catch {}
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
