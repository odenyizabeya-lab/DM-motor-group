/* =============================================================================
 * DM Motor Group — /api/* Pages Function (Cloudflare Worker)
 * Single dispatcher for the website, the Android app and the admin dashboard.
 * Backed entirely by Supabase (Postgres + RLS, GoTrue auth, Storage).
 * ========================================================================== */
import L from '../../shared/api-lib.js';

const readJson = L.readJson;

/* --------------------------------------------------------------- dispatcher */
const routes = [];
const route = (method, pattern, fn) => routes.push({
  method,
  re: new RegExp('^' + pattern.replace(/:([A-Za-z0-9_]+)/g, '(?<$1>[^/]+)') + '/?$'),
  fn,
});

export async function onRequest({ request, env, params, ctx }) {
  const url = new URL(request.url);
  /* routes are registered with their full path (/api/...); re-attach the mount prefix */
  const pathname = ('/api/' + (params.path || []).join('/')).replace(/\/+$/, '') || '/';
  const ip = (request.headers.get('cf-connecting-ip') || '').split(',')[0].trim() || 'anon';
  const q = (k) => url.searchParams.get(k);

  for (const r of routes) {
    if (r.method.toLowerCase() !== request.method.toLowerCase()) continue;
    const m = pathname.match(r.re);
    if (!m) continue;
    try {
      return await r.fn({ request, env, url, ip, q, g: m.groups || {}, ctx });
    } catch (e) {
      return L.json({ error: e.message || 'Server error' }, e.status || 500);
    }
  }
  return L.json({ error: 'Endpoint not found' }, 404);
}

/* ----------------------------------------------------------------- helpers */
/* neutralise PostgREST boolean-operator syntax characters in user input
 * (NO percent-encoding here: URLSearchParams already handles transport
 * encoding, and pre-encoding would corrupt the filter expression) */
