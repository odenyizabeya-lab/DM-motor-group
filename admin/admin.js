'use strict';
/* ================================================================
   DM Motor Group — Administration Dashboard
================================================================ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const pg = $('#pg');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n, c = 'USD') => `${c === 'USD' ? '$' : esc(c) + ' '}${Number(n || 0).toLocaleString()}`;
let state = { user: null, vehicle: null, settings: {}, videoThumbs: {} };
let pendingReplace = 0;   /* media id whose video file is being replaced */

async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'X-Requested-With': 'DMAdmin' };
  const t = localStorage.getItem('dm_admin_token');
  if (t) headers.Authorization = 'Bearer ' + t;
  let payload;
  if (raw) { headers['Content-Type'] = raw.type; payload = raw.data; }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(path, body !== undefined || raw ? { method, headers, body: payload, headers2: undefined } : { method, headers });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401) { localStorage.removeItem('dm_admin_token'); showLogin('Session expired — please sign in again.'); throw new Error(data.error || '401'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('error', err); t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3600);
}
function modal(html) { const m = $('#modal'); m.hidden = false; m.innerHTML = `<div class="modal-card">${html}<button class="x btn btn-ghost sm" onclick="closeModal()">✕ Close</button></div>`; }
window.closeModal = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; };
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
const F = (s, key, label, ph, type = 'text') => `<div><label>${label}</label><input name="${key}" type="${type}" value="${esc((s && s[key]) || '')}" placeholder="${esc(ph || '')}"></div>`;
const T = (s, key, label) => `<div class="full"><label>${label}</label><textarea name="${key}">${esc((s && s[key]) || '')}</textarea></div>`;

/* ---------------- auth ---------------- */
function showLogin(msg) {
  $('#shell').hidden = true; $('#loginScreen').hidden = false;
  if (msg) { const e = $('#loginErr'); e.hidden = false; e.textContent = msg; }
}
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: d });
    if (!['admin', 'manager', 'viewer'].includes(r.user.role)) { toast('This account is a customer account — the dashboard requires staff access.', true); return; }
    localStorage.setItem('dm_admin_token', r.token);
    boot();
  } catch (err) { const e2 = $('#loginErr'); e2.hidden = false; e2.textContent = err.message; }
};
$('#btnLogout').onclick = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch {} localStorage.removeItem('dm_admin_token'); showLogin(); };

