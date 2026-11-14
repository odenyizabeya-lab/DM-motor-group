const r = await fetch('https://dmmotorgroup.com/styles.css?v=14');
const t = await r.text();
console.log('status', r.status, 'len', t.length);
console.log('install-android max-width:', t.includes('.install-android{position:fixed') && t.includes('max-width:calc(100% - 24px)'));
console.log('#bottomNav overflow hidden:', t.includes('#bottomNav{overflow:hidden}'));
console.log('cta-stack minmax:', t.includes('.cta-stack{display:grid;grid-template-columns:minmax(0,1fr)'));
const h = await fetch('https://dmmotorgroup.com/');
const ht = await h.text();
console.log('html styles ref:', (ht.match(/styles.css\?v=\d+/) || [])[0]);
