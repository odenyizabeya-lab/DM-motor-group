'use strict';
/* DM Motor Group — REST API (website + mobile app + admin dashboard share this) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { q, jparse, hashPassword, verifyPassword, signToken, verifyToken, logActivity } = require('./db');

const UPLOADS = path.join(__dirname, '..', 'uploads');
const COOKIE = 'dm_token';
const TOKEN_DAYS = 30;
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const VID_EXT = ['.mp4', '.webm', '.m4v', '.mov'];

const err = (status, message) => { const e = new Error(message); e.status = status; return e; };
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
const esc = (s) => String(s == null ? '' : s);

/* ---------- tiny utilities ---------- */
function json(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(obj));
}
function readJson(req, max = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(err(413, 'Payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(err(400, 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}
function readRawToFile(req, dest, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const out = fs.createWriteStream(dest);
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { out.destroy(); fs.unlinkSync(dest); reject(err(413, 'File too large')); req.destroy(); return; }
      out.write(c);
    });
    req.on('end', () => out.end());
    out.on('finish', () => resolve(size));
    req.on('error', reject); out.on('error', reject);
  });
}
const ipOf = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
const rateMap = new Map();
function rateLimit(key, limit, windowMs) {
  const t = Date.now(); const a = rateMap.get(key) || [];
  const fresh = a.filter((x) => t - x < windowMs);
  if (fresh.length >= limit) { rateMap.set(key, fresh); return false; }
  fresh.push(t); rateMap.set(key, fresh); return true;
}

/* ---------- auth ---------- */
function parseCookies(req) {
  const h = req.headers.cookie || ''; const out = {};
  h.split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setAuthCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${TOKEN_DAYS * 86400}`);
}
function clearAuthCookie(res) { res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`); }
function authUser(req) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = bearer || parseCookies(req)[COOKIE];
  const p = verifyToken(token);
  if (!p) return null;
  const u = q.get('SELECT id, email, name, phone, role, created_at FROM users WHERE id = ?', p.uid);
  return u || null;
}
function requireAuth(req, roles) {
  const u = authUser(req);
  if (!u) throw err(401, 'Please sign in.');
  if (roles && !roles.includes(u.role)) throw err(403, 'You do not have permission to do that.');
  return u;
}
/** CSRF: cookie-authenticated mutating requests must carry one of the app headers (bearer-bound apps exempt) */
const APP_HEADERS = new Set(['DMFetch', 'DMAdmin']);
function csrfGuard(req) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const usingCookie = !String(req.headers.authorization || '').startsWith('Bearer ') && parseCookies(req)[COOKIE];
    if (usingCookie && !APP_HEADERS.has(req.headers['x-requested-with'])) throw err(403, 'Blocked request (CSRF).');
  }
}

/* ---------- vehicle helpers ---------- */
function mediaRows(vehicleId) {
  return q.all('SELECT * FROM media WHERE vehicle_id = ? ORDER BY is_video_cover DESC, position ASC, id ASC', vehicleId)
    .map((m) => ({ ...m, is_video_cover: !!m.is_video_cover }));
}
function vehicleOut(v, { includeMedia = false } = {}) {
  const features = jparse(v.features), safety = jparse(v.safety_features);
  const cover = q.get(`SELECT url, thumb_url FROM media WHERE vehicle_id = ? AND type = 'image' ORDER BY (id = ?) DESC, position ASC, id ASC LIMIT 1`, v.id, v.cover_media_id || 0);
  const videos = q.get(`SELECT COUNT(*) AS n FROM media WHERE vehicle_id = ? AND type = 'video'`, v.id).n;
  const photos = q.get(`SELECT COUNT(*) AS n FROM media WHERE vehicle_id = ? AND type = 'image'`, v.id).n;
  const out = {
    id: v.id, slug: v.slug, status: v.status, brand: v.brand, model: v.model, year: v.year,
    price: v.price, currency: v.currency, mileage: v.mileage, engine: v.engine, transmission: v.transmission,
    fuel: v.fuel, bodyType: v.body_type, exteriorColor: v.exterior_color, interiorColor: v.interior_color,
    vin: v.vin, condition: v.condition, registration: v.registration, location: v.location,
    description: v.description, features, safetyFeatures: safety,
    ownershipInfo: v.ownership_info, inspectionStatus: v.inspection_status, inspectionReport: v.inspection_report,
    category: v.category, isFeatured: !!v.is_featured, views: v.views,
    createdAt: v.created_at, updatedAt: v.updated_at,
    cover: cover ? cover.thumb_url || cover.url : '', coverFull: cover ? cover.url : '',
    photoCount: photos, videoCount: videos,
  };
  if (includeMedia) out.media = mediaRows(v.id);
  return out;
}
function uniqueSlug(v) {
  let base = slugify(`${v.brand}-${v.model}-${v.year}`); let slug = base; let i = 1;
  while (q.get('SELECT id FROM vehicles WHERE slug = ?', slug)) slug = `${base}-${++i}`;
  return slug;
}
function sendNotification(userId, title, body = '', link = '') {
  q.run('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?,?,?,?,?)', userId, title, body, link, now());
}

/* ==================================================================== routes */
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[a-z0-9-]+)') + '$'), fn });

/* ---------------- meta (filters for web + mobile app) ---------------- */
route('GET', '/api/meta', () => {
  const rows = q.all(`SELECT DISTINCT brand FROM vehicles WHERE status = 'published' ORDER BY brand`);
  const brands = rows.map((r) => r.brand);
  const models = q.all(`SELECT DISTINCT brand, model FROM vehicles WHERE status = 'published' ORDER BY brand, model`);
  const locs = q.all(`SELECT DISTINCT location FROM vehicles WHERE status = 'published' AND location != '' ORDER BY location`).map((r) => r.location);
  const price = q.get(`SELECT MIN(price) AS min, MAX(price) AS max FROM vehicles WHERE status='published'`) || { min: 0, max: 0 };
  const year = q.get(`SELECT MIN(year) AS min, MAX(year) AS max FROM vehicles WHERE status='published'`) || { min: 2000, max: new Date().getFullYear() };
  return { brands, models, locations: locs, priceRange: price || {}, yearRange: year || {},
    transmissions: ['Automatic', 'Manual', 'Semi-Automatic', 'CVT', 'Dual-Clutch'],
    fuels: ['Petrol', 'Diesel', 'Hybrid', 'Plug-in Hybrid', 'Electric', 'LPG'],
    bodyTypes: ['SUV', 'Sedan', 'Coupe', 'Hatchback', 'Wagon', 'Convertible', 'Pickup', 'Van', 'Truck'],
    categories: [
      { key: 'featured', label: 'Featured' }, { key: 'luxury', label: 'Luxury' }, { key: 'suv', label: 'SUVs' },
      { key: 'sedan', label: 'Sedans' }, { key: 'sports', label: 'Sports Cars' }, { key: 'electric', label: 'Electric' },
      { key: 'truck', label: 'Trucks & Commercial' }, { key: 'family', label: 'Family' },
    ] };
});

