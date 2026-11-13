/* PRESENT / NOT PRESENT audit of the live site.
 * 1. Public routes: does each exist and serve real content?
 * 2. Database completeness: every field on every published vehicle.
 * 3. Media integrity: media attached, orphans, missing.
 * 4. Platform features that depend on keys / migrations. */
import fs from 'node:fs';

const BASE = 'https://dmmotorgroup.com';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY };
const base = env.SUPABASE_URL + '/rest/v1/';

/* ---------- 1. routes ---------- */
const ROUTES = [
  ['/', 'home'], ['/videos', 'video showroom'], ['/vehicles', 'vehicle listings'],
  ['/contact', 'contact / enquiry'], ['/about', 'about page'], ['/privacy', 'privacy policy'],
  ['/terms', 'terms of sale'], ['/admin', 'admin dashboard'], ['/admin/login', 'admin login'],
  ['/api/home', 'home data api'], ['/api/videos', 'video api'], ['/api/vehicles', 'listings api'],
  ['/api/meta', 'filters api'], ['/api/settings/public', 'public settings'],
  ['/api/inspections', 'inspection booking api'], ['/api/webhooks/resend', 'inbound email webhook'],
  ['/manifest.webmanifest', 'PWA manifest'], ['/sw.js', 'service worker'], ['/robots.txt', 'robots.txt'],
];
console.log('=== ROUTES');
for (const [p, label] of ROUTES) {
  try {
    const r = await fetch(BASE + p, { headers: { accept: 'text/html,application/json' } });
    const body = await r.text();
    const kind = r.headers.get('content-type') || '';
    const empty = body.trim().length < 40;
    console.log(`${r.status === 200 && !empty ? 'PRESENT' : 'MISSING'}  ${String(r.status).padEnd(4)} ${p.padEnd(26)} ${label.padEnd(24)} ${kind.split(';')[0].padEnd(18)} ${empty ? 'EMPTY BODY' : body.length + ' bytes'}`);
  } catch (e) { console.log(`ERROR    ---- ${p} (${String(e).slice(0, 50)})`); }
}

/* ---------- 2. database completeness ---------- */
const veh = await fetch(base + 'vehicles?select=*&status=eq.published', { headers: H }).then((r) => r.json());
const media = await fetch(base + 'media?select=id,vehicle_id,type,url', { headers: H }).then((r) => r.json());
const FIELDS = ['price', 'mileage', 'engine', 'transmission', 'fuel', 'body_type', 'exterior_color',
  'interior_color', 'vin', 'condition', 'registration', 'location', 'description', 'features',
  'safety_features', 'ownership_info', 'inspection_report', 'cover', 'category'];
console.log('\n=== LISTING FIELD COMPLETENESS (of ' + veh.length + ' published vehicles)');
for (const f of FIELDS) {
  let filled = 0;
  for (const v of veh) {
    const val = v[f];
    if (val == null) continue;
    if (Array.isArray(val)) { if (val.length) filled++; continue; }
    if (String(val).trim() === '') continue;
    if (f === 'price' && Number(val) <= 0) continue;
    filled++;
  }
  const pct = Math.round((filled / veh.length) * 100);
  console.log(`${String(filled).padStart(3)}/${veh.length}  ${String(pct).padStart(3)}%  ${f}`);
}

/* ---------- 3. media integrity ---------- */
const ids = new Set(veh.map((v) => v.id));
const orphan = media.filter((m) => !ids.has(m.vehicle_id));
const withVid = veh.filter((v) => media.some((m) => m.vehicle_id === v.id && m.type === 'video'));
const withPic = veh.filter((v) => media.some((m) => m.vehicle_id === v.id && m.type === 'image'));
const noMedia = veh.filter((v) => !media.some((m) => m.vehicle_id === v.id));
console.log('\n=== MEDIA');
console.log('vehicles with a video: ' + withVid.length + '/' + veh.length);
console.log('vehicles with a photo: ' + withPic.length + '/' + veh.length);
console.log('vehicles with no media at all: ' + noMedia.length);
console.log('media rows pointing at a non-published vehicle: ' + orphan.length);
const brokenCover = veh.filter((v) => !v.cover).length;
console.log('vehicles with no cover image: ' + brokenCover);

/* ---------- 4. platform dependencies ---------- */
console.log('\n=== PLATFORM DEPENDENCIES');
console.log('Gemini key present: ' + (/GEMINI/i.test(fs.readFileSync('.env.local', 'utf8')) ? 'yes' : 'NO'));
console.log('OpenAI key present: ' + (/OPENAI/i.test(fs.readFileSync('.env.local', 'utf8')) ? 'yes' : 'NO'));
console.log('Resend key present: ' + (/RESEND/i.test(fs.readFileSync('.env.local', 'utf8')) ? 'yes' : 'NO'));
const mig = fs.existsSync('supabase/migrations') ? fs.readdirSync('supabase/migrations').sort() : [];
console.log('migration files in repo: ' + mig.join(', '));
for (const t of ['ai_jobs', 'inspections', 'vehicles', 'media', 'settings']) {
  const ok = await fetch(base + t + '?select=*&limit=1', { headers: H }).then((r) => r.status < 300).catch(() => false);
  console.log(`table "${t}" reachable in the live database: ${ok ? 'yes' : 'NO (migration not applied)'}`);
}
