/* Inspect leftovers via the Management API SQL endpoint. */
const TOKEN = process.env.SB_MGMT_TOKEN;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const run = (sql) =>
  fetch('https://api.supabase.com/v1/projects/gevxgqdevaanmxqzverv/database/query', {
    method: 'POST', headers: H, body: JSON.stringify({ query: sql }),
  });

const res = await run(
  'select id,name,email,type,status,vehicle_id from public.enquiries;' +
  'select id,actor,action,detail from public.activity_logs;'
);
const out = await res.json();
console.log(JSON.stringify(out, null, 1).slice(0, 1200));
