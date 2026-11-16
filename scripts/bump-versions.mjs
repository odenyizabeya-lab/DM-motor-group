/* Increment every asset version in the source files so the Cloudflare zone
 * never serves a stale copy. Reads the current version and adds one. */
import fs from 'node:fs';

const bumpAll = (file, patterns) => {
  let t = fs.readFileSync(file, 'utf8');
  for (const p of patterns) {
    t = t.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\D)', 'g'), (m) => {
      const n = parseInt(m.replace(/\D/g, ''), 10);
      return m.replace(String(n), String(n + 1));
    });
  }
  fs.writeFileSync(file, t);
};

/* app.js / styles.css versions live in index.html and sw.js */
let idx = fs.readFileSync('public/index.html', 'utf8');
const nextOf = (name, cur) => {
  const m = idx.match(new RegExp(name + '\\?v=(\\d+)'));
  return m ? String(parseInt(m[1], 10) + 1) : '1';
};
const appV = nextOf('/app.js', '');
const cssV = nextOf('/styles.css', '');
idx = idx.replace(/\/app\.js\?v=\d+/, '/app.js?v=' + appV).replace(/\/styles\.css\?v=\d+/, '/styles.css?v=' + cssV);
fs.writeFileSync('public/index.html', idx);

let sw = fs.readFileSync('public/sw.js', 'utf8');
const swV = String(parseInt((sw.match(/dm-v(\d+)/) || [0, '0'])[1], 10) + 1);
sw = sw.replace(/dm-v\d+/, 'dm-v' + swV)
  .replace(/\/app\.js\?v=\d+/, '/app.js?v=' + appV)
  .replace(/\/styles\.css\?v=\d+/, '/styles.css?v=' + cssV);
fs.writeFileSync('public/sw.js', sw);

let app = fs.readFileSync('public/app.js', 'utf8');
app = app.replace(/\/sw\.js\?v=\d+/, '/sw.js?v=' + swV);
fs.writeFileSync('public/app.js', app);

let adm = fs.readFileSync('admin/index.html', 'utf8');
const admAppV = String(parseInt((adm.match(/admin\.js\?v=(\d+)/) || [0, '0'])[1], 10) + 1);
const admCssV = String(parseInt((adm.match(/admin\.css\?v=(\d+)/) || [0, '0'])[1], 10) + 1);
adm = adm.replace(/admin\.js\?v=\d+/, 'admin.js?v=' + admAppV).replace(/admin\.css\?v=\d+/, 'admin.css?v=' + admCssV);
fs.writeFileSync('admin/index.html', adm);

console.log(`app.js?v=${appV} styles.css?v=${cssV} sw.js?v=${swV} admin.js?v=${admAppV} admin.css?v=${admCssV}`);
for (const f of ['public/index.html', 'public/app.js', 'public/sw.js', 'admin/index.html']) {
  const t = fs.readFileSync(f, 'utf8');
  console.log(' ', f, '->', (t.match(/[?&]v=\d+/g) || []).join(' '), '| mojibake:', (t.match(/[\uFFFD]|â€/g) || []).length);
}
