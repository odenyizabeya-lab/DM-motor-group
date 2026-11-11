/* =============================================================================
 * DM Motor Group — advanced-mode _worker.js
 * One Worker handles everything on the domain:
 *   /api/*          → REST API (Supabase-shaped dispatcher in functions/api)
 *   /sitemap.xml    → live sitemap from Supabase
 *   /vehicles/:slug → SEO shell with real vehicle data
 *   everything else → static asset → admin shell → SPA shell
 * Built into dist/_worker.js by build.mjs (esbuild).
 * ========================================================================== */
import { onRequest as apiOnRequest } from '../functions/api/[[path]].js';
import { onRequest as vehicleOnRequest } from '../functions/vehicles/[slug].js';
import { onRequest as sitemapOnRequest } from '../functions/sitemap.xml.js';
import { HTML_HEADERS } from './security.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SPA_TITLES = new Map([
  ['/', 'DM Motor Group — Premium International Automobile Dealership'],
  ['/vehicles', 'Showroom — Browse Premium Vehicles | DM Motor Group'],
  ['/videos', 'Video Presentations | DM Motor Group'],
  ['/compare', 'Compare Vehicles | DM Motor Group'],
  ['/contact', 'Contact the Dealership | DM Motor Group'],
  ['/account', 'Customer Account | DM Motor Group'],
]);

const HTML = HTML_HEADERS;

const SPA_DESC = 'Premium, luxury, SUV, sports and electric vehicles with full specifications, photography and full-length video presentations. Trusted international motor dealership.';

/* Replace the SEO placeholders in a served HTML document.  This must run for
 * every HTML response, including index.html returned by the static asset
 * handler — otherwise routes ship literal __TITLE__ tags. */
function renderHtml(html, pathname, base, notFound = false) {
  const title = notFound
    ? 'Page not found — DM Motor Group'
    : (SPA_TITLES.get(pathname) || 'DM Motor Group — Premium International Automobile Dealership');
  return String(html).replace(/__(TITLE|DESC|URL|IMG|TYPE|LD)__/g, (m, k) => ({
    TITLE: esc(title),
    DESC: esc(SPA_DESC),
    URL: esc(base + pathname),
    IMG: esc(`${base}/assets/hero.svg`),
    TYPE: esc('website'),
    LD: '',
  }[k] || ''));
}

/* Maintenance mode: read the flag through the edge cache so ordinary page
 * views do not hit the database. Fails open — a database hiccup must never
 * take the public site offline. */
async function maintenanceOn(env, ctx) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return false;
  try {
    const cache = caches.default;
    const key = new Request('https://dm-maintenance.internal/flag');
    let hit = await cache.match(key);
    if (!hit) {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/settings?key=eq.maintenance_mode&select=value`, {
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
      });
      const rows = r.ok ? await r.json().catch(() => []) : [];
      const on = String((rows && rows[0] && rows[0].value) || '').toLowerCase() === 'yes';
      hit = new Response(on ? '1' : '0', { headers: { 'Cache-Control': 'max-age=60' } });
      if (ctx) ctx.waitUntil(cache.put(key, hit.clone()));
    }
    return (await hit.text()) === '1';
  } catch { return false; }
}

const MAINTENANCE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Scheduled maintenance — DM Motor Group</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#f4f1ea;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:560px;padding:40px 24px;text-align:center}h1{font-size:26px;margin:0 0 14px;color:#d4b26a}p{margin:0 0 10px;color:#b9b4aa}a{color:#d4b26a}</style></head>
<body><main><h1>Scheduled maintenance</h1>
<p>We are updating the showroom right now. The website will be back shortly.</p>
<p>For urgent enquiries, email <a href="mailto:sales@dmmotorgroup.com">sales@dmmotorgroup.com</a>.</p>
</main></body></html>`;

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const p = url.pathname.replace(/\/+$/, '') || '/';

      /* API */
      if (p === '/api' || p.startsWith('/api/')) {
        const segs = p === '/api' ? [] : p.slice(4).split('/').filter(Boolean);
        return await apiOnRequest({ request, env, params: { path: segs }, ctx });
      }

      /* sitemap */
      if (p === '/sitemap.xml') {
        return await sitemapOnRequest({ request, env, params: {} });
      }

      /* maintenance notice for public HTML pages (admin + API stay available) */
      const wantsHtml = (request.headers.get('accept') || '').includes('text/html');
      if (wantsHtml && (p === '/' || SPA_TITLES.has(p) || /^\/vehicles\/[^/]+$/.test(p))) {
        if (await maintenanceOn(env, ctx)) {
          return new Response(MAINTENANCE_HTML, { status: 503, headers: { ...HTML, 'Retry-After': '300' } });
        }
      }

      /* per-vehicle SEO page */
      const vm = p.match(/^\/vehicles\/([^/]+)\/?$/);
      if (vm) {
        return await vehicleOnRequest({ request, env, params: { slug: vm[1] }, ctx });
      }

      /* admin static files */
      if (p === '/admin' || p.startsWith('/admin/')) {
        if (p === '/admin' || p === '/admin/') {
          const sh = await env.ASSETS.fetch(new Request(`${url.origin}/admin/index.html`, { method: 'GET' }));
          if (sh.status !== 404) return sh;
        }
        const a = await env.ASSETS.fetch(new Request(url.origin + url.pathname, { method: 'GET' }));
        if (a.status !== 404) return a;
        const sh = await env.ASSETS.fetch(new Request(`${url.origin}/admin/index.html`, { method: 'GET' }));
        if (sh.status !== 404) return sh;
      }

      /* static assets (styles, scripts, images, manifest, sw, robots, avatars) */
      const asset = await env.ASSETS.fetch(new Request(url.origin + url.pathname, {
        method: 'GET', headers: { 'accept-encoding': request.headers.get('accept-encoding') || '' },
      }));
      const base = String(env.SITE_URL || `${url.protocol}//${url.hostname}`).replace(/\/+$/, '');

      /* Any HTML asset (including the "/" -> index.html and SPA fallback) must
       * be rendered so the SEO placeholders are replaced. */
      if (asset.status !== 404) {
        const type = asset.headers.get('content-type') || '';
        if (type.includes('text/html')) {
          const known = SPA_TITLES.has(p) || p === '/index.html' || /\.[a-z0-9]+$/i.test(p);
          const html = await asset.text();
          return new Response(renderHtml(html, p, base, !known), { status: known ? 200 : 404, headers: HTML });
        }
        return asset;
      }

      /* SPA shell fallback */
      const shell = await env.ASSETS.fetch(new Request(`${url.origin}/index.html`, { method: 'GET' }));
      if (shell.status === 404) return new Response('Deployment incomplete: index.html missing', { status: 500 });
      return new Response(renderHtml(await shell.text(), p, base), { status: 200, headers: HTML });
    } catch (e) {
      return new Response(`DM Motor Group — temporary error: ${String(e && e.message || e).slice(0, 200)}`, {
        status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  },
};