/* ---------------- routing ---------------- */
const PAGES = { dashboard, vehicles, specifications: specificationsPage, enqueue: null, enquiries, customers, testimonials, banners, ai: aiScanner, ai_service: aiService, integrations: integrationsPage, settings: settingsPage, settings_general: settingsGeneral, settings_media: settingsMedia, settings_users: settingsUsers, settings_maintenance: settingsMaintenance, activity };
window.addEventListener('hashchange', renderRoute);
async function renderRoute() {
  if (!state.user) return;
  const h = location.hash.replace(/^#/, '') || '/dashboard';
  const h0 = h.split('?')[0];
  $$('#sidebar nav a').forEach((a) => a.classList.toggle('on', h0.startsWith(a.getAttribute('href').slice(1))));
  const [name, param] = h0.split('/').filter(Boolean);
  $('#shell').hidden = false; $('#loginScreen').hidden = true;
  const fn = (name === 'vehicles' && param) ? editorPage
    : (name === 'specifications' && param) ? (id => specificationsPage(id))
    : (PAGES[name] || PAGES.dashboard);
  pg.innerHTML = `<div class="pg-head"><div><span class="crumb">Administration</span><h1>Loading…</h1></div></div>`;
  try { await fn(String(param || '')); }
  catch (e) { console.error(e); pg.innerHTML = `<div class="panel"><h3>${esc(e.message)}</h3><a class="btn btn-ghost" href="#/dashboard">Back to dashboard</a></div>`; }
}

/* ================================================== DASHBOARD */
async function dashboard() {
  const [stats, enq, act] = await Promise.all([api('/api/admin/stats'), api('/api/admin/enquiries'), api('/api/admin/activity?limit=14')]);
  $('#eqPill').hidden = !stats.enquiriesNew; $('#eqPill').textContent = stats.enquiriesNew;
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">Overview</span><h1>Dashboard</h1></div>
    <button class="btn btn-gold" onclick="location.hash='#/vehicles/new'">＋ Add new vehicle</button></div>
  <div class="stat-grid">
    <div class="stat"><b>${stats.published}</b><span>Published vehicles</span></div>
    <div class="stat"><b>${stats.drafts}</b><span>Drafts</span></div>
    <div class="stat"><b>${stats.reserved}</b><span>Reserved</span></div>
    <div class="stat"><b>${stats.sold}</b><span>Sold</span></div>
    <div class="stat"><b>${stats.enquiriesNew}</b><span>New enquiries</span></div>
    <div class="stat"><b>${stats.customers}</b><span>Customer accounts</span></div>
    <div class="stat"><b>${stats.photos}</b><span>Uploads photos</span></div>
    <div class="stat"><b>${stats.videos}</b><span>Uploads videos</span></div>
  </div>
  <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;align-items:start" id="dash2col">
    <div class="panel"><h3>Latest enquiries</h3>
      ${enq.slice(0, 8).map((e) => `<div class="enq-card" onclick="location.hash='#/enquiries'">
        <div class="top"><b>${esc(e.name)} — ${esc(e.type)}</b><span class="status ${esc(e.status)}">${esc(e.status)}</span></div>
        <div class="msg">${esc(e.message.slice(0, 120))}${e.message.length > 120 ? '…' : ''}</div>
        <div class="muted">${esc(e.brand ? `${e.brand} ${e.model} ${e.year}` : 'General')} · ${esc(e.email)} ${esc(e.phone || '')}</div>
      </div>`).join('') || '<div class="empty">No enquiries yet.</div>'}
    </div>
    <div class="panel"><h3>Recent activity</h3>
      ${act.map((a) => `<div style="padding:7px 0;border-bottom:1px solid var(--line);font-size:13px"><b style="color:var(--gold2)">${esc(a.action)}</b> <span class="muted">${esc(a.actor)}</span><div class="muted">${esc(a.detail)} · ${esc(a.created_at)}</div></div>`).join('')}
    </div>
  </div>
  <style>@media(max-width:960px){#dash2col{grid-template-columns:1fr!important}}</style>`;
}

/* ================================================== VEHICLES LIST */
async function vehicles() {
  const rows = await api('/api/admin/vehicles');
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">Inventory</span><h1>Vehicles (${rows.length})</h1></div>
    <button class="btn btn-gold" onclick="location.hash='#/vehicles/new'">＋ Add new vehicle</button></div>
  <div class="toolbar"><input type="search" id="vq" placeholder="Filter by brand, model or VIN…" style="min-width:280px">
    <select id="vst"><option value="">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="reserved">Reserved</option><option value="sold">Sold</option></select></div>
  <div class="panel"><div class="table-wrap" style="margin:-20px"><table class="tbl" id="vtbl"></table></div></div>`;
  const draw = () => {
    const q = ($('#vq').value || '').toLowerCase(); const st = $('#vst').value;
    const list = rows.filter((r) => (!q || ((r.brand + r.model + r.vin).toLowerCase().includes(q))) && (!st || r.status === st));
    $('#vtbl').innerHTML = `<thead><tr><th>Photo</th><th>Vehicle</th><th>Price</th><th>Status</th><th>Featured</th><th>Media</th><th>Updated</th><th>Actions</th></tr></thead><tbody>
      ${list.map((v) => `<tr data-id="${v.id}">
        <td>${v.cover ? `<img class="veh-th" src="${esc(v.cover)}" alt="">` : '<div class="veh-th" style="display:grid;place-items:center;color:var(--faint)">—</div>'}</td>
        <td><b>${esc(v.brand)} ${esc(v.model)}</b><br><span class="muted">${v.year} · ${fmtKm(v.mileage)} · ${esc(v.bodyType || '')}</span></td>
        <td><b>${money(v.price, v.currency)}</b></td>
        <td><span class="status ${v.status}">${v.status}</span></td>
        <td><button class="star-toggle ${v.isFeatured ? 'on' : ''}" data-a="feat" title="Feature on homepage">${v.isFeatured ? '★' : '☆'}</button></td>
        <td class="muted">${v.photoCount} p · ${v.videoCount} v</td>
        <td class="muted">${v.videoCount ? '<span class="vstatus ok">video ready</span>' : '<span class="vstatus bad">NO VIDEO</span>'}</td>
        <td class="muted">${esc(v.updated_at)}</td>
        <td><div class="starrow">
          <button data-href="#/vehicles/${v.id}">Edit</button>
          <button data-a="pub" class="${v.status === 'published' ? 'on' : ''}">Publish</button>
          <button data-a="res" class="${v.status === 'reserved' ? 'on' : ''}">Reserve</button>
          <button data-a="sold" class="${v.status === 'sold' ? 'on' : ''}">Sold</button>
          <button data-a="del">Delete</button>
        </div></td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">No vehicles match.</div></td></tr>'}</tbody>`;
  };
  const fmtKm = (n) => Number(n || 0).toLocaleString() + ' km';
  draw();
  $('#vq').oninput = draw; $('#vst').onchange = draw;
  $('#vtbl').onclick = async (e) => {
    const b = e.target.closest('button'); const tr = e.target.closest('tr[data-id]'); if (!b || !tr) return;
    const id = tr.dataset.id; const v = rows.find((r) => String(r.id) === id);
    if (b.dataset.href) { location.hash = b.dataset.href; return; }
    if (b.dataset.a === 'feat') {
      try { await api(`/api/admin/vehicles/${id}`, { method: 'PUT', body: { isFeatured: !v.isFeatured } }); v.isFeatured = v.isFeatured ? 0 : 1; toast(v.isFeatured ? 'Featured on homepage.' : 'Removed from featured.'); draw(); } catch (err) { toast(err.message, true); }
    }
    if (['pub', 'res', 'sold'].includes(b.dataset.a)) {
      const s = { pub: 'published', res: 'reserved', sold: 'sold' }[b.dataset.a];
      try { await api(`/api/admin/vehicles/${id}/status`, { method: 'POST', body: { status: s } }); v.status = s; toast(`Status updated → ${s}.`); if (b.dataset.a === 'sold') confirmSold(v); draw(); } catch (err) { toast(err.message, true); }
    }
    if (b.dataset.a === 'del') {
      if (!confirm(`Delete “${v.brand} ${v.model} ${v.year}” and all its photos/videos permanently?`)) return;
      try { await api(`/api/admin/vehicles/${id}`, { method: 'DELETE' }); toast('Vehicle deleted.'); const i = rows.indexOf(v); rows.splice(i, 1); draw(); } catch (err) { toast(err.message, true); }
    }
  };
  function confirmSold(v) {
    modal(`<h2>Marked as sold</h2><p style="color:var(--dim)">Sold listings stay visible for transparency but no longer accept enquiries. Make sure payment has been received through the agreed escrow account before confirming delivery.</p>`);
  }
}

/* ================================================== VEHICLE SPECIFICATIONS
   The dealer can type any value for any car here - numbers included.
   Generated defaults come from the published specification file; whatever is
   saved here overrides them on the live vehicle page. */
const SPEC_LAYOUT = [
  ['Basic information', [
    ['make', 'Make', 'text'], ['model', 'Model', 'text'], ['year', 'Year of manufacture', 'number'],
    ['exteriorColour', 'Exterior colour', 'text'], ['interiorColour', 'Interior colour', 'text'],
    ['bodyType', 'Body type', 'text'], ['trim', 'Trim and variant', 'text'],
    ['engineNumber', 'Engine number', 'text'], ['vin', 'VIN / chassis number', 'text'],
    ['registrationYear', 'Registration year', 'number'], ['drivetrain', 'Drivetrain', 'text'],
    ['doors', 'Number of doors', 'number'], ['seats', 'Number of seats', 'number'],
  ]],
  ['Engine and performance', [
    ['engineCapacity', 'Engine capacity (cc)', 'text'], ['engineType', 'Engine type', 'text'],
    ['fuel', 'Fuel type', 'text'], ['transmission', 'Transmission', 'text'],
    ['mileage', 'Mileage', 'text'], ['horsepower', 'Horsepower', 'text'],
  ]],
  ['Interior and equipment', [
    ['airConditioning', 'Air conditioning', 'text'], ['navigation', 'Navigation system', 'text'],
    ['reverseCamera', 'Reverse camera', 'text'], ['parkingSensors', 'Parking sensors', 'text'],
    ['sunroof', 'Sunroof', 'text'], ['alloyWheels', 'Alloy wheels', 'text'],
    ['safetyFeatures', 'Safety features', 'textarea'], ['otherEquipment', 'Other available equipment', 'textarea'],
  ]],
];
let SPEC_DEFAULTS = null;
async function specDefaults() {
  if (SPEC_DEFAULTS) return SPEC_DEFAULTS;
  try {
    const r = await fetch('/details/vehicles.json?v=4');
    SPEC_DEFAULTS = await r.json();
  } catch { SPEC_DEFAULTS = { vehicles: {} }; }
  return SPEC_DEFAULTS;
}

async function specificationsPage(id) {
  const defaults = await specDefaults();
  if (id) return specEditorPage(id, defaults);
  const rows = await api('/api/admin/vehicles');
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">Inventory</span><h1>Vehicle specifications</h1></div>
    <span class="muted">Type any value for any car — including mileage, prices, engine numbers and VINs.</span></div>
  <div class="toolbar"><input type="search" id="sq" placeholder="Filter vehicles…" style="min-width:260px">
    <select id="ss"><option value="">All</option><option value="edited">Dealer-edited</option><option value="generated">Generated defaults only</option></select>
    <button class="btn btn-ghost sm" id="sreload">Reload defaults</button></div>
  <div class="panel"><div class="table-wrap" style="margin:-20px"><table class="tbl" id="stbl"></table></div></div>`;
  const draw = () => {
    const q = ($('#sq').value || '').toLowerCase();
    const mode = $('#ss').value;
    const list = rows.filter((v) => {
      const slug = (v.slug || '');
      const d = defaults.vehicles && defaults.vehicles[slug];
      const edited = v.spec && Object.keys(v.spec).length ? 'edited' : 'generated';
      return (!q || ((v.brand + ' ' + v.model + ' ' + v.year).toLowerCase().includes(q))) && (!mode || mode === edited);
    });
    $('#stbl').innerHTML = `<thead><tr><th>Vehicle</th><th>Price</th><th>Mileage</th><th>Registration year</th><th>Engine capacity</th><th>Doors / Seats</th><th>Specification source</th><th></th></tr></thead><tbody>
      ${list.map((v) => {
        const d = (defaults.vehicles && defaults.vehicles[v.slug]) || {};
        const spec = Object.assign({}, d.spec || {}, v.spec || {});
        const edited = v.spec && Object.keys(v.spec).length;
        const nEdited = edited ? Object.keys(v.spec).length : 0;
        const short = (x) => {
          const s = String(x || '');
          if (!s) return '—';
          const cut = s.split(' - issued with')[0].split(' (listing')[0].trim();
          return cut.length > 58 ? cut.slice(0, 58) + '…' : cut;
        };
        return `<tr>
        <td><b>${esc(v.brand)} ${esc(v.model)}</b><br><span class="muted">${v.year} · ${esc(v.bodyType || '')}</span></td>
        <td><b>${money(v.price, v.currency)}</b></td>
        <td>${v.mileage ? Number(v.mileage).toLocaleString() + ' km' : '<span class="muted">not set</span>'}</td>
        <td>${short(spec.registrationYear)}</td>
        <td>${short(spec.engineCapacity)}</td>
        <td>${short(spec.doors)} / ${short(spec.seats)}</td>
        <td>${edited ? `<span class="status published">dealer-edited (${nEdited})</span>` : '<span class="status draft">generated default</span>'}</td>
        <td><button class="btn btn-gold sm" data-spec="${v.id}">Edit</button></td></tr>`;
      }).join('') || '<tr><td colspan="8"><div class="empty">No vehicles match.</div></td></tr>'}</tbody>`;
  };
  draw();
  $('#sq').oninput = draw; $('#ss').onchange = draw;
  $('#sreload').onclick = () => { SPEC_DEFAULTS = null; toast('Reloading generated defaults…'); specificationsPage(); };
  $('#stbl').onclick = (e) => {
    const b = e.target.closest('[data-spec]');
    if (b) location.hash = `#/specifications/${b.dataset.spec}`;
  };
}

async function specEditorPage(id, defaults) {
  const v = await api('/api/admin/vehicles/' + id);
  const d = (defaults.vehicles && defaults.vehicles[v.slug]) || {};
  const generated = d.spec || {};
  const current = Object.assign({}, generated, v.spec || {});
  /* a mileage figure already on the listing record is pre-filled into the sheet */
  if (Number(v.mileage) > 0 && !v.spec) current.mileage = Number(v.mileage).toLocaleString() + ' km';
  const dealerSet = new Set(Object.keys(v.spec || {}));
  const field = (key, label, type) => {
    const val = current[key] == null ? '' : current[key];
    const from = dealerSet.has(key) ? '<span class="chip dealer">your value</span>' : '<span class="chip gen">generated</span>';
    if (type === 'textarea') {
      return `<div class="full"><label>${label} ${from}</label><textarea name="${key}" rows="3">${esc(val)}</textarea></div>`;
    }
    /* numeric-friendly fields are text inputs with a numeric keyboard: a
     * number input would silently blank out values such as "5 (front bucket
     * seats with rear bench)". */
    const im = type === 'number' ? ' inputmode="numeric"' : '';
    return `<div><label>${label} ${from}</label><input name="${key}" type="text"${im} value="${esc(val)}"></div>`;
  };
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb"><a href="#/specifications" style="color:var(--gold2)">← Specifications</a></span>
    <h1>${esc(v.brand)} ${esc(v.model)} ${v.year}</h1></div>
    <span class="status ${v.status}">${v.status}</span></div>
  <form id="specForm">
  <div class="panel">
    <h3>Quick numbers</h3>
    <p class="muted" style="margin:-4px 0 10px">Asking price, mileage and currency are saved straight to the listing record. Everything else on this page belongs to the full specification sheet below.</p>
    <div class="fgrid">
      <div><label>Asking price</label><input name="price" type="number" min="0" step="100" value="${esc(v.price || '')}"></div>
      <div><label>Currency</label><input name="currency" type="text" maxlength="4" value="${esc(v.currency || 'USD')}"></div>
      <div><label>Mileage on the listing record (km)</label><input name="dbMileage" type="number" min="0" step="1" value="${esc(v.mileage == null ? '' : v.mileage)}"></div>
      <div><label>Registration information</label><input name="dbRegistration" type="text" value="${esc(v.registration || '')}" placeholder="e.g. GCC import · duty paid"></div>
    </div>
  </div>
  ${SPEC_LAYOUT.map(([title, fields]) => `<div class="panel"><h3>${title}</h3><div class="fgrid">
    ${fields.map(([k, l, t]) => field(k, l, t)).join('')}</div></div>`).join('')}
  <div class="panel"><h3>Inspection notes</h3>
    <div class="full"><label>Shown on the vehicle page</label><textarea name="notes" rows="3">${esc(v.inspectionReport || '')}</textarea></div>
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:26px">
    <button class="btn btn-gold" type="submit">Save specification</button>
    <button class="btn btn-ghost" type="button" id="specReset">Reset to generated defaults</button>
    <button class="btn btn-ghost" type="button" onclick="location.hash='#/specifications'">Back</button>
  </div>
  </form>`;
  $('#specForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const spec = {};
    for (const [group, fields] of SPEC_LAYOUT) for (const [k] of fields) if (fd[k] != null && String(fd[k]).trim() !== '') spec[k] = String(fd[k]).trim();
    try {
      await api('/api/admin/vehicles/' + id, {
        method: 'PUT',
        body: {
          price: fd.price === '' ? 0 : +fd.price,
          currency: fd.currency || 'USD',
          mileage: fd.dbMileage === '' ? 0 : +fd.dbMileage,
          registration: fd.dbRegistration || '',
        },
      });
      await api('/api/admin/vehicles/' + id + '/spec', { method: 'PUT', body: { spec, notes: fd.notes || '' } });
      toast('Specification saved — it now shows on the vehicle page.');
      location.hash = '#/specifications';
    } catch (err) { toast(err.message, true); }
  };
  $('#specReset').onclick = async () => {
    if (!confirm('Clear your saved values for this car and go back to the generated specification?')) return;
    try {
      await api('/api/admin/vehicles/' + id + '/spec', { method: 'DELETE' });
      toast('Reset to the generated specification.');
      specEditorPage(id, defaults);
    } catch (err) { toast(err.message, true); }
  };
}

/* ================================================== VEHICLE EDITOR */
async function editorPage(id) {
  let v = null;
  if (id && id !== 'new') v = await api(`/api/admin/vehicles/${id}`);
  state.vehicle = v;
  const isNew = !v;
  const f = (label, name, type = 'text', attrs = '') => `<div><label>${label}</label><input name="${name}" type="${type}" ${attrs} value="${esc(v ? (fieldVal(v, name)) : '')}"></div>`;
  const fieldVal = (v2, name) => ({ brand: v2.brand, model: v2.model, year: v2.year, price: v2.price, currency: v2.currency, mileage: v2.mileage, engine: v2.engine, transmission: v2.transmission, fuel: v2.fuel, bodyType: v2.bodyType, exteriorColor: v2.exteriorColor, interiorColor: v2.interiorColor, vin: v2.vin, condition: v2.condition, registration: v2.registration, location: v2.location, description: v2.description, ownershipInfo: v2.ownershipInfo, inspectionReport: v2.inspectionReport })[name];
  const M = ['none', 'dealership_inspected', 'third_party_inspected'];
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb"><a href="#/vehicles" style="color:var(--gold2)">← Vehicles</a></span><h1>${isNew ? 'Add new vehicle' : `Edit — ${esc(v.brand)} ${esc(v.model)} ${v.year}`}</h1></div>
    ${!isNew ? `<span class="status ${v.status}">${v.status}</span>` : ''}</div>
  <form id="vehForm"><div class="editor">
    <div>
      <div class="panel"><h3>Identity</h3><div class="fgrid">
        ${f('Brand *', 'brand', 'text', 'required')}${f('Model *', 'model', 'text', 'required')}
        ${f('Manufacturing year *', 'year', 'number', 'required min=1950 max=2030')}${f('VIN (where available)', 'vin')}
        <div><label>Body type</label><select name="bodyType" id="selBody"></select></div>
        <div><label>Registration information</label><input name="registration" value="${esc(v?.registration || '')}" placeholder="e.g. GCC import · duty paid"></div>
      </div></div>
      <div class="panel"><h3>Pricing & condition</h3><div class="fgrid">
        ${f('Selling price (0 = price on request)', 'price', 'number', 'min=0 step=1')}${f('Currency', 'currency')}
        ${f('Mileage (km) *', 'mileage', 'number', 'required min=0')}${f('Condition', 'condition')}
        <div><label>Availability / location</label><input name="location" value="${esc(v?.location || '')}" placeholder="e.g. Dubai, UAE Showroom"></div>
      </div></div>
      <div class="panel"><h3>Specification</h3><div class="fgrid">
        ${f('Engine size', 'engine')}${f('Transmission', 'transmission')}
        <div><label>Fuel type</label><select name="fuel" id="selFuel"></select></div>
        ${f('Exterior colour', 'exteriorColor')}${f('Interior colour', 'interiorColor')}
      </div></div>
      <div class="panel"><h3>Description, features & history</h3><div class="fgrid">
        <div class="full"><label>Full description (shown on vehicle page)</label><textarea name="description">${esc(v?.description || '')}</textarea></div>
        <div class="full"><label>Features — one per line</label><textarea name="features">${esc((v?.features || []).join('\n'))}</textarea></div>
        <div class="full"><label>Safety features — one per line</label><textarea name="safetyFeatures">${esc((v?.safetyFeatures || []).join('\n'))}</textarea></div>
        <div class="full"><label>Ownership information (verified documents held by the dealership)</label><textarea name="ownershipInfo" style="min-height:64px">${esc(v?.ownershipInfo || '')}</textarea></div>
        <div><label>Inspection status</label><select name="inspectionStatus">${M.map((x) => `<option value="${x}" ${v?.inspectionStatus === x ? 'selected' : ''}>${x === 'none' ? 'No recorded inspection' : x === 'dealership_inspected' ? 'Dealership 150-point' : 'Third-party inspected'}</option>`).join('')}</select></div>
        <div class="full"><label>Inspection notes (displayed verbatim on the vehicle page)</label><textarea name="inspectionReport" style="min-height:74px">${esc(v?.inspectionReport || '')}</textarea></div>
        <div><label>Homepage category</label><select name="category" id="selCat"></select></div>
      </div></div>
    </div>
    <div class="fixed-actions">
      <div class="panel" style="margin:0">
        <h3>Publish control</h3>
        <button type="button" class="btn btn-gold wide" data-act="save">💾 ${isNew ? 'Create vehicle (draft)' : 'Save changes'}</button>
        <button type="button" class="btn btn-ghost wide" data-act="savepub">🚀 Save & publish</button>
        ${!isNew ? `
          ${v.status === 'published' ? '<button type="button" class="btn btn-ghost wide" data-act="draft">Return to draft</button>' : ''}
          <button type="button" class="btn btn-ghost wide" data-act="res">Mark reserved</button>
          <button type="button" class="btn btn-ghost wide" data-act="sold">Mark sold</button>
          <button type="button" class="btn btn-ghost wide" onclick="window.open('/vehicles/${esc(v.slug)}','_blank')">↗ View public page</button>
          <button type="button" class="btn btn-danger wide" data-act="del">Delete vehicle</button>` : ''}
      </div>
    </div>
  </div></form>
  ${!isNew ? `<div class="panel" style="margin-top:16px"><h3>Photography & video gallery</h3>${mediaManager(v)}</div>` : `
    <div class="panel" style="margin-top:16px"><h3>Photography & video gallery</h3><p class="muted">Save the vehicle first (a draft is enough) — upload slots appear here.</p></div>`}`;

  /* selects */
  const populate = async () => {
    let meta = { bodyTypes: ['SUV', 'Sedan', 'Coupe', 'Hatchback', 'Wagon', 'Convertible', 'Pickup', 'Van', 'Truck'], fuels: ['Petrol', 'Diesel', 'Hybrid', 'Plug-in Hybrid', 'Electric', 'LPG'], categories: [{ key: 'luxury', label: 'Luxury' }, { key: 'suv', label: 'SUVs' }, { key: 'sedan', label: 'Sedans' }, { key: 'sports', label: 'Sports Cars' }, { key: 'electric', label: 'Electric' }, { key: 'truck', label: 'Trucks & Commercial' }, { key: 'family', label: 'Family' }] };
    try { meta = await (await fetch('/api/meta')).json(); } catch {}
    $('#selBody').innerHTML = meta.bodyTypes.map((x) => `<option ${v?.bodyType === x ? 'selected' : ''}>${esc(x)}</option>`).join('');
    $('#selFuel').innerHTML = meta.fuels.map((x) => `<option ${v?.fuel === x ? 'selected' : ''}>${esc(x)}</option>`).join('');
    $('#selCat').innerHTML = meta.categories.filter((c) => c.key !== 'featured').map((c) => `<option value="${c.key}" ${v?.category === c.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
  };
  populate();

  /* save */
  const collect = () => {
    const d = Object.fromEntries(new FormData($('#vehForm')));
    return {
      brand: d.brand, model: d.model, year: +d.year, price: +d.price, currency: d.currency || 'USD', mileage: +d.mileage,
      engine: d.engine, transmission: d.transmission, fuel: d.fuel, bodyType: d.bodyType,
      exteriorColor: d.exteriorColor, interiorColor: d.interiorColor, vin: d.vin, condition: d.condition || 'Used',
      registration: d.registration, location: d.location, description: d.description,
      features: String(d.features || '').split('\n').map((x) => x.trim()).filter(Boolean),
      safetyFeatures: String(d.safetyFeatures || '').split('\n').map((x) => x.trim()).filter(Boolean),
      ownershipInfo: d.ownershipInfo, inspectionStatus: d.inspectionStatus, inspectionReport: d.inspectionReport,
      category: d.category,
    };
  };
  const save = async (publish) => {
    const d = collect();
    if (!d.brand || !d.model) { toast('Brand and model are required.', true); return false; }
    try {
      if (isNew) {
        const r = await api('/api/admin/vehicles', { method: 'POST', body: publish ? { ...d, status: 'published' } : { ...d, status: 'draft' } });
        state.vehicle = await api(`/api/admin/vehicles/${r.id}`);
        toast(publish ? 'Vehicle created and published — live on the showroom.' : 'Draft saved.');
        location.hash = '#/vehicles/' + r.id;
      } else {
        await api(`/api/admin/vehicles/${v.id}`, { method: 'PUT', body: d });
        if (publish) await api(`/api/admin/vehicles/${v.id}/status`, { method: 'POST', body: { status: 'published' } });
        toast(publish ? 'Saved and published.' : 'Changes saved to the database.');
        state.vehicle = v = await api(`/api/admin/vehicles/${v.id}`);
        history.replaceState(null, '', '#/vehicles/' + v.id);
        editorPage(String(v.id));
      }
      return true;
    } catch (err) { toast(err.message, true); return false; }
  };
  pg.querySelectorAll('[data-act]').forEach((b) => b.onclick = async () => {
    const a = b.dataset.act;
    if (a === 'save') save(false);
    if (a === 'savepub') save(true);
    if (!isNew) {
      if (a === 'draft') { await api(`/api/admin/vehicles/${v.id}/status`, { method: 'POST', body: { status: 'draft' } }); toast('Returned to draft — hidden from showroom.'); editorPage(String(v.id)); }
      if (a === 'res') { await api(`/api/admin/vehicles/${v.id}/status`, { method: 'POST', body: { status: 'reserved' } }); toast('Marked reserved.'); editorPage(String(v.id)); }
      if (a === 'sold') { await api(`/api/admin/vehicles/${v.id}/status`, { method: 'POST', body: { status: 'sold' } }); toast('Marked sold — archived for transparency.'); editorPage(String(v.id)); }
      if (a === 'del' && confirm('Delete this vehicle and all its media permanently?')) {
        try { await api(`/api/admin/vehicles/${v.id}`, { method: 'DELETE' }); toast('Deleted.'); location.hash = '#/vehicles'; } catch (err) { toast(err.message, true); }
      }
    }
  });

  /* media manager wiring */
  bindMediaManager(isNew ? null : { ...v, id: v.id });
}
function mediaManager(v) {
  const imgs = (v.media || []).filter((m) => m.type === 'image');
  const vids = (v.media || []).filter((m) => m.type === 'video');
  const sorted = [...vids, ...imgs].sort((a, b) => a.position - b.position);
  const videoItem = (m, i) => `
    <div class="mitem vitem" data-id="${m.id}" data-type="video">
      <div class="th vth" title="Click to play this video">
        <video src="${esc(m.url)}" muted playsinline loop preload="metadata" controlslist="nodownload noplaybackrate"></video>
        <span class="vtag">VIDEO ${i === 0 ? '· MAIN' : '· ' + (i + 1)}</span>
        <span class="ord">#${i + 1}</span>
        <span class="vstatus" data-vstatus="${m.id}">checking…</span>
      </div>
      <div class="mctrl">
        <input type="text" data-mid="${m.id}" data-mf="caption" value="${esc(m.caption)}" placeholder="Caption">
        <div class="rowbtns">
          <button data-a="up" title="Move earlier">▲</button><button data-a="down" title="Move later">▼</button>
          <button data-a="main" title="Play this video first"${i === 0 ? ' disabled' : ''}>Main</button>
          <button data-a="check" title="Check that this video plays">Test</button>
          <button data-a="replace" title="Replace this video file">Replace</button>
          <button data-a="del" class="del">✕</button>
        </div>
      </div>
    </div>`;
  const imageItem = (m) => `
    <div class="mitem archived" data-id="${m.id}" data-type="image">
      <div class="th"><span class="vph">archived photo</span><span class="vtag">NOT SHOWN ON THE SITE</span></div>
      <div class="mctrl"><div class="rowbtns"><button data-a="del" class="del">Delete</button></div></div>
    </div>`;
  return `
    <div class="toolbar"><button class="btn btn-gold" id="pickVidBtn">🎬 Upload vehicle video (MP4/WebM/MOV — full length, original quality)</button>
      <input type="file" id="pickVidReplace" accept="video/*" hidden>
      <span class="muted">${vids.length} video(s) · the first video is the one that plays on the vehicle page</span></div>
    <div class="media-grid" id="mgrid">
      ${vids.map((m, i) => videoItem(m, i)).join('')}
      ${imgs.map((m) => imageItem(m)).join('')}
    </div>
    ${imgs.length ? `<div class="muted" style="margin-top:10px">${imgs.length} photograph(s) are kept in the media library but are no longer displayed anywhere on the site - the showroom is video-only. Delete them here if you no longer need them.</div>` : ''}`;
}
function bindMediaManager(v) {
  if (!v) return;
  const grid = $('#mgrid');
  const refresh = async () => { const nv = await api(`/api/admin/vehicles/${v.id}`); state.vehicle = v = nv; grid.innerHTML = new DOMParser().parseFromString(mediaManager(nv), 'text/html').querySelector('#mgrid').innerHTML; wire(); checkAll(); };
  const order = () => $$('#mgrid .mitem[data-type=video]').map((el) => +el.dataset.id);
  /* every video is checked so the administrator can see whether it uploaded
   * correctly and whether it actually plays */
  const checkAll = async () => {
    for (const el of $$('#mgrid .mitem[data-type=video]')) {
      const id = el.dataset.id;
      const badge = el.querySelector('[data-vstatus]');
      if (!badge) continue;
      badge.textContent = 'checking…';
      try {
        const r = await api(`/api/admin/media/${id}/check`);
        badge.textContent = r.ok ? 'plays OK' : 'NOT PLAYABLE';
        badge.className = 'vstatus ' + (r.ok ? 'ok' : 'bad');
        badge.title = r.ok ? ('HTTP ' + r.status + ' ' + r.contentType) : r.reason;
      } catch (e) {
        badge.textContent = 'check failed';
        badge.className = 'vstatus bad';
      }
    }
  };
  const wire = () => {
    $$('#mgrid .mitem button').forEach((b) => b.onclick = async () => {
      const id = +b.closest('.mitem').dataset.id; const a = b.dataset.a;
      try {
        if (a === 'up' || a === 'down') {
          const ids = order(); const i = ids.indexOf(id); const j = a === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= ids.length) return;
          [ids[i], ids[j]] = [ids[j], ids[i]];
          await api(`/api/admin/vehicles/${v.id}/reorder`, { method: 'POST', body: { ids } });
          toast('Playback order updated.');
          refresh();
        }
        if (a === 'main') { await api(`/api/admin/media/${id}/main`, { method: 'POST' }); toast('This video now plays first on the vehicle page.'); refresh(); }
        if (a === 'check') {
          const r = await api(`/api/admin/media/${id}/check`);
          toast(r.ok ? `Video plays correctly (${r.contentType}).` : `Video problem: ${r.reason}`, !r.ok);
        }
        if (a === 'replace') { pendingReplace = id; $('#pickVidReplace').click(); return; }
        if (a === 'del' && confirm('Remove this media file permanently?')) { await api(`/api/admin/media/${id}`, { method: 'DELETE' }); toast('Removed.'); refresh(); }
      } catch (err) { toast(err.message, true); }
    });
    $$('#mgrid [data-mid]').forEach((el) => el.onchange = async () => {
      const body = { [el.dataset.mf]: el.value };
      try { await api(`/api/admin/media/${el.dataset.mid}`, { method: 'PUT', body }); toast('Caption saved.'); } catch (err) { toast(err.message, true); }
    });
    /* click a video to play it in place */
    $$('#mgrid .vth').forEach((t) => t.onclick = (e) => {
      if (e.target.closest('button')) return;
      const vid = t.querySelector('video'); if (!vid) return;
      if (vid.paused) { vid.muted = true; vid.play().catch(() => {}); } else vid.pause();
    });
  };
  wire();
  checkAll();
  const uploadOne = async (file, type) => {
    const status = document.createElement('div');
    status.className = 'muted uploading'; status.textContent = `Uploading ${file.name} (${Math.round(file.size / 10485760) / 10} MB)…`;
    $('#dzImg') && $('#dzImg').after(status);
    try {
      const r = await api(`/api/admin/upload?vehicleId=${v.id}&type=${type}&category=${type === 'image' ? 'exterior' : 'video'}&filename=${encodeURIComponent(file.name)}`,
        { method: 'PUT', raw: { type: file.type || (type === 'image' ? 'image/jpeg' : 'video/mp4'), data: file } });
      /* auto-generate thumbnail client-side */
      try {
        if (type === 'image') await makeThumb(r.id, await shrinkImage(file));
        else await makeThumb(r.id, await videoFrame(file));
      } catch (e) { void e; }
      await refresh();
      toast(`Uploaded: ${file.name}`);
    } catch (err) { toast(err.message, true); }
    status.remove();
  };
  const startImgs = async (files) => { for (const f of files) await uploadOne(f, 'image'); };
  const startVid = async (file) => { await uploadOne(file, 'video'); };
  $('#pickImgsBtn') && ($('#pickImgsBtn').onclick = () => $('#pickImgs').click());
  $('#pickVidBtn') && ($('#pickVidBtn').onclick = () => $('#pickVid').click());
  $('#pickImgs') && ($('#pickImgs').onchange = (e) => { startImgs([...e.target.files]); e.target.value = ''; });
  $('#pickVid') && ($('#pickVid').onchange = (e) => { const f = e.target.files[0]; if (f) startVid(f); e.target.value = ''; });
  const dz = $('#dzImg');
  if (dz) ['dragover', 'dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.toggle('drag', ev === 'dragover'); if (ev === 'drop') startImgs([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))); }));
  /* replacing the file of an existing video keeps its caption and position */
  const rp = $('#pickVidReplace');
  if (rp) rp.onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file || !pendingReplace) return;
    try {
      const r = await api(`/api/admin/media/${pendingReplace}/file?filename=${encodeURIComponent(file.name)}`, { method: 'PUT', raw: { type: file.type || 'video/mp4', data: file } });
      pendingReplace = 0;
      toast(r.playable ? 'Video replaced and verified as playable.' : `Video replaced, but it did not verify: ${r.reason}`, !r.playable);
      refresh();
    } catch (err) { toast(err.message, true); }
  };
}
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.min(520, img.width); const h = Math.round(img.height * (w / img.width));
      const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('thumb'))), 'image/webp', 0.7);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject; img.src = URL.createObjectURL(file);
  });
}
function videoFrame(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'metadata';
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) / 3);
      v.onseeked = () => {
        const c = Object.assign(document.createElement('canvas'), { width: 520, height: Math.round(520 * (v.videoHeight / v.videoWidth) || 292) });
        try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch (e) { return reject(e); }
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('frame'))), 'image/webp', 0.7);
        URL.revokeObjectURL(v.src);
      };
    };
    v.onerror = reject; v.src = URL.createObjectURL(file);
  });
}
async function makeThumb(mediaId, blob) {
  await api(`/api/admin/media/${mediaId}/thumb`, { method: 'PUT', raw: { type: 'image/webp', data: blob } });
}

/* ================================================== AI CAR SCANNER */
let aiImages = [];
let aiVideo = null;
let aiBusy = false;
let aiReport = null;
let aiVehicleId = null;
let aiProvider = 'gemini';

const aiReadBase64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });

async function aiRunScan(images, video, provider) {
  const r = await api('/api/admin/scan', { method: 'POST', body: { images, video, provider } });
  aiReport = r.scan || {}; aiVehicleId = r.vehicleId || null; aiProvider = r.provider || provider || aiProvider;
  return r;
}

function aiRenderReport() {
  const l = aiReport || {};
  const fields = [
    ['brand', 'Manufacturer'], ['model', 'Model'], ['year', 'Year'], ['price', 'Price'], ['mileage', 'Mileage'],
    ['engine', 'Engine / capacity'], ['transmission', 'Transmission'], ['fuel', 'Fuel'], ['bodyType', 'Body type'],
    ['exteriorColor', 'Exterior colour'], ['interiorColor', 'Interior colour'], ['vin', 'VIN'], ['condition', 'Condition'],
    ['location', 'Location'], ['category', 'Category'],
  ];
  let html = `<div class="fgrid">`;
  for (const [k, label] of fields) {
    const v = l[k];
    const val = (v == null ? '' : (typeof v === 'object' ? (v.brand || v.name || '') : v));
    const type = ['year', 'price', 'mileage'].includes(k) ? 'number' : 'text';
    html += `<div><label>${label}</label><input id="aiF-${k}" type="${type}" value="${esc(val ?? '')}"></div>`;
  }
  html += `<div class="full"><label>Full description</label><textarea id="aiF-description" style="min-height:90px">${esc(l.description || '')}</textarea></div>`;
  html += `<div class="full"><label>Key features (comma separated)</label><textarea id="aiF-keyFeatures" style="min-height:60px">${esc((l.keyFeatures || []).join(', '))}</textarea></div>`;
  html += `<div class="full"><label>Sales headline</label><input id="aiF-headline" value="${esc(l.headline || '')}"></div>`;
  html += `<div class="full"><label>Safety features (comma separated)</label><textarea id="aiF-safetyFeatures" style="min-height:60px">${esc((l.safetyFeatures || []).join(', '))}</textarea></div>`;
  html += `<div class="full"><label>Interior features (comma separated)</label><textarea id="aiF-interiorFeatures" style="min-height:50px">${esc((l.interiorFeatures || []).join(', '))}</textarea></div>`;
  html += `<div class="full"><label>Exterior features (comma separated)</label><textarea id="aiF-exteriorFeatures" style="min-height:50px">${esc((l.exteriorFeatures || []).join(', '))}</textarea></div>`;
  html += `<div class="full"><label>Technology features (comma separated)</label><textarea id="aiF-technologyFeatures" style="min-height:50px">${esc((l.technologyFeatures || []).join(', '))}</textarea></div>`;
  html += `<div class="full"><label>Visible damage / condition notes</label><textarea id="aiF-damage" style="min-height:50px">${esc((l.damage || []).join(', '))}</textarea></div>`;
  const mv = l.marketValueEstimate != null ? String(l.marketValueEstimate) : '';
  html += `<div class="full"><label>Market value estimate (USD)</label><input id="aiF-marketValueEstimate" type="number" value="${esc(String(mv))}"></div>`;
  const host = document.getElementById('aiReport');
  if (host) host.innerHTML = html;
}

async function aiScanner() {
  const host = document.createElement('div');
  host.innerHTML = `
    <div class="pg-head"><div><span class="crumb">AI · Automation</span><h1>🤖 AI Car Scanner</h1></div></div>
    <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px;align-items:start">
      <div>
        <div class="panel"><h3>1 · Upload media for scanning</h3>
          <div style="margin-bottom:12px"><label>AI provider</label><select id="aiProvider"><option value="gemini">Google Gemini (primary)</option><option value="openai">OpenAI (alternative)</option></select></div>
          <div class="dropzone" id="aiVidZone"><div style="font-size:26px">🎬</div><div><b>Full-length vehicle video</b></div><div class="muted">MP4 / WebM / MOV — the AI watches the full clip.</div>
            <input type="file" id="aiVid" accept="video/*" hidden></div>
          <div class="toolbar" style="margin-top:10px"><button class="btn btn-gold" id="aiScanBtn" ${aiBusy ? 'disabled' : ''}>🤖 Scan vehicle</button><span class="muted" id="aiScanStatus">No media yet.</span></div>
        </div>
        <div class="panel" style="margin-top:16px"><h3>2 · Photographs</h3>
          <div class="dropzone" id="aiImgZone"><div style="font-size:26px">📷</div><div><b>Car photographs</b></div><div class="muted">Add one or more photos (exterior/interior).</div>
            <input type="file" id="aiImgs" accept="image/*" multiple hidden></div>
          <div class="toolbar" style="margin-top:10px"><button class="btn btn-ghost" id="aiAddImgsBtn">＋ Add photographs</button><span class="muted" id="aiImgCount">0 photos.</span></div>
        </div>
      </div>
      <div>
        <div class="panel"><h3>🤖 AI scan report</h3>
          <div id="aiReport">Run a scan to generate a professional listing.</div>
          <div class="rowbtns" style="margin-top:12px">
            <button class="btn btn-ghost" id="aiEditBtn" ${aiVehicleId ? '' : 'disabled'}>✏ Edit listing</button>
            <button class="btn btn-gold" id="aiSaveDraft">💾 Save as draft</button>
            <button class="btn btn-gold" id="aiPublish">🚀 Publish listing</button>
            <button class="btn btn-ghost" id="aiRescanVid">🔄 Rescan video</button>
            <button class="btn btn-ghost" id="aiRescanImg">🔄 Rescan images</button>
          </div>
        </div>
      </div>
    </div>`;
  pg.innerHTML = host.innerHTML;

  const renderReport = () => {
    const l = aiReport || {};
    const fields = [
      ['brand', 'Manufacturer'], ['model', 'Model'], ['year', 'Year'], ['price', 'Price'], ['mileage', 'Mileage'],
      ['engine', 'Engine / capacity'], ['transmission', 'Transmission'], ['fuel', 'Fuel'], ['bodyType', 'Body type'],
      ['exteriorColor', 'Exterior colour'], ['interiorColor', 'Interior colour'], ['vin', 'VIN'], ['condition', 'Condition'],
      ['location', 'Location'], ['category', 'Category'],
    ];
    let html = `<div class="fgrid">`;
    for (const [k, label] of fields) {
      const v = l[k];
      const val = (v == null ? '' : (typeof v === 'object' ? (v.brand || v.name || '') : v));
      const type = ['year', 'price', 'mileage'].includes(k) ? 'number' : 'text';
      html += `<div><label>${label}</label><input id="aiF-${k}" type="${type}" value="${esc(val ?? '')}"></div>`;
    }
    html += `<div class="full"><label>Full description</label><textarea id="aiF-description" style="min-height:90px">${esc(l.description || '')}</textarea></div>`;
    html += `<div class="full"><label>Key features (comma separated)</label><textarea id="aiF-keyFeatures" style="min-height:60px">${esc((l.keyFeatures || []).join(', '))}</textarea></div>`;
    html += `<div class="full"><label>Sales headline</label><input id="aiF-headline" value="${esc(l.headline || '')}"></div>`;
    html += `<div class="full"><label>Safety features (comma separated)</label><textarea id="aiF-safetyFeatures" style="min-height:60px">${esc((l.safetyFeatures || []).join(', '))}</textarea></div>`;
    html += `<div class="full"><label>Interior features (comma separated)</label><textarea id="aiF-interiorFeatures" style="min-height:50px">${esc((l.interiorFeatures || []).join(', '))}</textarea></div>`;
    html += `<div class="full"><label>Exterior features (comma separated)</label><textarea id="aiF-exteriorFeatures" style="min-height:50px">${esc((l.exteriorFeatures || []).join(', '))}</textarea></div>`;
    html += `<div class="full"><label>Technology features (comma separated)</label><textarea id="aiF-technologyFeatures" style="min-height:50px">${esc((l.technologyFeatures || []).join(', '))}</textarea></div>`;
    html += `<div class="full"><label>Visible damage / condition notes</label><textarea id="aiF-damage" style="min-height:50px">${esc((l.damage || []).join(', '))}</textarea></div>`;
    const mv = l.marketValueEstimate != null ? String(l.marketValueEstimate) : '';
    html += `<div class="full"><label>Market value estimate (USD)</label><input id="aiF-marketValueEstimate" type="number" value="${esc(String(mv))}"></div>`;
    const rep = document.getElementById('aiReport');
    if (rep) rep.innerHTML = html;
  };

  const collectListing = () => {
    const o = {};
    for (const el of document.querySelectorAll('#aiReport input, #aiReport textarea')) {
      const id = el.id; const k = id.replace(/^aiF-/, '');
      let v = el.value;
      if (['year', 'price', 'mileage'].includes(k)) v = v === '' ? null : +v;
      if (k === 'keyFeatures') v = String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
      o[k] = v;
    }
    return o;
  };

  const doScan = async (images, video) => {
    if (aiBusy) return;
    if (!images.length && !video) { toast('Add at least one photograph or the full-length video to scan.', true); return; }
    const provider = (document.getElementById('aiProvider') || {}).value || state.settings?.ai_provider || aiProvider || 'gemini';
    aiBusy = true; const sb = document.getElementById('aiScanBtn'); if (sb) sb.disabled = true; const st = document.getElementById('aiScanStatus'); if (st) st.textContent = `Contacting ${provider === 'openai' ? 'OpenAI' : 'Gemini'}… analysing media.`;
    toast(`🤖 AI scanning… analysing media with ${provider === 'openai' ? 'OpenAI' : 'Gemini'}.`);
    try {
      const r = await api('/api/admin/scan', { method: 'POST', body: { images, video, provider } });
      aiReport = r.scan || {}; aiVehicleId = r.vehicleId || null; aiProvider = r.provider || provider;
      renderReport();
      if (st) st.textContent = `AI scan complete via ${aiProvider} — review the generated listing.`;
      toast(`AI scan complete via ${aiProvider} — review the generated listing.`);
    } catch (e) { if (st) st.textContent = 'AI scan failed — please retry.'; toast(`AI scan failed: ${e.message}`, true); }
    finally { aiBusy = false; const sb2 = document.getElementById('aiScanBtn'); if (sb2) sb2.disabled = false; }
  };

  const saveDraft = async () => {
    if (!aiVehicleId) { toast('Scan first to create the draft listing.', true); return; }
    const d = collectListing();
    await api(`/api/admin/vehicles/${aiVehicleId}`, { method: 'PUT', body: d });
    await api(`/api/admin/vehicles/${aiVehicleId}/status`, { method: 'POST', body: { status: 'draft' } });
    toast('AI listing saved as draft.');
  };
  const publishListing = async () => {
    if (!aiVehicleId) { toast('Scan first to create the draft listing.', true); return; }
    const d = collectListing();
    await api(`/api/admin/vehicles/${aiVehicleId}`, { method: 'PUT', body: d });
    await api(`/api/admin/vehicles/${aiVehicleId}/status`, { method: 'POST', body: { status: 'published' } });
    toast('AI listing published.');
  };

  pg.innerHTML = host.innerHTML;

  const aiScanBtn = document.getElementById('aiScanBtn');
  aiScanBtn.onclick = () => doScan(aiImages, aiVideo);
  const aiAddImgsBtn = document.getElementById('aiAddImgsBtn');
  const aiImgs = document.getElementById('aiImgs');
  if (aiAddImgsBtn) aiAddImgsBtn.onclick = () => aiImgs && aiImgs.click();
  if (aiImgs) aiImgs.onchange = async (e) => {
    const files = [...(e.target.files || [])].filter((f) => f.type.startsWith('image/'));
    for (const f of files) {
      const b64 = await aiReadBase64(f);
      aiImages.push({ name: f.name, mimeType: f.type || 'image/jpeg', dataBase64: b64 });
    }
    const cnt = document.getElementById('aiImgCount');
    if (cnt) cnt.textContent = `${aiImages.length} photos.`;
    e.target.value = '';
  };
  const aiVid = document.getElementById('aiVid');
  if (aiVid) aiVid.onchange = async (e) => { const f = e.target.files && e.target.files[0]; if (f) { aiVideo = { name: f.name, mimeType: f.type || 'video/mp4', dataBase64: await aiReadBase64(f) }; } };

  const aiEditBtn = document.getElementById('aiEditBtn');
  if (aiEditBtn) aiEditBtn.onclick = () => { if (aiVehicleId) location.hash = '#/vehicles/' + aiVehicleId; };
  const aiSaveDraftBtn = document.getElementById('aiSaveDraft'); if (aiSaveDraftBtn) aiSaveDraftBtn.onclick = saveDraft;
  const aiPublishBtn = document.getElementById('aiPublish'); if (aiPublishBtn) aiPublishBtn.onclick = publishListing;
  const aiRescanVidBtn = document.getElementById('aiRescanVid'); if (aiRescanVidBtn) aiRescanVidBtn.onclick = async () => {
    if (!aiVideo) { toast('Add the video first to rescan.', true); return; }
    await doScan(aiImages, aiVideo);
  };
  const aiRescanImgBtn = document.getElementById('aiRescanImg'); if (aiRescanImgBtn) aiRescanImgBtn.onclick = async () => {
    if (!aiImages.length) { toast('Add photos first to rescan.', true); return; }
    await doScan(aiImages, aiVideo);
  };
  renderReport();
}

/* ================================================== ENQUIRIES */
async function enquiries(filter) {
  const rows = await api(`/api/admin/enquiries${filter ? `?status=${filter}` : ''}`);
  const counts = {};
  $$('.status').forEach((s) => void s);
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">Customer pipeline</span><h1>Enquiries</h1></div></div>
  <div class="toolbar">${['', 'new', 'in_progress', 'responded', 'closed'].map((s) => `<button class="btn btn-ghost sm" data-f="${s}">${s === '' ? 'All' : s.replace('_', ' ')}</button>`).join('')}</div>
  <div>${rows.map((e) => `
    <div class="enq-card" data-id="${e.id}">
      <div class="top"><b>${esc(e.name)} — <span style="color:var(--gold2)">${esc(e.type)}</span></b><span>#,${e.id} · <span class="status ${esc(e.status)}">${esc(e.status)}</span></span></div>
      <div class="msg">${esc(e.message.length > 180 ? e.message.slice(0, 180) + '…' : e.message)}</div>
      <div class="muted" style="margin-top:6px">${esc(e.brand ? `${e.brand} ${e.model} ${e.year}` : 'General enquiry')} · ${esc(e.email)} · ${esc(e.phone || 'no phone')} · ${esc(e.created_at)}${e.account_name ? ' · account holder' : ''}</div>
    </div>`).join('') || '<div class="empty">No enquiries found.</div>'}</div>`;
  $$('.toolbar [data-f]').forEach((b) => b.onclick = () => { location.hash = '#/enquiries' + (b.dataset.f ? '/' + b.dataset.f : ''); });
  $$('.enq-card').forEach((c) => c.onclick = async () => {
    const e = rows.find((r) => String(r.id) === c.dataset.id);
    modal(`<h2>Enquiry #${e.id} — ${esc(e.type)}</h2>
      <p class="muted">${esc(e.name)} · ${esc(e.email)} · ${esc(e.phone || '—')} · ${esc(e.ip || '')} · ${esc(e.created_at)}</p>
      <p style="margin:12px 0">${esc(e.message)}</p>
      <p class="muted">Vehicle: ${e.brand ? `<a href="/vehicles/${esc(e.slug)}" target="_blank" style="color:var(--gold2)">${esc(e.brand)} ${esc(e.model)} ${e.year}</a> (status on file: ${esc(e.status2 || '')})` : 'General'}</p>
      <div style="margin:14px 0">
        <label class="muted">Status</label>
        <div class="toolbar" style="margin-top:6px">${['new', 'in_progress', 'responded', 'closed'].map((s) => `<button class="btn btn-ghost sm" data-s="${s}" ${e.status === s ? 'style="border-color:var(--gold);color:var(--gold2)"' : ''}>${s.replace('_', ' ')}</button>`).join('')}</div>
      </div>
      <label class="muted">Internal notes</label>
      <textarea id="eqNotes">${esc(e.admin_notes || '')}</textarea>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn btn-ghost sm" id="eqSaveNotes">Save notes</button>
        <button class="btn btn-gold sm" id="eqNotify">Notify customer (in-app)</button>
        ${e.email ? `<a class="btn btn-ghost sm" href="mailto:${esc(e.email)}?subject=Your DM Motor Group enquiry #${e.id}">Reply by email</a>` : ''}
        ${e.phone ? `<a class="btn btn-ghost sm" href="https://wa.me/${esc(e.phone.replace(/[^0-9]/g, ''))}" target="_blank">WhatsApp customer</a>` : ''}
      </div>`);
    $$('#modal [data-s]').forEach((b) => b.onclick = async () => { await api(`/api/admin/enquiries/${e.id}`, { method: 'PUT', body: { status: b.dataset.s } }); toast(`Enquiry #${e.id} → ${b.dataset.s}.`); enquiries(location.hash.split('/')[2] || ''); });
    $('#eqSaveNotes').onclick = async () => { await api(`/api/admin/enquiries/${e.id}`, { method: 'PUT', body: { adminNotes: $('#eqNotes').value } }); toast('Notes saved to database.'); };
    $('#eqNotify').onclick = async () => { const msg = prompt('Short message to send the customer in-app:'); if (!msg) return; await api(`/api/admin/enquiries/${e.id}`, { method: 'PUT', body: { respond: msg, adminNotes: $('#eqNotes').value } }); toast('Customer notified.'); };
  });
  void counts;
}

/* ================================================== CUSTOMERS */
async function customers() {
  const rows = await api('/api/admin/customers');
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">People</span><h1>Customer & staff accounts</h1></div>
    ${state.user.role === 'admin' ? '<button class="btn btn-gold" id="addUser">＋ Add staff account</button>' : ''}</div>
  <div class="panel"><div class="table-wrap" style="margin:-20px"><table class="tbl">
    <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Favourites</th><th>Joined</th><th>Actions</th></tr></thead><tbody>
    ${rows.map((u) => `<tr data-id="${u.id}">
      <td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${esc(u.phone || '—')}</td>
      <td><select data-role="${u.id}" style="width:auto;font-size:12px;padding:5px 8px" ${state.user.role !== 'admin' ? 'disabled' : ''}>${['admin', 'manager', 'viewer', 'customer'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
      <td class="muted">${u.favourites}</td><td class="muted">${esc(u.created_at)}</td>
      <td>${state.user.role === 'admin' ? `<button class="btn btn-ghost sm" data-pw="${u.id}">Reset password</button> <button class="btn btn-danger sm" data-del="${u.id}">Delete</button>` : '<span class="muted">read-only</span>'}</td>
    </tr>`).join('')}</tbody></table></div></div>`;
  $('#addUser') && ($('#addUser').onclick = () => modal(`<h2>New staff account</h2>
    <div class="fgrid"><div><label>Full name</label><input id="nu_name"></div><div><label>Email</label><input id="nu_mail" type="email"></div>
    <div><label>Password (min 8)</label><input id="nu_pw" type="password"></div><div><label>Role</label><select id="nu_role">${['admin', 'manager', 'viewer'].map((r) => `<option>${r}</option>`).join('')}</select></div></div>
    <button class="btn btn-gold" style="margin-top:14px" id="nuGo">Create account</button>`));
  $('#nuGo') && ($('#nuGo').onclick = async () => {
    try { await api('/api/admin/users', { method: 'POST', body: { name: $('#nu_name').value, email: $('#nu_mail').value, password: $('#nu_pw').value, role: $('#nu_role').value } }); toast('Staff account created.'); closeModal(); customers(); }
    catch (e) { toast(e.message, true); }
  });
  $$('[data-role]').forEach((s) => s.onchange = async () => { try { await api(`/api/admin/users/${s.dataset.role}`, { method: 'PUT', body: { role: s.value } }); toast('Role updated.'); } catch (e) { toast(e.message, true); customers(); } });
  $$('[data-pw]').forEach((b) => b.onclick = async () => { const p = prompt('New password (min 8 characters):'); if (!p) return; try { await api(`/api/admin/users/${b.dataset.pw}`, { method: 'PUT', body: { password: p } }); toast('Password changed.'); } catch (e) { toast(e.message, true); } });
  $$('[data-del]').forEach((b) => b.onclick = async () => { if (!confirm('Delete this account? Its favourites and notifications are removed.')) return; try { await api(`/api/admin/users/${b.dataset.del}`, { method: 'DELETE' }); toast('Account deleted.'); customers(); } catch (e) { toast(e.message, true); } });
}

/* ================================================== TESTIMONIALS */
async function testimonials() {
  const rows = await api('/api/admin/testimonials');
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">Reputation</span><h1>Testimonials</h1></div>
    <button class="btn btn-gold" id="addT">＋ Add collected testimonial</button></div>
  <div class="panel">${rows.map((t) => `
    <div class="enq-card" data-id="${t.id}">
      <div class="top"><b>${esc(t.name)}</b><span class="status ${t.status === 'approved' ? 'published' : ''}">${t.status}</span></div>
      <div class="msg">“${esc(t.text)}”</div>
      <div class="muted" style="margin-top:6px">${'★'.repeat(t.rating)} · ${esc(t.location)} · ${esc(t.created_at)}</div>
      <div class="acts" style="margin-top:10px">
        <button class="btn btn-ghost sm" data-a="pub" data-id="${t.id}">${t.status === 'approved' ? 'Unpublish' : 'Publish to website'}</button>
        <button class="btn btn-danger sm" data-a="del" data-id="${t.id}">Delete</button>
      </div>
    </div>`).join('') || '<div class="empty">No testimonials yet. Add only genuine customer feedback — this system never fabricates reviews.</div>'}</div>`;
  $('#addT').onclick = () => modal(`<h2>Add a collected testimonial</h2><p class="muted" style="margin-bottom:12px">Record feedback collected by the dealership. Nothing is invented automatically.</p>
    <div><label>Name</label><input id="t_name"></div><div><label>Location / context</label><input id="t_loc" placeholder="e.g. Doha, Qatar — bought LX 600"></div>
    <div><label>Rating (1–5)</label><input id="t_rate" type="number" min="1" max="5" value="5"></div>
    <div style="margin-top:8px"><label>Testimonial text</label><textarea id="t_text"></textarea></div>
    <button class="btn btn-gold" style="margin-top:14px" id="tGo">Save (published)</button>`);
  $('#tGo') && ($('#tGo').onclick = async () => {
    try { await api('/api/admin/testimonials', { method: 'POST', body: { name: $('#t_name').value, location: $('#t_loc').value, rating: +$('#t_rate').value, text: $('#t_text').value, status: 'approved' } }); toast('Testimonial published on website.'); testimonials(); }
    catch (e) { toast(e.message, true); }
  });
  $$('[data-a]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.id;
    try {
      if (b.dataset.a === 'del' && !confirm('Delete this testimonial permanently?')) return;
      if (b.dataset.a === 'del') await api(`/api/admin/testimonials/${id}`, { method: 'DELETE' });
      else await api(`/api/admin/testimonials/${id}`, { method: 'PUT', body: { status: (rows.find((r) => String(r.id) === id).status === 'approved') ? 'pending' : 'approved' } });
      toast('Saved.'); testimonials();
    } catch (e) { toast(e.message, true); }
  });
}

/* ================================================== BANNERS */
async function banners() {
  const rows = await api('/api/admin/banners');
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">Homepage</span><h1>Hero banners</h1></div>
    <button class="btn btn-gold" id="addB">＋ Add banner</button></div>
  <div class="panel">${rows.map((b) => `
    <div class="enq-card" data-id="${b.id}">
      <div class="top"><b>${esc(b.title)}</b><span class="status ${b.active ? 'published' : ''}">${b.active ? 'active' : 'hidden'}</span></div>
      <div class="stats-grid" style="display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:center;margin-top:8px">
        <img src="${esc(b.image)}" style="width:150px;height:88px;object-fit:cover;border-radius:8px;border:1px solid var(--line2)">
        <div class="fgrid">
          <div><label class="muted">Title</label><input data-b="${b.id}" data-f="title" value="${esc(b.title)}"></div>
          <div><label class="muted">Subtitle</label><input data-b="${b.id}" data-f="subtitle" value="${esc(b.subtitle)}"></div>
          <div><label class="muted">Link</label><input data-b="${b.id}" data-f="link" value="${esc(b.link)}"></div>
          <div style="display:flex;gap:8px;align-items:end">
            <div style="width:90px"><label class="muted">Position</label><input data-b="${b.id}" data-f="position" type="number" value="${b.position}"></div>
            <button class="btn btn-ghost sm" data-img="${b.id}">🖼 Replace image</button>
            <button class="btn btn-danger sm" data-del="${b.id}">Delete</button>
          </div>
        </div>
      </div>
    </div>`).join('') || '<div class="empty">No banners yet.</div>'}</div>`;
  $$('[data-b]').forEach((el) => el.onchange = async () => {
    const body = { [el.dataset.f]: el.dataset.f === 'position' ? +el.value : el.value };
    await api(`/api/admin/banners/${el.dataset.b}`, { method: 'PUT', body }).then(() => toast('Banner saved — homepage updates immediately.')).catch((e) => toast(e.message, true));
  });
  $$('[data-img]').forEach((b) => b.onclick = () => pickBanner(b.dataset.img));
  $$('[data-del]').forEach((b) => b.onclick = async () => { if (!confirm('Delete banner?')) return; await api(`/api/admin/banners/${b.dataset.del}`, { method: 'DELETE' }).then(() => { toast('Deleted.'); banners(); }); });
  $('#addB').onclick = async () => {
    try { await api('/api/admin/banners', { method: 'POST', body: { title: 'New banner', subtitle: '', image: '/assets/hero.svg', link: '/vehicles', position: rows.length } }); toast('Banner added — edit details below.'); banners(); } catch (e) { toast(e.message, true); }
  };
}
let pendingBanner = null;
function pickBanner(id) {
  pendingBanner = id;
  const inp = $('#pickBannerImg'); inp.value = ''; inp.click();
}
$('#pickBannerImg').onchange = async (e) => {
  const f = [...e.target.files][0];
  if (f && pendingBanner) { try { await api(`/api/admin/banners/${pendingBanner}/image`, { method: 'PUT', raw: { type: f.type, data: f } }); toast('Banner image replaced — homepage updated.'); banners(); } catch (err) { toast(err.message, true); } }
};

/* ================================================== SETTINGS SUB-PAGES */
async function settingsGeneral() { await settingsPage(); }
async function settingsMedia() {
  const s = await api('/api/admin/settings'); state.settings = s;
  if (state.user.role !== 'admin') { pg.innerHTML = `<div class="panel"><h3>Read-only view</h3></div>`; return; }
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">Configuration</span><h1>Image &amp; video upload settings</h1></div></div>
  <form id="setForm"><div class="panel"><h3>Media</h3><div class="fgrid">
    ${F(s, 'media_max_mb', 'Maximum image size (MB)')}${F(s, 'media_max_video_mb', 'Maximum video size (MB)')}
  </div></div>
  <button class="btn btn-gold" type="submit">💾 Save media settings</button>
  <p class="muted" style="margin-top:10px">Limits apply immediately to new uploads. Images: JPG, PNG, WebP, GIF. Video: MP4, WebM, M4V, MOV. The file type is checked server-side and cannot be spoofed by renaming a file.</p></form>`;
  $('#setForm').onsubmit = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); try { await api('/api/admin/settings', { method: 'PUT', body: d }); toast('Media settings saved.'); } catch (err) { toast(err.message, true); } };
}
async function settingsUsers() {
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">People</span><h1>User &amp; staff management</h1></div>
    <a class="btn btn-gold" href="#/customers">Manage staff accounts →</a></div>
  <div class="panel"><h3>Access roles</h3><p class="muted">Roles: admin, manager, viewer, customer. Admins manage staff, vehicles, integrations and settings; managers handle inventory; viewers are read-only.</p></div>`;
}
async function settingsMaintenance() {
  const s = await api('/api/admin/settings'); state.settings = s;
  if (state.user.role !== 'admin') { pg.innerHTML = `<div class="panel"><h3>Read-only view</h3></div>`; return; }
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">Configuration</span><h1>Maintenance mode</h1></div></div>
  <form id="setForm"><div class="panel"><div class="fgrid">
    <div><label>Public website</label><select name="maintenance_mode">
      <option value="no" ${s.maintenance_mode === 'yes' ? '' : 'selected'}>Online — normal service</option>
      <option value="yes" ${s.maintenance_mode === 'yes' ? 'selected' : ''}>Maintenance notice — pause public pages</option>
    </select></div>
  </div></div>
  <button class="btn btn-gold" type="submit">💾 Save maintenance settings</button>
  <p class="muted" style="margin-top:10px">While active, public pages show a maintenance notice with a 503 response. The admin dashboard and API stay available, and the change takes effect within about a minute.</p></form>`;
  $('#setForm').onsubmit = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); try { await api('/api/admin/settings', { method: 'PUT', body: d }); toast('Maintenance settings saved.'); } catch (err) { toast(err.message, true); } };
}

