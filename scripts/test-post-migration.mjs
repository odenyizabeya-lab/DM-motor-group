/* After the migrations: does the site still work and are the AI features now
 * live (instead of saying "apply the migration")? */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9377;
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + process.env.TEMP + '\\\\postmig-prof', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await wait(250);
  try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const failed = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) failed.push(m.params.response.status + ' ' + m.params.response.url.replace('https://dmmotorgroup.com', '').slice(0, 46));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EVAL ERROR';
  return r.result && r.result.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

/* public pages */
for (const p of ['/', '/vehicles', '/about', '/terms', '/faq']) {
  await send('Page.navigate', { url: 'https://dmmotorgroup.com' + p });
  await wait(3500);
  const t = await evl(`(document.querySelector('h1')||{}).textContent || 'NO H1'`);
  console.log('  ' + p.padEnd(11) + '->', String(t).slice(0, 52));
}

/* admin: AI pages should no longer say "apply the migration" */
await send('Page.navigate', { url: 'https://dmmotorgroup.com/admin' });
await wait(5000);
await evl(`(() => { const f = document.querySelector('#loginForm'); f.email.value = ${JSON.stringify(creds.email)}; f.password.value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await wait(6000);
for (const [route, label] of [['#/ai_service', 'AI Customer Service'], ['#/ai', 'AI Car Scanner'], ['#/reservations', 'Reservations & Orders'], ['#/bank_accounts', 'Bank accounts'], ['#/payments', 'Payments']]) {
  failed.length = 0;
  await evl(`location.hash = '${route}'; true`);
  await wait(4500);
  const txt = await evl(`(document.querySelector('#pg')||{}).innerText ? document.querySelector('#pg').innerText.replace(/\\s+/g,' ').slice(0,150) : 'EMPTY'`);
  const needsSetup = /apply migration|setup required|not available/i.test(String(txt));
  console.log('  ' + label.padEnd(22) + '-> ' + (needsSetup ? 'STILL ASKING FOR THE MIGRATION' : 'ready') + ' | ' + String(txt).slice(0, 90));
  if (failed.length) console.log('      failed requests: ' + JSON.stringify([...new Set(failed)].slice(0, 3)));
}
ws.close(); chrome.kill(); process.exit(0);