function imp(s) {
  return String(s).replace(/[(,)"%\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* array-count via Content-Range (exact count, no aggregation pitfalls) */
const countOf = (env, table, match = {}) => L.rest.count(env, table, match);

function sortExpr(sort) {
  const map = {
    newest: 'created_at.desc,id.desc', oldest: 'created_at.asc,id.asc',
    price_asc: 'price.asc,id.asc', price_desc: 'price.desc,id.desc',
    year_desc: 'year.desc,id.desc', year_asc: 'year.asc,id.desc',
    mileage_asc: 'mileage.asc,id.asc', updated: 'updated_at.desc,id.desc',
  };
  return map[sort] || map.newest;
}

async function uniqueSlug(env, b) {
  const base = L.slugify(`${b.brand}-${b.model}-${b.year}`);
  let slug = base, i = 1;
  for (;;) {
    const hit = await L.rest.get(env, 'vehicles', { slug: `eq.${slug}`, select: 'id' });
    if (!hit.length) return slug;
    slug = `${base}-${++i}`;
    if (i > 60) return `${base}-${Math.floor(Math.random() * 10000)}`;
  }
}

function updatedFields(b) {
  const patch = {};
  const S = (k) => (b[k] != null ? String(b[k]).trim() : null);
  const set = (key, val) => { if (val !== null && val !== undefined) patch[key] = val; };
  set('brand', S('brand')); set('model', S('model'));
  if (b.year != null) patch.year = +b.year;
  if (b.price != null) patch.price = +b.price;
  if (b.currency != null) patch.currency = String(b.currency).slice(0, 4);
  if (b.mileage != null) patch.mileage = +b.mileage;
  set('engine', S('engine')); set('transmission', S('transmission')); set('fuel', S('fuel'));
  set('body_type', S('bodyType')); set('exterior_color', S('exteriorColor'));
  set('interior_color', S('interiorColor'));
  if (b.vin != null) patch.vin = String(b.vin).toUpperCase().trim();
  set('condition', S('condition')); set('registration', S('registration'));
  set('location', S('location')); set('description', S('description'));
  if (b.features != null) patch.features = Array.isArray(b.features)
    ? b.features : String(b.features).split('\n').map((x) => x.trim()).filter(Boolean);
  if (b.safetyFeatures != null) patch.safety_features = Array.isArray(b.safetyFeatures)
    ? b.safetyFeatures : String(b.safetyFeatures).split('\n').map((x) => x.trim()).filter(Boolean);
  set('ownership_info', S('ownershipInfo'));
  if (b.inspectionStatus != null) patch.inspection_status = String(b.inspectionStatus);
  set('inspection_report', S('inspectionReport'));
  if (b.category != null) patch.category = String(b.category);
  if (b.isFeatured != null) patch.is_featured = !!b.isFeatured;
  return patch;
}

/* =============================================================== PUBLIC API */

route('GET', '/api/health', () => L.json({ ok: true, service: 'DM Motor Group API', engine: 'cloudflare+supabase' }));

route('GET', '/api/meta', async ({ env }) => {
  const [brands, models, locs, price] = await Promise.all([
    L.rest.rpc(env, 'distinct_brands'),
    L.rest.get(env, 'vehicles', { select: 'brand,model', status: 'eq.published', order: 'brand.asc,model.asc' }),
    L.rest.rpc(env, 'distinct_locations'),
    L.rest.rpc(env, 'public_price_range'),
  ]);
  return L.json({
    brands: (brands || []).map((b) => b.brand),
    models: models || [],
    locations: (locs || []).map((l) => l.location),
    priceRange: price || { min: 0, max: 0 },
    yearRange: { min: 1950, max: new Date().getFullYear() + 1 },
    transmissions: ['Automatic', 'Manual', 'Semi-Automatic', 'CVT', 'Dual-Clutch'],
    fuels: ['Petrol', 'Diesel', 'Hybrid', 'Plug-in Hybrid', 'Electric', 'LPG'],
    bodyTypes: ['SUV', 'Sedan', 'Coupe', 'Hatchback', 'Wagon', 'Convertible', 'Pickup', 'Van', 'Truck'],
    categories: [
      { key: 'featured', label: 'Featured' }, { key: 'luxury', label: 'Luxury' }, { key: 'suv', label: 'SUVs' },
      { key: 'sedan', label: 'Sedans' }, { key: 'sports', label: 'Sports Cars' }, { key: 'electric', label: 'Electric' },
      { key: 'truck', label: 'Trucks & Commercial' }, { key: 'family', label: 'Family' },
    ],
  });
});

route('GET', '/api/home', async ({ env }) => {
  const [banners, featured, latest, videos, testimonials, settings, stats] = await Promise.all([
    L.rest.get(env, 'banners', { select: '*', active: 'eq.true', order: 'position.asc,id.asc' }),
    L.rest.get(env, 'vehicles', { select: '*', status: 'eq.published', is_featured: 'eq.true', order: 'updated_at.desc', limit: '8' }),
    L.rest.get(env, 'vehicles', { select: '*', status: 'eq.published', order: 'created_at.desc', limit: '12' }),
    L.rest.get(env, 'media', {
      select: 'id,type,url,thumb_url,caption,category,vehicle_id,vehicles!media_vehicle_id_fkey(slug,brand,model,year)',
      type: 'eq.video', 'vehicles.status': 'in.(published,reserved)', order: 'id.desc', limit: '8',
    }),
    L.rest.get(env, 'testimonials', { select: '*', status: 'eq.approved', order: 'id.desc', limit: '9' }),
    L.rest.get(env, 'settings', { select: '*' }),
    L.rest.rpc(env, 'home_stats'),
  ]);

  const ids = [...new Set([...featured.map((v) => v.id), ...latest.map((v) => v.id)])];
  const md = await L.mediaFor(env, ids);
  const mapV = (list) => list.map((v) => L.vehicleOut(v, md.get(v.id) || []));

  const cats = ['luxury', 'suv', 'sedan', 'sports', 'electric', 'truck', 'family'];
  const catLists = await Promise.all(cats.map((c) =>
    L.rest.get(env, 'vehicles', { select: '*', status: 'eq.published', category: `eq.${c}`, order: 'updated_at.desc', limit: '6' }).catch(() => [])));
  const cmd = await L.mediaFor(env, [...new Set(catLists.flat().map((v) => v.id))]);

  return L.json({
    banners: banners || [],
    featured: mapV(featured || []),
    latest: mapV(latest || []),
    byCategory: Object.fromEntries(cats.map((c, i) => [c, catLists[i].map((v) => L.vehicleOut(v, cmd.get(v.id) || []))])),
    videos: (videos || []).filter((v) => v.vehicles).map((v) => ({
      id: v.id, vehicleId: v.vehicle_id, type: 'video', url: v.url, thumbUrl: v.thumb_url || '',
      caption: v.caption, slug: v.vehicles.slug,
      title: `${v.vehicles.brand} ${v.vehicles.model} ${v.vehicles.year}`,
    })),
    testimonials: (testimonials || []).map((t) => ({
      id: t.id, name: t.name, location: t.location, rating: t.rating,
      text: t.body, vehicleLabel: t.vehicle_label, createdAt: t.created_at,
    })),
    settings: Object.fromEntries((settings || []).map((s) => [s.key, s.value])),
    stats: stats || { published: 0, brands: 0, photos: 0, videos: 0 },
  });
});

route('GET', '/api/vehicles', async ({ env, request, q }) => {
  const u = await L.authUser(env, request);
  const staffList = !!(u && ['admin', 'manager', 'viewer'].includes(u.role) && q('scope') === 'admin');

  const filters = {};
  if (staffList) {
    if (q('status')) filters.status = `eq.${imp(q('status'))}`;
  } else filters.status = 'in.(published,reserved)';

  if (q('q')) {
    const w = `(brand.ilike."%${imp(q('q'))}%",model.ilike."%${imp(q('q'))}%",description.ilike."%${imp(q('q'))}%",vin.ilike."%${imp(q('q'))}%",location.ilike."%${imp(q('q'))}%")`;
    filters.or = w;
  }
  if (q('brand')) filters.brand = `eq.${imp(q('brand'))}`;
  if (q('model')) filters.model = `eq.${imp(q('model'))}`;
  if (q('yearMin')) filters.year = `gte.${+q('yearMin') || 0}`;
  if (q('yearMax')) filters.year = `lte.${+q('yearMax') || 9999}`;
  if (q('priceMin')) filters.price = `gte.${+q('priceMin') || 0}`;
  if (q('priceMax')) filters.price = `lte.${+q('priceMax') || 999999999}`;
  if (q('mileageMax')) filters.mileage = `lte.${+q('mileageMax') || 9e9}`;
  if (q('transmission')) filters.transmission = `eq.${imp(q('transmission'))}`;
  if (q('fuel')) filters.fuel = `eq.${imp(q('fuel'))}`;
  if (q('bodyType')) filters.body_type = `eq.${imp(q('bodyType'))}`;
  if (q('condition')) filters.condition = `eq.${imp(q('condition'))}`;
  if (q('location')) filters.location = `ilike."*${imp(q('location'))}*"`;
  if (q('category') === 'featured') filters.is_featured = 'eq.true';
  else if (q('category')) filters.category = `eq.${imp(q('category'))}`;

  const per = Math.min(Math.max(+(q('per')) || 12, 1), 100);
  const page = Math.max(+(q('page')) || 1, 1);

  const [total, rows] = await Promise.all([
    countOf(env, 'vehicles', filters),
    L.rest.get(env, 'vehicles', {
      ...filters, select: '*',
      order: sortExpr(q('sort')), limit: String(per), offset: String((page - 1) * per),
    }),
  ]);
  const md = await L.mediaFor(env, (rows || []).map((v) => v.id));
  return L.json({
    items: (rows || []).map((v) => L.vehicleOut(v, md.get(v.id) || [])),
    total, page, pages: Math.ceil(total / per) || 1, per,
  });
});

route('GET', '/api/vehicles/:slug', async ({ env, request, g, ctx }) => {
  const rows = await L.rest.get(env, 'vehicles', { slug: `eq.${imp(g.slug)}`, select: '*' });
  const v = rows && rows[0];
  if (!v) throw L.err(404, 'Vehicle not found.');
  const u = await L.authUser(env, request);
  const isStaff = !!(u && ['admin', 'manager', 'viewer'].includes(u.role));
  if (!isStaff && !['published', 'reserved'].includes(v.status)) throw L.err(404, 'Vehicle not found.');
  if (!isStaff && ctx) ctx.waitUntil(L.rest.rpc(env, 'vehicle_viewed', { p_id: v.id }).catch(() => {}));

  const [md, similar] = await Promise.all([
    L.rest.get(env, 'media', { vehicle_id: `eq.${v.id}`, select: '*', order: 'position.asc,id.asc' }),
    L.rest.get(env, 'vehicles', {
      select: '*', status: 'in.(published,reserved)', id: `neq.${v.id}`,
      or: `(category.eq.${imp(v.category)},brand.eq.${imp(v.brand)})`,
      order: 'price.asc,id.asc', limit: '8',
    }),
  ]);
  const sim = (similar || []).slice(0, 4).sort((a, b) => Math.abs(a.price - v.price) - Math.abs(b.price - v.price));
  const out = L.vehicleDetailOut(v, md || []);
  out.similar = sim.map((s) => L.vehicleOut(s, []));
  if (u) {
    const fav = await L.rest.get(env, 'favourites', { user_id: `eq.${u.id}`, vehicle_id: `eq.${v.id}`, select: 'vehicle_id' });
    out.favourited = fav.length > 0;
  }
  return L.json(out);
});

route('GET', '/api/videos', async ({ env, q }) => {
  const page = Math.max(+(q('page')) || 1, 1);
  const per = Math.min(+(q('per')) || 18, 50);
  const [total, rows] = await Promise.all([
    countOf(env, 'media', { type: 'eq.video', 'vehicles.status': 'in.(published,reserved)' }),
    L.rest.get(env, 'media', {
      select: 'id,url,thumb_url,caption,vehicle_id,vehicles!media_vehicle_id_fkey(slug,brand,model,year,price,currency)',
      type: 'eq.video', 'vehicles.status': 'in.(published,reserved)',
      order: 'id.desc', limit: String(per), offset: String((page - 1) * per),
    }),
  ]);
  return L.json({
    items: (rows || []).filter((v) => v.vehicles).map((v) => ({
      id: v.id, vehicleId: v.vehicle_id, url: v.url, thumbUrl: v.thumb_url || '', caption: v.caption,
      slug: v.vehicles.slug, title: `${v.vehicles.brand} ${v.vehicles.model} ${v.vehicles.year}`,
      price: v.vehicles.price, currency: v.vehicles.currency,
    })),
    total, page, pages: Math.ceil(total / per) || 1,
  });
});

/* ------------------------------------------------------------ enquiries */
route('POST', '/api/enquiries', async ({ env, request, ip, ctx }) => {
  if (!L.rateLimit(`enq:${ip}`, 6, 10 * 60e3)) throw L.err(429, 'You have submitted several enquiries recently. Please wait a little while.');
  const b = await readJson(request);
  if (b.website) return L.json({ ok: true }); /* honeypot: silently swallow bot spam */
  const message = String(b.message || '').trim();
  if (message.length < 5) throw L.err(400, 'Please write a short message.');
  if (message.length > 4000) throw L.err(400, 'Message is too long.');
  if (!b.name || String(b.name).trim().length < 2) throw L.err(400, 'Please enter your name.');
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw L.err(400, 'Please enter a valid email address.');

  let vehicle = null;
  if (b.vehicleId) {
    const vr = await L.rest.get(env, 'vehicles', { id: `eq.${+b.vehicleId || 0}`, select: 'id,slug,brand,model,year,status' }).catch(() => []);
    const row = vr && vr[0];
    if (row && ['published', 'reserved'].includes(row.status)) vehicle = row;
  }
  const dup = await L.rest.rpc(env, 'enquiry_dup', { p_ip: ip, p_message: message, p_minutes: 30 });
  if (dup === true) return L.json({ ok: true, message: 'Your enquiry has been received.' });

  const u = await L.authUser(env, request);
  const TYPE_LABEL = { price: 'pricing & availability', inspection: 'physical inspection', testdrive: 'viewing / test drive', delivery: 'delivery & export', purchase: 'purchase & reservation', pictures: 'extra photographs', videos: 'extra videos', whatsapp: 'WhatsApp contact', question: 'your question' };
  const type = L.ENQ_TYPES.includes(b.type) ? b.type : 'question';
  const saved = await L.rest.insert(env, 'enquiries', {
    vehicle_id: vehicle ? vehicle.id : null,
    user_id: u ? u.id : null,
    name: String(b.name).trim(),
    email,
    phone: String(b.phone || '').trim(),
    type,
    message,
    ip,
  });
  if (u && ctx) {
    const brand = vehicle ? ` about the ${vehicle.brand} ${vehicle.model}` : '';
    ctx.waitUntil(L.sendNotification(env, u.id, 'Enquiry received',
      `Thanks ${u.name} — our team has received your enquiry${brand} and will respond shortly.`,
      vehicle ? '/vehicles/' + vehicle.slug : '/'));
  }
  if (ctx) ctx.waitUntil(L.logActivity(env, email, 'enquiry_submitted',
    `${type} enquiry${vehicle ? ` — ${vehicle.brand} ${vehicle.model} (${vehicle.slug})` : ' (general)'}`));
  return L.json({
    ok: true, id: saved && saved.id,
    message: `Thank you — your ${TYPE_LABEL[type]} request has been sent to our team. We respond within one business day.`,
  });
});

/* --------------------------------------------------------- testimonials */
route('GET', '/api/testimonials', async ({ env }) => {
  const rows = await L.rest.get(env, 'testimonials',
    { select: 'id,name,location,rating,body,vehicle_label,created_at', status: 'eq.approved', order: 'id.desc' });
  return L.json(rows || []);
});

/* ========================================================== AUTHENTICATION */

async function fetchToken(env, email, password) {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => ({}));
  return { token: d.access_token || null, status: r.status };
}

route('POST', '/api/auth/register', async ({ env, request, ip, ctx }) => {
  if (!L.rateLimit(`reg:${ip}`, 8, 3600e3)) throw L.err(429, 'Too many attempts. Try again later.');
  const b = await readJson(request);
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw L.err(400, 'Please enter a valid email address.');
  if (!b.name || String(b.name).trim().length < 2) throw L.err(400, 'Please enter your full name.');
  if (String(b.password || '').length < 8) throw L.err(400, 'Password must be at least 8 characters.');

  let created;
  try {
    created = await L.sb(env, '/auth/v1/admin/users', {
      method: 'POST',
      body: { email, password: String(b.password), email_confirm: true, user_metadata: { name: String(b.name).trim() } },
    });
  } catch (e) {
    if (/already|exists/i.test(String(e.message))) throw L.err(409, 'An account with this email already exists. Please sign in.');
    throw e;
  }
  if (!created || !created.id) throw L.err(400, 'Registration failed. Please try again.');

  const payload = await fetchToken(env, email, String(b.password));
  if (!payload.token) throw L.err(500, 'Account created, but sign-in failed. Please try again.');
  const profile = (await L.rest.get(env, 'profiles', { id: `eq.${created.id}`, select: '*' }))[0] || {};
  if (ctx) ctx.waitUntil(L.logActivity(env, email, 'customer_registered',
    profile.role === 'admin' ? `Owner bootstrap account: ${email} (admin)` : `Customer account: ${email}`));
  return L.json({
    token: payload.token,
    user: { id: created.id, email, name: String(b.name).trim(), phone: String(b.phone || '').trim(), role: profile.role || 'customer' },
  });
});

route('POST', '/api/auth/login', async ({ env, request, ip, ctx }) => {
  const payload = await L.loginPayload(env, request, ip);
  if (ctx) ctx.waitUntil(L.logActivity(env, payload.user.email, 'login', `Sign-in (${payload.user.role})`));
  return L.json(payload);
});

route('POST', '/api/auth/logout', () => L.json({ ok: true }));

route('GET', '/api/auth/me', async ({ env, request }) => {
  const u = await L.authUser(env, request);
  if (!u) return L.json({ user: null, favourites: [], unread: 0 });
  const [favs, unread] = await Promise.all([
    L.rest.get(env, 'favourites', { select: 'vehicle_id', user_id: `eq.${u.id}`, order: 'created_at.desc' }),
    countOf(env, 'notifications', { user_id: `eq.${u.id}`, is_read: 'eq.false' }),
  ]);
  return L.json({
    user: u,
    favourites: (favs || []).map((f) => f.vehicle_id),
    unread,
  });
});

route('PUT', '/api/auth/profile', async ({ env, request }) => {
  const u = await L.requireAuth(env, request);
  const b = await readJson(request);
  const patch = {};
  if (b.name && String(b.name).trim().length >= 2) patch.name = String(b.name).trim();
  if (typeof b.phone === 'string') patch.phone = b.phone.trim();
  if (typeof b.address === 'string') patch.address = b.address.trim();
  if (Object.keys(patch).length) await L.rest.update(env, 'profiles', { id: u.id }, patch, true);
  if (b.password) {
    if (String(b.password).length < 8) throw L.err(400, 'New password must be at least 8 characters.');
    const grant = await fetchToken(env, u.email, String(b.currentPassword || ''));
    if (!grant.token) throw L.err(403, 'Current password is incorrect.');
    await L.sb(env, `/auth/v1/admin/users/${u.id}`, { method: 'PUT', body: { password: String(b.password) } });
  }
  return L.json({ ok: true });
});

/* recovery → Supabase sends the reset email (SMTP configured in Supabase) */
route('POST', '/api/auth/forgot', async ({ env, request, ip }) => {
  if (!L.rateLimit(`forgot:${ip}`, 6, 3600e3)) throw L.err(429, 'Too many attempts. Try again later.');
  const b = await readJson(request);
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return L.json({ ok: true, message: 'If that email is registered, a secure reset link has been sent.' });
  }
  const redirectTo = `${String(env.SITE_URL || '').replace(/\/+$/, '')}/account?mode=reset`;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirect_to: redirectTo }),
    });
    if (!r.ok) console.error('reset email unavailable:', (await r.text()).slice(0, 300));
  } catch {}
  return L.json({ ok: true, message: 'If that email is registered, a secure reset link has been sent.' });
});

