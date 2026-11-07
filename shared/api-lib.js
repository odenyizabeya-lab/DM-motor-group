/* =============================================================================
 * DM Motor Group — shared server library for all Cloudflare Pages Functions.
 * Customers: Postgres (RLS) · GoTrue auth · Storage — via Supabase REST.
 * The service-role key is NEVER exposed to the frontend; it lives in env only.
 * ========================================================================== */
'use strict';

/* ---------------------------------------------------------------- utilities */
const err = (status, message) => { const e = new Error(message); e.status = status; return e; };
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';

function json(obj, code = 200) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readJson(request) {
  try {
    const t = await request.text();
    return t ? JSON.parse(t) : {};
  } catch { throw err(400, 'Invalid JSON body'); }
}

/* per-isolate rate limiter (first line of defence; a Cloudflare WAF rule adds a network-wide one) */
const rateMap = new Map();
function rateLimit(key, limit, windowMs) {
  const t = Date.now();
  const a = (rateMap.get(key) || []).filter((x) => t - x < windowMs);
  if (a.length >= limit) { rateMap.set(key, a); return false; }
  a.push(t); rateMap.set(key, a); return true;
}

/* ---------------------------------------------------------------- Supabase */
async function sb(env, path, { method = 'GET', body = null, key = 'service', headers = {}, raw = false, prefer = 'return=representation' } = {}) {
  const apiKey = key === 'anon' ? env.SUPABASE_ANON_KEY : env.SUPABASE_SERVICE_KEY;
  const init = { method, headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, ...headers } };
  if (body !== null) {
    if (raw) init.body = body;
    else { init.body = JSON.stringify(body); init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json'; }
  }
  if (method !== 'GET' && !raw) init.headers.Prefer = prefer;
  const res = await fetch(`${env.SUPABASE_URL}${path}`, init);
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status >= 400) {
    const msg = (data && (data.message || data.error_description || data.error)) || `Supabase request failed (${res.status})`;
    throw err(res.status === 404 ? 404 : 400, typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

const rest = {
  async get(env, table, query = {}, opts = {}) {
    const qs = new URLSearchParams(query).toString();
    return sb(env, `/rest/v1/${table}${qs ? '?' + qs : ''}`, opts);
  },
  count: async (env, table, match = {}) => {
    const qs = new URLSearchParams({ ...match, limit: '0' }).toString();
    // eslint-disable-next-line no-redeclare
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, {
      method: 'GET',
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, Prefer: 'count=exact' },
    });
    if (!res.ok) return 0;
    const range = res.headers.get('content-range') || '*/0';
    const n = parseInt((range.split('/')[1] || '0').trim(), 10);
    return Number.isFinite(n) ? n : 0;
  },
  async insert(env, table, rows, opts = {}) {
    const data = await sb(env, `/rest/v1/${table}`, { method: 'POST', body: Array.isArray(rows) ? rows : [rows], ...opts });
    return Array.isArray(data) ? data[0] : data;
  },
  async update(env, table, match, patch, minimal = false) {
    const qs = new URLSearchParams(match).toString();
    return sb(env, `/rest/v1/${table}?${qs}`, { method: 'PATCH', body: patch, prefer: minimal ? 'return=minimal' : 'return=representation' });
  },
  async del(env, table, match) {
    const qs = new URLSearchParams(match).toString();
    return sb(env, `/rest/v1/${table}?${qs}`, { method: 'DELETE', prefer: 'return=minimal' });
  },
  async rpc(env, fn, args) {
    return sb(env, `/rest/v1/rpc/${fn}`, { method: 'POST', body: args || {} });
  },
};

/* ---------------------------------------------------------------- storage */
const storageUrl = (env, bucket, path) => `${env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
const storagePublic = (env, bucket, path) => `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
const storageHeaders = (env, extra = {}) => ({ apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, ...extra });

