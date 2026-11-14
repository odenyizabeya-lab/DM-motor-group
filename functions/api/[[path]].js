/* =============================================================================
 * DM Motor Group — /api/* Pages Function (Cloudflare Worker)
 * Single dispatcher for the website, the Android app and the admin dashboard.
 * Backed entirely by Supabase (Postgres + RLS, GoTrue auth, Storage).
 * ========================================================================== */
import L from '../../shared/api-lib.js';
import aiCustomer from '../../shared/ai-customer.js';
import emailService from '../../shared/email-service.js';
import aiService from '../../shared/ai-service.js';
import { normalizeSettings, toDbSettingsPatch, publicSettings } from '../../shared/settings.js';

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
      const status = e.status || 500;
      /* Never leak storage/PostgREST/provider internals to the client. Admin
       * diagnostic routes can opt in with `expose` when the message is the
       * whole point of the call (for example a failed provider test). */
      if (status >= 500 && !e.expose) {
        console.error(`API ${request.method} ${pathname} -> ${status}:`, e && e.message);
        return L.json({ error: 'The service is temporarily unavailable. Please try again shortly.' }, status);
      }
      return L.json({ error: e.message || 'Request failed' }, status);
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

function updatedFields(b, currentVehicle) {
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
  if (b.keyFeatures != null) patch.features = Array.isArray(b.keyFeatures)
    ? b.keyFeatures : String(b.keyFeatures).split('\n').map((x) => x.trim()).filter(Boolean);
  if (b.safetyFeatures != null) patch.safety_features = Array.isArray(b.safetyFeatures)
    ? b.safetyFeatures : String(b.safetyFeatures).split('\n').map((x) => x.trim()).filter(Boolean);
  set('ownership_info', S('ownershipInfo'));
  if (b.inspectionStatus != null) patch.inspection_status = String(b.inspectionStatus);
  if (b.spec != null && typeof b.spec === 'object') {
    /* the dealer-entered specification sheet is stored inside the
     * inspection_report column as JSON (no database migration needed) */
    const cur = L.parseInspection(currentVehicle && currentVehicle.inspection_report);
    patch.inspection_report = L.serialiseInspection(L.cleanSpec(b.spec), b.inspectionNotes != null ? String(b.inspectionNotes) : cur.notes);
  } else {
    set('inspection_report', S('inspectionReport'));
  }
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
    settings: publicSettings(settings),
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
  const simMedia = await L.mediaFor(env, sim.map((s) => s.id));
  const out = L.vehicleDetailOut(v, md || []);
  out.similar = sim.map((s) => L.vehicleOut(s, simMedia.get(s.id) || []));
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
    countOf(env, 'media', { type: 'eq.video', 'vehicles.status': 'in.(published,reserved)', select: 'id,vehicles!media_vehicle_id_fkey!inner(status)' }),
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
  /* Size is checked first: an oversized payload is rejected before it can
   * consume a rate-limit slot that belongs to a real customer. */
  if (+(request.headers.get('content-length') || 0) > 1024 * 1024) {
    throw L.err(413, 'Request body is too large.');
  }
  /* The limit is per IP and configurable: offices, hotels and mobile carriers
   * share one address, so a fixed low number would block real customers. */
  const rlRows = await L.rest.get(env, 'settings', {
    key: 'in.(enquiry_rate_limit,enquiry_rate_window_min)', select: 'key,value',
  }).catch(() => []);
  const rlMap = Object.fromEntries((rlRows || []).map((r) => [r.key, r.value]));
  const limit = Math.max(3, Math.min(+rlMap.enquiry_rate_limit || 12, 60));
  const windowMin = Math.max(1, Math.min(+rlMap.enquiry_rate_window_min || 10, 120));
  if (!L.rateLimit(`enq:${ip}`, limit, windowMin * 60e3)) {
    throw L.err(429, 'You have submitted several enquiries recently. Please wait a little while.');
  }
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
  /* Hand the enquiry to the autonomous AI customer-relations engine. Failure
   * here must never lose the customer's enquiry: it is already saved. */
  if (ctx) ctx.waitUntil(
    aiCustomer.handleNewEnquiry(env, {
      enquiryId: saved && saved.id,
      name: String(b.name).trim(),
      email,
      vehicleId: vehicle ? vehicle.id : null,
      type,
      message,
      subject: `Website ${TYPE_LABEL[type] || 'enquiry'}`,
    }).catch((e) => console.error('AI enquiry intake failed:', e && e.message)),
  );
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
  if (Object.keys(patch).length) {
    await L.rest.update(env, 'profiles', { id: u.id }, patch, true);
    L.invalidateAuthCache(u.id); /* the next request must see the new profile */
  }
  if (b.password) {
    if (String(b.password).length < 8) throw L.err(400, 'New password must be at least 8 characters.');
    const grant = await fetchToken(env, u.email, String(b.currentPassword || ''));
    if (!grant.token) throw L.err(403, 'Current password is incorrect.');
    await L.sb(env, `/auth/v1/admin/users/${u.id}`, { method: 'PUT', body: { password: String(b.password) } });
    L.invalidateAuthCache(u.id);
  }
  const fresh = await L.authUser(env, request);
  return L.json({ ok: true, user: fresh || null });
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
      `Thanks ${u.name} — your ${type} request for the ${v.brand} ${v.model} has been received. Our team will email you with the next steps and the reservation agreement.`,
      '/vehicles/' + v.slug));
  }
  return L.json({ ok: true, id: saved && saved.id, message: 'Thank you — your request has been received. Our team will email you with the next steps.' });
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
  const parsed = L.parseInspection(rows[0].inspection_report);
  out.spec = parsed.spec;
  out.inspectionReport = parsed.notes;
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
  const patch = updatedFields(b, v);
  if (!Object.keys(patch).length) return L.json({ ok: true });
  await L.rest.update(env, 'vehicles', { id: v.id }, { ...patch, updated_at: new Date().toISOString() }, true);
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'vehicle_updated', `${patch.brand || v.brand} ${patch.model || v.model} (#${v.id})`));
  if (ctx && patch.price != null && Number(patch.price) !== Number(v.price)) {
    ctx.waitUntil(aiCustomer.notifyVehicleChange(env, v.id, { priceFrom: v.price, priceTo: patch.price })
      .catch((e) => console.error('AI price notification failed:', e && e.message)));
  }
  return L.json({ ok: true });
});

/* ---------------------------------------------------------------------------
 * Dealer-entered specification sheet.
 *   PUT    /api/admin/vehicles/:id/spec  { spec: {...}, notes?: "..." }
 *   DELETE /api/admin/vehicles/:id/spec  (clears the dealer override and
 *                                          restores the generated defaults)
 * -------------------------------------------------------------------------- */
route('PUT', '/api/admin/vehicles/:id/spec', async ({ env, request, g, ctx }) => {
  const u = await L.writeStaff(env, request);
  const b = await readJson(request);
  const rows = await L.rest.get(env, 'vehicles', { id: `eq.${+g.id || 0}`, select: '*' });
  const v = rows && rows[0];
  if (!v) throw L.err(404, 'Not found.');
  const cur = L.parseInspection(v.inspection_report);
  const spec = L.cleanSpec(b && b.spec);
  if (!Object.keys(spec).length) throw L.err(400, 'No specification values were supplied.');
  const notes = b && b.notes != null ? String(b.notes).slice(0, 8000) : cur.notes;
  await L.rest.update(env, 'vehicles', { id: v.id }, {
    inspection_report: L.serialiseInspection(spec, notes),
    updated_at: new Date().toISOString(),
  }, true);
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'vehicle_spec_updated',
    `${v.brand} ${v.model} (${Object.keys(spec).length} specification fields)`));
  return L.json({ ok: true, spec, notes });
});