/* recovery link carries access_token → set a new password */
route('POST', '/api/auth/reset', async ({ env, request }) => {
  const b = await readJson(request);
  const token = String(b.token || '');
  if (!token) throw L.err(400, 'This recovery link is invalid or expired.');
  if (String(b.password || '').length < 8) throw L.err(400, 'Password must be at least 8 characters.');
  const me = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!me.ok) throw L.err(400, 'This recovery link is invalid or expired.');
  const u = await me.json();
  await L.sb(env, `/auth/v1/admin/users/${u.id}`, { method: 'PUT', body: { password: String(b.password) } });
  return L.json({ ok: true, message: 'Password updated. You can now sign in.' });
});

/* =========================================================== CUSTOMER API */

route('GET', '/api/favourites', async ({ env, request }) => {
  const u = await L.requireAuth(env, request);
  const favs = await L.rest.get(env, 'favourites', { select: 'vehicle_id', user_id: `eq.${u.id}`, order: 'created_at.desc' });
  const ids = (favs || []).map((f) => f.vehicle_id);
  if (!ids.length) return L.json([]);
  const rows = await L.rest.get(env, 'vehicles', { select: '*', id: `in.(${ids.join(',')})` });
  const md = await L.mediaFor(env, ids);
  return L.json((rows || []).map((v) => L.vehicleOut(v, md.get(v.id) || [])));
});

