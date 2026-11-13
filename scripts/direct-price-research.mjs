/* Direct price-guide fetch per model (carhp / carbuzz style URLs).
 * Prints compact price contexts. No search engines involved. */
import fs from 'node:fs';

const TARGETS = [
  ['honda-accord-2016', ['https://www.carhp.com/honda/accord-2016', 'https://www.carbuzz.com/cars/honda/accord/2016/']],
  ['chevrolet-silverado-1500-2021', ['https://www.carhp.com/chevrolet/silverado-1500-2021', 'https://www.carbuzz.com/cars/chevrolet/silverado-1500/2021/']],
  ['honda-civic-2019', ['https://www.carhp.com/honda/civic-2019', 'https://www.carbuzz.com/cars/honda/civic/2019/']],
  ['toyota-corolla-2006', ['https://www.carhp.com/toyota/corolla-2006', 'https://www.carbuzz.com/cars/toyota/corolla/2006/']],
  ['ford-f150-2022', ['https://www.carhp.com/ford/f-150-2022', 'https://www.carbuzz.com/cars/ford/f-150/2022/']],
  ['ford-f250-2019', ['https://www.carhp.com/ford/f-250-super-duty-2019', 'https://www.carbuzz.com/cars/ford/f-250-super-duty/2019/']],
  ['tesla-model-3-2021', ['https://www.carhp.com/tesla/model-3-2021', 'https://www.carbuzz.com/cars/tesla/model-3/2021/']],
  ['mercedes-gle53-coupe', ['https://www.carhp.com/mercedes-benz/gle-53-coupe-2021', 'https://www.carbuzz.com/cars/mercedes-benz/gle-53-coupe/2021/']],
  ['ford-ranger-raptor-2023', ['https://www.carhp.com/ford/ranger-raptor-2023', 'https://www.carbuzz.com/cars/ford/ranger-raptor/2023/']],
  ['ferrari-laferrari', ['https://www.carhp.com/ferrari/laferrari-2015', 'https://www.carbuzz.com/cars/ferrari/laferrari/2015/']],
  ['lamborghini-revuelto', ['https://www.carhp.com/lamborghini/revuelto-2024', 'https://www.carbuzz.com/cars/lamborghini/revuelto/2024/']],
  ['rolls-royce-cullinan-2025', ['https://www.carhp.com/rolls-royce/cullinan-2025', 'https://www.carbuzz.com/cars/rolls-royce/cullinan/2025/']],
  ['ford-mustang-gt-2019', ['https://www.carhp.com/ford/mustang-2019', 'https://www.carbuzz.com/cars/ford/mustang/2019/']],
  ['bugatti-chiron-super-sport', ['https://www.carhp.com/bugatti/chiron-super-sport-2020', 'https://www.carbuzz.com/cars/bugatti/chiron-super-sport/2020/']],
  ['bugatti-chiron-2020', ['https://www.carhp.com/bugatti/chiron-2020', 'https://www.carbuzz.com/cars/bugatti/chiron/2020/']],
  ['byd-seal-2023', ['https://www.carhp.com/byd/seal-2023', 'https://www.carbuzz.com/cars/byd/seal/2023/']],
  ['mercedes-sclass-coupe-2019', ['https://www.carhp.com/mercedes-benz/s-class-coupe-2019', 'https://www.carbuzz.com/cars/mercedes-benz/s-class-coupe/2019/']],
  ['plymouth-barracuda-1970', ['https://www.carhp.com/plymouth/barracuda-1970', 'https://www.carbuzz.com/cars/plymouth/barracuda/1970/']],
];

const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', accept: 'text/html' };
let out = {};
try { out = JSON.parse(fs.readFileSync('.tmp-scan/market/research.json', 'utf8')); } catch {}

for (const [key, urls] of TARGETS) {
  const lines = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: UA });
      const html = await r.text();
      if (r.status !== 200 || html.length < 5000) { lines.push('[' + u.slice(8, 45) + ' status=' + r.status + ' skipped]'); continue; }
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
      /* find price contexts */
      const ctx = [];
      const re = /(MSRP|Price|price|market value|average|used)[^.]{0,120}\$[0-9][0-9,\.]{2,}[^.\n]{0,80}/g;
      let m; while ((m = re.exec(text)) && ctx.length < 8) ctx.push(m[0].trim().slice(0, 190));
      const uniq = [...new Set(ctx)];
      lines.push('[' + u.slice(8, 45) + '] ' + uniq.slice(0, 5).join(' || '));
    } catch (e) { lines.push('[' + u.slice(8, 45) + ' ERROR ' + String(e).slice(0, 60) + ']'); }
    await new Promise((r) => setTimeout(r, 1200));
  }
  console.log('\n=== ' + key);
  for (const l of lines) console.log('  ' + l);
  out[key] = { query: 'direct price guides', snippets: lines.map((l) => l.replace(/\s+/g, ' ')).slice(0, 5) };
  fs.writeFileSync('.tmp-scan/market/research.json', JSON.stringify(out, null, 1));
}
console.log('\nmerged into .tmp-scan/market/research.json');
