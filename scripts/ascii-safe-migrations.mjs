/* Make every migration file pure ASCII so it runs on a database of any
 * encoding (Windows/latin1 clusters reject UTF-8 bytes even inside comments). */
import fs from 'node:fs';

const dir = 'supabase/migrations';
for (const f of fs.readdirSync(dir).sort()) {
  const p = dir + '/' + f;
  const before = fs.readFileSync(p, 'utf8');
  const after = before
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x00-\x7F]/g, (c) => {
      /* keep anything else as a readable ASCII approximation */
      return { '\u2022': '*', '\u2192': '->', '\u00B7': '-', '\u2265': '>=', '\u2264': '<=' }[c] || '';
    });
  if (after !== before) {
    fs.writeFileSync(p, after);
    console.log('  converted to ASCII:', f);
  } else console.log('  already ASCII  :', f);
}
/* verify */
for (const f of fs.readdirSync(dir).sort()) {
  const t = fs.readFileSync(dir + '/' + f, 'utf8');
  const bad = (t.match(/[^\x00-\x7F]/g) || []).length;
  console.log(f.padEnd(42), 'non-ascii chars:', bad);
}