route('DELETE', '/api/admin/vehicles/:id/spec', async ({ env, request, g, ctx }) => {
  const u = await L.writeStaff(env, request);
  const rows = await L.rest.get(env, 'vehicles', { id: `eq.${+g.id || 0}`, select: '*' });
  const v = rows && rows[0];
  if (!v) throw L.err(404, 'Not found.');
  const cur = L.parseInspection(v.inspection_report);
  await L.rest.update(env, 'vehicles', { id: v.id }, {
    inspection_report: cur.notes, updated_at: new Date().toISOString(),
  }, true);
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'vehicle_spec_reset', `${v.brand} ${v.model}`));
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
  /* A vehicle cannot be published without a video that actually plays. */
  if (b.status === 'published') {
    const vids = await L.rest.get(env, 'media', { vehicle_id: `eq.${+g.id || 0}`, type: 'eq.video', select: 'id,url,caption' }, 'position.asc');
    if (!vids || !vids.length) {
      throw L.err(409, 'This vehicle cannot be published yet: it has no video. Upload a vehicle video first - the showroom is video-only.');
    }
    for (const vid of vids) {
      const check = await probeVideo(vid.url);
      if (!check.ok) {
        throw L.err(409, `This vehicle cannot be published yet: the video "${vid.caption || 'video ' + vid.id}" is not playable (${check.reason}).`);
      }
    }
  }
  const before = (await L.rest.get(env, 'vehicles', { id: `eq.${+g.id || 0}`, select: 'id,status' }).catch(() => []))[0];
  await L.rest.update(env, 'vehicles', { id: +g.id || 0 }, { status: b.status, updated_at: new Date().toISOString() }, true);
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'vehicle_status', `#${g.id} → ${b.status}`));
  if (ctx && before && before.status !== b.status) {
    ctx.waitUntil(aiCustomer.notifyVehicleChange(env, before.id, { statusFrom: before.status, statusTo: b.status })
      .catch((e) => console.error('AI availability notification failed:', e && e.message)));
  }
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

  /* Never trust the browser-supplied Content-Type: it is forced from the
   * validated extension so an uploaded "photo" can never be served as HTML. */
  const MIME_BY_EXT = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', webm: 'video/webm', m4v: 'video/x-m4v', mov: 'video/quicktime',
  };
  const declared = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
  const family = contentType.split('/')[0];
  if (declared && declared !== 'application/octet-stream' && !declared.startsWith(family + '/')) {
    throw L.err(400, 'The uploaded file does not match its extension.');
  }
  /* size limits are configurable in Admin → Settings → Media */
  const limitRows = await L.rest.get(env, 'settings', {
    key: `in.(media_max_mb,media_max_video_mb)`, select: 'key,value',
  }).catch(() => []);
  const limitMap = Object.fromEntries((limitRows || []).map((r) => [r.key, r.value]));
  const clampMb = (v, def, max) => Math.min(Math.max(Number(v) || def, 1), max);
  const limitMb = type === 'image'
    ? clampMb(limitMap.media_max_mb, 25, 100)
    : clampMb(limitMap.media_max_video_mb, 95, 100);
  const declaredSize = +(request.headers.get('content-length') || 0);
  if (declaredSize > limitMb * 1024 * 1024) throw L.err(413, `Maximum ${limitMb} MB for ${type} uploads.`);
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

/* ---------------------------------------------------------------------------
 * Video playability probe.
 * A vehicle may only be published when its video can actually be played: the
 * file is fetched with a range request and its container signature checked.
 * -------------------------------------------------------------------------- */
async function probeVideo(url) {
  if (!url || typeof url !== 'string') return { ok: false, reason: 'No video file is attached.' };
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (r.status !== 200 && r.status !== 206) {
      return { ok: false, reason: `The video file could not be fetched (HTTP ${r.status}).` };
    }
    if (ct && !ct.startsWith('video/')) {
      return { ok: false, reason: `The file is served as "${ct}" instead of a video.` };
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    const tag = buf.length > 8 ? String.fromCharCode(buf[4], buf[5], buf[6], buf[7]) : '';
    if (tag !== 'ftyp') {
      return { ok: false, reason: 'The file is not a valid MP4 / MOV video container.' };
    }
    return { ok: true, status: r.status, contentType: ct, bytes: buf.length };
  } catch (e) {
    return { ok: false, reason: 'The video file could not be reached.' };
  }
}

route('GET', '/api/admin/media/:id/check', async ({ env, request, g }) => {
  await L.staff(env, request);
  const rows = await L.rest.get(env, 'media', { id: `eq.${+g.id || 0}`, select: '*' });
  const row = rows && rows[0];
  if (!row) throw L.err(404, 'Not found.');
  if (row.type !== 'video') return L.json({ ok: false, reason: 'This file is not a video.' });
  const res = await probeVideo(row.url);
  return L.json({ ok: res.ok, reason: res.reason || '', status: res.status || 0, contentType: res.contentType || '' });
});

/* Set the video that plays first on the vehicle page. */
route('POST', '/api/admin/media/:id/main', async ({ env, request, g, ctx }) => {
  const u = await L.writeStaff(env, request);
  const rows = await L.rest.get(env, 'media', { id: `eq.${+g.id || 0}`, select: '*' });
  const row = rows && rows[0];
  if (!row) throw L.err(404, 'Not found.');
  if (row.type !== 'video') throw L.err(400, 'Only a video can be the main video.');
  const vid = row.vehicle_id;
  const sibs = await L.rest.get(env, 'media', { vehicle_id: `eq.${vid}`, type: 'eq.video', select: 'id,position' }, 'position.asc');
  const ids = [row.id, ...(sibs || []).filter((m) => m.id !== row.id).map((m) => m.id)];
  for (let i = 0; i < ids.length; i++) {
    await L.rest.update(env, 'media', { id: ids[i] }, { position: i }, true);
  }
  await L.rest.update(env, 'vehicles', { id: vid }, { cover_media_id: row.id, cover: row.url, cover_full: row.url }, true);
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'vehicle_main_video', `#${vid} media ${row.id}`));
  return L.json({ ok: true, order: ids });
});

/* Replace the file of an existing video without losing its caption, order or
 * place in the playlist. */
