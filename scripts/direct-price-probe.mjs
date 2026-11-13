/* Test direct price-guide URLs (bypassing search engines). */
const urls = [
  'https://www.theclassicvaluer.com/cars/bugatti/chiron-super-sport',
  'https://www.classic.com/m/chevrolet/chevelle/',
  'https://www.carhp.com/bugatti/chiron-2020',
  'https://www.edmunds.com/lexus/ux-250h/2019/appraisal-value/',
  'https://www.carsforsale.com/2019-lexus-ux-250h-for-sale-C1725706',
];
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', accept: 'text/html' } });
    const html = await r.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
    const priced = text.split(/(?<=[.!?])\s+/).filter((p) => /\$[\d,]{3,}/.test(p) && p.length > 40 && p.length < 400);
    console.log('[' + u.slice(8, 60) + '] status=' + r.status + ' len=' + html.length + ' priced=' + priced.length);
    for (const s of priced.slice(0, 2)) console.log('    ' + s.slice(0, 200));
  } catch (e) { console.log('[' + u.slice(8, 60) + '] ERROR ' + String(e).slice(0, 80)); }
  await new Promise((r) => setTimeout(r, 1500));
}
