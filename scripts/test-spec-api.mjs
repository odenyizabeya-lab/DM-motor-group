/* API-level test of the dealer specification feature (no browser). */
import fs from 'node:fs';
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const BASE = 'https://dmmotorgroup.com';

const login = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: creds.email, password: creds.password }),
}).then((r) => r.json());
const token = login.token;
const H = { 'content-type': 'application/json', Authorization: 'Bearer ' + token };
console.log('login ok:', !!token, '| role:', login.user && login.user.role);

const spec = { mileage: '82,500 km', registrationYear: '1970', engineNumber: 'RB-440-ENG-0155', doors: '2' };
const put = await fetch(BASE + '/api/admin/vehicles/46/spec', { method: 'PUT', headers: H, body: JSON.stringify({ spec }) });
console.log('PUT spec ->', put.status, JSON.stringify(await put.json()).slice(0, 120));

const pub = await fetch(BASE + '/api/vehicles/plymouth-barracuda-1970').then((r) => r.json());
console.log('public API spec:', JSON.stringify(pub.spec));
console.log('public API inspectionReport (notes):', JSON.stringify(pub.inspectionReport).slice(0, 60));

const adm = await fetch(BASE + '/api/admin/vehicles/46', { headers: { Authorization: 'Bearer ' + token } }).then((r) => r.json());
console.log('admin API spec:', JSON.stringify(adm.spec));

const del = await fetch(BASE + '/api/admin/vehicles/46/spec', { method: 'DELETE', headers: H });
console.log('DELETE spec ->', del.status);
const after = await fetch(BASE + '/api/vehicles/plymouth-barracuda-1970').then((r) => r.json());
console.log('after reset, public spec:', JSON.stringify(after.spec));
