/* Functional test of the admin dashboard's write paths against production.
   Everything it creates is deleted again; nothing real is modified. */
import fs from 'node:fs';
import zlib from 'node:zlib';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const BASE = process.argv[2] || 'https://dmmotorgroup.com';
const SVC = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));

const log = [];
const rec = (name, ok, detail = '') => { log.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

async function call(path, { method = 'GET', token, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  let payload;
  if (raw) { h['content-type'] = raw.type; payload = raw.data; }
  else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers: h, body: payload });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
  return { status: r.status, data, text };
}

/* ---- a real 1x1 PNG, built here so no fixture file is needed ---- */
function png1x1() {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.from([0, 200, 162, 39]);
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}
const PNG = png1x1();
/* a genuine WebP produced by the browser earlier (VP8L, 64x64) */
const WEBP = Buffer.from(
  'UklGRjACAABXRUJQVlA4WAoAAAAgAAAAPwAAPwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggQgAAANADAJ0BKkAAQAA+bTaYSSQjIqEiCACADYlpAHYAACBupqAK8QtyAAD+62Rf//qcf/Jx/8nH9fb/+rsT4UFgAAAA==',
  'base64');
const HTML = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');

let token = null;
const cleanup = [];
try {
  /* ---------------- sign in ---------------- */
  let r = await call('/api/auth/login', { method: 'POST', body: { email: creds.email, password: creds.password } });
  token = r.data.token;
  rec('admin sign-in', r.status === 200 && !!token);

  /* ================= VEHICLE LIFECYCLE ================= */
  const stamp = Date.now();
  r = await call('/api/admin/vehicles', {
    method: 'POST', token,
    body: { brand: 'AuditBrand', model: 'AuditModel', year: 2020, price: 12345, mileage: 100, bodyType: 'Sedan', fuel: 'Petrol', transmission: 'Automatic', category: 'sedan' },
  });
  const vid = r.data.id;
  rec('vehicle created', r.status === 200 && !!vid, `id=${vid}`);
  cleanup.push(() => call(`/api/admin/vehicles/${vid}`, { method: 'DELETE', token }));

  r = await call(`/api/admin/vehicles/${vid}`, { token });
  rec('vehicle read back', r.status === 200 && r.data.brand === 'AuditBrand' && Number(r.data.price) === 12345);

  r = await call(`/api/admin/vehicles/${vid}`, { method: 'PUT', token, body: { price: 9999, description: 'audit note' } });
  rec('vehicle updated', r.status === 200);
  r = await call(`/api/admin/vehicles/${vid}`, { token });
  rec('vehicle update persisted', Number(r.data.price) === 9999 && r.data.description === 'audit note');

  /* a draft vehicle must not appear on the public site */
  r = await call('/api/vehicles?per=100');
  const listed = (r.data.items || []).some((v) => String(v.id) === String(vid));
  rec('draft vehicle hidden from public list', !listed);

  /* publish it, then it must appear */
  r = await call(`/api/admin/vehicles/${vid}/status`, { method: 'POST', token, body: { status: 'published' } });
  rec('vehicle published', r.status === 200);
  r = await call('/api/vehicles?per=100');
  rec('published vehicle appears publicly', (r.data.items || []).some((v) => String(v.id) === String(vid)));
  await call(`/api/admin/vehicles/${vid}/status`, { method: 'POST', token, body: { status: 'draft' } });

  /* ================= MEDIA + THUMBNAILS ================= */
  r = await call(`/api/admin/upload?vehicleId=${vid}&type=image&filename=audit.png`, {
    method: 'PUT', token, raw: { type: 'image/png', data: PNG },
  });
  const mediaId = r.data.id;
  rec('image uploaded', r.status === 200 && !!mediaId && /storage\/v1\/object\/public/.test(r.data.url || ''), `id=${mediaId}`);
  cleanup.push(() => call(`/api/admin/media/${mediaId}`, { method: 'DELETE', token }));

  const up = await fetch(r.data.url, { method: 'HEAD' });
  rec('uploaded image is publicly readable', up.status === 200, `status=${up.status} type=${up.headers.get('content-type')}`);

  /* thumbnail from a genuine WebP */
  r = await call(`/api/admin/media/${mediaId}/thumb`, { method: 'PUT', token, raw: { type: 'image/webp', data: WEBP } });
  rec('thumbnail generated from a real WebP', r.status === 200 && !!r.data.thumb_url, `status=${r.status}`);
  let thumbUrl = r.data.thumb_url;
  if (thumbUrl) {
    const t = await fetch(thumbUrl, { method: 'HEAD' });
    rec('thumbnail file is served', t.status === 200 && /image\/webp/.test(t.headers.get('content-type') || ''), `status=${t.status} type=${t.headers.get('content-type')}`);
    const db = await fetch(`${env.SUPABASE_URL}/rest/v1/media?id=eq.${mediaId}&select=thumb_url`, { headers: SVC }).then((x) => x.json());
    rec('thumbnail recorded on the media row', (db[0] && db[0].thumb_url) === thumbUrl);
  }

  /* thumbnail from a genuine PNG */
  r = await call(`/api/admin/media/${mediaId}/thumb`, { method: 'PUT', token, raw: { type: 'image/png', data: PNG } });
  rec('thumbnail generated from a real PNG', r.status === 200 && /\.png/.test(r.data.thumb_url || ''), `status=${r.status} ${r.data.thumb_url || r.data.error || ''}`);

  /* an HTML file disguised as an image must be rejected */
  r = await call(`/api/admin/media/${mediaId}/thumb`, { method: 'PUT', token, raw: { type: 'image/webp', data: HTML } });
  rec('thumbnail rejects HTML disguised as an image', r.status === 400, `status=${r.status} ${r.data.error || ''}`);

  /* the rejected thumbnail must not have replaced the good one */
  const db2 = await fetch(`${env.SUPABASE_URL}/rest/v1/media?id=eq.${mediaId}&select=thumb_url`, { headers: SVC }).then((x) => x.json());
  rec('rejected thumbnail did not overwrite the stored one', !/\.html|\.htm/.test(db2[0] && db2[0].thumb_url || '') && !!(db2[0] && db2[0].thumb_url));

  /* an upload with a non-image extension must be refused */
  r = await call(`/api/admin/upload?vehicleId=${vid}&type=image&filename=audit.html`, {
    method: 'PUT', token, raw: { type: 'text/html', data: HTML },
  });
  rec('upload rejects a non-image extension', r.status === 400, `status=${r.status}`);

  /* a spoofed content type on a valid extension must be refused */
  r = await call(`/api/admin/upload?vehicleId=${vid}&type=image&filename=audit2.png`, {
    method: 'PUT', token, raw: { type: 'text/html', data: HTML },
  });
  rec('upload rejects a spoofed content type', r.status === 400, `status=${r.status}`);

  /* media caption edit */
  r = await call(`/api/admin/media/${mediaId}`, { method: 'PUT', token, body: { caption: 'Audit caption', category: 'interior' } });
  rec('media caption updated', r.status === 200);
  const db3 = await fetch(`${env.SUPABASE_URL}/rest/v1/media?id=eq.${mediaId}&select=caption,category`, { headers: SVC }).then((x) => x.json());
  rec('media caption persisted', db3[0] && db3[0].caption === 'Audit caption' && db3[0].category === 'interior');

  /* cover assignment */
  r = await call(`/api/admin/media/${mediaId}/cover`, { method: 'POST', token, body: {} });
  rec('media set as cover', r.status === 200);
  const veh = await call(`/api/admin/vehicles/${vid}`, { token });
  rec('vehicle cover points at the media row', String(veh.data.coverMediaId) === String(mediaId), `coverMediaId=${veh.data.coverMediaId} media=${mediaId}`);

  /* ================= BANNERS ================= */
  r = await call('/api/admin/banners', { method: 'POST', token, body: { title: 'Audit banner', subtitle: 'audit', position: 99, active: false } });
  const bid = r.data.id;
  rec('banner created', r.status === 200 && !!bid, `id=${bid}`);
  cleanup.push(() => call(`/api/admin/banners/${bid}`, { method: 'DELETE', token }));

  r = await call(`/api/admin/banners/${bid}`, { method: 'PUT', token, body: { title: 'Audit banner v2', active: true } });
  rec('banner updated', r.status === 200);
  r = await call(`/api/admin/banners/${bid}/image`, { method: 'PUT', token, raw: { type: 'image/png', data: PNG } });
  rec('banner image uploaded', r.status === 200 && /banners/.test(r.data.image || ''), `status=${r.status}`);
  const imgHead = await fetch(r.data.image || '', { method: 'HEAD' }).catch(() => ({ status: 0 }));
  rec('banner image is served', imgHead.status === 200, `status=${imgHead.status}`);

  r = await call(`/api/admin/banners/${bid}/image`, { method: 'PUT', token, raw: { type: 'text/html', data: HTML } });
  rec('banner rejects a non-image upload', r.status === 400, `status=${r.status}`);

  r = await call('/api/admin/banners', { token });
  const banner = (r.data || []).find((b) => String(b.id) === String(bid));
  rec('banner changes persisted', banner && banner.title === 'Audit banner v2' && banner.active === true);

  /* ================= TESTIMONIALS ================= */
  r = await call('/api/admin/testimonials', { method: 'POST', token, body: { name: 'Audit Person', text: 'Audit review text.', rating: 4, location: 'Dubai' } });
  const tid = r.data.id;
  rec('testimonial created', r.status === 200 && !!tid, `id=${tid}`);
  cleanup.push(() => call(`/api/admin/testimonials/${tid}`, { method: 'DELETE', token }));

  r = await call('/api/admin/testimonials', { token });
  const t0 = (r.data || []).find((t) => String(t.id) === String(tid));
  rec('new testimonial is pending, not public', t0 && t0.status === 'pending');

  const homeBefore = await call('/api/home').then((x) => x.data);
  rec('pending testimonial is not published on the home page',
    !(homeBefore.testimonials || []).some((t) => t.name === 'Audit Person'));

  r = await call(`/api/admin/testimonials/${tid}`, { method: 'PUT', token, body: { status: 'approved' } });
  rec('testimonial approved', r.status === 200);
  const homeAfter = await call('/api/home').then((x) => x.data);
  rec('approved testimonial appears on the home page',
    (homeAfter.testimonials || []).some((t) => t.name === 'Audit Person'));

  /* ================= ENQUIRIES ================= */
  const enqEmail = `audit.enq.${stamp}@example.com`;
  r = await call('/api/enquiries', {
    method: 'POST',
    body: { name: 'Audit Enquirer', email: enqEmail, message: `Audit enquiry message ${stamp}.`, type: 'question' },
  });
  rec('public enquiry accepted', r.status === 200 && !!r.data.id, `status=${r.status} id=${r.data.id} ${r.data.error || ''}`);
  cleanup.push(() => fetch(`${env.SUPABASE_URL}/rest/v1/enquiries?email=eq.${encodeURIComponent(enqEmail)}`, { method: 'DELETE', headers: SVC }));

  r = await call('/api/admin/enquiries?per=50', { token });
  const enqList = Array.isArray(r.data) ? r.data : (r.data.items || []);
  const enq = enqList.find((e) => e.email === enqEmail);
  rec('enquiry visible to staff', !!enq, enq ? `#${enq.id}` : `not found in ${enqList.length} rows`);

  if (enq) {
    r = await call(`/api/admin/enquiries/${enq.id}`, { method: 'PUT', token, body: { status: 'responded', note: 'audit reply' } });
    rec('enquiry status updated', r.status === 200);
    const db = await fetch(`${env.SUPABASE_URL}/rest/v1/enquiries?id=eq.${enq.id}&select=status,admin_notes`, { headers: SVC }).then((x) => x.json());
    rec('enquiry status persisted', !!(db[0] && db[0].status === 'responded'), JSON.stringify(db[0] || {}));
  }

  /* ================= INTEGRATIONS ================= */
  r = await call('/api/admin/integrations', { token });
  rec('integrations list readable', r.status === 200 && Array.isArray(r.data), `n=${(r.data || []).length}`);
  r = await call('/api/admin/integrations', { method: 'POST', token, body: { provider: 'audit', name: 'Audit integration', kind: 'other', status: 'disconnected' } });
  const iid = r.data.id;
  rec('integration created', r.status === 200 && !!iid, `id=${iid}`);
  cleanup.push(() => call(`/api/admin/integrations/${iid}`, { method: 'DELETE', token }));
  r = await call(`/api/admin/integrations/${iid}`, { method: 'PUT', token, body: { name: 'Audit integration v2', status: 'connected' } });
  rec('integration updated', r.status === 200);
  r = await call('/api/admin/integrations', { token });
  const integ = (r.data || []).find((x) => String(x.id) === String(iid));
  rec('integration change persisted', integ && integ.name === 'Audit integration v2' && integ.status === 'connected');

  /* ================= STAFF ACCOUNTS ================= */
  const staffEmail = `audit.staff.${stamp}@example.com`;
  r = await call('/api/admin/users', { method: 'POST', token, body: { email: staffEmail, password: 'AuditStaff123!', name: 'Audit Staff', role: 'viewer' } });
  const staffId = r.data.id || (r.data.user && r.data.user.id);
  rec('staff account created', r.status === 200 && !!staffId, `id=${staffId} ${r.data.error || ''}`);
  cleanup.push(() => call(`/api/admin/users/${staffId}`, { method: 'DELETE', token }));

  if (staffId) {
    r = await call(`/api/admin/users/${staffId}`, { method: 'PUT', token, body: { role: 'manager' } });
    rec('staff role changed', r.status === 200, `status=${r.status} ${r.data.error || ''}`);
    const prof = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${staffId}&select=role`, { headers: SVC }).then((x) => x.json());
    rec('staff role persisted', prof[0] && prof[0].role === 'manager', JSON.stringify(prof[0] || {}));

    /* a viewer must not be able to write settings */
    const login = await call('/api/auth/login', { method: 'POST', body: { email: staffEmail, password: 'AuditStaff123!' } });
    if (login.status === 200) {
      const vtok = login.data.token;
      rec('new staff can sign in', login.data.user.role === 'manager', `role=${login.data.user.role}`);
      r = await call('/api/admin/settings', { method: 'PUT', token: vtok, body: { company_name: 'Hijacked' } });
      rec('manager cannot write dealership settings', r.status === 403, `status=${r.status}`);
    } else {
      rec('new staff can sign in', false, `login status=${login.status}`);
    }
  }
} catch (e) {
  rec('admin functional harness completed', false, e.message);
} finally {
  for (const fn of cleanup.reverse()) { try { await fn(); } catch {} }
  /* nothing may be left behind */
  const leftovers = await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles?brand=eq.AuditBrand&select=id,slug`, { headers: SVC }).then((r) => r.json()).catch(() => []);
  const bannersLeft = await fetch(`${env.SUPABASE_URL}/rest/v1/banners?title=like.Audit*&select=id`, { headers: SVC }).then((r) => r.json()).catch(() => []);
  const testiLeft = await fetch(`${env.SUPABASE_URL}/rest/v1/testimonials?name=eq.Audit%20Person&select=id`, { headers: SVC }).then((r) => r.json()).catch(() => []);
  const intLeft = await fetch(`${env.SUPABASE_URL}/rest/v1/admin_integrations?provider=eq.audit&select=id`, { headers: SVC }).then((r) => r.json()).catch(() => []);
  rec('no test vehicles left behind', (leftovers || []).length === 0, `n=${(leftovers || []).length}`);
  rec('no test banners left behind', (bannersLeft || []).length === 0, `n=${(bannersLeft || []).length}`);
  rec('no test testimonials left behind', (testiLeft || []).length === 0, `n=${(testiLeft || []).length}`);
  rec('no test integrations left behind', (intLeft || []).length === 0, `n=${(intLeft || []).length}`);
}

const failed = log.filter((x) => !x.ok);
console.log(`\n${log.length - failed.length}/${log.length} checks passed; ${failed.length} failed.`);
process.exitCode = failed.length ? 1 : 0;
