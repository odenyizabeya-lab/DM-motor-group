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
const PAGES = { dashboard, vehicles, enqueue: null, enquiries, customers, testimonials, banners, settings: settingsPage, activity };
window.addEventListener('hashchange', renderRoute);
async function renderRoute() {
  if (!state.user) return;
  const h = location.hash.replace(/^#/, '') || '/dashboard';
  const h0 = h.split('?')[0];
  $$('#sidebar nav a').forEach((a) => a.classList.toggle('on', h0.startsWith(a.getAttribute('href').slice(1))));
  const [name, param] = h0.split('/').filter(Boolean);
  $('#shell').hidden = false; $('#loginScreen').hidden = true;
  const fn = (name === 'vehicles' && param) ? editorPage : (PAGES[name] || PAGES.dashboard);
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
        ${f('Selling price *', 'price', 'number', 'required min=0 step=1')}${f('Currency', 'currency')}
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
  const item = (m, i, list) => `
    <div class="mitem" data-id="${m.id}">
      <div class="th" title="Click to preview">${m.type === 'image' ? `<img src="${esc(m.thumbUrl || m.url)}" alt="">` : `<img src="${esc(m.thumbUrl)}" alt=""><div class="vph" style="position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-size:26px">▶</div>`}
        <span class="vtag">${m.type === 'video' ? 'VIDEO · full length' : esc(m.category)}</span><span class="ord">#${list.indexOf(m) + 1}</span>
        ${v.coverMediaId === m.id ? '<span class="cover-flag">COVER PHOTO</span>' : ''}</div>
      <div class="mctrl">
        <input type="text" data-mid="${m.id}" data-mf="caption" value="${esc(m.caption)}" placeholder="Caption">
        ${m.type === 'image' ? `<select data-mid="${m.id}" data-mf="category">${['exterior', 'interior', 'engine', 'dashboard', 'boot', 'wheel', 'damage'].map((c) => `<option ${m.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>` : ''}
        <div class="rowbtns">
          <button data-a="up" title="Move earlier">▲</button><button data-a="down" title="Move later">▼</button>
          <button data-a="cover" title="Set as main cover">Cover</button><button data-a="del" class="del">✕</button>
        </div>
      </div>
    </div>`;
  return `
    <div class="dropzone" id="dzImg">📷 Click or drop photographs here (JPG/PNG/WebP — as many as you need)
      <div class="muted">The first exterior photograph works best as the cover. Thumbnails are generated automatically.</div></div>
    <div class="toolbar"><button class="btn btn-gold" id="pickImgsBtn">＋ Add photographs</button>
      <button class="btn btn-ghost" id="pickVidBtn">🎬 Add full-length video (MP4/WebM — original file preserved complete)</button>
      <span class="muted">${imgs.length} photographs · ${vids.length} videos</span></div>
    <div class="media-grid" id="mgrid">
      ${[...imgs, ...vids].sort((a, b) => a.position - b.position).map((m) => item(m, 0, [...imgs, ...vids])).join('')}
    </div>`;
}
function bindMediaManager(v) {
  if (!v) return;
  const grid = $('#mgrid');
  const refresh = async () => { const nv = await api(`/api/admin/vehicles/${v.id}`); state.vehicle = v = nv; grid.innerHTML = new DOMParser().parseFromString(mediaManager(nv), 'text/html').querySelector('#mgrid').innerHTML; wire(); };
  const order = () => $$('#mgrid .mitem').map((el) => +el.dataset.id);
  const wire = () => {
    $$('#mgrid .mitem button').forEach((b) => b.onclick = async () => {
      const id = +b.closest('.mitem').dataset.id; const a = b.dataset.a; const mid = state.vehicle.media.findIndex((m) => m.id === id);
      try {
        if (a === 'up' || a === 'down') {
          const ids = order(); const i = ids.indexOf(id); const j = a === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= ids.length) return;
          [ids[i], ids[j]] = [ids[j], ids[i]];
          await api(`/api/admin/vehicles/${v.id}/reorder`, { method: 'POST', body: { ids } });
          refresh();
        }
        if (a === 'cover') { await api(`/api/admin/media/${id}/cover`, { method: 'POST' }); toast('Cover photograph updated — homepage and cards will use it.'); refresh(); }
        if (a === 'del' && confirm('Remove this media file permanently?')) { await api(`/api/admin/media/${id}`, { method: 'DELETE' }); toast('Removed.'); refresh(); }
      } catch (err) { toast(err.message, true); }
    });
    $$('#mgrid [data-mid]').forEach((el) => el.onchange = async () => {
      const body = { [el.dataset.mf]: el.value };
      try { await api(`/api/admin/media/${el.dataset.mid}`, { method: 'PUT', body }); toast('Media details saved.'); } catch (err) { toast(err.message, true); }
    });
    const th = $('#mgrid .th img');
    $$('#mgrid .th').forEach((t) => t.onclick = (e) => { if (e.target.closest('button')) return; const it = state.vehicle.media.find((m) => m.id === +t.closest('.mitem').dataset.id); window.open(it.url, '_blank'); });
  };
  wire();
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
  $('#pickImgsBtn').onclick = () => $('#pickImgs').click();
  $('#pickVidBtn').onclick = () => $('#pickVid').click();
  $('#dzImg').onclick = () => $('#pickImgs').click();
  $('#pickImgs').onchange = (e) => { startImgs([...e.target.files]); e.target.value = ''; };
  $('#pickVid').onchange = (e) => { const f = e.target.files[0]; if (f) startVid(f); e.target.value = ''; };
  const dz = $('#dzImg');
  ['dragover', 'dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.toggle('drag', ev === 'dragover'); if (ev === 'drop') startImgs([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))); }));
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

/* ================================================== SETTINGS */
async function settingsPage() {
  const s = await api('/api/admin/settings'); state.settings = s;
  if (state.user.role !== 'admin') { pg.innerHTML = `<div class="panel"><h3>Read-only view</h3><p class="muted">Dealership settings are restricted to full administrators.</p></div>`; return; }
  const F = (key, label, ph, type = 'text') => `<div><label>${label}</label><input name="${key}" type="${type}" value="${esc(s[key] || '')}" placeholder="${esc(ph || '')}"></div>`;
  const T = (key, label) => `<div class="full"><label>${label}</label><textarea name="${key}">${esc(s[key] || '')}</textarea></div>`;
  pg.innerHTML = `
  <div class="pg-head"><div><span class="crumb">Configuration</span><h1>Dealership settings</h1></div></div>
  <form id="setForm"><div class="panel"><h3>Company profile</h3><div class="fgrid">
    ${F('company_name', 'Company name')}${F('tagline', 'Tagline')}${F('phone_main', 'Main telephone')}${F('phone_sales', 'Sales telephone')}
    ${F('whatsapp', 'WhatsApp number (digits incl. country code)')}${F('email_sales', 'Sales email')}
    ${F('email_support', 'Support email')}${F('currency', 'Default currency code')}
    ${T('address_primary', 'Primary showroom address')}${T('address_secondary', 'Secondary address')}${T('hours', 'Opening hours')}
  </div></div>
  <div class="panel"><h3>Trust & payment information (shown verbatim to customers)</h3><div class="fgrid">
    ${T('payment_info', 'Payment instructions')}${T('inspection_note', 'Inspection policy note')}${T('trade_license', 'Trade licence note')}
    ${F('social_instagram', 'Instagram URL')}${F('social_facebook', 'Facebook URL')}${F('social_youtube', 'YouTube URL')}${F('social_linkedin', 'LinkedIn URL')}
    <div><label style="display:flex;gap:10px;align-items:center;margin-top:10px"><input type="checkbox" name="dev_reset_tokens" value="1" ${s.dev_reset_tokens === '1' ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--gold)"> Expose password-reset codes in-app (development only — disable in production)</label></div>
  </div></div>
  <button class="btn btn-gold" type="submit">💾 Save all settings</button>
  <p class="muted" style="margin-top:10px">Settings persist in the database and apply instantly to the website, mobile app and admin dashboard.</p></form>`;
  $('#setForm').onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    d.dev_reset_tokens = d.dev_reset_tokens ? '1' : '0';
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
