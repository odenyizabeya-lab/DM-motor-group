'use strict';
/* DM Motor Group — database seeder: settings, staff accounts, demo inventory, banners, testimonials */
const fs = require('fs');
const path = require('path');
const { db, q, hashPassword, logActivity } = require('./lib/db');

const IMG_DIR = path.join(__dirname, 'public', 'assets', 'img');
fs.mkdirSync(IMG_DIR, { recursive: true });
fs.mkdirSync(path.join(__dirname, 'uploads', 'banners'), { recursive: true });

/* rebuild images every seed */
for (const f of fs.readdirSync(IMG_DIR)) if (f.endsWith('.svg')) fs.unlinkSync(path.join(IMG_DIR, f));

/* ---------- SVG "photography" generator (placeholder studio shots for demo inventory) ---------- */
const SIL = {
  sedan: 'M20 66 q18 -22 48 -26 q10 -12 30 -14 q22 -2 34 8 q26 4 44 18 l10 4 q8 4 8 12 l-4 8 H8 q-4 -10 12 -10z',
  suv: 'M14 70 q4 -14 20 -18 q6 -16 26 -20 h52 q22 4 30 18 q14 2 22 8 q8 4 8 12 l-4 6 H10 q-4 -6 4 -6z',
  sports: 'M10 74 q30 -26 70 -28 q18 -10 44 -6 q30 4 50 18 l10 6 q8 6 6 12 l-4 4 H14 q-6 -4 -4 -6z',
  truck: 'M10 76 q2 -10 14 -12 h6 v-26 h64 v26 h76 q12 2 14 10 l-2 6 H12z',
};
function carSvg({ label, color, bg1, bg2, sil, sub }) {
  const wheels = sil === 'truck' ? [38, 132] : sil === 'sports' ? [40, 150] : [42, 148];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid meet">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
  <linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, -28)}"/></linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.3" r="0.9"><stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1920" height="1080" fill="url(#bg)"/><rect width="1920" height="1080" fill="url(#glow)"/>
<rect x="0" y="860" width="1920" height="220" fill="#0b0d10"/><ellipse cx="960" cy="884" rx="820" ry="46" fill="#000" opacity="0.5"/>
<g transform="translate(430,430) scale(6.2)">
  <path d="${SIL[sil] || SIL.sedan}" fill="url(#body)" stroke="rgba(0,0,0,.35)" stroke-width="1.4"/>
  <path d="${SIL[sil] || SIL.sedan}" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="0.8" transform="translate(0,-1.5)"/>
  <rect x="66" y="42" width="30" height="14" rx="4" fill="#aee3ff" opacity="0.75"/>
  <rect x="102" y="40" width="26" height="14" rx="4" fill="#aee3ff" opacity="0.6"/>
  ${wheels.map((x) => `<circle cx="${x}" cy="84" r="13" fill="#14161a"/><circle cx="${x}" cy="84" r="7.5" fill="#3a3f47"/><circle cx="${x}" cy="84" r="3" fill="#8b929c"/>`).join('')}
  <rect x="6" y="70" width="10" height="5" rx="2" fill="#ffd9a0"/><rect x="182" y="70" width="10" height="5" rx="2" fill="#ff8f8f"/>
</g>
<text x="50%" y="906" text-anchor="middle" font-family="Georgia,serif" font-size="52" fill="#f5f2ea" letter-spacing="6">${label}</text>
<text x="50%" y="960" text-anchor="middle" font-family="Arial" font-size="26" fill="#9aa3ad" letter-spacing="3">${sub}</text>
<text x="40" y="1040" font-family="Arial" font-size="22" fill="#6e7681">DM Motor Group — demo placeholder. Replace with genuine photography in Admin → Media.</text>
</svg>`;
}
function interiorSvg({ label, tone }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid meet">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${tone}"/><stop offset="1" stop-color="#101317"/></linearGradient></defs>
<rect width="1920" height="1080" fill="url(#bg)"/>
<g fill="#0c0e11" stroke="#2a2f36" stroke-width="6">
 <path d="M-40 300 q420 -60 640 80 l40 520 H-40z"/>
 <rect x="760" y="330" width="420" height="330" rx="60"/>
 <path d="M1240 260 q420 -20 760 90 l-30 570 h-700z"/>
</g>
<g fill="#171b20"><rect x="820" y="700" width="330" height="200" rx="24"/><rect x="1180" y="760" width="240" height="150" rx="20"/></g>
<rect x="700" y="150" width="560" height="260" rx="40" fill="#0a0c0f"/><circle cx="1000" cy="280" r="90" fill="#10141a" stroke="#3d434c" stroke-width="6"/><rect x="905" y="258" width="190" height="10" rx="5" fill="#6fd1ff"/>
<g fill="#e8e2d4" opacity="0.5"><circle cx="835" cy="745" r="10"/><circle cx="875" cy="745" r="10"/><rect x="1230" y="800" width="120" height="30" rx="8"/></g>
<text x="50%" y="965" text-anchor="middle" font-family="Georgia,serif" font-size="46" fill="#f5f2ea" letter-spacing="5">${label}</text>
<text x="40" y="1040" font-family="Arial" font-size="22" fill="#6e7681">DM Motor Group — demo placeholder. Replace with genuine photography in Admin → Media.</text>
</svg>`;
}
function engineSvg({ label }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#131619"/>
<g stroke="#2c3238" stroke-width="8" fill="#1b2025"><rect x="520" y="300" width="880" height="420" rx="40"/><rect x="700" y="220" width="220" height="120" rx="24"/><rect x="1000" y="220" width="220" height="120" rx="24"/></g>
<rect x="560" y="620" width="800" height="70" rx="16" fill="#23292f"/><rect x="620" y="390" width="180" height="180" rx="30" fill="#20262c"/>
<circle cx="1420" cy="360" r="60" fill="#22282e" stroke="#39414a" stroke-width="8"/>
<text x="50%" y="840" text-anchor="middle" font-family="Georgia,serif" font-size="46" fill="#efe9dc" letter-spacing="5">${label}</text>
<text x="40" y="1040" font-family="Arial" font-size="22" fill="#6e7681">DM Motor Group — demo placeholder. Replace with genuine photography in Admin → Media.</text></svg>`;
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt * 2.55)), g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt * 2.55)), b = Math.max(0, Math.min(255, (n & 255) + amt * 2.55));
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}

const CARS = [
  { brand: 'Mercedes-Benz', model: 'S 580 4MATIC Sedan', year: 2023, price: 118900, mileage: 12400, engine: '4.0 L V8 Biturbo', transmission: 'Automatic 9G-TRONIC', fuel: 'Petrol', body: 'Sedan', ext: 'Obsidian Black', int: 'Macchiato Beige Nappa Leather', category: 'luxury', color: '#26272b', featured: 1, status: 'published', location: 'Dubai, UAE Showroom', vin: 'WDD2231761A342117',
    desc: 'Flagship S-Class in immaculate condition, one owner, full Mercedes-Benz service history. Executive rear cabin with reclining seats, Burmester 4D Surround and augmented-reality head-up display. Imported, duty paid, with complete documentation.' },
  { brand: 'BMW', model: 'X7 xDrive40i', year: 2022, price: 84500, mileage: 28900, engine: '3.0 L Inline-6 Mild-Hybrid', transmission: 'Automatic 8-Speed', fuel: 'Petrol', body: 'SUV', ext: 'Mineral White', int: 'Merino Coffee Leather', category: 'suv', color: '#e6e8ea', featured: 1, status: 'published', location: 'Dubai, UAE Showroom', vin: '5UX23EM06N9E12345',
    desc: 'Seven-seat luxury SUV with panoramic Sky Lounge roof, Live Cockpit Professional and adaptive air suspension. Dealer maintained with full records. New tyres fitted at delivery.' },
  { brand: 'Porsche', model: '911 Carrera (992)', year: 2021, price: 138000, mileage: 18600, engine: '3.0 L Flat-6 Twin-Turbo', transmission: 'PDK Dual-Clutch', fuel: 'Petrol', body: 'Coupe', ext: 'Guards Red', int: 'Black Leather', category: 'sports', color: '#b52a1e', featured: 1, status: 'reserved', location: 'Dubai, UAE Showroom', vin: 'WP0ZZZ99ZMS271208',
    desc: 'Immaculate 992 Carrera with Sport Chrono package, PASM sport suspension and BOSE Surround. Two owners, accident-free, Porsche Approved inspection completed this month. Reservation now under deposit.' },
  { brand: 'Tesla', model: 'Model S Plaid', year: 2023, price: 99500, mileage: 9200, engine: 'Tri-Motor Electric 1,020 hp', transmission: 'Single-Speed Automatic', fuel: 'Electric', body: 'Sedan', ext: 'Pearl White', int: 'Black & White Vegan Leather', category: 'electric', color: '#f2f3f5', featured: 0, status: 'published', location: 'Dubai, UAE Showroom', vin: '5YJSA1E62PF482301',
    desc: 'Three-motor Plaid with Full Self-Driving hardware, 21" Arachnid wheels and carbon-sleeved rotors. Battery health certified at 97%. Range 600 km (WLTP).' },
  { brand: 'Toyota', model: 'Land Cruiser 300 VX', year: 2022, price: 89000, mileage: 34800, engine: '3.5 L V6 Twin-Turbo', transmission: 'Automatic 10-Speed', fuel: 'Petrol', body: 'SUV', ext: 'Precious White Pearl', int: 'Beige Leather', category: 'suv', color: '#f4f1ea', featured: 1, status: 'published', location: 'Doha, Qatar Showroom', vin: 'JTMHV05J204109876',
    desc: 'GCC-specification Land Cruiser 300 VX-R with radar cruiser safety pack, rear entertainment and cool box. Single owner, Toyota service contract active until 2027.' },
  { brand: 'Land Rover', model: 'Range Rover Autobiography LWB', year: 2023, price: 142000, mileage: 21400, engine: '4.4 L V8 Twin-Turbo', transmission: 'Automatic 8-Speed', fuel: 'Petrol', body: 'SUV', ext: 'Santorini Black', int: 'Perlino & Ebony Semi-Aniline', category: 'luxury', color: '#1d1f23', featured: 0, status: 'sold', location: 'Dubai, UAE Showroom', vin: 'SALKPBE73PA112745',
    desc: 'Long-wheelbase Autobiography with Executive Class rear seating, Meridian Signature audio and soft-close doors. Sold to a private client; the vehicle record is retained for archive transparency.' },
  { brand: 'Audi', model: 'A8 L 55 TFSI quattro', year: 2022, price: 92300, mileage: 26300, engine: '3.0 L V6 TFSI Mild-Hybrid', transmission: 'Tiptronic 8-Speed', fuel: 'Petrol', body: 'Sedan', ext: 'Mythos Black', int: 'Valcona Leather Saddle Brown', category: 'sedan', color: '#232529', featured: 0, status: 'published', location: 'Dubai, UAE Showroom', vin: 'WAUZZZ8E3LA008512',
    desc: 'Executive A8 L with active suspension, HD Matrix LED headlights and rear-seat relaxation package. Comprehensive service history, last inspection passed with no advisories.' },
  { brand: 'Lexus', model: 'LX 600 F Sport', year: 2023, price: 115000, mileage: 15200, engine: '3.4 L V6 Twin-Turbo', transmission: 'Automatic 10-Speed', fuel: 'Petrol', body: 'SUV', ext: 'UltraWhite', int: 'Circuit Red Leather', category: 'suv', color: '#f0f2f4', featured: 0, status: 'published', location: 'Doha, Qatar Showroom', vin: 'JTJGB7CX030126784',
    desc: 'F Sport specification with Torsen limited-slip differential, 25-speaker Mark Levinson audio and panoramic monitor pack. Balance of Lexus warranty applies.' },
  { brand: 'Ford', model: 'F-150 Lariat supercrew', year: 2021, price: 52800, mileage: 58200, engine: '3.5 L EcoBoost V6', transmission: 'Automatic 10-Speed', fuel: 'Petrol', body: 'Pickup', ext: 'Agate Grey', int: 'Black ActiveX', category: 'truck', color: '#6a6f75', featured: 0, status: 'published', location: 'Dubai, UAE Showroom', vin: '1FTFW1E85MFD22190',
    desc: 'Dependable Lariat trim with Pro Power Onboard, tailgate work surface and tow package rated to 5.4 t. Ex-fleet, two-year maintenance log included. Ideal for trade and commercial use.' },
  { brand: 'Mercedes-AMG', model: 'GT 63 S 4-Door', year: 2020, price: 118000, mileage: 41200, engine: '4.0 L V8 Biturbo 639 hp', transmission: 'AMG SPEEDSHIFT 9G', fuel: 'Petrol', body: 'Coupe', ext: 'AMG Green Hell Magno', int: 'AMG Nappa Black/Yellow', category: 'sports', color: '#5b6b1f', featured: 0, status: 'published', location: 'Dubai, UAE Showroom', vin: 'WDD2906881A557712',
    desc: 'Aero package with rear airfoil, carbon roof and AMG Dynamic Plus. Track-day prepared and dealer-inspected. Honest drive-away pricing — papers available on request.' },
  { brand: 'Toyota', model: 'Camry Hybrid Premium', year: 2023, price: 34900, mileage: 22800, engine: '2.5 L Hybrid 218 hp', transmission: 'e-CVT Automatic', fuel: 'Hybrid', body: 'Sedan', ext: 'Platinum Silver', int: 'Grey Fabric', category: 'family', color: '#c7cbcf', featured: 0, status: 'published', location: 'Dubai, UAE Showroom', vin: '4T1C31AK7PU700311',
    desc: 'Efficient family hybrid with Toyota Safety Sense 2.5+, wireless CarPlay and blind-spot monitor. Balance of 3-year manufacturer warranty and one free service.' },
  { brand: 'Volkswagen', model: 'ID.4 Pro Performance', year: 2023, price: 41200, mileage: 16700, engine: 'Single Motor Electric 204 hp', transmission: 'Single-Speed Automatic', fuel: 'Electric', body: 'SUV', ext: 'Moonstone Grey', int: 'Black Sensed Fabric', category: 'electric', color: '#8b9298', featured: 0, status: 'published', location: 'Dubai, UAE Showroom', vin: 'WVGTMPE27PP044512',
    desc: '62 kWh battery certified at 94% health, WLTP range 520 km, DC fast-charging to 135 kW. One owner, complete digital service file.' },
  { brand: 'Rolls-Royce', model: 'Ghost V12', year: 2022, price: 358000, mileage: 8400, engine: '6.75 L Twin-Turbo V12', transmission: 'Automatic 8-Speed', fuel: 'Petrol', body: 'Sedan', ext: 'Arctic White over Bespoke Gold', int: 'Bespoke Cashmere & Leather', category: 'luxury', color: '#f7f6f2', featured: 1, status: 'published', location: 'Dubai, UAE Showroom', vin: 'SCA666S00NUX81234',
    desc: 'A bespoke Ghost in Arctic White with 21" part-polished wheels, Starlight Headliner, RR Communications Lounge and azimuth Blue clock. Delivered new in this market, owner’s manual, umbrellas and tool set complete.' },
  { brand: 'Honda', model: 'CR-V e:HEV Executive', year: 2022, price: 29800, mileage: 31500, engine: '2.0 L Hybrid 184 hp', transmission: 'e-CVT Automatic', fuel: 'Hybrid', body: 'SUV', ext: 'Radiant Red', int: 'Black Fabric', category: 'family', color: '#a3262b', featured: 0, status: 'published', location: 'Dubai, UAE Showroom', vin: '7FARW2H87NE033455',
    desc: 'Well-kept Executive hybrid with heated front seats, Honda Sensing suite and power tailgate. Two keys, handbook pack and two stamped service visits.' },
  { brand: 'Porsche', model: 'Taycan 4S', year: 2022, price: 108900, mileage: 19300, engine: 'Dual-Motor Electric 530 hp', transmission: '2-Speed Automatic', fuel: 'Electric', body: 'Sedan', ext: 'Carmine Red', int: 'Slate Grey OLEA Club Leather', category: 'electric', color: '#8e1d22', featured: 1, status: 'published', location: 'Dubai, UAE Showroom', vin: 'WP0ZZZ9Y1NSI12345',
    desc: 'Taycan 4S with Performance Battery Plus, adaptive air suspension and Sport Chrono. Battery certificate supplied at listing; 800 V charging verified.' },
  { brand: 'Mercedes-Benz', model: 'G 63 AMG', year: 2021, price: 198000, mileage: 26400, engine: '4.0 L V8 Biturbo 585 hp', transmission: 'AMG SPEEDSHIFT 9G', fuel: 'Petrol', body: 'SUV', ext: 'Designo Cardinal Red', int: 'designo Nappa Black', category: 'luxury', color: '#7d1620', featured: 1, status: 'published', location: 'Doha, Qatar Showroom', vin: 'W1NYC7HJ0MX422190',
    desc: 'Night Package G 63 with carbon trim, Burmester 3D audio, 22" AMG cross-spoke forged wheels and rear-seat entertainment. Certified pre-owned with report on file.' },
];

/* write placeholder “studio” images per car */
function seedImages(idx, car, bodyCount = 4) {
  const files = [];
  const bgModes = [['#20242b', '#0c0e12'], ['#2b2f36', '#101318'], ['#39404a', '#15181d']];
  const sil = car.body === 'Coupe' ? 'sports' : car.body === 'Pickup' ? 'truck' : car.body === 'SUV' || car.body === 'Pickup' ? 'suv' : 'sedan';
  for (let i = 0; i < bodyCount; i++) {
    const angle = ['', 'side ', '', 'rear '][i] || '';
    const f = `car${idx}-${i}.svg`;
    fs.writeFileSync(path.join(IMG_DIR, f), carSvg({ label: `${car.brand} ${car.model.replace(/ supercrew| Sedan| L | \(992\)/, '')}`.toUpperCase(), color: car.color, bg1: bgModes[i % 3][0], bg2: bgModes[i % 3][1], sil, sub: `${car.year} · ${car.body} · ${car.ext} [${angle}angle]` }));
    files.push({ name: `/assets/img/${f}`, caption: `${angle || 'Studio'} exterior — demo photo`, category: 'exterior' });
  }
  const inner = [['Front cabin & dashboard', '#262b31'], ['Rear seating & legroom', '#20242a']];
  inner.forEach(([label, tone], i) => {
    const f = `car${idx}-int${i}.svg`;
    fs.writeFileSync(path.join(IMG_DIR, f), interiorSvg({ label: label.toUpperCase(), tone }));
    files.push({ name: `/assets/img/${f}`, caption: label + ' — demo photo', category: i ? 'interior' : 'dashboard' });
  });
  const fe = `car${idx}-eng.svg`;
  fs.writeFileSync(path.join(IMG_DIR, fe), engineSvg({ label: (car.fuel === 'Electric' ? 'E-DRIVETRAIN BAY' : 'ENGINE BAY').toUpperCase() }));
  files.push({ name: `/assets/img/${fe}`, caption: 'Engine bay — demo photo', category: car.fuel === 'Electric' ? 'engine' : 'engine' });
  return files;
}

/* ---------- wipe & seed ---------- */
if (process.argv.includes('--force')) {
  db.exec('DELETE FROM media; DELETE FROM vehicles; DELETE FROM banners; DELETE FROM testimonials; DELETE FROM enquiries; DELETE FROM favourites; DELETE FROM notifications; DELETE FROM activities; DELETE FROM reset_tokens; DELETE FROM users; DELETE FROM settings;');
  console.log('Existing data cleared (-force).');
}
if (q.get('SELECT id FROM users WHERE role = ? LIMIT 1', 'admin')) { console.log('Database already seeded (use --force to rebuild).'); process.exit(0); }

/* staff */
q.run('INSERT INTO users (email, password_hash, name, phone, role) VALUES (?,?,?,?,?)',
  'admin@dmmotorgroup.com', hashPassword('Admin#2026'), 'Platform Administrator', '+971 50 447 8712', 'admin');
q.run('INSERT INTO users (email, password_hash, name, phone, role) VALUES (?,?,?,?,?)',
  'sales@dmmotorgroup.com', hashPassword('Sales#2026'), 'Sofia Nakamura — Sales Director', '+971 55 300 2255', 'manager');

/* dealership settings */
const SETTINGS = {
  company_name: 'DM Motor Group',
  tagline: 'Premium international automobile dealership — verified vehicles, transparent pricing, worldwide delivery.',
  phone_main: '+971 4 584 2200', phone_sales: '+971 50 447 8712',
  whatsapp: '971504478712',
  email_sales: 'sales@dmmotorgroup.com', email_support: 'support@dmmotorgroup.com',
  address_primary: 'Showroom 4, Al Awir Auto Market, PO Box 22114, Dubai, United Arab Emirates',
  address_secondary: 'Marina District Showroom, Al Sadd, Doha, Qatar',
  hours: 'Mon–Sat 9:00–19:00 · Sunday showings by appointment',
  trade_license: 'DED Dubai — licence on display in showroom; verified copy viewable on inspection.',
  payment_info: 'Bank transfer to DM Motor Group FZC escrow account. Details are issued with the purchase agreement only — we never ask for deposits by card links or messaging apps. Bank charges for international wires are payable by the buyer.',
  inspection_note: 'Vehicles marked “dealership inspected” have passed our 150-point workshop inspection; “third-party inspected” carry an independent report. Reports are available in the showroom.',
  social_instagram: 'https://instagram.com/dmmotorgroup', social_facebook: 'https://facebook.com/dmmotorgroup', social_youtube: 'https://youtube.com/@dmmotorgroup', social_linkedin: 'https://linkedin.com/company/dmmotorgroup',
  currency: 'USD', per_page: '12', dev_reset_tokens: '1',
};
for (const [k, v] of Object.entries(SETTINGS)) q.run('INSERT INTO settings (key, value) VALUES (?,?)', k, v);

/* vehicles + media */
let idx = 0;
const carSeeds = CARS.map((c) => {
  idx += 1;
  const features = {
    luxury: ['Panoramic glass roof', 'Massage & ventilation seats', 'Burmester / Mark Levinson audio', 'Ambient lighting 64-colour', 'Digital key & soft-close doors', 'Executive rear entertainment'],
    suv: ['Adaptive air suspension', '3-zone climate control', '360° camera system', 'Power tailgate', 'Roof rails & running boards', 'Terrain response / drive modes'],
    sports: ['Sport exhaust', 'Adaptive dampers', 'Ceramic brakes', 'Launch control', 'Alcantara / Nappa interiors', 'Carbon trim pack'],
    electric: ['DC fast charging', 'Heat pump', 'Adaptive cruise & lane assist', 'Glass roof', 'Home wallbox brochure included', 'OTA software updates'],
    sedan: ['Lane keep assist', 'Adaptive cruise', 'Wireless Apple CarPlay & Android Auto', 'Blind-spot monitoring', 'Rear picture-window shades', 'Parking package'],
    truck: ['Tow package', 'Pro Power onboard', 'All-terrain tyres', 'Spray-in bed liner', 'Bed & tailgate work surfaces'],
    family: ['IsoFix child anchors', 'Power tailgate', 'Dual-zone climate', 'Rear camera & sensors', 'Roof rails'],
  }[c.category] || ['Climate control', 'Cruise control'];
  const safety = ['ABS · EBD · ESP', '8 airbags', 'Tyre-pressure monitoring', 'Emergency call assistance', 'Driver attention alert'];
  const slugBase = slug(`${c.brand}-${c.model}-${c.year}`);
  const v = q.run(`INSERT INTO vehicles (slug, status, brand, model, year, price, currency, mileage, engine, transmission, fuel, body_type,
    exterior_color, interior_color, vin, condition, registration, location, description, features, safety_features, ownership_info,
    inspection_status, inspection_report, category, is_featured, views, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    slugBase, c.status, c.brand, c.model, c.year, c.price, 'USD', c.mileage, c.engine, c.transmission, c.fuel, c.body,
    c.ext, c.int, c.vin, c.year === 2023 ? 'Used — as new' : 'Used', 'GCC import · duty paid · registration transfer included',
    c.location, c.desc, JSON.stringify(features), JSON.stringify(safety),
    c.vin ? 'One owner since new (verified against registration document). Full service history on file.' : 'Two owners, verified via registration document (on file).',
    c.price > 100000 ? 'third_party_inspected' : 'dealership_inspected',
    c.price > 100000 ? 'Independent inspection (reported condition): paint depth consistent with factory finish, no structural repairs detected; battery/engine checks passed. Full written report held at the showroom — not alterable by this website.' : 'Passed DM Motor Group 150-point workshop inspection (brakes, suspension, fluids, electronics). Report held at the showroom; photography in any listing is genuine.',
    c.category, c.featured, 40 + Math.floor(Math.random() * 900), nowStamp(), nowStamp());
  const images = seedImages(idx, c);
  images.forEach((im, i) => q.run('INSERT INTO media (vehicle_id, type, url, thumb_url, caption, category, position, created_at) VALUES (?,?,?,?,?,?,?,?)',
    v.lastInsertRowid, 'image', im.name, '', im.caption, im.category, i, nowStamp()));
  q.run('UPDATE vehicles SET cover_media_id = (SELECT id FROM media WHERE vehicle_id = ? ORDER BY position ASC LIMIT 1) WHERE id = ?', v.lastInsertRowid, v.lastInsertRowid);
  return v.lastInsertRowid;
});

