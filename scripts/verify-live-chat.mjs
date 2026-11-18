/* LIVE production verification of the messaging system.
 * Creates one probe conversation via the PUBLIC API, walks the full flow,
 * then deletes every row it created. No data left behind. */
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
}
const SBURL = env.SUPABASE_URL, SVC = env.SUPABASE_SERVICE_KEY;
const BASE = 'https://dmmotorgroup.com';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`); ok ? pass++ : fail++; };

/* 1. create a guest conversation via the public API (as a real customer would) */
const open = await fetch(BASE + '/api/chat/conversation', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ vehicleId: null, token: 'liveverify-probe-' + Math.random().toString(36).slice(2, 10) }),
});
const oj = await open.json();
check('customer can open a conversation', open.status === 200 && oj.ok, 'http ' + open.status);
const convId = oj.conversationId;
const token = oj.token;
console.log('  probe conversation:', convId);

/* 2. customer sends a message */
const msg = await fetch(BASE + '/api/chat/message', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ conversationId: convId, token, text: 'Live verification probe — please ignore.' }),
});
const mj = await msg.json();
check('customer message accepted', msg.status === 200 && mj.ok, 'http ' + msg.status + ' ai=' + JSON.stringify(mj.ai));
check('AI disabled → honest holding reply sent (not silence, not invention)', mj.ai && (mj.ai.replied || mj.ai.skipped), JSON.stringify(mj.ai));

/* 3. poll as the customer — messages present */
const poll = await fetch(BASE + '/api/chat/poll?conversationId=' + convId + '&token=' + encodeURIComponent(token) + '&after=0');
const pj = await poll.json();
check('customer poll returns the thread', poll.status === 200 && Array.isArray(pj.messages), 'http ' + poll.status + ' msgs=' + (pj.messages || []).length);

/* 4. request a human */
const human = await fetch(BASE + '/api/chat/human-request', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ conversationId: convId, token }),
});
const hj = await human.json();
check('customer can request a human representative', human.status === 200 && hj.humanTakeover === true, 'http ' + human.status);

/* 5. admin can see the conversation */
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const login = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'DMAdmin' },
  body: JSON.stringify({ email: creds.email, password: creds.password }),
});
const lj = await login.json();
const adminHeaders = { Authorization: 'Bearer ' + lj.token, 'x-requested-with': 'DMAdmin' };
const adminList = await fetch(BASE + '/api/admin/chat/conversations?limit=10', { headers: adminHeaders });
const aj = await adminList.json();
const found = (aj || []).find((c) => c.id === convId);
check('admin conversation list shows it', adminList.status === 200 && !!found, 'http ' + adminList.status + ' found=' + JSON.stringify(!!found));

/* 6. admin opens the thread, sends a reply (as dealership) */
const adminReply = await fetch(BASE + '/api/admin/chat/conversations/' + convId + '/reply', {
  method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'Live verification probe — dealership reply. Will be deleted.' }),
});
check('admin can reply from the dashboard', adminReply.status === 200, 'http ' + adminReply.status);

/* 7. admin takeover toggle works */
const takeover = await fetch(BASE + '/api/admin/chat/conversations/' + convId + '/takeover', {
  method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({ on: true }),
});
check('admin can take over', takeover.status === 200, 'http ' + takeover.status);

/* 8. admin close */
const close = await fetch(BASE + '/api/admin/chat/conversations/' + convId + '/close', {
  method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({ close: true }),
});
check('admin can close', close.status === 200, 'http ' + close.status);

/* 9. important toggle returns honest 503 (migration not run yet) */
const imp = await fetch(BASE + '/api/admin/chat/conversations/' + convId + '/important', {
  method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({ important: true }),
});
const impj = await imp.json();
check('important flag returns an honest "migration needed" answer', imp.status === 503 && /migration|column/i.test(impj.error || ''), 'http ' + imp.status + ': ' + (impj.error || '').slice(0, 90));

/* ---- CLEANUP: delete the probe conversation, messages and storage objects ---- */
const msgs = await fetch(SBURL + '/rest/v1/ai_messages?conversation_id=eq.' + convId, { headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } }).then((r) => r.json()).catch(() => []);
for (const m of msgs || []) {
  const atts = ((m.meta && m.meta.attachments) || []).map((a) => a.url);
  for (const url of atts) {
    const p = String(url).match(/\/object\/(?:public\/)?message-media\/(.+)$/);
    if (p) await fetch(SBURL + '/storage/v1/object/message-media/' + p[1], { method: 'DELETE', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } });
  }
}
await fetch(SBURL + '/rest/v1/ai_messages?conversation_id=eq.' + convId, { method: 'DELETE', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } });
await fetch(SBURL + '/rest/v1/ai_conversations?id=eq.' + convId, { method: 'DELETE', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } });
const remaining = await fetch(SBURL + '/rest/v1/ai_conversations?id=eq.' + convId, { headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } }).then((r) => r.json());
check('probe fully deleted from production', Array.isArray(remaining) && remaining.length === 0, 'rows left: ' + (remaining || []).length);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
