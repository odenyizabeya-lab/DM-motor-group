const fs = require('fs');
const crypto = require('crypto');
const rows = JSON.parse(fs.readFileSync('/tmp/video-report.json', 'utf8'));
const byHash = new Map();
for (const r of rows) {
  const h = crypto.createHash('md5').update(fs.readFileSync(r.p)).digest('hex');
  if (!byHash.has(h)) byHash.set(h, []);
  byHash.get(h).push(r.p);
}
const out = [];
for (const [hash, paths] of byHash) {
  const keep = paths.slice().sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  out.push({ hash, keep, duplicates: paths.filter((p) => p !== keep), count: paths.length });
}
fs.writeFileSync('/tmp/video-hashes.json', JSON.stringify(out, null, 2));
const dupeCount = out.reduce((n, g) => n + g.duplicates.length, 0);
console.log(`UNIQUE VIDEOS: ${out.length}`);
console.log(`DUPLICATE FILES TO SKIP: ${dupeCount}`);
for (const g of out) {
  console.log(`${g.hash.slice(0, 10)}  x${g.count}  KEEP: ${g.keep}`);
  for (const d of g.duplicates) console.log(`                    SKIP: ${d}`);
}
