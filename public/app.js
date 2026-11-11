'use strict';
/* ================================================================
   DM Motor Group — Website & Mobile App (PWA)
   Shares the same backend API as the admin dashboard.
================================================================ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const state = { user: null, favourites: new Set(), unread: 0, meta: null, settings: {}, wa: '' };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtMoney = (n, cur = 'USD') => `${cur === 'USD' ? '$' : esc(cur) + ' '}${Number(n || 0).toLocaleString('en-US')}`;
const priceText = (n, cur = 'USD') => (Number(n) > 0 ? fmtMoney(n, cur) : 'Price on request');
const fmtKm = (n) => Number(n || 0).toLocaleString('en-US') + ' km';
const title = (t) => { document.title = t; };

/* ---------------- API ---------------- */
const TOKEN_KEY = 'dm_token';
async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'X-Requested-With': 'DMFetch' };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (raw) { headers['Content-Type'] = raw.type; payload = raw.data; }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(path, body !== undefined || raw ? { method, headers, body: payload } : { method, headers });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && !path.startsWith('/api/auth')) { state.user = null; toast('Please sign in to continue.', true); route('/account'); throw new Error('401'); }
  if (!res.ok && data.error) throw new Error(data.error);
  return data;
}
function toast(msg, isErr = false) {
  const t = $('#toast'); t.textContent = msg; t.className = isErr ? 'error' : '';
  t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3800);
}

/* ---------------- compare tray ---------------- */
const CMP_KEY = 'dm_compare';
const cmpList = () => { try { return JSON.parse(localStorage.getItem(CMP_KEY) || '[]'); } catch { return []; } };
function cmpSave(list) { localStorage.setItem(CMP_KEY, JSON.stringify(list)); renderTray(); hdrCount(); }
function cmpToggle(v, ev) {
  if (ev) ev.preventDefault();
  let list = cmpList();
  if (list.find((x) => x.slug === v.slug)) { cmpSave(list.filter((x) => x.slug !== v.slug)); toast('Removed from comparison.'); return false; }
  if (list.length >= 4) { toast('You can compare up to four vehicles.', true); return false; }
  if (list.find((x) => x.slug !== v.slug && x.title === v.title)) { /* same-model ignore */ }
  list.push({ slug: v.slug, title: v.title, cover: v.cover });
  cmpSave(list); toast('Added to comparison (+ button bottom of screen).');
  return true;
}
function renderTray() {
  const list = cmpList(); const tray = $('#cmpTray');
  if (!list.length || window.innerWidth <= 860) { tray.hidden = true; return; } // mobile keeps bottom nav clean
  tray.hidden = false;
  $('#cmpItems').innerHTML = list.map((x) => `<span style="position:relative"><img src="${esc(x.cover)}" alt=""><button class="rm" data-slug="${esc(x.slug)}" title="Remove">✕</button></span>`).join('');
  $('#cmpItems').onclick = (e) => {
    const slug = e.target.dataset && e.target.dataset.slug;
    if (slug) cmpSave(cmpList().filter((x) => x.slug !== slug));
  };
  $('#cmpGo').href = '/compare';
}
window.addEventListener('resize', renderTray);

/* ---------------- header state ---------------- */
function hdrCount() {
  const f = $('#favCount'); const c = $('#cmpCount'); const n = $('#notifCount');
  if (f) { f.hidden = !state.favourites.size; f.textContent = state.favourites.size; }
  if (c) { c.hidden = !cmpList().length; c.textContent = cmpList().length; }
  if (n) { n.hidden = !state.unread; n.textContent = state.unread; }
  const ai = $('#accIcon'); if (ai) ai.textContent = state.user ? '●' : '○';
}
function markNav() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  $$('#nav a, #bottomNav a').forEach((a) => {
    const d = a.dataset.nav || a.dataset.bn || '';
    a.classList.toggle('on', d === path || (d !== '/' && path.startsWith(d)));
  });
}

/* ---------------- vehicle card ---------------- */
function vCard(v, opts = {}) {
  const fav = state.favourites.has(v.id);
  const inCmp = cmpList().some((x) => x.slug === v.slug);
  const drives = v.status === 'reserved' ? `<span class="flag res">Reserved</span>` : v.status === 'sold' ? `<span class="flag sold">Sold</span>` : '';
  return `<article class="vcard reveal" data-vid="${v.id}">
    <div class="ph">
      ${drives || ''}
      ${v.isFeatured ? '<span class="flags"><span class="flag gold">★ Featured</span></span>' : '<span class="flags"></span>'}
      <a class="cover" href="/vehicles/${esc(v.slug)}" aria-label="${esc(v.brand + ' ' + v.model)}"></a>
      <img src="${esc(v.cover || v.coverFull)}" alt="${esc(v.brand + ' ' + v.model + ' ' + v.year + ' for sale')}" loading="lazy" decoding="async" width="640" height="400">
      <div class="acts">
        <button class="mini-btn ${fav ? 'on' : ''}" data-act="fav" title="Save to favourites">${fav ? '♥' : '♡'}</button>
        <button class="mini-btn ${inCmp ? 'on2' : ''}" data-act="cmp" title="Compare">⇄</button>
      </div>
    </div>
    <div class="body">
      <h3><a href="/vehicles/${esc(v.slug)}">${esc(v.brand)} ${esc(v.model)} <span style="color:var(--ink-faint)">${v.year}</span></a></h3>
      <div class="vmeta"><span>${esc(v.bodyType || '')}</span><span>${esc(v.location || '')}</span></div>
      <div class="specs"><span>${v.year}</span><span>${fmtKm(v.mileage)}</span><span>${esc(v.fuel || '—')}</span><span>${esc(v.transmission || '—')}</span></div>
      <div class="price-row">
        <span class="price">${Number(v.price) > 0 ? `<span class="cur">${esc(v.currency)}</span>${Number(v.price).toLocaleString()}` : 'Price on request'}</span>
        ${v.isFeatured && opts.offer ? '<span class="offer-tag">Special offer</span>' : ''}
      </div>
      ${opts.offer ? `<div style="color:var(--ink-dim);font-size:12.5px">Offer ends when reserved — ask for the current drive-away price.</div>` : ''}
      <div class="foot">
        <a class="btn btn-ghost sm" href="/vehicles/${esc(v.slug)}">Details</a>
        <button class="btn btn-gold sm" data-act="enq" data-type="price">Request price</button>
      </div>
    </div>
  </article>`;
}
function bindCards(root) {
  root.querySelectorAll('.vcard').forEach((card) => card.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const id = +card.dataset.vid;
    const v = document.__vidCache[id];
    if (!v) return;
    if (act.dataset.act === 'fav') return toggleFav(v, act);
    if (act.dataset.act === 'cmp') return void cmpToggle({ slug: v.slug, title: `${v.brand} ${v.model} ${v.year}`, cover: v.cover }, e);
    if (act.dataset.act === 'enq') return enquiryModal({ vehicleId: id, vehicleTitle: `${v.brand} ${v.model} ${v.year}`, type: act.dataset.type || 'price' });
  }));
}
function cacheVehicles(list) { (document.__vidCache = document.__vidCache || {}); list.forEach((v) => (document.__vidCache[v.id] = v)); }

/* ---------------- favourites ---------------- */
async function toggleFav(v, btn) {
  if (!state.user) { toast('Create a free account to save favourites — browsing stays open to everyone.', true); route('/account'); return; }
  const on = state.favourites.has(v.id);
  try {
    if (on) { await api(`/api/favourites/${v.id}`, { method: 'DELETE' }); state.favourites.delete(v.id); }
    else { await api('/api/favourites', { method: 'POST', body: { vehicleId: v.id } }); state.favourites.add(v.id); toast('Saved to your favourites.'); }
    btn && btn.classList.toggle('on', !on);
    hdrCount();
  } catch (e) { toast(e.message, true); }
}

/* ---------------- enquiry modal ---------------- */
function enquiryModal({ vehicleId, vehicleTitle = 'General enquiry', type = 'question' } = {}) {
  if (type === 'inspection') return inspectionModal({ vehicleId, vehicleTitle });
  const types = [['price', 'Request selling price'], ['question', 'Ask a question'], ['pictures', 'Request more photos'], ['videos', 'Request more videos'], ['inspection', 'Book an inspection'], ['testdrive', 'Arrange a test drive'], ['delivery', 'Request delivery information'], ['purchase', 'Submit a purchase enquiry']];
  modal(`
    <h3>${esc(type === 'whatsapp' ? 'WhatsApp enquiry' : 'Vehicle enquiry')}</h3>
    <p class="sub">${esc(vehicleTitle)} — our team replies by email. We never ask for deposits by text or messaging apps.</p>
    <form id="enqForm">
      <div class="qs-grid" style="grid-template-columns:1fr">
        <div class="field"><label>Enquiry type</label><select name="type">${types.map(([k, l]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Full name *</label><input name="name" required minlength="2" value="${esc(state.user?.name || '')}"></div>
        <div class="field"><label>Email *</label><input name="email" type="email" required value="${esc(state.user?.email || '')}"></div>
        <div class="field full"><label>Your message *</label><textarea name="message" required>${esc(vehicleTitle !== 'General enquiry' ? `Please send me the full details and drive-away price for the ${vehicleTitle}.` : 'Hello DM Motor Group, I would like to enquire about…')}</textarea></div>
      </div>
      <!-- honeypot -->
      <input type="text" name="website" style="position:absolute;left:-9000px" tabindex="-1" autocomplete="off">
      <button class="btn btn-gold wide" type="submit">Send enquiry</button>
    </form>`);
  $('#enqForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('/api/enquiries', { method: 'POST', body: { vehicleId, type: f.get('type'), name: f.get('name'), email: f.get('email'), message: f.get('message'), website: f.get('website') } });
      $('#modal .modal-card').innerHTML = `<h3>Enquiry received ✓</h3><p class="sub">${esc(r.message || 'Thank you — your enquiry has been received.')}</p><button class="btn btn-gold wide" onclick="closeModal()">Close</button>`;
      if (state.user) api('/api/auth/me').then((m) => { state.unread = m.unread; hdrCount(); }).catch(() => {});
    } catch (err) { toast(err.message, true); }
  });
}

