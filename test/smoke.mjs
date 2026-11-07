/* = Smoke test against production (real Supabase, no demo data) =============
 * Runs the full write+read cycle, then deletes every artifact it created so
 * the database is pristine for the owner's real registration.
 * Recoverable after failures: cleans PREVIOUS leftovers first.
 * Usage: node test/smoke.mjs [base-url]
 * ======================================================================== */
import { readFile } from 'node:fs/promises';

const BASE = process.argv[2] || 'https://dm-motor-group.pages.dev';
const env = {};
for (const l of (await readFile('.env.local', 'utf8')).trim().split('\n')) {
  const i = l.indexOf('='); env[l.slice(0, i)] = l.slice(i + 1);
}
const SERVICE = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const api = async (method, path, { token, body, raw, headers = {} } = {}) => {
  const h = { 'X-Requested-With': 'DMSmoke', ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  if (raw) h['Content-Type'] = headers['Content-Type'] || 'image/png';
  else if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers: h,
    body: raw ? raw : (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
};

const direct = async (method, table, match = null) => {
  const qs = match ? '?' + new URLSearchParams(match).toString() : '';
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${qs}`, {
    method, headers: { ...SERVICE, Prefer: 'return=minimal' },
  });
  return res.status;
};

const EMAIL = 'smoke-test-owner@dmmotorgroup.example';
const PASSWORD = 'SmokeTest#2026';

/* ---------- 0: establish an admin token (login if possible, else fresh
 * registration — a fresh DB registration is the owner-bootstrap admin) ---- */
let r = await api('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
let freshAdmin = false;
if (!(r.status === 200 && r.data?.token)) {
  r = await api('POST', '/api/auth/register', { body: { email: EMAIL, password: PASSWORD, name: 'Smoke Owner' } });
  freshAdmin = true;
}
ok('admin session established', r.status === 200 && r.data?.token, JSON.stringify(r.data));
ok('account is admin (owner bootstrap)', r.data?.user?.role === 'admin', 'role=' + r.data?.user?.role);
const ADMIN = r.data?.token;

/* ---------- 1: pre-clean leftovers from any previous run ------------------ */
r = await api('GET', '/api/admin/vehicles?q=Smoke', { token: ADMIN });
for (const v of r.data || []) await api('DELETE', `/api/admin/vehicles/${v.id}`, { token: ADMIN });
r = await api('GET', '/api/admin/vehicles');
ok('pre-clean: no smoke vehicles', !(r.data || []).some?.((v) => String(v.brand).includes('Smoke')), `remaining=${(r.data || []).length}`);

/* ---------- 2: auth contract --------------------------------------------- */
r = await api('GET', '/api/auth/me', { token: ADMIN });
ok('auth/me identifies admin', r.data?.user?.email === EMAIL && r.data?.user?.role === 'admin');
if (freshAdmin) {
  r = await api('POST', '/api/auth/register', { body: { email: EMAIL, password: PASSWORD, name: 'Again' } });
  ok('duplicate register → 409', r.status === 409, 'status=' + r.status);
}
r = await api('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
ok('login → token', r.status === 200 && r.data?.token);
r = await api('POST', '/api/auth/login', { body: { email: EMAIL, password: 'wrong-password-1' } });
ok('bad login → 401', r.status === 401);
r = await api('POST', '/api/admin/vehicles', { body: { brand: 'X', model: 'Y', year: 2020 } });
ok('anon vehicle create → 401', r.status === 401);

/* ---------- 3: vehicle lifecycle ----------------------------------------- */
r = await api('POST', '/api/admin/vehicles', { token: ADMIN, body: {
  brand: 'Smoke Motor', model: 'Test GT', year: 2024, price: 123456, currency: 'USD',
  mileage: 100, transmission: 'Automatic', fuel: 'Petrol', bodyType: 'SUV',
  exteriorColor: 'Black', vin: 'SMOKE0001TEST', condition: 'New', location: 'Test City',
  description: 'Smoke test vehicle — will be deleted.',
  features: ['Feature A', 'Feature B'], safetyFeatures: ['ABS'],
  category: 'suv', isFeatured: true, status: 'draft',
}});
ok('create vehicle → id + slug', r.status === 200 && r.data?.id && r.data?.slug, JSON.stringify(r.data));
const VID = r.data.id; const SLUG = r.data.slug;

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
r = await api('PUT', `/api/admin/upload?vehicleId=${VID}&type=image&filename=front.png&caption=Front`, { token: ADMIN, raw: png });
ok('upload image → media id + url', r.status === 200 && r.data?.id && String(r.data?.url).includes('/storage/v1/object/public/vehicle-media/'), JSON.stringify(r.data));
ok('first image auto-cover', r.data?.cover === true);
const MEDIA_ID = r.data?.id;
const MEDIA_URL = r.data?.url;

r = await api('GET', `/api/admin/vehicles/${VID}`, { token: ADMIN });
ok('admin vehicle detail has media (camelCase)', Array.isArray(r.data?.media) && r.data.media.length === 1 && r.data.media[0].thumbUrl !== undefined);
ok('admin detail coverMediaId set', r.data?.coverMediaId === MEDIA_ID);

r = await api('PUT', `/api/admin/media/${MEDIA_ID}`, { token: ADMIN, body: { caption: 'Front view' } });
ok('media caption update', r.status === 200);
r = await api('PUT', `/api/admin/media/${MEDIA_ID}/thumb`, { token: ADMIN, raw: png, headers: { 'Content-Type': 'image/webp' } });
ok('thumbnail upload', r.status === 200, JSON.stringify(r.data));
r = await api('POST', `/api/admin/vehicles/${VID}/reorder`, { token: ADMIN, body: { ids: [MEDIA_ID] } });
ok('reorder media', r.status === 200);

r = await api('POST', `/api/admin/vehicles/${VID}/status`, { token: ADMIN, body: { status: 'published' } });
ok('publish vehicle', r.status === 200 && r.data?.status === 'published');

/* ---------- 4: public visibility ----------------------------------------- */
await new Promise((res) => setTimeout(res, 600));
r = await api('GET', '/api/vehicles?brand=Smoke+Motor');
ok('public search finds it', r.data?.total === 1 && r.data?.items?.[0]?.slug === SLUG);
r = await api('GET', '/api/vehicles?q=Test');
ok('search by text finds it', r.data?.total >= 1);
r = await api('GET', `/api/vehicles/${SLUG}`);
ok('public detail → media + featured flag', r.data?.media?.length === 1 && Array.isArray(r.data?.similar) && r.data?.isFeatured === true);

r = await api('GET', '/api/home');
ok('home stats count the vehicle', r.data?.stats?.published >= 1, JSON.stringify(r.data?.stats));
ok('home featured contains it', (r.data?.featured || []).some((v) => v.id === VID));
ok('home settings live', r.data?.settings?.dealership_name === 'DM Motor Group');

const sm = await fetch(BASE + '/sitemap.xml').then((x) => x.text());
ok('sitemap lists vehicle', sm.includes(SLUG));

/* ---------- 5: enquiry lifecycle ----------------------------------------- */
r = await api('POST', '/api/enquiries', { body: {
  name: 'Smoke Enquirer', email: 'enquirer@example.com', phone: '+99 000111',
  message: 'Please send me the full smoke test inspection report.', type: 'inspection', vehicleId: VID,
}});
ok('enquiry accepted', r.status === 200 && r.data?.ok === true, JSON.stringify(r.data));
const ENQ_ID = r.data?.id;
r = await api('POST', '/api/enquiries', { body: {
  name: 'Smoke Enquirer', email: 'enquirer@example.com',
  message: 'Please send me the full smoke test inspection report.', type: 'inspection', vehicleId: VID,
}});
ok('duplicate enquiry silent-ok', r.status === 200);
r = await api('POST', '/api/enquiries', { body: { name: 'x', email: 'bad', message: 'hi' } });
ok('invalid enquiry → 400', r.status === 400);

r = await api('GET', '/api/admin/enquiries', { token: ADMIN });
const enq = (r.data || []).find?.((e) => e.id === ENQ_ID);
ok('admin enquiry list + vehicle fields flattened', !!enq && enq.brand === 'Smoke Motor' && enq.status === 'new');
r = await api('PUT', `/api/admin/enquiries/${ENQ_ID}`, { token: ADMIN, body: { status: 'contacted', respond: 'Report sent, thank you.' } });
ok('admin respond to enquiry', r.status === 200);

/* ---------- 6: favourites + reservation ---------------------------------- */
r = await api('POST', '/api/favourites', { token: ADMIN, body: { vehicleId: VID } });
ok('add favourite', r.status === 200);
r = await api('GET', '/api/favourites', { token: ADMIN });
ok('favourites list contains it', Array.isArray(r.data) && r.data.some((v) => v.id === VID));
r = await api('DELETE', `/api/favourites/${VID}`, { token: ADMIN });
ok('remove favourite', r.status === 200);

r = await api('POST', '/api/orders', { token: ADMIN, body: { vehicleId: VID, type: 'reservation', notes: 'Smoke reservation' } });
ok('order request → id', r.status === 200 && r.data?.id, JSON.stringify(r.data));
const ORDER_ID = r.data?.id;
r = await api('GET', '/api/my/orders', { token: ADMIN });
ok('my orders lists it', (r.data || []).some?.((o) => o.id === ORDER_ID));
r = await api('GET', '/api/admin/orders', { token: ADMIN });
ok('admin orders list', (r.data || []).some?.((o) => o.id === ORDER_ID));
await api('PUT', `/api/admin/orders/${ORDER_ID}`, { token: ADMIN, body: { status: 'deposit_paid' } });
r = await api('GET', `/api/vehicles/${SLUG}`);
ok('deposit paid → vehicle reserved', r.data?.status === 'reserved');

/* ---------- 7: dashboards ------------------------------------------------ */
r = await api('GET', '/api/admin/stats', { token: ADMIN });
ok('admin stats', r.status === 200 && typeof r.data?.drafts === 'number' && r.data?.photos >= 1, JSON.stringify(r.data));
r = await api('PUT', '/api/admin/settings', { token: ADMIN, body: { tagline: 'Premium international automobile dealership' } });
ok('settings update', r.status === 200);
r = await api('GET', '/api/admin/settings', { token: ADMIN });
ok('settings read-back', r.data?.site_url === 'https://dmmotorgroup.com');
r = await api('GET', '/api/admin/activity?limit=20', { token: ADMIN });
ok('activity log populated', Array.isArray(r.data) && r.data.length >= 3 && r.data.some((a) => a.action === 'vehicle_created'));

/* ---------- 8: full teardown (everything through real APIs) -------------- */
if (MEDIA_URL) {
  const st = await fetch(MEDIA_URL, { method: 'GET' });
  ok('image stored & publicly readable', st.status === 200);
}
r = await api('DELETE', `/api/admin/vehicles/${VID}`, { token: ADMIN });
ok('delete vehicle', r.status === 200);
await new Promise((res) => setTimeout(res, 900));
r = await api('GET', '/api/vehicles?brand=Smoke+Motor');
ok('vehicle gone from public', r.data?.total === 0);
if (MEDIA_URL) {
  let gone = false;
  for (let i = 0; i < 12 && !gone; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    /* storage edge CDN may serve a cached copy; bypass it */
    gone = (await fetch(`${MEDIA_URL}?cb=${`${i}-${Date.now()}`}`, { method: 'GET' })).status !== 200;
  }
  ok('stored image deleted from bucket', gone, 'origin still returns the object after 25s');
}
r = await api('GET', '/api/admin/enquiries', { token: ADMIN });
const enqLeft = (r.data || []).find?.((e) => e.id === ENQ_ID);
/* FK is on-delete-set-null: the enquiry thread survives history by design */
ok('enquiry kept with vehicle detached (history preserved)', !enqLeft || enqLeft.vehicle_id === null, JSON.stringify(enqLeft));

r = await api('GET', '/api/admin/vehicles');
if (!(Array.isArray(r.data) && r.data.length === 0)) {
  /* fresh session for the final pristine check (auth service may have throttled) */
  const login2 = await api('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  if (login2.status === 200 && login2.data?.token) {
    const r2 = await api('GET', '/api/admin/vehicles', { token: login2.data.token });
    r = r2;
  }
}
ok('database pristine again', Array.isArray(r.data) && r.data.length === 0, `payload=${JSON.stringify(r.data).slice(0, 200)}`);

/* delete the smoke auth user LAST (token dies with it) */
const res2 = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(EMAIL)}&select=id`, { headers: SERVICE });
const pr = await res2.json();
if (pr?.[0]) await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${pr[0].id}`, { method: 'DELETE', headers: SERVICE });
await direct('DELETE', 'enquiries', { email: 'eq.enquirer@example.com' });
await direct('DELETE', 'activity_logs', { detail: 'ilike.*smoke*' });
await direct('DELETE', 'activity_logs', { actor: `eq.${EMAIL}` });
console.log('(teardown: smoke auth user + logs removed)');

console.log(`\n${pass} passed, ${fail} failed — ${BASE}`);
process.exit(fail ? 1 : 0);
