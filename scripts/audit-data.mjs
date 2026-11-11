/* Verify search, filters, pagination and detail response consistency. */
const BASE = process.argv[2] || 'https://dmmotorgroup.com';
const get = async (p) => { const r = await fetch(BASE + p); return { status: r.status, data: await r.json().catch(() => null) }; };
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); ok ? pass++ : fail++; };

const all = await get('/api/vehicles?per=100');
check('all vehicles fetched', all.status === 200 && all.data.total === 33, `total=${all.data.total} returned=${all.data.items.length} per=${all.data.per}`);
const items = all.data.items;
check('all items are published/reserved', items.every((v) => ['published', 'reserved'].includes(v.status)));
check('every item has a cover image', items.every((v) => !!v.cover), `missing=${items.filter((v) => !v.cover).length}`);
check('every item has a slug', items.every((v) => /^[a-z0-9-]+$/.test(v.slug || '')));
check('price 0 renders as null/0 (client shows Price on request)', items.filter((v) => !(v.price > 0)).length === 18, `zero=${items.filter((v) => !(v.price > 0)).length}`);

const brand = items[0].brand;
const bf = await get(`/api/vehicles?brand=${encodeURIComponent(brand)}&per=100`);
check('brand filter only returns that brand', bf.status === 200 && bf.data.items.every((v) => v.brand === brand), `brand=${brand} count=${bf.data.total}`);

const q = items[0].model.split(' ')[0];
const sf = await get(`/api/vehicles?q=${encodeURIComponent(q)}&per=100`);
check('keyword search returns results', sf.status === 200 && sf.data.total > 0, `q=${q} total=${sf.data.total}`);

const cat = await get('/api/vehicles?category=suv&per=100');
check('category filter valid', cat.status === 200 && cat.data.items.every((v) => v.category === 'suv'), `total=${cat.data.total}`);

const sort = await get('/api/vehicles?sort=price_asc&per=100');
const prices = sort.data.items.map((v) => +(v.price || 0));
check('price ascending sort', prices.every((p, i) => i === 0 || p >= prices[i - 1]), `first=${prices[0]} last=${prices[prices.length - 1]}`);

const p1 = await get('/api/vehicles?per=12&page=1');
const p2 = await get('/api/vehicles?per=12&page=2');
const p3 = await get('/api/vehicles?per=12&page=3');
check('pagination pages correct', p1.data.items.length === 12 && p2.data.items.length === 12 && p3.data.items.length === 9, `${p1.data.items.length}/${p2.data.items.length}/${p3.data.items.length}`);
check('pagination has no overlap', new Set([...p1.data.items, ...p2.data.items, ...p3.data.items].map((v) => v.id)).size === 33);
const p99 = await get('/api/vehicles?per=12&page=99');
check('page beyond end returns empty list', p99.status === 200 && p99.data.items.length === 0, `items=${p99.data.items.length}`);

const detail = await get(`/api/vehicles/${items[0].slug}`);
check('detail loads', detail.status === 200 && detail.data.slug === items[0].slug);
check('detail has media array', Array.isArray(detail.data.media) && detail.data.media.length > 0, `media=${detail.data.media && detail.data.media.length}`);
check('detail similar items have covers', (detail.data.similar || []).every((v) => !!v.cover), `similar=${(detail.data.similar || []).length} missing=${(detail.data.similar || []).filter((v) => !v.cover).length}`);

const vids = await get('/api/videos?per=50');
check('videos endpoint', vids.status === 200 && Array.isArray(vids.data.items), `total=${vids.data.total}`);
check('videos all have url and vehicle slug', vids.data.items.every((v) => v.url && v.slug), `bad=${vids.data.items.filter((v) => !v.url || !v.slug).length}`);

const meta = await get('/api/meta');
check('meta lists brands and body types', meta.status === 200 && meta.data.brands.length > 0 && meta.data.bodyTypes.length > 0);

const bad = await get('/api/vehicles?priceMax=abc&yearMin=-5&per=-3');
check('invalid numeric params do not 500', bad.status === 200, `status=${bad.status}`);

console.log(`\n${pass}/${pass + fail} checks passed; ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