/* ================================================== SETTINGS */
async function settingsPage() {
  const s = await api('/api/admin/settings'); state.settings = s;
  if (state.user.role !== 'admin') { pg.innerHTML = `<div class="panel"><h3>Read-only view</h3><p class="muted">Dealership settings are restricted to full administrators.</p></div>`; return; }
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">Configuration</span><h1>Dealership settings</h1></div></div>
  <form id="setForm"><div class="panel"><h3>Company profile</h3><div class="fgrid">
    ${F(s, 'company_name', 'Company name')}${F(s, 'tagline', 'Tagline')}${F(s, 'phone_main', 'Main telephone')}${F(s, 'phone_sales', 'Sales telephone')}
    ${F(s, 'whatsapp', 'WhatsApp number (digits incl. country code)')}${F(s, 'email_sales', 'Sales email')}
    ${F(s, 'email_support', 'Support email')}${F(s, 'currency', 'Default currency code')}
    ${T(s, 'address_primary', 'Primary showroom address')}${T(s, 'address_secondary', 'Secondary address')}${T(s, 'hours', 'Opening hours')}
  </div></div>
  <div class="panel"><h3>Trust & payment information (shown verbatim to customers)</h3><div class="fgrid">
    ${T(s, 'payment_info', 'Payment instructions')}${T(s, 'inspection_note', 'Inspection policy note')}${T(s, 'trade_license', 'Trade licence note')}
    ${F(s, 'social_instagram', 'Instagram URL')}${F(s, 'social_facebook', 'Facebook URL')}${F(s, 'social_youtube', 'YouTube URL')}${F(s, 'social_linkedin', 'LinkedIn URL')}
  </div></div>
  <button class="btn btn-gold" type="submit">💾 Save all settings</button>
  <p class="muted" style="margin-top:10px">Settings persist in the database and apply instantly to the website, mobile app and admin dashboard.</p></form>`;
  $('#setForm').onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    try { await api('/api/admin/settings', { method: 'PUT', body: d }); toast('Settings saved to the database.'); } catch (err) { toast(err.message, true); }
  };
}

/* ================================================== ACTIVITY */
async function activity() {
  const rows = await api('/api/admin/activity?limit=200');
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">Audit</span><h1>Activity log</h1></div></div>
  <div class="panel"><div class="table-wrap" style="margin:-20px"><table class="tbl">
    <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td class="muted">${esc(a.created_at)}</td><td><b>${esc(a.actor)}</b></td><td><span style="color:var(--gold2)">${esc(a.action)}</span></td><td class="muted">${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div></div>`;
}