route('PUT', '/api/admin/media/:id/file', async ({ env, request, url, g, ctx }) => {
  const u = await L.writeStaff(env, request);
  const rows = await L.rest.get(env, 'media', { id: `eq.${+g.id || 0}`, select: '*' });
  const row = rows && rows[0];
  if (!row) throw L.err(404, 'Not found.');
  if (row.type !== 'video') throw L.err(400, 'Only a video file can be replaced here.');
  const s = url.searchParams;
  const origName = String(s.get('filename') || 'video.mp4');
  const ext = (origName.toLowerCase().match(/\.([a-z0-9]+)$/i) || [])[1] || 'mp4';
  if (!L.VID_EXT.includes(ext)) throw L.err(400, `Allowed video formats: ${L.VID_EXT.map((x) => '.' + x).join(', ')}`);
  const MIME_BY_EXT = { mp4: 'video/mp4', webm: 'video/webm', m4v: 'video/x-m4v', mov: 'video/quicktime' };
  const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
  const limitRows = await L.rest.get(env, 'settings', { key: 'media_max_video_mb', select: 'key,value' }).catch(() => []);
  const limitMb = Math.min(Math.max(Number((limitRows || [])[0] && limitRows[0].value) || 95, 1), 100);
  const declaredSize = +(request.headers.get('content-length') || 0);
  if (declaredSize > limitMb * 1024 * 1024) throw L.err(413, `Maximum ${limitMb} MB for video uploads.`);
  const objectPath = `v${row.vehicle_id}/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const publicUrl = await L.storageUpload(env, 'vehicle-media', objectPath, request.body, contentType, true);
  const oldUrl = row.url;
  await L.rest.update(env, 'media', { id: row.id }, { url: publicUrl, thumb_url: '' }, true);
  if (row.cover_media_id === row.id || (await L.rest.get(env, 'vehicles', { id: `eq.${row.vehicle_id}`, select: 'cover_media_id' })).some((x) => x.cover_media_id === row.id)) {
    await L.rest.update(env, 'vehicles', { id: row.vehicle_id }, { cover: publicUrl, cover_full: publicUrl }, true);
  }
  if (ctx) ctx.waitUntil(Promise.all([
    L.storageDelete(env, [oldUrl]),
    L.logActivity(env, u.email, 'video_replaced', `media ${row.id} (${Math.round(declaredSize / 104857.6) / 10}MB)`),
  ]));
  const check = await probeVideo(publicUrl);
  return L.json({ ok: true, url: publicUrl, playable: check.ok, reason: check.reason || '' });
});

route('PUT', '/api/admin/media/:id/thumb', async ({ env, request, g }) => {
  await L.writeStaff(env, request);
  const rows = await L.rest.get(env, 'media', { id: `eq.${+g.id || 0}`, select: '*' });
  const row = rows && rows[0];
  if (!row) throw L.err(404, 'Not found');
  if (row.type !== 'image') throw L.err(400, 'Thumbnails can only be made from an image.');
  if (+(request.headers.get('content-length') || 0) > 5 * 1024 * 1024) throw L.err(413, 'Thumbnail is too large.');
  const access = L.extractStoragePath(row.url);
  if (!access) throw L.err(400, 'Unsupported media url');

  /* The browser supplies the thumbnail bytes, so the file signature is
   * checked before anything is stored: only a real WebP is accepted. */
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length < 12) throw L.err(400, 'The thumbnail file is empty or incomplete.');
  const ascii = (o, n) => String.fromCharCode(...buf.slice(o, o + n));
  const isWebp = ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf[0] === 0x89 && ascii(1, 3) === 'PNG';
  if (!isWebp && !isJpeg && !isPng) throw L.err(400, 'The thumbnail must be a WebP, JPEG or PNG image.');

  const ext = isWebp ? 'webp' : (isJpeg ? 'jpg' : 'png');
  const mime = isWebp ? 'image/webp' : (isJpeg ? 'image/jpeg' : 'image/png');
  const thumbPath = access.path.replace(/\.[a-z0-9]+$/i, '') + '-thumb.' + ext;
  await L.storageUpload(env, access.bucket, thumbPath, buf, mime, false);
  const thumb = L.storagePublic(env, access.bucket, thumbPath);
  await L.rest.update(env, 'media', { id: row.id }, { thumb_url: thumb }, true);
  return L.json({ ok: true, thumb_url: thumb });
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
  L.invalidateAuthCache(created.id);
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
  if (Object.keys(patch).length) {
    await L.rest.update(env, 'profiles', { id: prow.id }, patch, true);
    L.invalidateAuthCache(prow.id); /* a role change must take effect at once */
  }
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
  const BANNER_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const ct = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = BANNER_TYPES[ct];
  if (!ext) throw L.err(400, 'Banner image must be a JPEG, PNG, WebP or GIF image.');
  if (+(request.headers.get('content-length') || 0) > 10 * 1024 * 1024) throw L.err(413, 'Maximum 10 MB for banner images.');
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

route('PUT', '/api/admin/orders/:id', async ({ env, request, g, ctx }) => {
  await L.staff(env, request, ['admin', 'manager']);
  const b = await readJson(request);
  const patch = {};
  if (b.status && ['new', 'deposit_paid', 'in_progress', 'completed', 'cancelled'].includes(b.status)) patch.status = b.status;
  if (typeof b.notes === 'string') patch.notes = b.notes.slice(0, 2000);
  if (!Object.keys(patch).length) return L.json({ ok: true });
  const before = (await L.rest.get(env, 'orders', { id: `eq.${+g.id || 0}`, select: '*' }).catch(() => []))[0];
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
  if (ctx && patch.status && before && before.status !== patch.status) {
    ctx.waitUntil(aiCustomer.notifyOrderUpdate(env, g.id, patch.status)
      .catch((e) => console.error('AI order notification failed:', e && e.message)));
  }
  return L.json({ ok: true });
});

/* ---------------- settings & activity ---------------- */
route('GET', '/api/admin/settings', async ({ env, request }) => {
  await L.staff(env, request);
  const rows = await L.rest.get(env, 'settings', { select: '*' });
  return L.json(normalizeSettings(rows));
});

route('PUT', '/api/admin/settings', async ({ env, request, ctx }) => {
  const u = await L.requireAuth(env, request, ['admin']);
  const b = await readJson(request);
  const clean = {};
  for (const [k, v] of Object.entries(b || {})) if (typeof v === 'string') clean[k] = v.slice(0, 500);
  if (!Object.keys(clean).length) throw L.err(400, 'Nothing to update.');
  /* canonical UI keys -> existing settings rows, so no duplicate keys appear */
  await L.rest.rpc(env, 'set_settings', { p: toDbSettingsPatch(clean) });
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

/* ================================================================== AI SCANNER */
/* POST /api/admin/scan — real AI scan of uploaded car images /
 * full-length video via the configured provider (Gemini primary, OpenAI alternative).
 * Generates a professional listing draft. Body:
 *   { vehicleId?, provider?, images: [{ name, mimeType, dataBase64 }], video?: { name, mimeType, dataBase64 } | null, price?, currency? }
 * Auth: staff. Uses server-only AI provider keys; model configurable per provider.
 */
route('POST', '/api/admin/scan', async ({ env, request, waitUntil, ctx }) => {
  const u = await L.staff(env, request, ['admin', 'manager']);

  /* A scan may carry several base64 photographs plus a full-length video, so the
   * body needs a firm ceiling before it is parsed into memory. */
  const MAX_SCAN_BYTES = 120 * 1024 * 1024;
  if (+(request.headers.get('content-length') || 0) > MAX_SCAN_BYTES) {
    throw L.err(413, 'The scan upload is too large. Use smaller photographs or a shorter video.');
  }

  const b = await L.readJson(request, MAX_SCAN_BYTES);
  const images = (Array.isArray(b.images) ? b.images : []).slice(0, 12);
  const video = b.video && typeof b.video.dataBase64 === 'string' ? b.video : null;
  const providerId = L.aiProviderId(env, b.provider);

  /* Media is validated BEFORE the provider is called: never spend an AI request
   * on an unsupported file, and never trust a browser-supplied MIME type. */
  const IMAGE_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const VIDEO_MIME = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/x-m4v': 'm4v', 'video/quicktime': 'mov' };
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_VIDEO_BYTES = 90 * 1024 * 1024;
  const b64Length = (v) => String(v || '').replace(/^data:[^;]+;base64,/, '').length;

  for (const im of images) {
    const mt = String((im && im.mimeType) || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_MIME[mt]) throw L.err(400, 'Scanned photographs must be JPEG, PNG, WebP or GIF images.');
    if (b64Length(im.dataBase64) > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4) {
      throw L.err(413, 'Each photograph must be 8 MB or smaller.');
    }
  }
  if (video) {
    const mt = String(video.mimeType || '').split(';')[0].trim().toLowerCase();
    if (!VIDEO_MIME[mt]) throw L.err(400, 'Scanned videos must be MP4, WebM, M4V or MOV.');
    if (b64Length(video.dataBase64) > Math.ceil(MAX_VIDEO_BYTES * 4 / 3) + 4) {
      throw L.err(413, 'The video must be 90 MB or smaller.');
    }
  }

  const prompt = [
    'You are an expert automotive listing assistant for an international car dealership.',
    'You will receive one or more photographs and/or one full-length video of a car.',
    'Analyze carefully and return ONLY valid JSON (no markdown fences, no extra text) with this shape:',
    '{"brand":"","model":"","year":null,"price":null,"mileage":null,"transmission":"","fuel":"","engine":"","bodyType":"","exteriorColor":"","interiorColor":"","vin":"","condition":"Used","location":"","description":"","headline":"","sellingPoints":[],"keyFeatures":[],"safetyFeatures":[],"technologyFeatures":[],"interiorFeatures":[],"exteriorFeatures":[],"damage":[],"marketValueEstimate":null,"seoTitle":"","seoDescription":"","ownershipInfo":"","inspectionStatus":"none","inspectionReport":"","category":"sedan","isFeatured":false}',
    'Rules: base all facts strictly on what is visible/provided; never invent specifications or claim verification that did not occur; use null/empty strings for unknowns; mileage only if visibly inferable or provided.',
  ].join(' ');

  let scan;
  try {
    scan = await L.aiGenerate(env, { provider: providerId, images, video, prompt });
  } catch (e) {
    /* Admin-facing diagnostic: the provider reason matters (missing key, quota,
     * suspended account), so surface it without leaking server configuration. */
    throw Object.assign(L.err(503, `AI provider error: ${String(e.message || e).slice(0, 400)}`), { expose: true });
  }

  /* normalize AI output into listing fields */
  const S = (k) => (scan && scan[k] != null ? scan[k] : null);
  const listing = {
    brand: String(S('brand') || '').trim(),
    model: String(S('model') || '').trim(),
    year: S('year') ? +S('year') : null,
    price: S('price') ?? (b.price != null ? +b.price : 0),
    currency: b.currency || 'USD',
    mileage: S('mileage') != null ? +S('mileage') : 0,
    engine: String(S('engine') || ''),
    transmission: String(S('transmission') || ''),
    fuel: String(S('fuel') || ''),
    bodyType: String(S('bodyType') || ''),
    exteriorColor: String(S('exteriorColor') || ''),
    interiorColor: String(S('interiorColor') || ''),
    vin: String(S('vin') || ''),
    condition: String(S('condition') || 'Used'),
    location: String(S('location') || ''),
    description: String(S('description') || ''),
    headline: String(S('headline') || ''),
    sellingPoints: Array.isArray(S('sellingPoints')) ? S('sellingPoints').map(String) : [],
    features: Array.isArray(S('keyFeatures')) ? S('keyFeatures').map(String) : [],
    safetyFeatures: Array.isArray(S('safetyFeatures')) ? S('safetyFeatures').map(String) : [],
    technologyFeatures: Array.isArray(S('technologyFeatures')) ? S('technologyFeatures').map(String) : [],
    interiorFeatures: Array.isArray(S('interiorFeatures')) ? S('interiorFeatures').map(String) : [],
    exteriorFeatures: Array.isArray(S('exteriorFeatures')) ? S('exteriorFeatures').map(String) : [],
    damage: Array.isArray(S('damage')) ? S('damage').map(String) : [],
    marketValueEstimate: S('marketValueEstimate') != null ? +S('marketValueEstimate') : null,
    seoTitle: String(S('seoTitle') || ''),
    seoDescription: String(S('seoDescription') || ''),
    ownershipInfo: String(S('ownershipInfo') || ''),
    inspectionStatus: String(S('inspectionStatus') || 'none'),
    inspectionReport: String(S('inspectionReport') || ''),
    category: String(S('category') || 'sedan'),
    isFeatured: !!S('isFeatured'),
  };

  /* map the AI result into REAL database columns (snake_case) — the scan must
   * never send unknown keys to PostgREST or the insert/update fails */
  const dbListing = {
    brand: listing.brand, model: listing.model, year: listing.year, price: listing.price, currency: listing.currency,
    mileage: listing.mileage, engine: listing.engine, transmission: listing.transmission, fuel: listing.fuel,
    body_type: listing.bodyType, exterior_color: listing.exteriorColor, interior_color: listing.interiorColor,
    vin: listing.vin, condition: listing.condition, location: listing.location, description: listing.description,
    features: listing.keyFeatures || listing.features || [], safety_features: listing.safetyFeatures || [],
    ownership_info: listing.ownershipInfo, inspection_status: listing.inspectionStatus, inspection_report: listing.inspectionReport,
    category: listing.category, is_featured: listing.isFeatured,
  };

  let vehicleId = null;
  if (b.vehicleId) {
    await L.rest.update(env, 'vehicles', { id: `eq.${+b.vehicleId || 0}` }, { ...dbListing, updated_at: new Date().toISOString() }, true);
    vehicleId = +b.vehicleId;
  } else {
    const slug = L.slugify(`${listing.brand}-${listing.model}-${listing.year}`.replace(/[^a-z0-9]+/gi, '-'));
    const row = await L.rest.insert(env, 'vehicles', { ...dbListing, slug, status: 'draft' });
    vehicleId = row && row.id ? row.id : null;
  }

  /* best-effort: store scanned media in Supabase Storage + record media rows on
   * the vehicle.  MIME type and extension come only from the whitelist above. */
  try {
    if (vehicleId) {
      const decode = (b64, maxBytes) => {
        const clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
        if (!clean) return null;
        /* base64 expands by ~4/3; reject before decoding to avoid huge allocations */
        if (clean.length > Math.ceil(maxBytes * 4 / 3) + 4) return null;
        try { return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0)); } catch { return null; }
      };

      for (const im of images) {
        const mt = String((im && im.mimeType) || '').split(';')[0].trim().toLowerCase();
        const ext = IMAGE_MIME[mt];
        if (!ext) continue; /* unknown image type: never store it */
        const bytes = decode(im && im.dataBase64, MAX_IMAGE_BYTES);
        if (!bytes || !bytes.length) continue;
        const objectPath = `v${vehicleId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const publicUrl = await L.storageUpload(env, 'vehicle-media', objectPath, bytes, mt, false);
        const saved = await L.rest.insert(env, 'media', { vehicle_id: vehicleId, type: 'image', url: publicUrl, thumb_url: '', caption: String(im.name || '').slice(0, 300), category: 'exterior', position: 0 });
        await L.rest.update(env, 'vehicles', { id: `eq.${vehicleId}` }, { cover_media_id: saved && saved.id, cover: publicUrl, cover_full: publicUrl }, true);
      }

      if (video) {
        const mt = String(video.mimeType || '').split(';')[0].trim().toLowerCase();
        const ext = VIDEO_MIME[mt];
        const bytes = ext ? decode(video.dataBase64, MAX_VIDEO_BYTES) : null;
        if (ext && bytes && bytes.length) {
          const objectPath = `v${vehicleId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const publicUrl = await L.storageUpload(env, 'vehicle-media', objectPath, bytes, mt, false);
          await L.rest.insert(env, 'media', { vehicle_id: vehicleId, type: 'video', url: publicUrl, thumb_url: '', caption: String(video.name || '').slice(0, 300), category: 'video', position: 0 });
        }
      }
    }
  } catch (me) { /* media persistence is best-effort; the AI listing itself is authoritative */ }

  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'ai_scan', `${providerId} scan → vehicle #${vehicleId || 'new'}`));
  return L.json({ ok: true, provider: providerId, scan: listing, vehicleId, mediaReceived: { images: images.length, video: !!video } });
});

/* GET /api/admin/ai/status — AI provider health/availability for the scanner. */
route('GET', '/api/admin/ai/status', async ({ env, request }) => {
  await L.staff(env, request, ['admin', 'manager']);
  const provider = L.aiProviderId(env, null);
  const keyEnvName = provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
  const modelEnvName = provider === 'openai' ? 'OPENAI_MODEL' : 'GEMINI_MODEL';
  const model = String(env[modelEnvName] || (provider === 'openai' ? 'gpt-4o-mini' : 'gemini-2.0-flash') || '').trim();
  const configured = !!env[keyEnvName];
  let status = 'disconnected';
  let last_error = configured ? '' : `No API key configured for the ${provider === 'openai' ? 'OpenAI' : 'Gemini'} provider.`;
  let detail = configured ? '' : 'Add the API key in Admin → Integrations / AI settings to enable scanning.';
  if (configured) {
    try {
      const probe = await L.aiGenerate(env, { provider, images: [], video: null, prompt: 'Return the JSON object {"ok":true}.' });
      status = (probe && (probe.ok === true || probe.raw)) ? 'connected' : 'error';
      if (status === 'connected') detail = `${provider === 'openai' ? 'OpenAI' : 'Gemini'} responded successfully (model: ${model}).`;
    } catch (e) { status = 'error'; last_error = e.message || 'AI provider probe failed.'; }
  }
  return L.json({ ok: true, provider, status, model, configured, detail, last_error, checked_at: new Date().toISOString() });
});

/* ================================================== API KEYS & INTEGRATIONS CENTRE */
const INTEGRATION_KINDS = ['ai', 'database', 'infra', 'email', 'payment', 'social', 'other'];
const INTEGRATION_PRESETS = [
  { id: 'gemini', name: 'Google Gemini AI', kind: 'ai', hasSecret: true, secretEnv: 'GEMINI_API_KEY', description: 'Primary vehicle image / video analysis engine (Google AI).' },
  { id: 'openai', name: 'OpenAI AI', kind: 'ai', hasSecret: true, secretEnv: 'OPENAI_API_KEY', description: 'Alternative vehicle image / video analysis engine (OpenAI). Switchable in AI settings.' },
  { id: 'supabase', name: 'Supabase', kind: 'database', hasSecret: true, secretEnv: 'SUPABASE_SERVICE_KEY', description: 'Postgres + auth + storage backend.' },
  { id: 'cloudflare', name: 'Cloudflare', kind: 'infra', hasSecret: true, secretEnv: 'CLOUDFLARE_API_TOKEN', description: 'Pages hosting, Workers, R2 and DNS.' },
];

route('GET', '/api/admin/integrations', async ({ env, request }) => {
  await L.staff(env, request, ['admin']);
  const rows = await L.rest.get(env, 'admin_integrations', { select: '*', order: 'created_at.desc' });
  return L.json(rows || []);
});

route('POST', '/api/admin/integrations', async ({ env, request, ctx }) => {
  const u = await L.staff(env, request, ['admin']);
  const b = await L.readJson(request);
  const provider = String(b.provider || 'gemini').slice(0, 60);
  const name = String(b.name || provider).slice(0, 120);
  const kind = INTEGRATION_KINDS.includes(b.kind) ? b.kind : 'other';
  const status = b.status === 'connected' ? 'connected' : 'disconnected';
  const masked_value = b.masked_value ? String(b.masked_value).slice(0, 120) : '';
  const config = b.config && typeof b.config === 'object' ? b.config : {};
  const cleanConfig = {};
  for (const [k, v] of Object.entries(config)) { if (typeof v === 'string') cleanConfig[k] = v.slice(0, 300); else if (v != null) cleanConfig[k] = String(v); }
  const row = await L.rest.insert(env, 'admin_integrations', { owner_id: u.id, provider, name, kind, status, masked_value, config: cleanConfig });
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'integration_saved', `${provider} (${name})`));
  return L.json({ ok: true, id: row && row.id });
});