/* ---------------- home page payload ---------------- */
route('GET', '/api/home', () => {
  const pub = `status = 'published'`;
  const banners = q.all(`SELECT * FROM banners WHERE active = 1 ORDER BY position ASC, id ASC`);
  const featured = q.all(`SELECT * FROM vehicles WHERE ${pub} AND is_featured = 1 ORDER BY updated_at DESC LIMIT 8`);
  const latest = q.all(`SELECT * FROM vehicles WHERE ${pub} ORDER BY created_at DESC LIMIT 12`);
  const cats = ['luxury', 'suv', 'sedan', 'sports', 'electric', 'truck', 'family'];
  const byCategory = {};
  for (const c of cats) byCategory[c] = q.all(`SELECT * FROM vehicles WHERE ${pub} AND category = ? ORDER BY updated_at DESC LIMIT 6`, c);
  const videos = q.all(`SELECT m.*, v.slug, v.brand, v.model, v.year FROM media m JOIN vehicles v ON v.id = m.vehicle_id AND v.status='published' WHERE m.type='video' ORDER BY m.id DESC LIMIT 8`);
  const testimonials = q.all(`SELECT * FROM testimonials WHERE status='approved' ORDER BY id DESC LIMIT 9`);
  const settings = Object.fromEntries(q.all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
  const stats = {
    published: q.get(`SELECT COUNT(*) AS n FROM vehicles WHERE ${pub}`).n,
    brands: q.get(`SELECT COUNT(DISTINCT brand) AS n FROM vehicles WHERE ${pub}`).n,
    photos: q.get('SELECT COUNT(*) AS n FROM media WHERE type = \'image\'').n,
    videos: q.get('SELECT COUNT(*) AS n FROM media WHERE type=\'video\'').n,
  };
  return { banners, featured: featured.map((v) => vehicleOut(v)), latest: latest.map((v) => vehicleOut(v)),
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, list]) => [k, list.map((v) => vehicleOut(v))])),
    videos: videos.map((v) => ({ id: v.id, vehicleId: v.vehicle_id, type: v.type, url: v.url, thumbUrl: v.thumb_url,
      caption: v.caption, category: v.category, slug: v.slug, title: `${v.brand} ${v.model} ${v.year}` })),
    testimonials, settings, stats };
});

