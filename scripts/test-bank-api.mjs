/* API test for bank accounts + manual bank transfer payments. */
import fs from 'node:fs';
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const BASE = 'https://dmmotorgroup.com';
const login = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: creds.email, password: creds.password }),
}).then((r) => r.json());
const H = { 'content-type': 'application/json', Authorization: 'Bearer ' + login.token };
console.log('login:', !!login.token, '| role:', login.user && login.user.role);

/* 1. list (empty at first) */
let list = await fetch(BASE + '/api/admin/bank-accounts', { headers: H }).then((r) => r.json());
console.log('1. list accounts:', list.accounts.length, '| currencies offered:', list.currencies.length, '| types:', list.types.join(','));

/* 2. create three accounts (NGN, USD, GBP) */
const mk = async (b) => {
  const r = await fetch(BASE + '/api/admin/bank-accounts', { method: 'POST', headers: H, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json() };
};
const ng = await mk({
  bankName: 'Zenith Bank Nigeria', accountName: 'DM Motor Group Ltd', accountNumber: '0123456789',
  accountType: 'current', currency: 'NGN', country: 'Nigeria', branch: 'Lagos Island',
  swift: 'ZBNINGLA', iban: '', instructions: 'Send NGN only. Use the reference as your transfer narration.',
});
console.log('2. create NGN account:', ng.status, ng.body.account ? ng.body.account.id.slice(0, 8) : JSON.stringify(ng.body).slice(0, 120));
const us = await mk({
  bankName: 'First Meridian Bank', accountName: 'DM Motor Group LLC', accountNumber: 'US-4477-8890',
  accountType: 'business', currency: 'USD', country: 'United States', branch: 'New York',
  swift: 'FMIBUS33', iban: '', instructions: 'Wire or Zelle. Reference is mandatory.',
});
console.log('   create USD account:', us.status);
const gb = await mk({
  bankName: 'Albion Union Bank', accountName: 'DM Motor Group UK Ltd', accountNumber: 'GB29NWBK60161331926819',
  accountType: 'business', currency: 'GBP', country: 'United Kingdom', branch: 'City of London',
  swift: 'NWBKGB2L', iban: 'GB29NWBK60161331926819', instructions: 'Faster payments or SWIFT.',
});
console.log('   create GBP account:', gb.status);

/* 3. list again */
list = await fetch(BASE + '/api/admin/bank-accounts', { headers: H }).then((r) => r.json());
console.log('3. accounts now:', list.accounts.length, '| currencies:', [...new Set(list.accounts.map((a) => a.currency))].join(','));

/* 4. edit one */
const ed = await fetch(BASE + '/api/admin/bank-accounts/' + us.body.account.id, {
  method: 'PUT', headers: H, body: JSON.stringify({ ...us.body.account, bankName: 'First Meridian Bank N.A.', instructions: 'Updated instruction text.' }),
});
const edBody = await ed.json();
console.log('4. edit USD account:', ed.status, '| new bank name:', edBody.account && edBody.account.bankName, '| instructions:', edBody.account && String(edBody.account.instructions).slice(0, 30));

/* 5. deactivate one */
const tog = await fetch(BASE + '/api/admin/bank-accounts/' + gb.body.account.id, {
  method: 'PUT', headers: H, body: JSON.stringify({ ...gb.body.account, active: false }),
});
const togBody = await tog.json();
console.log('5. deactivate GBP:', tog.status, '| active:', togBody.account && togBody.account.active);

/* 6. public listing: active only, filtered by currency */
const pubAll = await fetch(BASE + '/api/payment-methods/bank-accounts').then((r) => r.json());
const pubNgn = await fetch(BASE + '/api/payment-methods/bank-accounts?currency=NGN').then((r) => r.json());
const pubGbp = await fetch(BASE + '/api/payment-methods/bank-accounts?currency=GBP').then((r) => r.json());
console.log('6. public active accounts:', pubAll.accounts.length, '| NGN:', pubNgn.accounts.length, '| GBP (deactivated):', pubGbp.accounts.length);

/* 7. public settings must not leak the accounts */
const home = await fetch(BASE + '/api/home').then((r) => r.json());
const leaked = Object.keys(home.settings || {}).filter((k) => /bank|account/i.test(k));
console.log('7. public settings bank keys leaked:', leaked.length ? leaked.join(',') : 'none');

/* 8. create a payment */
const pay = await fetch(BASE + '/api/payments', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    vehicleId: 46, name: 'Test Customer', email: 'customer@example.com', phone: '+2348000000000',
    currency: 'NGN', amount: 2500000, accountId: ng.body.account.id,
  }),
});
const payBody = await pay.json();
console.log('8. create payment:', pay.status, pay.status !== 200 ? JSON.stringify(payBody).slice(0, 200) : '', '| reference:', payBody.reference, '| account:', payBody.account && payBody.account.bankName);

