/* Final gaps: BYD Seal, Barracuda, Chiron Super Sport - extract raw price figures. */
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', accept: 'text/html' };
const urls = [
  ['byd-seal', 'https://www.carhp.com/byd/seal'],
  ['byd-seal2', 'https://www.carbuzz.com/cars/byd/seal/'],
  ['barracuda-classicvaluer', 'https://www.theclassicvaluer.com/cars/plymouth/barracuda'],
  ['barracuda-classic', 'https://www.classic.com/m/plymouth/barracuda/'],
  ['chiron-ss-classic', 'https://www.theclassicvaluer.com/cars/bugatti/chiron-super-sport-300-plus'],
];
for (const [key, u] of urls) {
  try {
    const r = await fetch(u, { headers: UA });
    const html = await r.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const nums = [...new Set((text.match(/\$[0-9][0-9,]{2,}/g) || []))].slice(0, 12);
    console.log('\n=== ' + key + ' [' + u.slice(8, 52) + '] status=' + r.status + ' len=' + html.length);
    console.log('  prices: ' + nums.join(', '));
    const ctx = [...new Set((text.match(/.{60}\$[0-9][0-9,]{2,}.{0,60}/g) || []))].slice(0, 4);
    for (const c of ctx) console.log('   * ' + c.trim().slice(0, 170));
  } catch (e) { console.log('=== ' + key + ' ERROR ' + String(e).slice(0, 70)); }
  await new Promise((r) => setTimeout(r, 1200));
}
