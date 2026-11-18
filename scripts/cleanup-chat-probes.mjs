import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
}
(async () => {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_KEY;
  const list = await fetch(url + '/rest/v1/ai_conversations?channel=eq.web&select=id,reply_token,created_at', { headers: { apikey: key, Authorization: 'Bearer ' + key } }).then((r) => r.json());
  console.log('web conversations before cleanup:', list.length);
  const ids = list.map((c) => c.id);
  /* delete storage objects for these conversations */
  for (const cid of ids) {
    const objs = await fetch(url + '/storage/v1/object/list/message-media', {
      method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: 'messages/' + cid + '/', limit: 100 }),
    }).then((r) => r.json()).catch(() => []);
    if (Array.isArray(objs) && objs.length) {
      const names = objs.map((o) => 'messages/' + cid + '/' + o.name);
      await fetch(url + '/storage/v1/object/message-media', {
        method: 'DELETE', headers: { apikey: key, Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: names }),
      });
      console.log('  deleted', names.length, 'storage object(s) for', cid.slice(0, 8));
    }
  }
  if (ids.length) {
    await fetch(url + '/rest/v1/ai_messages?conversation_id=in.(' + ids.join(',') + ')', { method: 'DELETE', headers: { apikey: key, Authorization: 'Bearer ' + key } });
    await fetch(url + '/rest/v1/ai_conversations?id=in.(' + ids.join(',') + ')', { method: 'DELETE', headers: { apikey: key, Authorization: 'Bearer ' + key } });
  }
  console.log('deleted', ids.length, 'conversations and their storage/files');
  process.exit(0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
