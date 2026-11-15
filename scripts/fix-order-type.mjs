import fs from 'node:fs';
const p = 'functions/api/[[path]].js';
let t = fs.readFileSync(p, 'utf8');
const before = (t.match(/type: 'eq\.manual_bank_transfer'/g) || []).length;
t = t.split("type: 'eq.manual_bank_transfer'").join("type: 'eq.purchase'");
fs.writeFileSync(p, t);
console.log('type filters changed:', before);
console.log('remaining manual_bank_transfer refs:', (t.match(/manual_bank_transfer/g) || []).length);