async function storageUpload(env, bucket, objectPath, body, contentType, stream = false) {
  const headers = storageHeaders(env, { 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true' });
  const init = { method: 'POST', headers };
  if (stream) { init.body = body; init.duplex = 'half'; }
  else init.body = body;
  const res = await fetch(storageUrl(env, bucket, objectPath), init);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw err(res.status, `Storage upload failed: ${t.slice(0, 200)}`);
  }
  return storagePublic(env, bucket, objectPath);
}

function extractStoragePath(url) {
  const m = String(url).match(/\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/);
  return m ? { bucket: m[1], path: m[2] } : null;
}

async function storageDelete(env, urls) {
  await Promise.all((urls || []).filter(Boolean).map(async (u) => {
    const p = extractStoragePath(u);
    if (!p) return;
    await fetch(storageUrl(env, p.bucket, p.path), { method: 'DELETE', headers: storageHeaders(env) }).catch(() => {});
  }));
}

/* -------------------------------------------------------------------- auth */
const authCache = new Map(); // access token -> { user, expires }

async function authUser(env, request) {
  const tok = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tok) return null;
  const hit = authCache.get(tok);
  if (hit && hit.expires > Date.now()) return hit.user;

  let gu;
  try {
    gu = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}` },
    });
  } catch { throw err(502, 'Authentication service unreachable'); }
  if (!gu.ok) return null;
  const u = await gu.json();

  let profile = null;
  try { profile = (await rest.get(env, 'profiles', { id: `eq.${u.id}`, select: '*' }))[0] || null; } catch {}

  const user = {
    id: u.id,
    email: u.email || '',
    name: (profile && profile.name) || (u.user_metadata && u.user_metadata.name) || '',
    phone: (profile && profile.phone) || '',
    address: (profile && profile.address) || '',
    role: (profile && profile.role) || 'customer',
  };
  if (authCache.size > 800) authCache.clear();
  authCache.set(tok, { expires: Date.now() + 10 * 60e3, user });
  return user;
}

async function requireAuth(env, request, roles) {
  const u = await authUser(env, request);
  if (!u) throw err(401, 'Please sign in.');
  if (roles && !roles.includes(u.role)) throw err(403, 'You do not have permission to do that.');
  return u;
}
const staff = (env, request, roles) => requireAuth(env, request, roles || ['admin', 'manager', 'viewer']);
const writeStaff = (env, request) => requireAuth(env, request, ['admin', 'manager']);

/* password grant → { token, user } (identical shape both frontends already use) */
async function loginPayload(env, request, ip) {
  const b = await readJson(request);
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!email || !password) throw err(400, 'Enter your email and password.');
  if (!rateLimit(`login:${ip}:${email}`, 10, 15 * 60e3)) throw err(429, 'Too many sign-in attempts. Please wait 15 minutes.');

  let r;
  try {
    r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch { throw err(502, 'Authentication service unreachable'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw err(401, 'Incorrect email or password.');

  let profile = null;
  try { profile = (await rest.get(env, 'profiles', { id: `eq.${d.user.id}`, select: '*' }))[0] || null; } catch {}

  return {
    token: d.access_token,
    user: {
      id: d.user.id,
      email,
      name: (profile && profile.name) || (d.user.user_metadata && d.user.user_metadata.name) || email,
      phone: (profile && profile.phone) || '',
      role: (profile && profile.role) || 'customer',
    },
  };
}

async function sendNotification(env, userId, title, body = '', link = '/') {
  if (!userId) return;
  await rest.insert(env, 'notifications', { user_id: userId, title, body, link }).catch(() => {});
}

async function logActivity(env, actor, action, detail = '') {
  await rest.insert(env, 'activity_logs', { actor, action, detail }).catch(() => {});
}

/* ---------------------------------------------------------- vehicle shaping */
async function mediaFor(env, vehicleIds) {
  if (!vehicleIds.length) return new Map();
  const rows = await rest.get(env, 'media', {
    vehicle_id: `in.(${vehicleIds.join(',')})`,
    select: 'id,vehicle_id,type,url,thumb_url,caption,category,position,is_video_cover',
    order: 'position.asc,id.asc',
  });
  const map = new Map();
  for (const m of rows || []) {
    m.is_video_cover = !!m.is_video_cover;
    (map.get(m.vehicle_id) || map.set(m.vehicle_id, []).get(m.vehicle_id)).push(m);
  }
  return map;
}

function vehicleOut(v, media = []) {
  const images = media.filter((m) => m.type === 'image');
  const videos = media.filter((m) => m.type === 'video');
  const cover = (v.cover_media_id && images.find((m) => m.id === v.cover_media_id)) || images[0] || null;
  return {
    id: v.id, slug: v.slug, status: v.status, brand: v.brand, model: v.model, year: v.year,
    price: v.price, currency: v.currency, mileage: v.mileage,
    engine: v.engine || '', transmission: v.transmission || '', fuel: v.fuel || '',
    bodyType: v.body_type || '', exteriorColor: v.exterior_color || '', interiorColor: v.interior_color || '',
    vin: v.vin || '', condition: v.condition || '', registration: v.registration || '',
    location: v.location || '', description: v.description || '',
    features: Array.isArray(v.features) ? v.features : [], safetyFeatures: Array.isArray(v.safety_features) ? v.safety_features : [],
    ownershipInfo: v.ownership_info || '', inspectionStatus: v.inspection_status || 'none',
    inspectionReport: v.inspection_report || '', category: v.category || 'sedan',
    isFeatured: !!v.is_featured, views: v.views || 0,
    createdAt: v.created_at, updatedAt: v.updated_at,
    cover: cover ? (cover.thumb_url || cover.url) : '',
    coverFull: cover ? cover.url : '',
    coverMediaId: v.cover_media_id || null,
    photoCount: images.length, videoCount: videos.length,
  };
}

function vehicleDetailOut(v, media) {
  const out = vehicleOut(v, media);
  out.media = media.map((m) => ({
    id: m.id, vehicleId: m.vehicle_id, type: m.type, url: m.url, thumbUrl: m.thumb_url,
    caption: m.caption, category: m.category || 'exterior', position: m.position,
    isVideoCover: !!m.is_video_cover,
  }));
  return out;
}

/* ------------------------------------------------------------- constants */
const ENQ_TYPES_ = ['price', 'question', 'pictures', 'videos', 'inspection', 'testdrive', 'delivery', 'purchase', 'whatsapp'];
const IMG_EXT_ = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const VID_EXT_ = ['mp4', 'webm', 'm4v', 'mov'];
const VEHICLE_STATUSES_ = ['draft', 'published', 'reserved', 'sold'];

const apiLib = {
  err, json, readJson, rateLimit, slugify, extractStoragePath,
  sb, rest, storageUpload, storageDelete, storagePublic, storageUrl, storageHeaders,
  authUser, requireAuth, staff, writeStaff, loginPayload, sendNotification, logActivity,
  mediaFor, vehicleOut, vehicleDetailOut,
  ENQ_TYPES: ENQ_TYPES_, IMG_EXT: IMG_EXT_, VID_EXT: VID_EXT_, VEHICLE_STATUSES: VEHICLE_STATUSES_,
};
export default apiLib;
export { apiLib };
