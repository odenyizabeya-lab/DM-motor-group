/* Verify the new information pages render with real content and the footer
 * links resolve. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9401;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\info-prof', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
}
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
  if (r.exceptionDetails) return JSON.stringify({ fail: 'eval error' });
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

for (const p of ['/about', '/faq', '/terms', '/privacy', '/refund', '/delivery', '/support']) {
  errs.length = 0;
  await send('Page.navigate', { url: 'https://dmmotorgroup.com' + p });
  await wait(3500);
  const r = await evl(`(() => {
    const t = document.body.innerText;
    return JSON.stringify({
      title: document.title.slice(0, 46),
      h1: (document.querySelector('.info-title')||{}).textContent || 'NO H1',
      h2s: document.querySelectorAll('.info-h2').length,
      words: t.split(/\\s+/).length,
      cta: document.querySelectorAll('.info-cta a').length,
      placeholderLeft: /\\[your |\\[the law/.test(t),
    });
  })()`);
  console.log(p.padEnd(10) + r + (errs.length ? '  ERRORS:' + JSON.stringify(errs.slice(0, 2)) : ''));
}

/* footer links all resolve */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/' });
await wait(4000);
const links = await evl(`JSON.stringify([...new Set([...document.querySelectorAll('footer a[href^="/"]')].map((a) => a.getAttribute('href')))])`);
console.log('\nfooter links:', links);
for (const l of JSON.parse(links)) {
  const r = await fetch('https://dmmotorgroup.com' + l, { headers: { accept: 'text/html' } });
  console.log('  ', l.padEnd(16), r.status);
}
ws.close(); chrome.kill(); process.exit(0);
