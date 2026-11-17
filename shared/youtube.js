/* =================================================================
   YouTube Marketing Automation -------- server-side engine.
   Used by the Pages worker ([[path]].js routes and /api/internal/
   youtube/tick). AI is optional: metadata is built from real vehicle
   data with professional templates only -------- nothing is invented.
   YouTube's official Data API v3 is required; credentials live in the
   server-only ai_secrets table (refresh token) and Google Cloud
   (client id/secret). No token is ever sent to the browser.
   ================================================================= */
import L from './api-lib.js';
const rest = L.rest;
const err = L.err;
const logActivity = L.logActivity;

const GAPI = 'https://www.googleapis.com';
export const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

const nowIso = () => new Date().toISOString();
const scopeErr = (code, message, extra) => Object.assign(err(503, message), { code, ...(extra || {}) });
const need = (v, name) => { if (!v) throw err(503, `${name} is not configured yet.`); return v; };

/* ------------------------------------------------------------------ settings */
export async function getSettings(env) {
  const rows = await rest.get(env, 'youtube_settings', { id: 'eq.1', select: '*' }).catch(() => []);
  return (rows && rows[0]) || null;
}
export async function getPublicSettings(env) {
  const s = await getSettings(env);
  if (!s) return null;
  const { last_error, ...rest } = s; /* internal error details stay staff-side */
  return {
    enabled: !!s.enabled, paused: !!s.paused,
    publishHour: s.publish_hour, publishMinute: s.publish_minute,
    timezone: s.timezone, videosPerDay: s.videos_per_day, frequencyDays: s.frequency_days,
    selectionMode: s.selection_mode, autoSelection: !!s.auto_selection, autoThumbnail: !!s.auto_thumbnail,
    privacyStatus: s.privacy_status, categoryId: s.category_id, tags: s.tags || [],
    lastRunAt: s.last_run_at, lastError: s.last_error || null,
  };
}
export async function saveSettings(env, patch) {
  const allowed = {
    enabled: (v) => !!v,
    paused: (v) => !!v,
    publish_hour: (v) => mathInt(v, 0, 23),
    publish_minute: (v) => mathInt(v, 0, 59),
    timezone: (v) => String(v || 'Asia/Dubai').slice(0, 64),
    videos_per_day: (v) => mathInt(v, 1, 4),
    frequency_days: (v) => mathInt(v, 1, 3650),
    selection_mode: (v) => (['auto', 'manual'].includes(v) ? v : 'auto'),
    auto_selection: (v) => !!v,
    auto_thumbnail: (v) => !!v,
    privacy_status: (v) => (['private', 'unlisted', 'public'].includes(v) ? v : 'private'),
    category_id: (v) => String(v || '2').slice(0, 8),
    tags: (v) => (Array.isArray(v) ? v.slice(0, 15).map((t) => String(t).slice(0, 40).trim()).filter(Boolean) : []),
  };
  const out = {};
  for (const [k, clean] of Object.entries(allowed)) {
    if (patch[k] !== undefined) { const v = clean(patch[k]); if (v !== null) out[k] = v; }
  }
  out.updated_at = nowIso();
  await rest.update(env, 'youtube_settings', { id: 1 }, out, true);
  return getSettings(env);
}
const mathInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
};

/* ------------------------------------------------------------------ secrets (ai_secrets, service-role only) */
const secretKeys = ['google_client_id', 'google_client_secret', 'youtube_refresh_token', 'youtube_channel_id', 'youtube_channel_title', 'youtube_oauth_state'];
export async function getSecrets(env) {
  const rows = await rest.get(env, 'ai_secrets', { key: `in.(${secretKeys.join(',')})`, select: 'key,value' }).catch(() => []);
  return Object.fromEntries((rows || []).map((r) => [r.key, r.value || '']));
}
export async function setSecret(env, key, value) {
  if (!secretKeys.includes(key)) throw err(400, 'Unknown secret key.');
  const rows = await rest.get(env, 'ai_secrets', { key: `eq.${key}`, select: 'key' }).catch(() => []);
  if (rows && rows.length) await rest.update(env, 'ai_secrets', { key }, { value: String(value) }, true);
  else await rest.insert(env, 'ai_secrets', { key, value: String(value) }, { prefer: 'return=minimal' });
}
export async function deleteSecret(env, key) {
  if (!secretKeys.includes(key)) return;
  await rest.del(env, 'ai_secrets', { key });
}

