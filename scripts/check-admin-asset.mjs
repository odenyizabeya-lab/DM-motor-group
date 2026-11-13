const versions = ['11', '12'];
for (const v of versions) {
  const r = await fetch('https://dmmotorgroup.com/admin/admin.js?v=' + v);
  const t = await r.text();
  console.log('admin.js?v=' + v, '| status', r.status,
    '| has inputmode:', t.includes('inputmode'),
    '| has dbMileage:', t.includes('dbMileage'),
    '| uses text input in field():', t.includes('type="text"${im}'));
}
const h = await fetch('https://dmmotorgroup.com/admin');
const ht = await h.text();
console.log('admin html ->', (ht.match(/admin\.js\?v=\d+/) || [])[0]);