/* optional demo videos (only if ffmpeg is available) */
try {
  const { execFileSync } = require('child_process');
  const vidDir = path.join(__dirname, 'uploads', 'v' + carSeeds[0]);
  fs.mkdirSync(vidDir, { recursive: true });
  const clip = (name, color, secs) => {
    const out = path.join(vidDir, name);
    if (fs.existsSync(out)) return out;
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `testsrc=size=1280x720:rate=24:duration=${secs}`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=' + secs, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out], { stdio: 'ignore' });
    return out;
  };
  const v1 = clip('demo-walkaround.mp4', '#333', 12);
  q.run('INSERT INTO media (vehicle_id, type, url, thumb_url, caption, category, position, created_at) VALUES (?,?,?,?,?,?,?,?)',
    carSeeds[0], 'video', '/media/v' + carSeeds[0] + '/demo-walkaround.mp4', `/assets/img/car${carSeeds[0] || 1}-0.svg`, 'Full walk-around presentation (demo clip — replace with your real videos in Admin)', 'video', 0, nowStamp());
  console.log('ffmpeg demo videos generated.');
} catch (e) {
  console.log('ffmpeg not found — skipping demo videos. (Your uploaded videos appear here in full length.)');
}

/* banners */
q.run('INSERT INTO banners (title, subtitle, image, link, position, active) VALUES (?,?,?,?,?,1)',
  'The DM Motor Group Showroom', 'Hand-selected vehicles · full histories · worldwide delivery', '/assets/img/car1-0.svg', '/vehicles', 0);