/* ------------------------------------------------------------------ OAuth 2.0 (authorization code) */
export function buildAuthUrl(env, clientId, state) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: YT_SCOPES,
    access_type: 'offline',
    prompt: 'consent', /* guarantees a refresh token on every (re)connect */
    state,
  });
  return `${GAPI.replace('www.googleapis.com', 'accounts.google.com')}/o/oauth2/v2/auth?${params.toString()}`;
}
export const redirectUri = (env) => `${env.SITE_ORIGIN || env.PUBLIC_ORIGIN || 'https://dmmotorgroup.com'}/api/youtube/callback`;

async function oauthTokenRequest(env, clientId, clientSecret, params) {
  const r = await fetch(`${GAPI.replace('www.googleapis.com', 'oauth2.googleapis.com')}/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(400, `Google OAuth token exchange failed: ${String(j.error_description || j.error || r.status).slice(0, 240)}`);
  return j;
}

/** Exchange the callback authorization code for tokens; store refresh token + channel identity. */
export async function handleOAuthCallback(env, code) {
  const secrets = await getSecrets(env);
  const clientId = secrets.google_client_id || env.GOOGLE_CLIENT_ID || '';
  const clientSecret = secrets.google_client_secret || env.GOOGLE_CLIENT_SECRET || '';
  need(clientId, 'Google client id'); need(clientSecret, 'Google client secret');
  const tokens = await oauthTokenRequest(env, clientId, clientSecret, {
    code, grant_type: 'authorization_code', redirect_uri: redirectUri(env),
  });
  if (!tokens.refresh_token) {
    throw err(400, 'Google did not return a refresh token. Disconnect the channel and connect again (the consent screen must include offline access).');
  }
  await setSecret(env, 'youtube_refresh_token', tokens.refresh_token);
  /* channel identity for the admin panel (readonly scope) */
  const info = await channelsList(env, tokens.access_token).catch(() => null);
  if (info && info.items && info.items[0]) {
    await setSecret(env, 'youtube_channel_id', info.items[0].id || '');
    await setSecret(env, 'youtube_channel_title', (info.items[0].snippet && info.items[0].snippet.title) || '');
  }
  await logActivity(env, 'system', 'youtube_connected', `channel connected: ${(info && info.items && info.items[0] && info.items[0].snippet && info.items[0].snippet.title) || 'unknown'}`).catch(() => {});
  return { channelTitle: (info && info.items && info.items[0] && info.items[0].snippet && info.items[0].snippet.title) || '' };
}

/** Fresh access token from the stored refresh token. Throws reconnect-required on invalid_grant. */
export async function getAccessToken(env) {
  const secrets = await getSecrets(env);
  const clientId = secrets.google_client_id || env.GOOGLE_CLIENT_ID || '';
  const clientSecret = secrets.google_client_secret || env.GOOGLE_CLIENT_SECRET || '';
  const refresh = secrets.youtube_refresh_token;
  if (!refresh) throw scopeErr('NOT_CONNECTED', 'The YouTube channel is not connected yet. Use Admin -------- YouTube Automation -------- Connect YouTube Channel.');
  need(clientId, 'Google client id'); need(clientSecret, 'Google client secret');
  try {
    const j = await oauthTokenRequest(env, clientId, clientSecret, { grant_type: 'refresh_token', refresh_token: refresh });
    return j.access_token;
  } catch (e) {
    const msg = String(e.message || e);
    if (/invalid_grant|unauthorized|revoked/i.test(msg)) {
      throw scopeErr('NOT_CONNECTED', 'The YouTube connection has expired or been revoked. Please reconnect the channel in Admin -------- YouTube Automation.');
    }
    throw e;
  }
}

async function channelsList(env, accessToken) {
  const r = await fetch(`${GAPI}/youtube/v3/channels?part=snippet&mine=true`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return r.json().catch(() => null);
}

/** Public status for the admin dashboard (never includes tokens). */
export async function getConnectionStatus(env) {
  const secrets = await getSecrets(env);
  const clientId = secrets.google_client_id || env.GOOGLE_CLIENT_ID || '';
  const hasRefresh = !!secrets.youtube_refresh_token;
  const configured = !!(clientId && (secrets.google_client_secret || env.GOOGLE_CLIENT_SECRET || ''));
  return {
    connected: hasRefresh && configured,
    channelTitle: secrets.youtube_channel_title || '',
    channelId: secrets.youtube_channel_id || '',
    clientConfigured: !!clientId,
  };
}

/* ------------------------------------------------------------------ vehicle selection */
export async function eligibleVehicles(env, frequencyDays = 30, limit = 100) {
  const vehicles = await rest.get(env, 'vehicles', {
    select: 'id,slug,brand,model,year,price,currency,mileage,engine,transmission,fuel,body_type,exterior_color,interior_color,condition,location,category,status,is_featured,cover,updated_at',
    status: 'eq.published', order: 'updated_at.asc', limit: String(limit),
  }).catch(() => []);
  if (!vehicles || !vehicles.length) return [];
  const ids = vehicles.map((v) => v.id);
  const [vids, pubs] = await Promise.all([
    rest.get(env, 'media', { vehicle_id: `in.(${ids.join(',')})`, type: 'eq.video', select: 'id,vehicle_id,url,caption', order: 'position.asc,id.asc' }).catch(() => []),
    rest.get(env, 'youtube_publications', { vehicle_id: `in.(${ids.join(',')})`, select: 'vehicle_id,status,published_at,created_at', order: 'created_at.desc' }).catch(() => []),
  ]);
  const byVehicle = new Map(); for (const m of vids || []) { if (!byVehicle.has(m.vehicle_id)) byVehicle.set(m.vehicle_id, []); byVehicle.get(m.vehicle_id).push(m); }
  const recent = new Map(); const inflight = new Set();
  const cutoff = Date.now() - Math.max(1, frequencyDays) * 86400e3;
  for (const p of pubs || []) {
    if (p.status === 'queued' || p.status === 'uploading') inflight.add(p.vehicle_id);
    if (p.status === 'published' && p.published_at && Date.parse(p.published_at) > cutoff) recent.set(p.vehicle_id, true);
  }
  return vehicles
    .filter((v) => byVehicle.has(v.id) && !recent.has(v.id) && !inflight.has(v.id))
    .map((v) => ({ ...v, videos: byVehicle.get(v.id) }))
    .sort((a, b) => {
      const la = lastPub(a.id, pubs || []), lb = lastPub(b.id, pubs || []);
      if (la !== lb) return la - lb; /* least recently promoted first */
      if (!!b.is_featured !== !!a.is_featured) return b.is_featured ? 1 : -1;
      return String(a.updated_at || '').localeCompare(String(b.updated_at || ''));
    });
}
const lastPub = (id, pubs) => {
  let t = 0;
  for (const p of pubs) if (p.vehicle_id === id && p.status === 'published' && p.published_at) t = Math.max(t, Date.parse(p.published_at) || 0);
  return t;
};

/* ------------------------------------------------------------------ metadata (templates, no invention) */
const fmtKm = (v) => (v ? Number(v).toLocaleString() + ' km' : 'mileage on request');
export function buildMetadata(v, baseUrl, settings) {
  const title = `${[v.brand, v.model, v.year].filter(Boolean).join(' ')} For Sale | DM Motor Group`.slice(0, 100);
  const listing = `${String(baseUrl || 'https://dmmotorgroup.com').replace(/\/$/, '')}/vehicles/${v.slug}`;
  const priceLine = Number(v.price) > 0
    ? `Price: ${v.currency} ${Number(v.price).toLocaleString()} -------- final drive-away figure confirmed in writing before any payment.`
    : 'Price on request -------- our purchasing desk answers enquiries within one business day.';
  const specLines = [
    v.year ? `Year ${v.year}` : null,
    v.mileage ? `Mileage: ${fmtKm(v.mileage)}` : null,
    v.engine ? `Engine: ${v.engine}` : null,
    v.transmission ? `Transmission: ${v.transmission}` : null,
    v.fuel ? `Fuel: ${v.fuel}` : null,
    v.body_type ? `Body: ${v.body_type}` : null,
    v.condition ? `Condition: ${v.condition}` : null,
    v.exterior_color ? `Exterior: ${v.exterior_color}` : null,
    v.interior_color ? `Interior: ${v.interior_color}` : null,
    v.location ? `Location: ${v.location}` : null,
  ].filter(Boolean).join('\n');
  const desc = [
    `${[v.brand, v.model, v.year].filter(Boolean).join(' ')} -------- now available at DM Motor Group.`,
    '',
    'Explore this vehicle:',
    listing,
    '',
    specLines,
    '',
    priceLine,
    '',
    'DM Motor Group',
    'Discover exceptional automobiles and contact our dealership for purchasing enquiries, inspections and further information.',
    '',
    ['#DMMotorGroup', '#' + String(v.brand || '').replace(/[^A-Za-z0-9]/g, ''), v.year ? `#${v.year}Car` : null, '#Dubai'].filter(Boolean).join(' '),
  ].join('\n');
  const tags = [...new Set([
    v.brand, v.model, `${v.brand} ${v.model}`, v.year ? `${v.year} ${v.brand}` : null, v.brand ? `${v.brand} for sale` : null,
    v.body_type, 'DM Motor Group', 'Dubai', ...((settings && settings.tags) || []),
  ].filter(Boolean).map((t) => String(t).trim()).filter(Boolean))].slice(0, 12);
  return { title, description: desc, tags, listing };
}