/* 9. wrong currency must be refused */
const wrong = await fetch(BASE + '/api/payments', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ vehicleId: 46, name: 'T', email: 'c@example.com', currency: 'USD', amount: 100, accountId: ng.body.account.id }),
});
console.log('9. wrong-currency account refused:', wrong.status, (await wrong.text()).slice(0, 110));

/* 10. wrong reference must be refused */
const badRef = await fetch(BASE + '/api/payments/' + payBody.id + '/receipt', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reference: 'WRONG', fileName: 'r.jpg' }),
});
console.log('10. wrong reference refused:', badRef.status, (await badRef.text()).slice(0, 90));

/* 11. status lookup with the right reference */
const look = await fetch(BASE + '/api/payments/' + payBody.id + '?reference=' + payBody.reference).then((r) => r.json());
console.log('11. status lookup:', look.status, look.statusLabel, '| amount', look.amount, look.currency);

/* 12. admin payment list */
const adminPay = await fetch(BASE + '/api/admin/payments', { headers: H }).then((r) => r.json());
const p0 = (adminPay.payments || [])[0];
console.log('12. admin payments:', adminPay.payments.length, '| first:', p0 && {
  ref: p0.reference, customer: p0.customer && p0.customer.email, amount: p0.amount, currency: p0.currency,
  bank: p0.bankName, account: p0.accountNumber, vehicle: p0.vehicle.brand + ' ' + p0.vehicle.model, status: p0.statusLabel,
});

/* 13. staff-only protection */
const noAuth = await fetch(BASE + '/api/admin/payments');
const noAuth2 = await fetch(BASE + '/api/admin/bank-accounts');
console.log('13. admin APIs without a token:', noAuth.status, noAuth2.status, '(both must be 401)');

/* 14. approve the payment manually */
const conf = await fetch(BASE + '/api/admin/payments/' + payBody.id, {
  method: 'PUT', headers: H, body: JSON.stringify({ status: 'confirmed', reviewNote: 'Funds seen in the bank account.' }),
});
console.log('14. manual confirm:', conf.status, JSON.stringify(await conf.json()));
const confList = await fetch(BASE + '/api/admin/payments', { headers: H }).then((r) => r.json());
const p1 = (confList.payments || [])[0];
console.log('    after confirm -> status:', p1.statusLabel, '| reviewedBy:', p1.reviewedBy, '| note:', p1.reviewNote);

/* 15. delete the test accounts (and any left over from earlier runs) */
const all = await fetch(BASE + '/api/admin/bank-accounts', { headers: H }).then((r) => r.json());
const TEST_NUMBERS = ['0123456789', 'US-4477-8890', 'GB29NWBK60161331926819'];
for (const a of all.accounts.filter((x) => TEST_NUMBERS.includes(x.accountNumber))) {
  const d = await fetch(BASE + '/api/admin/bank-accounts/' + a.id, { method: 'DELETE', headers: H });
  console.log('15. delete test account', a.bankName, '->', d.status);
}
const after = await fetch(BASE + '/api/admin/bank-accounts', { headers: H }).then((r) => r.json());
console.log('    accounts left:', after.accounts.length);