q.run('INSERT INTO banners (title, subtitle, image, link, position, active) VALUES (?,?,?,?,?,1)',
  'Luxury Collection', 'S-Class · Range Rover · Ghost — inspected & documented', '/assets/img/car13-0.svg', '/vehicles?category=luxury', 1);
q.run('INSERT INTO banners (title, subtitle, image, link, position, active) VALUES (?,?,?,?,?,1)',
  'Electric & Hybrid Era', 'Tesla Model S Plaid · Taycan 4S · ID.4 — battery certified', '/assets/img/car4-0.svg', '/vehicles?category=electric', 2);
q.run('INSERT INTO banners (title, subtitle, image, link, position, active) VALUES (?,?,?,?,?,1)',
  'Video Presentations', 'Walk-arounds and engine-bay films for selected stock', '/assets/img/car3-0.svg', '/videos', 3);

/* testimonials (seeded demo records shown as dealership-collected; approve/pin in admin) */
[
  ['Abdul Rahman Al Farsi', 'Doha, Qatar — bought LX 600', 5, 'Inspection report matched the car in every detail. Delivery to Doha took four days and the paperwork was ready before arrival.'],
  ['Grace Chen', 'Singapore — bought S 580', 5, 'The walk-around video was the deciding factor. Every panel, wheel and seat shown honestly, with nothing edited out.'],
  ['Ivan Petrov', 'London, UK — bought Taycan 4S', 4, 'Battery certificate and service file produced on request. Payment went through escrow as promised — no last-minute changes.'],
  ['Marta Silva', 'Lisbon, Portugal — enquiries desk', 5, 'Answered ninety questions before I offered once. Never pushed, and they confirmed availability themselves rather than “holding” the car for me.'],
  ['Omar Kaddouri', 'Casablanca, Morocco — bought Land Cruiser 300', 5, 'Shipping big SUVs is their speciality. Vehicle arrived matching photographs, invoices and spec sheet exactly.'],
  ['Daniel Weiss', 'Munich, Germany — bought AMG GT 63 S', 4, 'Third-party report allowed. My mechanic confirmed the vehicle in under an hour. Transparent outfit.'],
].forEach(([name, location, rating, text]) => q.run('INSERT INTO testimonials (name, location, rating, text, status, created_at) VALUES (?,?,?,?,?,?)',
  name, location, rating, text, 'approved', nowStamp()));