route('PUT', '/api/admin/integrations/:id', async ({ env, request, g, ctx }) => {
  const u = await L.staff(env, request, ['admin']);
  /* admin_integrations.id is a uuid — it must not be coerced to a number. */
  const id = String(g.id || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw L.err(400, 'Invalid integration id.');
  const b = await L.readJson(request);
  const patch = {};
  if (b.name !== undefined) patch.name = String(b.name).slice(0, 120);
  if (b.kind !== undefined) patch.kind = INTEGRATION_KINDS.includes(b.kind) ? b.kind : 'other';
  if (b.status !== undefined) patch.status = b.status === 'connected' ? 'connected' : 'disconnected';
  if (b.masked_value !== undefined) patch.masked_value = String(b.masked_value).slice(0, 120);
  if (b.config !== undefined) { const c = {}; for (const [k, v] of Object.entries(b.config || {})) c[k] = typeof v === 'string' ? v.slice(0, 300) : String(v); patch.config = c; }
  if (b.last_error !== undefined) patch.last_error = String(b.last_error || '').slice(0, 300);
  patch.updated_at = new Date().toISOString();
  await L.rest.update(env, 'admin_integrations', { id: `eq.${id}` }, patch, true);
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'integration_updated', `#${id}`));
  return L.json({ ok: true });
});

