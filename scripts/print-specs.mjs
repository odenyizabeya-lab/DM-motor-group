/* Print the complete specification of every vehicle from the source dataset
 * as a readable markdown document (docs/VEHICLE-SPECIFICATIONS.md).
 * The long document-handling policy lines are shortened for readability here;
 * the website shows them in full. */
import fs from 'node:fs';

const specs = JSON.parse(fs.readFileSync('data/vehicle-specs.json', 'utf8'));
const details = JSON.parse(fs.readFileSync('public/details/vehicles.json', 'utf8'));
const L = specs.legend;

const SHORT = {
  'Held on the registration documents - issued with the vehicle papers': 'On the registration documents - issued with the vehicle papers',
  'Confirmed at handover - odometer photo and service record supplied with the vehicle': 'Confirmed at handover - odometer photo and service record supplied with the vehicle',
};
const shorten = (v) => {
  const s = String(v);
  if (SHORT[s]) return SHORT[s];
  return s.replace(/ - issued with the vehicle papers$/, ' (issued with the vehicle papers)');
};

const ORDER = [
  ['mk', 'Make'], ['md', 'Model'], ['yr', 'Year of manufacture'],
  ['ext', 'Exterior colour'], ['int', 'Interior colour'], ['body', 'Body type'],
  ['trim', 'Trim and variant'], ['engNo', 'Engine number'], ['vin', 'VIN / chassis number'],
  ['cap', 'Engine capacity'], ['engType', 'Engine type'], ['fuel', 'Fuel type'],
  ['trans', 'Transmission'], ['mile', 'Mileage'], ['reg', 'Registration year'],
  ['drive', 'Drivetrain'], ['doors', 'Number of doors'], ['seats', 'Number of seats'],
  ['ac', 'Air conditioning'], ['nav', 'Navigation system'], ['cam', 'Reverse camera'],
  ['sens', 'Parking sensors'], ['roof', 'Sunroof'], ['wheels', 'Alloy wheels'],
  ['safety', 'Safety features'], ['equip', 'Other available equipment'],
];

const out = [];
out.push('# Complete vehicle specifications — every published vehicle');
out.push('');
out.push(`Generated from data/vehicle-specs.json (${Object.keys(specs.vehicles).length} vehicles).`);
out.push('Every field below is written out for each car. Registration numbers (VIN / engine');
out.push('number / registration year) and the odometer reading are document-backed values issued');
out.push('with the vehicle papers, not invented numbers.');
out.push('');
out.push('| # | Vehicle | Page |');
out.push('|---|---|---|');
Object.keys(specs.vehicles).forEach((slug, i) => {
  const v = specs.vehicles[slug];
  out.push(`| ${i + 1} | ${v.yr} ${v.mk} ${v.md} | /vehicles/${slug} |`);
});
out.push('');

Object.keys(specs.vehicles).forEach((slug, i) => {
  const v = specs.vehicles[slug];
  const d = details.vehicles[slug];
  out.push('');
  out.push('---');
  out.push('');
  out.push(`## ${i + 1}. ${v.yr} ${v.mk} ${v.md}`);
  out.push('');
  out.push(`\`${slug}\` · /vehicles/${slug}`);
  out.push('');
  for (const [key, label] of ORDER) {
    out.push(`- **${label}:** ${shorten(v[key])}`);
  }
  if (v.hp) out.push(`- **Published engine output:** ${v.hp}`);
  if (d) {
    out.push(`- **Our asking price:** ${d.market.askingPrice ? d.market.currency + ' ' + Number(d.market.askingPrice).toLocaleString() : 'Price on request (see the recommended figure below)'}`);
    out.push(`- **Recommended asking price:** ${d.market.recommendedAskingPrice ? d.market.currency + ' ' + Number(d.market.recommendedAskingPrice).toLocaleString() : 'Not recommended yet — ' + d.market.recommendedNote}`);
    out.push(`- **Estimated market range:** ${d.market.estimatedRange} (${d.market.bandLabel}; source: ${d.market.source}; confidence: ${d.market.confidence})`);
    if (d.disclosures.length) {
      out.push('- **Disclosures:**');
      for (const x of d.disclosures) out.push(`  - ${x}`);
    }
  }
  out.push('');
});

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/VEHICLE-SPECIFICATIONS.md', out.join('\n'));
console.log('wrote docs/VEHICLE-SPECIFICATIONS.md |', out.length, 'lines |', out.join('\n').length, 'chars');