/* ---------------- book an inspection (email only, no phone) ---------------- */
function inspectionModal({ vehicleId, vehicleTitle = 'Vehicle of interest' } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const times = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00', '18:00', 'Flexible'];
  modal(`
    <h3>Book an inspection</h3>
    <p class="sub">${esc(vehicleTitle)} — request an appointment. Our team confirms every inspection by email. We never ask for a phone number.</p>
    <form id="inspForm">
      <div class="form-grid">
        <div class="field"><label>Full name *</label><input name="name" required minlength="2" value="${esc(state.user?.name || '')}"></div>
        <div class="field"><label>Email *</label><input name="email" type="email" required value="${esc(state.user?.email || '')}"></div>
        <div class="field full"><label>Vehicle of interest</label><input name="vehicle" value="${esc(vehicleTitle)}" readonly></div>
        <div class="field"><label>Preferred inspection date</label><input name="preferredDate" type="date" min="${today}"></div>
        <div class="field"><label>Preferred inspection time</label><select name="preferredTime">${times.map((t) => `<option value="${t}">${t === 'Flexible' ? 'Flexible / contact me' : t}</option>`).join('')}</select></div>
        <div class="field full"><label>Customer message</label><textarea name="message" placeholder="Tell us anything specific you would like checked, or any questions about the vehicle…"></textarea></div>
      </div>
      <input type="text" name="website" style="position:absolute;left:-9000px" tabindex="-1" autocomplete="off">
      <p style="color:var(--ink-faint);font-size:12.5px;margin:10px 0 14px">This is a request, not a confirmed appointment. You will receive an email confirming the date and time.</p>
      <button class="btn btn-gold wide" type="submit">Request inspection</button>
    </form>`);
  $('#inspForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await api('/api/inspections', { method: 'POST', body: {
        vehicleId,
        name: f.get('name'),
        email: f.get('email'),
        preferredDate: f.get('preferredDate'),
        preferredTime: f.get('preferredTime'),
        message: f.get('message'),
        website: f.get('website'),
      } });
      $('#modal .modal-card').innerHTML = `<h3>Inspection requested ✓</h3>
        <p class="sub">${esc(r.message || 'Your inspection request has been received. Our team will email you to confirm the appointment.')}</p>
        <p class="sub">A confirmation will be sent to <b>${esc(String(f.get('email') || ''))}</b>. No phone number is needed — everything happens by email.</p>
        <button class="btn btn-gold wide" onclick="closeModal()">Close</button>`;
    } catch (err) { btn.disabled = false; btn.textContent = 'Request inspection'; toast(err.message, true); }
  });
}
function modal(html) {
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = `<div class="backdrop" onclick="closeModal()"></div><div class="modal-card">${html}<button class="x" style="position:absolute;top:14px;right:14px" onclick="closeModal()">✕</button></div>`;
  document.body.style.overflow = 'hidden';
}
window.closeModal = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; document.body.style.overflow = ''; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeLightbox(); $('#searchOverlay').hidden = true; document.body.style.overflow = ''; } });

/* ---------------- custom video player (full-length, adaptive seek, full controls) ---------------- */
function videoPlayer(url, poster, { caption = '' } = {}) {
  const el = document.createElement('div');
  el.className = 'player paused';
  el.innerHTML = `
    <video playsinline preload="metadata" ${poster ? `poster="${esc(poster)}"` : ''} src="${esc(url)}"></video>
    <div class="voverlay"><button class="vbig" aria-label="Play">▶</button></div>
    <div class="vbar">
      <div class="seek"><div class="track"><div class="buf"></div><div class="prog"></div><div class="knob"></div></div></div>
      <div class="vrow">
        <button class="vbtn pv" aria-label="Play/Pause">▶</button>
        <button class="vbtn mu" aria-label="Mute/Unmute">🔊</button>
        <input class="vol" type="range" min="0" max="1" step="0.02" value="1" aria-label="Volume">
        <span class="vtime">00:00 / 00:00</span>
        <span style="flex:1"></span>
        <button class="vbtn fs" aria-label="Fullscreen">⛶</button>
      </div>
    </div>
    ${caption ? `<div style="position:absolute;top:10px;left:12px;z-index:4;color:#dfe3ea;font-size:12px;padding:5px 10px;background:rgba(8,9,11,.7);border-radius:8px">${esc(caption)}</div>` : ''}`;
  const v = el.querySelector('video');
  const [big, pv, seek, prog, knob, buf, tEl, mu, vol, fs] = ['.vbig', '.pv', '.seek', '.prog', '.knob', '.buf', '.vtime', '.mu', '.vol', '.fs'].map((s) => el.querySelector(s));
  const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const setUi = () => {
    el.classList.toggle('paused', v.paused);
    pv.textContent = v.paused ? '▶' : '❚❚'; big.textContent = v.paused ? '▶' : '';
    const d = v.duration || 0, c = v.currentTime || 0;
    prog.style.width = d ? (c / d * 100) + '%' : '0%';
    knob.style.left = d ? (c / d * 100) + '%' : '0%';
    tEl.textContent = `${fmt(c)} / ${fmt(d)}`;
    const tryBuf = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
    buf.style.width = d ? (tryBuf / d * 100) + '%' : '0%';
  };
  big.onclick = pv.onclick = () => { v.paused ? (v.muted = false, v.play()) : v.pause(); };
  v.onplay = v.onpause = v.ontimeupdate = v.onloadedmetadata = v.onprogress = setUi;
  v.onended = () => { el.classList.add('paused'); setUi(); };
  let scrub = (e) => {
    const r = seek.getBoundingClientRect(); const p = Math.min(Math.max((e.touches ? e.touches[0].clientX : e.clientX) - r.left, 0) / r.width, 1);
    if (v.duration) v.currentTime = v.duration * p;
  };
  seek.addEventListener('pointerdown', (e) => { scrub(e); seek.setPointerCapture(e.pointerId); });
  seek.addEventListener('pointermove', (e) => { if (e.buttons) scrub(e); });
  mu.onclick = () => { v.muted = !v.muted; mu.textContent = v.muted ? '🔇' : '🔊'; };
  vol.oninput = () => { v.volume = vol.value; v.muted = vol.value == 0; mu.textContent = v.muted ? '🔇' : '🔊'; };
  fs.onclick = () => { el.requestFullscreen ? el.requestFullscreen() : v.webkitEnterFullscreen && v.webkitEnterFullscreen(); };
  el.addEventListener('dblclick', () => fs.click());
  el.addEventListener('click', (e) => { if (!e.target.closest('.vbar') && !e.target.closest('.vbig')) big.click(); });
  return el;
}
function videoCard(video) {
  const thumb = video.thumbUrl || '';
  const ph = thumb ? `<img src="${esc(thumb)}" alt="${esc(video.title)} video thumbnail" loading="lazy">` : `<div class="vph">${esc(video.title)}</div>`;
  return `<div class="vidcard" data-vid="${video.id}" data-slug="${esc(video.slug)}">
    ${ph}<div class="play"><i>▶</i></div><div class="cap">${esc(video.caption || video.title)}</div>
  </div>`;
}
function playVideoModal(video) {
  modal(`<div style="margin:-28px -28px -0 0;background:#000;border-radius:20px 20px 0 0">${''}</div>
  <h3 style="margin-top:18px">${esc(video.title || 'Vehicle presentation')}</h3>
  <p class="sub">Full-length presentation — play with sound. ${video.slug ? `<a href="/vehicles/${esc(video.slug)}" style="color:var(--gold2)">View vehicle →</a>` : ''}</p>
  <div id="modalPlayer"></div>`);
  $('#modalPlayer').appendChild(videoPlayer(video.url, video.thumbUrl, {}));
}
function bindVidCards(root) {
  root.querySelectorAll('.vidcard').forEach((c) => c.onclick = () => {
    const id = +c.dataset.vid;
    const vid = document.__vidCache?.[id];
    if (vid) playVideoModal(vid);
  });
}
/* ---------------- lightbox gallery (zoom, swipe) ---------------- */
let lb = { items: [], i: 0, zoom: 1 };
function openLightbox(items, i = 0) {
  if (!items.length) return;
  lb = { items, i, zoom: 1 };
  const el = $('#lightbox'); el.hidden = false; document.body.style.overflow = 'hidden';
  renderLb();
}
function renderLb() {
  const el = $('#lightbox'); const it = lb.items[lb.i];
  if (!it) return closeLightbox();
  const isVid = it.url && /\.(mp4|webm|mov)$/i.test(it.url);
  el.innerHTML = `
    <div class="lb-top"><span>${it.caption ? esc(it.caption) : esc(it.type === 'video' ? 'Vehicle presentation' : 'Vehicle photograph')}</span><span style="color:var(--ink-faint)">${lb.i + 1} / ${lb.items.length}</span><button class="x" onclick="closeLightbox()">✕</button></div>
    <div class="lb-stage" id="lbStage">
      ${lb.items.length > 1 ? `<button class="lb-nav" style="left:14px" data-n="-1" aria-label="Previous">‹</button><button class="lb-nav" style="right:14px" data-n="1" aria-label="Next">›</button>` : ''}
      ${isVid ? '' : `<img id="lbImg" src="${esc(it.url)}" alt="${esc(it.caption || 'Vehicle photograph')}" loading="eager">`}
      ${isVid ? `<div style="width:min(100%,960px)"></div>` : ''}
    </div>
    ${isVid ? `<div class="lb-stage-player" style="padding:0 16px 8px;display:grid;place-items:center" id="lbVideo"></div><div class="lb-cap">${esc(it.caption || 'Full-length video')}</div>` : `<div class="lb-cap">${esc(it.caption || '')} · double-click or pinch to zoom, swipe to change</div>`}
    ${!isVid ? `<div class="lb-thumb">${lb.items.filter((x) => !/\.(mp4|webm|mov)$/i.test(x.url)).map((x, j) => `<img src="${esc(x.thumbUrl || x.url)}" data-j="${lb.items.indexOf(x)}" class="${lb.items[lb.i] === x ? 'on' : ''}">`).join('')}</div>` : ''}`;
  if (isVid) $('#lbVideo') && $('#lbVideo').appendChild(videoPlayer(it.url, it.thumbUrl, {}));
  const img = $('#lbImg');
  if (img) {
    let scale = 1, tx = 0, ty = 0; const apply = () => { img.style.transform = `scale(${scale}) translate(${tx}px,${ty}px)`; };
    img.onclick = (e) => { if (e.target.closest('.lb-nav')) return; };
    img.ondblclick = () => { scale = scale > 1 ? 1 : 2.4; tx = ty = 0; img.classList.toggle('zoom', scale > 1); apply(); };
    img.onwheel = (e) => { e.preventDefault(); scale = Math.min(5, Math.max(1, scale + (e.deltaY < 0 ? 0.3 : -0.3))); img.classList.toggle('zoom', scale > 1); if (scale === 1) { tx = ty = 0; } apply(); };
    let px = 0, py = 0;
    img.onpointerdown = (e) => { if (scale > 1) { px = e.clientX - tx; py = e.clientY - ty; img.setPointerCapture(e.pointerId); } };
    img.onpointermove = (e) => { if (e.buttons && scale > 1) { tx = e.clientX - px; ty = e.clientY - py; apply(); } };
    // swipe between photos
    let sx = null;
    el.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => { lb.i = (lb.i + Number(b.dataset.n) + lb.items.length) % lb.items.length; renderLb(); });
    const stage = $('#lbStage');
    stage.ontouchstart = (e) => { sx = e.touches[0].clientX; };
    stage.ontouchend = (e) => {
      if (sx === null || scale > 1) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 60) { lb.i = (lb.i + (dx < 0 ? 1 : -1) + lb.items.length) % lb.items.length; renderLb(); }
      sx = null;
    };
    $$('.lb-thumb img', el).forEach((t) => t.onclick = () => { lb.i = +t.dataset.j; renderLb(); });
  }
}
window.closeLightbox = () => { $('#lightbox').hidden = true; $('#lightbox').innerHTML = ''; document.body.style.overflow = ''; };