route('DELETE', '/api/admin/integrations/:id', async ({ env, request, g, ctx }) => {
  const u = await L.staff(env, request, ['admin']);
  const id = String(g.id || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw L.err(400, 'Invalid integration id.');
  await L.rest.del(env, 'admin_integrations', { id: `eq.${id}` });
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'integration_deleted', `#${id}`));
  return L.json({ ok: true });
});

route('POST', '/api/admin/integrations/test', async ({ env, request, ctx }) => {
  const u = await L.staff(env, request, ['admin', 'manager']);
  const b = await L.readJson(request);
  const provider = String(b.provider || 'gemini').slice(0, 60);
  const apiKey = String(b.apiKey || env.GEMINI_API_KEY || '');
  let status = 'disconnected';
  let last_error = '';
  let detail = '';
  if (provider === 'gemini') {
    if (!apiKey) { status = 'error'; last_error = 'Gemini API key is missing.'; }
    else {
      const mr = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=20', { headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' } });
      const mj = await mr.json().catch(() => ({}));
      if (mr.ok) { status = 'connected'; detail = `Gemini models reachable (${(mj.models || []).length} returned).`; }
      else { status = 'error'; last_error = mj && mj.error && mj.error.message ? mj.error.message : `Gemini test failed (${mr.status}).`; }
    }
  } else if (provider === 'openai') {
    const okey = String(b.apiKey || env.OPENAI_API_KEY || '');
    if (!okey) { status = 'error'; last_error = 'OpenAI API key is missing.'; }
    else {
      const or2 = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${okey}`, 'Content-Type': 'application/json' } });
      const oj = await or2.json().catch(() => ({}));
      if (or2.ok) { status = 'connected'; detail = `OpenAI API reachable (${(oj.data || []).length} models listed).`; }
      else { status = 'error'; last_error = (oj && oj.error && oj.error.message) || `OpenAI test failed (${or2.status}).`; }
    }
  } else if (provider === 'supabase') {
    if (!env.SUPABASE_URL) { status = 'error'; last_error = 'Supabase URL is not configured.'; }
    else { const sr = await fetch(`${env.SUPABASE_URL}/rest/v1/`, { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }); if (sr.ok) { status = 'connected'; detail = 'Supabase REST reachable.'; } else { status = 'error'; last_error = `Supabase test failed (${sr.status}).`; } }
  } else if (provider === 'cloudflare') {
    if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) { status = 'error'; last_error = 'Cloudflare credentials are not configured on the server.'; }
    else {
      const cr = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts`, { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' } });
      const cj = await cr.json().catch(() => ({}));
      if (cr.ok && cj.success) { status = 'connected'; detail = 'Cloudflare API reachable.'; } else { status = 'error'; last_error = (cj && cj.errors && cj.errors[0] && cj.errors[0].message) || `Cloudflare test failed (${cr.status}).`; }
    }
  } else { status = 'error'; last_error = `No test implementation for provider "${provider}".`; }
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'integration_test', `${provider}: ${status}`));
  return L.json({ ok: true, provider, status, detail, last_error: status === 'connected' ? '' : last_error, tested_at: new Date().toISOString() });
});

/* ============================================================================
 * AI CUSTOMER SERVICE — public intake, inbound email webhook, cron tick and
 * the admin control centre. All credentials stay server-side.
 * ========================================================================== */

const AI_SECRET_KEYS = ['gemini_api_key', 'openai_api_key', 'resend_api_key', 'brevo_api_key', 'resend_webhook_secret', 'internal_key'];
const AI_ENV_KEY = {
  gemini_api_key: 'GEMINI_API_KEY',
  openai_api_key: 'OPENAI_API_KEY',
  resend_api_key: 'RESEND_API_KEY',
  brevo_api_key: 'BREVO_API_KEY',
  resend_webhook_secret: 'RESEND_WEBHOOK_SECRET',
  internal_key: 'AI_INTERNAL_KEY',
};
const maskSecret = (v) => {
  const s = String(v || '');
  if (!s) return '';
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};

