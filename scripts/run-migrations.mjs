/* Apply supabase/migrations/*.sql to the project via the Management API. */
import { readFile, readdir } from 'node:fs/promises';

const TOKEN = process.env.SB_MGMT_TOKEN;
const REF = 'gevxgqdevaanmxqzverv';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function runQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: H, body: JSON.stringify({ query: sql }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${txt.slice(0, 500)}`);
  return txt;
}

const files = (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  const sql = await readFile(`supabase/migrations/${f}`, 'utf8');
  try {
    await runQuery(sql);
    console.log(`✔ ${f} applied`);
  } catch (e) {
    console.error(`✗ ${f}: ${e.message}`);
    process.exit(1);
  }
}
console.log('ALL MIGRATIONS APPLIED');
