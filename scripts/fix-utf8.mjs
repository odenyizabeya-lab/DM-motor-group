import fs from 'node:fs';
const buf = fs.readFileSync('shared/youtube.js');
const out = [];
for (const b of buf) out.push(b >= 0x7F ? 0x2D : b);
fs.writeFileSync('shared/youtube.js', Buffer.from(out));
console.log('non-ASCII bytes replaced with hyphen:', buf.filter((b) => b >= 0x7F).length);
