import fs from 'node:fs';
const t = fs.readFileSync('C:/Users/HP/AppData/Roaming/xdg.config/.wrangler/config/default.toml', 'utf8');
const token = (t.match(/oauth_token\s*=\s*"([^"]+)"/) || [])[1];
const ACC = 'fc62606d16cf7298c4c9a8a39c1b3412';
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const r = await fetch('https://api.cloudflare.com/client/v4/accounts/' + ACC + '/pages/projects/dm-motor-group', {
  method: 'PATCH',
  headers: H,
  body: JSON.stringify({
    build_config: {
      build_command: 'npm run build',
      destination_dir: 'dist',
      root_dir: '',
    },
  }),
}).then((x) => x.json());
console.log('PATCH success:', r.success, r.errors && r.errors.map((e) => e.message).join(';'));
console.log('build_config now:', JSON.stringify(r.result && r.result.build_config));