/* =================================================================
   ROUTES
================================================================= */
const routes = [
  { re: /^\/$/, view: viewHome, titlev: () => 'DM Motor Group — Premium International Automobile Dealership' },
  { re: /^\/vehicles$/, view: viewShowroom, title: 'Vehicle Showroom — DM Motor Group' },
  { re: /^\/vehicles\/([a-z0-9-]+)\/?$/, view: viewVehicle, title: 'Vehicle Details — DM Motor Group' },
  { re: /^\/videos\/?$/, view: viewVideos, title: 'Video Showroom — Full-length vehicle presentations | DM Motor Group' },
  { re: /^\/compare\/?$/, view: viewCompare, title: 'Compare Vehicles — DM Motor Group' },
  { re: /^\/account\/?$/, view: viewAccount, title: 'Customer Account — DM Motor Group' },
  { re: /^\/contact\/?$/, view: viewContact, title: 'Contact & Purchasing — DM Motor Group' },
];

async function navigate() { window.scrollTo({ top: 0 }); await route(location.pathname + location.search, true); }

async function route(path, initial = false) {
  const url = new URL(path, location.origin);
  const match = routes.find((r) => r.re.test(url.pathname));
  markNav();
  if (match) {
    match.re.test(url.pathname); const m = url.pathname.match(match.re);
    match.title && title(match.title);
    app.innerHTML = `<div class="page-head"><div><span class="crumb">Loading…</span></div></div><div class="skeleton" style="height:340px;border-radius:14px"></div>`;
    try { await match.view(m, url.searchParams); }
    catch (e) { console.error(e); app.innerHTML = `<div class="empty"><b>${esc(e.message || 'Something went wrong')}</b><a class="btn btn-gold" href="/vehicles">Back to showroom</a></div>`; }
  } else {
    title('Page not found — DM Motor Group');
    app.innerHTML = `<div class="empty" style="margin-top:40px"><b>Page not found</b>Check the address, or return to the showroom.<a class="btn btn-gold" href="/">Homepage</a></div>`;
  }
  hdrCount();
  if (!initial) history.pushState({}, '', path);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || !(href === '/' || href.startsWith('/')) || a.target) return;
  e.preventDefault(); route(href);
});
window.addEventListener('popstate', () => route(location.pathname + location.search));
window.route = route;

/* ---------------- section helpers ---------------- */
const secHead = (t, small, href, label = 'View all') =>
  `<div class="sec-head reveal"><h2>${t}${small ? `<small>${small}</small>` : ''}</h2>${href ? `<a href="${href}">${label} →</a>` : ''}</div>`;
function bindSectionVideos(root, list) {
  cacheVehiclesFromVideos(list);
  bindVidCards(root);
}
function cacheVehiclesFromVideos(videos) {
  document.__vidCache = document.__vidCache || {};
  videos.forEach((v) => { document.__vidCache[v.id] = { id: v.id, url: v.url, thumbUrl: v.thumbUrl, caption: v.caption, title: v.title, slug: v.slug }; });
}