/* ------------------------------------------------------------------ resumable upload (chunked + resumable) */
const CHUNK = 8 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ytFetch(path, accessToken, init = {}) {
  const r = await fetch(`${GAPI}/upload/youtube/v3/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...(init.headers || {}) },
  });
  return r;
}

/** Start (or reuse) a resumable session for `pub`. Returns { sessionUrl }. */
async function ensureSession(env, accessToken, pub, meta, videoUrl, totalBytes, contentType) {
  if (pub.upload_session && pub.upload_session_expires && Date.parse(pub.upload_session_expires) > Date.now()) {
    return pub.upload_session;
  }
  const r = await ytFetch('videos?uploadType=resumable&part=snippet,status', accessToken, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(totalBytes),
      'x-upload-content-type': contentType,
    },
    body: JSON.stringify({
      snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: (pub.category_id || pub.categoryId || '2'), defaultLanguage: 'en', defaultAudioLanguage: 'en' },
      status: { privacyStatus: pub.privacy_status || 'private', selfDeclaredMadeForKids: false },
    }),
  });
  if (r.status !== 200) {
    const t = await r.text().catch(() => '');
    throw err(502, `YouTube did not open an upload session (HTTP ${r.status}): ${t.slice(0, 240)}`);
  }
  const session = r.headers.get('location');
  if (!session) throw err(502, 'YouTube did not return an upload session URL.');
  await rest.update(env, 'youtube_publications', { id: pub.id }, {
    upload_session: session, upload_session_expires: new Date(Date.now() + 6 * 3600e3).toISOString(),
    upload_offset: 0, status: 'uploading', updated_at: nowIso(),
  }, true);
  pub.upload_session = session; pub.upload_offset = 0;
  return session;
}

/** Ask YouTube where the upload cursor is (resume support). */
async function queryOffset(pub, totalBytes, accessToken) {
  const r = await fetch(pub.upload_session, {
    method: 'PUT', headers: { 'content-length': '0', 'content-range': `bytes */${totalBytes}` },
  });
  if (r.status === 308) {
    const range = r.headers.get('range');
    const end = range ? +range.split('-')[1] : -1;
    return Number.isFinite(end) ? end + 1 : 0;
  }
  if (r.status === 404) { const e = new Error('The YouTube upload session expired. Restarting the upload.'); e.code = 'SESSION_EXPIRED'; throw e; }
  const j = await r.json().catch(() => ({}));
  if (r.ok || r.status === 200 || r.status === 201) { const v = j.id || j.videoId; if (v) return { done: true, videoId: v }; }
  throw err(502, `YouTube resume query failed (HTTP ${r.status}).`);
}

/** Upload one chunk; returns YouTube's confirmed offset. */
async function uploadChunk(env, pub, accessToken, totalBytes, buffer, start, end) {
  const r = await fetch(pub.upload_session, {
    method: 'PUT',
    headers: { 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${totalBytes}` },
    body: buffer,
  });
  if (r.status === 308) {
    const range = r.headers.get('range');
    const sendEnd = range ? +range.split('-')[1] : end;
    const next = Number.isFinite(sendEnd) ? sendEnd + 1 : end + 1;
    await rest.update(env, 'youtube_publications', { id: pub.id }, { upload_offset: next, updated_at: nowIso() }, true);
    return next;
  }
  if (r.status === 200 || r.status === 201) {
    const j = await r.json().catch(() => ({}));
    const videoId = j.id || j.videoId;
    if (!videoId) throw err(502, 'YouTube accepted the upload but did not return a video id.');
    return { done: true, videoId };
  }
  if (r.status === 404) { const e = new Error('The YouTube upload session expired. Restarting the upload.'); e.code = 'SESSION_EXPIRED'; throw e; }
  const t = await r.text().catch(() => '');
  throw err(502, `YouTube chunk upload failed (HTTP ${r.status}): ${t.slice(0, 240)}`);
}

