const r = await fetch('https://dmmotorgroup.com/api/vehicles/plymouth-barracuda-1970');
const j = await r.json();
console.log('public API spec after reset:', JSON.stringify(j.spec), '| listing mileage:', j.mileage);
const d = await fetch('https://dmmotorgroup.com/details/vehicles.json?v=4').then((x) => x.json());
console.log('generated defaults still intact:', JSON.stringify(d.vehicles['plymouth-barracuda-1970'].spec.mileage).slice(0, 60));