/* ============================================================ HOME */
async function viewHome() {
  const data = await api('/api/home');
  state.settings = data.settings || {}; applySettings(data);
  const cats = (state.meta && state.meta.categories) || [];
  const catLabels = Object.fromEntries(cats.map((c) => [c.key, c.label]));
  const catList = (key) => (data.byCategory[key] || []);
  const rails = ['luxury', 'suv', 'sedan', 'sports', 'electric', 'truck', 'family'];
  const offers = (data.featured || []).filter((v) => v.status === 'published');

  app.innerHTML = `
  <section class="hero" id="hero">
    ${(data.banners.length ? data.banners : [{ title: 'DM Motor Group', subtitle: 'Premium international dealership', image: '/assets/hero.svg', link: '/vehicles' }]).map((b, i) => `
      <div class="hero-slide ${i === 0 ? 'on' : ''}"><img src="${esc(b.image)}" alt="${esc(b.title)}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}></div>`).join('')}
    <div class="hero-copy"><div class="wrap">
      <div class="hero-kicker">${esc(state.settings.tagline ? 'International dealership · Verified stock' : 'Premium dealership')}</div>
      <h1>${esc(data.banners[0]?.title || 'The DM Motor Group Showroom')}</h1>
      <p>${esc(data.banners[0]?.subtitle || 'Hand-selected vehicles · full histories · worldwide delivery')}</p>
      <div class="hero-cta">
        <a class="btn btn-gold" href="/vehicles">Browse the showroom</a>
        <a class="btn btn-ghost" href="/videos">▶ Watch vehicle presentations</a>
        <a class="btn btn-ghost" href="/contact">Contact us</a>
      </div>
    </div></div>
    <div class="hero-dots">${(data.banners.length || 1) > 1 ? (data.banners).map((_, i) => `<button data-i="${i}" class="${i === 0 ? 'on' : ''}"></button>`).join('') : ''}</div>
  </section>
  <div class="wrap">
    <div class="qsbar" id="qsbar"></div>
    <div class="trust">
      <div><b>${data.stats.published}</b><span>vehicles currently in stock</span></div>
      <div><b>${data.stats.brands}</b><span>manufacturer brands on site</span></div>
      <div><b>${data.stats.photos}</b><span>genuine listing photographs</span></div>
      <div><b>${data.stats.videos}</b><span>full-length video presentations</span></div>
    </div>
  </div>

  <div class="wrap"><section class="section" id="secFeatured">
    ${secHead('Featured vehicles', data.stats.published + ' in stock', '/vehicles?category=featured')}
    <div class="grid" id="gridFeatured">${data.featured.map((v) => vCard(v)).join('') || `<div class="empty"><b>No featured vehicles yet</b>The dealership pins its hand-picked stock here.</div>`}</div>
  </section></div>

  <div class="wrap"><section class="section" id="secOffers">
    ${secHead('Special offers & drive-away pricing', 'updated by the dealership', '/vehicles?sort=price_asc')}
    <div class="rail" id="railOffers">${offers.slice(0, 6).map((v) => vCard(v, { offer: true })).join('')}</div>
  </section></div>

  <div class="wrap"><section class="section" id="secLatest">
    ${secHead('Latest arrivals — recently uploaded', '', '/vehicles?sort=newest')}
    <div class="grid">${data.latest.map((v) => vCard(v)).join('')}</div>
  </section></div>

  ${data.videos.length ? '' : ''}
  <div class="wrap"><section class="section" id="secVideos">
    ${secHead('Video presentations', 'full-length · original quality', '/videos')}
    <div class="media-grid-vids rail" id="railVideos" style="display:flex;overflow-x:auto;display:flex">${data.videos.map(videoCard).join('')}</div>
  </section></div>

  ${rails.map((k) => catList(k).length ? `
  <div class="wrap"><section class="section">
    ${secHead(catLabels[k] || k, '', '/vehicles?category=' + k)}
    <div class="rail">${catList(k).map((v) => vCard(v)).join('')}</div>
  </section></div>` : '').join('')}

  <div class="wrap"><section class="section">
    ${secHead('What our customers say', 'collected by the dealership')}
    <div class="tcards">${data.testimonials.map((t) => `<div class="tcard reveal"><div class="stars">${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}</div><p>“${esc(t.text)}”</p><b>${esc(t.name)}</b><span>${esc(t.location)}</span></div>`).join('') || '<div class="empty" style="grid-column:1/-1"><b>No published testimonials yet</b>Reviews appear here only after the dealership adds verified customer feedback.</div>'}</div>
  </section></div>

  <div class="wrap"><section class="section" id="about">
    ${secHead('About DM Motor Group', 'who we are')}
    <div class="about-grid">
      <div>
        <p class="detail-desc" style="font-size:16px">DM Motor Group is an independently owned international motor company built on one principle: <b style="color:var(--gold2)">what you see is the vehicle you get.</b> Every listing carries genuine photography and full-length video presentations, complete specification and history information, and clear pricing. We supply inspection documentation where it exists and label every claim as dealership-supplied so you can judge for yourself.</p>
        <p class="detail-desc" style="margin-top:14px">Our showrooms serve private buyers, families and trade customers, with logistics partners for worldwide delivery and a purchasing desk that answers every enquiry within one business day.</p>
        <div class="note" style="margin-top:18px"><b>Buying safely.</b> ${esc(state.settings.payment_info || 'Payments run through escrow with the purchase agreement.')} We never ask for card details or deposits through messaging apps, and availability is confirmed by our team — not by enquiry volume.</div>
      </div>
      <div class="panel">
        <h3 style="margin-bottom:10px">Contact information</h3>
        <div class="info-rows">
          ${state.settings.phone_sales ? `<div><span>Sales telephone</span><a href="tel:${esc(state.settings.phone_sales.replace(/\s/g, ''))}">${esc(state.settings.phone_sales)}</a></div>` : ''}
          ${state.settings.phone_main ? `<div><span>Main line</span><a href="tel:${esc(state.settings.phone_main.replace(/\s/g, ''))}">${esc(state.settings.phone_main)}</a></div>` : ''}
          ${state.settings.email_sales ? `<div><span>Email</span><a href="mailto:${esc(state.settings.email_sales)}">${esc(state.settings.email_sales)}</a></div>` : ''}
          ${state.wa ? '<div><span>WhatsApp</span><a id="waHref" href="#" target="_blank" rel="noopener">Sales desk</a></div>' : ''}
          ${state.settings.address_primary ? `<div><span>Showroom</span><span>${esc(state.settings.address_primary)}</span></div>` : ''}
          ${state.settings.address_secondary ? `<div><span>Qatar office</span><span>${esc(state.settings.address_secondary)}</span></div>` : ''}
          ${state.settings.hours ? `<div><span>Opening hours</span><span>${esc(state.settings.hours)}</span></div>` : ''}
        </div>
        ${state.wa ? '<a id="waHref2" class="btn btn-wa wide" style="margin-top:16px" target="_blank" rel="noopener">✆ WhatsApp the dealership</a>' : ''}
      </div>
    </div>
  </section></div>`;

  heroCarousel('#hero');
  buildQuickSearch($('#qsbar'));
  cacheVehicles([...data.featured, ...data.latest, ...offers, ...rails.flatMap(catList)]);
  bindCards(app);
  bindSectionVideos(app, data.videos);
  bindWA();
}
function applySettings(data) {
  const s = state.settings;
  /* only expose WhatsApp when a complete number is configured — a country code
   * alone produces a dead wa.me link, so hide the feature entirely instead. */
  const waDigits = String(s.whatsapp || '').replace(/\D/g, '');
  state.wa = waDigits.length >= 8 && waDigits.length <= 15 ? waDigits : '';
  if (s.tagline) $('#ft-tagline').textContent = s.tagline;
  if (s.address_primary) $('#ft-address').textContent = s.address_primary;
  if (s.phone_main) { $('#ft-phone').textContent = s.phone_main; $('#ft-phone').href = 'tel:' + s.phone_main.replace(/\s/g, ''); $('#tb-phone').textContent = s.phone_main; $('#tb-phone').href = 'tel:' + s.phone_main.replace(/\s/g, ''); }
  if (s.hours) $('#tb-hours').textContent = s.hours;
  if (s.email_sales) $('#ft-email').textContent = s.email_sales;
  $('#ft-year').textContent = new Date().getFullYear();
  $('#foot-social').innerHTML = [s.social_instagram && ['Instagram', s.social_instagram], s.social_facebook && ['Facebook', s.social_facebook], s.social_youtube && ['YouTube', s.social_youtube], s.social_linkedin && ['LinkedIn', s.social_linkedin]].filter(Boolean).map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`).join('');
  $$('.wa-float').forEach((e) => e.remove());
  if (state.wa) {
    const wa = document.createElement('a'); wa.className = 'wa-float'; wa.target = '_blank'; wa.rel = 'noopener';
    wa.href = `https://wa.me/${esc(state.wa)}?text=${encodeURIComponent('Hello DM Motor Group, I would like to enquire about a vehicle.')}`;
    wa.innerHTML = '✆'; wa.title = 'WhatsApp the sales desk'; document.body.appendChild(wa);
  }
  bindWA();
  void data;
}
function bindWA() {
  const txt = encodeURIComponent('Hello DM Motor Group — I am browsing your showroom and would like to enquire about a vehicle.');
  $$('#waHref, #waHref2, #ft-wa, #btnWa').forEach((a) => {
    if (!a) return;
    if (!state.wa) { a.style.display = 'none'; a.removeAttribute('href'); return; }
    a.style.display = '';
    a.href = `https://wa.me/${esc(state.wa)}?text=${txt}`;
  });
}
function heroCarousel(sel) {
  const hero = $(sel); if (!hero) return;
  const slides = $$('.hero-slide', hero); const dots = $$('.hero-dots button', hero);
  if (slides.length < 2) return;
  let i = 0; const go = (n) => { i = (n + slides.length) % slides.length; slides.forEach((s, j) => s.classList.toggle('on', j === i)); dots.forEach((d, j) => d.classList.toggle('on', j === i)); };
  let timer = setInterval(() => go(i + 1), 5200);
  dots.forEach((d) => d.onclick = () => { go(+d.dataset.i); clearInterval(timer); timer = setInterval(() => go(i + 1), 5200); });
}
async function getMeta() {
  if (!state.meta) state.meta = await api('/api/meta');
  return state.meta;
}
function buildQuickSearch(host) {
  if (!host) return Promise.resolve(getMeta()).then(() => buildQuickSearch(host));
  const m = state.meta;
  const opt = (arr, ph) => `<option value="">${ph}</option>` + arr.map((x) => `<option>${esc(x)}</option>`).join('');
  host.innerHTML = `
    <input type="text" id="qsKw" placeholder="Search brand, model or VIN…">
    <select id="qsBrand" aria-label="Filter by brand"><option value="">All brands</option>${m.brands.map((b) => `<option>${esc(b)}</option>`).join('')}</select>
    <select id="qsBody" aria-label="Filter by body type"><option value="">All body types</option>${m.bodyTypes.map((b) => `<option>${esc(b)}</option>`).join('')}</select>
    <select id="qsPrice" aria-label="Filter by price"><option value="">Any price</option><option value="20000">Under 20,000</option><option value="40000">Under 40,000</option><option value="70000">Under 70,000</option><option value="120000">Under 120,000</option><option value="250000">Under 250,000</option></select>
    <button class="btn btn-gold" id="qsGo">Search</button>`;
  $('#qsGo').onclick = () => {
    const p = new URLSearchParams();
    if ($('#qsKw').value) p.set('q', $('#qsKw').value);
    if ($('#qsBrand').value) p.set('brand', $('#qsBrand').value);
    if ($('#qsBody').value) p.set('bodyType', $('#qsBody').value);
    if ($('#qsPrice').value) p.set('priceMax', $('#qsPrice').value);
    route('/vehicles?' + p.toString());
  };
  return Promise.resolve();
}

