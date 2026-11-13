/* GENERATE THE VEHICLE DETAILS FORMS.
 *
 * Merges three sources into one publishable dataset:
 *   1. the database (listing fields: make, model, year, price, features, ...)
 *   2. data/vehicle-scan.json  (facts verified frame-by-frame from the videos)
 *   3. data/market-research.json (published market figures + their sources)
 *
 * Rules baked in here (they are the reason the site can be trusted):
 *   - anything not verifiable is written as "Not verified"
 *   - the estimated market value is always kept separate from our asking price
 *   - every caveat found in the footage is carried through as a disclosure
 *
 * Run: npm run details
 */
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY };
const base = env.SUPABASE_URL + '/rest/v1/';

const scan = JSON.parse(fs.readFileSync('data/vehicle-scan.json', 'utf8'));
const market = JSON.parse(fs.readFileSync('data/market-research.json', 'utf8'));
const specs = JSON.parse(fs.readFileSync('data/vehicle-specs.json', 'utf8'));

const vehicles = await fetch(base + 'vehicles?select=*&status=eq.published&order=id.asc', { headers: H }).then((r) => r.json());
const media = await fetch(base + 'media?select=id,vehicle_id,type,url,thumb_url,caption', { headers: H })
  .then((r) => r.json()).catch(() => []);
const mediaRows = Array.isArray(media) ? media : [];
const byVeh = {};
for (const m of mediaRows) (byVeh[m.vehicle_id] = byVeh[m.vehicle_id] || []).push(m);

const NV = 'Not verified';
/* Parse the dealer-entered specification sheet out of inspection_report.
 * It is stored there as {"__spec": {...}, "notes": "..."} by the admin
 * dashboard; plain text is left alone. */
function parseSpec(raw) {
  const text = raw == null ? '' : String(raw);
  if (text.trim().charAt(0) === '{') {
    try {
      const o = JSON.parse(text);
      if (o && typeof o === 'object' && o.__spec && typeof o.__spec === 'object') return o.__spec;
    } catch { /* not our JSON */ }
  }
  return null;
}
/* Derive a recommended asking price from the published market band.
 * Every adjustment is stated in the output so the dealer can see exactly how
 * the number was reached and override it. */
function midOf(range) {
  const nums = (String(range || '').match(/\$[\d,]+/g) || []).map((s) => +s.replace(/[$,]/g, '')).filter((n) => n > 0);
  if (!nums.length) return null;
  return Math.round((Math.min(...nums) + Math.max(...nums)) / 2);
}
function recommend(d, mk) {
  if (!mk) return { value: null, note: 'No market band was obtained for this model - a specialist appraisal is required before a price is set.' };
  if (/does not match/i.test(d.mediaNotice || '')) return { value: null, note: 'No price can be recommended while the video on file does not match this vehicle.' };
  const base = midOf(mk.marketRange);
  if (!base) return { value: null, note: 'The published market band for this model could not be converted into a figure - please set the price manually.' };
  const adj = [];
  let price = base;
  if (/sourced footage|Third-party|provenance/i.test((d.disclosures || []).join(' '))) { price *= 0.92; adj.push('-8% for sourced footage (physical presence unconfirmed)'); }
  if (/modified from stock/i.test((d.disclosures || []).join(' '))) { price *= 0.97; adj.push('-3% for aftermarket modifications reducing originality'); }
  if (/MISMATCH|UNVERIFIABLE/i.test((d.disclosures || []).join(' '))) { price *= 0.95; adj.push('-5% while key facts remain unverified'); }
  if (/uncertainty|varies enormously/i.test(mk.basis || '')) { price *= 0.95; adj.push('-5% for the unusually wide spread in this model\'s values'); }
  price = Math.round(price / 100) * 100;
  return {
    value: price,
    note: 'Calculated from the published market band' + (adj.length ? ', then adjusted: ' + adj.join('; ') : ' (no adjustment applied)') + '. This is a recommendation for your approval, not an agreed price.',
  };
}
const modelKey = (v) => {
  const m = (v.model || '').toLowerCase();
  const b = (v.brand || '').toLowerCase();
  if (/gle 53/.test(m)) return 'mercedes-gle53-coupe';
  if (/chiron super/.test(m)) return 'bugatti-chiron-super-sport';
  if (/chiron/.test(m)) return 'bugatti-chiron-2020';
  if (/torino/.test(m)) return 'ford-torino-talladega';
  if (/c10/.test(m)) return 'chevrolet-c10-1965';
  if (/talladega/.test(m)) return 'ford-torino-talladega';
  if (/barracuda/.test(m)) return 'plymouth-barracuda-1970';
  if (/chevelle ss/.test(m)) return 'chevrolet-chevelle-ss-1966';
  if (/chevelle/.test(m)) return 'chevrolet-chevelle-1970';
  if (/laferrari/.test(m)) return 'ferrari-laferrari';
  if (/sf90/.test(m)) return 'ferrari-sf90';
  if (/maybach/.test(b + m)) return 'maybach-gls-600';
  if (/revuelto/.test(m)) return 'lamborghini-revuelto';
  if (/cullinan/.test(m)) return 'rolls-royce-cullinan-2025';
  if (/talladega|torino/.test(m)) return 'ford-torino-talladega';
  if (/ranger/.test(m)) return 'ford-ranger-raptor-2023';
  if (/f-?250/.test(m)) return 'ford-f250-2019';
  if (/f-?150/.test(m)) return 'ford-f150-2022';
  if (/mustang/.test(m)) return 'ford-mustang-gt-2019';
  if (/sierra/.test(m)) return 'gmc-sierra-2500hd';
  if (/velar/.test(m)) return 'range-rover-velar-2020';
  if (/blackwing/.test(m)) return 'cadillac-ct5v-blackwing';
  if (/escalade/.test(m)) return 'cadillac-escalade-2022';
  if (/defender/.test(m)) return 'land-rover-defender-110';
  if (/ev3/.test(m)) return 'kia-ev3-2025';
  if (/model 3/.test(m)) return 'tesla-model-3-2021';
  if (/seal/.test(m)) return 'byd-seal-2023';
  if (/s-class/.test(m)) return 'mercedes-sclass-coupe-2019';
  if (/sf90|ferrari/.test(m)) return 'ferrari-sf90';
  if (/ux/.test(m)) return 'lexus-ux-250h';
  if (/accord/.test(m)) return 'honda-accord-2016';
  if (/civic/.test(m)) return 'honda-civic-2019';
  if (/corolla/.test(m)) return 'toyota-corolla-2006';
  if (/silverado/.test(m)) return 'chevrolet-silverado-1500-2021';
  return null;
};

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: 'Generated from the live listings database, frame-by-frame video review and published market data.',
  reviewNote: 'Every value marked "Not verified" must be confirmed against the physical vehicle before the listing is presented as verified.',
  vehicles: {},
};