async function putSecrets(env, obj) {
  const rows = Object.entries(obj || {})
    .filter(([k, v]) => AI_SECRET_KEYS.includes(k) && typeof v === 'string' && v.trim() !== '')
    .map(([key, value]) => ({ key, value: value.trim(), updated_at: new Date().toISOString() }));
  if (!rows.length) return 0;
  await L.sb(env, '/rest/v1/ai_secrets', {
    method: 'POST',
    body: rows,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return rows.length;
}

/* -------------------------------------------------- public inspection form */
route('POST', '/api/inspections', async ({ env, request, ip, ctx }) => {
  if (!L.rateLimit(`insp:${ip}`, 5, 10 * 60e3)) throw L.err(429, 'You have submitted several requests recently. Please wait a little while.');
  const b = await readJson(request);
  if (b.website) return L.json({ ok: true });

  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const message = String(b.message || '').trim();
  if (name.length < 2) throw L.err(400, 'Please enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw L.err(400, 'Please enter a valid email address.');
  if (message.length > 3000) throw L.err(400, 'Your message is too long.');

  let vehicle = null;
  if (b.vehicleId) {
    const rows = await L.rest.get(env, 'vehicles', { id: `eq.${+b.vehicleId || 0}`, select: 'id,brand,model,year,status,slug' }).catch(() => []);
    vehicle = (rows && rows[0]) || null;
  } else if (b.vehicleSlug) {
    const rows = await L.rest.get(env, 'vehicles', { slug: `eq.${String(b.vehicleSlug).slice(0, 120)}`, select: 'id,brand,model,year,status,slug' }).catch(() => []);
    vehicle = (rows && rows[0]) || null;
  }
  if (!vehicle || !['published', 'reserved'].includes(vehicle.status)) {
    throw L.err(400, 'Please choose a vehicle that is currently available.');
  }

  const preferredDate = String(b.preferredDate || '').trim();
  if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) throw L.err(400, 'Please choose a valid inspection date.');
  if (preferredDate && preferredDate < new Date().toISOString().slice(0, 10)) throw L.err(400, 'Please choose a date in the future.');
  const preferredTime = String(b.preferredTime || '').trim().slice(0, 40);

  const result = await aiCustomer.handleInspectionRequest(env, {
    name, email,
    vehicleId: vehicle.id,
    preferredDate, preferredTime,
    message,
  });
  if (ctx) ctx.waitUntil(L.logActivity(env, email, 'inspection_requested', `${vehicle.brand} ${vehicle.model} (#${vehicle.id}) ${preferredDate || ''} ${preferredTime || ''}`.trim()));
  return L.json({
    ok: true,
    id: result.inspection && result.inspection.id,
    status: 'requested',
    message: 'Your inspection request has been received. This is a request only — our team will email you to confirm the appointment.',
  });
});

/* ------------------------------------------------------- inbound email hook */
route('POST', '/api/webhooks/resend', async ({ env, request }) => {
  const rawBody = await request.text();
  let cfg;
  try { cfg = await aiCustomer.loadConfig(env); } catch { throw L.err(503, 'AI database is not ready.'); }
  const secret = cfg.webhookSecret;
  if (!secret) throw L.err(503, 'Inbound webhook secret is not configured.');

  const valid = await emailService.verifyWebhook(secret, rawBody, request.headers);
  if (!valid) throw L.err(401, 'Invalid webhook signature.');

  let event;
  try { event = JSON.parse(rawBody); } catch { throw L.err(400, 'Invalid JSON.'); }
  const type = String(event.type || '').slice(0, 60);
  const data = event.data || {};
  const providerId = String(data.email_id || data.id || '');

  try {
    await L.rest.insert(env, 'ai_email_events', { provider: 'resend', event_type: type, provider_id: providerId, payload: event });
  } catch {
    return L.json({ ok: true, duplicate: true });
  }

  try {
    if (type === 'email.received') {
      const full = providerId ? await emailService.fetchReceivedEmail(env, L.rest, providerId) : data;
      const out = await aiCustomer.handleInboundEmail(env, full || data);
      await L.rest.update(env, 'ai_email_events', { provider: 'resend', event_type: type, provider_id: providerId }, { processed: true }, true).catch(() => {});
      return L.json({ ok: true, ...out });
    }

    const statusMap = {
      'email.sent': 'sent',
      'email.delivered': 'delivered',
      'email.delivery_delayed': 'sent',
      'email.bounced': 'bounced',
      'email.failed': 'failed',
      'email.complained': 'failed',
    };
    const mapped = statusMap[type];
    if (mapped && providerId) {
      const patch = { status: mapped, updated_at: new Date().toISOString() };
      if (type === 'email.bounced' || type === 'email.failed' || type === 'email.complained') {
        patch.error = String(data.bounce?.message || data.reason || type).slice(0, 900);
      }
      await L.rest.update(env, 'ai_messages', { provider_message_id: `eq.${providerId}` }, patch, true).catch(() => {});
    }
    await L.rest.update(env, 'ai_email_events', { provider: 'resend', event_type: type, provider_id: providerId }, { processed: true }, true).catch(() => {});
    return L.json({ ok: true });
  } catch (e) {
    await L.rest.update(env, 'ai_email_events', { provider: 'resend', event_type: type, provider_id: providerId }, { error: String(e.message || e).slice(0, 900) }, true).catch(() => {});
    throw L.err(500, e.message || 'Webhook processing failed.');
  }
});

/* -------------------------------------------------------------- cron ticker */
route('POST', '/api/internal/ai/tick', async ({ env, request }) => {
  const supplied = request.headers.get('x-internal-key') || '';
  let cfg;
  try { cfg = await aiCustomer.loadConfig(env); } catch { throw L.err(503, 'AI database is not ready.'); }
  const expected = cfg.internalKey || env.AI_INTERNAL_KEY || '';
  if (!expected || supplied.length !== expected.length) throw L.err(403, 'Forbidden.');
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) throw L.err(403, 'Forbidden.');

  const results = await aiCustomer.processJobs(env, 12);
  const followups = await aiCustomer.scheduleFollowups(env).catch(() => ({ skipped: true }));
  return L.json({ ok: true, processed: results.length, results, followups, at: new Date().toISOString() });
});

/* ---------------------------------------------------------------- overview */
route('GET', '/api/admin/ai/overview', async ({ env, request }) => {
  await L.staff(env, request);

  /* The AI tables live in migration 00007. Probe them up-front so the
   * dashboard can say "apply the migration" instead of silently reporting
   * zero conversations, zero jobs and a green status. */
  const AI_TABLES = ['ai_settings', 'ai_secrets', 'ai_conversations', 'ai_messages', 'ai_inspections', 'ai_jobs', 'ai_email_events'];
  const missingTables = await L.missingTables(env, AI_TABLES);
  const dbReady = missingTables.length === 0;

  const cfg = await aiCustomer.loadConfig(env);
  const s = cfg.settings || {};
  const [open, escalated, requested, pendingJobs, failedJobs, emailsToday, conversations, jobs] = await Promise.all([
    L.rest.count(env, 'ai_conversations', { status: 'in.(open,pending)' }).catch(() => 0),
    L.rest.count(env, 'ai_conversations', { escalated: 'eq.true', status: 'neq.closed' }).catch(() => 0),
    L.rest.count(env, 'ai_inspections', { status: 'eq.requested' }).catch(() => 0),
    L.rest.count(env, 'ai_jobs', { status: 'eq.pending' }).catch(() => 0),
    L.rest.count(env, 'ai_jobs', { status: 'eq.failed' }).catch(() => 0),
    aiCustomer.outboundToday(env).catch(() => 0),
    L.rest.get(env, 'ai_conversations', { select: 'id,customer_name,customer_email,vehicle_id,status,ai_paused,human_takeover,escalated,last_message_at,updated_at,vehicles(brand,model,year,slug)', order: 'updated_at.desc', limit: '8' }).catch(() => []),
    L.rest.get(env, 'ai_jobs', { select: 'id,kind,status,attempts,run_after,last_error,created_at', order: 'id.desc', limit: '10' }).catch(() => []),
  ]);

  const configured = (k) => !!(cfg.secrets && cfg.secrets[k]);
  const envConfigured = (k) => !!(env[k] && String(env[k]).trim());
  const status = {
    enabled: !!s.enabled,
    aiConfigured: !!(cfg.geminiKey || cfg.openaiKey),
    geminiConfigured: !!(cfg.geminiKey),
    openaiConfigured: !!(cfg.openaiKey),
    emailConfigured: !!(cfg.resendKey || cfg.brevoKey),
    resendConfigured: !!cfg.resendKey,
    brevoConfigured: !!cfg.brevoKey,
    inboundConfigured: !!(cfg.webhookSecret && s.reply_domain && s.from_email),
    fromEmail: s.from_email || '',
    replyDomain: s.reply_domain || '',
    provider: s.ai_provider || 'gemini',
    model: (s.ai_provider === 'openai' ? s.openai_model : s.gemini_model) || '',
  };
  const missing = [];
  if (!dbReady) missing.push(`Apply migration 00007_ai_customer_service.sql — missing tables: ${missingTables.join(', ')}.`);
  if (!status.aiConfigured) missing.push('Add a Gemini API key (free tier) in Credentials.');
  if (!status.emailConfigured) missing.push('Add a Resend API key in Credentials.');
  if (!s.from_email) missing.push('Set the sender email address in Settings.');
  if (!s.reply_domain) missing.push('Set the inbound reply domain in Settings.');
  if (!cfg.webhookSecret) missing.push('Add the Resend webhook signing secret in Credentials.');
  if (!s.enabled) missing.push('Activate the assistant when the checks above are complete.');

  const secretStatus = Object.fromEntries(AI_SECRET_KEYS.map((k) => [k, {
    configured: configured(k) || envConfigured(AI_ENV_KEY[k]),
    masked: configured(k) ? maskSecret(cfg.secrets[k]) : '',
    source: configured(k) ? 'database' : (envConfigured(AI_ENV_KEY[k]) ? 'environment' : ''),
  }]));

  return L.json({
    settings: s,
    status,
    missing,
    db: { ready: dbReady, missingTables },
    secrets: secretStatus,
    stats: { open, escalated, requested, pendingJobs, failedJobs, emailsToday },
    conversations: conversations || [],
    jobs: jobs || [],
  });
});

/* ---------------------------------------------------------------- settings */
route('GET', '/api/admin/ai/settings', async ({ env, request }) => {
  await L.staff(env, request);
  return L.json(await aiCustomer.getSettings(env));
});

route('PUT', '/api/admin/ai/settings', async ({ env, request, ctx }) => {
  const u = await L.requireAuth(env, request, ['admin']);
  const b = await readJson(request);
  const patch = {};
  const str = (k, max = 500) => { if (typeof b[k] === 'string') patch[k] = b[k].trim().slice(0, max); };
  const int = (k, min, max) => { if (b[k] != null && Number.isFinite(+b[k])) patch[k] = Math.max(min, Math.min(max, Math.trunc(+b[k]))); };
  if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
  str('business_name', 120); str('team_name', 120); str('from_name', 120);
  str('from_email', 200); str('admin_email', 200); str('reply_domain', 200);
  str('timezone', 80); str('tone', 400); str('instructions', 5000); str('signature', 400);
  str('gemini_model', 80); str('openai_model', 80);
  if (b.ai_provider != null) patch.ai_provider = b.ai_provider === 'openai' ? 'openai' : 'gemini';
  int('daily_email_cap', 0, 500); int('reply_delay_seconds', 0, 86400); int('followup_hours', 0, 720);

  if (patch.from_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.from_email)) throw L.err(400, 'Sender email is not valid.');
  if (patch.admin_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.admin_email)) throw L.err(400, 'Admin notification email is not valid.');
  if (patch.reply_domain) patch.reply_domain = patch.reply_domain.replace(/^https?:\/\//i, '').replace(/^@/, '').replace(/\/.*$/, '').toLowerCase();

  if (!Object.keys(patch).length) throw L.err(400, 'Nothing to update.');
  await aiCustomer.saveSettings(env, patch);
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'ai_settings_updated', Object.keys(patch).join(', ')));
  return L.json({ ok: true, settings: await aiCustomer.getSettings(env) });
});

