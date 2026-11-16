import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (pkg.dependencies && pkg.dependencies['embedded-postgres']) {
  pkg.devDependencies = pkg.devDependencies || {};
  pkg.devDependencies['embedded-postgres'] = pkg.dependencies['embedded-postgres'];
  delete pkg.dependencies['embedded-postgres'];
  if (!Object.keys(pkg.dependencies).length) delete pkg.dependencies;
  pkg.scripts['test:sql'] = 'node scripts/test-migrations-pg.mjs';
  pkg.scripts['audit:platform'] = 'node scripts/audit-platform.mjs';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log('package.json updated');
}
console.log(JSON.stringify(pkg.scripts, null, 1));