/* ---------------- vehicle search (shared by web + app) ---------------- */
route('GET', '/api/vehicles', (req, res, _g, url) => {
  const s = url.searchParams;
  const isAdminList = authUser(req) && ['admin', 'manager', 'viewer'].includes(authUser(req).role) && s.get('scope') === 'admin';
  const where = []; const params = [];
  if (isAdminList) {
    if (s.get('status')) { where.push('status = ?'); params.push(s.get('status')); }
  } else where.push(`status IN ('published','reserved')`);
  if (s.get('q')) { const like = `%${s.get('q')}%`; where.push('(brand LIKE ? OR model LIKE ? OR description LIKE ? OR vin LIKE ?)'); params.push(like, like, like, like); }
  if (s.get('brand')) { where.push('brand = ?'); params.push(s.get('brand')); }
  if (s.get('model')) { where.push('model = ?'); params.push(s.get('model')); }
  if (s.get('yearMin')) { where.push('year >= ?'); params.push(+s.get('yearMin') || 0); }
  if (s.get('yearMax')) { where.push('year <= ?'); params.push(+s.get('yearMax') || 9999); }
  if (s.get('priceMin')) { where.push('price >= ?'); params.push(+s.get('priceMin') || 0); }
  if (s.get('priceMax')) { where.push('price <= ?'); params.push(+s.get('priceMax') || 9e15); }
  if (s.get('mileageMax')) { where.push('mileage <= ?'); params.push(+s.get('mileageMax') || 9e9); }
  if (s.get('transmission')) { where.push('transmission = ?'); params.push(s.get('transmission')); }
  if (s.get('fuel')) { where.push('fuel = ?'); params.push(s.get('fuel')); }
  if (s.get('bodyType')) { where.push('body_type = ?'); params.push(s.get('bodyType')); }
  if (s.get('condition')) { where.push('condition = ?'); params.push(s.get('condition')); }
  if (s.get('location')) { where.push('location LIKE ?'); params.push(`%${s.get('location')}%`); }
  if (s.get('category')) {
    if (s.get('category') === 'featured') where.push('is_featured = 1');
    else { where.push('category = ?'); params.push(s.get('category')); }
  }
  const sortMap = {
    newest: 'created_at DESC, id DESC', oldest: 'created_at ASC', price_asc: 'price ASC',
    price_desc: 'price DESC', year_desc: 'year DESC', year_asc: 'year ASC', mileage_asc: 'mileage ASC',
  };
  const order = sortMap[s.get('sort')] || sortMap.newest;
  const per = Math.min(Math.max(+s.get('per') || 12, 1), 100);
  const page = Math.max(+s.get('page') || 1, 1);
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = q.get(`SELECT COUNT(*) AS n FROM vehicles ${whereSql}`, ...params).n;
  const rows = q.all(`SELECT * FROM vehicles ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, per, (page - 1) * per);
  return { items: rows.map((v) => vehicleOut(v)), total, page, pages: Math.ceil(total / per) || 1, per };
});

/* ---------------- vehicle detail ---------------- */
route('GET', '/api/vehicles/:slug', (req, res, m) => {
  const v = q.get('SELECT * FROM vehicles WHERE slug = ?', m.slug);
  if (!v) throw err(404, 'Vehicle not found.');
  const u = authUser(req);
  const isStaff = u && ['admin', 'manager', 'viewer'].includes(u.role);
  if (!isStaff && !['published', 'reserved'].includes(v.status)) throw err(404, 'Vehicle not found.');
  if (!isStaff) q.run('UPDATE vehicles SET views = views + 1 WHERE id = ?', v.id);
  const out = vehicleOut(v, { includeMedia: true });
  out.similar = q.all(`SELECT * FROM vehicles WHERE status='published' AND id != ? AND (category = ? OR brand = ?) ORDER BY ABS(price - ?) ASC LIMIT 4`, v.id, v.category, v.brand, v.price)
    .map((x) => vehicleOut(x));
  if (u) out.favourited = !!q.get('SELECT 1 AS x FROM favourites WHERE user_id = ? AND vehicle_id = ?', u.id, v.id);
  return out;
});

/* ---------------- public video showroom ---------------- */
route('GET', '/api/videos', (req, res, _g, url) => {
  const page = Math.max(+url.searchParams.get('page') || 1, 1);
  const per = Math.min(+url.searchParams.get('per') || 18, 50);
  const total = q.get(`SELECT COUNT(*) AS n FROM media m JOIN vehicles v ON v.id = m.vehicle_id AND v.status='published' WHERE m.type='video'`).n;
  const rows = q.all(`SELECT m.*, v.slug, v.brand, v.model, v.year, v.price, v.currency FROM media m JOIN vehicles v ON v.id = m.vehicle_id AND v.status='published'
    WHERE m.type='video' ORDER BY m.id DESC LIMIT ? OFFSET ?`, per, (page - 1) * per);
  return { items: rows.map((v) => ({ id: v.id, vehicleId: v.vehicle_id, url: v.url, thumbUrl: v.thumb_url, caption: v.caption,
    slug: v.slug, title: `${v.brand} ${v.model} ${v.year}`, price: v.price, currency: v.currency })), total, page, pages: Math.ceil(total / per) || 1 };
});

/* ---------------- auth ---------------- */
route('POST', '/api/auth/register', async (req, res) => {
  if (!rateLimit('reg:' + ipOf(req), 8, 3600e3)) throw err(429, 'Too many attempts. Try again later.');
  const b = await readJson(req);
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err(400, 'Please enter a valid email address.');
  if (!b.name || String(b.name).trim().length < 2) throw err(400, 'Please enter your full name.');
  if (String(b.password || '').length < 8) throw err(400, 'Password must be at least 8 characters.');
  if (q.get('SELECT id FROM users WHERE email = ?', email)) throw err(409, 'An account with this email already exists. Please sign in.');
  const r = q.run('INSERT INTO users (email, password_hash, name, phone, role, created_at) VALUES (?,?,?,?,?,?)',
    email, hashPassword(b.password), String(b.name).trim(), String(b.phone || '').trim(), 'customer', now());
  sendNotification(r.lastInsertRowid, 'Welcome to DM Motor Group', 'Your customer account is ready. Save favourites, compare vehicles and request inspections right from your account.', '/');
  logActivity(email, 'customer_registered', `Customer account created: ${email}`);
  const token = signToken({ uid: r.lastInsertRowid, role: 'customer', exp: Date.now() + TOKEN_DAYS * 86400e3 });
  setAuthCookie(res, token);
  return { token, user: { id: r.lastInsertRowid, email, name: String(b.name).trim(), phone: b.phone || '', role: 'customer' } };
});
route('POST', '/api/auth/login', async (req, res) => {
  const ip = ipOf(req);
  if (!rateLimit('login:' + ip, 12, 15 * 60e3)) throw err(429, 'Too many sign-in attempts. Please wait 15 minutes.');
  const b = await readJson(req);
  const email = String(b.email || '').trim().toLowerCase();
  const u = q.get('SELECT * FROM users WHERE email = ?', email);
  if (!u || !verifyPassword(String(b.password || ''), u.password_hash)) throw err(401, 'Incorrect email or password.');
  const token = signToken({ uid: u.id, role: u.role, exp: Date.now() + TOKEN_DAYS * 86400e3 });
  setAuthCookie(res, token);
  logActivity(email, 'login', `Sign-in (${u.role})`);
  return { token, user: { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role } };
});
route('POST', '/api/auth/logout', (req, res) => { clearAuthCookie(res); return { ok: true }; });
route('GET', '/api/auth/me', (req) => {
  const u = authUser(req);
  if (!u) return { user: null, favourites: [], unread: 0 };
  const favourites = q.all('SELECT vehicle_id FROM favourites WHERE user_id = ?', u.id).map((r) => r.vehicle_id);
  const unread = q.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', u.id).n;
  return { user: u, favourites, unread };
});
route('PUT', '/api/auth/profile', (req) => {
  csrfGuard(req);
  const u = requireAuth(req);
  return (async () => {
    const b = await readJson(req);
    if (b.name && String(b.name).trim().length >= 2) q.run('UPDATE users SET name = ? WHERE id = ?', String(b.name).trim(), u.id);
    if (typeof b.phone === 'string') q.run('UPDATE users SET phone = ? WHERE id = ?', b.phone.trim(), u.id);
    if (b.password) {
      if (String(b.password).length < 8) throw err(400, 'New password must be at least 8 characters.');
      const cur = q.get('SELECT password_hash FROM users WHERE id = ?', u.id);
      if (!verifyPassword(String(b.currentPassword || ''), cur.password_hash)) throw err(403, 'Current password is incorrect.');
      q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.password), u.id);
    }
    return { ok: true };
  })();
});
route('POST', '/api/auth/forgot', async (req, res) => {
  if (!rateLimit('forgot:' + ipOf(req), 6, 3600e3)) throw err(429, 'Too many attempts. Try again later.');
  const b = await readJson(req);
  const email = String(b.email || '').trim().toLowerCase();
  const u = q.get('SELECT * FROM users WHERE email = ?', email);
  let devToken;
  if (u) {
    const token = crypto.randomBytes(24).toString('hex');
    q.run('INSERT INTO reset_tokens (token, user_id, created_at) VALUES (?,?,?)', token, u.id, now());
    logActivity(email, 'password_reset_requested', 'Reset token issued');
    if (String(Object.fromEntries(q.all('SELECT key,value FROM settings')).dev_reset_tokens) === '1') devToken = token;
  }
  const out = { ok: true, message: 'If that email is registered, a secure reset link has been issued.' };
  if (devToken) out.message += ' (Development mode: use this recovery code) ', out.devToken = devToken;
  return out;
});
route('POST', '/api/auth/reset', async (req) => {
  const b = await readJson(req);
  const row = q.get('SELECT * FROM reset_tokens WHERE token = ? AND used = 0', String(b.token || ''));
  if (!row || Date.now() - Date.parse(row.created_at.replace(' ', 'T') + 'Z') > 3600e3) throw err(400, 'This recovery code is invalid or expired.');
  if (String(b.password || '').length < 8) throw err(400, 'Password must be at least 8 characters.');
  q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.password), row.user_id);
  q.run('UPDATE reset_tokens SET used = 1 WHERE token = ?', row.token);
  logActivity('system', 'password_reset_completed', `User #${row.user_id} password changed`);
  return { ok: true, message: 'Password updated. You can now sign in.' };
});

/* ---------------- enquiries (anti-fraud protected) ---------------- */
route('POST', '/api/enquiries', async (req, res) => {
  const ip = ipOf(req);
  if (!rateLimit('enq:' + ip, 6, 10 * 60e3)) throw err(429, 'You have submitted several enquiries recently. Please wait a little while.');
  const b = await readJson(req);
  if (b.website) return { ok: true }; // honeypot — silently accept bot spam
  const message = String(b.message || '').trim();
  if (message.length < 5) throw err(400, 'Please write a short message.');
  if (message.length > 4000) throw err(400, 'Message is too long.');
  if (!b.name || String(b.name).trim().length < 2) throw err(400, 'Please enter your name.');
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err(400, 'Please enter a valid email address.');
  let vehicle = null;
  if (b.vehicleId) {
    vehicle = q.get(`SELECT id, slug, brand, model, year, status FROM vehicles WHERE id = ?`, b.vehicleId);
    if (vehicle && !['published', 'reserved'].includes(vehicle.status)) vehicle = null;
  }
  const u = authUser(req);
  const dup = q.get(`SELECT id FROM enquiries WHERE ip = ? AND message = ? AND created_at > datetime('now','-30 minutes')`, ip, message);
  if (dup) return { ok: true, id: dup.id, message: 'Your enquiry has been received.' };
  const types = ['price', 'question', 'pictures', 'videos', 'inspection', 'testdrive', 'delivery', 'purchase', 'whatsapp'];
  const type = types.includes(b.type) ? b.type : 'question';
  const r = q.run(`INSERT INTO enquiries (vehicle_id, user_id, name, email, phone, type, message, ip, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, vehicle ? vehicle.id : null, u ? u.id : null,
    String(b.name).trim(), email, String(b.phone || '').trim(), type, message, ip, now());
  if (u) sendNotification(u.id, 'Enquiry received', `Thanks ${u.name} — our team has received your enquiry${vehicle ? ` about the ${vehicle.brand} ${vehicle.model}` : ''} and will respond shortly.`, vehicle ? '/vehicles/' + vehicle.slug : '/');
  logActivity(email, 'enquiry_submitted', `${type} enquiry${vehicle ? ` — ${vehicle.brand} ${vehicle.model} (${vehicle.slug})` : ' (general)'}`);
  return { ok: true, id: r.lastInsertRowid, message: 'Thank you — your enquiry has been sent to our team. We respond within one business day.' };
});

/* ---------------- favourites & notifications (customer) ---------------- */
route('GET', '/api/favourites', (req) => {
  const u = requireAuth(req);
  const favs = q.all(`SELECT v.* FROM favourites f JOIN vehicles v ON v.id = f.vehicle_id WHERE f.user_id = ? ORDER BY f.created_at DESC`, u.id);
  return favs.map((v) => vehicleOut(v));
});
route('POST', '/api/favourites', (req) => {
  csrfGuard(req);
  const u = requireAuth(req);
  return (async () => {
    const b = await readJson(req);
    const v = q.get(`SELECT id FROM vehicles WHERE id = ?`, b.vehicleId);
    if (!v) throw err(404, 'Vehicle not found.');
    q.run('INSERT OR IGNORE INTO favourites (user_id, vehicle_id, created_at) VALUES (?,?,?)', u.id, b.vehicleId, now());
    return { ok: true, favourited: true };
  })();
});
route('DELETE', '/api/favourites/:vehicleId', (req, res, m) => {
  csrfGuard(req);
  const u = requireAuth(req);
  q.run('DELETE FROM favourites WHERE user_id = ? AND vehicle_id = ?', u.id, m.vehicleId);
  return { ok: true, favourited: false };
});
route('GET', '/api/notifications', (req) => {
  const u = requireAuth(req);
  const rows = q.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', u.id);
  const unread = q.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', u.id).n;
  return { items: rows, unread };
});
route('POST', '/api/notifications/read', (req) => {
  csrfGuard(req);
  const u = requireAuth(req);
  return (async () => {
    const b = await readJson(req);
    if (b.all) q.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', u.id);
    else if (Array.isArray(b.ids)) b.ids.forEach((id) => q.run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id = ?', u.id, id));
    return { ok: true };
  })();
});
route('GET', '/api/my/enquiries', (req) => {
  const u = requireAuth(req);
  const rows = q.all(`SELECT e.*, v.slug, v.brand, v.model, v.year FROM enquiries e LEFT JOIN vehicles v ON v.id = e.vehicle_id WHERE e.user_id = ? ORDER BY e.id DESC`, u.id);
  return rows.map((e) => ({ ...e, vehicleTitle: e.brand ? `${e.brand} ${e.model} ${e.year}` : 'General enquiry' }));
});

/* ---------------- testimonials (approved, real only) ---------------- */
route('GET', '/api/testimonials', () => q.all(`SELECT id, name, location, rating, text, created_at FROM testimonials WHERE status='approved' ORDER BY id DESC`));

/* ==================================================================== ADMIN */
const staff = (req, roles) => requireAuth(req, roles || ['admin', 'manager', 'viewer']);
const writeStaff = (req) => requireAuth(req, ['admin', 'manager']);

route('GET', '/api/admin/stats', (req) => {
  staff(req);
  return {
    published: q.get(`SELECT COUNT(*) AS n FROM vehicles WHERE status='published'`).n,
    drafts: q.get(`SELECT COUNT(*) AS n FROM vehicles WHERE status='draft'`).n,
    reserved: q.get(`SELECT COUNT(*) AS n FROM vehicles WHERE status='reserved'`).n,
    sold: q.get(`SELECT COUNT(*) AS n FROM vehicles WHERE status='sold'`).n,
    enquiriesNew: q.get(`SELECT COUNT(*) AS n FROM enquiries WHERE status='new'`).n,
    enquiriesTotal: q.get(`SELECT COUNT(*) AS n FROM enquiries`).n,
    customers: q.get(`SELECT COUNT(*) AS n FROM users WHERE role='customer'`).n,
    photos: q.get(`SELECT COUNT(*) AS n FROM media WHERE type='image'`).n,
    videos: q.get(`SELECT COUNT(*) AS n FROM media WHERE type='video'`).n,
    testimonialsPending: q.get(`SELECT COUNT(*) AS n FROM testimonials WHERE status='pending'`).n,
  };
});
route('GET', '/api/admin/vehicles', (req, res, _g, url) => {
  staff(req);
  const s = (url && url.searchParams) || new URLSearchParams();
  const where = []; const params = [];
  if (s.get('status')) { where.push('status = ?'); params.push(s.get('status')); }
  if (s.get('q')) { const like = `%${s.get('q')}%`; where.push('(brand LIKE ? OR model LIKE ? OR vin LIKE ?)'); params.push(like, like, like); }
  const rows = q.all(`SELECT * FROM vehicles ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT 500`, ...params);
  return rows.map((v) => vehicleOut(v));
});
route('POST', '/api/admin/vehicles', (req, res) => {
  csrfGuard(req);
  const u = writeStaff(req);
  return (async () => {
    const b = await readJson(req);
    if (!b.brand || !b.model) throw err(400, 'Brand and model are required.');
    const base = { status: 'draft', body_type: '', transmission: '', fuel: '', location: '', condition: 'Used', description: '', ownership_info: '', inspection_report: '', ...b };
    const slug = uniqueSlug(base);
    const r = q.run(`INSERT INTO vehicles (slug, status, brand, model, year, price, currency, mileage, engine, transmission, fuel, body_type,
      exterior_color, interior_color, vin, condition, registration, location, description, features, safety_features, ownership_info,
      inspection_status, inspection_report, category, is_featured, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      slug, ['draft', 'published', 'reserved', 'sold'].includes(base.status) ? base.status : 'draft',
      String(base.brand).trim(), String(base.model).trim(), +base.year || 2000, +base.price || 0,
      String(base.currency || 'USD').slice(0, 4), +base.mileage || 0, String(base.engine || ''), String(base.transmission || ''),
      String(base.fuel || ''), String(base.body_type || ''), String(base.exterior_color || ''), String(base.interior_color || ''),
      String(base.vin || '').toUpperCase().trim(), String(base.condition || 'Used'), String(base.registration || ''),
      String(base.location || ''), String(base.description || ''), JSON.stringify(Array.isArray(base.features) ? base.features : []),
      JSON.stringify(Array.isArray(base.safety_features) ? base.safety_features : []), String(base.ownership_info || ''),
      ['none', 'dealership_inspected', 'third_party_inspected'].includes(base.inspection_status) ? base.inspection_status : 'none',
      String(base.inspection_report || ''), String(base.category || 'sedan'), base.isFeatured ? 1 : 0, now(), now());
    logActivity(u.email, 'vehicle_created', `${base.brand} ${base.model} ${base.year} (#${r.lastInsertRowid})`);
    return { ok: true, id: r.lastInsertRowid, slug };
  })();
});
route('GET', '/api/admin/vehicles/:id', (req, res, m) => {
  staff(req);
  const v = q.get('SELECT * FROM vehicles WHERE id = ?', m.id);
  if (!v) throw err(404, 'Not found');
  return vehicleOut(v, { includeMedia: true });
});
route('PUT', '/api/admin/vehicles/:id', (req, res, m) => {
  csrfGuard(req);
  const u = writeStaff(req);
  return (async () => {
    const b = await readJson(req);
    const v = q.get('SELECT * FROM vehicles WHERE id = ?', m.id);
    if (!v) throw err(404, 'Not found');
    const F = (name, cur, cast = (x) => String(x != null ? x : cur)) => ({ [name]: cast(b[name]) });
    const sets = {
      brand: b.brand != null ? String(b.brand).trim() : v.brand,
      model: b.model != null ? String(b.model).trim() : v.model,
      year: b.year != null ? +b.year : v.year,
      price: b.price != null ? +b.price : v.price,
      currency: b.currency != null ? String(b.currency).slice(0, 4) : v.currency,
      mileage: b.mileage != null ? +b.mileage : v.mileage,
      engine: b.engine != null ? String(b.engine) : v.engine,
      transmission: b.transmission != null ? String(b.transmission) : v.transmission,
      fuel: b.fuel != null ? String(b.fuel) : v.fuel,
      body_type: b.bodyType != null ? String(b.bodyType) : v.body_type,
      exterior_color: b.exteriorColor != null ? String(b.exteriorColor) : v.exterior_color,
      interior_color: b.interiorColor != null ? String(b.interiorColor) : v.interior_color,
      vin: b.vin != null ? String(b.vin).toUpperCase().trim() : v.vin,
      condition: b.condition != null ? String(b.condition) : v.condition,
      registration: b.registration != null ? String(b.registration) : v.registration,
      location: b.location != null ? String(b.location) : v.location,
      description: b.description != null ? String(b.description) : v.description,
      features: Array.isArray(b.features) ? JSON.stringify(b.features) : b.features != null ? JSON.stringify(String(b.features).split('\n').map((x) => x.trim()).filter(Boolean)) : v.features,
      safety_features: Array.isArray(b.safetyFeatures) ? JSON.stringify(b.safetyFeatures) : b.safetyFeatures != null ? JSON.stringify(String(b.safetyFeatures).split('\n').map((x) => x.trim()).filter(Boolean)) : v.safety_features,
      ownership_info: b.ownershipInfo != null ? String(b.ownershipInfo) : v.ownership_info,
      inspection_status: b.inspectionStatus != null ? String(b.inspectionStatus) : v.inspection_status,
      inspection_report: b.inspectionReport != null ? String(b.inspectionReport) : v.inspection_report,
      category: b.category != null ? String(b.category) : v.category,
      is_featured: b.isFeatured != null ? (b.isFeatured ? 1 : 0) : v.is_featured,
      updated_at: now(),
    };
    q.run(`UPDATE vehicles SET ${Object.keys(sets).map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...Object.values(sets), v.id);
    logActivity(u.email, 'vehicle_updated', `${sets.brand} ${sets.model} (#${v.id})`);
    return { ok: true };
  })();
});
route('DELETE', '/api/admin/vehicles/:id', (req, res, m) => {
  csrfGuard(req);
  const u = writeStaff(req);
  const v = q.get('SELECT brand, model FROM vehicles WHERE id = ?', m.id);
  if (!v) throw err(404, 'Not found');
  const media = q.all('SELECT url, thumb_url FROM media WHERE vehicle_id = ?', m.id);
  q.run('DELETE FROM vehicles WHERE id = ?', m.id);
  for (const f of media) [f.url, f.thumb_url].filter(Boolean).forEach((p) => {
    const fp = path.join(UPLOADS, p.replace('/media/', ''));
    if (p.startsWith('/media/uploads/') === false) { try { fs.unlinkSync(fp); } catch {} }
  });
  logActivity(u.email, 'vehicle_deleted', `${v.brand} ${v.model} (#${m.id})`);
  return { ok: true };
});
route('POST', '/api/admin/vehicles/:id/status', (req, res, m) => {
  csrfGuard(req);
  const u = writeStaff(req);
  return (async () => {
    const b = await readJson(req);
    if (!['draft', 'published', 'reserved', 'sold'].includes(b.status)) throw err(400, 'Invalid status.');
    q.run('UPDATE vehicles SET status = ?, updated_at = ? WHERE id = ?', b.status, now(), m.id);
    logActivity(u.email, 'vehicle_status', `#${m.id} → ${b.status}`);
    return { ok: true, status: b.status };
  })();
});

/* ---------- media upload (full-length videos preserved, never cropped) ---------- */
route('PUT', '/api/admin/upload', (req, res, m, rawUrl) => {
  const u = writeStaff(req);
  return (async () => {
    const s = rawUrl.searchParams;
    const vehicleId = +s.get('vehicleId');
    const type = s.get('type') === 'video' ? 'video' : 'image';
    const mediaCategory = s.get('category') || 'exterior';
    const caption = String(s.get('caption') || '');
    const origName = String(s.get('filename') || 'file.bin');
    const v = q.get('SELECT id FROM vehicles WHERE id = ?', vehicleId);
    if (!v) throw err(404, 'Save the vehicle first, then upload media.');
    const ext = (origName.toLowerCase().match(/\.[a-z0-9]+$/) || [path.extname(origName) || '.bin'])[0];
    const allow = type === 'image' ? IMG_EXT : VID_EXT;
    if (!allow.includes(ext)) throw err(400, `Allowed ${type} formats: ${allow.join(', ')}`);
    const dir = path.join(UPLOADS, 'v' + vehicleId);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    const dest = path.join(dir, name);
    const size = await readRawToFile(req, dest, type === 'image' ? 30 * 1024 * 1024 : 2 * 1024 * 1024 * 1024);
    const publicUrl = `/media/v${vehicleId}/${name}`;
    const isCover = type === 'image' && !q.get(`SELECT id FROM media WHERE vehicle_id = ? AND type='image'`, vehicleId);
    const r = q.run(`INSERT INTO media (vehicle_id, type, url, thumb_url, caption, category, position, created_at)
      VALUES (?,?,?,?,?,?,?,?)`, vehicleId, type, publicUrl, '', caption, type === 'video' ? 'video' : mediaCategory,
      q.get(`SELECT COALESCE(MAX(position),0) + 1 AS p FROM media WHERE vehicle_id = ?`, vehicleId).p, now());
    if (isCover) q.run('UPDATE vehicles SET cover_media_id = ? WHERE id = ?', r.lastInsertRowid, vehicleId);
    logActivity(u.email, type === 'video' ? 'video_uploaded' : 'image_uploaded', `#${vehicleId} ${origName} (${Math.round(size / 1024 / 102.4) / 10}MB)`);
    return { ok: true, id: r.lastInsertRowid, url: publicUrl, cover: !!isCover };
  })();
});
route('PUT', '/api/admin/media/:id/thumb', (req, res, m) => {  const u = writeStaff(req);
  return (async () => {
    const row = q.get('SELECT * FROM media WHERE id = ?', m.id);
    if (!row) throw err(404, 'Not found');
    const ext = '.webp';
    const dir = path.dirname(path.join(UPLOADS, row.url.replace('/media/', '')));
    const name = path.basename(row.url).replace(/\.[a-z0-9]+$/, '') + '-thumb' + ext;
    const dest = path.join(dir, name);
    await readRawToFile(req, dest, 5 * 1024 * 1024);
    q.run('UPDATE media SET thumb_url = ? WHERE id = ?', row.url.replace(/[^/]+$/, name), m.id);
    return { ok: true };
  })();
});
route('PUT', '/api/admin/media/:id', (req, res, m) => {
  csrfGuard(req);
  writeStaff(req);
  return (async () => {
    const b = await readJson(req);
    const row = q.get('SELECT * FROM media WHERE id = ?', m.id);
    if (!row) throw err(404, 'Not found');
    q.run('UPDATE media SET caption = ?, category = ? WHERE id = ?',
      b.caption != null ? String(b.caption) : row.caption, b.category != null ? String(b.category) : row.category, m.id);
    return { ok: true };
  })();
});
route('POST', '/api/admin/media/:id/cover', (req, res, m) => {
  csrfGuard(req);
  const u = writeStaff(req);
  const row = q.get('SELECT * FROM media WHERE id = ?', m.id);
  if (!row || row.type !== 'image') throw err(400, 'The cover photograph must be an image.');
  q.run('UPDATE vehicles SET cover_media_id = ? WHERE id = ?', row.vehicle_id, row.vehicle_id);
  logActivity(u.email, 'cover_set', `vehicle #${row.vehicle_id} cover → media #${m.id}`);
  return { ok: true };
});
route('DELETE', '/api/admin/media/:id', (req, res, m) => {
  csrfGuard(req);
  writeStaff(req);
  const row = q.get('SELECT * FROM media WHERE id = ?', m.id);
  if (!row) throw err(404, 'Not found');
  [row.url, row.thumb_url].filter(Boolean).forEach((p) => {
    const fp = path.join(UPLOADS, p.replace('/media/', ''));
    try { fs.unlinkSync(fp); } catch {}
  });
  q.run('DELETE FROM media WHERE id = ?', m.id);
  const next = q.get(`SELECT id FROM media WHERE vehicle_id = ? AND type='image' ORDER BY position ASC, id ASC LIMIT 1`, row.vehicle_id);
  q.run('UPDATE vehicles SET cover_media_id = ? WHERE id = ? AND (cover_media_id = ? OR cover_media_id IS NULL)', next ? next.id : null, row.vehicle_id, m.id);
  return { ok: true };
});
route('POST', '/api/admin/vehicles/:id/reorder', (req, res, m) => {
  csrfGuard(req);
  writeStaff(req);
  return (async () => {
    const b = await readJson(req);
    if (!Array.isArray(b.ids)) throw err(400, 'Provide media ids.');
    b.ids.forEach((id, i) => q.run('UPDATE media SET position = ? WHERE id = ? AND vehicle_id = ?', i, id, m.id));
    return { ok: true };
  })();
});

/* ---------- enquiries ---------- */
route('GET', '/api/admin/enquiries', (req, res, _g, url) => {
  staff(req);
  const s = url.searchParams;
  let where = '1=1'; const params = [];
  if (s.get('status')) { where += ' AND e.status = ?'; params.push(s.get('status')); }
  const rows = q.all(`SELECT e.*, v.slug, v.brand, v.model, v.year, u.name AS account_name FROM enquiries e
    LEFT JOIN vehicles v ON v.id = e.vehicle_id LEFT JOIN users u ON u.id = e.user_id
    WHERE ${where} ORDER BY CASE e.status WHEN 'new' THEN 0 ELSE 1 END, e.id DESC LIMIT 300`, ...params);
  return rows;
});
route('PUT', '/api/admin/enquiries/:id', (req, res, m) => {
  csrfGuard(req);
  const u = staff(req, ['admin', 'manager']);
  return (async () => {
    const b = await readJson(req);
    const e = q.get('SELECT * FROM enquiries WHERE id = ?', m.id);
    if (!e) throw err(404, 'Not found');
    if (b.status) q.run('UPDATE enquiries SET status = ? WHERE id = ?', ['new', 'in_progress', 'responded', 'closed'].includes(b.status) ? b.status : e.status, m.id);
    if (typeof b.adminNotes === 'string') q.run('UPDATE enquiries SET admin_notes = ? WHERE id = ?', b.adminNotes, m.id);
    if (b.respond && e.user_id) sendNotification(e.user_id, 'Update from DM Motor Group', String(b.respond).slice(0, 300), e.vehicle_id ? '/vehicles/' + (q.get('SELECT slug FROM vehicles WHERE id = ?', e.vehicle_id) || {}).slug : '/');
    if (b.status) logActivity(u.email, 'enquiry_updated', `#${m.id} → ${b.status}`);
    return { ok: true };
  })();
});

/* ---------- customers ---------- */
route('GET', '/api/admin/customers', (req) => {
  staff(req);
  return q.all(`SELECT u.id, u.email, u.name, u.phone, u.role, u.created_at,
    (SELECT COUNT(*) FROM favourites f WHERE f.user_id = u.id) AS favourites
    FROM users u ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 WHEN 'viewer' THEN 2 ELSE 3 END, u.id DESC LIMIT 500`);
});
route('POST', '/api/admin/users', (req, res) => {
  csrfGuard(req);
  const u = requireAuth(req, ['admin']);
  return (async () => {
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err(400, 'Valid email required.');
    if (String(b.password || '').length < 8) throw err(400, 'Password at least 8 characters.');
    const role = ['admin', 'manager', 'viewer', 'customer'].includes(b.role) ? b.role : 'viewer';
    if (q.get('SELECT id FROM users WHERE email = ?', email)) throw err(409, 'Email already registered.');
    const r = q.run('INSERT INTO users (email, password_hash, name, phone, role, created_at) VALUES (?,?,?,?,?,?)',
      email, hashPassword(b.password), String(b.name || email).trim(), String(b.phone || ''), role, now());
    logActivity(u.email, 'staff_created', `${role}: ${email}`);
    return { ok: true, id: r.lastInsertRowid };
  })();
});
route('PUT', '/api/admin/users/:id', (req, res, m) => {
  csrfGuard(req);
  const u = requireAuth(req, ['admin']);
  return (async () => {
    const b = await readJson(req);
    const t = q.get('SELECT * FROM users WHERE id = ?', m.id);
    if (!t) throw err(404, 'Not found');
    if (t.id === u.id && b.role && b.role !== 'admin') throw err(400, 'You cannot remove your own admin role.');
    if (b.role) q.run('UPDATE users SET role = ? WHERE id = ?', ['admin', 'manager', 'viewer', 'customer'].includes(b.role) ? b.role : t.role, m.id);
    if (b.password) {
      if (String(b.password).length < 8) throw err(400, 'Password at least 8 characters.');
      q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.password), m.id);
    }
    logActivity(u.email, 'user_updated', `#${m.id}`);
    return { ok: true };
  })();
});
route('DELETE', '/api/admin/users/:id', (req, res, m) => {
  csrfGuard(req);
  const u = requireAuth(req, ['admin']);
  const t = q.get('SELECT * FROM users WHERE id = ?', m.id);
  if (!t) throw err(404, 'Not found');
  if (t.id === u.id) throw err(400, 'You cannot delete your own account.');
  q.run('DELETE FROM users WHERE id = ?', m.id);
  logActivity(u.email, 'user_deleted', `#${m.id} (${t.email})`);
  return { ok: true };
});

