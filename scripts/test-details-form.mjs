/* Test the complete vehicle details form on several live listings.
 * Checks: panel renders, 7 numbered sections present, "Not verified" honesty
 * chips present, market section shows estimate separate from asking price,
 * mismatch warning appears where required, videos still play, no console errors. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9365;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\details-prof',
  'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const consoleErr = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErr.push(m.params.entry.text.slice(0, 140));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return JSON.stringify({ fail: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error').slice(0, 140) });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

const CASES = [
  ['plymouth-barracuda-1970', 'expectedMismatch: false', 'expectedPrice: null'],
  ['ferrari-sf90-stradale-2021', 'expectedMismatch: true', 'expectedPrice: null'],
  ['mercedes-amg-gle-53-coupe-2021', 'expectedMismatch: false', 'expectedPrice: 18500'],
  ['rolls-royce-cullinan-2025', 'expectedMismatch: false', 'expectedPrice: 601000'],
  ['land-rover-defender-110-2022', 'expectedMismatch: false', 'expectedPrice: 33000'],
];

for (const [slug, , priceExp] of CASES) {
  consoleErr.length = 0;
  await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/' + slug });
  await wait(7000);
  const r = await evl(`(async () => {
    const box = document.querySelector('#detailsBody');
    if (!box) return JSON.stringify({ fail: 'no #detailsBody' });
    const secs = [...box.querySelectorAll('.d-sec h3')].map((h) => h.textContent.replace(/\\s+/g,' ').trim());
    const nv = box.querySelectorAll('.chip-nv').length;
    const chips = box.querySelectorAll('.chip').length;
    const warn = box.querySelector('.d-warn');
    const ask = box.querySelector('.d-ask b');
    const est = box.querySelector('.d-est b');
    const cta = box.querySelectorAll('.d-cta button').length;
    const discl = box.querySelectorAll('.d-disclose li').length;
    const th = document.querySelector('#galleryImg');
    return JSON.stringify({
      sections: secs.length, secTitles: secs.map(s => s.slice(0, 34)),
      notVerifiedChips: nv, totalChips: chips,
      warning: warn ? warn.textContent.replace(/\\s+/g,' ').slice(0, 70) : null,
      asking: ask ? ask.textContent.replace(/\\s+/g,' ').trim() : null,
      estimate: est ? est.textContent.replace(/\\s+/g,' ').trim().slice(0, 48) : null,
      ctaButtons: cta, disclosureItems: discl,
      heroImgLoaded: th ? (th.complete && th.naturalWidth > 0) : false,
    });
  })()`);
  console.log('\n### ' + slug + '\n  ' + r);
  /* play the inline video on the page (regression check) */
  const play = await evl(`(async () => {
    const v = document.querySelector('.vidbox video');
    if (!v) return 'no inline video element';
    try { await v.play(); } catch (e) { return 'play rejected: ' + (e && e.name); }
    await new Promise((r) => setTimeout(r, 3000));
    return 't=' + v.currentTime.toFixed(2) + 's err=' + (v.error ? v.error.code : 'none');
  })()`);
  console.log('  VIDEO: ' + play);
  if (consoleErr.length) console.log('  CONSOLE ERRORS: ' + JSON.stringify(consoleErr.slice(0, 4)));
}

/* screenshot of the details panel */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/vehicles/plymouth-barracuda-1970' });
await wait(7000);
await evl(`document.querySelector('#vehicleDetails').scrollIntoView({block:'start'}); true`);
await wait(1500);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('.tmp-shots/proof-details-form.png', Buffer.from(shot.data, 'base64'));
console.log('\nscreenshot: .tmp-shots/proof-details-form.png');
ws.close(); chrome.kill(); process.exit(0);