/* ------------------------------------------------------------- credentials */
route('GET', '/api/admin/ai/credentials', async ({ env, request }) => {
  await L.staff(env, request, ['admin']);
  const cfg = await aiCustomer.loadConfig(env);
  const out = {};
  for (const k of AI_SECRET_KEYS) {
    const db = cfg.secrets && cfg.secrets[k];
    const envKey = AI_ENV_KEY[k];
    out[k] = {
      configured: !!(db || env[envKey]),
      masked: db ? maskSecret(db) : (env[envKey] ? maskSecret(env[envKey]) : ''),
      source: db ? 'database' : (env[envKey] ? 'environment' : ''),
    };
  }
  return L.json(out);
});

route('PUT', '/api/admin/ai/credentials', async ({ env, request, ctx }) => {
  const u = await L.requireAuth(env, request, ['admin']);
  const b = await readJson(request);
  const updated = await putSecrets(env, b);
  const clear = Array.isArray(b.clear) ? b.clear.filter((k) => AI_SECRET_KEYS.includes(k)) : [];
  for (const k of clear) await L.rest.del(env, 'ai_secrets', { key: k }).catch(() => {});
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'ai_credentials_updated', `${updated} updated${clear.length ? `, ${clear.length} cleared` : ''}`));
  return L.json({ ok: true, updated, cleared: clear });
});

/* ------------------------------------------------------------ conversations */
route('GET', '/api/admin/ai/conversations', async ({ env, request, q }) => {
  await L.staff(env, request);
  const per = Math.max(1, Math.min(50, +q('per') || 20));
  const page = Math.max(0, +q('page') || 0);
  const status = String(q('status') || '').trim();
  const search = imp(String(q('q') || '').trim());
  const filters = {};
  if (['open', 'pending', 'closed'].includes(status)) filters.status = `eq.${status}`;
  if (search) filters.or = `(customer_email.ilike.*${search}*,customer_name.ilike.*${search}*)`;
  const [rows, total] = await Promise.all([
    L.rest.get(env, 'ai_conversations', {
      ...filters,
      select: '*,vehicles(brand,model,year,slug,status,price,currency)',
      order: 'updated_at.desc',
      limit: String(per),
      offset: String(page * per),
    }),
    L.rest.count(env, 'ai_conversations', filters),
  ]);
  return L.json({ items: rows || [], total, page, per });
});

route('GET', '/api/admin/ai/conversations/:id', async ({ env, request, g }) => {
  await L.staff(env, request);
  const id = String(g.id).replace(/[^a-f0-9-]/gi, '');
  const rows = await L.rest.get(env, 'ai_conversations', {
    id: `eq.${id}`, select: '*,vehicles(id,slug,brand,model,year,status,price,currency,mileage,engine,transmission,fuel,condition,location)',
  }).catch(() => []);
  const conversation = rows && rows[0];
  if (!conversation) throw L.err(404, 'Conversation not found.');
  const [messages, inspections] = await Promise.all([
    L.rest.get(env, 'ai_messages', { conversation_id: `eq.${id}`, select: '*', order: 'created_at.asc', limit: '400' }).catch(() => []),
    L.rest.get(env, 'ai_inspections', { conversation_id: `eq.${id}`, select: '*', order: 'id.desc' }).catch(() => []),
  ]);
  return L.json({ conversation, messages: messages || [], inspections: inspections || [] });
});

route('POST', '/api/admin/ai/conversations/:id/reply', async ({ env, request, g, ctx }) => {
  const u = await L.writeStaff(env, request);
  const b = await readJson(request);
  const text = String(b.text || '').trim();
  if (text.length < 2) throw L.err(400, 'Write a reply first.');
  if (text.length > 12000) throw L.err(400, 'Reply is too long.');
  const id = String(g.id).replace(/[^a-f0-9-]/gi, '');
  const conv = (await L.rest.get(env, 'ai_conversations', { id: `eq.${id}`, select: '*' }).catch(() => []))[0];
  if (!conv) throw L.err(404, 'Conversation not found.');
  const settings = await aiCustomer.getSettings(env);
  const subject = String(b.subject || '').trim().slice(0, 240) || `Re: ${conv.subject || 'Your enquiry — DM Motor Group'}`;
  const msg = await aiCustomer.recordMessage(env, id, {
    direction: 'outbound',
    fromEmail: settings.from_email || '',
    toEmail: conv.customer_email,
    subject,
    bodyText: text,
    status: 'queued',
  });
  await L.rest.update(env, 'ai_conversations', { id }, { human_takeover: true, ai_paused: true, updated_at: new Date().toISOString() }, true);
  const sent = await aiCustomer.processJob(env, { kind: 'send_manual', payload: { messageId: msg.id } });
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'ai_manual_reply', `${conv.customer_email} — ${subject}`));
  return L.json({ ok: true, messageId: msg.id, sent });
});

