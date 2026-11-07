'use strict';
/* E2E functional test — run while the server is live on :3000 */
const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ FAIL: ${name} ${extra}`); } };
const j = async (path, opts = {}) => {
  const r = await fetch(BASE + path, { ...opts, headers: { 'X-Requested-With': 'DMFetch', ...(opts.headers || {}) } });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d, headers: r.headers };
};

(async () => {
  console.log('\n── Public browsing ──');
  const meta = await j('/api/meta');
  ok('meta: brands/filters', meta.status === 200 && meta.data.brands.length > 3, JSON.stringify(meta.data).slice(0, 80));
  const home = await j('/api/home');
  ok('home: banners/featured/latest/testimonials', home.status === 200 && home.data.featured.length > 0 && home.data.latest.length > 5 && home.data.banners.length >= 3 && home.data.testimonials.length >= 4);
  ok('home: video presentations present', home.data.videos.length >= 1);
  ok('home: category rails populated', ['luxury', 'suv', 'sedan', 'sports', 'electric', 'truck', 'family'].every((k) => Array.isArray(home.data.byCategory[k])));

  const list = await j('/api/vehicles?per=30');
  ok('showroom: returns published list', list.data.items.length > 10 && list.data.pages >= 1);
  const f1 = await j('/api/vehicles?fuel=Electric');
  ok('filter: fuel=Electric', f1.data.items.every((v) => v.fuel === 'Electric') && f1.data.items.length >= 2);
  const f2 = await j('/api/vehicles?priceMax=40000&priceMin=20000');
  ok('filter: price range', f2.data.items.every((v) => v.price >= 20000 && v.price <= 40000) && f2.data.items.length >= 2);
  const f3 = await j('/api/vehicles?q=' + encodeURIComponent('Camry'));
  ok('filter: keyword search (Camry)', f3.data.items.some((v) => v.model.includes('Camry')));
  const f3b = await j('/api/vehicles?q=' + encodeURIComponent('Land Cruiser'));
  ok('filter: keyword search (Land Cruiser)', f3b.data.items.some((v) => v.model.includes('Land Cruiser')));
  const f4 = await j('/api/vehicles?category=featured&per=50');
  ok('filter: featured only', f4.data.items.every((v) => v.isFeatured) && f4.data.items.length >= 3);
  const sorted = await j('/api/vehicles?sort=price_asc');
  const prices = sorted.data.items.map((v) => v.price);
  ok('sort: price ascending', prices.every((p, i) => i === 0 || p >= prices[i - 1]));

  const slug = (list.data.items.find((v) => v.brand === 'Toyota') || list.data.items[0]).slug;
  const det = await j(`/api/vehicles/${slug}`);
  ok('vehicle detail: full spec payload', det.status === 200 && det.data.vin && det.data.features.length > 2 && det.data.safetyFeatures.length > 2);
  ok('vehicle detail: media + similar', det.data.media.length >= 6 && det.data.similar.length >= 2);
  ok('vehicle detail: inspection info', det.data.inspectionStatus !== undefined && det.data.ownershipInfo.length > 5);

  const vids = await j('/api/videos');
  ok('video showroom: entries', vids.data.items.length >= 1 && vids.data.items[0].slug);
  ok('video showroom: pagination fields', typeof vids.data.pages === 'number' && typeof vids.data.total === 'number');

  // draft not visible publicly
  const draft = await fetch(`${BASE}/api/vehicles/definitely-nope-${Date.now()}`);
  ok('unknown vehicle → 404', draft.status === 404);

  console.log('\n── Security ──');
  const noauth = await j('/api/admin/vehicles');
  ok('admin list blocked without login (401)', noauth.status === 401);
  const bad = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@dmmotorgroup.com', password: 'wrong' }) });
  ok('bad password rejected (401)', bad.status === 401);
  const adminRes = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'X-Requested-With': 'DMFetch', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dmmotorgroup.com', password: 'Admin#2026' }) });
  const adminCookie = (adminRes.headers.get('set-cookie') || '').split(';')[0];
  const adminT = (await adminRes.json()).token;
  ok('admin login ok', !!adminT);
  const mgrT = (await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'sales@dmmotorgroup.com', password: 'Sales#2026' }) })).data.token;
  ok('manager login ok', !!mgrT);
  const A = { Authorization: `Bearer ${adminT}` }, M = { Authorization: `Bearer ${mgrT}` };

  // CSRF: cookie-authed without CSRF header must fail — simulate via cookie login
  const reg = await j('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Test Buyer', email: `buyer${Date.now()}@example.com`, password: 'Password#1', phone: '+44 7700 900123' }) });
  ok('customer account created', reg.status === 200 && reg.data.token);
  const cTok = reg.data.token;
  const me = await j('/api/auth/me', { headers: { Authorization: `Bearer ${cTok}` } });
  ok('me: customer role + empty favourites', me.data.user.role === 'customer' && me.data.favourites.length === 0);
  const staffRej = await j('/api/admin/vehicles', { headers: { Authorization: `Bearer ${cTok}` } });
  ok('customer cannot access admin (403)', staffRej.status === 403);

  console.log('\n── Inventory management (admin) ──');
  const noCsrf = await fetch(`${BASE}/api/admin/vehicles`, { method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ brand: 'CSRF' }) });
  ok('CSRF guard blocks cookie-authed mutating request without app header (403)', noCsrf.status === 403, JSON.stringify(await noCsrf.json()));
  const withCsrf = await fetch(`${BASE}/api/admin/vehicles`, { method: 'POST', headers: { Cookie: adminCookie, 'X-Requested-With': 'DMFetch', 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  const withCsrfBody = await withCsrf.json();
  ok('cookie-authed request WITH app header passes guard (reaches validation)', withCsrf.status === 400 && !!withCsrfBody.error);

  const mk = await j('/api/admin/vehicles', { method: 'POST', headers: A, body: JSON.stringify({ brand: 'Test Motor Co', model: 'Prototype S', year: 2024, price: 66000, mileage: 1500, status: 'draft', bodyType: 'SUV', fuel: 'Hybrid', transmission: 'Automatic', vin: 'TESTVIN000000001', location: 'Dubai, UAE Showroom', description: 'Test listing created by the E2E suite.', features: ['Feature A', 'Feature B'], safetyFeatures: ['Airbags'], category: 'suv' }) });
  ok('create vehicle draft', mk.status === 200 && mk.data.id, JSON.stringify(mk.data));
  const vid = mk.data.id, vslug = mk.data.slug;
  const pub404 = await fetch(`${BASE}/api/vehicles/${vslug}`);
  ok('draft hidden from public as 404', pub404.status === 404);

  // upload image (binary PUT) + thumb
  const imgBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const up1 = await fetch(`${BASE}/api/admin/upload?vehicleId=${vid}&type=image&category=exterior&filename=front.jpg`, { method: 'PUT', headers: { ...A, 'Content-Type': 'image/jpeg', 'X-Requested-With': 'DMFetch' }, body: imgBytes });
  const up1d = await up1.json();
  ok('upload image #1', up1.status === 200 && up1d.id, `${up1.status} ${JSON.stringify(up1d)}`);
  const m1 = up1d.id;
  const up2 = await fetch(`${BASE}/api/admin/upload?vehicleId=${vid}&type=image&category=interior&filename=cabin.jpg`, { method: 'PUT', headers: { ...A, 'Content-Type': 'image/jpeg', 'X-Requested-With': 'DMFetch' }, body: imgBytes });
  const m2 = (await up2.json()).id;
  ok('upload image #2', up2.status === 200);
  const badExt = await fetch(`${BASE}/api/admin/upload?vehicleId=${vid}&type=image&filename=virus.exe`, { method: 'PUT', headers: { ...A, 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'DMFetch' }, body: imgBytes });
  ok('bad extension rejected (400)', badExt.status === 400);
  const th = await fetch(`${BASE}/api/admin/media/${m1}/thumb`, { method: 'PUT', headers: { ...A, 'Content-Type': 'image/webp', 'X-Requested-With': 'DMFetch' }, body: imgBytes });
  ok('attach thumbnail', th.status === 200, JSON.stringify(await th.text()));

  // video upload
  const vidBytes = Buffer.alloc(1024, 7);
  const uv = await fetch(`${BASE}/api/admin/upload?vehicleId=${vid}&type=video&filename=walkaround.mp4`, { method: 'PUT', headers: { ...A, 'Content-Type': 'video/mp4', 'X-Requested-With': 'DMFetch' }, body: vidBytes });
  ok('upload full-length video', uv.status === 200, `${uv.status}`);
  const vm = (await uv.json()).id;

  // cover + reorder + caption
  const cvr = await j(`/api/admin/media/${m2}/cover`, { method: 'POST', headers: A });
  ok('set cover from media #2', cvr.status === 200);
  const ro = await j(`/api/admin/vehicles/${vid}/reorder`, { method: 'POST', headers: A, body: JSON.stringify({ ids: [m2, m1, vm] }) });
  ok('reorder media', ro.status === 200);
  const cap = await j(`/api/admin/media/${m1}`, { method: 'PUT', headers: A, body: JSON.stringify({ caption: 'Front exterior — studio shot', category: 'exterior' }) });
  ok('caption/category saved', cap.status === 200);

  // published + visible
  const pub = await j(`/api/admin/vehicles/${vid}/status`, { method: 'POST', headers: A, body: JSON.stringify({ status: 'published' }) });
  ok('publish vehicle', pub.status === 200);
  const det2 = await j(`/api/vehicles/${vslug}`);
  ok('published vehicle live with all media', det2.status === 200 && det2.data.media.length === 3 && det2.data.coverFull.includes('/media/'));
  const edit = await j(`/api/admin/vehicles/${vid}`, { method: 'PUT', headers: A, body: JSON.stringify({ price: 59900, model: 'Prototype S II' }) });
  ok('edit vehicle details', edit.status === 200);
  const det3 = await j(`/api/vehicles/${vslug}`);
  ok('edited price persists', det3.data.price === 59900);

  console.log('\n── Customer features ──');
  void cTok, vid;
  const fav = await j('/api/favourites', { method: 'POST', headers: { Authorization: `Bearer ${cTok}` }, body: JSON.stringify({ vehicleId: list.data.items[0].id }) });
  ok('save favourite', fav.status === 200);
  const favs = await j('/api/favourites', { headers: { Authorization: `Bearer ${cTok}` } });
  ok('favourites list contains vehicle', favs.data.some((v) => v.id === list.data.items[0].id) && favs.data[0].cover);
  const unf = await j(`/api/favourites/${list.data.items[0].id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${cTok}` } });
  ok('remove favourite', unf.status === 200);

  const enq = await j('/api/enquiries', { method: 'POST', headers: { Authorization: `Bearer ${cTok}` }, body: JSON.stringify({ vehicleId: list.data.items[0].id, type: 'inspection', name: 'Test Buyer', email: `buyer${'@example.com'}`, phone: '+44 7700 900123', message: `I would like to book a physical inspection this weekend. Ref ${Date.now()}.` }) });
  ok('submit enquiry (inspection)', enq.status === 200 && enq.data.id);
  const lenq = await j('/api/my/enquiries', { headers: { Authorization: `Bearer ${cTok}` } });
  ok('customer sees own enquiry history', lenq.data.length >= 1 && lenq.data[0].vehicleTitle);
  const bot = await j('/api/enquiries', { method: 'POST', body: JSON.stringify({ name: 'Bot', email: 'b@b.com', message: 'spam message here', website: 'http://x' }) });
  ok('honeypot silently swallows spam', bot.status === 200);

  console.log('\n── Admin pipeline & notifications ──');
  const aenq = await j('/api/admin/enquiries', { headers: A });
  ok('admin sees enquiry (incl. vehicle + account link)', aenq.data.length >= 1 && aenq.data.some((e) => e.type === 'inspection') && aenq.data.some((e) => e.account_name === 'Test Buyer'));
  const target = aenq.data.find((e) => e.type === 'inspection');
  const upd = await j(`/api/admin/enquiries/${target.id}`, { method: 'PUT', headers: A, body: JSON.stringify({ status: 'responded', adminNotes: 'Inspection slot offered for Saturday 10:00.', respond: 'Good news — an inspection slot is available at the Dubai showroom on Saturday at 10:00.' }) });
  ok('admin updates status + notes + notifies', upd.status === 200);
  const notif = await j('/api/notifications', { headers: { Authorization: `Bearer ${cTok}` } });
  ok('customer received dealership notification', notif.data.items.length >= 2 && notif.data.unread >= 1);
  const readAll = await j('/api/notifications/read', { method: 'POST', headers: { Authorization: `Bearer ${cTok}` }, body: JSON.stringify({ all: true }) });
  ok('notifications marked read', readAll.status === 200);
  void lenq, enq;

  console.log('\n── Banners / testimonials / settings (manager vs admin roles) ──');
  const ban = await j('/api/admin/banners', { method: 'POST', headers: M, body: JSON.stringify({ title: 'E2E Banner', subtitle: 'Service test', link: '/vehicles' }) });
  ok('manager can manage banners', ban.status === 200);
  const banUpd = await j(`/api/admin/banners/${ban.data.id}`, { method: 'PUT', headers: M, body: JSON.stringify({ title: 'E2E Banner v2', position: 5 }) });
  ok('banner edit persists', banUpd.status === 200);
  const banDel = await j(`/api/admin/banners/${ban.data.id}`, { method: 'DELETE', headers: M });
  ok('banner delete', banDel.status === 200);
  const setByMgr = await j('/api/admin/settings', { method: 'PUT', headers: M, body: JSON.stringify({ tagline: 'hack' }) });
  ok('manager cannot change settings (403)', setByMgr.status === 403);
  void setByMgr;
  const setByAdmin = await j('/api/admin/settings', { method: 'PUT', headers: A, body: JSON.stringify({ tagline: 'Verified vehicles · transparent pricing · worldwide delivery.' }) });
  ok('admin settings saved', setByAdmin.status === 200);

  const t = await j('/api/admin/testimonials', { method: 'POST', headers: M, body: JSON.stringify({ name: 'E2E Customer', location: 'Testville', rating: 5, text: 'Functional test testimonial.', status: 'approved' }) });
  ok('testimonial created', t.status === 200);
  const tpub = await j('/api/testimonials');
  ok('testimonial public when approved', tpub.data.some((x) => x.text === 'Functional test testimonial.'));
  const tdel = await j(`/api/admin/testimonials/${t.data.id}`, { method: 'DELETE', headers: M });
  ok('testimonial deleted', tdel.status === 200);

  console.log('\n── Media streaming & static/SEO ──');
  const vidFile = det2.data.media.find((m) => m.type === 'video');
  const range = await fetch(BASE + vidFile.url, { headers: { Range: 'bytes=0-99' } });
  ok('video HTTP Range streaming (206)', range.status === 206 && range.headers.get('content-range').includes('0-99'));
  const stat = det2.data.media.find((m) => m.type === 'image');
  const imgServed = await fetch(BASE + stat.url);
  ok('uploaded image served from /media', imgServed.status === 200);
  const shell = await fetch(`${BASE}/vehicles/${vslug}`);
  const html = await shell.text();
  ok('SEO: per-vehicle <title> injected', html.includes(`Test Motor Co Prototype S II 2024`));
  ok('SEO: JSON-LD Car structured data', html.includes('application/ld+json') && html.includes('"@type":"Car"'));
  ok('SEO: og:image points at uploaded photo', html.includes('og:image') && html.includes('/media/'));
  const sm = await (await fetch(`${BASE}/sitemap.xml`)).text();
  ok('sitemap lists vehicle URL', sm.includes(`<loc>${BASE}/vehicles/${vslug}`));
  const rb = await (await fetch(`${BASE}/robots.txt`)).text();
  ok('robots.txt references sitemap + blocks /admin', rb.includes('Sitemap:') && rb.includes('Disallow: /admin'));
  const mf = await fetch(`${BASE}/manifest.webmanifest`);
  ok('PWA manifest served', mf.status === 200 && (await mf.json()).start_url === '/?utm_source=pwa');
  const hero = await fetch(`${BASE}/assets/hero.svg`);
  ok('hero asset served', hero.status === 200 && (await hero.text()).includes('DM MOTOR GROUP'));

  console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
