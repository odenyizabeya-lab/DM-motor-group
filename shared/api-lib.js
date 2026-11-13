/* =============================================================================
 * DM Motor Group — shared server library for all Cloudflare Pages Functions.
 * Customers: Postgres (RLS) · GoTrue auth · Storage — via Supabase REST.
 * The service-role key is NEVER exposed to the frontend; it lives in env only.
 * ========================================================================== */
'use strict';

import { SECURITY_HEADERS } from './security.js';

/* ---------------------------------------------------------------- utilities */
const err = (status, message) => { const e = new Error(message); e.status = status; return e; };
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';

function json(obj, code = 200) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS },
  });
}

async function readJson(request, maxBytes = 1024 * 1024) {
  const declared = +(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw err(413, 'Request body is too large.');
  try {
    const t = await request.text();
    if (t.length > maxBytes) throw err(413, 'Request body is too large.');
    return t ? JSON.parse(t) : {};
  } catch (e) {
    if (e.status) throw e;
    throw err(400, 'Invalid JSON body');
  }
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
    const msg = (data && (data.message || data.msg || data.error_description || data.error)) || `Supabase request failed (${res.status})`;
    throw err(res.status === 404 ? 404 : 400, typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

/* normalise WHERE-match values into PostgREST filter syntax:
 * numbers/booleans → eq.N; bare strings → eq.<escaped>; strings that already
 * carry an operator ("eq.x", "in.(...)", "gte.5") pass through untouched. */
const OPS_RE = /^(eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|ov|sl|sr|nxl|nxr|adj|not)\./i;
function whereQS(match) {
  const out = {};
  for (const [k, v] of Object.entries(match || {})) {
    if (v === null || v === undefined) { out[k] = 'is.null'; continue; }
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = `eq.${v}`; continue; }
    const s = String(v);
    out[k] = OPS_RE.test(s) ? s : `eq.${encodeURIComponent(s)}`;
  }
  return new URLSearchParams(out).toString();
}

const rest = {
  async get(env, table, query = {}, opts = {}) {
    const qs = new URLSearchParams(query).toString();
    return sb(env, `/rest/v1/${table}${qs ? '?' + qs : ''}`, opts);
  },
  count: async (env, table, match = {}) => {
    const qs = new URLSearchParams({ ...match, limit: '0' }).toString();
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, {
      method: 'GET',
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, Prefer: 'count=exact', 'Range-Unit': 'items' },
    });
    if (!res.ok) return 0;
    const range = res.headers.get('content-range') || '';
    const n = parseInt((range.split('/')[1] || '0').trim(), 10);
    return Number.isFinite(n) ? n : 0;
  },
  async insert(env, table, rows, opts = {}) {
    const data = await sb(env, `/rest/v1/${table}`, { method: 'POST', body: Array.isArray(rows) ? rows : [rows], ...opts });
    return Array.isArray(data) ? data[0] : data;
  },
  async update(env, table, match, patch, minimal = false) {
    return sb(env, `/rest/v1/${table}?${whereQS(match)}`, { method: 'PATCH', body: patch, prefer: minimal ? 'return=minimal' : 'return=representation' });
  },
  async del(env, table, match) {
    return sb(env, `/rest/v1/${table}?${whereQS(match)}`, { method: 'DELETE', prefer: 'return=minimal' });
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
const authCache = new Map(); // access token -> { user, userId, expires }
const AUTH_CACHE_MS = 120 * 1000; /* short: a role change or profile edit must be visible quickly */

/** Drop every cached session for a user (after a profile or role change). */
function invalidateAuthCache(userId) {
  if (!userId) return;
  for (const [tok, entry] of authCache) {
    if (entry.userId === userId) authCache.delete(tok);
  }
}

async function authUser(env, request) {
  const tok = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tok) return null;
  const hit = authCache.get(tok);
  if (hit && hit.expires > Date.now()) return hit.user;

  let gu = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      gu = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}` },
      });
      if (gu.ok) break;
      /* GoTrue / JWKS hiccups can surface as transient failures — retry */
      if (attempt < 3) { await new Promise((r) => setTimeout(r, [150, 350, 700][attempt])); continue; }
      break;
    } catch {
      if (attempt < 3) { await new Promise((r) => setTimeout(r, [150, 350, 700][attempt])); continue; }
      break;
    }
  }
  if (!gu || !gu.ok) {
    const st = gu && gu.status;
    if (st === 429 || st >= 500) throw err(st, 'Authentication service is temporarily busy. Please retry.');
    return null;
  }
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
  authCache.set(tok, { expires: Date.now() + AUTH_CACHE_MS, user: user, userId: u.id });
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

/* ------------------------------------------------------------------ AI providers */
/* Server-side AI clients (official provider APIs). Keys + models live in
 * server env ONLY (GEMINI_API_KEY / GEMINI_MODEL / OPENAI_API_KEY / OPENAI_MODEL);
 * private keys are never exposed to the frontend. Gemini is the PRIMARY provider
 * (free-tier default model: gemini-2.0-flash); OpenAI is a fully supported
 * alternative (default model: gpt-4o-mini) so the scanner never hard-depends on
 * one vendor. The scan route can request a provider, and falls back to the
 * server-wide default (env.AI_PROVIDER) when none is supplied. */
async function geminiGenerate(env, { images = [], video = null, prompt }) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw err(503, 'AI scanner is not configured on the server (missing GEMINI_API_KEY).');
  const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
  const parts = [{ text: prompt }];
  for (const im of images || []) {
    const d = String(im && im.dataBase64 || '');
    if (!d) continue;
    parts.push({ inlineData: { mimeType: (im && im.mimeType) || 'image/jpeg', data: d } });
  }
  if (video && String(video.dataBase64 || '')) {
    parts.push({ inlineData: { mimeType: (video.mimeType) || 'video/mp4', data: String(video.dataBase64) } });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = d && d.error && d.error.message ? d.error.message : `Gemini request failed (${res.status})`;
    throw err(res.status >= 500 ? 502 : 400, `AI scan failed: ${msg}`);
  }
  const txt = ((d && d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || []).map((p) => p && p.text ? p.text : '').join('').trim();
  if (!txt) throw err(502, 'AI scan returned an empty response.');
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

async function openaiGenerate(env, { images = [], video = null, prompt }) {
  const key = env.OPENAI_API_KEY;
  if (!key) throw err(503, 'AI scanner is not configured on the server (missing OPENAI_API_KEY).');
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  const content = [{ type: 'text', text: prompt }];
  for (const im of images || []) {
    const d = String(im && im.dataBase64 || '');
    if (!d) continue;
    content.push({ type: 'image_url', image_url: { url: `data:${(im && im.mimeType) || 'image/jpeg'};base64,${d}` } });
  }
  if (video && String(video.dataBase64 || '')) {
    /* OpenAI accepts video inputs on multimodal models via the Files API */
    try {
      const bytes = Uint8Array.from(atob(String(video.dataBase64 || '')), (c) => c.charCodeAt(0));
      const fd = new FormData();
      fd.append('purpose', 'vision');
      fd.append('file', new Blob([bytes], { type: video.mimeType || 'video/mp4' }), String(video.name || 'vehicle.mp4'));
      const fr = await fetch('https://api.openai.com/v1/files', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd });
      if (fr.ok) {
        const fj = await fr.json().catch(() => ({}));
        const fid = fj && fj.id;
        if (fid) content.push({ type: 'file', file: { file_id: fid } });
      }
    } catch { /* file-upload is best-effort; still analyse any photos */ }
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }], response_format: { type: 'json_object' }, temperature: 0.2 }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    const rawMsg = d && d.error && (d.error.message || d.error);
    throw err(res.status >= 500 ? 502 : 400, `AI scan failed via OpenAI: ${typeof rawMsg === 'string' ? rawMsg : JSON.stringify(rawMsg || `OpenAI request failed (${res.status})`)}`);
  }
  const choice = (d && d.choices && d.choices[0]) || {};
  const txt = String((choice.message && choice.message.content) || '').trim();
  if (!txt) throw err(502, 'AI scan returned an empty response.');
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

/* Resolve which AI provider the scanner should use. Priority:
 * explicit scan request -> server-wide AI_PROVIDER env -> 'gemini' (primary). */
function aiProviderId(env, requested) {
  const p = String(requested || env.AI_PROVIDER || 'gemini').trim().toLowerCase();
  const id = (p === 'openai' || p === 'gpt' || p === 'gpt4o') ? 'openai' : 'gemini';
  return id;
}

/* Provider-agnostic scan call with light retry for transient upstream failures. */
async function aiGenerate(env, { provider, images = [], video = null, prompt } = {}) {
  const pid = aiProviderId(env, provider);
  const impl = pid === 'openai' ? openaiGenerate : geminiGenerate;
  let attempt = 0;
  const run = async () => {
    try { return await impl(env, { images, video, prompt }); }
    catch (e) {
      const retry = attempt < 2 && (e.status === 429 || e.status === 500 || e.status === 502 || e.status === 503);
      if (!retry) throw e;
      attempt += 1;
      await new Promise((r) => setTimeout(r, [400, 900][attempt - 1]));
      return run();
    }
  };
  return run();
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
    inspectionReport: parseInspection(v.inspection_report).notes,
    spec: parseInspection(v.inspection_report).spec,
    category: v.category || 'sedan',
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

/* ------------------------------------------------------------- table probe */
/* PostgREST reports a missing table with 4xx and a "Could not find the table"
 * / "schema cache" message. These helpers let the dashboard tell the truth
 * ("apply migration 00007") instead of showing silent zeros. */
function missingRelationMessage(e) {
  const m = String((e && e.message) || e || '');
  return /could not find the table|schema cache|does not exist|relation .* does not exist/i.test(m);
}
async function tableExists(env, table) {
  try {
    await sb(env, `/rest/v1/${table}?select=*&limit=1`);
    return true;
  } catch (e) {
    if (missingRelationMessage(e)) return false;
    /* any other failure (network, auth) is not proof the table is missing */
    throw e;
  }
}
async function missingTables(env, tables) {
  const list = Array.isArray(tables) ? tables : [];
  const checks = await Promise.all(list.map(async (t) => {
    try { return (await tableExists(env, t)) ? null : t; }
    catch { return null; }
  }));
  return checks.filter(Boolean);
}

/* ------------------------------------------------------------- constants */
const ENQ_TYPES_ = ['price', 'question', 'pictures', 'videos', 'inspection', 'testdrive', 'delivery', 'purchase', 'whatsapp'];
const IMG_EXT_ = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const VID_EXT_ = ['mp4', 'webm', 'm4v', 'mov'];
const VEHICLE_STATUSES_ = ['draft', 'published', 'reserved', 'sold'];

/* ---------------------------------------------------------------------------
 * Vehicle specification sheet.
 * The dealer can type every value of a car (numbers included) in the admin
 * dashboard. It is stored in the vehicles.inspection_report text column as a
 * small JSON document so that no database migration is required:
 *   {"__spec": { ...fields... }, "notes": "free text inspection notes"}
 * Plain text stays valid and is shown as the inspection notes.
 * -------------------------------------------------------------------------- */
const SPEC_FIELDS_ = [
  'make', 'model', 'year', 'exteriorColour', 'interiorColour', 'bodyType', 'trim',
  'engineNumber', 'vin', 'engineCapacity', 'engineType', 'fuel', 'transmission',
  'mileage', 'registrationYear', 'drivetrain', 'doors', 'seats', 'airConditioning',
  'navigation', 'reverseCamera', 'parkingSensors', 'sunroof', 'alloyWheels',
  'safetyFeatures', 'otherEquipment',
];
const SPEC_LIMITS_ = { year: 8, doors: 12, seats: 12 };

function parseInspection(raw) {
  const text = raw == null ? '' : String(raw);
  if (text.trim().charAt(0) === '{') {
    try {
      const o = JSON.parse(text);
      if (o && typeof o === 'object' && o.__spec && typeof o.__spec === 'object') {
        return { spec: o.__spec, notes: typeof o.notes === 'string' ? o.notes : '' };
      }
    } catch { /* not our JSON - treat as plain notes */ }
  }
  return { spec: null, notes: text };
}
function serialiseInspection(spec, notes) {
  const clean = {};
  for (const k of SPEC_FIELDS_) {
    if (spec && spec[k] != null && String(spec[k]).trim() !== '') clean[k] = String(spec[k]).trim().slice(0, 4000);
  }
  return JSON.stringify({ __spec: clean, notes: String(notes || '').slice(0, 8000) });
}
/* Keep only known fields, as trimmed strings; unknown keys are dropped. */
function cleanSpec(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of SPEC_FIELDS_) {
    if (input[k] == null) continue;
    const val = String(input[k]).trim();
    if (!val) continue;
    out[k] = val.slice(0, SPEC_LIMITS_[k] || 4000);
  }
  return out;
}

const apiLib = {
  err, json, readJson, rateLimit, slugify, extractStoragePath,
  sb, rest, storageUpload, storageDelete, storagePublic, storageUrl, storageHeaders,
  authUser, requireAuth, staff, writeStaff, loginPayload, sendNotification, logActivity,
  mediaFor, vehicleOut, vehicleDetailOut, geminiGenerate, openaiGenerate, aiGenerate, aiProviderId,
  missingRelationMessage, tableExists, missingTables, invalidateAuthCache,
  parseInspection, serialiseInspection, cleanSpec,
  ENQ_TYPES: ENQ_TYPES_, IMG_EXT: IMG_EXT_, VID_EXT: VID_EXT_, VEHICLE_STATUSES: VEHICLE_STATUSES_,
  SPEC_FIELDS: SPEC_FIELDS_,
};
export default apiLib;
export { apiLib };