/* ============================================================ SHOWROOM */
async function viewShowroom(_, sp) {
  title('Vehicle Showroom — DM Motor Group');
  await getMeta();
  const cat = sp.get('category') || '';
  const chips = [{ key: '', label: 'All vehicles' }, ...(state.meta.categories || [])];
  const curFilters = Object.fromEntries(sp.entries());
  app.innerHTML = `
  <div class="page-head"><div>
    <span class="crumb"><a href="/">Home</a> → Showroom</span>
    <h1>${esc(cat ? ((state.meta.categories.find((c) => c.key === cat) || {}).label || cat) : 'Vehicle showroom')}<small style="font-family:var(--sans);font-size:14px;color:var(--ink-faint);margin-left:12px">every vehicle in current inventory</small></h1>
  </div></div>
  <div class="chips" id="catChips">${chips.map((c) => `<button class="chip ${cat === c.key ? 'on' : ''}" data-cat="${esc(c.key)}">${esc(c.label)}</button>`).join('')}</div>
  <div class="show-layout">
    <aside class="filters" id="filters"></aside>
    <div>
      <div class="toolbar">
        <span class="count" id="resCount">Loading vehicles…</span>
        <select id="sortSel">
          <option value="newest">Newest first</option><option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option><option value="year_desc">Year: newest</option>
          <option value="year_asc">Year: oldest</option><option value="mileage_asc">Lowest mileage</option>
        </select>
      </div>
      <div class="grid" id="resGrid" style="margin-bottom:14px"></div>
      <div style="text-align:center"><button class="btn btn-ghost" id="loadMore" hidden>Show more vehicles</button></div>
      <div class="pager" id="pager"></div>
    </div>
  </div>`;
  buildFilters($('#filters'), curFilters, state.meta);
  $('#sortSel').value = curFilters.sort || 'newest';
  $('#catChips').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; const p = new URLSearchParams(location.search); if (b.dataset.cat) p.set('category', b.dataset.cat); else p.delete('category'); p.delete('page'); route('/vehicles' + (p.toString() ? '?' + p : '')); };
  const grid = $('#resGrid'); let page = +(curFilters.page || 1); const per = 12;
  const qs = () => { const p = new URLSearchParams(sp); p.set('per', per); return p; };
  let total = 0, pages = 1;
  async function loadQuery(append, _q) {
    const res = await api('/api/vehicles?' + _q.toString());
    cacheVehicles(res.items);
    total = res.total; pages = res.pages;
    $('#resCount').textContent = `${total} vehicle${total === 1 ? '' : 's'} found${total ? ' · showing ' + ((res.page - 1) * res.per + 1) + '–' + Math.min(res.page * res.per, total) : ''}`;
    $('#sortSel').value = _q.get('sort') || 'newest';
    if (!append) grid.innerHTML = '';
    grid.insertAdjacentHTML('beforeend', res.items.map((v) => vCard(v, { offer: curFilters.sort === 'price_asc' })).join('') || `<div class="empty" style="grid-column:1/-1"><b>No vehicles match this search</b>Try widening your filters — or tell us exactly what you are looking for and we can source it.<a class="btn btn-gold" href="/contact">Request a vehicle search</a></div>`);
    bindCards(grid);
    $('#loadMore').hidden = !(res.page < res.pages);
    $('#loadMore').textContent = `Show more vehicles (${total - res.page * res.per > 0 ? (total - res.page * res.per) + ' more' : ''})`;
    return res;
  }
  await loadQuery(false, qs());
  $('#loadMore').onclick = () => { const p = qs(); p.set('page', page + 1); page++; loadQuery(true, p); };
  $('#sortSel').onchange = () => { const p = new URLSearchParams(sp); p.set('sort', $('#sortSel').value); p.delete('page'); p.delete('per'); route('/vehicles?' + p); };
}
function buildFilters(host, cur, m) {
  const opt = (arr, ph, sel) => `<option value="">${ph}</option>` + arr.map((x) => `<option ${sel === x ? 'selected' : ''}>${esc(x)}</option>`).join('');
  host.innerHTML = `
    <button class="btn btn-ghost wide sm" id="fApply" style="order:9">Apply filters</button>
    <button class="btn btn-danger wide sm" id="fClear" style="order:10;border:1px solid var(--line2)">Clear all</button>
    <h4>Keyword</h4><input type="text" name="q" value="${esc(cur.q || '')}" placeholder="Brand, model, VIN…">
    <h4>Brand</h4><select name="brand">${opt(m.brands, 'Any brand', cur.brand)}</select>
    <h4>Model</h4><select name="model">${opt(m.models.filter((x) => !cur.brand || x.brand === cur.brand).map((x) => x.model), 'Any model', cur.model)}</select>
    <h4>Price</h4><div class="row2"><input type="number" name="priceMin" placeholder="Min" value="${esc(cur.priceMin || '')}"><input type="number" name="priceMax" placeholder="Max" value="${esc(cur.priceMax || '')}"></div>
    <h4>Year</h4><div class="row2"><input type="number" name="yearMin" placeholder="From" value="${esc(cur.yearMin || '')}"><input type="number" name="yearMax" placeholder="To" value="${esc(cur.yearMax || '')}"></div>
    <h4>Max mileage (km)</h4><input type="number" name="mileageMax" placeholder="e.g. 50000" value="${esc(cur.mileageMax || '')}">
    <h4>Body type</h4><select name="bodyType">${opt(m.bodyTypes, 'Any body type', cur.bodyType)}</select>
    <h4>Transmission</h4><select name="transmission">${opt(m.transmissions, 'Any transmission', cur.transmission)}</select>
    <h4>Fuel</h4><select name="fuel">${opt(m.fuels, 'Any fuel', cur.fuel)}</select>
    <h4>Condition</h4><select name="condition">${opt(['New', 'Used — as new', 'Used'], 'Any condition', cur.condition)}</select>
    <h4>Location</h4><select name="location">${opt(m.locations, 'Any location', cur.location)}</select>`;
  const apply = () => {
    const p = new URLSearchParams();
    $$('input,select', host).forEach((el) => { if (el.name && el.value && el.name !== 'model2') p.set(el.name, el.value); });
    if (cur.category && !p.get('category')) p.set('category', cur.category);
    route('/vehicles?' + p.toString());
  };
  $('#fApply', host).onclick = apply;
  $('#fClear', host).onclick = () => route('/vehicles' + (cur.category ? '?category=' + cur.category : ''));
  $('input[name=q]', host).addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
}

