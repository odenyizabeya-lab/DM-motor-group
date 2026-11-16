/* =====================================================================
   FULL PROJECT AUDIT - measured, not assumed.
   Checks: public routes, customer routes, admin routes, API endpoints
   (auth + unauth), database table/field completeness, media coverage,
   broken navigation links, mobile stability, security posture.
   Writes data/AUDIT-REPORT.md and prints a compact summary.
   ===================================================================== */
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const BASE = 'https://dmmotorgroup.com';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY };
const out = [];
const log = (s = '') => { out.push(s); console.log(s); };

/* ---------- 1. PUBLIC + CUSTOMER ROUTES ---------- */
const ROUTES = [
  ['/', 'home'], ['/vehicles', 'showroom'], ['/videos', 'video showroom'],
  ['/contact', 'contact'], ['/about', 'about'], ['/faq', 'faq'], ['/terms', 'terms'],
  ['/privacy', 'privacy'], ['/refund', 'refund policy'], ['/delivery', 'delivery info'],
  ['/support', 'customer support'], ['/account', 'customer dashboard'],
  ['/compare', 'compare'], ['/admin', 'admin'], ['/admin/login', 'admin login'],
];
log('## 1. PAGES');
const pageStatus = {};
for (const [p, label] of ROUTES) {
  const r = await fetch(BASE + p, { headers: { accept: 'text/html' } });
  pageStatus[p] = r.status;
  log(`| ${p.padEnd(14)} | ${label.padEnd(20)} | ${r.status === 200 ? 'OK' : 'MISSING (' + r.status + ')'} |`);
}

/* ---------- 2. API ENDPOINTS ---------- */
log('\n## 2. API ENDPOINTS (unauthenticated behaviour)');
const API = [
  ['GET', '/api/health'], ['GET', '/api/home'], ['GET', '/api/meta'], ['GET', '/api/vehicles'],
  ['GET', '/api/vehicles/plymouth-barracuda-1970'], ['GET', '/api/videos'], ['GET', '/api/testimonials'],
  ['GET', '/api/payment-methods/bank-accounts'], ['GET', '/api/payments/lookup?reference=DMG-20260101-FAKE0001'],
  ['GET', '/api/auth/me'], ['GET', '/api/favourites'], ['GET', '/api/notifications'],
  ['GET', '/api/my/enquiries'], ['GET', '/api/my/orders'],
  ['GET', '/api/admin/stats'], ['GET', '/api/admin/vehicles'], ['GET', '/api/admin/settings'],
  ['GET', '/api/admin/enquiries'], ['GET', '/api/admin/payments'], ['GET', '/api/admin/bank-accounts'],
  ['GET', '/api/admin/integrations'], ['GET', '/api/admin/ai/status'], ['GET', '/api/admin/activity'],
];
const apiStatus = {};
for (const [m, p] of API) {
  const r = await fetch(BASE + p, { method: m });
  apiStatus[p] = r.status;
  const note = r.status === 401 ? 'protected (login required)' : r.status === 404 ? 'NOT AVAILABLE' : 'public';
  log(`| ${String(r.status).padEnd(4)} | ${p.padEnd(52)} | ${note} |`);
}

/* ---------- 3. DATABASE ---------- */
log('\n## 3. DATABASE');
const spec = await fetch(env.SUPABASE_URL + '/rest/v1/', { headers: { ...H, Accept: 'application/openapi+json' } }).then((r) => r.json());
const tables = Object.keys(spec.paths || {}).filter((p) => p.startsWith('/') && !p.includes('{') && !p.startsWith('/rpc/')).map((p) => p.slice(1));
log('Tables present: ' + tables.join(', '));
const expected = ['vehicles', 'media', 'enquiries', 'orders', 'profiles', 'settings', 'notifications', 'activity_logs', 'favourites', 'banners', 'testimonials', 'admin_integrations', 'enquiry_messages'];
const missing = expected.filter((t) => !tables.includes(t));
log('Missing core tables: ' + (missing.length ? missing.join(', ') : 'none'));
const mig = fs.existsSync('supabase/migrations') ? fs.readdirSync('supabase/migrations').sort() : [];
const migTables = {};
for (const f of mig) {
  const sql = fs.readFileSync('supabase/migrations/' + f, 'utf8');
  for (const m of sql.matchAll(/create table if not exists public\.(\w+)/gi)) migTables[m[1]] = f;
  for (const m of sql.matchAll(/create table if not exists public\.(\w+)[\s\S]{0,80}?;/gi)) { /* handled above */ }
}
log('Migration files: ' + mig.join(', '));
const notApplied = Object.entries(migTables).filter(([t]) => !tables.includes(t)).map(([t, f]) => t + ' (' + f + ')');
log('Declared in migrations but NOT live: ' + (notApplied.length ? notApplied.join(', ') : 'none'));