/* ---------- testimonials ---------- */
route('GET', '/api/admin/testimonials', (req) => { staff(req); return q.all('SELECT * FROM testimonials ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, id DESC'); });
route('POST', '/api/admin/testimonials', (req, res) => {
  csrfGuard(req); writeStaff(req);
  return (async () => {
    const b = await readJson(req);
    if (!b.name || !b.text) throw err(400, 'Name and testimonial text are required.');
    const r = q.run('INSERT INTO testimonials (name, location, rating, text, status, created_at) VALUES (?,?,?,?,?,?)',
      String(b.name).trim(), String(b.location || ''), Math.min(Math.max(+b.rating || 5, 1), 5), String(b.text).trim(), b.status === 'approved' ? 'approved' : 'pending', now());
    return { ok: true, id: r.lastInsertRowid };
  })();
});
route('PUT', '/api/admin/testimonials/:id', (req, res, m) => {
  csrfGuard(req); writeStaff(req);
  return (async () => {
    const b = await readJson(req);
    if (b.status) q.run('UPDATE testimonials SET status = ? WHERE id = ?', ['pending', 'approved'].includes(b.status) ? b.status : 'pending', m.id);
    return { ok: true };
  })();
});
route('DELETE', '/api/admin/testimonials/:id', (req, res, m) => { csrfGuard(req); writeStaff(req); q.run('DELETE FROM testimonials WHERE id = ?', m.id); return { ok: true }; });

