/* Configure Supabase auth for production: site URL + dmmotorgroup.com redirect. */
const TOKEN = process.env.SB_MGMT_TOKEN;
const REF = 'gevxgqdevaanmxqzverv';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const url = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const res = await fetch(url, {
  method: 'PATCH', headers: H,
  body: JSON.stringify({
    site_url: 'https://dmmotorgroup.com',
    redirect_allow_list: [
      'https://dmmotorgroup.com/**',
      'https://www.dmmotorgroup.com/**',
      'http://localhost:8788/**',
    ],
  }),
});
const body = await res.text();
console.log(res.status, body.slice(0, 200) || 'auth config updated');

/* read-back */
const cur = await fetch(url, { headers: H });
const cfg = await cur.json();
console.log('site_url:', cfg.site_url);
console.log('allow list:', JSON.stringify(cfg.redirect_allow_list));
