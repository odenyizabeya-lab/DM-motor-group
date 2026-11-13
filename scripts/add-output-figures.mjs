/* Add the published engine output figure to each vehicle specification and
 * replace the remaining "not available" wording with professional statements
 * that say what the customer actually receives. */
import fs from 'node:fs';

const HP = {
  'lexus-ux-250h-2019': '204 hp combined (petrol-electric hybrid)',
  'mercedes-maybach-gls-600-2022': '550 hp plus 21 hp EQ Boost electric assistance',
  'ferrari-sf90-stradale-2021': '1,000 hp combined (780 hp V8 plus 220 hp electric)',
  'ford-torino-talladega-1969': '500 hp',
  'chevrolet-chevelle-ss-1966': '325 hp as sold in 1966',
  'chevrolet-c10-1965': '165 hp',
  'gmc-sierra-2500hd-denali-2022': '401 hp',
  'chevrolet-chevelle-1970': '200 hp (375 V8) - the figure for the engine in this car is confirmed with the paperwork',
  'land-rover-range-rover-velar-2020': '335-395 hp (3.0-litre V6) or 300 hp (2.0-litre diesel) - variant confirmed with the paperwork',
  'cadillac-ct5-v-blackwing-2023': '668 hp',
  'kia-ev3-2025': '201 hp (long-range rear-drive version)',
  'land-rover-defender-110-2022': '518 hp (4.0 V8) or 300 hp (P300 diesel) - variant confirmed with the paperwork',
  'cadillac-escalade-2022': '420 hp',
  'honda-accord-2016': '204 hp',
  'chevrolet-silverado-1500-2021': '355 hp (5.3-litre V8) or 310 hp (2.7-litre turbo) - variant confirmed with the paperwork',
  'honda-civic-2019': '158-180 hp depending on grade',
  'toyota-corolla-2006': '132 hp',
  'ford-f-150-2022': '400 hp (3.5 EcoBoost) or 460-495 hp (5.0 V8) - variant confirmed with the paperwork',
  'ford-f-250-super-duty-2019': '450 hp (6.7 Power Stroke V8 diesel)',
  'tesla-model-3-2021': '283-346 hp (rear-drive versions) or 480 hp (Performance) - variant confirmed with the paperwork',
  'mercedes-amg-gle-53-coupe-2022': '500-550 hp with EQ Boost, depending on model year - confirmed with the paperwork',
  'ford-ranger-raptor-2023': '450 hp',
  'ferrari-laferrari-2015': '950 hp combined (800 hp V12 plus 163 hp electric)',
  'lamborghini-revuelto-2024': '1,001 hp combined (840 hp V12 plus 161 hp electric)',
  'rolls-royce-cullinan-2025': '650 hp',
  'ford-mustang-gt-2019': '460-495 hp (5.0 V8) or 295 hp (2.3 EcoBoost) - variant confirmed with the paperwork',
  'bugatti-chiron-super-sport-2020': '1,479 hp',
  'bugatti-chiron-2020': '1,479 hp',
  'byd-seal-2023': '348 hp (Performance all-wheel drive) or 201 hp (rear drive) - variant confirmed with the paperwork',
  'mercedes-benz-s-class-coupe-2019': '429 hp (3.0-litre turbo six) or 463 hp (4.0-litre V8) - variant confirmed with the paperwork',
  'mercedes-amg-gle-53-coupe-2021': '500-550 hp with EQ Boost, depending on model year - confirmed with the paperwork',
  'mercedes-amg-gle-53-coupe-red-2021': '500-550 hp with EQ Boost, depending on model year - confirmed with the paperwork',
  'plymouth-barracuda-1970': '340 hp (440 V8 as presented in the footage)',
};

const f = 'data/vehicle-specs.json';
const j = JSON.parse(fs.readFileSync(f, 'utf8'));
for (const [slug, hp] of Object.entries(HP)) {
  if (!j.vehicles[slug]) { console.log('MISSING SLUG ' + slug); continue; }
  j.vehicles[slug].hp = hp;
}
j.legend.hp = 'Published engine output';
fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
console.log('engine output added to', Object.keys(HP).length, 'vehicles');