/* ================================================== AI CUSTOMER SERVICE */
const AI_SECRET_LABELS = {
  gemini_api_key: 'Google Gemini API key (free tier)',
  openai_api_key: 'OpenAI API key (optional fallback)',
  resend_api_key: 'Resend API key (email delivery + inbound)',
  brevo_api_key: 'Brevo API key (optional email fallback)',
  resend_webhook_secret: 'Resend webhook signing secret (starts with whsec_)',
};
const fmtWhen = (s) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? esc(s) : d.toLocaleString(); };
const badge = (on, label, cls = 'published') => `<span class="status ${on ? cls : 'draft'}">${esc(label)}</span>`;

async function aiService() {
  if (state.user.role !== 'admin') { pg.innerHTML = `<div class="panel"><h3>Read-only view</h3><p class="muted">AI Customer Service configuration is restricted to full administrators.</p></div>`; return; }
  let ov, creds;
  try {
    [ov, creds] = await Promise.all([api('/api/admin/ai/overview'), api('/api/admin/ai/credentials')]);
  } catch (e) {
    pg.innerHTML = `<div class="pg-head"><div><span class="crumb">AI · Automation</span><h1>AI Customer Service</h1></div></div>
      <div class="panel" style="border-color:var(--gold)"><h3>Database setup required</h3>
      <p class="muted">The AI tables are not available yet. Apply migration <code>00007_ai_customer_service.sql</code> in the Supabase SQL Editor, then reload this page.</p>
      <p class="muted" style="margin-top:8px">Details: ${esc(e.message)}</p>
      <a class="btn btn-gold" href="https://supabase.com/dashboard/project/gevxgqdevaanmxqzverv/sql/new" target="_blank" rel="noopener">Open Supabase SQL Editor</a></div>`;
    return;
  }
  /* The overview tells us whether the AI tables exist. Without them nothing on
   * this page can work, so say so instead of showing empty tables and zeros. */
  if (ov.db && ov.db.ready === false) {
    pg.innerHTML = `<div class="pg-head"><div><span class="crumb">AI · Automation</span><h1>AI Customer Service</h1></div></div>
      <div class="panel" style="border-color:var(--gold)"><h3>Database setup required</h3>
      <p class="muted">The AI tables are not available yet. Apply migration <code>00007_ai_customer_service.sql</code> in the Supabase SQL Editor, then reload this page.</p>
      <p class="muted" style="margin-top:8px">Missing tables: <code>${esc((ov.db.missingTables || []).join(', '))}</code></p>
      <p class="muted" style="margin-top:8px">Until the migration is applied the assistant, the job queue, inspection bookings and inbound email handling all stay inactive. No email is sent and no conversation is stored.</p>
      <a class="btn btn-gold" href="https://supabase.com/dashboard/project/gevxgqdevaanmxqzverv/sql/new" target="_blank" rel="noopener">Open Supabase SQL Editor</a></div>`;
    return;
  }
  const s = ov.settings || {};
  const st = ov.status || {};
  const stats = ov.stats || {};
  state.aiInspections = new Map();

  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">AI · Automation</span><h1>AI Customer Service</h1></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost" onclick="aiRunNow()">▶ Run automation now</button>
      <button class="btn btn-ghost" onclick="aiService()">↻ Refresh</button>
    </div></div>

  ${ov.missing && ov.missing.length ? `<div class="panel" style="border-color:var(--gold)"><h3>Setup checklist</h3>
    <ul class="muted" style="margin-left:18px;line-height:1.9">${ov.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}

  <div class="stat-grid">
    <div class="stat"><b>${stats.open || 0}</b><span>Open conversations</span></div>
    <div class="stat"><b>${stats.requested || 0}</b><span>Inspection requests</span></div>
    <div class="stat"><b>${stats.emailsToday || 0}</b><span>Emails sent today</span></div>
    <div class="stat"><b>${stats.escalated || 0}</b><span>Need a human</span></div>
    <div class="stat"><b>${stats.pendingJobs || 0}</b><span>Queued jobs</span></div>
    <div class="stat"><b>${stats.failedJobs || 0}</b><span>Failed jobs</span></div>
  </div>

  <div class="panel"><h3>Assistant status</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      ${badge(st.enabled, st.enabled ? 'Assistant active' : 'Assistant disabled')}
      ${badge(st.aiConfigured, st.aiConfigured ? `AI: ${esc(st.provider || '')} ${esc(st.model || '')}` : 'AI key missing')}
      ${badge(st.emailConfigured, st.emailConfigured ? 'Email delivery ready' : 'Email key missing')}
      ${badge(st.inboundConfigured, st.inboundConfigured ? 'Inbound replies ready' : 'Inbound not configured')}
      <span class="status draft">Daily cap: ${esc(String(s.daily_email_cap == null ? 100 : s.daily_email_cap))}</span>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="btn ${st.enabled ? 'btn-ghost' : 'btn-gold'}" onclick="aiToggle(${st.enabled ? 'false' : 'true'})">${st.enabled ? '⏸ Disable assistant' : '▶ Activate assistant'}</button>
      <button class="btn btn-ghost" onclick="aiTestAi()">Test AI reply</button>
      <input id="aiTestEmail" type="email" value="${esc(state.user.email || '')}" placeholder="you@example.com" style="max-width:240px">
      <button class="btn btn-ghost" onclick="aiTestEmail()">Send test email</button>
    </div>
    <div id="aiTestOut" class="muted" style="margin-top:12px;white-space:pre-wrap"></div>
  </div>

  <div class="panel"><h3>Assistant instructions &amp; email identity</h3>
  <form id="aiSetForm">
    <div class="fgrid">
      <div><label>Status</label><select name="enabled"><option value="true" ${s.enabled ? 'selected' : ''}>Active</option><option value="false" ${!s.enabled ? 'selected' : ''}>Disabled</option></select></div>
      <div><label>AI provider</label><select name="ai_provider"><option value="gemini" ${s.ai_provider === 'gemini' ? 'selected' : ''}>Google Gemini (free tier)</option><option value="openai" ${s.ai_provider === 'openai' ? 'selected' : ''}>OpenAI (fallback)</option></select></div>
      <div><label>Business name</label><input name="business_name" value="${esc(s.business_name || 'DM Motor Group')}"></div>
      <div><label>Team name</label><input name="team_name" value="${esc(s.team_name || 'Customer Relations Team')}"></div>
      <div><label>Sender name</label><input name="from_name" value="${esc(s.from_name || 'DM Motor Group')}"></div>
      <div><label>Sender email</label><input name="from_email" type="email" value="${esc(s.from_email || '')}" placeholder="hello@dmmotorgroup.com"></div>
      <div><label>Inbound reply domain</label><input name="reply_domain" value="${esc(s.reply_domain || '')}" placeholder="inbound.dmmotorgroup.com"></div>
      <div><label>Admin alert email</label><input name="admin_email" type="email" value="${esc(s.admin_email || '')}" placeholder="sales@dmmotorgroup.com"></div>
      <div><label>Gemini model</label><input name="gemini_model" value="${esc(s.gemini_model || 'gemini-2.5-flash')}"></div>
      <div><label>OpenAI model</label><input name="openai_model" value="${esc(s.openai_model || 'gpt-4o-mini')}"></div>
      <div><label>Daily email cap</label><input name="daily_email_cap" type="number" min="0" max="500" value="${esc(String(s.daily_email_cap == null ? 100 : s.daily_email_cap))}"></div>
      <div><label>Reply delay (seconds)</label><input name="reply_delay_seconds" type="number" min="0" max="86400" value="${esc(String(s.reply_delay_seconds == null ? 20 : s.reply_delay_seconds))}"></div>
      <div><label>Follow-up after (hours, 0=off)</label><input name="followup_hours" type="number" min="0" max="720" value="${esc(String(s.followup_hours == null ? 48 : s.followup_hours))}"></div>
      <div><label>Timezone</label><input name="timezone" value="${esc(s.timezone || 'Asia/Dubai')}"></div>
      <div class="full"><label>Communication tone</label><input name="tone" value="${esc(s.tone || 'warm, professional, respectful and reassuring')}"></div>
      <div class="full"><label>Custom instructions (applied to every AI email)</label><textarea name="instructions" style="min-height:90px">${esc(s.instructions || '')}</textarea></div>
      <div class="full"><label>Sign-off</label><input name="signature" value="${esc(s.signature || 'Warm regards,')}"></div>
    </div>
    <button class="btn btn-gold" type="submit">💾 Save assistant settings</button>
  </form></div>

  <div class="panel"><h3>Email &amp; AI credentials</h3>
    <p class="muted" style="margin-bottom:10px">Secrets are stored server-side in a locked table and are never returned to the browser. Leave a field blank to keep the existing value.</p>
    <form id="aiCredForm"><div class="fgrid">
      ${Object.entries(AI_SECRET_LABELS).map(([k, label]) => `<div><label>${esc(label)} ${creds[k] && creds[k].configured ? `<span style="color:var(--gold2)">· ${esc(creds[k].source || 'set')} ${esc(creds[k].masked || '')}</span>` : '<span style="color:var(--faint)">· not set</span>'}</label><input name="${k}" type="password" autocomplete="new-password" placeholder="${creds[k] && creds[k].configured ? 'Leave blank to keep' : 'Paste key'}"></div>`).join('')}
      <div class="full"><p class="muted">Cron secret: ${creds.internal_key && creds.internal_key.configured ? `configured (${esc(creds.internal_key.source)})` : 'not configured'} — managed at deploy time.</p></div>
    </div>
    <button class="btn btn-gold" type="submit">🔐 Save credentials</button>
  </form></div>

  <div class="panel"><h3>Conversations</h3>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <input id="aiConvSearch" placeholder="Search name or email" style="max-width:280px">
      <select id="aiConvStatus"><option value="">All</option><option value="open">Open</option><option value="pending">Pending</option><option value="closed">Closed</option></select>
      <button class="btn btn-ghost" onclick="aiLoadConversations()">Search</button>
    </div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Updated</th><th>Customer</th><th>Vehicle</th><th>Status</th><th></th></tr></thead>
      <tbody id="aiConvRows"></tbody></table></div>
  </div>

  <div id="aiConvDetail"></div>

  <div class="panel"><h3>Inspection requests</h3>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Created</th><th>Customer</th><th>Vehicle</th><th>Preferred</th><th>Confirmed</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody id="aiInspRows"></tbody></table></div>
  </div>

  <div class="panel"><h3>Automation jobs</h3>
    <p class="muted" style="margin-bottom:10px">Background queue with automatic retries and exponential backoff. The cron heartbeat runs every minute.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Kind</th><th>Status</th><th>Attempts</th><th>Run after</th><th>Last error</th><th></th></tr></thead>
      <tbody id="aiJobRows"></tbody></table></div>
  </div>`;

  aiRenderConversations(ov.conversations || []);
  /* One failing panel must not wipe the whole page — show the failure inline. */
  const inlineFail = (sel, label, cols) => (e) => {
    const el = $(sel); if (!el) return;
    el.innerHTML = `<tr><td colspan="${cols}" class="muted">${esc(label)} could not be loaded: ${esc(e.message)}</td></tr>`;
  };
  await Promise.all([
    aiLoadConversations().catch(inlineFail('#aiConvRows', 'Conversations', 5)),
    aiLoadInspections().catch(inlineFail('#aiInspRows', 'Inspection requests', 7)),
    aiLoadJobs().catch(inlineFail('#aiJobRows', 'Automation jobs', 7)),
  ]);

  $('#aiSetForm').onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    d.enabled = d.enabled === 'true';
    ['daily_email_cap', 'reply_delay_seconds', 'followup_hours'].forEach((k) => { d[k] = Number(d[k]); });
    try { await api('/api/admin/ai/settings', { method: 'PUT', body: d }); toast('Assistant settings saved.'); aiService(); }
    catch (err) { toast(err.message, true); }
  };
  $('#aiCredForm').onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    try { const r = await api('/api/admin/ai/credentials', { method: 'PUT', body: d }); toast(`${r.updated} credential(s) saved.`); aiService(); }
    catch (err) { toast(err.message, true); }
  };
}

