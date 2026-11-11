const BASE = process.argv[2] || 'https://dmmotorgroup.com';
const slug = process.argv[3] || 'plymouth-barracuda-1970';
const r = await fetch(`${BASE}/vehicles/${slug}`);
const t = await r.text();
const one = (re) => (t.match(re) || [])[1] || '';
console.log('status       ', r.status);
console.log('title        ', one(/<title>([^<]*)<\/title>/));
console.log('description  ', one(/<meta name="description" content="([^"]*)"/).slice(0, 120));
console.log('canonical    ', one(/<link rel="canonical" href="([^"]*)"/));
console.log('og:image     ', one(/<meta property="og:image" content="([^"]*)"/));
console.log('og:type      ', one(/<meta property="og:type" content="([^"]*)"/));
const lds = [...t.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1].trim()).filter(Boolean);
console.log('ld blocks    ', lds.length);
for (const ld of lds) {
  try {
    const j = JSON.parse(ld);
    console.log('  ld type    ', j['@type'], j.offers ? 'offer=' + JSON.stringify(j.offers) : '');
  } catch (e) { console.log('  ld parse error', e.message); }
}
console.log('placeholders left', /__[A-Z]+__/.test(t));