/* ============================================================ VEHICLE DETAIL */
async function viewVehicle(m) {
  return (async () => {
    const v = await api(`/api/vehicles/${m[1]}`);
    title(`${v.brand} ${v.model} ${v.year} — DM Motor Group`);
    metaDesc(v.description ? v.description.slice(0, 180) : `View the ${v.brand} ${v.model} ${v.year} at DM Motor Group.`);
    const images = (v.media || []).filter((x) => x.type === 'image');
    const videos = (v.media || []).filter((x) => x.type === 'video');
    const inCmp = cmpList().some((x) => x.slug === v.slug);
    const avail = v.status === 'published' ? ['Available now', ''] : v.status === 'reserved' ? ['Reserved — deposit under agreement', 'r'] : ['Sold — archived listing', 's'];
    app.innerHTML = `
    <div class="crumb"><a href="/">Home</a> → <a href="/vehicles">Showroom</a> → ${esc(v.brand)} ${esc(v.model)} ${v.year}</div>
    <div class="detail-top">
      <div class="gallery" id="gallery">
        <div class="gallery-main" id="galleryMain">
          <img id="galleryImg" src="${esc((images[0] || {}).url || '')}" alt="${esc(v.brand + ' ' + v.model + ' ' + v.year + ' ' + ((images[0] || {}).caption || ''))}" width="1600" height="1000" fetchpriority="high">
          <span class="gcount" id="gcount">1 / ${images.length + videos.length}${videos.length ? ' · includes ' + videos.length + ' video(s)' : ''}</span>
          ${images.length + videos.length > 1 ? `<button class="lb-nav" style="left:12px" data-n="-1">‹</button><button class="lb-nav" style="right:12px" data-n="1">›</button>` : ''}
        </div>
        <div class="gthumbs" id="gthumbs">
          ${[...images.map((x) => ({ ...x })), ...videos.map((x) => ({ ...x }))].map((x, i) => `
            <button class="${i === 0 ? 'on' : ''}" data-i="${i}" title="${esc(x.caption)}">
              <img src="${esc(x.thumbUrl || x.url)}" alt="" loading="lazy"><span class="tag">${esc(x.type === 'video' ? '▶ video' : (x.category || ''))}</span>
            </button>`).join('')}
        </div>
      </div>
      <div class="detail-info">
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <span class="avail ${avail[1]}"><i></i>${avail[0]}</span>
          ${v.isFeatured ? '<span class="flag gold">★ Featured</span>' : ''}
          ${v.inspectionStatus !== 'none' ? `<span class="badge-verified">${esc(v.inspectionStatus === 'third_party_inspected' ? 'Third-party inspected' : 'Dealership inspected')}</span>` : ''}
        </div>
        <h1>${esc(v.brand)} ${esc(v.model)} <span style="color:var(--ink-faint)">${v.year}</span></h1>
        <div class="price-line">
          <span class="price">${Number(v.price) > 0 ? `<span class="cur">${esc(v.currency)}</span>${Number(v.price).toLocaleString()}` : 'Price on request'}</span>
          <span style="color:var(--ink-faint);font-size:13px">Transparent pricing · the final drive-away figure is confirmed in writing before any payment.</span>
        </div>
        <div class="cta-stack">
          ${v.status !== 'sold' ? `
            <button class="btn btn-gold wide" id="btnEnqMain">Request information & price</button>
            <a class="btn btn-wa wide" id="btnWa" target="_blank" rel="noopener">✆ WhatsApp about this vehicle</a>
            <div class="cta-2">
              <button class="btn btn-ghost" data-enq="inspection">Book an inspection</button>
              <button class="btn btn-ghost" data-enq="testdrive">Request a viewing / test drive</button>
              <button class="btn btn-ghost" data-enq="purchase">Submit a purchase enquiry</button>
              <button class="btn btn-ghost" data-enq="delivery">Request delivery information</button>
            </div>` : `
            <div class="note"><b>This vehicle has been sold.</b> Archived listings stay on the site for transparency of our sales history. Ask us about similar stock${v.similar.length ? ' — see the selection below' : ''}.</div>
            <a class="btn btn-gold wide" href="/contact">Contact the dealership</a>`}
          <div class="cta-2">
            <button class="btn btn-ghost" id="btnFavD">${state.favourites.has(v.id) ? '♥ Saved to favourites' : '♡ Save to favourites'}</button>
            <button class="btn btn-ghost" id="btnCmpD">${inCmp ? '✓ In comparison' : '⇄ Compare this vehicle'}</button>
            <button class="btn btn-ghost" id="btnShare">↗ Share vehicle</button>
            <button class="btn btn-ghost" data-enq="pictures">Request more photos & videos</button>
          </div>
        </div>
        <div class="keyfacts">
          <div><span>Year</span><b>${v.year}</b></div><div><span>Mileage</span><b>${fmtKm(v.mileage)}</b></div>
          <div><span>Engine</span><b>${esc(v.engine || '—')}</b></div><div><span>Transmission</span><b>${esc(v.transmission || '—')}</b></div>
          <div><span>Fuel</span><b>${esc(v.fuel || '—')}</b></div><div><span>Body</span><b>${esc(v.bodyType || '—')}</b></div>
          <div><span>Condition</span><b>${esc(v.condition || '—')}</b></div><div><span>Location</span><b>${esc(v.location || '—')}</b></div>
        </div>
      </div>
    </div>

    <section class="section">${secHead('Full specifications', 'exactly as registered by the dealership')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:34px" class="spec-2col">
        <div><table class="spec-table">${
          [
            ['Manufacturer', v.brand], ['Model', v.model], ['Year', v.year], ['Selling price', priceText(v.price, v.currency)],
            ['Mileage', fmtKm(v.mileage)], ['Engine', v.engine], ['Transmission', v.transmission], ['Fuel type', v.fuel],
            ['Body type', v.bodyType], ['Exterior colour', v.exteriorColor], ['Interior colour', v.interiorColor],
            ['VIN', v.vin], ['Condition', v.condition], ['Registration', v.registration], ['Location', v.location],
          ].filter(([, x]) => x != null && x !== '').map(([k, x]) => `<tr><td>${k}</td><td>${esc(x)}</td></tr>`).join('')
        }</table></div>
        <div>
          ${v.vin ? `<div class="note" style="margin-top:0"><b>VIN ${esc(v.vin)}</b> <button class="btn btn-ghost sm" id="copyVin" style="border:0;padding:2px 8px">copy</button><br>Copy the VIN and check it with any official history provider — our documentation matches it.</div>` : ''}
          <table class="spec-table">
            <tr><td>Ownership</td><td>${esc(v.ownershipInfo || 'Available on request')}</td></tr>
            <tr><td>Inspection</td><td>${esc(v.inspectionStatus === 'none' ? 'Report available on request' : (v.inspectionStatus === 'third_party_inspected' ? 'Third-party inspected' : 'Dealership 150-point inspected'))}</td></tr>
            ${(v.inspectionReport ? `<tr><td>Inspection notes</td><td>${esc(v.inspectionReport)}</td></tr>` : '')}
          </table>
        </div>
      </div>
    </section>

    <section class="section">${secHead('Vehicle description')}
      <p class="detail-desc">${esc(v.description)}</p>
      <div class="note"><b>Information notice.</b> Specifications, history and pricing are supplied by DM Motor Group and kept in our registration files. Verified information (VIN checks, third-party inspection) is labelled as verified above; all other figures come from the dealership record.</div>
    </section>

    ${v.features?.length || v.safetyFeatures?.length ? `
    <section class="section">${secHead('Equipment', 'features & safety')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:34px" class="spec-2col">
        <div><h4 style="font-family:var(--sans);font-size:13px;letter-spacing:1px;text-transform:uppercase;color:var(--gold2);margin-bottom:10px">Comfort & features</h4><ul class="feat-cols">${v.features.map((f) => `<li>${esc(f)}</li>`).join('') || ''}</ul></div>
        <div><h4 style="font-family:var(--sans);font-size:13px;letter-spacing:1px;text-transform:uppercase;color:var(--gold2);margin-bottom:10px">Safety features</h4><ul class="feat-cols">${v.safetyFeatures.map((f) => `<li>${esc(f)}</li>`).join('') || ''}</ul></div>
      </div>
    </section>` : ''}

    ${videos.length ? `<section class="section" id="vehicleVideos">${secHead('Video presentations', 'full-length · watch with sound')}
      <div class="media-grid-vids">${videos.map((vid) => `
        <div style="display:flex;flex-direction:column;gap:10px">
          <div class="vidbox" data-vid-id="${vid.id}" data-vid-url="${esc(vid.url)}" data-vid-thumb="${esc(vid.thumbUrl || '')}" data-vid-cap="${esc(vid.caption)}" style="aspect-ratio:16/9"></div>
        </div>`).join('')}</div>
    </section>` : ''}

    ${v.similar?.length ? `<section class="section">${secHead('Similar vehicles you may like', '', '/vehicles?category=' + v.category)}
      <div class="grid">${v.similar.map((x) => vCard(x)).join('')}</div></section>` : ''}`;

    /* gallery logic */
    cacheVehicles(v.similar || []);
    const all = [...images.map((x) => ({ ...x })), ...videos.map((x) => ({ ...x }))];
    let gi = 0;
    const showImg = (i) => {
      const it = all[i]; gi = (i + all.length) % all.length; const vi = gi % all.length;
      const im = $('#galleryImg');
      if (it.type === 'video') { $('#galleryMain .vidbox')?.remove(); im.style.display = 'none'; const box = document.createElement('div'); box.className = 'vidbox'; box.style.cssText = 'position:absolute;inset:0'; $('#galleryMain').insertBefore(box, im); box.appendChild(videoPlayer(it.url, it.thumbUrl || '', {})); }
      else { $('#galleryMain .vidbox')?.remove(); im.style.display = ''; im.src = it.url; }
      $$('#gthumbs button').forEach((b, j) => b.classList.toggle('on', j === gi));
      $('#gcount').textContent = `${gi + 1} / ${all.length}${videos.length ? ' · includes ' + videos.length + ' video(s)' : ''}`;
    };
    cacheMediaGalleries(all);
    bindCards(app);
    $('#gthumbs').onclick = (e) => { const b = e.target.closest('button'); if (b) showImg(+b.dataset.i); };
    $$('#galleryMain .lb-nav').forEach((b) => b.onclick = () => showImg(gi + Number(b.dataset.n)));
    $('#galleryMain').onclick = (e) => {
      if (e.target.closest('.vidbox') || e.target.closest('.lb-nav')) return;
      const it = all[gi];
      if (it.type === 'video') return;
      openLightbox(all.filter((x) => x.type === 'image').map((x) => ({ ...x })), all.filter((x) => x.type === 'image').indexOf(it));
    };
    /* CTAs */
    $$('#app [data-enq]').forEach((b) => b.onclick = () => enquiryModal({ vehicleId: v.id, vehicleTitle: `${v.brand} ${v.model} ${v.year}`, type: b.dataset.enq }));
    $('#btnEnqMain') && ($('#btnEnqMain').onclick = () => enquiryModal({ vehicleId: v.id, vehicleTitle: `${v.brand} ${v.model} ${v.year}`, type: 'question' }));
    const waTxt = encodeURIComponent(`Hello DM Motor Group — I am interested in the ${v.brand} ${v.model} ${v.year} (${location.origin}/vehicles/${v.slug}). Please send me the details.`);
    $('#btnWa') && ($('#btnWa').href = `https://wa.me/${esc(state.wa)}?text=${waTxt}`);
    $('#btnFavD').onclick = async () => { await toggleFav(v); $('#btnFavD').textContent = state.favourites.has(v.id) ? '♥ Saved to favourites' : '♡ Save to favourites'; };
    $('#btnCmpD').onclick = (e) => { const add = cmpToggle({ slug: v.slug, title: `${v.brand} ${v.model} ${v.year}`, cover: v.cover }, e); $('#btnCmpD').textContent = cmpList().some((x) => x.slug === v.slug) ? '✓ In comparison' : '⇄ Compare this vehicle'; };
    $('#btnShare').onclick = async () => {
      const url = location.origin + '/vehicles/' + v.slug, text = `${v.brand} ${v.model} ${v.year} — ${priceText(v.price, v.currency)} at DM Motor Group`;
      try { if (navigator.share) await navigator.share({ title: text, text, url }); else { await navigator.clipboard.writeText(url); toast('Link copied — share it anywhere.'); } } catch {}
    };
    $('#copyVin') && ($('#copyVin').onclick = async () => { await navigator.clipboard.writeText(v.vin); toast('VIN copied.'); });
    /* rendered video boxes inside detail */
    $$('#app .vidbox[data-vid-id]').forEach((box) => {
      box.appendChild(videoPlayer(box.dataset.vidUrl, box.dataset.vidThumb, { caption: box.dataset.vidCap }));
      box.style.cssText = 'position:relative;border-radius:14px;overflow:hidden';
    });
    $$('.spec-2col').forEach((el) => {
      if (window.innerWidth < 760) { el.style.gridTemplateColumns = '1fr'; el.style.gap = '18px'; }
    });
  })();
}
function cacheMediaGalleries(all) {
  document.__vidCache = document.__vidCache || {};
  all.filter((x) => x.type === 'video').forEach((x, i) => (document.__vidCache['detail-video-' + i] = x));
}
function metaDesc(d) { $$('meta[name=description]').forEach((m) => (m.content = d)); }

/* ============================================================ VIDEOS PAGE */
async function viewVideos() {
  title('Video Showroom — Full-length vehicle presentations | DM Motor Group');
  const res = await api('/api/videos?per=18');
  cacheVehiclesFromVideos(res.items);
  app.innerHTML = `
  <div class="page-head"><div>
    <span class="crumb"><a href="/">Home</a> → Videos</span>
    <h1>Video presentations</h1>
    <p style="color:var(--ink-dim);max-width:70ch">Every film here is the complete, original presentation as recorded by our team — never split into short clips and never cropped to hide part of the vehicle. Press play to watch in full with sound, and use ⛶ for full-screen. Portrait and landscape recordings supported.</p>
  </div></div>
  <div class="vidpage-grid">${res.items.map(videoCard).join('') || '<div class="empty" style="grid-column:1/-1"><b>No videos published yet</b>Videos uploaded through the admin dashboard appear here and on vehicle pages automatically.</div>'}</div>
  <div class="pager" style="margin-top:26px">${res.pages > 1 ? Array.from({ length: res.pages }, (_, i) => `<button ${i + 1 === res.page ? 'class="on"' : ''} data-p="${i + 1}">${i + 1}</button>`).join('') : ''}</div>`;
  const grid = $('.vidpage-grid');
  $$('#app .pager button').forEach((b) => b.onclick = async () => {
    const r = await api(`/api/videos?per=18&page=${b.dataset.p}`);
    cacheVehiclesFromVideos(r.items);
    grid.innerHTML = r.items.map(videoCard).join('');
    bindVidCards(grid); /* fresh cards need their click handlers re-attached */
    window.scrollTo({ top: 0 });
  });
  bindVidCards(grid);
}

/* ============================================================ COMPARE */
async function viewCompare() {
  title('Compare Vehicles — DM Motor Group');
  const list = cmpList();
  const items = await Promise.all(list.map(async (c) => { try { return await api(`/api/vehicles/${c.slug}`); } catch { return null; } }));
  const vs = items.filter(Boolean);
  app.innerHTML = `
  <div class="page-head"><div>
    <span class="crumb"><a href="/">Home</a> → Compare</span>
    <h1>Compare vehicles <small style="font-family:var(--sans);font-size:14px;color:var(--ink-faint);margin-left:12px">2–4 side by side</small></h1>
  </div></div>
  ${vs.length ? cmpTable(vs) : `<div class="empty"><b>Nothing to compare yet</b>Open any vehicle in the showroom and press ⇄ — collect two to four cars, then compare prices, mileage, engines, transmissions and equipment line by line.<a class="btn btn-gold" href="/vehicles">Browse the showroom</a></div>`}`;
  $$('#app .rm-cmp').forEach((b) => b.onclick = () => { cmpSave(cmpList().filter((x) => x.slug !== b.dataset.slug)); viewCompare(); });
}
function cmpTable(vs) {
  const row = (label, get, cls = '') => `<tr><th>${label}</th>${vs.map((v) => `<td class="${cls}">${get(v)}</td>`).join('')}</tr>`;
  const has = (v, f) => v.features?.includes(f) ? '<span class="feat-check">✓</span>' : '<span class="feat-none">—</span>';
  return `<div class="cmp-table-wrap"><table class="cmp">
    <thead><tr><th></th>${vs.map((v) => `<th><div class="cmp-hero"><img src="${esc(v.cover)}" alt=""><b><a href="/vehicles/${esc(v.slug)}" style="color:var(--gold2)">${esc(v.brand)} ${esc(v.model)}</a></b><span style="color:var(--ink-faint);font-size:13px">${v.year} · ${esc(v.bodyType || '')}</span><button class="btn btn-ghost sm rm-cmp" data-slug="${esc(v.slug)}">Remove</button></div></th>`).join('')}</tr></thead>
    <tbody>
      ${row('Selling price', (v) => `<b class="price">${priceText(v.price, v.currency)}</b>`)}
      ${row('Year', (v) => v.year)}
      ${row('Mileage', (v) => fmtKm(v.mileage))}
      ${row('Engine', (v) => esc(v.engine || '—'))}
      ${row('Transmission', (v) => esc(v.transmission || '—'))}
      ${row('Fuel type', (v) => esc(v.fuel || '—'))}
      ${row('Body type', (v) => esc(v.bodyType || '—'))}
      ${row('Condition', (v) => esc(v.condition || '—'))}
      ${row('Exterior colour', (v) => esc(v.exteriorColor || '—'))}
      ${row('Interior colour', (v) => esc(v.interiorColor || '—'))}
      ${row('Location', (v) => esc(v.location || '—'))}
      ${row('Availability', (v) => v.status === 'published' ? '<span class="row-ok">Available</span>' : esc(v.status))}
      ${row('Inspection', (v) => v.inspectionStatus === 'none' ? 'On request' : esc(v.inspectionStatus === 'third_party_inspected' ? 'Third-party inspection' : 'Dealership 150-point'))}
      ${['Panoramic glass roof', 'Massage & ventilation seats', 'Sport exhaust', '360° camera system', 'Wireless Apple CarPlay & Android Auto', 'Adaptive cruise', 'DC fast charging', 'Power tailgate'].map((f) => `<tr><th>${f}</th>${vs.map((v) => `<td>${has(v, f)}</td>`).join('')}</tr>`).join('')}
      ${row('Photos & videos', (v) => `${v.photoCount} photos · ${v.videoCount} videos`)}
      ${row('Full listing', (v) => `<a class="btn btn-ghost sm" href="/vehicles/${esc(v.slug)}">Open vehicle</a>`)}
    </tbody></table></div>
    <p class="note">All equipment lists are dealership-supplied. Ask our team to confirm any specific feature on your chosen vehicle before purchase — we answer in writing.</p>`;
}

/* ============================================================ ACCOUNT */
async function viewAccount(_m, sp) {
  title('Customer Account — DM Motor Group');
  const tab = sp.get('tab') || (state.user ? 'overview' : 'signin');
  if (!state.user) return renderAuthPage(tab);
  const tabs = [['overview', 'My account', ''], ['favourites', 'Favourites', state.favourites.size], ['enquiries', 'Enquiry history', ''], ['notifications', 'Notifications', state.unread], ['profile', 'Profile & security', '']];
  let body = '';
  if (tab === 'overview') body = `
    <div class="panel"><h3 style="margin-bottom:14px">Welcome back, ${esc(state.user.name.split(' ')[0])}</h3>
    <p class="detail-desc">From here you can save favourites, compare vehicles, follow your enquiries and receive dealership responses. You never need an account to browse the showroom.</p>
    <div class="trust" style="margin-bottom:0">
      <div><b>${state.favourites.size}</b><span>saved favourites</span></div>
      <div><b>${cmpList().length}</b><span>in comparison</span></div>
      <div><b>${state.enqCount ?? '—'}</b><span>enquiries submitted</span></div>
      <div><b>${state.unread}</b><span>unread messages</span></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px">
      <a class="btn btn-gold" href="/vehicles">Browse the showroom</a>
      <a class="btn btn-ghost" href="/account?tab=favourites">View my favourites</a>
    </div></div>`;
  if (tab === 'favourites') {
    const favs = await api('/api/favourites');
    body = `<div class="grid">${favs.map((v) => vCard(v)).join('') || `<div class="empty" style="grid-column:1/-1"><b>No favourites yet</b>Press ♡ on any vehicle to save it here.<a class="btn btn-gold" href="/vehicles">Browse the showroom</a></div>`}</div>`;
    cacheVehicles(favs); setTimeout(() => bindCards(app));
  }
  if (tab === 'enquiries') {
    const enq = await api('/api/my/enquiries');
    state.enqCount = enq.length;
    body = enq.map((e) => `<div class="enq-row"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><b>${esc(e.vehicleTitle)}</b><span class="status-pill ${esc(e.status)}">${esc(e.status)}</span></div>
      <p style="color:var(--ink-dim);margin-top:8px;font-size:14px">${esc(e.message)}</p>
      <div style="color:var(--ink-faint);font-size:12.5px;margin-top:8px">${esc(e.type)} · submitted ${esc(e.created_at)}${e.admin_notes ? ` · dealership response: ${esc(e.admin_notes)}` : ''}</div></div>`).join('') ||
      `<div class="empty"><b>No enquiries yet</b>Use “Request information” on any vehicle — every message lands here and at the dealership desk.</div>`;
  }
  if (tab === 'notifications') {
    const n = await api('/api/notifications');
    state.unread = n.unread; hdrCount();
    body = `${n.items.length ? '<button class="btn btn-ghost sm" id="readAll" style="margin-bottom:14px">Mark all as read</button>' : ''}${n.items.map((x) => `
      <div class="notif ${x.is_read ? '' : 'unread'}"><i>✦</i><div><b>${esc(x.title)}</b><p>${esc(x.body)}</p>
      <span style="color:var(--ink-faint);font-size:12px">${esc(x.created_at)}${x.link && x.link !== '/' ? ` · <a href="${esc(x.link)}" style="color:var(--gold2)">open vehicle →</a>` : ''}</span></div></div>`).join('') || '<div class="empty"><b>No notifications</b>Dealership responses will arrive here.</div>'}`;
  }
  if (tab === 'profile') body = `
    <div class="panel"><h3 style="margin-bottom:16px">Personal information</h3>
    <form id="profForm" class="form-grid">
      <div class="field"><label>Full name</label><input name="name" value="${esc(state.user.name)}" required></div>
      <div class="field full"><label>Email (login)</label><input value="${esc(state.user.email)}" disabled style="opacity:.6"></div>
      <div class="field"><label>Current password</label><input name="currentPassword" type="password" placeholder="Required to change password"></div>
      <div class="field"><label>New password</label><input name="password" type="password" placeholder="min 8 characters"></div>
      <div class="field full"><button class="btn btn-gold" type="submit">Save changes</button></div>
    </form></div>`;
  app.innerHTML = `
  <div class="page-head"><div><span class="crumb"><a href="/">Home</a> → Account</span><h1>My account</h1></div></div>
  <div class="account-layout">
    <aside class="acc-nav">${tabs.map(([k, l, c]) => `<a href="/account?tab=${k}" class="${tab === k ? 'on' : ''}">${c ? '♥ ' : ''}${l}${c ? `<span class="cnt">${c}</span>` : ''}</a>`).join('')}<button id="btnLogout">Sign out</button></aside>
    <div>${body}</div>
  </div>`;
  $('#btnLogout').onclick = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch {} localStorage.removeItem(TOKEN_KEY); state.user = null; state.favourites.clear(); state.unread = 0; hdrCount(); toast('Signed out.'); route('/account'); };
  $('#profForm') && ($('#profForm').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try { await api('/api/auth/profile', { method: 'PUT', body: f }); toast('Profile updated.'); state.user.name = f.name || state.user.name; route('/account?tab=profile'); }
    catch (err) { toast(err.message, true); }
  });
  $('#readAll') && ($('#readAll').onclick = async () => { await api('/api/notifications/read', { method: 'POST', body: { all: true } }); route('/account?tab=notifications'); });
}
function renderAuthPage(tab) {
  app.innerHTML = `
  <div class="page-head"><div><span class="crumb"><a href="/">Home</a> → Account</span><h1>Customer account</h1></div></div>
  <div style="display:grid;grid-template-columns:minmax(0,420px) minmax(0,1fr);gap:34px;align-items:start" class="auth-2col">
    <div class="panel">
      <div class="chips" style="margin-bottom:18px">${[['signin', 'Sign in'], ['register', 'Create account']].map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
      <form id="authForm" class="form-grid" style="margin-top:6px">
        ${tab === 'register' ? `
        <div class="field full"><label>Full name</label><input name="name" required minlength="2" placeholder="e.g. Sara Al Maktoum"></div>
        <div class="field full"><label>Email</label><input name="email" type="email" required placeholder="you@example.com"></div>
        <div class="field full"><label>Password (min 8 characters)</label><input name="password" type="password" required minlength="8"></div>
        <div class="field full"><button class="btn btn-gold wide" type="submit">Create my account</button>
        <p style="color:var(--ink-faint);font-size:12.5px;margin-top:8px">Accounts are for favourites, enquiries, inspection requests and notifications. Browsing and searching stay open to everyone.</p></div>` : `
        <div class="field full"><label>Email</label><input name="email" type="email" required></div>
        <div class="field full"><label>Password</label><input name="password" type="password" required></div>
        <div class="field full"><button class="btn btn-gold wide" type="submit">Sign in</button>
        <button type="button" class="btn btn-ghost wide" id="forgotBtn" style="margin-top:10px">Forgot password?</button></div>`}
      </form>
      <div id="forgotArea" style="margin-top:14px;display:none">
        <form id="forgotForm"><div class="field"><label>Your account email</label><input name="email" type="email" required></div>
        <button class="btn btn-ghost wide sm">Issue secure recovery code</button></form>
      </div>
    </div>
    <div>
      <h3 style="margin-bottom:10px">Your data, protected.</h3>
      <p class="detail-desc" style="margin-bottom:12px">Passwords are hashed by our authentication provider and are never stored or displayed in readable form. Sessions use signed, expiring access tokens sent only over HTTPS, and every administrative action is logged.</p>
      <p class="detail-desc">Browsing the showroom never requires an account. Enquiries can be made with or without one — but an account lets you track responses and keep favourites in one place.</p>
    </div>
  </div>`;
  $$('#app .chips .chip').forEach((c) => c.onclick = () => route('/account?tab=' + c.dataset.t));
  const f = $('#authForm');
  f.onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f));
    try {
      const r = await api('/api/auth/' + (tab === 'register' ? 'register' : 'login'), { method: 'POST', body: d });
      localStorage.setItem(TOKEN_KEY, r.token);
      state.user = r.user; toast(`Welcome, ${r.user.name.split(' ')[0]}.`);
      await syncMe(); route('/account?tab=overview');
    } catch (err) { toast(err.message, true); }
  };
  $('#forgotBtn') && ($('#forgotBtn').onclick = () => { $('#forgotArea').style.display = 'block'; });
  $('#forgotForm') && ($('#forgotForm').onsubmit = async (e) => {
    e.preventDefault(); const email = new FormData(e.target).get('email');
    try {
      const r = await api('/api/auth/forgot', { method: 'POST', body: { email } });
      toast(r.message); $('#forgotArea').style.display = 'none';
    } catch (err) { toast(err.message, true); }
  });
  window.innerWidth < 780 && $$('.auth-2col').forEach((el) => (el.style.gridTemplateColumns = '1fr'));
}