const veh = await fetch(env.SUPABASE_URL + '/rest/v1/vehicles?select=*', { headers: H }).then((r) => r.json());
const media = await fetch(env.SUPABASE_URL + '/rest/v1/media?select=id,vehicle_id,type', { headers: H }).then((r) => r.json());
const FIELDS = ['price', 'mileage', 'engine', 'transmission', 'fuel', 'body_type', 'exterior_color', 'interior_color', 'vin', 'condition', 'registration', 'location', 'description', 'features', 'safety_features', 'ownership_info', 'inspection_report'];
log('\nVehicle field completeness (of ' + veh.length + '):');
for (const f of FIELDS) {
  let n = 0;
  for (const v of veh) {
    const x = v[f];
    if (x == null) continue;
    if (Array.isArray(x)) { if (x.length) n++; continue; }
    if (String(x).trim() === '') continue;
    if (f === 'price' && Number(x) <= 0) continue;
    n++;
  }
  log(`| ${f.padEnd(20)} | ${String(n).padStart(3)}/${veh.length} | ${n === veh.length ? 'complete' : 'GAP (' + (veh.length - n) + ' vehicles)'} |` );
}
const withVid = veh.filter((v) => media.some((m) => m.vehicle_id === v.id && m.type === 'video')).length;
const withPic = veh.filter((v) => media.some((m) => m.vehicle_id === v.id && m.type === 'image')).length;
log(`Vehicles with a video: ${withVid}/${veh.length} | with a photograph: ${withPic}/${veh.length}`);
const statuses = {};
for (const v of veh) statuses[v.status] = (statuses[v.status] || 0) + 1;
log('Vehicle statuses: ' + JSON.stringify(statuses));
const orders = await fetch(env.SUPABASE_URL + '/rest/v1/orders?select=id,type,status,amount,currency', { headers: H }).then((r) => r.json());
const byType = {};
for (const o of orders) { const k = o.type + '/' + o.status; byType[k] = (byType[k] || 0) + 1; }
log('Orders by type/status: ' + JSON.stringify(byType));
const enq = await fetch(env.SUPABASE_URL + '/rest/v1/enquiries?select=id,status,type', { headers: H }).then((r) => r.json());
const enqStatus = {};
for (const e of enq) enqStatus[e.status] = (enqStatus[e.status] || 0) + 1;
log('Enquiries: ' + enq.length + ' total, statuses ' + JSON.stringify(enqStatus));
const notif = await fetch(env.SUPABASE_URL + '/rest/v1/notifications?select=id', { headers: H }).then((r) => r.json());
log('Notifications stored: ' + notif.length);

/* ---------- 4. NAVIGATION / FOOTER LINKS ---------- */
log('\n## 4. NAVIGATION LINKS THAT DO NOT RESOLVE');
const home = await fetch(BASE + '/').then((r) => r.text());
const links = [...new Set([...home.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]))];
for (const l of links) {
  if (['/', '/vehicles', '/videos', '/contact', '/admin', '/compare'].includes(l)) continue;
  const r = await fetch(BASE + l, { headers: { accept: 'text/html' } });
  if (r.status !== 200) log(`| ${l.padEnd(20)} | ${r.status} - BROKEN LINK |`);
}

/* ---------- 5. ADMIN PAGE FUNCTIONS PRESENT ---------- */
log('\n## 5. ADMIN DASHBOARD PAGES PRESENT');
const adminJs = fs.readFileSync('admin/admin.js', 'utf8');
const PAGES = { dashboard: 'dashboard', vehicles: 'vehicles', specifications: 'specifications', enquiries: 'enquiries', customers: 'customers', testimonials: 'testimonials', banners: 'banners', ai: 'AI car scanner', ai_service: 'AI customer service', integrations: 'integrations', bank_accounts: 'bank accounts', payments: 'payments', settings: 'settings', settings_general: 'settings general', settings_media: 'settings media', settings_users: 'settings users', settings_maintenance: 'settings maintenance', activity: 'activity log' };
const missingPages = [];
for (const [k, label] of Object.entries(PAGES)) {
  const present = new RegExp('\\b' + k + ':').test(adminJs) || new RegExp('function ' + k + 'Page').test(adminJs);
  if (!present) missingPages.push(label);
  log(`| ${label.padEnd(24)} | ${present ? 'present' : 'MISSING'} |`);
}
log('Admin sections missing: ' + (missingPages.length ? missingPages.join(', ') : 'none'));

/* ---------- 6. MOBILE STABILITY (real browser) ---------- */
log('\n## 6. MOBILE / LAYOUT STABILITY');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9400;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + process.env.TEMP + '\\\\audit-prof', 'about:blank'], { stdio: 'ignore' });
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try { target = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page'); } catch {}
}
let mobile = [];
if (target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  await send('Page.enable'); await send('Runtime.enable');
  for (const [w, h, label] of [[375, 812, 'Android 375'], [390, 844, 'iPhone 390'], [768, 1024, 'Tablet 768'], [1440, 900, 'Desktop 1440']]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 800 });
    for (const p of ['/', '/vehicles', '/videos', '/contact', '/vehicles/plymouth-barracuda-1970']) {
      await send('Page.navigate', { url: BASE + p });
      await new Promise((r) => setTimeout(r, 4500));
      const m = JSON.parse(await evl(`(async () => {
        let cls = 0;
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
        for (let y = 0; y <= 3000; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 400));
        return JSON.stringify({
          zoom: +(visualViewport ? visualViewport.scale : 1).toFixed(3),
          hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          cls: +cls.toFixed(3),
          imgs: document.querySelectorAll('img').length,
          vids: document.querySelectorAll('video').length,
        });
      })()`));
      const bad = [];
      if (m.zoom !== 1) bad.push('zoom ' + m.zoom);
      if (m.hScroll > 2) bad.push('hscroll ' + m.hScroll);
      if (m.cls > 0.02) bad.push('cls ' + m.cls);
      mobile.push({ label, page: p, bad: bad.join(','), imgs: m.imgs, vids: m.vids });
    }
  }
  ws.close();
}
try { chrome.kill(); } catch {}
log('| device / page | zoom | sideways scroll | layout shift | photos | videos |');
for (const m of mobile) log(`| ${(m.label + ' ' + m.page).padEnd(34)} | ${m.bad ? 'FAIL: ' + m.bad : 'stable'} | photos=${m.imgs} videos=${m.vids} |`);

fs.writeFileSync('data/AUDIT-REPORT.md', '# DMMotorGroup platform audit\n\nGenerated ' + new Date().toISOString().slice(0, 10) + '\n\n' + out.join('\n') + '\n');
console.log('\nWrote data/AUDIT-REPORT.md');