/* ---------- banners ---------- */
route('GET', '/api/admin/banners', (req) => { staff(req); return q.all('SELECT * FROM banners ORDER BY position ASC, id ASC'); });
route('POST', '/api/admin/banners', (req, res) => {
  csrfGuard(req); writeStaff(req);
  return (async () => {
    const b = await readJson(req);
    const r = q.run('INSERT INTO banners (title, subtitle, image, link, position, active) VALUES (?,?,?,?,?,?)',
      String(b.title || 'New banner'), String(b.subtitle || ''), String(b.image || ''), String(b.link || ''),
      +b.position || 0, b.active === false ? 0 : 1);
    return { ok: true, id: r.lastInsertRowid };
  })();
});
route('PUT', '/api/admin/banners/:id', (req, res, m) => {
  csrfGuard(req); writeStaff(req);
  return (async () => {
    const c = q.get('SELECT * FROM banners WHERE id = ?', m.id);
    if (!c) throw err(404, 'Not found');
    const b = await readJson(req);
    q.run('UPDATE banners SET title = ?, subtitle = ?, image = ?, link = ?, position = ?, active = ? WHERE id = ?',
      b.title != null ? String(b.title) : c.title, b.subtitle != null ? String(b.subtitle) : c.subtitle,
      b.image != null ? String(b.image) : c.image, b.link != null ? String(b.link) : c.link,
      b.position != null ? +b.position : c.position, b.active != null ? (b.active ? 1 : 0) : c.active, m.id);
    return { ok: true };
  })();
});
route('DELETE', '/api/admin/banners/:id', (req, res, m) => { csrfGuard(req); writeStaff(req); q.run('DELETE FROM banners WHERE id = ?', m.id); return { ok: true }; });
route('PUT', '/api/admin/banners/:id/image', (req, res, m) => {
  csrfGuard(req); writeStaff(req);
  return (async () => {
    const c = q.get('SELECT * FROM banners WHERE id = ?', m.id);
    if (!c) throw err(404, 'Not found');
    const ext = ('.' + (req.headers['content-type'] || 'image/jpeg').split('/')[1]).replace('jpeg', 'jpg');
    const name = `banner-${m.id}-${Date.now()}${ext === '.webp' ? '.webp' : '.jpg'}`;
    fs.mkdirSync(path.join(UPLOADS, 'banners'), { recursive: true });
    await readRawToFile(req, path.join(UPLOADS, 'banners', name), 20 * 1024 * 1024);
    q.run('UPDATE banners SET image = ? WHERE id = ?', `/media/banners/${name}`, m.id);
    return { ok: true, image: `/media/banners/${name}` };
  })();
});