/* ============================================================ CONTACT */
async function viewContact() {
  title('Contact & Purchasing — DM Motor Group');
  const s = state.settings;
  app.innerHTML = `
  <div class="page-head"><div><span class="crumb"><a href="/">Home</a> → Contact</span><h1>Contact the dealership</h1>
  <p style="color:var(--ink-dim);max-width:70ch">Request prices, extra photographs or videos, book inspections and test drives, ask about delivery — or send a purchase enquiry. Every message reaches the sales desk and is answered within one business day.</p></div></div>
  <div class="about-grid">
    <div class="panel">
      <h3 style="margin-bottom:14px">Send an enquiry</h3>
      <form id="enqForm">
        <div class="form-grid">
          <div class="field"><label>Your name *</label><input name="name" required></div>
          <div class="field"><label>Email *</label><input name="email" type="email" required></div>
          <div class="field"><label>Enquiry type</label><select name="type">${[['price', 'Request a selling price'], ['question', 'Ask a question'], ['inspection', 'Book an inspection'], ['testdrive', 'Arrange a test drive / viewing'], ['delivery', 'Request delivery information'], ['purchase', 'Submit a purchase enquiry']].map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          <div class="field full"><label>Message *</label><textarea name="message" required placeholder="Tell us what you are looking for (brand, model, budget) or ask about a specific vehicle…"></textarea></div>
        </div>
        <input type="text" name="website" style="position:absolute;left:-9000px" tabindex="-1" autocomplete="off">
        <button class="btn btn-gold" type="submit">Send enquiry</button>
      </form>
    </div>
    <div>
      <div class="panel" style="margin-bottom:16px"><h3 style="margin-bottom:10px">DM Motor Group</h3>
        <div class="info-rows">
          ${s.phone_sales ? `<div><span>Sales</span><a href="tel:${esc(s.phone_sales.replace(/\s/g, ''))}">${esc(s.phone_sales)}</a></div>` : ''}
          ${s.phone_main ? `<div><span>Main</span><a href="tel:${esc(s.phone_main.replace(/\s/g, ''))}">${esc(s.phone_main)}</a></div>` : ''}
          ${s.email_sales ? `<div><span>Email</span><a href="mailto:${esc(s.email_sales)}">${esc(s.email_sales)}</a></div>` : ''}
          ${state.wa ? `<div><span>WhatsApp</span><a href="https://wa.me/${esc(state.wa)}" target="_blank" rel="noopener">Open chat</a></div>` : ''}
          ${s.address_primary ? `<div><span>Dubai showroom</span><span>${esc(s.address_primary)}</span></div>` : ''}
          ${s.address_secondary ? `<div><span>Doha office</span><span>${esc(s.address_secondary)}</span></div>` : ''}
          ${s.hours ? `<div><span>Hours</span><span>${esc(s.hours)}</span></div>` : ''}
          ${s.trade_license ? `<div><span>Licence</span><span>${esc(s.trade_license)}</span></div>` : ''}
        </div>
        ${!s.phone_sales && !s.phone_main && !s.email_sales ? '<p class="detail-desc" style="font-size:13.5px;margin-top:10px">Use the enquiry form to reach the sales desk. Every message is answered by email.</p>' : ''}
      </div>
      <div class="panel"><h3 style="margin-bottom:10px">Payment & security</h3>
        <p class="detail-desc" style="font-size:14px">${esc(s.payment_info || '')}</p>
        <p class="detail-desc" style="font-size:14px;margin-top:10px">${esc(s.inspection_note || '')}</p>
      </div>
    </div>
  </div>`;
  $('#enqForm').onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    try { const r = await api('/api/enquiries', { method: 'POST', body: { ...d, vehicleTitle: 'General enquiry' } }); toast(r.message); e.target.reset(); }
    catch (err) { toast(err.message, true); }
  };
}

