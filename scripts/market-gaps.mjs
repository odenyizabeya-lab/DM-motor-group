/* Fill remaining market gaps with alternate URL patterns. */
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', accept: 'text/html' };
const TARGETS = [
  ['mercedes-gle53-coupe', ['https://www.carbuzz.com/cars/mercedes-benz/amg-gle-53-coupe/2021/', 'https://www.carbuzz.com/cars/mercedes-benz/gle-coupe/2021/', 'https://www.carhp.com/mercedes-benz/gle-coupe-2021', 'https://www.carhp.com/mercedes-benz/amg-gle-53-coupe-2021']],
  ['ford-ranger-raptor-2023', ['https://www.carbuzz.com/cars/ford/ranger/2023/', 'https://www.carhp.com/ford/ranger-2023', 'https://www.carbuzz.com/cars/ford/ranger-raptor/2024/']],
  ['byd-seal-2023', ['https://www.carbuzz.com/cars/byd/seal/2024/', 'https://www.carhp.com/byd/seal-2024', 'https://www.carbuzz.com/cars/byd/seal/2025/']],
  ['plymouth-barracuda-1970', ['https://www.carbuzz.com/cars/plymouth/barracuda/1971/', 'https://www.carbuzz.com/cars/plymouth/barracuda/1970/', 'https://www.carhp.com/plymouth/barracuda-1971']],
  ['bugatti-chiron-super-sport', ['https://www.carbuzz.com/cars/bugatti/chiron-super-sport-300/2020/', 'https://www.carbuzz.com/cars/bugatti/chiron-super-sport/2021/', 'https://www.carhp.com/bugatti/chiron-2020-300']],
];
for (const [key, urls] of TARGETS) {
  console.log('\n=== ' + key);
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: UA });
      const html = await r.text();
      if (r.status !== 200 || html.length < 5000) { console.log('  [' + u.slice(8, 60) + '] status=' + r.status); continue; }
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
      const ctx = []; const re = /(MSRP|price|Price|market value|average|used)[^.]{0,110}\$[0-9][0-9,\.]{2,}[^.\n]{0,70}/g;
      let m; while ((m = re.exec(text)) && ctx.length < 6) ctx.push(m[0].trim().slice(0, 170));
      console.log('  [' + u.slice(8, 60) + '] ' + [...new Set(ctx)].slice(0, 3).join(' || '));
    } catch (e) { console.log('  [' + u.slice(8, 60) + '] ERROR ' + String(e).slice(0, 50)); }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
