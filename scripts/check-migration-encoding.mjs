import fs from 'node:fs';
for (const f of fs.readdirSync('supabase/migrations').sort()) {
  const p = 'supabase/migrations/' + f;
  const t = fs.readFileSync(p, 'utf8');
  const bad = [...t.matchAll(/[\uFFFD]|â[\u0080-\u00BF]{1,2}|\u00D7/g)];
  console.log(f.padEnd(42), 'chars', String(t.length).padStart(6), '| suspicious sequences:', bad.length);
  for (const b of bad.slice(0, 6)) {
    const i = b.index;
    console.log('    ...' + t.slice(Math.max(0, i - 45), i + 45).replace(/\n/g, ' ') + '...');
  }
}