/* ---------- settings & activity ---------- */
route('GET', '/api/admin/settings', (req) => {
  staff(req);
  return Object.fromEntries(q.all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
});
route('PUT', '/api/admin/settings', (req, res) => {
  csrfGuard(req);
  const u = requireAuth(req, ['admin']);
  return (async () => {
    const b = await readJson(req);
    for (const [k, v] of Object.entries(b)) if (typeof v === 'string') {
      q.run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
    }
    logActivity(u.email, 'settings_updated', Object.keys(b).join(', '));
    return { ok: true };
  })();
});
route('GET', '/api/admin/activity', (req, res, _g, url) => {
  staff(req);
  return q.all('SELECT * FROM activities ORDER BY id DESC LIMIT ?', Math.min(+url.searchParams.get('limit') || 200, 500));
});

/* ==================================================================== dispatcher */
route('GET', '/api/health', () => ({ ok: true, service: 'DM Motor Group API', time: now() }));

async function handle(req, res, url) {
  const pathname = url.pathname.replace(/\/+$/, '') || url.pathname;
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = pathname.match(r.re);
    if (!m) continue;
    try {
      csrfGuard(req);
      const out = await r.fn(req, res, m.groups || {}, url);
      if (!jsonSent(res)) json(res, 200, out === undefined ? { ok: true } : out);
    } catch (e) {
      if (!jsonSent(res)) json(res, e.status || 500, { error: e.message || 'Server error' });
      if (!e.status) console.error(e);
    }
    return;
  }
  json(res, 404, { error: 'Endpoint not found' });
}
const jsonSent = (res) => res.writableEnded;

module.exports = { handle };