/** Upload the video for a claimed publication row, with resume support. */
async function uploadVideo(env, pub, videoUrl, sizeBytes, meta) {
  const accessToken = await getAccessToken(env);
  const contentType = 'video/mp4';
  let session = await ensureSession(env, accessToken, pub, meta, videoUrl, sizeBytes, contentType);
  let offset = pub.upload_offset || 0;
  /* ask YouTube for the real cursor first (handles partial previous runs) */
  try {
    const q = await queryOffset(pub, sizeBytes, accessToken);
    if (q && q.done) return q.videoId;
    if (typeof q === 'number') offset = Math.max(offset, q);
  } catch (e) {
    if (e.code === 'SESSION_EXPIRED') { session = null; offset = 0; pub.upload_session = null; }
    else throw e;
  }
  if (!session) { pub.upload_session = null; session = await ensureSession(env, accessToken, pub, meta, videoUrl, sizeBytes, contentType); offset = 0; }
  let pos = offset;
  while (pos < sizeBytes) {
    const end = Math.min(pos + CHUNK - 1, sizeBytes - 1);
    const r = await fetch(videoUrl, { headers: { Range: `bytes=${pos}-${end}` } });
    if (r.status !== 206 && r.status !== 200) throw err(502, `The video file could not be fetched from storage (HTTP ${r.status}).`);
    const buf = await r.arrayBuffer();
    const res = await uploadChunk(env, pub, accessToken, sizeBytes, buf, pos, end, meta);
    if (res && res.done) return res.videoId;
    pos = res;
  }
  /* the final chunk returns { done } -------- unreachable if YouTube answers 308 with
   * zero bytes left; query once to be safe */
  const q = await queryOffset(pub, sizeBytes, accessToken);
  if (q && q.done) return q.videoId;
  throw err(502, 'The upload did not finish -------- YouTube still reports pending bytes.');
}

