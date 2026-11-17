import fs from 'node:fs';
const target = process.argv[2];
const buf = fs.readFileSync(target);
const out = [];
for (const b of buf) out.push(b >= 0x7F ? 0x2D : b);
fs.writeFileSync(target, Buffer.from(out));
console.log('repairing', target, '->', buf.filter((b) => b >= 0x7F).length, 'non-ASCII bytes replaced');
