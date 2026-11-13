/* Compact complete listing of every vehicle specification (for review). */
import fs from 'node:fs';
const specs = JSON.parse(fs.readFileSync('data/vehicle-specs.json', 'utf8'));
const details = JSON.parse(fs.readFileSync('public/details/vehicles.json', 'utf8'));
const DOCS = 'On the registration documents (issued with the vehicle papers)';
const MI = 'Confirmed at handover (odometer photo + service record supplied)';

Object.keys(specs.vehicles).forEach((slug, i) => {
  const v = specs.vehicles[slug];
  const d = details.vehicles[slug];
  const t = (x) => {
    let s = String(x);
    if (s === 'Held on the registration documents - issued with the vehicle papers') return DOCS;
    if (s === 'Confirmed at handover - odometer photo and service record supplied with the vehicle') return MI;
    return s;
  };
  console.log(`\n### ${i + 1}. ${v.yr} ${v.mk} ${v.md}  —  /vehicles/${slug}`);
  console.log(`Make: ${t(v.mk)}  |  Model: ${t(v.md)}  |  Year: ${t(v.yr)}  |  Exterior colour: ${t(v.ext)}  |  Interior colour: ${t(v.int)}`);
  console.log(`Body type: ${t(v.body)}  |  Trim and variant: ${t(v.trim)}`);
  console.log(`Engine number: ${t(v.engNo)}  |  VIN / chassis number: ${t(v.vin)}  |  Registration year: ${t(v.reg)}  |  Mileage: ${t(v.mile)}`);
  console.log(`Engine capacity: ${t(v.cap)}  |  Engine type: ${t(v.engType)}  |  Output: ${t(v.hp)}`);
  console.log(`Fuel: ${t(v.fuel)}  |  Transmission: ${t(v.trans)}  |  Drivetrain: ${t(v.drive)}  |  Doors: ${t(v.doors)}  |  Seats: ${t(v.seats)}`);
  console.log(`Air conditioning: ${t(v.ac)}  |  Navigation: ${t(v.nav)}  |  Reverse camera: ${t(v.cam)}  |  Parking sensors: ${t(v.sens)}`);
  console.log(`Sunroof: ${t(v.roof)}  |  Alloy wheels: ${t(v.wheels)}`);
  console.log(`Safety features: ${t(v.safety)}`);
  console.log(`Other equipment: ${t(v.equip)}`);
  console.log(`Price: ${d.market.askingPrice ? d.market.currency + ' ' + Number(d.market.askingPrice).toLocaleString() : 'Price on request'}  |  Recommended: ${d.market.recommendedAskingPrice ? d.market.currency + ' ' + Number(d.market.recommendedAskingPrice).toLocaleString() : 'none yet'}  |  Market: ${d.market.estimatedRange} [${d.market.source}]`);
  for (const x of d.disclosures) console.log(`DISCLOSURE: ${x}`);
});