route('POST', '/api/favourites', async ({ env, request }) => {
  const u = await L.requireAuth(env, request);
  const b = await readJson(request);
  const vr = await L.rest.get(env, 'vehicles', { id: `eq.${+b.vehicleId || 0}`, select: 'id' });
  if (!vr || !vr.length) throw L.err(404, 'Vehicle not found.');
  try { await L.rest.insert(env, 'favourites', { user_id: u.id, vehicle_id: +b.vehicleId }); } catch {}
  return L.json({ ok: true, favourited: true });
});

route('DELETE', '/api/favourites/:vehicleId', async ({ env, request, g }) => {
  const u = await L.requireAuth(env, request);
  await L.rest.del(env, 'favourites', { user_id: `eq.${u.id}`, vehicle_id: `eq.${+g.vehicleId || 0}` });
  return L.json({ ok: true, favourited: false });
});

route('GET', '/api/notifications', async ({ env, request }) => {
  const u = await L.requireAuth(env, request);
  const [rows, unread] = await Promise.all([
    L.rest.get(env, 'notifications', { select: '*', user_id: `eq.${u.id}`, order: 'id.desc', limit: '50' }),
    countOf(env, 'notifications', { user_id: `eq.${u.id}`, is_read: 'eq.false' }),
  ]);
  return L.json({ items: (rows || []).map((n) => ({ ...n, is_read: n.is_read ? 1 : 0 })), unread });
});

route('POST', '/api/notifications/read', async ({ env, request, ctx }) => {
  const u = await L.requireAuth(env, request);
  const b = await readJson(request);
  if (b.all) await L.rest.update(env, 'notifications', { user_id: u.id, is_read: 'eq.false' }, { is_read: true }, true);
  else if (Array.isArray(b.ids) && b.ids.length) {
    await L.rest.update(env, 'notifications', { user_id: u.id, id: `in.(${b.ids.join(',')})` }, { is_read: true }, true);
  }
  return L.json({ ok: true });
});

route('GET', '/api/my/enquiries', async ({ env, request }) => {
  const u = await L.requireAuth(env, request);
  const rows = await L.rest.get(env, 'enquiries', {
    select: '*,vehicles(slug,brand,model,year)', user_id: `eq.${u.id}`, order: 'id.desc', limit: '300',
  });
  return L.json((rows || []).map((e) => ({
    ...e,
    vehicleTitle: e.vehicles ? `${e.vehicles.brand} ${e.vehicles.model} ${e.vehicles.year}` : 'General enquiry',
    vehicleSlug: (e.vehicles && e.vehicles.slug) || '',
  })));
});