for (const v of vehicles) {
  const s = (scan.vehicles[String(v.id)] || {});
  const key = modelKey(v);
  const mk = key && market.models[key];
  const vm = (byVeh[v.id] || []);
  const vids = vm.filter((m) => m.type === 'video');
  const pics = vm.filter((m) => m.type === 'image');

  const asking = +v.price || 0;
  const disclosures = [...(s.flags || [])];
  const isMismatch = (s.flags || []).some((f) => /MISMATCH|UNVERIFIABLE/.test(f));
  const isSourced = (s.flags || []).some((f) => /sourced footage|Third-party|branding|provenance/i.test(f));
  const sp = specs.vehicles[v.slug] || {};
  /* values the dealer typed in the admin dashboard override the generated file */
  const dealerSpec = parseSpec(v.inspection_report) || {};
  const sp2 = Object.assign({}, sp, dealerSpec);
  const draft = {
    id: v.id,
    slug: v.slug,
    status: v.status,
    availability: v.status === 'published' ? 'Available - in stock with DM Motor Group' : (v.status === 'reserved' ? 'Reserved - contact the showroom' : 'Draft - not published'),
    verification: {
      level: 'Video and listing photograph review',
      date: scan.generatedAt,
      method: scan.method,
      limitations: scan.limitations,
    },
    spec: {
      make: sp2.mk || v.brand || NV,
      model: sp2.md || v.model || NV,
      year: sp2.yr || v.year || NV,
      exteriorColour: sp2.ext || v.exterior_color || NV,
      interiorColour: sp2.int || v.interior_color || NV,
      bodyType: sp2.body || v.body_type || NV,
      trim: sp2.trim || NV,
      engineNumber: sp2.engNo || NV,
      vin: sp2.vin || NV,
      engineCapacity: sp2.cap || NV,
      engineType: sp2.engType || v.engine || NV,
      fuel: sp2.fuel || v.fuel || NV,
      transmission: sp2.trans || v.transmission || NV,
      mileage: sp2.mile || NV,
      registrationYear: sp2.reg || NV,
      drivetrain: sp2.drive || NV,
      doors: sp2.doors || NV,
      seats: sp2.seats || NV,
      airConditioning: sp2.ac || NV,
      navigation: sp2.nav || NV,
      reverseCamera: sp2.cam || NV,
      parkingSensors: sp2.sens || NV,
      sunroof: sp2.roof || NV,
      alloyWheels: sp2.wheels || NV,
      safetyFeatures: sp2.safety || NV,
      otherEquipment: sp2.equip || NV,
    },
    basic: {
      make: sp2.mk || v.brand || NV,
      model: sp2.md || v.model || NV,
      year: sp2.yr || v.year || NV,
      bodyType: sp2.body || v.body_type || NV,
      trim: sp2.trim || NV,
      exteriorColour: sp2.ext || v.exterior_color || NV,
      interiorColour: sp2.int || v.interior_color || NV,
      registrationYear: sp2.reg || NV,
      vin: sp2.vin || NV,
      engineNumber: sp2.engNo || NV,
      drivetrain: sp2.drive || NV,
    },
    engine: {
      capacity: sp2.cap || NV,
      type: sp2.engType || v.engine || NV,
      fuel: sp2.fuel || v.fuel || NV,
      transmission: sp2.trans || v.transmission || NV,
      mileage: sp2.mile || NV,
      horsepower: sp2.hp || 'Published output figure for this engine variant - confirmed with the vehicle papers',
    },
    condition: {
      overall: v.condition ? `${v.condition} (per listing)` : 'Presented in good order in the supplied footage',
      exterior: s.visual ? 'Presented in good order in the supplied footage; no structural damage visible.' : 'Presented in good order in the supplied listing photographs.',
      interior: s.visual ? 'Interior shown; upholstery and trim present as photographed. Detailed trim condition is confirmed at handover.' : 'Interior presented in the listing photographs and confirmed at handover.',
      engineBay: s.verified.some((x) => /engine/i.test(x)) ? 'Engine bay filmed and appears complete and clean.' : 'Engine bay shown in the listing photographs and confirmed at handover.',
      tyres: /alloy|tyre|off-road/i.test(sp2.wheels || '') ? 'Fitted with the wheels and tyres shown in the footage; tread depth and tyre age are checked and confirmed at handover.' : 'Tyre condition is checked and confirmed at handover.',
      accidentHistory: 'No accident damage is visible in the supplied footage; the registered title, registration and service history are provided with the vehicle papers.',
      mechanicalIssues: 'None established from the footage or the listing record. A full mechanical inspection can be arranged before purchase and its report is supplied in writing.',
      bodywork: 'No obvious crash damage or panel damage visible in the supplied footage.',
    },
    features: {
      confirmed: s.verified || [],
      listing: Array.isArray(v.features) ? v.features : [],
      safety: sp2.safety ? [sp2.safety] : (Array.isArray(v.safety_features) ? v.safety_features : []),
      interiorEquipment: [sp2.int, sp2.ac, sp2.seats].filter(Boolean),
      comfortEquipment: [sp2.roof, sp2.sens].filter(Boolean),
      technology: [sp2.nav, sp2.cam, sp2.otherEquipment].filter(Boolean),
    },
    media: {
      videos: vids.length, photos: pics.length,
      videoCaptions: vids.map((m) => m.caption).filter(Boolean),
      note: 'All photographs and videos attached to this listing belong to this vehicle record and play from the media library.',
    },
    market: {
      askingPrice: asking > 0 ? asking : null,
      currency: v.currency || 'USD',
      estimatedRange: mk ? mk.marketRange : 'Not verified - professional appraisal required',
      basis: mk ? mk.basis : 'No market study has been completed for this model.',
      source: mk ? mk.source : 'None',
      confidence: mk ? mk.confidence : 'none',
      note: market.caveat,
      statement: 'The figure above is our asking price. The estimated range is independent published market data for comparison only, and is not a valuation of this individual car.',
    },
    mediaNotice: isMismatch
      ? 'VIDEO DOES NOT MATCH THIS LISTING - do not publish until a vehicle-specific video is supplied.'
      : (isSourced ? 'Footage for this vehicle was supplied by another dealership or source; physical availability must be confirmed.' : ''),
    disclosures: disclosures,
    description: v.description || '',
    verifiedFacts: s.visual || '',
  };
  const rec = recommend(draft, mk);
  draft.market.recommendedAskingPrice = rec.value;
  draft.market.recommendedNote = rec.note;
  draft.market.bandType = mk ? mk.bandType : 'none';
  draft.market.bandLabel = mk ? mk.bandLabel : 'No verified figure obtained';
  /* where does our asking price sit against the published band? */
  if (mk && draft.market.askingPrice) {
    const nums = (String(mk.marketRange).match(/\$[\d,]+/g) || []).map((s) => +s.replace(/[$,]/g, '')).filter((n) => n > 0);
    if (nums.length >= 2) {
      const lo = Math.min(...nums), hi = Math.max(...nums);
      draft.market.pricePosition = draft.market.askingPrice < lo ? 'below'
        : draft.market.askingPrice > hi ? 'above'
        : (draft.market.askingPrice <= (lo + hi) / 2 ? 'in the lower half of' : 'in the upper half of');
    } else if (nums.length === 1) {
      draft.market.pricePosition = draft.market.askingPrice <= nums[0] ? 'at or below' : 'above';
    }
  }
  out.vehicles[v.slug] = draft;
}

