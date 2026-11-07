/* =============================================================================
 * SEO shell injection — per-vehicle meta tags, canonical, Open Graph, JSON-LD.
 * Serves the same index.html shell that static pages use, with real database
 * values injected server-side so scrapers and social platforms see live data.
 * ========================================================================== */
import L from '../../shared/api-lib.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inject(html, map) {
  return html.replace(/__(TITLE|DESC|URL|IMG|TYPE|LD)__/g, (m, k) => map[k] || '');
}

export async function onRequest({ request, env, params, siteurl }) {
  const slug = params.slug;
  const url = new URL(request.url);
  const base = String(env.SITE_URL || `${url.protocol}//${url.hostname}`).replace(/\/+$/, '');

  let v = null;
  try {
    const rows = await L.rest.get(env, 'vehicles', { slug: `eq.${slug}`, select: 'slug,brand,model,year,price,currency,mileage,condition,description,location,vin,status,category,body_type,exterior_color,transmission,fuel' });
    v = rows && rows[0];
  } catch {}

  /* fetch shell from static assets */
  const shell = await fetch(new URL(request.url).origin + '/index.html', { headers: { 'x-served-by': 'dm-shell' } })
    .then((r) => r.text()).catch(() => '');

  if (!v || !['published', 'reserved'].includes(v.status)) {
    /* shell without vehicle data (404 semantics preserved) */
    const html = shell
      ? inject(shell, {
          TITLE: esc('Vehicle not found — DM Motor Group'),
          URL: esc(base + '/'),
          TYPE: 'website',
        })
      : '<!doctype html><title>Vehicle not found — DM Motor Group</title>';
    return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
  }

  /* media (og:image from the real cover photo) */
  let img = `${base}/assets/hero.svg`;
  try {
    const md = await L.rest.get(env, 'media', { vehicle_id: `eq.${v.id}`, type: 'eq.image', select: 'url,thumb_url', order: 'position.asc,id.asc', limit: '1' });
    if (md && md[0]) img = md[0].url;
  } catch {}

  const title = `${v.brand} ${v.model} ${v.year} — DM Motor Group`;
  const desc = (v.description || `${v.year} ${v.brand} ${v.model} — ${String(v.price)} ${v.currency}`).replace(/\s+/g, ' ').slice(0, 300);

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Car',
    name: `${v.brand} ${v.model} ${v.year}`,
    brand: { '@type': 'Brand', name: v.brand },
    model: v.model,
    vehicleModelDate: String(v.year),
    itemCondition: /new/i.test(v.condition || '') ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition',
    url: `${base}/vehicles/${v.slug}`,
    image: [img],
    color: v.exterior_color || undefined,
    vehicleTransmission: v.transmission || undefined,
    fuelType: v.fuel || undefined,
    vehicleConfiguration: v.body_type || undefined,
    offers: {
      '@type': 'Offer',
      price: String(v.price),
      priceCurrency: v.currency || 'USD',
      availability: v.status === 'published' ? 'https://schema.org/InStock' : 'https://schema.org/LimitedAvailability',
      url: `${base}/vehicles/${v.slug}`,
      seller: { '@type': 'AutoDealer', name: 'DM Motor Group', url: base },
    },
  };
  if (v.vin) ld.vehicleIdentificationNumber = v.vin;
  if (v.mileage) ld.mileageFromOdometer = { '@type': 'QuantitativeValue', value: v.mileage, unitCode: 'KMT' };

  const map = {
    TITLE: esc(title),
    DESC: esc(desc),
    URL: esc(`${base}/vehicles/${v.slug}`),
    IMG: esc(img),
    TYPE: esc('product'),
    LD: JSON.stringify(ld).replace(/</g, '\\u003c'),
  };

  const html = shell ? inject(shell, map)
    : `<!doctype html><title>${map.TITLE}</title><meta name="description" content="${map.DESC}">`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