async function aiToggle(on) {
  try { await api('/api/admin/ai/settings', { method: 'PUT', body: { enabled: on } }); toast(on ? 'Assistant activated.' : 'Assistant disabled.'); aiService(); }
  catch (e) { toast(e.message, true); }
}
async function aiRunNow() {
  try { const r = await api('/api/admin/ai/tick', { method: 'POST' }); toast(`Automation ran — ${r.processed} job(s) processed.`); aiService(); }
  catch (e) { toast(e.message, true); }
}
async function aiTestAi() {
  const out = $('#aiTestOut'); out.textContent = 'Testing AI…';
  try { const r = await api('/api/admin/ai/test', { method: 'POST' });
    out.textContent = `Provider: ${r.decision.provider} (${r.decision.model})\nSubject: ${r.decision.subject}\nEscalate: ${r.decision.escalate}\n\n${r.decision.reply}`;
  } catch (e) { out.textContent = 'AI test failed: ' + e.message; toast(e.message, true); }
}
async function aiTestEmail() {
  const out = $('#aiTestOut'); const to = ($('#aiTestEmail') || {}).value || '';
  out.textContent = 'Sending real test email…';
  try { const r = await api('/api/admin/ai/test-email', { method: 'POST', body: { to } });
    out.textContent = `Real email accepted by ${r.provider}.\nProvider id: ${r.id}\nRecipient: ${r.to}\n\nIf it does not arrive, check the Resend dashboard for delivery status.`;
  } catch (e) { out.textContent = 'Email test failed: ' + e.message; toast(e.message, true); }
}

