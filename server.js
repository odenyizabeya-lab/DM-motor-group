'use strict';
/* DM Motor Group — HTTP server (zero dependencies) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { q, jparse } = require('./lib/db');
const api = require('./lib/api');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const ADMIN = path.join(ROOT, 'admin');
const UPLOADS = path.join(ROOT, 'uploads');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

/* ---------------- static file serving (with HTTP Range for video streaming) ---------------- */
function sendFile(req, res, filePath) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const size = st.size;
    const headers = {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': filePath.includes(path.join('uploads')) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    };
    if (req.method === 'HEAD') { res.writeHead(200, headers); return res.end(); }
    const range = req.headers.range;
    if (range && /^bytes=(\d*)-(\d*)$/.test(range) && size > 0) {
      const [, s, e] = range.match(/^bytes=(\d*)-(\d*)$/);
      let start = s === '' ? 0 : parseInt(s, 10);
      let end = e === '' ? size - 1 : Math.min(parseInt(e, 10), size - 1);
      if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
    headers['Content-Length'] = size;
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

function safeJoin(base, urlPath) {
  const p = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const full = path.join(base, p);
  if (!full.startsWith(base)) return null;
  return full;
}

/* ---------------- SEO ---------------- */
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

function serveShell(req, res, seo = {}) {
  let html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const BASE = seo.base || '';
  const meta = {
    TITLE: esc(seo.title || 'DM Motor Group — Premium International Automobile Dealership'),
    DESC: esc(seo.desc || 'Browse premium, luxury, SUV, sports and electric vehicles with full specifications, photography and video presentations. Trusted international motor dealership.'),
    URL: esc(seo.url || BASE + '/'),
    IMG: esc(seo.img || BASE + '/assets/hero.svg'),
    TYPE: esc(typeof seo.type === 'undefined' ? 'website' : seo.type),
    LD: seo.ld || '',
  };
  html = html.replace(/__TITLE__|__DESC__|__URL__|__IMG__|__TYPE__|__LD__/g, (m) => meta[m.slice(2, -2)] || '');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}

function serveSitemap(req, res) {
  const rows = q.all(`SELECT slug, updated_at FROM vehicles WHERE status IN ('published','reserved','sold') ORDER BY updated_at DESC`);
  const today = new Date().toISOString().slice(0, 10);
  const urls = ['', 'vehicles', 'videos', 'compare', 'contact']
    .map((p) => `  <url><loc>${esc(HOST + '/' + p)}</loc><changefreq>daily</changefreq><priority>${p ? '0.8' : '1.0'}</priority></url>`)
    .join('\n');
  const veh = rows.map((r) =>
    `  <url><loc>${esc(HOST + '/vehicles/' + r.slug)}</loc><lastmod>${(r.updated_at || today).replace(' ', 'T') + 'Z'}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n${veh}\n</urlset>`;
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
  res.end(xml);
}

let HOST = '';
/* ---------------- request handler ---------------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = url.pathname;
  HOST = process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost:' + PORT}`;

  if (p.startsWith('/api/')) return api.handle(req, res, url).catch((e) => {
    console.error('[api]', e);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); }
    res.end(JSON.stringify({ error: 'Server error' }));
  });

  if (p === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ' + HOST + '/sitemap.xml\n'); }
  if (p === '/sitemap.xml') return serveSitemap(req, res);

  // uploads → /media/...
  if (p.startsWith('/media/')) {
    const f = safeJoin(UPLOADS, p.slice('/media/'.length));
    return f ? sendFile(req, res, f) : (res.writeHead(404), res.end());
  }
  // admin app
  if (p === '/admin' || p.startsWith('/admin/')) {
    const f = safeJoin(ADMIN, p === '/admin' ? 'index.html' : p.slice('/admin/'.length));
    return f ? sendFile(req, res, f) : (res.writeHead(404), res.end());
  }
  // static assets from /public
  const staticF = safeJoin(PUBLIC, p);
  if (staticF && fs.existsSync(staticF) && fs.statSync(staticF).isFile()) return sendFile(req, res, staticF);

  // SEO for vehicle detail pages (renders into app shell)
  const mVeh = p.match(/^\/vehicles\/([a-z0-9-]+)\/?$/i);
  if (mVeh) {
    const v = q.get(`SELECT slug, brand, model, year, price, currency, description, status FROM vehicles WHERE slug = ?`, mVeh[1]);
    if (v) {
      const cover = q.get(`SELECT url FROM media WHERE vehicle_id = (SELECT id FROM vehicles WHERE slug = ?) ORDER BY is_video_cover DESC, position ASC LIMIT 1`, v.slug);
      const base = HOST;
      const ld = {
        '@context': 'https://schema.org', '@type': 'Car',
        name: `${v.brand} ${v.model} ${v.year}`, vehicleModelDate: String(v.year),
        brand: { '@type': 'Brand', name: v.brand }, model: v.model,
        offers: { '@type': 'Offer', price: v.price, priceCurrency: v.currency, availability: v.status === 'published' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut' },
        image: cover && cover.url ? base + cover.url : undefined,
        itemCondition: v.condition === 'New' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition',
      };
      if (!v.description) ld.description = `View the ${v.brand} ${v.model} ${v.year} at DM Motor Group.`;
      else ld.description = v.description.slice(0, 300);
      return serveShell(req, res, {
        title: `${v.brand} ${v.model} ${v.year} — DM Motor Group`,
        desc: v.description ? String(v.description).slice(0, 180) : `View the ${v.brand} ${v.model} ${v.year} at DM Motor Group.`,
        url: base + '/vehicles/' + v.slug, img: cover && cover.url ? base + cover.url : undefined,
        type: 'product', base, ld: JSON.stringify(ld),
      });
    }
  }
  return serveShell(req, res, { base: HOST });
});

server.listen(PORT, () => console.log(`✦ DM Motor Group platform running → http://localhost:${PORT}  (admin: /admin)`));
