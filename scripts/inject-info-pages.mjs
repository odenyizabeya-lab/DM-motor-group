import fs from 'node:fs';
const info = fs.readFileSync('public/_info-pages.js', 'utf8');
let app = fs.readFileSync('public/app.js', 'utf8');
if (!app.includes('const INFO_PAGES = {')) {
  app = app.replace('const routes = [', info + '\nconst routes = [');
  fs.writeFileSync('public/app.js', app);
  console.log('inserted info pages into app.js');
} else console.log('already present');
fs.unlinkSync('public/_info-pages.js');
