/* =============================================================================
 * catch-all — serves the SPA shell for client-side routes; static assets are
 * always matched first by Cloudflare Pages, so this only runs for application
 * routes that need index.html (e.g. /videos, /compare, /account, /contact).
 * ========================================================================== */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TITLES = {
  '/': 'DM Motor Group — Premium International Automobile Dealership',
  '/vehicles': 'Showroom — Browse Premium Vehicles | DM Motor Group',
  '/videos': 'Video Presentations | DM Motor Group',
  '/compare': 'Compare Vehicles | DM Motor Group',
  '/contact': 'Contact the Dealership | DM Motor Group',
  '/account': 'Customer Account | DM Motor Group',
};

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path.startsWith('/admin') || path.startsWith('/assets') || /\.[a-z0-9]+$/i.test(path)) {
    /* exact asset / admin shell — let Pages static serving handle it */
    const asset = await env.ASSETS.fetch(new Request(url.origin + path, { method: 'GET' }));
    if (asset.status !== 404) return asset;
  }
  if (path === '/admin' || path.startsWith('/admin/')) {
    const adminShell = await env.ASSETS.fetch(new Request(url.origin + '/admin/index.html', { method: 'GET' }));
    if (adminShell.status !== 404) return adminShell;
  }
  /* SPA fallback with sensible per-route meta */
  const shell = await env.ASSETS.fetch(new Request(url.origin + '/index.html', { method: 'GET' }));
  if (shell.status === 404) return shell;
  const base = String(env.SITE_URL || `${url.protocol}//${url.hostname}`).replace(/\/+$/, '');
  const title = TITLES[path] || TITLES[path.replace(/\/+$/, '')] || TITLES['/'];
  let html = await shell.text();
  html = html.replace(/__(TITLE|DESC|URL|IMG|TYPE|LD)__/g, (m, k) => ({
    TITLE: esc(title),
    DESC: esc('Premium, luxury, SUV, sports and electric vehicles with full specifications, photography and full-length video presentations.'),
    URL: esc(base + url.pathname),
    IMG: esc(base + '/assets/hero.svg'),
    TYPE: esc('website'),
    LD: '',
  }[k] || ''));
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
}
