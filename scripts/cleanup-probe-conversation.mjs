import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
}
(async () => {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_KEY;
  for (const [t, col] of [['ai_messages', 'conversation_id'], ['ai_conversations', 'id']]) {
    const r = await fetch(url + '/rest/v1/' + t + '?' + col + '=eq.f9b37a36-e183-4532-8ece-09125234db33', {
      method: 'DELETE',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=representation' },
    });
    console.log(t, '->', r.status, JSON.stringify(await r.json()));
  }
  process.exit(0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
