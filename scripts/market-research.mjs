/* Market research: fetch price-related snippets for each model via DuckDuckGo HTML.
 * Prints a compact digest (no raw HTML) and saves full text for review. */
import fs from 'node:fs';

const MODELS = [
  ['lexus-ux-250h', 'Lexus UX 250h 2019 used price'],
  ['maybach-gls-600', 'Mercedes Maybach GLS 600 2022 used price'],
  ['ferrari-sf90', 'Ferrari SF90 Stradale used price value'],
  ['ford-torino-talladega', '1969 Ford Torino Talladega price value'],
  ['chevrolet-chevelle-ss-1966', '1966 Chevrolet Chevelle SS price value'],
  ['chevrolet-c10-1965', '1965 Chevrolet C10 pickup price value'],
  ['gmc-sierra-2500hd', '2022 GMC Sierra 2500HD Denali used price'],
  ['chevrolet-chevelle-1970', '1970 Chevrolet Chevelle SS price value'],
  ['range-rover-velar-2020', '2020 Land Rover Range Rover Velar used price'],
  ['cadillac-ct5v-blackwing', '2023 Cadillac CT5-V Blackwing used price'],
  ['kia-ev3-2025', '2025 Kia EV3 price MSRP used'],
  ['land-rover-defender-110', '2022 Land Rover Defender 110 used price'],
  ['cadillac-escalade-2022', '2022 Cadillac Escalade used price'],
  ['honda-accord-2016', '2016 Honda Accord used price'],
  ['chevrolet-silverado-1500-2021', '2021 Chevrolet Silverado 1500 used price'],
  ['honda-civic-2019', '2019 Honda Civic used price'],
  ['toyota-corolla-2006', '2006 Toyota Corolla used price'],
  ['ford-f150-2022', '2022 Ford F-150 used price'],
  ['ford-f250-2019', '2019 Ford F-250 Super Duty used price'],
  ['tesla-model-3-2021', '2021 Tesla Model 3 used price'],
  ['mercedes-gle53-coupe', '2021 Mercedes AMG GLE 53 Coupe used price'],
  ['ford-ranger-raptor-2023', '2023 Ford Ranger Raptor used price'],
  ['ferrari-laferrari', 'Ferrari LaFerrari used price value'],
  ['lamborghini-revuelto', 'Lamborghini Revuelto MSRP price'],
  ['rolls-royce-cullinan-2025', '2025 Rolls-Royce Cullinan MSRP price'],
  ['ford-mustang-gt-2019', '2019 Ford Mustang GT used price'],
  ['bugatti-chiron-super-sport', '2020 Bugatti Chiron Super Sport 300+ price'],
  ['bugatti-chiron-2020', '2020 Bugatti Chiron used price'],
  ['byd-seal-2023', '2023 BYD Seal used price'],
  ['mercedes-sclass-coupe-2019', '2019 Mercedes-Benz S-Class Coupe used price'],
  ['plymouth-barracuda-1970', '1970 Plymouth Barracuda price value'],
];

fs.mkdirSync('.tmp-scan/market', { recursive: true });
let out = {};
try { out = JSON.parse(fs.readFileSync('.tmp-scan/market/research.json', 'utf8')); } catch {}
const only = process.argv[2] ? process.argv.slice(2) : null;
for (const [key, q] of MODELS) {
  if (only && !only.includes(key)) continue;
  let snippets = [];
  let html = '';
  for (let attempt = 1; attempt <= 3 && !snippets.length; attempt++) {
    try {
      const r = await fetch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q), {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', accept: 'text/html' },
      });
      html = await r.text();
      fs.writeFileSync('.tmp-scan/market/' + key + '.html', html);
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ');
      const parts = text.split(/(?<=[.!?])\s+/);
      snippets = [...new Set(parts.filter((p) => /\$[\d,]{3,}/.test(p) && p.length > 40 && p.length < 400))].slice(0, 5);
    } catch (e) { /* retry */ }
    if (!snippets.length) await new Promise((r) => setTimeout(r, 6000 * attempt));
  }
  out[key] = { query: q, snippets };
  console.log('\n=== ' + key + '  [' + q + ']');
  if (!snippets.length) console.log('  (no priced snippets found)');
  for (const s of snippets) console.log('  - ' + s.replace(/\s+/g, ' ').slice(0, 300));
  await new Promise((r) => setTimeout(r, 4000));
}
fs.writeFileSync('.tmp-scan/market/research.json', JSON.stringify(out, null, 1));
console.log('\nSaved .tmp-scan/market/research.json');