/* reservations — real orders table, inventory linkage, admin pipeline */
route('POST', '/api/orders', async ({ env, request, ctx }) => {
  const u = await L.requireAuth(env, request);
  const b = await readJson(request);
  const type = b.type === 'purchase' ? 'purchase' : 'reservation';
  const vr = await L.rest.get(env, 'vehicles', { id: `eq.${+b.vehicleId || 0}`, select: 'id,slug,brand,model,year,price,currency,status' });
  const v = vr && vr[0];
  if (!v || !['published', 'reserved'].includes(v.status)) throw L.err(404, 'Vehicle not found.');
  const saved = await L.rest.insert(env, 'orders', {
    vehicle_id: v.id, user_id: u.id, type,
    amount: v.price, currency: v.currency,
    notes: String(b.notes || '').slice(0, 2000),
  });
  if (ctx) {
    ctx.waitUntil(L.logActivity(env, u.email, 'order_requested', `${type}: ${v.brand} ${v.model} (#${v.id})`));
    ctx.waitUntil(L.sendNotification(
      env, u.id, 'Reservation request received',
      `Thanks ${u.name} — your ${type} request for the ${v.brand} ${v.model} has been received. Our team will contact you with the next steps and the reservation agreement.`,
      '/vehicles/' + v.slug));
  }
  return L.json({ ok: true, id: saved && saved.id, message: 'Thank you — your request has been received. Our team will contact you with the next steps.' });
});

route('GET', '/api/my/orders', async ({ env, request }) => {
  const u = await L.requireAuth(env, request);
  const rows = await L.rest.get(env, 'orders', {
    select: '*,vehicles(slug,brand,model,year)', user_id: `eq.${u.id}`, order: 'id.desc', limit: '100',
  });
  return L.json((rows || []).map((o) => ({
    ...o,
    vehicleTitle: o.vehicles ? `${o.vehicles.brand} ${o.vehicles.model} ${o.vehicles.year}` : '',
  })));
});

/* =============================================================== ADMIN API */

const withMedia = async (env, rows) => {
  const md = await L.mediaFor(env, rows.map((v) => v.id));
  return rows.map((v) => L.vehicleOut(v, md.get(v.id) || []));
};

route('GET', '/api/admin/stats', async ({ env, request }) => {
  await L.staff(env, request);
  return L.json(await L.rest.rpc(env, 'admin_counts'));
});

/* ---------------- vehicles CRUD ---------------- */
route('GET', '/api/admin/vehicles', async ({ env, request, q }) => {
  await L.staff(env, request);
  const filters = {};
  if (q('status')) filters.status = `eq.${imp(q('status'))}`;
  if (q('q')) filters.or = `(brand.ilike."%${imp(q('q'))}%",model.ilike."%${imp(q('q'))}%",vin.ilike."%${imp(q('q'))}%")`;
  const rows = await L.rest.get(env, 'vehicles', { ...filters, select: '*', order: 'updated_at.desc,id.desc', limit: '500' });
  return L.json(await withMedia(env, rows || []));
});

route('POST', '/api/admin/vehicles', async ({ env, request, ctx }) => {
  const u = await L.writeStaff(env, request);
  const b = await readJson(request);
  if (!b.brand || !b.model) throw L.err(400, 'Brand and model are required.');
  const slug = await uniqueSlug(env, b);
  const row = await L.rest.insert(env, 'vehicles', {
    slug,
    status: L.VEHICLE_STATUSES.includes(b.status) ? b.status : 'draft',
    brand: String(b.brand).trim(),
    model: String(b.model).trim(),
    year: +b.year || 2000,
    price: +b.price || 0,
    currency: String(b.currency || 'USD').slice(0, 4),
    mileage: +b.mileage || 0,
    engine: String(b.engine || ''), transmission: String(b.transmission || ''),
    fuel: String(b.fuel || ''), body_type: String(b.bodyType || ''),
    exterior_color: String(b.exteriorColor || ''), interior_color: String(b.interiorColor || ''),
    vin: String(b.vin || '').toUpperCase().trim(),
    condition: String(b.condition || 'Used'),
    registration: String(b.registration || ''),
    location: String(b.location || ''),
    description: String(b.description || ''),
    features: Array.isArray(b.features) ? b.features : [],
    safety_features: Array.isArray(b.safetyFeatures) ? b.safetyFeatures : [],
    ownership_info: String(b.ownershipInfo || ''),
    inspection_status: ['none', 'dealership_inspected', 'third_party_inspected'].includes(b.inspectionStatus) ? b.inspectionStatus : 'none',
    inspection_report: String(b.inspectionReport || ''),
    category: String(b.category || 'sedan'),
    is_featured: !!b.isFeatured,
  });
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'vehicle_created', `${b.brand} ${b.model} ${b.year} (#${row.id})`));
  return L.json({ ok: true, id: row.id, slug: row.slug });
});

route('GET', '/api/admin/vehicles/:id', async ({ env, request, g }) => {
  await L.staff(env, request);
  const rows = await L.rest.get(env, 'vehicles', { id: `eq.${+g.id || 0}`, select: '*' });
  if (!rows || !rows.length) throw L.err(404, 'Not found');
  const [out] = await withMedia(env, rows.slice(0, 1));
  const media = await L.rest.get(env, 'media', { vehicle_id: `eq.${+g.id}`, select: '*', order: 'position.asc,id.asc' });
  out.media = (media || []).map((m) => ({
    id: m.id, vehicleId: m.vehicle_id, type: m.type, url: m.url,
    thumbUrl: m.thumb_url || '', caption: m.caption || '',
    category: m.category || 'exterior', position: m.position || 0,
    isVideoCover: !!m.is_video_cover, createdAt: m.created_at,
  }));
  return L.json(out);
});

route('PUT', '/api/admin/vehicles/:id', async ({ env, request, g, ctx }) => {
  const u = await L.writeStaff(env, request);
  const b = await readJson(request);
  const rows = await L.rest.get(env, 'vehicles', { id: `eq.${+g.id || 0}`, select: '*' });
  const v = rows && rows[0];
  if (!v) throw L.err(404, 'Not found');
  const patch = updatedFields(b);
  if (!Object.keys(patch).length) return L.json({ ok: true });
  await L.rest.update(env, 'vehicles', { id: v.id }, { ...patch, updated_at: new Date().toISOString() }, true);
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'vehicle_updated', `${patch.brand || v.brand} ${patch.model || v.model} (#${v.id})`));
  return L.json({ ok: true });
});

route('DELETE', '/api/admin/vehicles/:id', async ({ env, request, g, ctx }) => {
  const u = await L.writeStaff(env, request);
  const rows = await L.rest.get(env, 'vehicles', { id: `eq.${+g.id || 0}`, select: '*' });
  const v = rows && rows[0];
  if (!v) throw L.err(404, 'Not found');
  const media = await L.rest.get(env, 'media', { vehicle_id: `eq.${v.id}`, select: 'url,thumb_url' });
  await L.rest.del(env, 'vehicles', { id: v.id }); /* cascades to media rows */
  if (ctx) ctx.waitUntil(L.storageDelete(env, (media || []).flatMap((m) => [m.url, m.thumb_url])));
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'vehicle_deleted', `${v.brand} ${v.model} (#${v.id})`));
  return L.json({ ok: true });
});