/* ---------------- search overlay ---------------- */
$('#btnSearch').onclick = async () => {
  const o = $('#searchOverlay'); o.hidden = false; $('input[name=q]', o).focus();
  await buildQuickSearchFields();
};
$$('#searchOverlay [data-close]').forEach((b) => b.onclick = () => { $('#searchOverlay').hidden = true; document.body.style.overflow = ''; });
$('#quickSearchForm').onsubmit = (e) => { e.preventDefault(); $('#quickSearchForm').submit && (location.href = '/vehicles?' + new URLSearchParams(Object.fromEntries(new FormData(e.target))).toString()); };
$$('#searchOverlay [data-close]').forEach((b) => b.onclick = () => $('#searchOverlay').setAttribute('hidden', ''));
$('#btnMenu').onclick = () => $('#nav').classList.toggle('open');
$$('#nav a').forEach((a) => a.onclick = () => $('#nav').classList.remove('open'));
async function buildQuickSearchFields() {
  await getMeta(); const m = state.meta; const host = $('#quickFields');
  const opt = (arr, ph) => `<option value="">${ph}</option>` + arr.map((x) => `<option>${esc(x)}</option>`).join('');
  host.innerHTML = `
    <select name="brand">${opt(m.brands, 'Any brand')}</select>
    <select name="priceMax"><option value="">Any price</option><option>20000</option><option>40000</option><option>70000</option><option>120000</option><option>250000</option></select>
    <select name="bodyType">${opt(m.bodyTypes, 'Any body type')}</select>
    <select name="transmission">${opt(m.transmissions, 'Any transmission')}</select>
    <select name="fuel">${opt(m.fuels, 'Any fuel')}</select>
    <select name="condition">${opt(['New', 'Used — as new', 'Used'], 'Any condition')}</select>`;
  void m.locations;
}

/* ---------------- boot ---------------- */
async function syncMe() {
  try { const me = await api('/api/auth/me'); state.user = me.user; state.favourites = new Set(me.favourites || []); state.unread = me.unread || 0; }
  catch { state.user = null; }
  hdrCount();
}
window.addEventListener('pageshow', () => {});

(async function boot() {
  try { await syncMe(); } catch {}
  try { await getMeta(); } catch {}
  try { const h = await api('/api/home'); state.settings = h.settings || {}; applySettings(h); } catch {}
  await route(location.pathname + location.search, true);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
/* Android app installation (Chrome "Add to Home screen" flow) */
window.__pwaPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); window.__pwaPrompt = e;
  if ($('.install-android')) return;
  const b = document.createElement('button');
  b.className = 'install-android';
  b.innerHTML = '📲 Install the DM Motors Android app';
  b.onclick = async () => { window.__pwaPrompt.prompt(); await window.__pwaPrompt.userChoice; b.remove(); };
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 30000);
});