/** Set the thumbnail from the vehicle's stored frames (skipped if none). */
export async function setThumbnailFromFrames(env, videoId) {
  try {
    const accessToken = await getAccessToken(env);
    const vids = await rest.get(env, 'media', { id: `eq.${videoId}`, select: 'vehicle_id' }).catch(() => []);
    /* thumbnail frame: prefer the vehicle_frames table when available */
    const rows = await rest.get(env, 'vehicle_frames', { vehicle_id: `eq.${vids[0] ? vids[0].vehicle_id : 0}`, select: 'url', order: 'position.asc', limit: '1' }).catch(() => []);
    const url = rows && rows[0] && rows[0].url;
    if (!url) return { set: false, reason: 'no stored frames' };
    const img = await fetch(url);
    if (!img.ok) return { set: false, reason: 'frame not reachable' };
    const type = (img.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
    const body = await img.arrayBuffer();
    const r = await ytFetch(`thumbnails/set?uploadType=media&videoId=${encodeURIComponent(videoId)}`, accessToken, {
      method: 'POST', headers: { 'content-type': /webp/.test(type) ? 'image/webp' : 'image/jpeg' }, body,
    });
    if (!r.ok) return { set: false, reason: `YouTube thumbnail rejected (HTTP ${r.status})` };
    return { set: true };
  } catch (e) {
    return { set: false, reason: String(e && e.message || e).slice(0, 120) };
  }
}

/* ------------------------------------------------------------------ tick (cron entry point) */
const tzParts = (date, timeZone) => {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return { dateStr: `${parts.year}-${parts.month}-${parts.day}`, minutes: (+parts.hour) * 60 + (+parts.minute) };
};
export async function tick(env, { force = false } = {}) {
  const s = await getSettings(env);
  if (!s) throw err(503, 'YouTube settings are not ready (migration 00010).');
  if (!s.enabled && !force) return { ok: true, skipped: 'disabled' };
  if (s.paused) return { ok: true, skipped: 'paused' };
  if (!force) {
    const tz = s.timezone || 'Asia/Dubai';
    const now = new Date();
    const here = tzParts(now, tz);
    const last = s.last_run_at ? tzParts(new Date(s.last_run_at), tz) : null;
    const dueTime = (s.publish_hour || 10) * 60 + (s.publish_minute || 0);
    /* run at/after the configured local time, at most one publication per invocation */
    const ranToday = last && last.dateStr === here.dateStr;
    if (here.minutes < dueTime) return { ok: true, skipped: 'not-due-yet' };
    if (ranToday) {
      /* may still publish more today if videos_per_day > already-published count */
      const since = here.dateStr + 'T00:00:00.000Z';
      const rows = await rest.get(env, 'youtube_publications', { status: 'eq.published', select: 'id', published_at: `gte.${here.dateStr}T00:00:00` }).catch(() => []);
      if ((rows || []).length >= (s.videos_per_day || 1)) return { ok: true, skipped: 'daily-quota-met' };
    }
  }
  const candidates = await eligibleVehicles(env, s.frequency_days || 30, 25);
  if (!candidates.length) {
    await rest.update(env, 'youtube_settings', { id: 1 }, { last_run_at: nowIso(), last_error: null, updated_at: nowIso() }, true);
    return { ok: true, skipped: 'no-eligible-vehicles' };
  }
  const vehicle = candidates[0];
  return publishOne(env, vehicle, { force });
}

/** Claim + upload + record a publication for one eligible vehicle. */
export async function publishOne(env, vehicle, { force = false } = {}) {
  const s = await getSettings(env);
  const video = (vehicle.videos || [])[0];
  if (!video) throw err(400, 'This vehicle has no video to publish.');
  const meta = buildMetadata(vehicle, env.SITE_ORIGIN || env.PUBLIC_ORIGIN || 'https://dmmotorgroup.com', s);
  const sizeBytes = await videoSize(video.url).catch(() => 0);
  /* claim the in-flight slot (unique partial index blocks concurrent runs) */
  let pub;
  try {
    pub = await rest.insert(env, 'youtube_publications', {
      vehicle_id: vehicle.id, video_media_id: video.id, slug: vehicle.slug,
      video_title: meta.title, status: 'queued',
      privacy_status: (s && s.privacy_status) || 'private',
    }, { prefer: 'return=representation' });
    if (Array.isArray(pub)) pub = pub[0];
  } catch (e) {
    const msg = String(e.message || e);
    if (/duplicate key|unique/i.test(msg)) return { ok: true, skipped: 'in-flight' };
    throw e;
  }
  try {
    const videoId = await uploadVideo(env, { ...pub, upload_session: null, upload_offset: 0, category_id: s && s.category_id }, video.url, sizeBytes, { ...meta, category_id: s && s.category_id });
    await rest.update(env, 'youtube_publications', { id: pub.id }, {
      status: 'published', youtube_video_id: videoId, youtube_url: `https://youtu.be/${videoId}`,
      attempts: (pub.attempts || 0) + 1, published_at: nowIso(), updated_at: nowIso(), error_message: null,
    }, true);
    await rest.update(env, 'youtube_settings', { id: 1 }, { last_run_at: nowIso(), last_error: null, updated_at: nowIso() }, true);
    let thumb = null;
    if (s && s.auto_thumbnail !== false) thumb = await setThumbnailFromFrames(env, video.id).catch(() => null);
    await logActivity(env, 'system', 'youtube_published', `#${vehicle.id} ${vehicle.brand} ${vehicle.model} -------- ${videoId}`).catch(() => {});
    return { ok: true, published: true, videoId, url: `https://youtu.be/${videoId}`, vehicleId: vehicle.id, thumbnail: thumb };
  } catch (e) {
    const msg = String(e && (e.message || e)).slice(0, 500);
    await rest.update(env, 'youtube_publications', { id: pub.id }, {
      status: 'failed', error_message: msg, attempts: (pub.attempts || 0) + 1, updated_at: nowIso(),
    }, true).catch(() => {});
    await rest.update(env, 'youtube_settings', { id: 1 }, { last_run_at: nowIso(), last_error: msg, updated_at: nowIso() }, true).catch(() => {});
    return { ok: false, published: false, error: msg, vehicleId: vehicle.id, publicationId: pub.id };
  }
}
const videoSize = async (url) => {
  const r = await fetch(url, { method: 'HEAD' });
  const len = +(r.headers.get('content-length') || 0);
  if (!len) throw new Error('size unknown');
  return len;
};

/** Retry a failed publication in place. */
export async function retryPublication(env, id) {
  const rows = await rest.get(env, 'youtube_publications', { id: `eq.${+id || 0}`, select: '*' });
  const p = rows && rows[0];
  if (!p) throw err(404, 'Publication not found.');
  const vrows = await rest.get(env, 'vehicles', { id: `eq.${p.vehicle_id}`, select: '*' });
  const v = vrows && vrows[0];
  if (!v) throw err(404, 'Vehicle not found.');
  const vids = await rest.get(env, 'media', { vehicle_id: `eq.${v.id}`, type: 'eq.video', select: '*', order: 'position.asc,id.asc', limit: '1' });
  const video = vids && vids[0];
  if (!video) throw err(400, 'This vehicle no longer has a video.');
  const s = await getSettings(env);
  const meta = buildMetadata(v, env.SITE_ORIGIN || env.PUBLIC_ORIGIN || 'https://dmmotorgroup.com', s);
  await rest.update(env, 'youtube_publications', { id: p.id }, { status: 'uploading', error_message: null, updated_at: nowIso() }, true);
  try {
    const sizeBytes = await videoSize(video.url).catch(() => 0);
    const videoId = await uploadVideo(env, { ...p, status: 'uploading', category_id: s && s.category_id }, video.url, sizeBytes, { ...meta, category_id: s && s.category_id });
    await rest.update(env, 'youtube_publications', { id: p.id }, {
      status: 'published', youtube_video_id: videoId, youtube_url: `https://youtu.be/${videoId}`,
      published_at: nowIso(), updated_at: nowIso(), error_message: null,
    }, true);
    return { ok: true, published: true, videoId, url: `https://youtu.be/${videoId}` };
  } catch (e) {
    const msg = String(e && (e.message || e)).slice(0, 500);
    await rest.update(env, 'youtube_publications', { id: p.id }, { status: 'failed', error_message: msg, attempts: (p.attempts || 0) + 1, updated_at: nowIso() }, true).catch(() => {});
    return { ok: false, published: false, error: msg };
  }
}

export default {
  getSettings, getPublicSettings, saveSettings,
  getSecrets, setSecret, deleteSecret,
  buildAuthUrl, redirectUri, handleOAuthCallback, getAccessToken, getConnectionStatus,
  eligibleVehicles, buildMetadata, tick, publishOne, retryPublication, setThumbnailFromFrames,
};