route('POST', '/api/admin/vehicles/:id/status', async ({ env, request, g, ctx }) => {
  const u = await L.writeStaff(env, request);
  const b = await readJson(request);
  if (!L.VEHICLE_STATUSES.includes(b.status)) throw L.err(400, 'Invalid status.');
  await L.rest.update(env, 'vehicles', { id: +g.id || 0 }, { status: b.status, updated_at: new Date().toISOString() }, true);
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'vehicle_status', `#${g.id} → ${b.status}`));
  return L.json({ ok: true, status: b.status });
});

/* ---------------- uploads (stream body → storage; no buffering) ------------ */
route('PUT', '/api/admin/upload', async ({ env, request, url, ctx }) => {
  const u = await L.writeStaff(env, request);
  const s = url.searchParams;
  const vehicleId = +s.get('vehicleId') || 0;
  const type = s.get('type') === 'video' ? 'video' : 'image';
  const mediaCategory = type === 'video' ? 'video' : (s.get('category') || 'exterior');
  const caption = String(s.get('caption') || '').slice(0, 300);
  const origName = String(s.get('filename') || 'file.bin');
  const bucket = s.get('bucket') === 'banners' ? 'banners' : 'vehicle-media';

  if (bucket === 'vehicle-media') {
    const vr = await L.rest.get(env, 'vehicles', { id: `eq.${vehicleId}`, select: 'id' });
    if (!vr || !vr.length) throw L.err(404, 'Save the vehicle first, then upload media.');
  }

  const ext = (origName.toLowerCase().match(/\.([a-z0-9]+)$/i) || [])[1] || 'bin';
  const allow = type === 'image' ? L.IMG_EXT : L.VID_EXT;
  if (!allow.includes(ext)) throw L.err(400, `Allowed ${type} formats: ${allow.map((x) => '.' + x).join(', ')}`);

  const contentType = request.headers.get('content-type') || 'application/octet-stream';
  const objectPath = bucket === 'vehicle-media'
    ? `v${vehicleId}/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`
    : `banner-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  const publicUrl = await L.storageUpload(env, bucket, objectPath, request.body, contentType, true);

  if (bucket === 'vehicle-media') {
    const posRow = (await L.rest.get(env, 'media', { vehicle_id: `eq.${vehicleId}`, select: 'position', order: 'position.desc', limit: '1' }))[0];
    const existing = await L.rest.get(env, 'media', { vehicle_id: `eq.${vehicleId}`, type: `eq.${type}`, select: 'id', limit: '1' });
    const isCover = type === 'image' && (!existing || !existing.length);
    const saved = await L.rest.insert(env, 'media', {
      vehicle_id: vehicleId, type, url: publicUrl, thumb_url: '', caption,
      category: mediaCategory, position: posRow ? posRow.position + 1 : 0,
    });
    if (isCover) {
      await L.rest.update(env, 'vehicles', { id: vehicleId }, { cover_media_id: saved.id, cover: publicUrl, cover_full: publicUrl }, true);
    }
    const size = +(request.headers.get('content-length') || 0);
    if (ctx) ctx.waitUntil(L.logActivity(env, u.email, type === 'video' ? 'video_uploaded' : 'image_uploaded',
      `#${vehicleId} ${origName} (${Math.round(size / 104857.6) / 10}MB)`));
    return L.json({ ok: true, id: saved.id, url: publicUrl, cover: isCover });
  }

  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'banner_uploaded', objectPath));
  return L.json({ ok: true, url: publicUrl });
});

route('PUT', '/api/admin/media/:id/thumb', async ({ env, request, g }) => {
  await L.writeStaff(env, request);
  const rows = await L.rest.get(env, 'media', { id: `eq.${+g.id || 0}`, select: '*' });
  const row = rows && rows[0];
  if (!row) throw L.err(404, 'Not found');
  const access = L.extractStoragePath(row.url);
  if (!access) throw L.err(400, 'Unsupported media url');
  const thumbPath = access.path.replace(/\.[a-z0-9]+$/i, '') + '-thumb.webp';
  await L.storageUpload(env, access.bucket, thumbPath, request.body, 'image/webp', true);
  const thumb = L.storagePublic(env, access.bucket, thumbPath);
  await L.rest.update(env, 'media', { id: row.id }, { thumb_url: thumb }, true);
  return L.json({ ok: true });
});

route('PUT', '/api/admin/media/:id', async ({ env, request, g }) => {
  await L.writeStaff(env, request);
  const b = await readJson(request);
  const rows = await L.rest.get(env, 'media', { id: `eq.${+g.id || 0}`, select: '*' });
  const row = rows && rows[0];
  if (!row) throw L.err(404, 'Not found');
  const patch = {};
  if (b.caption != null) patch.caption = String(b.caption).slice(0, 300);
  if (b.category != null) patch.category = String(b.category);
  if (!Object.keys(patch).length) return L.json({ ok: true });
  await L.rest.update(env, 'media', { id: row.id }, patch, true);
  return L.json({ ok: true });
});

route('POST', '/api/admin/media/:id/cover', async ({ env, request, g, ctx }) => {
  const u = await L.writeStaff(env, request);
  const rows = await L.rest.get(env, 'media', { id: `eq.${+g.id || 0}`, select: '*' });
  const row = rows && rows[0];
  if (!row || row.type !== 'image') throw L.err(400, 'The cover photograph must be an image.');
  await L.rest.update(env, 'vehicles', { id: row.vehicle_id }, { cover_media_id: row.id, cover: row.url, cover_full: row.url }, true);
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'cover_set', `vehicle #${row.vehicle_id} cover → media #${row.id}`));
  return L.json({ ok: true });
});

route('DELETE', '/api/admin/media/:id', async ({ env, request, g, ctx }) => {
  await L.writeStaff(env, request);
  const rows = await L.rest.get(env, 'media', { id: `eq.${+g.id || 0}`, select: '*' });
  const row = rows && rows[0];
  if (!row) throw L.err(404, 'Not found');
  await L.rest.del(env, 'media', { id: row.id });
  if (ctx) ctx.waitUntil(L.storageDelete(env, [row.url, row.thumb_url]));
  const next = await L.rest.get(env, 'media', { vehicle_id: `eq.${row.vehicle_id}`, type: 'eq.image', select: '*', order: 'position.asc,id.asc', limit: '1' });
  const cv = next && next[0];
  await L.rest.update(env, 'vehicles', { id: row.vehicle_id }, {
    cover_media_id: cv ? cv.id : null, cover: cv ? cv.url : null, cover_full: cv ? cv.url : null,
  }, true);
  return L.json({ ok: true });
});