route('POST', '/api/admin/ai/conversations/:id/pause', async ({ env, request, g }) => {
  await L.writeStaff(env, request);
  const b = await readJson(request);
  const id = String(g.id).replace(/[^a-f0-9-]/gi, '');
  await L.rest.update(env, 'ai_conversations', { id }, { ai_paused: !!b.paused, updated_at: new Date().toISOString() }, true);
  return L.json({ ok: true, paused: !!b.paused });
});

route('POST', '/api/admin/ai/conversations/:id/takeover', async ({ env, request, g }) => {
  await L.writeStaff(env, request);
  const b = await readJson(request);
  const id = String(g.id).replace(/[^a-f0-9-]/gi, '');
  await L.rest.update(env, 'ai_conversations', { id }, {
    human_takeover: !!b.takeover,
    ai_paused: !!b.takeover,
    updated_at: new Date().toISOString(),
  }, true);
  return L.json({ ok: true, takeover: !!b.takeover });
});

route('POST', '/api/admin/ai/conversations/:id/close', async ({ env, request, g }) => {
  await L.writeStaff(env, request);
  const id = String(g.id).replace(/[^a-f0-9-]/gi, '');
  await L.rest.update(env, 'ai_conversations', { id }, { status: 'closed', updated_at: new Date().toISOString() }, true);
  return L.json({ ok: true, status: 'closed' });
});

/* -------------------------------------------------------------- inspections */
route('GET', '/api/admin/ai/inspections', async ({ env, request, q }) => {
  await L.staff(env, request);
  const status = String(q('status') || '').trim();
  const filters = {};
  if (['requested', 'confirmed', 'rescheduled', 'cancelled', 'completed'].includes(status)) filters.status = `eq.${status}`;
  const rows = await L.rest.get(env, 'ai_inspections', {
    ...filters,
    select: '*,vehicles(brand,model,year,slug,status)',
    order: 'id.desc',
    limit: '200',
  }).catch(() => []);
  return L.json({ items: rows || [] });
});

route('PUT', '/api/admin/ai/inspections/:id', async ({ env, request, g, ctx }) => {
  const u = await L.writeStaff(env, request);
  const b = await readJson(request);
  const rows = await L.rest.get(env, 'ai_inspections', { id: `eq.${+g.id || 0}`, select: '*' }).catch(() => []);
  const inspection = rows && rows[0];
  if (!inspection) throw L.err(404, 'Inspection request not found.');
  const allowed = ['requested', 'confirmed', 'rescheduled', 'cancelled', 'completed'];
  if (b.status != null && !allowed.includes(b.status)) throw L.err(400, 'Invalid inspection status.');
  const patch = { updated_at: new Date().toISOString() };
  if (b.status != null) patch.status = b.status;
  if (typeof b.admin_notes === 'string') patch.admin_notes = b.admin_notes.trim().slice(0, 2000);
  if (typeof b.confirmedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.confirmedDate)) patch.confirmed_date = b.confirmedDate;
  if (typeof b.confirmedTime === 'string') patch.confirmed_time = b.confirmedTime.trim().slice(0, 40);
  if (patch.status === 'confirmed' || patch.status === 'rescheduled') {
    if (!patch.confirmed_date && inspection.preferred_date) patch.confirmed_date = inspection.preferred_date;
    if (!patch.confirmed_time && inspection.preferred_time) patch.confirmed_time = inspection.preferred_time;
    if (!patch.confirmed_date) throw L.err(400, 'Set a confirmed date before confirming or rescheduling.');
    if (!patch.confirmed_time) throw L.err(400, 'Set a confirmed time before confirming or rescheduling.');
  }
  await L.rest.update(env, 'ai_inspections', { id: inspection.id }, patch, true);
  if (patch.status && patch.status !== inspection.status) {
    await aiCustomer.enqueue(env, 'inspection_status', {
      inspectionId: inspection.id,
      status: patch.status,
    }, { idempotencyKey: `inspection:${inspection.id}:${patch.status}:${patch.confirmed_date || ''}:${patch.confirmed_time || ''}` });
  }
  if (ctx) ctx.waitUntil(L.logActivity(env, u.email, 'inspection_updated', `#${inspection.id} ${inspection.status} → ${patch.status || inspection.status}`));
  const updated = (await L.rest.get(env, 'ai_inspections', { id: `eq.${inspection.id}`, select: '*' }))[0];
  return L.json({ ok: true, inspection: updated });
});

/* --------------------------------------------------------------------- jobs */
route('GET', '/api/admin/ai/jobs', async ({ env, request, q }) => {
  await L.staff(env, request);
  const status = String(q('status') || '').trim();
  const filters = {};
  if (['pending', 'processing', 'done', 'failed'].includes(status)) filters.status = `eq.${status}`;
  const rows = await L.rest.get(env, 'ai_jobs', { ...filters, select: '*', order: 'id.desc', limit: '120' }).catch(() => []);
  return L.json({ items: rows || [] });
});

route('POST', '/api/admin/ai/jobs/:id/retry', async ({ env, request, g }) => {
  await L.requireAuth(env, request, ['admin']);
  await L.rest.update(env, 'ai_jobs', { id: `eq.${+g.id || 0}` }, {
    status: 'pending', attempts: 0, run_after: new Date().toISOString(), last_error: '', updated_at: new Date().toISOString(),
  }, true);
  return L.json({ ok: true });
});

route('POST', '/api/admin/ai/tick', async ({ env, request }) => {
  await L.requireAuth(env, request, ['admin']);
  const results = await aiCustomer.processJobs(env, 12);
  const followups = await aiCustomer.scheduleFollowups(env).catch(() => ({ skipped: true }));
  return L.json({ ok: true, processed: results.length, results, followups });
});

/* -------------------------------------------------------------------- tests */
route('POST', '/api/admin/ai/test', async ({ env, request }) => {
  await L.requireAuth(env, request, ['admin']);
  const cfg = await aiCustomer.loadConfig(env);
  const s = cfg.settings || {};
  const decision = await aiService.generateReply({
    geminiKey: cfg.geminiKey,
    openaiKey: cfg.openaiKey,
    provider: s.ai_provider || 'gemini',
    geminiModel: s.gemini_model,
    openaiModel: s.openai_model,
    system: 'You are the customer relations team at a premium car dealership. Return only the required JSON. Never invent vehicle facts. Never ask for a phone number.',
    messages: [{
      role: 'user',
      text: 'A customer named Sara asks: "Is the vehicle still available and can I book an inspection?" There is no specific vehicle attached to this test, and no inspection is confirmed. Write a short warm reply that says you will help and that an inspection can be requested, without confirming any appointment. Return JSON with keys subject, reply, intent, escalate, pause_ai, suggested_inspection_status.',
    }],
    temperature: 0.4,
  }).catch((e) => {
    throw Object.assign(L.err(503, `AI test failed: ${String(e.message || e).slice(0, 400)}`), { expose: true });
  });
  return L.json({ ok: true, decision });
});

route('POST', '/api/admin/ai/test-email', async ({ env, request }) => {
  const u = await L.requireAuth(env, request, ['admin']);
  const b = await readJson(request);
  const to = String(b.to || u.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw L.err(400, 'Enter a valid test recipient address.');
  const rendered = emailService.renderEmail({
    businessName: 'DM Motor Group',
    teamName: 'Customer Relations Team',
    subject: 'DM Motor Group — email delivery test',
    text: `Dear ${u.name || 'Team'},\n\nThis is a real test email sent from the DM Motor Group AI Customer Service system. If you received it, outbound email delivery is working correctly.\n\nYou can reply to this message to test inbound email handling.`,
  });
  const sent = await emailService.sendEmail(env, L.rest, {
    to,
    subject: 'DM Motor Group — email delivery test',
    text: `Dear ${u.name || 'Team'},\n\nThis is a real test email sent from the DM Motor Group AI Customer Service system. If you received it, outbound email delivery is working correctly.\n\nYou can reply to this message to test inbound email handling.`,
    html: rendered.html,
  }).catch((e) => {
    throw Object.assign(L.err(503, `Email delivery failed: ${String(e.message || e).slice(0, 400)}`), { expose: true });
  });
  return L.json({ ok: true, provider: sent.provider, id: sent.id, to });
});
