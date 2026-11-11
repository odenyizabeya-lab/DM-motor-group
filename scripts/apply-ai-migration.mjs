/* Apply the AI Customer Service migrations with a Supabase Personal Access
 * Token. The token is used once and never written into the website.
 *
 *   $env:SB_MGMT_TOKEN = "sbp_..."; node scripts/apply-ai-migration.mjs
 */
import { readFile } from 'node:fs/promises';

const REF = 'gevxgqdevaanmxqzverv';
const TOKEN = process.env.SB_MGMT_TOKEN || process.argv[2] || '';
if (!TOKEN) {
  console.error('Set SB_MGMT_TOKEN (or pass it as the first argument).');
  process.exit(1);
}
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function runQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: H, body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 800)}`);
  return text;
}

for (const file of ['00006_vehicle_ai_fields.sql', '00007_ai_customer_service.sql']) {
  const sql = await readFile(`supabase/migrations/${file}`, 'utf8');
  process.stdout.write(`Applying ${file} ... `);
  try { await runQuery(sql); console.log('OK'); }
  catch (e) { console.log('FAILED'); console.error(e.message); process.exit(1); }
}

/* Verify with the service-role REST key. */
const env = {};
for (const line of (await readFile('.env.local', 'utf8')).split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const headers = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
for (const table of ['ai_settings', 'ai_secrets', 'ai_conversations', 'ai_messages', 'ai_inspections', 'ai_jobs', 'ai_email_events']) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, { headers });
  console.log(`${table}: ${r.status === 200 ? 'ready' : `ERROR ${r.status}`}`);
}
const rpc = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ai_claim_jobs`, {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_limit: 0 }),
});
console.log(`ai_claim_jobs RPC: ${rpc.status === 200 ? 'ready' : `ERROR ${rpc.status}`}`);
console.log('MIGRATIONS APPLIED');