route('POST', '/api/admin/vehicles/:id/reorder', async ({ env, request, g }) => {
  await L.writeStaff(env, request);
  const b = await readJson(request);
  if (!Array.isArray(b.ids)) throw L.err(400, 'Provide media ids.');
  await L.rest.rpc(env, 'reorder_media', { p_vehicle: +g.id || 0, p_ids: b.ids.map(Number) });
  return L.json({ ok: true });
});

/* ---------------- enquiries management ---------------- */
route('GET', '/api/admin/enquiries', async ({ env, request, q }) => {
  await L.staff(env, request);
  const filters = {};
  if (q('status')) filters.status = `eq.${imp(q('status'))}`;
  const rows = await L.rest.get(env, 'enquiries', {
    ...filters, select: '*,vehicles(slug,brand,model,year)',
    order: 'id.desc', limit: '300',
  });
  const list = (rows || []).sort((a, b) => (a.status === 'new' ? -1 : 0) - (b.status === 'new' ? -1 : 0));
  const uidList = [...new Set(list.map((e) => e.user_id).filter(Boolean))];
  const profiles = uidList.length
    ? await L.rest.get(env, 'profiles', { select: 'id,name', id: `in.(${uidList.join(',')})` })
    : [];
  const pm = new Map((profiles || []).map((p) => [p.id, p.name]));
  return L.json(list.map((e) => {
    const v = e.vehicles || {};
    return {
      ...e,
      brand: v.brand || null, model: v.model || null, year: v.year || null, slug: v.slug || '',
      account_name: e.user_id ? pm.get(e.user_id) || '' : '',
    };
  }));
});

route('PUT', '/api/admin/enquiries/:id', async ({ env, request, g, ctx }) => {
  const u = await L.staff(env, request, ['admin', 'manager']);
  const b = await readJson(request);
  const rows = await L.rest.get(env, 'enquiries', { id: `eq.${+g.id || 0}`, select: '*' });
  const e = rows && rows[0];
  if (!e) throw L.err(404, 'Not found');
  const patch = {};
  if (b.status) patch.status = String(b.status);
  if (typeof b.adminNotes === 'string') patch.admin_notes = b.adminNotes;
  if (Object.keys(patch).length) await L.rest.update(env, 'enquiries', { id: e.id }, patch, true);
  if (b.respond) {
    let link = '/';
    if (e.vehicle_id) {
      const vr = await L.rest.get(env, 'vehicles', { id: `eq.${e.vehicle_id}`, select: 'slug' });
      if (vr && vr[0]) link = '/vehicles/' + vr[0].slug;
    }
    const body = String(b.respond).slice(0, 500);
    if (e.user_id) await L.sendNotification(env, e.user_id, 'Update from DM Motor Group', body, link);
    await L.rest.insert(env, 'enquiry_messages', { enquiry_id: e.id, sender: 'staff', body });
  }
  if (b.status && ctx) ctx.waitUntil(L.logActivity(env, u.email, 'enquiry_updated', `#${e.id} → ${b.status}`));
  return L.json({ ok: true });
});

/* ---------------- customers & staff ---------------- */
route('GET', '/api/admin/customers', async ({ env, request }) => {
  await L.staff(env, request);
  const list = await L.rest.rpc(env, 'customers_list');
  return L.json(list || []);
});

route('POST', '/api/admin/users', async ({ env, request, ctx }) => {
  const u = await L.requireAuth(env, request, ['admin']);
  const b = await readJson(request);
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw L.err(400, 'Valid email required.');
  if (String(b.password || '').length < 8) throw L.err(400, 'Password at least 8 characters.');
  const role = ['admin', 'manager', 'viewer', 'customer'].includes(b.role) ? b.role : 'viewer';

  let created;
  try {
    created = await L.sb(env, '/auth/v1/admin/users', {
      method: 'POST',
      body: { email, password: String(b.password), email_confirm: true, user_metadata: { name: String(b.name || email).trim() } },
    });
  } catch (e) {
    if (/already/i.test(String(e.message))) throw L.err(409, 'Email already registered.');
    throw e;
  }
  await L.rest.update(env, 'profiles', { id: created.id }, { role, phone: String(b.phone || '') }, true);
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'staff_created', `${role}: ${email}`));
  return L.json({ ok: true, id: created.id });
});

route('PUT', '/api/admin/users/:id', async ({ env, request, g, ctx }) => {
  const u = await L.requireAuth(env, request, ['admin']);
  const b = await readJson(request);
  const prow = (await L.rest.get(env, 'profiles', { id: `eq.${g.id}`, select: '*' }))[0];
  if (!prow) throw L.err(404, 'Not found');
  if (prow.id === u.id && b.role && b.role !== 'admin') throw L.err(400, 'You cannot remove your own admin role.');
  const patch = {};
  if (b.role && ['admin', 'manager', 'viewer', 'customer'].includes(b.role)) patch.role = b.role;
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim();
  if (typeof b.phone === 'string') patch.phone = b.phone.trim();
  if (Object.keys(patch).length) await L.rest.update(env, 'profiles', { id: prow.id }, patch, true);
  if (b.password) {
    if (String(b.password).length < 8) throw L.err(400, 'Password at least 8 characters.');
    await L.sb(env, `/auth/v1/admin/users/${prow.id}`, { method: 'PUT', body: { password: String(b.password) } });
  }
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'user_updated', `#${prow.id}`));
  return L.json({ ok: true });
});

route('DELETE', '/api/admin/users/:id', async ({ env, request, g, ctx }) => {
  const u = await L.requireAuth(env, request, ['admin']);
  if (g.id === u.id) throw L.err(400, 'You cannot delete your own account.');
  const prow = (await L.rest.get(env, 'profiles', { id: `eq.${g.id}`, select: 'id,email' }))[0];
  if (!prow) throw L.err(404, 'Not found');
  await L.sb(env, `/auth/v1/admin/users/${g.id}`, { method: 'DELETE' });
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'user_deleted', `#${g.id} (${prow.email})`));
  return L.json({ ok: true });
});

/* ---------------- testimonials management ---------------- */
route('GET', '/api/admin/testimonials', async ({ env, request }) => {
  await L.staff(env, request);
  const rows = await L.rest.get(env, 'testimonials', { select: '*', order: 'id.desc' });
  return L.json((rows || []).sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0))
    .map((t) => ({ ...t, text: t.body })));
});

route('POST', '/api/admin/testimonials', async ({ env, request }) => {
  await L.writeStaff(env, request);
  const b = await readJson(request);
  if (!b.name || !b.text) throw L.err(400, 'Name and testimonial text are required.');
  const saved = await L.rest.insert(env, 'testimonials', {
    name: String(b.name).trim(),
    location: String(b.location || ''),
    rating: Math.min(Math.max(+(b.rating) || 5, 1), 5),
    body: String(b.text).trim(),
    status: b.status === 'approved' ? 'approved' : 'pending',
    vehicle_label: String(b.vehicle_label || ''),
  });
  return L.json({ ok: true, id: saved && saved.id });
});

