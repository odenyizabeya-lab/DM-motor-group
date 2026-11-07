/* Dynamic sitemap — real published vehicles from Supabase */
import L from '../shared/api-lib.js';

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const base = String(env.SITE_URL || `${url.protocol}//${url.hostname}`).replace(/\/+$/, '');
  let page = 0, out = [];
  for (;;) {
    if (page >= 5) break; /* first 2,500 vehicles */
    const rows = await L.rest.get(env, 'vehicles', {
      select: 'slug,updated_at', status: 'eq.published',
      order: 'id.asc', limit: '500', offset: String(page * 500),
    });
    if (!rows || !rows.length) break;
    out = out.concat(rows);
    if (rows.length < 500) break;
    page += 1;
  }
  const today = new Date().toISOString().slice(0, 10);
  const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${base}/vehicles</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
  <url><loc>${base}/videos</loc><changefreq>daily</changefreq><priority>0.8</priority></url>
  <url><loc>${base}/contact</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>
  <url><loc>${base}/account</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>
${out.map((v) => `  <url><loc>${base}/vehicles/${v.slug}</loc><lastmod>${(v.updated_at || today).slice(0, 10)}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`).join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'max-age=3600' } });
}
