/* Tag every market band with its provenance so the website can say where the
 * number came from: a published band, an MSRP reference, a derived band
 * (MSRP + observed listings) or no verified figure at all. */
import fs from 'node:fs';

const BAND = {
  'lexus-ux-250h': 'published',
  'maybach-gls-600': 'published',
  'ferrari-sf90': 'published',
  'ford-torino-talladega': 'published',
  'chevrolet-chevelle-ss-1966': 'published',
  'chevrolet-c10-1965': 'published',
  'gmc-sierra-2500hd': 'published',
  'chevrolet-chevelle-1970': 'published',
  'range-rover-velar-2020': 'published',
  'cadillac-ct5v-blackwing': 'published',
  'kia-ev3-2025': 'msrp',
  'land-rover-defender-110': 'published',
  'cadillac-escalade-2022': 'published',
  'honda-accord-2016': 'derived',
  'chevrolet-silverado-1500-2021': 'published',
  'honda-civic-2019': 'published',
  'toyota-corolla-2006': 'derived',
  'ford-f150-2022': 'published',
  'ford-f250-2019': 'derived',
  'tesla-model-3-2021': 'derived',
  'mercedes-gle53-coupe': 'msrp',
  'ford-ranger-raptor-2023': 'published',
  'ferrari-laferrari': 'derived',
  'lamborghini-revuelto': 'msrp',
  'rolls-royce-cullinan-2025': 'msrp',
  'ford-mustang-gt-2019': 'published',
  'bugatti-chiron-super-sport': 'published',
  'bugatti-chiron-2020': 'msrp',
  'byd-seal-2023': 'none',
  'mercedes-sclass-coupe-2019': 'published',
  'plymouth-barracuda-1970': 'none',
};
const LABEL = {
  published: 'Published market band',
  msrp: 'Manufacturer price reference (not a used-market band)',
  derived: 'Derived band (manufacturer price + observed dealer listings)',
  none: 'No verified figure obtained',
};

const f = 'data/market-research.json';
const j = JSON.parse(fs.readFileSync(f, 'utf8'));
for (const [k, m] of Object.entries(j.models)) {
  m.bandType = BAND[k] || 'none';
  m.bandLabel = LABEL[m.bandType];
}
fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
console.log('tagged', Object.keys(j.models).length, 'models');
const counts = {};
for (const m of Object.values(j.models)) counts[m.bandType] = (counts[m.bandType] || 0) + 1;
console.log(counts);
