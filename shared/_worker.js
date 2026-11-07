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

const HTML = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };

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
      if (asset.status !== 404) return asset;

      /* SPA shell fallback */
      const shell = await env.ASSETS.fetch(new Request(`${url.origin}/index.html`, { method: 'GET' }));
      if (shell.status === 404) return new Response('Deployment incomplete: index.html missing', { status: 500 });
      const base = String(env.SITE_URL || `${url.protocol}//${url.hostname}`).replace(/\/+$/, '');
      let html = await shell.text();
      const title = SPA_TITLES.get(p) || 'DM Motor Group — Premium International Automobile Dealership';
      html = html.replace(/__(TITLE|DESC|URL|IMG|TYPE|LD)__/g, (m, k) => ({
        TITLE: esc(title),
        DESC: esc('Premium, luxury, SUV, sports and electric vehicles with full specifications, photography and full-length video presentations. Trusted international motor dealership.'),
        URL: esc(base + p),
        IMG: esc(`${base}/assets/hero.svg`),
        TYPE: esc('website'),
        LD: '',
      }[k] || ''));
      return new Response(html, { status: 200, headers: HTML });
    } catch (e) {
      return new Response(`DM Motor Group — temporary error: ${String(e && e.message || e).slice(0, 200)}`, {
        status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  },
};