logActivity('system', 'seed', 'Database seeded with demo inventory, staff accounts and settings');
console.log(`✔ Seed complete: ${q.get('SELECT COUNT(*) AS n FROM vehicles').n} vehicles, staff accounts ready.`);
console.log('  Admin login      → admin@dmmotorgroup.com / Admin#2026');
console.log('  Manager login    → sales@dmmotorgroup.com / Sales#2026');

/* ---------- pure-Node PNG icons for the mobile app (PWA) ---------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function writePng(file, size, fn) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; // RGBA
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) { const [r, g, b, a] = fn(x, y, size); row.set([r, g, b, a], 1 + x * 4); }
    rows.push(row);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', require('zlib').deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}
const inRadius = (x, y, s, r) => {
  const c = r;
  const dx = x < c ? c - x : x > s - 1 - c ? x - (s - 1 - c) : 0;
  const dy = y < c ? c - y : y > s - 1 - c ? y - (s - 1 - c) : 0;
  return Math.hypot(dx, dy) <= r;
};
const iconPixel = (x, y, s) => {
  if (!inRadius(x, y, s, s * 0.21)) return [0, 0, 0, 0];
  const border = inRadius(x, y, s, s * 0.19) && !inRadius(x, y, s * 0.985, s * 0.165);
  const dm = y > s * 0.30 && y < s * 0.62 && (x > s * 0.30 && x < s * 0.47 || x > s * 0.53 && x < s * 0.70);
  const underline = y > s * 0.68 && y < s * 0.74 && x > s * 0.28 && x < s * 0.72;
  if (border || dm || underline) return [201, 164, 92, 255];
  return [16, 19, 24, 255];
};
writePng(path.join(IMG_DIR, 'icon-192.png'), 192, iconPixel);
writePng(path.join(IMG_DIR, 'maskable-192.png'), 192, (x, y, s) => inRadius(x, y, s, s / 2) ? iconPixel(x, y, s) : [16, 19, 24, 255]);
console.log('✔ App icons generated (icon-192.png, maskable-192.png).');

function nowStamp() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