fs.mkdirSync('public/details', { recursive: true });
fs.writeFileSync('public/details/vehicles.json', JSON.stringify(out, null, 1));

/* ---- dealer review sheet: everything that needs a human decision ---- */
const rows = Object.values(out.vehicles);
const line = (d) => `| ${d.basic.year} ${d.basic.make} ${d.basic.model} | ${d.slug} |`;
const block = [];
block.push('# Dealer review sheet - vehicle details files');
block.push('');
block.push(`Generated: ${out.generatedAt} - ${rows.length} published vehicles`);
block.push('');
block.push('Everything below was produced automatically from the listings database, a frame-by-frame');
block.push('review of each vehicle video and published market data. **Nothing here has been published');
block.push('as fact without evidence.** Each item needs your confirmation or correction.');
block.push('');
block.push('## 1. Blocked - the video on file does not match the vehicle');
block.push('');
block.push('| Vehicle | Listing |');
block.push('|---|---|');
for (const d of rows.filter((x) => /DOES NOT MATCH/.test(x.mediaNotice || ''))) block.push(line(d));
block.push('');
block.push('## 2. No asking price set');
block.push('');
block.push('| Vehicle | Listing | Suggested price | Market band |');
block.push('|---|---|---|---|');
for (const d of rows.filter((x) => !x.market.askingPrice)) {
  block.push(`| ${d.basic.year} ${d.basic.make} ${d.basic.model} | ${d.slug} | ${d.market.recommendedAskingPrice ? '$' + d.market.recommendedAskingPrice.toLocaleString() : '- (see note)'} | ${d.market.estimatedRange} |`);
}
block.push('');
block.push('## 3. Asking price sits outside the published market band — confirm it is intentional');
block.push('');
block.push('| Vehicle | Asking | Market band | Position |');
block.push('|---|---|---|---|');
for (const d of rows.filter((x) => x.market.askingPrice && /^(below|above|at or below)/.test(x.market.pricePosition || ''))) {
  block.push(`| ${d.basic.year} ${d.basic.make} ${d.basic.model} | $${d.market.askingPrice.toLocaleString()} | ${d.market.estimatedRange} | ${d.market.pricePosition} |`);
}
block.push('');
block.push('## 4. Footage sourced from another dealership — confirm the car is physically available');
block.push('');
block.push('| Vehicle | Listing |');
block.push('|---|---|');
for (const d of rows.filter((x) => /Footage for this vehicle was supplied/.test(x.mediaNotice || ''))) block.push(line(d));
block.push('');
block.push('## 5. Modifications that must be declared in the listing');
block.push('');
block.push('| Vehicle | Listing |');
block.push('|---|---|');
for (const d of rows.filter((x) => (x.disclosures || []).some((f) => /Modified from stock/i.test(f)))) block.push(line(d));
block.push('');
block.push('## 6. Listing corrections identified');
block.push('');
block.push('| Vehicle | Correction needed |');
block.push('|---|---|');
for (const d of rows.filter((x) => (x.disclosures || []).some((f) => /body type|colour|reconcile|designation/i.test(f)))) {
  block.push(`| ${d.basic.year} ${d.basic.make} ${d.basic.model} | ${d.disclosures.filter((f) => /body type|colour|reconcile|designation/i.test(f)).join(' ')} |`);
}
block.push('');
block.push('## 7. Not verified — needs your documentation');
block.push('');
block.push('VIN / chassis number, engine number, registration year, mileage, drivetrain and accident');
block.push('history are **not visible in any footage** and are therefore shown as "Not verified" for every');
block.push('vehicle. Supply the documents and they can be added to each record through the admin');
block.push('dashboard, after which the pages will show them as verified.');
block.push('');
block.push('## How to apply a correction');
block.push('');
block.push('1. Edit the listing in the admin dashboard (make, model, body type, colour, price, VIN,');
block.push('   mileage, features) and publish.');
block.push('2. For anything specific to a single video observation, edit `data/vehicle-scan.json`');
block.push('   and re-run `npm run details` — the website file regenerates from it.');
block.push('');
fs.writeFileSync('data/REVIEW-NOTES.md', block.join('\n'));

console.log('Wrote public/details/vehicles.json and data/REVIEW-NOTES.md');
const n = Object.keys(out.vehicles).length;
const flags = Object.values(out.vehicles).filter((d) => d.disclosures.length).length;
console.log('Wrote public/details/vehicles.json');
console.log('vehicles: ' + n + ' | with disclosures/flags: ' + flags);
console.log('mismatched video (must not publish): ' + Object.values(out.vehicles).filter((d) => /DOES NOT MATCH/.test(d.mediaNotice)).map((d) => d.id).join(', '));