route('PUT', '/api/admin/testimonials/:id', async ({ env, request, g }) => {
  await L.writeStaff(env, request);
  const b = await readJson(request);
  if (b.status && ['pending', 'approved', 'rejected'].includes(b.status)) {
    await L.rest.update(env, 'testimonials', { id: `eq.${+g.id || 0}` }, { status: b.status }, true);
  }
  return L.json({ ok: true });
});

route('DELETE', '/api/admin/testimonials/:id', async ({ env, request, g }) => {
  await L.writeStaff(env, request);
  await L.rest.del(env, 'testimonials', { id: `eq.${+g.id || 0}` });
  return L.json({ ok: true });
});

/* ---------------- banners ---------------- */
route('GET', '/api/admin/banners', async ({ env, request }) => {
  await L.staff(env, request);
  const rows = await L.rest.get(env, 'banners', { select: '*', order: 'position.asc,id.asc' });
  return L.json((rows || []).map((b) => ({ ...b, active: !!b.active })));
});

route('POST', '/api/admin/banners', async ({ env, request }) => {
  await L.writeStaff(env, request);
  const b = await readJson(request);
  const saved = await L.rest.insert(env, 'banners', {
    title: String(b.title || 'New banner'), subtitle: String(b.subtitle || ''),
    image: String(b.image || ''), link: String(b.link || ''),
    position: +b.position || 0, active: b.active !== false,
  });
  return L.json({ ok: true, id: saved && saved.id });
});

route('PUT', '/api/admin/banners/:id', async ({ env, request, g }) => {
  await L.writeStaff(env, request);
  const rows = await L.rest.get(env, 'banners', { id: `eq.${+g.id || 0}`, select: '*' });
  const c = rows && rows[0];
  if (!c) throw L.err(404, 'Not found');
  const b = await readJson(request);
  const patch = {};
  if (b.title != null) patch.title = String(b.title);
  if (b.subtitle != null) patch.subtitle = String(b.subtitle);
  if (b.image != null) patch.image = String(b.image);
  if (b.link != null) patch.link = String(b.link);
  if (b.position != null) patch.position = +b.position || 0;
  if (b.active != null) patch.active = !!b.active;
  if (Object.keys(patch).length) await L.rest.update(env, 'banners', { id: c.id }, patch, true);
  return L.json({ ok: true });
});

route('DELETE', '/api/admin/banners/:id', async ({ env, request, g, ctx }) => {
  await L.writeStaff(env, request);
  const rows = await L.rest.get(env, 'banners', { id: `eq.${+g.id || 0}`, select: '*' });
  const c = rows && rows[0];
  if (!c) throw L.err(404, 'Not found');
  await L.rest.del(env, 'banners', { id: c.id });
  if (ctx) ctx.waitUntil(L.storageDelete(env, [c.image]));
  return L.json({ ok: true });
});

route('PUT', '/api/admin/banners/:id/image', async ({ env, request, g, ctx }) => {
  await L.writeStaff(env, request);
  const rows = await L.rest.get(env, 'banners', { id: `eq.${+g.id || 0}`, select: '*' });
  if (!rows || !rows.length) throw L.err(404, 'Not found');
  const ct = request.headers.get('content-type') || 'image/jpeg';
  const ext = ct.split('/')[1].split(';')[0].replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg';
  const objectPath = `banner-${g.id}-${Date.now().toString(36)}.${ext}`;
  const publicUrl = await L.storageUpload(env, 'banners', objectPath, request.body, ct, true);
  await L.rest.update(env, 'banners', { id: +g.id || 0 }, { image: publicUrl }, true);
  if (ctx) ctx.waitUntil(L.logActivity(env, 'system', 'banner_uploaded', objectPath));
  return L.json({ ok: true, image: publicUrl });
});

/* ---------------- orders ---------------- */
route('GET', '/api/admin/orders', async ({ env, request }) => {
  await L.staff(env, request);
  const rows = await L.rest.get(env, 'orders', { select: '*,vehicles(slug,brand,model,year)', order: 'id.desc', limit: '300' });
  return L.json((rows || []).map((o) => ({
    ...o,
    vehicleTitle: o.vehicles ? `${o.vehicles.brand} ${o.vehicles.model} ${o.vehicles.year}` : '',
  })));
});

route('PUT', '/api/admin/orders/:id', async ({ env, request, g }) => {
  await L.staff(env, request, ['admin', 'manager']);
  const b = await readJson(request);
  const patch = {};
  if (b.status && ['new', 'deposit_paid', 'in_progress', 'completed', 'cancelled'].includes(b.status)) patch.status = b.status;
  if (typeof b.notes === 'string') patch.notes = b.notes.slice(0, 2000);
  if (!Object.keys(patch).length) return L.json({ ok: true });
  await L.rest.update(env, 'orders', { id: `eq.${+g.id || 0}` }, patch, true);
  /* real inventory follows the order lifecycle */
  if (patch.status === 'deposit_paid' || patch.status === 'completed') {
    const or = (await L.rest.get(env, 'orders', { id: `eq.${+g.id || 0}`, select: 'vehicle_id' }))[0];
    if (or) {
      await L.rest.update(env, 'vehicles', { id: or.vehicle_id }, {
        status: patch.status === 'completed' ? 'sold' : 'reserved',
        updated_at: new Date().toISOString(),
      }, true);
    }
  }
  return L.json({ ok: true });
});

/* ---------------- settings & activity ---------------- */
route('GET', '/api/admin/settings', async ({ env, request }) => {
  await L.staff(env, request);
  const rows = await L.rest.get(env, 'settings', { select: '*' });
  return L.json(Object.fromEntries((rows || []).map((r) => [r.key, r.value])));
});

route('PUT', '/api/admin/settings', async ({ env, request, ctx }) => {
  const u = await L.requireAuth(env, request, ['admin']);
  const b = await readJson(request);
  const clean = {};
  for (const [k, v] of Object.entries(b || {})) if (typeof v === 'string') clean[k] = v.slice(0, 500);
  if (!Object.keys(clean).length) throw L.err(400, 'Nothing to update.');
  await L.rest.rpc(env, 'set_settings', { p: clean });
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'settings_updated', Object.keys(clean).join(', ')));
  return L.json({ ok: true });
});

route('GET', '/api/admin/activity', async ({ env, request, q }) => {
  await L.staff(env, request);
  const rows = await L.rest.get(env, 'activity_logs', {
    select: '*', order: 'id.desc', limit: String(Math.min(+(q('limit')) || 200, 500)),
  });
  return L.json(rows || []);
});