function aiRenderConversations(items) {
  const body = $('#aiConvRows'); if (!body) return;
  body.innerHTML = (items || []).map((c) => {
    const v = c.vehicles || {};
    return `<tr>
      <td class="muted">${fmtWhen(c.last_message_at || c.updated_at)}</td>
      <td><b>${esc(c.customer_name || c.customer_email)}</b><br><span class="muted">${esc(c.customer_email)}</span></td>
      <td>${v.brand ? esc(`${v.brand} ${v.model} ${v.year}`) : '—'}</td>
      <td>${esc(c.status)}${c.ai_paused ? ' · AI paused' : ''}${c.human_takeover ? ' · human' : ''}${c.escalated ? ' · <b style="color:var(--gold2)">escalated</b>' : ''}</td>
      <td><button class="btn btn-ghost sm" onclick="aiOpenConv('${esc(c.id)}')">Open</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="muted">No conversations yet.</td></tr>';
}

async function aiLoadConversations() {
  const q = ($('#aiConvSearch') && $('#aiConvSearch').value) || '';
  const status = ($('#aiConvStatus') && $('#aiConvStatus').value) || '';
  const r = await api(`/api/admin/ai/conversations?per=50&q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`);
  aiRenderConversations(r.items);
}

async function aiOpenConv(id) {
  const box = $('#aiConvDetail'); box.innerHTML = '<div class="panel"><p class="muted">Loading conversation…</p></div>';
  try {
    const d = await api('/api/admin/ai/conversations/' + encodeURIComponent(id));
    const c = d.conversation; const v = c.vehicles || {};
    const msgs = (d.messages || []).map((m) => `
      <div style="align-self:${m.direction === 'inbound' ? 'flex-start' : 'flex-end'};max-width:78%;background:${m.direction === 'inbound' ? 'rgba(255,255,255,.035)' : 'rgba(201,162,39,.10)'};border:1px solid var(--line);border-radius:10px;padding:10px 12px">
        <div style="font-size:11px;color:var(--faint);margin-bottom:4px">${m.direction === 'inbound' ? 'Customer' : 'Dealership'} · ${fmtWhen(m.created_at)} · ${esc(m.status)}${m.provider ? ` · ${esc(m.provider)}` : ''}</div>
        ${m.subject ? `<b style="font-size:13px">${esc(m.subject)}</b>` : ''}
        <div style="white-space:pre-wrap;font-size:13px;line-height:1.6;max-height:220px;overflow:auto;margin-top:6px">${esc(m.body_text || '')}</div>
        ${m.error ? `<div style="color:#e6a29a;font-size:11.5px;margin-top:6px">${esc(m.error)}</div>` : ''}
      </div>`).join('');
    const insp = (d.inspections || [])[0];
    box.innerHTML = `
    <div class="panel" id="aiConvPanel"><h3>Conversation — ${esc(c.customer_name || c.customer_email)}</h3>
      <div class="muted" style="margin-bottom:10px">${esc(c.customer_email)} · ${v.brand ? esc(`${v.brand} ${v.model} ${v.year}`) : 'no vehicle'} · ${esc(c.status)}${c.escalated ? ' · <b style="color:var(--gold2)">escalated: ' + esc(c.escalation_reason || '') + '</b>' : ''}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <button class="btn btn-ghost sm" onclick="aiPause('${esc(c.id)}',${c.ai_paused ? 'false' : 'true'})">${c.ai_paused ? '▶ Resume AI' : '⏸ Pause AI'}</button>
        <button class="btn btn-ghost sm" onclick="aiTakeover('${esc(c.id)}',${c.human_takeover ? 'false' : 'true'})">${c.human_takeover ? '↩ Return to AI' : '👤 Take over'}</button>
        <button class="btn btn-ghost sm" onclick="aiClose('${esc(c.id)}')">✕ Close conversation</button>
        ${insp ? `<span class="status ${insp.status === 'confirmed' ? 'published' : 'draft'}">Inspection: ${esc(insp.status)} ${esc(insp.preferred_date || '')} ${esc(insp.preferred_time || '')}</span>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;max-height:480px;overflow:auto;padding:4px">${msgs || '<p class="muted">No messages.</p>'}</div>
      <form id="aiReplyForm" style="margin-top:16px">
        <div class="fgrid"><div class="full"><label>Reply as the dealership (sends a real email and pauses AI for this customer)</label><textarea name="text" required style="min-height:100px"></textarea></div>
        <div class="full"><label>Subject</label><input name="subject" value="${esc('Re: ' + (c.subject || 'your enquiry'))}"></div></div>
        <button class="btn btn-gold" type="submit">✉ Send reply</button>
      </form>
    </div>`;
    $('#aiReplyForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try { await api('/api/admin/ai/conversations/' + encodeURIComponent(c.id) + '/reply', { method: 'POST', body: f }); toast('Reply sent.'); aiOpenConv(c.id); aiLoadConversations(); }
      catch (err) { toast(err.message, true); }
    };
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { box.innerHTML = `<div class="panel"><h3>Could not load conversation</h3><p class="muted">${esc(e.message)}</p></div>`; }
}

async function aiPause(id, paused) { try { await api(`/api/admin/ai/conversations/${encodeURIComponent(id)}/pause`, { method: 'POST', body: { paused } }); toast(paused ? 'AI paused for this customer.' : 'AI resumed.'); aiOpenConv(id); } catch (e) { toast(e.message, true); } }
async function aiTakeover(id, takeover) { try { await api(`/api/admin/ai/conversations/${encodeURIComponent(id)}/takeover`, { method: 'POST', body: { takeover } }); toast(takeover ? 'You have taken over this conversation.' : 'Returned to AI.'); aiOpenConv(id); } catch (e) { toast(e.message, true); } }
async function aiClose(id) { try { await api(`/api/admin/ai/conversations/${encodeURIComponent(id)}/close`, { method: 'POST', body: {} }); toast('Conversation closed.'); aiOpenConv(id); aiLoadConversations(); } catch (e) { toast(e.message, true); } }

async function aiLoadInspections() {
  const r = await api('/api/admin/ai/inspections');
  state.aiInspections = new Map((r.items || []).map((x) => [String(x.id), x]));
  const body = $('#aiInspRows'); if (!body) return;
  body.innerHTML = (r.items || []).map((x) => {
    const v = x.vehicles || {};
    const actions = [];
    if (['requested', 'confirmed', 'rescheduled'].includes(x.status)) {
      actions.push(`<button class="btn btn-ghost sm" onclick="aiInspection(${x.id},'confirmed')">Confirm</button>`);
      actions.push(`<button class="btn btn-ghost sm" onclick="aiInspection(${x.id},'rescheduled')">Reschedule</button>`);
    }
    if (x.status !== 'cancelled' && x.status !== 'completed') actions.push(`<button class="btn btn-ghost sm" onclick="aiInspection(${x.id},'cancelled')">Cancel</button>`);
    if (x.status !== 'completed') actions.push(`<button class="btn btn-ghost sm" onclick="aiInspection(${x.id},'completed')">Complete</button>`);
    return `<tr>
      <td class="muted">${fmtWhen(x.created_at)}</td>
      <td><b>${esc(x.customer_name)}</b><br><span class="muted">${esc(x.customer_email)}</span></td>
      <td>${v.brand ? esc(`${v.brand} ${v.model} ${v.year}`) : '—'}</td>
      <td>${esc(x.preferred_date || 'flexible')}<br><span class="muted">${esc(x.preferred_time || '')}</span></td>
      <td>${esc(x.confirmed_date || '—')}<br><span class="muted">${esc(x.confirmed_time || '')}</span></td>
      <td><span class="status ${x.status === 'confirmed' ? 'published' : (x.status === 'cancelled' ? 'sold' : 'draft')}">${esc(x.status)}</span></td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">${actions.join('')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">No inspection requests yet.</td></tr>';
}

async function aiInspection(id, status) {
  const x = state.aiInspections && state.aiInspections.get(String(id));
  if (!x) return;
  const body = { status };
  if (status === 'confirmed' || status === 'rescheduled') {
    const date = prompt('Confirmed date (YYYY-MM-DD)', x.confirmed_date || x.preferred_date || new Date().toISOString().slice(0, 10));
    if (!date) return;
    const time = prompt('Confirmed time', x.confirmed_time || x.preferred_time || '11:00');
    if (!time) return;
    body.confirmedDate = date; body.confirmedTime = time;
  }
  if (status === 'cancelled' || status === 'completed') {
    const note = prompt('Optional note for the customer (visible in the email context)', x.admin_notes || '');
    if (note != null) body.admin_notes = note;
  }
  try { await api('/api/admin/ai/inspections/' + id, { method: 'PUT', body }); toast(`Inspection marked ${status}. The customer will be emailed.`); aiLoadInspections(); }
  catch (e) { toast(e.message, true); }
}

async function aiLoadJobs() {
  const r = await api('/api/admin/ai/jobs');
  const body = $('#aiJobRows'); if (!body) return;
  body.innerHTML = (r.items || []).map((j) => `<tr>
    <td class="muted">#${j.id}</td>
    <td>${esc(j.kind)}</td>
    <td><span class="status ${j.status === 'done' ? 'published' : (j.status === 'failed' ? 'sold' : 'draft')}">${esc(j.status)}</span></td>
    <td>${j.attempts}/${j.max_attempts}</td>
    <td class="muted">${fmtWhen(j.run_after)}</td>
    <td class="muted" style="max-width:320px">${esc(j.last_error || '')}</td>
    <td>${j.status === 'failed' || j.status === 'done' ? `<button class="btn btn-ghost sm" onclick="aiRetry(${j.id})">Retry</button>` : ''}</td>
  </tr>`).join('') || '<tr><td colspan="7" class="muted">No jobs queued yet.</td></tr>';
}
async function aiRetry(id) { try { await api('/api/admin/ai/jobs/' + id + '/retry', { method: 'POST' }); toast('Job queued for retry.'); aiLoadJobs(); } catch (e) { toast(e.message, true); } }

/* ----------------------------------------------------- API & integrations */
const INTEGRATION_KINDS_UI = ['ai', 'database', 'infra', 'email', 'payment', 'social', 'other'];

async function integrationsPage() {
  const rows = await api('/api/admin/integrations');
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">Configuration</span><h1>API &amp; integrations</h1></div>
    <button class="btn btn-gold" id="addI">＋ Add integration</button></div>
  <div class="panel"><h3>Connected providers</h3>
    <p class="muted" style="margin-bottom:12px">Live credentials for AI and email are managed in <a href="#/ai_service" style="color:var(--gold2)">AI Customer Service</a>. This page records <b>metadata only</b> — which providers the dealership works with and whether they are connected. Secrets are never stored here.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Provider</th><th>Name</th><th>Kind</th><th>Status</th><th>Masked value</th><th></th></tr></thead><tbody>
      ${(rows || []).map((r) => `<tr>
        <td><b>${esc(r.provider)}</b></td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.kind)}</td>
        <td><span class="status ${r.status === 'connected' ? 'published' : 'draft'}">${esc(r.status)}</span></td>
        <td class="muted">${esc(r.masked_value || '—')}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost sm" data-ie="${esc(r.id)}">Edit</button>
          <button class="btn btn-danger sm" data-idel="${esc(r.id)}">Delete</button>
        </td></tr>`).join('') || '<tr><td colspan="6" class="muted">No integrations registered.</td></tr>'}
    </tbody></table></div></div>`;

  const openForm = (row) => {
    const r = row || { provider: '', name: '', kind: 'other', status: 'disconnected', masked_value: '' };
    modal(`<h2>${row ? 'Edit integration' : 'Add integration'}</h2>
      <p class="muted" style="margin-bottom:12px">Metadata only. Never paste an API key here — keys live in AI&nbsp;Customer&nbsp;Service.</p>
      <div class="fgrid">
        <div><label>Provider</label><input id="i_provider" value="${esc(r.provider)}" placeholder="e.g. gemini"></div>
        <div><label>Display name</label><input id="i_name" value="${esc(r.name)}" placeholder="e.g. Google Gemini AI"></div>
        <div><label>Kind</label><select id="i_kind">${INTEGRATION_KINDS_UI.map((k) => `<option value="${k}" ${r.kind === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>
        <div><label>Status</label><select id="i_status"><option value="connected" ${r.status === 'connected' ? 'selected' : ''}>connected</option><option value="disconnected" ${r.status !== 'connected' ? 'selected' : ''}>disconnected</option></select></div>
        <div class="full"><label>Masked value (display only, e.g. ••••1234)</label><input id="i_masked" value="${esc(r.masked_value || '')}"></div>
      </div>
      <button class="btn btn-gold" style="margin-top:14px" id="iGo">Save integration</button>`);
    $('#iGo').onclick = async () => {
      const body = {
        provider: $('#i_provider').value.trim(),
        name: $('#i_name').value.trim() || $('#i_provider').value.trim(),
        kind: $('#i_kind').value,
        status: $('#i_status').value,
        masked_value: $('#i_masked').value.trim(),
      };
      try {
        if (row) await api(`/api/admin/integrations/${encodeURIComponent(row.id)}`, { method: 'PUT', body });
        else await api('/api/admin/integrations', { method: 'POST', body });
        closeModal(); toast(row ? 'Integration updated.' : 'Integration added.'); integrationsPage();
      } catch (e) { toast(e.message, true); }
    };
  };

  $('#addI').onclick = () => openForm(null);
  $$('[data-ie]').forEach((b) => b.onclick = () => openForm(rows.find((r) => String(r.id) === b.dataset.ie)));
  $$('[data-idel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this integration record?')) return;
    try { await api(`/api/admin/integrations/${encodeURIComponent(b.dataset.idel)}`, { method: 'DELETE' }); toast('Deleted.'); integrationsPage(); }
    catch (e) { toast(e.message, true); }
  });
}

/* ---------------- boot ---------------- */
async function boot() {
  try {
    const me = await api('/api/auth/me');
    if (!me.user || !['admin', 'manager', 'viewer'].includes(me.user.role)) return showLogin(me.user ? 'This is a customer account — staff access required.' : null);
    state.user = me.user;
    $('#whoami').innerHTML = `<b>${esc(state.user.name)}</b>${esc(state.user.email)}<br><span style="color:var(--gold2)">${esc(state.user.role)}</span>`;
    location.hash || (location.hash = '#/dashboard');
    renderRoute();
  } catch (e) { showLogin(); }
}
boot();
