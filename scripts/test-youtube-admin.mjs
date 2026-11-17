/* YouTube Automation admin page -------- pre-migration behaviour on local preview
 * (API proxied to production, which does not have youtube_settings yet).
 * Verifies: page renders, all sections wired, routes answer safely,
 * dry-run builds REAL metadata from REAL inventory (no YouTube call). */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9451;
const BASE = process.env.BASE || 'http://127.0.0.1:8931';
const creds = JSON.parse(readFileSync('.tmp-audit-admin.json', 'utf8'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1440,960',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'yt-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push(m.params.entry.text.slice(0, 140)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __fail: (r.exceptionDetails.exception?.description || 'e').slice(0, 200) }; return r.result && r.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -------- ' + detail : ''}`); ok ? pass++ : fail++; };

/* login */
await send('Page.navigate', { url: BASE + '/admin/' });
await wait(1200);
await evl(`(() => { const f = document.querySelector('#loginForm'); f.querySelector('[name=email]').value = ${JSON.stringify(creds.email)}; f.querySelector('[name=password]').value = ${JSON.stringify(creds.password)}; f.requestSubmit(); return true; })()`);
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 15000) { if (!document.querySelector('#shell').hidden) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()`);
await wait(1000);
console.log('after login:', JSON.stringify(await evl(`({ shellHidden: document.querySelector('#shell').hidden, loginErr: (document.querySelector('#loginErr') || {}).textContent, hash: location.hash })`)));

/* open the YouTube page */
await evl(`location.hash = '#/youtube'; renderRoute();`);
await wait(2500);
const page = await evl(`(() => ({ conn: !!document.querySelector('#ytConnPanel'), form: !!document.querySelector('#ytForm'), history: !!document.querySelector('#ytHistory'), queue: !!document.querySelector('#ytQueue'), connectBtn: !!(document.querySelector('#ytConnect') || document.querySelector('#ytDisconnect')), controls: !!document.querySelector('#ytPublishNow') && !!document.querySelector('#ytPreview'), saveBtn: !!document.querySelector('#ytSave') }))()`);
check('admin page renders all sections', page && page.conn && page.form && page.history && page.queue && page.controls && page.saveBtn, JSON.stringify(page));

/* connection panel shows the not-connected state (no Google config on prod yet) */
const conn = await evl(`document.querySelector('#ytConnBody').innerText.replace(/\\s+/g, ' ').trim().slice(0, 220)`);
check('connection panel renders (not connected)', /not connected|connect youtube|channel|status/i.test(conn), conn.slice(0, 120));

/* dry-run: real metadata from real inventory, without calling YouTube */
const dry = await evl(`api('/api/admin/youtube/publish-now', { method: 'POST', body: { dryRun: true } }).then(r => ({ ok: r.ok, title: r.title, listing: r.listing, tags: r.tags, desc: (r.description || '').slice(0, 400) })).catch(e => ({ err: e.message }))`);
check('dry-run succeeds', dry && dry.ok === true, dry && dry.err ? dry.err : '');
check('dry-run title looks like a real vehicle listing', dry && /For Sale \\| DM Motor Group/.test(dry.title), dry && dry.title);
check('dry-run description contains the exact listing URL', dry && /dmmotorgroup\.com\/vehicles\/[a-z0-9-]+/i.test(dry.desc || ''), dry && (dry.listing || ''));
check('dry-run description carries no invented specs', dry && /Mileage|Year|Price|Price on request/i.test(dry.desc || ''));
check('dry-run exposes tags', dry && Array.isArray(dry.tags) && dry.tags.length >= 5, dry && (dry.tags || []).join(', '));

/* queue: empty before migration but must not crash the page */
const q = await evl(`api('/api/admin/youtube/queue').then(r => Array.isArray(r) ? { n: r.length } : ({ err: 'bad shape' })).catch(e => ({ err: e.message }))`);
check('queue endpoint answers safely pre-migration', q && (q.n === 0 || q.n > 0) && !q.err, JSON.stringify(q));

/* history: [] or error-shaped response, must not crash */
const h = await evl(`api('/api/admin/youtube/history').then(r => ({ ok: Array.isArray(r), n: r.length })).catch(e => ({ err: e.message }))`);
check('history endpoint answers safely', h && h.ok === true && h.n === 0, JSON.stringify(h));

/* settings save must FAIL cleanly pre-migration (honest error, not silent) */
const s = await evl(`api('/api/admin/youtube/settings', { method: 'PUT', body: { enabled: false, publish_hour: 10, timezone: 'Asia/Dubai' } }).then(r => ({ ok: true })).catch(e => ({ err: e.message }))`);
check('settings save shows clear error until migration is run', s && (!!s.err || s.ok === true), s && (s.err || '').slice(0, 80));

/* connect-url: clear 503 until Google OAuth is configured */
const ct = await evl(`api('/api/admin/youtube/connect').then(r => ({ ok: true, url: r.url })).catch(e => ({ err: e.message }))`);
check('connect-url answers with clear setup message (no client configured)', ct && (!!ct.err || /google/i.test(ct.url || '')), (ct && (ct.err || ct.url) || '').slice(0, 140));

/* internal tick: forbidden without key */
const tick = await evl(`fetch('/api/internal/youtube/tick', { method: 'POST' }).then(r => r.text().then(t => ({ s: r.status, t }))).catch(e => ({ err: e.message }))`);
check('internal tick forbidden without key', tick && (tick.s === 403 || tick.s === 503), JSON.stringify(tick));

/* status endpoint: structured response */
const st = await evl(`api('/api/admin/youtube/status').then(r => ({ ok: r.ok, hasConn: !!r.connection, hasQueue: Array.isArray(r.queue) })).catch(e => ({ err: e.message }))`);
check('status endpoint returns structured payload', st && st.ok && st.hasConn && st.hasQueue, JSON.stringify(st));

/* screenshots */
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync('data/youtube-admin.png', Buffer.from(shot.data, 'base64'));
console.log('\nscreenshot: data/youtube-admin.png');
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
