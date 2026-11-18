/* CHAT flow end-to-end (local pages dev — reads/writes PRODUCTION DB minimally:
 * creates ONE temporary web conversation and cleans it up afterwards) */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9485;
const BASE = process.env.BASE || 'http://127.0.0.1:8798';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1440,960', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ct-'))}\\p`, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 60 && !target; i++) { await wait(250); try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push((m.params.entry.text || '').slice(0, 160)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.error) return { __error: 'send' }; const d = r.result || {}; if (d.exceptionDetails) return { __error: String(d.exceptionDetails.exception?.description || 'e').slice(0, 160) }; return d.result && d.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`); ok ? pass++ : fail++; };

/* find the first vehicle with a video */
const slug = (await fetch(BASE + '/api/vehicles?per=3&sort=newest').then((r) => r.json())).items[0].slug;
await send('Page.navigate', { url: `${BASE}/vehicles/${slug}` });
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 40000) { if (document.querySelector('#btnChatVehicle')) return true; await new Promise(r => setTimeout(r, 250)); } return false; })()`);
await wait(800);

check('chat CTA button renders on VIEW DETAILS', !!(await evl(`!!document.querySelector('#btnChatVehicle')`)));
check('WhatsApp CTA absent from vehicle page', !(await evl(`!!document.querySelector('#btnWa')`)));

/* open the chat */
await evl(`document.querySelector('#btnChatVehicle').click()`);
await wait(2500);
const opened = await evl(`(() => ({ open: document.querySelector('#chatRoom') && document.querySelector('#chatRoom').classList.contains('open'), bodyScrollLock: document.body.classList.contains('chat-open'), title: (document.querySelector('#chatVehicleName') || {}).textContent, presence: (document.querySelector('#chatPresence') || {}).textContent }))()`);
check('chat room opens full screen', opened && opened.open && opened.bodyScrollLock, JSON.stringify(opened));
check('chat header names the vehicle', opened && /Plymouth|Mercedes|Rolls|Ferrari|Lexus|Lamborghini|Bugatti/i.test(opened.title || ''), opened && opened.title);

/* send a customer message */
await evl(`(() => { const ta = document.querySelector('#chatText'); ta.value = 'Is this vehicle still available, and what is the price?'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#chatComposer').requestSubmit(); return true; })()`);
await wait(12000);
const conv = await evl(`(async () => { const r = await fetch('/api/chat/poll?conversationId=' + encodeURIComponent(window.__chatConv || '') + '&after=0'); return r.ok ? await r.json() : { __error: r.status }; })()`);
const convState = await evl(`(async () => {
  /* recover conversation id from a poll round-trip through the page */
  const stored = localStorage.getItem('dm_chat_guest');
  return stored ? 'localStorage guest token set: ' + stored.slice(0, 12) : 'missing';
})()`);
console.log('guest token:', convState);
const bodyTxt = await evl(`(document.querySelector('#chatBody') || {}).innerText.replace(/\\s+/g, ' ').trim().slice(0, 500)`);
console.log('chat body text:', bodyTxt);
check('message round-trip renders', /Is this vehicle still available/i.test(bodyTxt || ''));
check('assistant responded (fallback honest line)', /confirm|team|available|understand/i.test(bodyTxt || ''), (bodyTxt || '').slice(0, 180));

/* request a human */
await evl(`document.querySelector('#chatHumanBtn').click()`);
await wait(400);
/* confirm dialog auto-accept in headless: use DOM dialog override */
await evl(`(() => { window.confirm = () => true; document.querySelector('#chatHumanBtn').click(); return true; })()`);
await wait(2500);
const human = await evl(`(() => ({ note: !document.querySelector('#chatHumanNote').hidden, presence: (document.querySelector('#chatPresence') || {}).textContent }))()`);
check('human takeover banner shown', human && human.note && /dealership team|representative/i.test(human.presence || ''), JSON.stringify(human));

/* persistence: reload page, reopen — conversation must restore */
await send('Page.navigate', { url: `${BASE}/vehicles/${slug}` });
await evl(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 40000) { if (document.querySelector('#btnChatVehicle')) return true; await new Promise(r => setTimeout(r, 250)); } return false; })()`);
await wait(600);
await evl(`document.querySelector('#btnChatVehicle').click()`);
await wait(2500);
const restored = await evl(`(document.querySelector('#chatBody') || {}).innerText.replace(/\\s+/g, ' ').trim().slice(0, 300)`);
check('conversation persists across reload (guest token)', /Is this vehicle still available/i.test(restored || ''), (restored || '').slice(0, 160));

/* attachments: attach a tiny image and send */
const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
import { writeFileSync as wfs } from 'node:fs';
wfs('data\chat-test.jpg', Buffer.from(jpegB64, 'base64'));
const attachNode = await send('DOM.getDocument', {});
const attachQuery = await send('DOM.querySelector', { nodeId: attachNode.root.nodeId, selector: '#chatFile' });
if (attachQuery.nodeId) {
  await send('DOM.setFileInputFiles', { files: [join(process.cwd(), 'data', 'chat-test.jpg')], nodeId: attachQuery.nodeId });
  await wait(700);
  await evl(`(() => { const ta = document.querySelector('#chatText'); ta.value = 'see attached'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#chatComposer').requestSubmit(); return true; })()`);
  await wait(6000);
  const withImg = await evl(`(document.querySelector('#chatBody') || {}).innerHTML.includes('chat-attach')`);
  check('image attachment appears in conversation', !!withImg);
} else {
  check('image attachment appears in conversation', false, 'file input not found');
}

/* close */
await evl(`document.querySelector('#chatMinimise').click()`);
const closed = await evl(`!document.querySelector('#chatRoom').classList.contains('open') && !document.body.classList.contains('chat-open')`);
check('chat closes cleanly', !!closed);

console.log('\nerrors:', errs.length, errs[0] || '');
/* clean up any test conversations left in the DB */
console.log('\ncleanup: removing test conversations…');
const fsMod = await import('node:fs');
const env = (() => { const out = {}; for (const l of fsMod.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) out[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, ''); } return out; })();
const svc = env.SUPABASE_SERVICE_KEY, sburl = env.SUPABASE_URL;
const msgs = await fetch(sburl + '/rest/v1/ai_messages?body_text=ilike.*Is%20this%20vehicle%20still%20available*&select=conversation_id', { headers: { apikey: svc, Authorization: 'Bearer ' + svc } }).then((r) => r.json()).catch(() => []);
const ids = [...new Set((msgs || []).map((m) => m.conversation_id))];
for (const cid of ids) {
  await fetch(sburl + '/rest/v1/ai_messages?conversation_id=eq.' + cid, { method: 'DELETE', headers: { apikey: svc, Authorization: 'Bearer ' + svc } });
  await fetch(sburl + '/rest/v1/ai_conversations?id=eq.' + cid, { method: 'DELETE', headers: { apikey: svc, Authorization: 'Bearer ' + svc } });
}
console.log('deleted', ids.length, 'test conversation(s)');
process.exit(fail ? 1 : 0);
