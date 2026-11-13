/* Dump all published vehicles with their media (photos + videos) to JSON. */
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY };
const base = env.SUPABASE_URL + '/rest/v1/';

const veh = await fetch(base + 'vehicles?select=*&status=eq.published&order=id.asc', { headers: H }).then((r) => r.json());
const media = await fetch(base + 'media?select=id,vehicle_id,type,url,thumb_url,is_video_cover,caption&order=id.asc', { headers: H }).then((r) => r.json());

const byVeh = {};
for (const m of media) (byVeh[m.vehicle_id] = byVeh[m.vehicle_id] || []).push(m);

const out = veh.map((v) => ({
  id: v.id, slug: v.slug, brand: v.brand, model: v.model, year: v.year,
  price: v.price, currency: v.currency, mileage: v.mileage, engine: v.engine,
  transmission: v.transmission, fuel: v.fuel, body_type: v.body_type,
  exterior_color: v.exterior_color, interior_color: v.interior_color,
  vin: v.vin, condition: v.condition, registration: v.registration,
  location: v.location, description: v.description, features: v.features,
  safety_features: v.safety_features, ownership_info: v.ownership_info,
  inspection_status: v.inspection_status, inspection_report: v.inspection_report,
  category: v.category, cover: v.cover,
  videos: (byVeh[v.id] || []).filter((m) => m.type === 'video').map((m) => ({ id: m.id, url: m.url, thumb: m.thumb_url, caption: m.caption })),
  photos: (byVeh[v.id] || []).filter((m) => m.type === 'image').map((m) => ({ id: m.id, url: m.url, thumb: m.thumb_url })),
}));

fs.mkdirSync('.tmp-scan', { recursive: true });
fs.writeFileSync('.tmp-scan/vehicles.json', JSON.stringify(out, null, 1));
console.log('vehicles:', out.length);
console.log('with videos:', out.filter((v) => v.videos.length).length);
console.log('with photos:', out.filter((v) => v.photos.length).length);
console.log('total video files:', out.reduce((a, v) => a + v.videos.length, 0));
console.log('total photos:', out.reduce((a, v) => a + v.photos.length, 0));
for (const v of out) console.log(`${v.id} ${v.year} ${v.brand} ${v.model} | vids:${v.videos.length} pics:${v.photos.length} | price:${v.price} ${v.currency} | ${v.exterior_color || ''} ${v.body_type || ''}`);
