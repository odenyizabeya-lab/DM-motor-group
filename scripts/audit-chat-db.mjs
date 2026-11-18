import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
}
(async () => {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_KEY;
  const convs = await fetch(url + '/rest/v1/ai_conversations?channel=eq.web&select=id,reply_token,created_at&order=created_at.desc&limit=20', { headers: { apikey: key, Authorization: 'Bearer ' + key } }).then((r) => r.json());
  console.log('web conversations:', convs.length);
  for (const c of convs) {
    const msgs = await fetch(url + '/rest/v1/ai_messages?conversation_id=eq.' + c.id + '&select=id,direction,body_text&order=id', { headers: { apikey: key, Authorization: 'Bearer ' + key } }).then((r) => r.json());
    console.log(' ', c.id.slice(0, 8), 'msgs=' + msgs.length, msgs.map((m) => m.direction === 'inbound' ? 'C' : 'A').join(''), '|', String(msgs[0] && msgs[0].body_text || '').slice(0, 40));
  }
  const ids = convs.map((c) => c.id);
  if (ids.length) {
    await fetch(url + '/rest/v1/ai_messages?conversation_id=in.(' + ids.join(',') + ')', { method: 'DELETE', headers: { apikey: key, Authorization: 'Bearer ' + key } });
    await fetch(url + '/rest/v1/ai_conversations?id=in.(' + ids.join(',') + ')', { method: 'DELETE', headers: { apikey: key, Authorization: 'Bearer ' + key } });
    console.log('deleted', ids.length, 'test conversations');
  }
  process.exit(0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
